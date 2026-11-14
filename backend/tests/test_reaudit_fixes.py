"""Regression tests for docs/PAPERAID_V2_REAUDIT.md (the follow-up audit), one section per finding."""

from __future__ import annotations

import asyncio
import io
import json
import uuid
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import psycopg
import pytest
import respx
from docx import Document as DocxDocument
from sqlalchemy import select

from app.config import get_settings
from app.db.models import (
    ClosedAccount,
    JobKind,
    JobStatus,
    LibraryItem,
    Message,
    Paper,
    PaperVisibility,
    ProcessingJob,
    StorageDeletion,
    User,
)
from app.db.session import get_sessionmaker
from app.errors import UpstreamError
from app.services import export as export_service
from app.services import processing
from app.services.ai.grounding import check_claim, locate_quote
from app.services.citations.verify import _assess
from app.services.scholarly.aggregator import merge_and_dedupe
from app.services.scholarly.models import ScholarlyWork, WorkAuthor
from tests import conftest
from tests import fixtures as fx
from tests.conftest import ADMIN, ALICE, BOB, STUDY_SECTIONS, auth, import_doi, make_pdf

BACKEND = Path(__file__).resolve().parent.parent


async def upload(client, title: str, headers=ALICE, pdf: bytes | None = None) -> dict:
    response = await client.post(
        "/api/v1/papers/upload",
        headers=headers,
        data={"title": title},
        files={"file": ("p.pdf", pdf or make_pdf(STUDY_SECTIONS, title=title), "application/pdf")},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def cite(client, doc_id: str, paper_id: str) -> str:
    response = await client.post(f"/api/v1/documents/{doc_id}/citations", json={"paper_id": paper_id}, headers=ALICE)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def text(value: str, *marks: str) -> dict:
    node: dict = {"type": "text", "text": value}
    if marks:
        node["marks"] = [{"type": m} for m in marks]
    return node


def citation(cid: str) -> dict:
    return {"type": "citation", "attrs": {"citationIds": [cid]}}


# ---------------------------------------------------------------------------- H1 fonts required for PDF export
def test_pdf_export_works_without_italic_font_files(monkeypatch):
    """The production image may lack italic faces: export must fall back to the upright face, not fail."""
    real_find = export_service._find
    monkeypatch.setattr(
        export_service, "_find", lambda name: None if "Italic" in name or name.endswith("i.ttf") else real_find(name)
    )
    export_service._font_plan.cache_clear()
    try:
        content = {
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [text("plain "), text("bold", "bold"), text(" italic", "italic")]}
            ],
        }
        pdf = export_service.to_pdf("Fonts", content, {"clusters": [], "bibliography": []})
        assert pdf.startswith(b"%PDF")
    finally:
        export_service._font_plan.cache_clear()


def test_dockerfile_installs_the_fonts_the_exporter_needs():
    dockerfile = (Path(__file__).parent.parent / "Dockerfile").read_text(encoding="utf-8")
    assert "fonts-dejavu-core" in dockerfile and "fonts-dejavu-extra" in dockerfile


# ---------------------------------------------------------------------------- H2 closed accounts refuse old tokens
async def test_closed_account_token_cannot_recreate_the_profile(client, identity_admin):
    from app.services.accounts import close_account

    await upload(client, "Closing soon")
    async with get_sessionmaker()() as db:
        user = (await db.execute(select(User).where(User.firebase_uid == "alice"))).scalar_one()
        await close_account(db, user)
    assert identity_admin.deleted == ["alice"]
    # The same (still cryptographically valid) token is refused and never re-creates a profile.
    for path in ("/api/v1/me", "/api/v1/library", "/api/v1/papers"):
        response = await client.get(path, headers=ALICE)
        assert response.status_code in {401, 200}, path
        if path != "/api/v1/papers":
            assert response.status_code == 401
    assert (await client.get("/api/v1/papers", headers=ALICE)).status_code == 401
    async with get_sessionmaker()() as db:
        assert (await db.execute(select(User).where(User.firebase_uid == "alice"))).first() is None
        assert await db.get(ClosedAccount, "alice") is not None


async def test_closed_bootstrap_admin_is_not_recreated_as_admin(client):
    from app.services.accounts import close_account

    await client.get("/api/v1/me", headers=ADMIN)
    async with get_sessionmaker()() as db:
        admin = (await db.execute(select(User).where(User.firebase_uid == "root"))).scalar_one()
        await close_account(db, admin)
    assert (await client.get("/api/v1/admin/stats", headers=ADMIN)).status_code == 401


async def test_closure_in_progress_refuses_the_identity(client):
    await upload(client, "Mid-closure")
    async with get_sessionmaker()() as db:
        user = (await db.execute(select(User).where(User.firebase_uid == "alice"))).scalar_one()
        user.is_active = False  # step 1 of closure committed, data not yet deleted
        db.add(ClosedAccount(firebase_uid="alice"))
        await db.commit()
    assert (await client.get("/api/v1/library", headers=ALICE)).status_code == 403


# ---------------------------------------------------------------------------- H3 historical links respect privacy
async def test_library_never_exposes_a_private_paper_saved_under_the_old_admin_policy(client):
    private = await upload(client, "Alice confidential")
    await client.get("/api/v1/me", headers=ADMIN)
    async with get_sessionmaker()() as db:
        admin = (await db.execute(select(User).where(User.firebase_uid == "root"))).scalar_one()
        db.add(LibraryItem(user_id=admin.id, paper_id=uuid.UUID(private["id"]), tags=[]))  # created pre-fix
        await db.commit()
    listing = await client.get("/api/v1/library", headers=ADMIN)
    assert listing.json() == [] and listing.headers["x-total-count"] == "0"
    exported = await client.get("/api/v1/library/export", params={"format": "csl-json"}, headers=ADMIN)
    assert json.loads(exported.text) == [] and "confidential" not in exported.text
    collection = (await client.post("/api/v1/collections", json={"name": "Mine"}, headers=ADMIN)).json()
    assert (
        await client.put(f"/api/v1/collections/{collection['id']}/papers/{private['id']}", headers=ADMIN)
    ).status_code == 404


# ---------------------------------------------------------------------------- H4 nested citations in exports
async def test_citations_inside_table_cells_stay_with_their_claims(client):
    alpha = await upload(client, "Alpha trial of nets")
    beta = await upload(client, "Beta trial of nets")
    doc = (await client.post("/api/v1/documents", json={"title": "Nested"}, headers=ALICE)).json()
    a, b = await cite(client, doc["id"], alpha["id"]), await cite(client, doc["id"], beta["id"])
    content = {
        "type": "doc",
        "content": [
            {
                "type": "table",
                "content": [
                    {
                        "type": "tableRow",
                        "content": [
                            {
                                "type": "tableCell",
                                "content": [
                                    {"type": "paragraph", "content": [text("Cell intro")]},
                                    {
                                        "type": "blockquote",
                                        "content": [
                                            {"type": "paragraph", "content": [text("Quoted claim "), citation(a)]}
                                        ],
                                    },
                                    {
                                        "type": "bulletList",
                                        "content": [
                                            {
                                                "type": "listItem",
                                                "content": [{"type": "paragraph", "content": [text("Listed point")]}],
                                            }
                                        ],
                                    },
                                ],
                            }
                        ],
                    }
                ],
            },
            {"type": "paragraph", "content": [text("After the table "), citation(b)]},
        ],
    }
    saved = await client.patch(
        f"/api/v1/documents/{doc['id']}", json={"base_version": 1, "content": content}, headers=ALICE
    )
    assert saved.status_code == 200
    docx = await client.get(f"/api/v1/documents/{doc['id']}/export", params={"format": "docx"}, headers=ALICE)
    document = DocxDocument(io.BytesIO(docx.content))
    cell_text = document.tables[0].cell(0, 0).text
    after = next(p.text for p in document.paragraphs if p.text.startswith("After the table"))
    assert "Quoted claim" in cell_text and "Alpha" in cell_text and "Listed point" in cell_text
    assert "Beta" in after and "Alpha" not in after
    pdf = await client.get(f"/api/v1/documents/{doc['id']}/export", params={"format": "pdf"}, headers=ALICE)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")


def test_export_maps_citations_by_node_not_position():
    from app.services.export import citation_labels

    first = citation("c1")
    second = citation("c2")
    content = {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [first]}, {"type": "paragraph", "content": [second]}],
    }
    rendered = {"clusters": [{"text": "(A, 2020)", "missing_ids": []}, {"text": "(B, 2021)", "missing_ids": []}]}
    labels = citation_labels(content, rendered)
    assert labels[id(first)] == "(A, 2020)" and labels[id(second)] == "(B, 2021)"


# ---------------------------------------------------------------------------- H5/H6 job failure handling + fencing
async def test_failure_after_sql_work_still_records_the_outcome(client, monkeypatch):
    """The failure happens after the attempt executed SQL (so rollback expires ORM state)."""
    calls = {"n": 0}

    async def fails_after_sql(db, paper, attempt):
        calls["n"] += 1
        await db.execute(select(Paper.id).where(Paper.id == attempt.paper_id))
        paper.status_detail = "half-written"
        await db.flush()
        raise UpstreamError("Storage download failed (HTTP 503).")

    monkeypatch.setattr(processing, "_ingest", fails_after_sql)
    paper = await upload(client, "Rollback study")
    job = (await client.get(f"/api/v1/papers/{paper['id']}/jobs", headers=ALICE)).json()[0]
    assert job["status"] == "failed" and job["attempts"] == processing.MAX_ATTEMPTS and calls["n"] == 3
    assert (await client.get(f"/api/v1/papers/{paper['id']}", headers=ALICE)).json()["status"] == "failed"


async def test_a_reclaimed_worker_cannot_overwrite_the_new_attempt(client, monkeypatch):
    paper = await upload(client, "Fencing study")
    pid = uuid.UUID(paper["id"])
    async with get_sessionmaker()() as db:
        job = ProcessingJob(
            paper_id=pid,
            kind=JobKind.INGEST_PDF,
            status=JobStatus.QUEUED,
            lease_expires_at=datetime.now(UTC) + timedelta(minutes=5),
        )
        db.add(job)
        await db.commit()
        job_id = job.id
    async with get_sessionmaker()() as db:
        old = await processing._claim(db, job_id)
    async with get_sessionmaker()() as db:  # the old worker's lease is reclaimed and a new attempt claims it
        row = await db.get(ProcessingJob, job_id)
        row.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
        new = await processing._claim(db, job_id)
    assert isinstance(old, processing.Attempt) and isinstance(new, processing.Attempt) and old.token != new.token
    async with get_sessionmaker()() as db:
        with pytest.raises(processing.LeaseLost):
            await processing._hold(db, old)
        assert await processing._finish(db, old, status=JobStatus.SUCCEEDED) is False
        await db.rollback()
        assert await processing._finish(db, new, status=JobStatus.SUCCEEDED, attempt_token=None) is True
        await db.commit()


async def test_delivery_during_a_live_lease_asks_for_a_retry(client):
    paper = await upload(client, "Live lease study")
    async with get_sessionmaker()() as db:
        job = ProcessingJob(
            paper_id=uuid.UUID(paper["id"]),
            kind=JobKind.INGEST_PDF,
            status=JobStatus.RUNNING,
            lease_expires_at=datetime.now(UTC) + timedelta(minutes=10),
            attempt_token=uuid.uuid4(),
        )
        db.add(job)
        await db.commit()
        job_id = job.id
    assert await processing.run_job(job_id) == processing.Outcome.RETRY


async def test_jobs_without_a_lease_are_reclaimable(client):
    paper = await upload(client, "Null lease study")
    async with get_sessionmaker()() as db:
        db.add(
            ProcessingJob(
                paper_id=uuid.UUID(paper["id"]), kind=JobKind.INGEST_PDF, status=JobStatus.QUEUED, lease_expires_at=None
            )
        )
        await db.commit()
    retried = await client.post(f"/api/v1/papers/{paper['id']}/full-text", headers=ALICE)
    assert retried.status_code == 202 and retried.json()["status"] == "succeeded"


# ---------------------------------------------------------------------------- H7 AI provenance
def test_quantities_are_checked_with_sign_and_unit():
    item = type("I", (), {"shown_text": "Mean change was -5 mg and costs were $12 per pupil, 31% fewer cases."})()
    items = {"E1": item}
    quote = "Mean change was -5 mg and costs were $12 per pupil"
    assert check_claim("The mean change was -5 mg.", ["E1"], [quote], items) is None
    assert check_claim("The mean change was 5 mg.", ["E1"], [quote], items) is not None  # sign dropped
    assert check_claim("The mean change was -5 %.", ["E1"], [quote], items) is not None  # unit changed
    assert check_claim("It cost 12 euros per pupil.", ["E1"], [quote], items) is not None  # currency changed


def test_verified_quote_is_located_even_far_into_the_passage():
    passage = "Background text. " * 80 + "Confirmed malaria incidence was 31 percent lower in intervention schools."
    span = locate_quote("incidence was 31 percent lower", passage)
    assert span is not None and passage[span[0] : span[1]].lower() == "incidence was 31 percent lower"


async def test_answers_return_the_verified_quote_inside_the_excerpt(client):
    from app.services.ai.providers import set_llm
    from tests.test_ai import FakeLLM, answer, claim, results_evidence_key

    paper = await upload(client, "Provenance study")
    quote = "Confirmed malaria incidence was 31 percent lower in intervention schools"
    set_llm(
        FakeLLM(lambda p: answer(claim("Incidence fell by 31 percent.", ids=[results_evidence_key(p)], quotes=[quote])))
    )
    body = (
        await client.post(
            f"/api/v1/papers/{paper['id']}/ask",
            headers=ALICE,
            json={"question": "How much did malaria incidence fall?"},
        )
    ).json()
    [citation_out] = body["citations"]
    [q] = citation_out["quotes"]
    assert citation_out["excerpt"][q["start"] : q["end"]].lower() == quote.lower()


# ---------------------------------------------------------------------------- M10 reference verification
def _w(title: str, year: int, family: str) -> ScholarlyWork:
    return ScholarlyWork(title=title, year=year, authors=[WorkAuthor(name=f"P {family}", family=family)])


def test_second_author_surname_does_not_verify_the_first_author():
    work = _w("Malaria prevention in schools of Kenya", 2020, "Okello")
    result = _assess(
        "Smith J, Okello P. Malaria prevention in schools of Kenya. East Afr Med J. 2020.", work, via_doi=False
    )
    assert result["checks"]["first_author_matches"] is False and result["verdict"] == "mismatch"


def test_a_year_inside_the_title_is_not_the_publication_year():
    work = _w("Malaria control targets for 2020", 2020, "Okello")
    result = _assess("Okello P. Malaria control targets for 2020. Lancet. 2023.", work, via_doi=False)
    assert result["checks"]["year_matches"] is False and result["verdict"] != "verified"


# ---------------------------------------------------------------------------- M11 unverified catalog data
async def test_registry_import_replaces_unverified_public_metadata(client, registries):
    async with get_sessionmaker()() as db:
        db.add(
            Paper(
                title="Wrong title from a file",
                visibility=PaperVisibility.PUBLIC,
                doi=fx.DOI,
                keywords=[],
                abstract="Fabricated",
                metadata_source="unverified",
            )
        )
        await db.commit()
    paper = await import_doi(client)
    assert paper["title"].startswith("School-based malaria prevention") and "Fabricated" not in (
        paper["abstract"] or ""
    )
    assert paper["authors"][0] == "Grace Namaganda"


async def test_concurrent_first_imports_do_not_fail(client, registries):
    results = await asyncio.gather(
        *(client.post("/api/v1/papers/import", json={"identifier": fx.DOI}, headers=h) for h in (ALICE, BOB))
    )
    assert [r.status_code for r in results] == [201, 201]
    assert results[0].json()["id"] == results[1].json()["id"]


# ---------------------------------------------------------------------------- M12 normaliser types and limits
async def test_non_string_types_and_unicode_size_are_rejected_cleanly(client):
    weird = {
        "type": "doc",
        "content": [
            {"type": ["paragraph"], "content": [text("x")]},
            {
                "type": "paragraph",
                "attrs": {"textAlign": {"bad": 1}},
                "content": [{"type": "text", "text": "y", "marks": [{"type": ["bold"]}]}],
            },
        ],
    }
    created = await client.post("/api/v1/documents", json={"content": weird}, headers=ALICE)
    assert created.status_code == 201, created.text
    # Fewer than 2,000,000 characters but more than 2 MB once encoded: the limit is in bytes.
    big = {"type": "doc", "content": [{"type": "paragraph", "content": [text("研" * 180_000)]} for _ in range(4)]}
    response = await client.post("/api/v1/documents", json={"content": big}, headers=ALICE)
    assert response.status_code == 422


# ---------------------------------------------------------------------------- M13 unsupported glyphs
def test_pdf_refuses_characters_it_cannot_draw():
    content = {"type": "doc", "content": [{"type": "paragraph", "content": [text("Research 研究 end")]}]}
    with pytest.raises(Exception) as caught:
        export_service.to_pdf("Doc", content, {"clusters": [], "bibliography": []})
    assert getattr(caught.value, "code", "") == "PDF_UNSUPPORTED_CHARACTERS"


# ---------------------------------------------------------------------------- M14 storage intents
async def test_object_written_but_commit_failed_is_cleaned_up(client, monkeypatch):
    from app.services.maintenance import process_deletions

    real_attach = processing.attach_pdf

    async def attach_then_fail(db, paper, key, digest, size):
        await real_attach(db, paper, key, digest, size)
        raise RuntimeError("database went away after the object was written")

    monkeypatch.setattr(processing, "attach_pdf", attach_then_fail)
    with pytest.raises(RuntimeError):
        await client.post(
            "/api/v1/papers/upload",
            headers=ALICE,
            data={"title": "Lost"},
            files={"file": ("p.pdf", make_pdf(STUDY_SECTIONS, title="Lost"), "application/pdf")},
        )
    async with get_sessionmaker()() as db:
        [intent] = list((await db.execute(select(StorageDeletion))).scalars())
        assert (await db.execute(select(Paper).where(Paper.title == "Lost"))).first() is None
        intent.not_before = datetime.now(UTC) - timedelta(seconds=1)  # grace period elapsed
        await db.commit()
        assert await process_deletions(db) == 1


async def test_reupload_of_the_same_file_does_not_duplicate(client):
    data = make_pdf(STUDY_SECTIONS, title="Same file")
    first = await upload(client, "Same file", pdf=data)
    second = await upload(client, "Same file again", pdf=data)
    assert first["id"] == second["id"]


async def test_dispatch_failure_after_upload_keeps_the_upload(client, monkeypatch):
    async def broken(job_id):
        raise UpstreamError("Could not queue the processing job. Please retry.")

    monkeypatch.setattr(processing, "enqueue_job", broken)
    paper = await upload(client, "Queued later")
    assert "could not be started" in paper["status_detail"]


# ---------------------------------------------------------------------------- M15 maintenance
async def test_failing_old_deletion_does_not_starve_new_ones(client):
    from app.services.maintenance import process_deletions, schedule_deletion
    from app.services.storage import get_storage, set_storage

    original = get_storage()

    class Picky(type(original)):
        async def delete(self, key):
            if key.startswith("broken/"):
                raise UpstreamError("Storage delete failed (HTTP 503).")
            await super().delete(key)

    set_storage(Picky(original.root))
    try:
        async with get_sessionmaker()() as db:
            for i in range(5):
                await schedule_deletion(db, f"broken/{i}")
            await db.commit()
            await schedule_deletion(db, "fine/one")
            await db.commit()
            assert await process_deletions(db, limit=3) == 0  # the oldest 3 fail and back off...
            assert await process_deletions(db, limit=3) == 1  # ...so later work proceeds
            rows = {r.key: r for r in (await db.execute(select(StorageDeletion))).scalars()}
            assert "fine/one" not in rows and all(rows[f"broken/{i}"].not_before > datetime.now(UTC) for i in range(3))
    finally:
        set_storage(original)


async def test_internal_maintenance_endpoint_requires_the_scheduler_identity(client, monkeypatch):
    assert (await client.post("/internal/maintenance")).status_code == 401
    from app.api.routes import admin as admin_routes

    monkeypatch.setattr(admin_routes, "verify_task_request", lambda authorization: None)
    response = await client.post("/internal/maintenance")
    assert response.status_code == 200 and "jobs_reclaimed" in response.json()


# ---------------------------------------------------------------------------- M16 import/export limits
async def test_oversize_reference_files_are_rejected_not_truncated(client):
    entries = "".join(f"@book{{k{i}, title={{Book {i}}}, author={{Kato, R}}, year={{2020}}}}\n" for i in range(501))
    response = await client.post(
        "/api/v1/library/import", headers=ALICE, files={"file": ("big.bib", entries.encode(), "text/plain")}
    )
    assert response.status_code == 422 and "500" in response.json()["error"]["message"]


async def test_library_pages_and_complete_export(client):
    entries = "".join(
        f"@book{{k{i}, title={{Book number {i}}}, author={{Kato, R}}, year={{2020}}}}\n" for i in range(130)
    )
    await client.post(
        "/api/v1/library/import", headers=ALICE, files={"file": ("lib.bib", entries.encode(), "text/plain")}
    )
    first = await client.get("/api/v1/library", params={"limit": 100}, headers=ALICE)
    second = await client.get("/api/v1/library", params={"limit": 100, "offset": 100}, headers=ALICE)
    assert first.headers["x-total-count"] == "130" and len(first.json()) == 100 and len(second.json()) == 30
    exported = await client.get("/api/v1/library/export", params={"format": "csl-json"}, headers=ALICE)
    assert len(json.loads(exported.text)) == 130 and exported.headers["x-item-count"] == "130"


# ---------------------------------------------------------------------------- M17 thread order
async def test_thread_turns_pair_questions_and_answers_even_with_equal_timestamps(client):
    from app.services.ai.providers import set_llm
    from tests.test_ai import FakeLLM, answer, claim

    paper = await upload(client, "Turn study")

    def respond(prompt):
        import re

        key, body = re.findall(r'<evidence id="(E\d+)"[^>]*>\n(.*?)\n</evidence>', prompt, re.S)[0]
        return answer(claim("Finding stated.", ids=[key], quotes=[" ".join(body.split()[:6])]))

    llm = FakeLLM(respond)
    set_llm(llm)
    one = (
        await client.post(
            "/api/v1/research/ask", headers=ALICE, json={"question": "First question here?", "paper_ids": [paper["id"]]}
        )
    ).json()
    cid = one["conversation_id"]
    await client.post(
        "/api/v1/research/ask",
        headers=ALICE,
        json={"question": "Second question here?", "paper_ids": [paper["id"]], "conversation_id": cid},
    )
    async with get_sessionmaker()() as db:  # simulate identical timestamps for every message
        for message in (await db.execute(select(Message))).scalars():
            message.created_at = datetime(2026, 1, 1, tzinfo=UTC)
        await db.commit()
    convo = (await client.get(f"/api/v1/research/conversations/{cid}", headers=ALICE)).json()
    assert [m["role"] for m in convo["messages"]] == ["user", "assistant", "user", "assistant"]
    assert convo["messages"][0]["content"] == "First question here?"
    await client.post(
        "/api/v1/research/ask",
        headers=ALICE,
        json={"question": "Third one?", "paper_ids": [paper["id"]], "conversation_id": cid},
    )
    assert "First question here?" in llm.prompts[-1] and "Second question here?" in llm.prompts[-1]


# ---------------------------------------------------------------------------- M18 dedupe
def test_thin_records_do_not_merge_on_title_alone_and_bridges_merge():
    t = "Malaria prevention in primary schools: a cluster trial"
    assert (
        len(
            merge_and_dedupe(
                [[ScholarlyWork(title=t, year=2021, doi="10.1/a")], [ScholarlyWork(title=t, year=2021, pmid="9")]]
            )[0]
        )
        == 2
    )
    a, b = ScholarlyWork(title=t, year=2021, doi="10.1/x"), ScholarlyWork(title=t, year=2021, pmid="123")
    bridge = ScholarlyWork(title=t, year=2021, doi="10.1/x", pmid="123")
    merged, _ = merge_and_dedupe([[a], [b], [bridge]])
    assert len(merged) == 1 and merged[0].doi == "10.1/x" and merged[0].pmid == "123"


# ---------------------------------------------------------------------------- M19 release gate
async def test_ready_reports_schema_not_ready_without_alembic_table(client, monkeypatch):
    from sqlalchemy.exc import ProgrammingError

    from app.api.routes import system

    async def no_table(*args, **kwargs):
        raise ProgrammingError("select", {}, Exception('relation "alembic_version" does not exist'))

    class FakeDB:
        execute = staticmethod(no_table)

        async def rollback(self):
            return None

    with pytest.raises(system.SchemaNotReady):
        await system.ready(FakeDB())  # type: ignore[arg-type]


def test_release_script_is_fail_fast_and_promotes_the_checked_revision():
    script = (Path(__file__).parents[2] / "deploy" / "release.sh").read_text(encoding="utf-8")
    assert "set -euo pipefail" in script and '--to-revisions "$REVISION=100"' in script
    assert "--to-latest" not in script and 'body.get("schema") != expected' in script


# ---------------------------------------------------------------------------- L24 storage stream ownership
async def test_gcs_stream_closes_its_client_when_opening_fails(monkeypatch):
    from app.services import storage as storage_module

    closed = {"n": 0}
    real_aclose = httpx.AsyncClient.aclose

    async def counting_aclose(self):
        closed["n"] += 1
        await real_aclose(self)

    monkeypatch.setattr(httpx.AsyncClient, "aclose", counting_aclose)
    gcs = object.__new__(storage_module.GCSStorage)
    gcs.bucket = "b"

    async def token():
        return "t"

    gcs._token = token
    with respx.mock() as router:
        router.get(url__startswith="https://storage.googleapis.com/").mock(side_effect=httpx.ConnectError("down"))
        with pytest.raises(httpx.ConnectError):
            await gcs.open_stream("papers/x.pdf")
    assert closed["n"] == 1
    with respx.mock() as router:
        router.get(url__startswith="https://storage.googleapis.com/").mock(
            return_value=httpx.Response(200, content=b"%PDF-1")
        )
        stream = await gcs.open_stream("papers/x.pdf")
        await stream.aclose()  # e.g. the client disconnected before reading
        await stream.aclose()  # idempotent
    assert closed["n"] == 2


# ---------------------------------------------------------------------------- migration repairs on existing rows
async def test_migration_repairs_rows_created_under_earlier_policies(monkeypatch):
    from alembic import command
    from alembic.config import Config

    base = conftest._base_uri
    name = "paperaid_migration_check"
    with psycopg.connect(f"{base}/postgres", autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{name}"')
    url = f"{base}/{name}"
    settings = get_settings()
    monkeypatch.setattr(settings, "database_url", "postgresql+psycopg://" + url.split("://", 1)[1])
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    await asyncio.to_thread(command.upgrade, cfg, "a1c4e9f2b7d3")
    alice, admin, private, public, convo = (uuid.uuid4() for _ in range(5))
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO users (id, firebase_uid, email, role, email_verified, is_active) VALUES "
            "(%s,'a','a@x.edu','user',true,true), (%s,'r','r@x.edu','admin',true,true)",
            (alice, admin),
        )
        conn.execute(
            "INSERT INTO papers (id, title, visibility, source, owner_id, status, work_type, is_open_access,"
            " citation_count, keywords) VALUES (%s,'Private','private','upload',%s,'ready','article',false,0,'{}'),"
            " (%s,'Public from file','public','import_file',NULL,'metadata_only','article',false,0,'{}')",
            (private, alice, public),
        )
        conn.execute(
            "INSERT INTO library_items (id, user_id, paper_id, tags) VALUES (%s,%s,%s,'{}')",
            (uuid.uuid4(), admin, private),
        )
        conn.execute(
            "INSERT INTO processing_jobs (id, paper_id, kind, status, attempts, created_at) VALUES "
            "(%s,%s,'ingest_pdf','queued',0, now() - interval '2 hours')",
            (uuid.uuid4(), public),
        )
        conn.execute(
            "INSERT INTO conversations (id, user_id, title, paper_ids) VALUES (%s,%s,'t',ARRAY[%s]::uuid[])",
            (convo, admin, private),
        )
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, citations, created_at) VALUES "
            "(%s,%s,'user','q','[]','2026-01-01'), (%s,%s,'assistant','secret answer',%s,'2026-01-01')",
            (uuid.uuid4(), convo, uuid.uuid4(), convo, json.dumps([{"paper_id": str(private)}])),
        )
    await asyncio.to_thread(command.upgrade, cfg, "head")
    with psycopg.connect(url, autocommit=True) as conn:
        assert conn.execute("SELECT count(*) FROM library_items").fetchone()[0] == 0
        assert conn.execute("SELECT lease_expires_at IS NOT NULL FROM processing_jobs").fetchone()[0] is True
        assert conn.execute("SELECT metadata_source FROM papers WHERE id=%s", (public,)).fetchone()[0] == "unverified"
        (content,) = conn.execute("SELECT content FROM messages WHERE role='assistant'").fetchone()
        assert "secret" not in content
        assert conn.execute("SELECT paper_ids FROM conversations").fetchone()[0] == []
        turns = conn.execute("SELECT role, turn_index FROM messages ORDER BY turn_index, role").fetchall()
        assert turns == [("user", 0), ("assistant", 0)]
    with psycopg.connect(f"{base}/postgres", autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


def test_unused_imports_guard():
    assert zipfile and BOB and auth
