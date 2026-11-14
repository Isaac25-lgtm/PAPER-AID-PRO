"""Regression tests for docs/PAPERAID_V2_STAGING_AUDIT.md (backend): the closure fence for PDFs attached by the
full-text worker (both winning orders), PDF host refusals that are final for one location, lazy DOI lookups,
malformed Cloud Tasks error bodies, and archive exports that never hold two connections."""

from __future__ import annotations

import asyncio
import io
import uuid
import zipfile
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import get_settings
from app.db.models import ClosedAccount, JobKind, JobStatus, Paper, PaperSource, ProcessingJob, StorageDeletion, User
from app.db.session import get_sessionmaker
from app.errors import NotFound, UpstreamError
from app.security import url_safety
from app.services import accounts, open_access, processing, tasks
from app.services.papers import create_private_paper
from app.services.scholarly.models import ScholarlyWork
from app.services.storage import get_storage
from tests.conftest import ALICE, STUDY_SECTIONS, make_pdf
from tests.test_hardening_audit import _cloud_tasks_settings

PDF = make_pdf(STUDY_SECTIONS, title="Worker race study")


async def _private_paper_with_job(client, title: str) -> tuple[uuid.UUID, uuid.UUID]:
    """A private reference (e.g. from a .bib import) with an arXiv ID and no stored PDF, plus a queued job."""
    assert (await client.get("/api/v1/me", headers=ALICE)).status_code == 200
    async with get_sessionmaker()() as db:
        alice = (await db.execute(select(User).where(User.firebase_uid == "alice"))).scalar_one()
        paper = await create_private_paper(
            db,
            owner=alice,
            work=ScholarlyWork(title=title, work_type="article", arxiv_id="2401.00001"),
            source=PaperSource.IMPORT_FILE,
            commit=False,
        )
        job = ProcessingJob(
            paper_id=paper.id,
            kind=JobKind.INGEST_PDF,
            status=JobStatus.QUEUED,
            lease_expires_at=datetime.now(UTC) + timedelta(minutes=30),
        )
        db.add(job)
        await db.commit()
        return paper.id, job.id


def _serve_one_pdf(monkeypatch):
    async def candidates(paper):
        yield "https://example.org/paper.pdf", "test"

    async def fetch(url):
        return PDF

    monkeypatch.setattr(processing, "pdf_candidates", candidates)
    monkeypatch.setattr(processing, "fetch_pdf", fetch)


async def _object_exists(key: str) -> bool:
    try:
        await get_storage().get(key)
    except NotFound:
        return False
    return True


async def _close_alice() -> None:
    async with get_sessionmaker()() as db:
        user = (await db.execute(select(User).where(User.firebase_uid == "alice"))).scalar_one()
        await accounts.close_account(db, user)


# ---------------------------------------------------------- H2: the worker cannot attach a PDF to a closed account
async def test_closure_first_the_worker_discards_the_pdf_it_fetched(client, monkeypatch):
    paper_id, job_id = await _private_paper_with_job(client, "Closure wins")
    _serve_one_pdf(monkeypatch)
    real_put = processing.put_pdf
    written: list[str] = []

    async def put_then_close(pid, data):
        key, digest = await real_put(pid, data)
        written.append(key)
        await _close_alice()  # the closure runs to completion while the worker holds a written object
        return key, digest

    monkeypatch.setattr(processing, "put_pdf", put_then_close)
    await processing.run_job(job_id)
    assert written and not await _object_exists(written[0])  # discarded at once, not orphaned
    async with get_sessionmaker()() as db:
        assert await db.get(Paper, paper_id) is None
        assert (await db.execute(select(StorageDeletion).where(StorageDeletion.key == written[0]))).first() is None
        assert (await db.get(ClosedAccount, "alice")).completed_at is not None


async def test_worker_first_the_closure_waits_for_it_and_deletes_the_attached_pdf(client, monkeypatch):
    paper_id, job_id = await _private_paper_with_job(client, "Worker wins")
    _serve_one_pdf(monkeypatch)
    real_attach = processing.attach_pdf
    closure: list[asyncio.Task] = []
    attached: list[str] = []

    async def attach_then_close(db, paper, key, digest, size):
        await real_attach(db, paper, key, digest, size)  # under the owner's share lock, not yet committed
        attached.append(key)
        closure.append(asyncio.create_task(_close_alice()))
        await asyncio.sleep(0.5)
        assert not closure[0].done()  # the closure is blocked by the fence until this attachment commits

    monkeypatch.setattr(processing, "attach_pdf", attach_then_close)
    try:
        await asyncio.wait_for(processing.run_job(job_id), timeout=60)
        await asyncio.wait_for(closure[0], timeout=60)
    finally:  # never leave a closure running into later tests
        for task in closure:
            if not task.done():
                task.cancel()
    assert attached and not await _object_exists(attached[0])  # the closure saw the new file and deleted it
    async with get_sessionmaker()() as db:
        assert await db.get(Paper, paper_id) is None
        assert (await db.execute(select(StorageDeletion).where(StorageDeletion.key == attached[0]))).first() is None
        request = await db.get(ClosedAccount, "alice")
        assert request.last_error is None, request.last_error  # a swallowed closure error shows here
        assert request.completed_at is not None and request.pending_keys == []


# ---------------------------------------------------------- M6: a refusal is final for one location, not the job
@pytest.mark.parametrize(
    "reply, error",
    [
        (httpx.Response(403), url_safety.PdfSourceRefused),
        (httpx.Response(404), url_safety.PdfSourceRefused),
        (httpx.Response(200, content=b"<html>landing page</html>"), url_safety.PdfSourceRefused),
        (httpx.Response(503), UpstreamError),
        (httpx.Response(429), UpstreamError),
    ],
)
async def test_pdf_host_answers_are_classified(monkeypatch, reply, error):
    async def public(url):
        return url_safety.ResolvedTarget(url=url, host="pdf.example", ip="93.184.216.34")

    monkeypatch.setattr(url_safety, "resolve_public_target", public)
    with respx.mock() as router:
        router.get(url__startswith="https://93.184.216.34/").mock(return_value=reply)
        with pytest.raises(error):
            await url_safety.fetch_pdf("https://pdf.example/paper.pdf")


async def test_a_connection_failure_is_transient_and_does_not_escape(monkeypatch):
    async def public(url):
        return url_safety.ResolvedTarget(url=url, host="pdf.example", ip="93.184.216.34")

    monkeypatch.setattr(url_safety, "resolve_public_target", public)
    with respx.mock() as router:
        router.get(url__startswith="https://93.184.216.34/").mock(side_effect=httpx.ReadTimeout("slow"))
        with pytest.raises(UpstreamError):
            await url_safety.fetch_pdf("https://pdf.example/paper.pdf")


def _candidates(*urls):
    async def candidates(paper):
        for url in urls:
            yield url, "test"

    return candidates


async def test_a_refused_only_location_fails_the_job_once_instead_of_retrying(client, monkeypatch):
    _, job_id = await _private_paper_with_job(client, "Refused everywhere")

    async def refuse(url):
        raise url_safety.PdfSourceRefused("The PDF host returned HTTP 403.")

    monkeypatch.setattr(processing, "pdf_candidates", _candidates("https://europepmc.example/render"))
    monkeypatch.setattr(processing, "fetch_pdf", refuse)
    assert await processing.run_job(job_id) == processing.Outcome.DONE  # not RETRY (the staging 503, 503, 204)
    async with get_sessionmaker()() as db:
        job = await db.get(ProcessingJob, job_id)
        assert job.status == JobStatus.FAILED and job.attempts == 1 and "403" in job.error


async def test_a_refusal_moves_on_to_the_next_location(client, monkeypatch):
    paper_id, job_id = await _private_paper_with_job(client, "Second location works")
    tried: list[str] = []

    async def fetch(url):
        tried.append(url)
        if "first" in url:
            raise url_safety.PdfSourceRefused("The PDF host returned HTTP 403.")
        return PDF

    monkeypatch.setattr(
        processing, "pdf_candidates", _candidates("https://first.example/a.pdf", "https://second.example/b.pdf")
    )
    monkeypatch.setattr(processing, "fetch_pdf", fetch)
    assert await processing.run_job(job_id) == processing.Outcome.DONE
    assert tried == ["https://first.example/a.pdf", "https://second.example/b.pdf"]
    async with get_sessionmaker()() as db:
        assert (await db.get(Paper, paper_id)).storage_path


async def test_doi_lookups_run_only_when_known_locations_fail(monkeypatch):
    lookups: list[str] = []

    async def unpaywall(doi):
        lookups.append("unpaywall")
        return "https://oa.example/u.pdf", "cc-by"

    async def openalex(kind, value):
        lookups.append("openalex")
        return None

    monkeypatch.setattr(open_access, "_unpaywall_pdf", unpaywall)
    monkeypatch.setattr(open_access.OpenAlex, "lookup", openalex)
    paper = Paper(title="t", arxiv_id="2401.00001", doi="10.1/x", oa_pdf_url=None)
    stream = open_access.pdf_candidates(paper)
    assert await anext(stream) == ("https://arxiv.org/pdf/2401.00001", "arxiv")
    assert lookups == []  # the known location is tried before any DOI lookup
    assert await anext(stream) == ("https://oa.example/u.pdf", "unpaywall")
    with pytest.raises(StopAsyncIteration):
        await anext(stream)
    assert lookups == ["unpaywall", "openalex"]


# ---------------------------------------------------------- M7: malformed or unqualified Cloud Tasks errors
@pytest.mark.parametrize(
    "reply, expected",
    [
        (httpx.Response(503, json=None), tasks.DispatchUncertain),
        (httpx.Response(500, json=[1, 2]), tasks.DispatchUncertain),
        (httpx.Response(502, json={"error": "bad gateway"}), tasks.DispatchUncertain),
        (httpx.Response(400, json={"error": ["x"]}), tasks.DispatchRejected),
        (httpx.Response(400, json={"error": {"status": 7}}), tasks.DispatchRejected),
        (httpx.Response(409, json={"error": {"status": "ABORTED"}}), tasks.DispatchUncertain),
        (httpx.Response(409, text="conflict"), tasks.DispatchUncertain),
        (httpx.Response(409, json={"error": {"status": "ALREADY_EXISTS"}}), None),
    ],
)
async def test_queue_error_bodies_of_any_shape_are_classified(monkeypatch, reply, expected):
    _cloud_tasks_settings(monkeypatch)
    with respx.mock() as router:
        router.post(url__startswith="https://cloudtasks.googleapis.com/").mock(return_value=reply)
        if expected is None:
            await tasks.enqueue_job(uuid.uuid4())
        else:
            with pytest.raises(expected):
                await tasks.enqueue_job(uuid.uuid4())


# ---------------------------------------------------------- M5: exports never hold two connections at once
async def test_two_exports_complete_on_a_one_connection_pool(client, monkeypatch):
    import app.services.documents as documents_service

    doc = (await client.post("/api/v1/documents", json={"title": "Pool test"}, headers=ALICE)).json()
    real_render = documents_service.render_citations

    async def render_using_the_database(db, document, user, **kwargs):
        await db.execute(select(1))  # as rendering a cited document does: the render session needs a connection
        return await real_render(db, document, user, **kwargs)

    monkeypatch.setattr(documents_service, "render_citations", render_using_the_database)
    async with get_sessionmaker()() as db:
        user_id = (await db.execute(select(User.id).where(User.firebase_uid == "alice"))).scalar_one()
    # A real pool of ONE connection for the archive and its render sessions. Holding the archive's connection
    # while asking for a second one would time out, and the Word file would go missing from the archive.
    engine = create_async_engine(get_settings().database_url, pool_size=1, max_overflow=0, pool_timeout=3)
    tiny = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    monkeypatch.setattr(accounts, "get_sessionmaker", lambda: tiny)
    try:

        async def export() -> list[str]:
            async with tiny() as db:
                archive = await accounts.export_account(db, await db.get(User, user_id))
                archive.seek(0)
                with zipfile.ZipFile(io.BytesIO(archive.read())) as z:
                    return [*z.namelist(), z.read("manifest.json").decode()]

        for names in await asyncio.wait_for(asyncio.gather(export(), export()), timeout=60):
            assert f"documents/{doc['id']}.docx" in names, names[-1]
    finally:
        await engine.dispose()
