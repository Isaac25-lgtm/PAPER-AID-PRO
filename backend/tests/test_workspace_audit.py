"""Regression tests for docs/PAPERAID_V2_WORKSPACE_AUDIT.md (backend): worker start and failure never deadlock
an account closure (synchronised on real PostgreSQL locks), a closure that loses a deadlock runs again at once, and
an outage of a DOI lookup service keeps PDF retrieval retryable instead of failing it for good."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.db.models import ClosedAccount, JobKind, JobStatus, Paper, PaperSource, ProcessingJob, User
from app.db.session import get_sessionmaker
from app.errors import UpstreamError
from app.security import url_safety
from app.services import accounts, open_access, processing
from app.services.papers import create_private_paper
from app.services.scholarly.models import ScholarlyWork
from tests.conftest import ALICE
from tests.test_staging_audit import PDF, _candidates, _close_alice, _private_paper_with_job, _serve_one_pdf


async def _wait_for_a_blocked_transaction(limit: float = 15.0) -> None:
    """Until some session is really waiting for a row lock: the race is synchronised on PostgreSQL itself."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + limit
    while loop.time() < deadline:
        async with get_sessionmaker()() as db:
            waiting = (
                await db.execute(text("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'"))
            ).scalar_one()
        if waiting:
            return
        await asyncio.sleep(0.05)
    raise AssertionError("no transaction ever waited for a lock")


async def _assert_closed_cleanly(closure: asyncio.Task, paper_id) -> None:
    try:
        await asyncio.wait_for(closure, timeout=60)
    finally:
        if not closure.done():
            closure.cancel()
    async with get_sessionmaker()() as db:
        request = await db.get(ClosedAccount, "alice")
        assert request.last_error is None, request.last_error  # e.g. a deadlock swallowed by the closure
        assert request.attempts == 0 and request.completed_at is not None
        assert await db.get(Paper, paper_id) is None


# ---------------------------------------------------------- 3: worker start / failure never deadlock a closure
async def test_a_closure_arriving_while_a_job_starts_completes_without_a_deadlock(client, monkeypatch):
    paper_id, job_id = await _private_paper_with_job(client, "Starting job")
    _serve_one_pdf(monkeypatch)
    real_hold = processing._hold
    closure: list[asyncio.Task] = []

    async def hold_then_closure_arrives(db, attempt):
        await real_hold(db, attempt)  # the worker now holds the job row
        if not closure:
            closure.append(asyncio.create_task(_close_alice()))
            await _wait_for_a_blocked_transaction()  # the closure is waiting on a lock the worker holds

    monkeypatch.setattr(processing, "_hold", hold_then_closure_arrives)
    await asyncio.wait_for(processing.run_job(job_id), timeout=60)
    await _assert_closed_cleanly(closure[0], paper_id)


async def test_a_closure_arriving_while_a_job_records_its_failure_completes_without_a_deadlock(client, monkeypatch):
    paper_id, job_id = await _private_paper_with_job(client, "Failing job")

    async def refuse(url):
        raise url_safety.PdfSourceRefused("The PDF host returned HTTP 403.")

    monkeypatch.setattr(processing, "pdf_candidates", _candidates("https://refuses.example/a.pdf"))
    monkeypatch.setattr(processing, "fetch_pdf", refuse)
    real_finish = processing._finish
    closure: list[asyncio.Task] = []

    async def finish_then_closure_arrives(db, attempt, **values):
        owned = await real_finish(db, attempt, **values)  # the worker now holds the job row
        if not closure:
            closure.append(asyncio.create_task(_close_alice()))
            await _wait_for_a_blocked_transaction()
        return owned

    monkeypatch.setattr(processing, "_finish", finish_then_closure_arrives)
    await asyncio.wait_for(processing.run_job(job_id), timeout=60)
    await _assert_closed_cleanly(closure[0], paper_id)


async def test_a_closure_that_loses_a_deadlock_runs_again_at_once(client, monkeypatch):
    paper_id, _ = await _private_paper_with_job(client, "Retried closure")
    real = accounts._finish_closure
    calls = {"n": 0}

    class Victim(Exception):
        sqlstate = "40P01"

    async def deadlock_once(db, uid, user_id, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise DBAPIError("DELETE FROM users", {}, Victim())
        return await real(db, uid, user_id, **kwargs)

    monkeypatch.setattr(accounts, "_finish_closure", deadlock_once)
    await _close_alice()
    assert calls["n"] == 2
    async with get_sessionmaker()() as db:
        request = await db.get(ClosedAccount, "alice")
        assert request.completed_at is not None and request.last_error is None
        assert await db.get(Paper, paper_id) is None


# ---------------------------------------------------------- 6: a lookup outage is not "no open-access PDF"
async def _doi_paper_with_job(client, title: str):
    assert (await client.get("/api/v1/me", headers=ALICE)).status_code == 200
    async with get_sessionmaker()() as db:
        alice = (await db.execute(select(User).where(User.firebase_uid == "alice"))).scalar_one()
        paper = await create_private_paper(
            db,
            owner=alice,
            work=ScholarlyWork(title=title, work_type="article", doi="10.5555/lookup.test"),
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


def _lookups(monkeypatch, *, unpaywall, openalex):
    async def unpaywall_pdf(doi):
        if isinstance(unpaywall, Exception):
            raise unpaywall
        return unpaywall, None

    async def openalex_lookup(kind, value):
        if isinstance(openalex, Exception):
            raise openalex
        return openalex

    monkeypatch.setattr(open_access, "_unpaywall_pdf", unpaywall_pdf)
    monkeypatch.setattr(open_access.OpenAlex, "lookup", openalex_lookup)


async def test_a_lookup_outage_keeps_the_job_retryable(client, monkeypatch):
    paper_id, job_id = await _doi_paper_with_job(client, "Lookup outage")
    _lookups(monkeypatch, unpaywall=UpstreamError("Timed out."), openalex=UpstreamError("HTTP 503."))
    assert await processing.run_job(job_id) == processing.Outcome.RETRY
    async with get_sessionmaker()() as db:
        assert (await db.get(ProcessingJob, job_id)).status == JobStatus.QUEUED
        assert "could not be reached" in (await db.get(Paper, paper_id)).status_detail


async def test_a_paper_with_no_open_access_location_fails_once(client, monkeypatch):
    _, job_id = await _doi_paper_with_job(client, "No location")
    _lookups(monkeypatch, unpaywall=None, openalex=None)
    assert await processing.run_job(job_id) == processing.Outcome.DONE
    async with get_sessionmaker()() as db:
        job = await db.get(ProcessingJob, job_id)
        assert job.status == JobStatus.FAILED and "no open-access PDF location" in job.error


async def test_one_lookup_down_the_other_still_delivers_the_pdf(client, monkeypatch):
    paper_id, job_id = await _doi_paper_with_job(client, "Fallback lookup")
    work = ScholarlyWork(title="t", oa_pdf_url="https://oa.example/paper.pdf")
    _lookups(monkeypatch, unpaywall=UpstreamError("Timed out."), openalex=work)

    async def fetch(url):
        return PDF

    monkeypatch.setattr(processing, "fetch_pdf", fetch)
    assert await processing.run_job(job_id) == processing.Outcome.DONE
    async with get_sessionmaker()() as db:
        assert (await db.get(Paper, paper_id)).storage_path
