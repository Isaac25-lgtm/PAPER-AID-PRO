"""Regression tests for docs/PAPERAID_V2_HARDENING_AUDIT.md (backend): uploads fenced against account closure,
export recovery from database-level render failures, ambiguous dispatch statuses, evidence scope, concurrent first
citations of a source, and PDF filtering before paging."""

from __future__ import annotations

import asyncio
import io
import json
import uuid
import zipfile

import httpx
import respx
from sqlalchemy import select, text

from app.config import get_settings
from app.db.models import ClosedAccount, DocumentSource, Paper, StorageDeletion, User
from app.db.session import get_sessionmaker
from app.services import accounts, processing, tasks
from app.services.ai.providers import set_llm
from tests.conftest import ALICE, STUDY_SECTIONS, make_pdf
from tests.test_ai import FakeLLM, answer, claim, results_evidence_key, upload_study


async def upload(client, title, headers=ALICE):
    response = await client.post(
        "/api/v1/papers/upload",
        headers=headers,
        data={"title": title},
        files={"file": (f"{title}.pdf", make_pdf(STUDY_SECTIONS, title=title), "application/pdf")},
    )
    return response


# ------------------------------------------------------------------ H3: closure cannot miss an in-flight upload
async def test_an_upload_racing_account_closure_never_leaves_an_orphaned_file(client, monkeypatch):
    await upload(client, "Earlier paper")  # the account exists with one file
    real_put = processing.put_pdf
    written: list[str] = []

    async def put_then_close(paper_id, data):
        key, digest = await real_put(paper_id, data)
        written.append(key)
        # The upload passed authentication and wrote its object; now the person closes their account.
        async with get_sessionmaker()() as db:
            user = (await db.execute(select(User).where(User.firebase_uid == "alice"))).scalar_one()
            await accounts.close_account(db, user)
        return key, digest

    monkeypatch.setattr(processing, "put_pdf", put_then_close)
    response = await upload(client, "Racing upload")
    assert response.status_code == 403
    async with get_sessionmaker()() as db:
        assert (await db.execute(select(Paper).where(Paper.title == "Racing upload"))).first() is None
        queued = {d.key for d in (await db.execute(select(StorageDeletion))).scalars()}
        assert written[0] in queued  # the racing object is scheduled for deletion, not orphaned
        assert (await db.get(ClosedAccount, "alice")).completed_at is not None


# ------------------------------------------------------------------ M7: export survives a database-level failure
async def test_export_survives_a_failed_statement_while_rendering(client, monkeypatch):
    first = (await client.post("/api/v1/documents", json={"title": "Fails in SQL"}, headers=ALICE)).json()
    second = (await client.post("/api/v1/documents", json={"title": "Plain document"}, headers=ALICE)).json()
    import app.services.documents as documents_service

    real = documents_service.render_citations

    async def failing_in_sql(db, doc, user, **kwargs):
        if doc.title == "Fails in SQL":
            await db.execute(text("SELECT * FROM no_such_table"))  # aborts that session's transaction
        return await real(db, doc, user, **kwargs)

    monkeypatch.setattr(documents_service, "render_citations", failing_in_sql)
    response = await client.get("/api/v1/me/export", headers=ALICE)
    assert response.status_code == 200, response.text
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = archive.namelist()
    assert f"documents/{second['id']}.docx" in names  # later members are still produced
    missing = json.loads(archive.read("manifest.json"))["missing"]
    assert [m["file"] for m in missing] == [f"documents/{first['id']}.docx"]


# ------------------------------------------------------------------ M8: ambiguous provider statuses
def _cloud_tasks_settings(monkeypatch):
    settings = get_settings()
    for name, value in {
        "tasks_backend": "cloud_tasks",
        "tasks_project": "p",
        "tasks_location": "l",
        "tasks_queue": "q",
        "tasks_target_url": "https://api.example",
        "tasks_service_account": "sa@example",
    }.items():
        monkeypatch.setattr(settings, name, value)

    async def token():
        return "t"

    monkeypatch.setattr(tasks, "_cloud_tasks_token", token)


async def test_deadline_and_server_errors_are_uncertain_but_client_errors_are_rejections(monkeypatch):
    _cloud_tasks_settings(monkeypatch)
    cases = [
        (httpx.Response(504, json={"error": {"status": "DEADLINE_EXCEEDED"}}), tasks.DispatchUncertain),
        (httpx.Response(503, json={"error": {"status": "UNAVAILABLE"}}), tasks.DispatchUncertain),
        (httpx.Response(500, text="oops"), tasks.DispatchUncertain),
        (httpx.Response(400, json={"error": {"status": "INVALID_ARGUMENT"}}), tasks.DispatchRejected),
        (httpx.Response(403, json={"error": {"status": "PERMISSION_DENIED"}}), tasks.DispatchRejected),
    ]
    for reply, expected in cases:
        with respx.mock() as router:
            router.post(url__startswith="https://cloudtasks.googleapis.com/").mock(return_value=reply)
            try:
                await tasks.enqueue_job(uuid.uuid4())
            except Exception as exc:
                assert type(exc) is expected, (reply.status_code, type(exc))
            else:
                raise AssertionError(f"{reply.status_code} should raise")


# ------------------------------------------------------------------ M9: scope reports evidence actually used
async def test_check_scope_separates_selected_sources_from_sources_in_the_evidence(client):
    with_text = await upload_study(client)
    bare = (
        await client.post(
            "/api/v1/papers/manual",
            headers=ALICE,
            json={"type": "report", "title": "A report with no abstract or text", "authors": [], "year": 2020},
        )
    ).json()
    doc = (await client.post("/api/v1/documents", json={}, headers=ALICE)).json()
    for paper in (with_text, bare):
        await client.post(f"/api/v1/documents/{doc['id']}/citations", headers=ALICE, json={"paper_id": paper["id"]})
    set_llm(FakeLLM(lambda p: answer(claim("Incidence was 31 percent lower.", ids=[results_evidence_key(p)]))))
    scope = (
        await client.post(f"/api/v1/documents/{doc['id']}/check", headers=ALICE, json={"text": "Incidence fell."})
    ).json()["scope"]
    flags = {s["id"]: s["in_evidence"] for s in scope["sources"]}
    assert flags == {with_text["id"]: True, bare["id"]: False}
    assert scope["selected"] == 2 and scope["in_evidence"] == 1


# ------------------------------------------------------------------ M11: concurrent first citations of a source
async def test_two_simultaneous_first_citations_of_a_source_both_succeed(client):
    paper = (await upload(client, "Shared source")).json()
    doc = (await client.post("/api/v1/documents", json={}, headers=ALICE)).json()
    responses = await asyncio.gather(
        *(
            client.post(
                f"/api/v1/documents/{doc['id']}/citations",
                headers=ALICE,
                json={"paper_id": paper["id"], "locator": page},
            )
            for page in ("3", "7")
        )
    )
    assert [r.status_code for r in responses] == [201, 201]
    async with get_sessionmaker()() as db:
        links = (
            await db.execute(select(DocumentSource).where(DocumentSource.document_id == uuid.UUID(doc["id"])))
        ).all()
    assert len(links) == 1


# ------------------------------------------------------------------ L12: PDFs filtered before paging
async def test_library_can_list_only_papers_with_a_stored_pdf(client):
    older = (await upload(client, "Older uploaded PDF")).json()
    for i in range(3):
        await client.post(
            "/api/v1/papers/manual", headers=ALICE, json={"type": "report", "title": f"Newer entry {i}", "authors": []}
        )
    page = (await client.get("/api/v1/library", headers=ALICE, params={"limit": 2, "has_pdf": "true"})).json()
    assert [item["paper"]["id"] for item in page] == [older["id"]]
