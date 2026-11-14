"""Regression tests for the findings of docs/PAPERAID_V2_AUDIT.md (one section per finding)."""

from __future__ import annotations

import asyncio
import io
import re
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from docx import Document as DocxDocument
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from app.db.models import (
    JobKind,
    JobStatus,
    Paper,
    PaperStatus,
    ProcessingJob,
    StorageDeletion,
    User,
    UserRole,
)
from app.db.session import get_sessionmaker
from app.errors import UpstreamError
from app.services import processing
from app.services.ai.providers import set_embedder
from app.services.citations.verify import _assess
from app.services.scholarly.aggregator import merge_and_dedupe
from app.services.scholarly.models import ScholarlyWork, WorkAuthor
from app.services.storage import LocalStorage, get_storage, set_storage
from tests import fixtures as fx
from tests.conftest import ADMIN, ALICE, BOB, STUDY_SECTIONS, auth, import_doi, make_pdf

BIBTEX_DISAGREEING = r"""
@article{tampered,
  title = {A completely different and false title},
  author = {Impostor, Ivan},
  abstract = {Fabricated abstract text that must never become public.},
  journal = {Fake Journal},
  year = {1999},
  doi = {10.1186/s12936-021-03812-x}
}
@article{unknown,
  title = {Paper with a DOI that no registry knows},
  author = {Kato, Ruth},
  year = {2020},
  doi = {10.9999/not-registered}
}
"""


async def upload(client, title: str, headers=ALICE, pdf: bytes | None = None) -> dict:
    response = await client.post(
        "/api/v1/papers/upload",
        headers=headers,
        data={"title": title},
        files={"file": ("p.pdf", pdf or make_pdf(STUDY_SECTIONS, title=title), "application/pdf")},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def settings(monkeypatch):
    s = get_settings()

    def set_(**values):
        for key, value in values.items():
            monkeypatch.setattr(s, key, value)

    return set_


# ------------------------------------------------------------------------- 1. identity binding by Firebase UID
async def test_new_firebase_identity_with_existing_email_cannot_take_over_account(client):
    private = await upload(client, "Alice private notes")
    other_identity = auth("attacker-uid", "alice@example.edu", verified=False)
    me = await client.get("/api/v1/me", headers=other_identity)
    assert me.status_code == 409 and me.json()["error"]["code"] == "ACCOUNT_CONFLICT"
    assert (await client.get(f"/api/v1/papers/{private['id']}", headers=other_identity)).status_code == 409
    async with get_sessionmaker()() as db:
        user = (await db.execute(select(User).where(User.email == "alice@example.edu"))).scalar_one()
        assert user.firebase_uid == "alice"  # unchanged
    assert (await client.get(f"/api/v1/papers/{private['id']}", headers=ALICE)).status_code == 200


async def test_admin_role_is_not_inherited_through_email(client):
    await client.get("/api/v1/me", headers=ADMIN)
    response = await client.get("/api/v1/admin/stats", headers=auth("new-uid", "admin@example.edu"))
    assert response.status_code == 409


# ------------------------------------------------------------------- 2. reference files never write public data
async def test_reference_import_uses_registry_metadata_and_keeps_unknown_dois_private(client, registries):
    response = await client.post(
        "/api/v1/library/import",
        headers=ALICE,
        files={"file": ("refs.bib", BIBTEX_DISAGREEING.encode(), "application/x-bibtex")},
    )
    assert response.json() == {"imported": 2, "skipped": 0, "errors": []}
    items = {i["paper"]["doi"]: i["paper"] for i in (await client.get("/api/v1/library", headers=ALICE)).json()}
    public = items[fx.DOI]
    assert public["visibility"] == "public"
    assert public["title"].startswith("School-based malaria prevention")  # registry title, not the file's
    assert public["authors"][0] == "Grace Namaganda" and public["year"] == 2021
    assert "Fabricated" not in (public["abstract"] or "")
    unknown = items["10.9999/not-registered"]
    assert unknown["visibility"] == "private" and unknown["is_owner"]
    assert (await client.get(f"/api/v1/papers/{unknown['id']}", headers=BOB)).status_code == 404


# --------------------------------------------------------------------------------- 4. concurrent saves
async def test_concurrent_saves_from_the_same_version_cannot_both_succeed(client):
    for attempt in range(3):
        doc = (await client.post("/api/v1/documents", json={"title": f"Race {attempt}"}, headers=ALICE)).json()

        def body(text):
            return {
                "base_version": 1,
                "content": {
                    "type": "doc",
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
                },
            }

        first, second = await asyncio.gather(
            client.patch(f"/api/v1/documents/{doc['id']}", json=body("tab A"), headers=ALICE),
            client.patch(f"/api/v1/documents/{doc['id']}", json=body("tab B"), headers=ALICE),
        )
        assert sorted([first.status_code, second.status_code]) == [200, 409]
        final = (await client.get(f"/api/v1/documents/{doc['id']}", headers=ALICE)).json()
        assert final["version"] == 2


async def test_restore_with_a_stale_version_is_rejected(client):
    doc = (await client.post("/api/v1/documents", json={"title": "R"}, headers=ALICE)).json()
    saved = (
        await client.patch(
            f"/api/v1/documents/{doc['id']}", json={"base_version": 1, "title": "R2", "checkpoint": True}, headers=ALICE
        )
    ).json()
    revision = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=ALICE)).json()[-1]
    stale = await client.post(
        f"/api/v1/documents/{doc['id']}/revisions/{revision['id']}/restore", json={"base_version": 1}, headers=ALICE
    )
    assert stale.status_code == 409
    fresh = await client.post(
        f"/api/v1/documents/{doc['id']}/revisions/{revision['id']}/restore",
        json={"base_version": saved["version"]},
        headers=ALICE,
    )
    assert fresh.status_code == 200 and fresh.json()["title"] == "R"


# ------------------------------------------------------------------------------- 5. job state machine
async def test_dispatch_failure_does_not_leave_a_stuck_queued_job(client, monkeypatch):
    paper = await upload(client, "Dispatch study")

    async def broken_enqueue(job_id):
        raise UpstreamError("Could not queue the processing job. Please retry.")

    monkeypatch.setattr(processing, "enqueue_job", broken_enqueue)
    failed = await client.post(f"/api/v1/papers/{paper['id']}/full-text", headers=ALICE)
    assert failed.status_code == 502
    jobs = (await client.get(f"/api/v1/papers/{paper['id']}/jobs", headers=ALICE)).json()
    assert jobs[0]["status"] == "failed"
    assert (await client.get(f"/api/v1/papers/{paper['id']}", headers=ALICE)).json()["status"] == "ready"
    monkeypatch.undo()
    retried = await client.post(f"/api/v1/papers/{paper['id']}/full-text", headers=ALICE)
    assert retried.status_code == 202 and retried.json()["status"] == "succeeded"


async def test_abandoned_running_job_is_reclaimed(client):
    paper = await upload(client, "Worker loss study")
    async with get_sessionmaker()() as db:
        stuck = ProcessingJob(
            paper_id=uuid.UUID(paper["id"]),
            kind=JobKind.INGEST_PDF,
            status=JobStatus.RUNNING,
            attempts=1,
            lease_expires_at=datetime.now(UTC) + timedelta(minutes=5),
        )
        db.add(stuck)
        await db.commit()
        stuck_id = stuck.id
    # While the lease is live, a second job is refused.
    assert (await client.post(f"/api/v1/papers/{paper['id']}/full-text", headers=ALICE)).status_code == 409
    async with get_sessionmaker()() as db:
        job = await db.get(ProcessingJob, stuck_id)
        job.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)  # the worker died
        await db.commit()
    retried = await client.post(f"/api/v1/papers/{paper['id']}/full-text", headers=ALICE)
    assert retried.status_code == 202 and retried.json()["status"] == "succeeded"
    async with get_sessionmaker()() as db:
        old = await db.get(ProcessingJob, stuck_id)
        assert old.status == JobStatus.FAILED and "interrupted" in old.error


async def test_database_allows_only_one_active_job_per_paper(client):
    paper = await upload(client, "Unique job study")
    async with get_sessionmaker()() as db:
        for _ in range(2):
            db.add(ProcessingJob(paper_id=uuid.UUID(paper["id"]), kind=JobKind.INGEST_PDF, status=JobStatus.QUEUED))
        with pytest.raises(IntegrityError):
            await db.commit()


async def test_duplicate_delivery_is_skipped(client):
    paper = await upload(client, "Duplicate delivery study")
    job_id = (await client.get(f"/api/v1/papers/{paper['id']}/jobs", headers=ALICE)).json()[0]["id"]
    assert await processing.run_job(uuid.UUID(job_id)) == processing.Outcome.SKIPPED


async def test_transient_errors_are_retried_and_capped(client, monkeypatch):
    real_ingest = processing._ingest
    calls = {"n": 0}

    async def flaky(db, paper, attempt):
        calls["n"] += 1
        if calls["n"] == 1:
            raise UpstreamError("Storage download failed (HTTP 503).")
        await real_ingest(db, paper, attempt)

    monkeypatch.setattr(processing, "_ingest", flaky)
    paper = await upload(client, "Flaky study")
    job = (await client.get(f"/api/v1/papers/{paper['id']}/jobs", headers=ALICE)).json()[0]
    assert job["status"] == "succeeded" and job["attempts"] == 2

    async def always_down(db, paper, attempt):
        raise UpstreamError("Storage download failed (HTTP 503).")

    monkeypatch.setattr(processing, "_ingest", always_down)
    response = await client.post(f"/api/v1/papers/{paper['id']}/full-text", headers=ALICE)
    assert response.json()["status"] == "failed" and response.json()["attempts"] == processing.MAX_ATTEMPTS


async def test_terminal_errors_are_not_retried(client, monkeypatch):
    from app.errors import ValidationFailed

    async def scanned(db, paper, attempt):
        raise ValidationFailed("This PDF has no extractable text.")

    monkeypatch.setattr(processing, "_ingest", scanned)
    paper = await upload(client, "Scanned study")
    job = (await client.get(f"/api/v1/papers/{paper['id']}/jobs", headers=ALICE)).json()[0]
    assert job["status"] == "failed" and job["attempts"] == 1


async def test_internal_endpoint_asks_cloud_tasks_to_retry_transient_failures(client, monkeypatch):
    from app.api.routes import admin as admin_routes

    monkeypatch.setattr(admin_routes, "verify_task_request", lambda authorization: None)

    async def retry(job_id):
        return processing.Outcome.RETRY

    monkeypatch.setattr(processing, "run_job", retry)
    response = await client.post("/internal/tasks/run-job", json={"job_id": str(uuid.uuid4())})
    assert response.status_code == 503


# --------------------------------------------------------------------- 6. export keeps citations in place
async def test_export_never_moves_a_citation_onto_another_claim(client):
    first = await upload(client, "Alpha trial of nets")
    second = await upload(client, "Beta trial of nets")
    doc = (await client.post("/api/v1/documents", json={"title": "Export"}, headers=ALICE)).json()
    cites = []
    for paper in (first, second):
        cites.append(
            (
                await client.post(
                    f"/api/v1/documents/{doc['id']}/citations", json={"paper_id": paper["id"]}, headers=ALICE
                )
            ).json()["id"]
        )
    content = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "Claim one "},
                    {"type": "citation", "attrs": {"citationIds": [cites[0]]}},
                ],
            },
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "Claim two "},
                    {"type": "citation", "attrs": {"citationIds": [cites[1]]}},
                ],
            },
        ],
    }
    await client.patch(f"/api/v1/documents/{doc['id']}", json={"base_version": 1, "content": content}, headers=ALICE)
    assert (await client.delete(f"/api/v1/papers/{first['id']}", headers=ALICE)).status_code == 204
    rendered = (await client.get(f"/api/v1/documents/{doc['id']}/rendered-citations", headers=ALICE)).json()
    assert rendered["clusters"][0]["text"] is None and rendered["clusters"][0]["missing_ids"] == [cites[0]]
    assert "Beta" in rendered["clusters"][1]["text"]
    exported = await client.get(f"/api/v1/documents/{doc['id']}/export", params={"format": "docx"}, headers=ALICE)
    paragraphs = [p.text for p in DocxDocument(io.BytesIO(exported.content)).paragraphs]
    claim_one = next(p for p in paragraphs if p.startswith("Claim one"))
    claim_two = next(p for p in paragraphs if p.startswith("Claim two"))
    assert "[missing source]" in claim_one and "Beta" not in claim_one
    assert "Beta" in claim_two and "[missing source]" not in claim_two
    pdf = await client.get(f"/api/v1/documents/{doc['id']}/export", params={"format": "pdf"}, headers=ALICE)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")


# ------------------------------------------------------------------ 7. admins get no private-paper bypass
async def test_admins_cannot_read_private_papers_through_user_routes(client):
    private = await upload(client, "Alice confidential draft")
    await client.get("/api/v1/me", headers=ADMIN)
    for path in ("", "/pdf", "/passages", "/cite"):
        assert (await client.get(f"/api/v1/papers/{private['id']}{path}", headers=ADMIN)).status_code == 404, path
    catalog = (await client.get("/api/v1/papers", headers=ADMIN)).json()
    assert private["id"] not in {p["id"] for p in catalog["items"]}
    research = await client.post(
        "/api/v1/research/ask", json={"question": "What is in it?", "paper_ids": [private["id"]]}, headers=ADMIN
    )
    assert research.status_code == 422  # none of the selected papers are visible
    # Moderation still works through the audited admin endpoint.
    assert (await client.delete(f"/api/v1/admin/papers/{private['id']}", headers=ADMIN)).status_code == 204


# ------------------------------------------------------------------------- 8. demotion is not undone
async def test_bootstrap_admin_demotion_persists(client, settings):
    settings(admin_emails="admin@example.edu,boss@example.edu")
    boss = auth("boss", "boss@example.edu")
    assert (await client.get("/api/v1/me", headers=boss)).json()["role"] == "admin"
    boss_id = (await client.get("/api/v1/me", headers=boss)).json()["id"]
    await client.get("/api/v1/me", headers=ADMIN)
    demoted = await client.patch(f"/api/v1/admin/users/{boss_id}", json={"role": "user"}, headers=ADMIN)
    assert demoted.status_code == 200
    for _ in range(2):
        assert (await client.get("/api/v1/me", headers=boss)).json()["role"] == "user"
    assert (await client.get("/api/v1/admin/stats", headers=boss)).status_code == 403


# ------------------------------------------------------- 9. public routes respect invite + verification
async def test_removed_tester_loses_private_access_on_public_routes(client, settings):
    settings(allowed_emails="alice@example.edu")
    private = await upload(client, "Tester data")
    assert (await client.get(f"/api/v1/papers/{private['id']}", headers=ALICE)).status_code == 200
    settings(allowed_emails="someone-else@example.edu")
    for path in ("", "/passages", "/cite", "/jobs"):
        assert (await client.get(f"/api/v1/papers/{private['id']}{path}", headers=ALICE)).status_code == 404, path
    assert (await client.get("/api/v1/me", headers=ALICE)).json()["error"]["code"] == "NOT_INVITED"


async def test_unverified_account_gets_only_public_data(client):
    private = await upload(client, "Verified-only data")
    unverified_alice = auth("alice", "alice@example.edu", verified=False)
    assert (await client.get(f"/api/v1/papers/{private['id']}", headers=unverified_alice)).status_code == 404


# ------------------------------------------------------------------------- 10. React cache (frontend tests)
# ------------------------------------------------------------------------- 11. per-caller rate limits
async def test_anonymous_limits_are_per_caller_and_spoof_resistant(client, registries, settings):
    settings(trust_forwarded_for=True, rate_limit_search_per_min=1)

    async def search(xff):
        return await client.get("/api/v1/discovery/search", params={"q": "malaria"}, headers={"X-Forwarded-For": xff})

    assert (await search("1.1.1.1")).status_code == 200
    assert (await search("1.1.1.1")).status_code == 429
    assert (await search("2.2.2.2")).status_code == 200  # another caller is unaffected
    assert (await search("9.9.9.9, 1.1.1.1")).status_code == 429  # a forged first hop does not help


async def test_duplicate_providers_are_queried_once(client, registries, monkeypatch):
    from app.services.scholarly.providers import PROVIDERS

    calls = []
    real_search = PROVIDERS["openalex"].search

    async def counting(*args, **kwargs):
        calls.append(args)
        return await real_search(*args, **kwargs)

    monkeypatch.setattr(PROVIDERS["openalex"], "search", counting)
    response = await client.get(
        "/api/v1/discovery/search",
        params=[("q", "malaria"), ("providers", "openalex"), ("providers", "openalex"), ("providers", "openalex")],
    )
    assert response.status_code == 200
    assert len(calls) == 1
    assert [p["provider"] for p in response.json()["providers"]] == ["openalex"]


# ------------------------------------------------------------------------- 13. discovery dedupe
def _work(title, year=2021, doi=None, author="Okello"):
    return ScholarlyWork(title=title, year=year, doi=doi, authors=[WorkAuthor(name=f"P {author}", family=author)])


def test_same_title_and_year_with_different_dois_are_distinct():
    title = "Malaria prevention in primary schools: a cluster randomised trial"
    merged, _ = merge_and_dedupe([[_work(title, doi="10.1/a")], [_work(title, doi="10.1/b")]])
    assert sorted(w.doi for w in merged) == ["10.1/a", "10.1/b"]


def test_title_matching_is_unicode_aware_and_needs_agreeing_authors():
    merged, _ = merge_and_dedupe(
        [
            [_work("Étude du paludisme chez les enfants scolarisés")],
            [_work("Etude du paludisme chez les enfants scolarises")],
        ]
    )
    assert len(merged) == 1
    merged, _ = merge_and_dedupe(
        [[_work("疟疾预防在学校中的随机对照试验研究报告")], [_work("结核病筛查在社区中的横断面调查研究报告")]]
    )
    assert len(merged) == 2
    merged, _ = merge_and_dedupe(
        [
            [_work("Malaria prevention in primary schools: a review", author="Okello")],
            [_work("Malaria prevention in primary schools: a review", author="Smith")],
        ]
    )
    assert len(merged) == 2


# ------------------------------------------------------------------------- 14. verification verdicts
def test_missing_year_is_not_reported_as_verified():
    work = _work("School-based malaria prevention with insecticide-treated nets", author="Namaganda")
    result = _assess(
        "Namaganda G. School-based malaria prevention with insecticide-treated nets. Malaria J.", work, via_doi=False
    )
    assert result["verdict"] == "likely_match" and result["checks"]["fields"]["year"] == "not checked"


def test_surname_appearing_only_in_the_title_or_journal_does_not_match_the_author():
    work = _work("Malaria prevention in schools of Kenya", author="Okello")
    result = _assess(
        "Smith J. Malaria prevention in schools of Kenya. Okello Medical Journal. 2021.", work, via_doi=False
    )
    assert result["checks"]["first_author_matches"] is False and result["verdict"] != "verified"
    ok = _assess("Okello P. Malaria prevention in schools of Kenya. East Afr Med J. 2021.", work, via_doi=False)
    assert ok["verdict"] == "verified"


# ------------------------------------------------------------------------- 15. Unicode downloads
async def test_non_latin_titles_download(client):
    paper = await upload(client, "疟疾预防研究", pdf=make_pdf(STUDY_SECTIONS))
    pdf = await client.get(f"/api/v1/papers/{paper['id']}/pdf", headers=ALICE)
    assert pdf.status_code == 200
    assert "filename*=UTF-8''%E7%96%9F" in pdf.headers["content-disposition"]
    doc = (await client.post("/api/v1/documents", json={"title": "Обзор малярии"}, headers=ALICE)).json()
    for fmt in ("docx", "pdf"):
        exported = await client.get(f"/api/v1/documents/{doc['id']}/export", params={"format": fmt}, headers=ALICE)
        assert exported.status_code == 200, fmt
        assert "filename*=UTF-8''" in exported.headers["content-disposition"]
    # Scripts the PDF fonts cannot draw get a clear 422 pointing to Word export, never a 500.
    cjk = (await client.post("/api/v1/documents", json={"title": "疟疾预防研究"}, headers=ALICE)).json()
    word = await client.get(f"/api/v1/documents/{cjk['id']}/export", params={"format": "docx"}, headers=ALICE)
    assert word.status_code == 200
    pdf_export = await client.get(f"/api/v1/documents/{cjk['id']}/export", params={"format": "pdf"}, headers=ALICE)
    assert pdf_export.status_code in {200, 422}
    if pdf_export.status_code == 422:
        assert pdf_export.json()["error"]["code"] == "PDF_UNSUPPORTED_CHARACTERS"


# ------------------------------------------------------------------------- 16. malformed editor trees
async def test_malformed_editor_trees_are_normalised_or_rejected_never_500(client):
    weird = {
        "type": "doc",
        "content": [
            {"type": "heading", "attrs": {"level": "abc"}, "content": [{"type": "text", "text": "H"}]},
            {"type": "paragraph", "attrs": ["not", "a", "dict"], "content": "not a list"},
            {"type": "text", "text": "loose text at block level"},
            {"type": "bulletList", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "item"}]}]},
            {"type": "table", "content": [{"type": "tableRow", "content": [{"type": "paragraph"}]}]},
            {"type": "paragraph", "content": [{"type": "heading", "content": [{"type": "text", "text": "x"}]}]},
            {"type": "codeBlock", "content": [{"type": "text", "text": "y", "marks": [{"type": "bold"}]}]},
            "garbage",
        ],
    }
    created = await client.post("/api/v1/documents", json={"content": weird}, headers=ALICE)
    assert created.status_code == 201, created.text
    blocks = created.json()["content"]["content"]
    assert blocks[0] == {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "H"}]}
    assert blocks[1] == {"type": "paragraph"}
    assert blocks[2]["content"][0]["text"] == "loose text at block level"
    assert blocks[3]["content"][0]["type"] == "listItem"
    assert blocks[4]["content"][0]["content"][0]["type"] == "tableCell"
    assert blocks[5]["content"] == [{"type": "text", "text": "x"}]
    assert blocks[6]["content"] == [{"type": "text", "text": "y"}]
    doc_id = created.json()["id"]
    for attempt in range(2):  # every format still exports
        assert (
            await client.get(
                f"/api/v1/documents/{doc_id}/export", params={"format": ("docx", "pdf")[attempt]}, headers=ALICE
            )
        ).status_code == 200

    deep: dict = {"type": "text", "text": "deep"}
    for _ in range(100):
        deep = {"type": "blockquote", "content": [deep]}
    rejected = await client.patch(
        f"/api/v1/documents/{doc_id}",
        json={"base_version": 1, "content": {"type": "doc", "content": [deep]}},
        headers=ALICE,
    )
    assert rejected.status_code == 422
    assert (await client.get(f"/api/v1/documents/{doc_id}", headers=ALICE)).json()["version"] == 1


# ------------------------------------------------------------------------- 17. storage/DB boundary
class FlakyStorage(LocalStorage):
    def __init__(self, root, *, fail_put=False, fail_delete=False):
        super().__init__(root)
        self.fail_put, self.fail_delete = fail_put, fail_delete

    async def put(self, key, data, content_type):
        if self.fail_put:
            raise UpstreamError("Storage upload failed (HTTP 503).")
        await super().put(key, data, content_type)

    async def delete(self, key):
        if self.fail_delete:
            raise UpstreamError("Storage delete failed (HTTP 503).")
        await super().delete(key)


async def test_failed_object_delete_is_retried_by_maintenance(client):
    from app.services.maintenance import process_deletions

    paper = await upload(client, "To be deleted")
    async with get_sessionmaker()() as db:
        key = (await db.get(Paper, uuid.UUID(paper["id"]))).storage_path
    original = get_storage()
    flaky = FlakyStorage(original.root, fail_delete=True)
    set_storage(flaky)
    try:
        assert (await client.delete(f"/api/v1/papers/{paper['id']}", headers=ALICE)).status_code == 204
        async with get_sessionmaker()() as db:
            pending = await db.get(StorageDeletion, key)
            assert pending is not None and pending.attempts == 1 and "503" in pending.last_error
        assert (original.root / key).exists()
        flaky.fail_delete = False
        async with get_sessionmaker()() as db:
            assert await process_deletions(db, keys=[key]) == 0  # backing off after the failure
            row = await db.get(StorageDeletion, key)
            row.not_before = row.created_at  # backoff elapsed
            await db.commit()
            assert await process_deletions(db) == 1
            assert await db.get(StorageDeletion, key) is None
        assert not (original.root / key).exists()
    finally:
        set_storage(original)


async def test_failed_upload_leaves_no_paper(client):
    original = get_storage()
    set_storage(FlakyStorage(original.root, fail_put=True))
    try:
        response = await client.post(
            "/api/v1/papers/upload",
            headers=ALICE,
            data={"title": "Doomed"},
            files={"file": ("p.pdf", make_pdf(STUDY_SECTIONS), "application/pdf")},
        )
        assert response.status_code == 502
    finally:
        set_storage(original)
    async with get_sessionmaker()() as db:
        assert (await db.execute(select(Paper).where(Paper.title == "Doomed"))).first() is None


async def test_admin_maintenance_endpoint(client):
    response = await client.post("/api/v1/admin/maintenance", headers=ADMIN)
    assert response.status_code == 200
    assert set(response.json()) == {"storage_objects_deleted", "rate_buckets_purged", "jobs_reclaimed"}


# ------------------------------------------------------------------------- 19. relevance before pagination
async def test_relevance_sort_ranks_before_paginating(client):
    best = await upload(client, "Malaria malaria malaria bed nets")
    for title in ("Malaria survey in clinics", "Malaria workshop notes"):
        await upload(client, title)
    page = (
        await client.get("/api/v1/papers", params={"q": "malaria", "sort": "relevance", "page_size": 1}, headers=ALICE)
    ).json()
    assert page["total"] == 3 and page["items"][0]["id"] == best["id"]  # oldest, but most relevant


# ------------------------------------------------------------------------- 21. batch numbering
async def test_batch_formatting_numbers_sources_sequentially(client):
    a = await upload(client, "Alpha trial of nets")
    b = await upload(client, "Beta trial of nets")
    body = (
        await client.post(
            "/api/v1/citations/format",
            json={"paper_ids": [a["id"], b["id"]], "style": "ieee", "output": "text"},
            headers=ALICE,
        )
    ).json()
    assert [e["in_text"] for e in body["entries"]] == ["[1]", "[2]"]
    assert body["entries"][0]["bibliography"].startswith("[1]") and body["entries"][1]["bibliography"].startswith("[2]")


# ------------------------------------------------------------------------- 23. optional embeddings
class FailingEmbedder:
    model = "down-embedder"

    async def embed(self, texts, *, task):
        raise UpstreamError("Embedding provider error (HTTP 429).")


async def test_embedding_outage_keeps_full_text_usable(client):
    set_embedder(FailingEmbedder())
    paper = await upload(client, "Embedding outage study")
    fresh = (await client.get(f"/api/v1/papers/{paper['id']}", headers=ALICE)).json()
    assert fresh["status"] == "ready"
    job = (await client.get(f"/api/v1/papers/{paper['id']}/jobs", headers=ALICE)).json()[0]
    assert job["status"] == "succeeded"
    hits = (
        await client.get(f"/api/v1/papers/{paper['id']}/passages", params={"q": "absenteeism"}, headers=ALICE)
    ).json()
    assert hits and "absenteeism" in hits[0]["text"].lower()


# ------------------------------------------------------------------------- 24. private PDF delivery
async def test_private_pdfs_are_streamed_and_never_cached(client):
    data = make_pdf(STUDY_SECTIONS, title="Streamed")
    paper = await upload(client, "Streamed", pdf=data)
    response = await client.get(f"/api/v1/papers/{paper['id']}/pdf", headers=ALICE)
    assert response.status_code == 200 and response.content == data
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-length"] == str(len(data))


# ------------------------------------------------------------------------- 25. collection membership races
async def test_collection_membership_cannot_outlive_library_entry(client, registries):
    for attempt in range(3):
        paper = await import_doi(client)
        collection = (await client.post("/api/v1/collections", json={"name": f"C{attempt}"}, headers=ALICE)).json()
        await asyncio.gather(
            client.delete(f"/api/v1/library/{paper['id']}", headers=ALICE),
            client.put(f"/api/v1/collections/{collection['id']}/papers/{paper['id']}", headers=ALICE),
        )
        in_library = any(
            i["paper"]["id"] == paper["id"] for i in (await client.get("/api/v1/library", headers=ALICE)).json()
        )
        count = next(
            c for c in (await client.get("/api/v1/collections", headers=ALICE)).json() if c["id"] == collection["id"]
        )["paper_count"]
        assert count == 0 or in_library
        await client.post("/api/v1/library", json={"paper_id": paper["id"]}, headers=ALICE)


# ------------------------------------------------------------------------- 28. release gate
async def test_ready_fails_when_schema_does_not_match(client, monkeypatch):
    from app.api.routes import system

    monkeypatch.setattr(system, "expected_schema_revision", lambda: "not-the-deployed-revision")
    response = await client.get("/api/v1/ready")
    assert response.status_code == 503 and response.json()["error"]["code"] == "SCHEMA_NOT_READY"


# ------------------------------------------------------------------------- 18. account closure
async def test_account_closure_deletes_the_firebase_identity(client, identity_admin):
    import importlib.util
    from pathlib import Path

    await upload(client, "Closure study")
    spec = importlib.util.spec_from_file_location(
        "delete_user_t", Path(__file__).parent.parent / "scripts" / "delete_user.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert await module.run("alice@example.edu", purge_public=False, confirmed=True) == 0
    assert identity_admin.deleted == ["alice"]
    async with get_sessionmaker()() as db:
        assert (await db.execute(select(User).where(User.role == UserRole.USER))).first() is None
        assert (await db.execute(select(Paper).where(Paper.status == PaperStatus.READY))).first() is None
        assert (await db.execute(select(StorageDeletion))).first() is None  # objects removed, nothing pending


def test_content_disposition_has_ascii_fallback():
    from app.api.downloads import content_disposition

    header = content_disposition('Étude "spéciale"/ 研究.pdf')
    assert header.startswith('attachment; filename="Etude speciale .pdf"') or 'filename="' in header
    assert re.search(r"filename\*=UTF-8''[%A-Za-z0-9._-]+$", header)
    header.encode("latin-1")  # must be serialisable as an HTTP header
