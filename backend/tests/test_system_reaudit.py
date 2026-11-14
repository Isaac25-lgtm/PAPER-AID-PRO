"""Regression tests for docs/PAPERAID_V2_SYSTEM_REAUDIT.md: identity deletion outside production, AI cohort and
suggestions switch, account closure completing only after file cleanup, check scope and evidence budget,
claim-level quotes, account export resilience and dispatch outcomes."""

from __future__ import annotations

import io
import json
import uuid
import zipfile
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx
from sqlalchemy import select

from app.config import get_settings
from app.db.models import ClosedAccount, JobStatus, Paper, PaperStatus, ProcessingJob, StorageDeletion, User
from app.db.session import get_sessionmaker
from app.services import accounts, processing, tasks
from app.services.ai.providers import set_llm
from app.services.identity import delete_firebase_account as real_delete_identity  # captured before fixtures stub it
from tests.conftest import ALICE, BOB, STUDY_SECTIONS, make_pdf
from tests.test_ai import FakeLLM, answer, claim, results_evidence_key, upload_study


async def upload(client, title, headers=ALICE):
    response = await client.post(
        "/api/v1/papers/upload",
        headers=headers,
        data={"title": title},
        files={"file": (f"{title}.pdf", make_pdf(STUDY_SECTIONS, title=title), "application/pdf")},
    )
    assert response.status_code == 201, response.text
    return response.json()


# ------------------------------------------------------------------ H3. identity deletion never leaves production
async def test_identity_deletion_is_skipped_outside_production(monkeypatch):
    monkeypatch.delenv("FIREBASE_AUTH_EMULATOR_HOST", raising=False)
    monkeypatch.setattr(get_settings(), "env", "development")
    monkeypatch.setattr(get_settings(), "firebase_project_id", "paperaid")  # even with the production project id
    with respx.mock(assert_all_called=False) as router:
        google = router.post(url__startswith="https://identitytoolkit.googleapis.com/").mock(
            return_value=httpx.Response(200)
        )
        result = await real_delete_identity("uid-1")
    assert result is False and not google.called


async def test_identity_deletion_uses_the_emulator_when_configured(monkeypatch):
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")
    monkeypatch.setattr(get_settings(), "env", "development")
    with respx.mock(assert_all_called=False) as router:
        emulator = router.post(url__startswith="http://127.0.0.1:9099/").mock(return_value=httpx.Response(200, json={}))
        google = router.post(url__startswith="https://identitytoolkit.googleapis.com/").mock(
            return_value=httpx.Response(200)
        )
        assert await real_delete_identity("uid-2") is True
    assert emulator.called and not google.called


# ------------------------------------------------------------------ M5. AI cohort and the suggestions switch
async def test_ai_is_limited_to_the_pilot_cohort(client, monkeypatch):
    paper = await upload_study(client)
    set_llm(FakeLLM(text="Rewritten."))
    monkeypatch.setattr(get_settings(), "ai_access", "pilot")
    monkeypatch.setattr(get_settings(), "ai_pilot_emails", "bob@example.edu")
    refused = await client.post("/api/v1/ai/rewrite", headers=ALICE, json={"text": "some text", "mode": "academic"})
    assert refused.status_code == 403 and refused.json()["error"]["code"] == "AI_NOT_ENABLED_FOR_ACCOUNT"
    asked = await client.post(f"/api/v1/papers/{paper['id']}/ask", headers=ALICE, json={"question": "What happened?"})
    assert asked.status_code == 403
    allowed = await client.post("/api/v1/ai/rewrite", headers=BOB, json={"text": "some text", "mode": "academic"})
    assert allowed.status_code == 200


async def test_status_reports_what_this_account_can_use(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_provider", "anthropic")
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "test-key-not-real")
    monkeypatch.setattr(get_settings(), "ai_access", "pilot")
    monkeypatch.setattr(get_settings(), "ai_pilot_emails", "bob@example.edu")
    monkeypatch.setattr(get_settings(), "ai_autocomplete_enabled", False)
    alice = (await client.get("/api/v1/ai/status", headers=ALICE)).json()
    bob = (await client.get("/api/v1/ai/status", headers=BOB)).json()
    anonymous = (await client.get("/api/v1/ai/status")).json()
    assert alice["enabled"] is False and anonymous["enabled"] is False
    assert bob["enabled"] is True and bob["autocomplete"] is False


async def test_suggestions_have_their_own_switch(client, monkeypatch):
    doc = (await client.post("/api/v1/documents", json={}, headers=ALICE)).json()
    set_llm(FakeLLM(text="continues here."))
    monkeypatch.setattr(get_settings(), "ai_autocomplete_enabled", False)
    response = await client.post(
        "/api/v1/ai/complete", headers=ALICE, json={"document_id": doc["id"], "preceding_text": "Mobile money " * 4}
    )
    assert response.status_code == 503 and response.json()["error"]["code"] == "AI_FEATURE_OFF"


# ------------------------------------------------------------------ M6. closure completes only when files are gone
async def test_closure_stays_open_until_stored_files_are_deleted(client, monkeypatch):
    await upload(client, "File cleanup study")
    from app.services import storage as storage_module

    real_storage = storage_module.get_storage()
    real_delete = real_storage.delete
    calls = {"n": 0}

    async def flaky_delete(key):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("storage unavailable")
        return await real_delete(key)

    monkeypatch.setattr(real_storage, "delete", flaky_delete)
    response = await client.request("DELETE", "/api/v1/me", headers=ALICE, json={"confirm_email": "alice@example.edu"})
    assert response.status_code == 202 and response.json()["status"] == "pending"
    async with get_sessionmaker()() as db:
        request = await db.get(ClosedAccount, "alice")
        assert request.completed_at is None and len(request.pending_keys) == 1
        assert (await db.execute(select(User).where(User.firebase_uid == "alice"))).first() is None  # data is gone
        await db.execute(ClosedAccount.__table__.update().values(not_before=datetime.now(UTC) - timedelta(1)))
        await db.execute(StorageDeletion.__table__.update().values(not_before=datetime.now(UTC) - timedelta(1)))
        await db.commit()
        assert await accounts.resume_closures(db) == 1
        request = await db.get(ClosedAccount, "alice")
        await db.refresh(request)
        assert request.completed_at is not None and request.pending_keys == []
        assert (await db.execute(select(StorageDeletion))).first() is None


# ------------------------------------------------------------------ M9. check scope and evidence budget
async def test_check_reports_the_sources_it_examined(client):
    paper = await upload_study(client)
    doc = (await client.post("/api/v1/documents", json={}, headers=ALICE)).json()
    await client.post(f"/api/v1/documents/{doc['id']}/citations", headers=ALICE, json={"paper_id": paper["id"]})
    set_llm(FakeLLM(lambda p: answer(claim("Incidence was 31 percent lower.", ids=[results_evidence_key(p)]))))
    body = (
        await client.post(
            f"/api/v1/documents/{doc['id']}/check", headers=ALICE, json={"text": "Prevention lowered incidence."}
        )
    ).json()
    assert body["scope"]["basis"] == "document"
    assert [s["id"] for s in body["scope"]["sources"]] == [paper["id"]]
    assert body["scope"]["total"] == 1 and body["scope"]["not_checked"] == 0


async def test_evidence_has_one_overall_budget(client):
    from app.services.ai.features import EVIDENCE_COVERAGE_EXTRA, gather_evidence

    papers = [await upload(client, f"Budget study {i}") for i in range(6)]
    async with get_sessionmaker()() as db:
        rows = list(
            (await db.execute(select(Paper).where(Paper.id.in_([uuid.UUID(p["id"]) for p in papers])))).scalars()
        )
        items = await gather_evidence(db, "zebra quantum unrelated words", rows, limit=4)
    assert len(items) <= 4 + EVIDENCE_COVERAGE_EXTRA


# ------------------------------------------------------------------ M10. quotes say which statement they support
async def test_quotes_identify_the_statements_they_support(client):
    paper = await upload_study(client)
    set_llm(
        FakeLLM(
            lambda p: answer(
                claim("Incidence was 31 percent lower.", ids=[results_evidence_key(p)]),
                claim("Intervention schools saw lower incidence.", ids=[results_evidence_key(p)]),
            )
        )
    )
    body = (
        await client.post(
            f"/api/v1/papers/{paper['id']}/ask",
            headers=ALICE,
            json={"question": "How much did malaria incidence fall?"},
        )
    ).json()
    [citation] = body["citations"]
    assert citation["offset_unit"] == "utf16"
    assert sorted(c for q in citation["quotes"] for c in q["claims"]) == [0, 1]


# ------------------------------------------------------------------ M11. export resilience and throttle
async def test_export_survives_a_document_that_cannot_be_rendered(client, monkeypatch):
    doc = (await client.post("/api/v1/documents", json={"title": "Broken render"}, headers=ALICE)).json()

    async def broken(*args, **kwargs):
        raise RuntimeError("citation engine crashed")

    import app.services.documents as documents_service

    monkeypatch.setattr(documents_service, "render_citations", broken)
    response = await client.get("/api/v1/me/export", headers=ALICE)
    assert response.status_code == 200
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    manifest = json.loads(archive.read("manifest.json"))
    assert f"documents/{doc['id']}.json" in archive.namelist()
    assert any(m["file"] == f"documents/{doc['id']}.docx" for m in manifest["missing"])


async def test_exports_are_rate_limited(client):
    for _ in range(5):
        assert (await client.get("/api/v1/me/export", headers=ALICE)).status_code == 200
    assert (await client.get("/api/v1/me/export", headers=ALICE)).status_code == 429


# ------------------------------------------------------------------ M12. dispatch outcomes
async def test_an_uncertain_dispatch_leaves_the_job_queued(client, monkeypatch):
    async def uncertain(job_id):
        raise tasks.DispatchUncertain("timed out after sending")

    monkeypatch.setattr(processing, "enqueue_job", uncertain)
    paper = await upload(client, "Uncertain dispatch study")
    async with get_sessionmaker()() as db:
        job = (
            await db.execute(select(ProcessingJob).where(ProcessingJob.paper_id == uuid.UUID(paper["id"])))
        ).scalar_one()
        assert job.status == JobStatus.QUEUED and job.lease_expires_at is not None
        assert (await db.get(Paper, uuid.UUID(paper["id"]))).status == PaperStatus.QUEUED


async def test_a_rejected_dispatch_never_overwrites_a_newer_job(client, monkeypatch):
    paper = await upload(client, "Newer job study")
    pid = uuid.UUID(paper["id"])

    async def rejected_after_newer_job(job_id):
        async with get_sessionmaker()() as db:  # meanwhile another request queued a newer job
            await db.execute(
                ProcessingJob.__table__.update().where(ProcessingJob.id == job_id).values(status=JobStatus.FAILED)
            )
            db.add(
                ProcessingJob(
                    paper_id=pid,
                    kind=processing.JobKind.INGEST_PDF,
                    status=JobStatus.QUEUED,
                    lease_expires_at=datetime.now(UTC) + timedelta(minutes=5),
                )
            )
            await db.execute(Paper.__table__.update().where(Paper.id == pid).values(status=PaperStatus.QUEUED))
            await db.commit()
        raise tasks.DispatchRejected("refused")

    monkeypatch.setattr(processing, "enqueue_job", rejected_after_newer_job)
    retry = await client.post(f"/api/v1/papers/{paper['id']}/full-text", headers=ALICE)
    assert retry.status_code >= 400
    async with get_sessionmaker()() as db:
        assert (await db.get(Paper, pid)).status == PaperStatus.QUEUED  # the newer job's state is kept


async def test_cloud_tasks_already_exists_counts_as_queued(monkeypatch):
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
    with respx.mock() as router:
        route = router.post(url__startswith="https://cloudtasks.googleapis.com/").mock(
            return_value=httpx.Response(409, json={"error": {"status": "ALREADY_EXISTS"}})
        )
        job_id = uuid.uuid4()
        await tasks.enqueue_job(job_id)
    assert json.loads(route.calls[0].request.content)["task"]["name"].endswith(f"/tasks/job-{job_id}")
    with respx.mock() as router:
        router.post(url__startswith="https://cloudtasks.googleapis.com/").mock(side_effect=httpx.ReadTimeout("slow"))
        with pytest.raises(tasks.DispatchUncertain):
            await tasks.enqueue_job(uuid.uuid4())
