"""Paper ingestion jobs: obtain the PDF, store it privately, extract + chunk text, then embed (if configured).

Job state machine (every transition is one conditional UPDATE, so concurrent deliveries cannot both win):

    queued --claim--> running --success--> succeeded
       ^                 |--terminal error--> failed
       |                 '--transient error (attempt < MAX_ATTEMPTS)--> queued (Cloud Tasks redelivers)
       '-- dispatch failure / expired lease --> failed (a new request or an admin retry starts again)

- Leases: queued and running jobs carry `lease_expires_at`. If a worker dies or a task is lost, the lease expires
  and `reclaim_abandoned_jobs` fails the job, so a paper is never stuck. A NULL lease counts as expired.
- Fencing: each claim gets a fresh `attempt_token`. Results (chunks, paper status, job outcome) are published in
  ONE transaction that first locks the job row and checks the token, so a slow worker whose lease was reclaimed
  can never overwrite a newer attempt.
- A delivery that finds a live lease held by another attempt asks Cloud Tasks to retry later (503) instead of
  acknowledging, so a task is never lost while a worker might still die.
- A partial unique index guarantees at most one queued/running job per paper.
"""

from __future__ import annotations

import asyncio
import enum
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, exists, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import JobKind, JobStatus, Paper, PaperChunk, PaperStatus, ProcessingJob, User
from app.db.session import get_sessionmaker
from app.errors import AppError, Conflict, UpstreamError
from app.security.url_safety import fetch_pdf
from app.services import ai
from app.services.maintenance import confirm_upload, record_upload_intent, schedule_deletion
from app.services.open_access import pdf_candidates
from app.services.pdf import chunk_pages, extract_pages
from app.services.storage import get_storage, pdf_key, sha256_hex
from app.services.tasks import DispatchUncertain, enqueue_job, register_inline_runner

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
RUNNING_LEASE = timedelta(minutes=16)  # > the Cloud Tasks dispatch deadline (15 min)
QUEUED_LEASE = timedelta(minutes=30)  # a task not started by then was lost


class Outcome(enum.StrEnum):
    DONE = "done"
    RETRY = "retry"
    SKIPPED = "skipped"


class PdfUnavailable(AppError):
    """No usable PDF could be obtained. Terminal: retrying will not help until something changes."""

    status_code = 422
    code = "PDF_UNAVAILABLE"


class LeaseLost(Exception):
    """This attempt no longer owns the job (its lease was reclaimed); it must not publish anything."""


@dataclass(frozen=True)
class Attempt:
    """Immutable facts about the claimed attempt (safe to use after a rollback expires ORM objects)."""

    job_id: uuid.UUID
    paper_id: uuid.UUID
    token: uuid.UUID
    number: int


def _now() -> datetime:
    return datetime.now(UTC)


def _lease_expired(now: datetime):  # type: ignore[no-untyped-def]
    return or_(ProcessingJob.lease_expires_at.is_(None), ProcessingJob.lease_expires_at < now)


# ------------------------------------------------------------------------------------------- PDF storage
async def put_pdf(paper_id: uuid.UUID, data: bytes) -> tuple[str, str]:
    """Write the object, after durably recording the intent (so a failure anywhere later cannot orphan it).
    Returns (key, sha256). The caller must `attach_pdf` in the transaction that commits the paper."""
    digest = sha256_hex(data)
    key = pdf_key(str(paper_id), digest, uuid.uuid4().hex)  # unique per write: never shared across attempts
    await record_upload_intent(key)
    await get_storage().put(key, data, "application/pdf")
    return key, digest


async def attach_pdf(db: AsyncSession, paper: Paper, key: str, digest: str, size: int) -> None:
    """Point the paper at a written object (caller commits). A replaced object is queued for deletion."""
    if paper.storage_path and paper.storage_path != key:
        await schedule_deletion(db, paper.storage_path)
    paper.storage_path, paper.file_sha256, paper.file_size = key, digest, size
    await confirm_upload(db, key)


async def store_pdf(db: AsyncSession, paper: Paper, data: bytes) -> str:
    key, digest = await put_pdf(paper.id, data)
    await attach_pdf(db, paper, key, digest, len(data))
    return key


# ------------------------------------------------------------------------------------------- job control
async def reclaim_abandoned_jobs(db: AsyncSession, paper_id: uuid.UUID | None = None) -> int:
    """Fail queued/running jobs whose lease expired (worker died, task lost) and release their papers."""
    now = _now()
    stmt = (
        update(ProcessingJob)
        .where(ProcessingJob.status.in_([JobStatus.QUEUED, JobStatus.RUNNING]), _lease_expired(now))
        .values(
            status=JobStatus.FAILED,
            error="Processing was interrupted before it finished. Please retry.",
            finished_at=now,
            lease_expires_at=None,
            attempt_token=None,
        )
        .returning(ProcessingJob.paper_id)
    )
    if paper_id is not None:
        stmt = stmt.where(ProcessingJob.paper_id == paper_id)
    paper_ids = list((await db.execute(stmt)).scalars())
    if paper_ids:
        await db.execute(
            update(Paper)
            .where(Paper.id.in_(paper_ids), Paper.status.in_([PaperStatus.QUEUED, PaperStatus.PROCESSING]))
            .values(status=PaperStatus.FAILED, status_detail="Processing was interrupted. Please retry.")
        )
    await db.commit()
    return len(paper_ids)


async def queue_ingest(db: AsyncSession, paper: Paper, requested_by: User | None) -> ProcessingJob:
    await reclaim_abandoned_jobs(db, paper.id)
    previous_status, previous_detail = paper.status, paper.status_detail
    job = ProcessingJob(
        paper_id=paper.id,
        kind=JobKind.INGEST_PDF,
        requested_by_id=requested_by.id if requested_by else None,
        status=JobStatus.QUEUED,
        lease_expires_at=_now() + QUEUED_LEASE,
    )
    paper.status = PaperStatus.QUEUED
    paper.status_detail = None
    db.add(job)
    try:
        await db.commit()
    except IntegrityError as exc:  # uq_processing_jobs_active_paper: another request queued it first
        await db.rollback()
        raise Conflict("This paper is already being processed.") from exc
    job_id, paper_id = job.id, paper.id
    try:
        await enqueue_job(job_id)
    except DispatchUncertain:
        # The task may be queued (or may even have run): do not fail it. If it never arrives, its queued lease
        # expires and maintenance releases it like any other abandoned job.
        await db.rollback()
        log.warning("processing.dispatch_uncertain", extra={"job_id": str(job_id)})
    except Exception as exc:
        # The task definitely never reached the queue: close THIS job now instead of leaving it "queued".
        await db.rollback()
        message = exc.message if isinstance(exc, AppError) else "Could not queue the processing job."
        closed = await db.execute(
            update(ProcessingJob)
            .where(
                ProcessingJob.id == job_id,
                ProcessingJob.status == JobStatus.QUEUED,
                ProcessingJob.attempt_token.is_(None),  # no worker has claimed it
            )
            .values(status=JobStatus.FAILED, error=message, finished_at=_now(), lease_expires_at=None)
        )
        if getattr(closed, "rowcount", 0):
            # Restore the paper only if this job still owned its queued state (no newer job has taken over).
            newer = exists().where(
                ProcessingJob.paper_id == paper_id,
                ProcessingJob.id != job_id,
                ProcessingJob.status.in_([JobStatus.QUEUED, JobStatus.RUNNING]),
            )
            await db.execute(
                update(Paper)
                .where(Paper.id == paper_id, Paper.status == PaperStatus.QUEUED, ~newer)
                .values(status=previous_status, status_detail=previous_detail)
            )
        await db.commit()
        if isinstance(exc, AppError):
            raise
        # Transport failures (timeouts, connection errors) become the same known error as a refused request.
        raise UpstreamError("Could not queue the processing job. Please retry.") from exc
    return (
        await db.execute(
            select(ProcessingJob).where(ProcessingJob.id == job_id).execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _claim(db: AsyncSession, job_id: uuid.UUID) -> Attempt | Outcome:
    """Atomically move queued (or lease-expired running) -> running with a new fencing token."""
    now = _now()
    row = (
        await db.execute(
            update(ProcessingJob)
            .where(
                ProcessingJob.id == job_id,
                (ProcessingJob.status == JobStatus.QUEUED)
                | ((ProcessingJob.status == JobStatus.RUNNING) & _lease_expired(now)),
            )
            .values(
                status=JobStatus.RUNNING,
                attempts=ProcessingJob.attempts + 1,
                started_at=now,
                lease_expires_at=now + RUNNING_LEASE,
                attempt_token=uuid.uuid4(),
            )
            .returning(ProcessingJob.paper_id, ProcessingJob.attempt_token, ProcessingJob.attempts)
        )
    ).first()
    await db.commit()
    if row is not None:
        return Attempt(job_id=job_id, paper_id=row.paper_id, token=row.attempt_token, number=row.attempts)
    status = (await db.execute(select(ProcessingJob.status).where(ProcessingJob.id == job_id))).scalar_one_or_none()
    await db.commit()
    # Another worker holds a live lease: completion is unknown, so ask the queue to try again later.
    return Outcome.RETRY if status == JobStatus.RUNNING else Outcome.SKIPPED


async def _hold(db: AsyncSession, attempt: Attempt) -> None:
    """Lock the job row and confirm this attempt still owns it. The lock lasts until the caller commits, so a
    reclaim cannot slip in between this check and the published results."""
    row = (
        await db.execute(
            select(ProcessingJob.status, ProcessingJob.attempt_token)
            .where(ProcessingJob.id == attempt.job_id)
            .with_for_update()
        )
    ).first()
    if row is None or row.status != JobStatus.RUNNING or row.attempt_token != attempt.token:
        raise LeaseLost


async def _finish(db: AsyncSession, attempt: Attempt, **values: object) -> bool:
    """Record the outcome only if this attempt still owns the job. Returns whether it did."""
    result = await db.execute(
        update(ProcessingJob)
        .where(
            ProcessingJob.id == attempt.job_id,
            ProcessingJob.status == JobStatus.RUNNING,
            ProcessingJob.attempt_token == attempt.token,
        )
        .values(**values)
    )
    return bool(getattr(result, "rowcount", 0))


# ------------------------------------------------------------------------------------------- pipeline
async def _obtain_pdf(db: AsyncSession, paper: Paper, attempt: Attempt) -> bytes:
    if paper.storage_path:
        return await get_storage().get(paper.storage_path)
    errors: list[str] = []
    transient = False
    for url, origin in await pdf_candidates(paper):
        try:
            data = await fetch_pdf(url)
        except AppError as exc:
            errors.append(f"{origin}: {exc.message}")
            transient = transient or isinstance(exc, UpstreamError)
            continue
        key, digest = await put_pdf(paper.id, data)
        await _hold(db, attempt)
        await attach_pdf(db, paper, key, digest, len(data))
        if not paper.oa_pdf_url:
            paper.oa_pdf_url = url
        await db.commit()
        return data
    detail = "; ".join(errors) if errors else "no open-access PDF location is known for this paper"
    message = f"Could not obtain an open-access PDF ({detail}). You can upload the PDF yourself."
    if transient:
        raise UpstreamError(message)  # e.g. a publisher timeout: worth another attempt
    raise PdfUnavailable(message)


async def _ingest(db: AsyncSession, paper: Paper, attempt: Attempt) -> None:
    """Extract and stage the results. Does NOT commit: run_job publishes them together with the job outcome."""
    data = await _obtain_pdf(db, paper, attempt)
    pages = await asyncio.to_thread(extract_pages, data)
    chunks = await asyncio.to_thread(chunk_pages, pages)
    await _hold(db, attempt)
    await db.execute(delete(PaperChunk).where(PaperChunk.paper_id == attempt.paper_id))
    db.add_all(
        PaperChunk(
            paper_id=attempt.paper_id,
            chunk_index=c.index,
            text=c.text,
            section=c.section,
            page_start=c.page_start,
            page_end=c.page_end,
            token_estimate=c.token_estimate,
        )
        for c in chunks
    )
    paper.page_count = len(pages)
    paper.status = PaperStatus.READY
    paper.status_detail = f"{len(chunks)} passages extracted from {len(pages)} pages."


async def _embed_best_effort(db: AsyncSession, paper_id: uuid.UUID) -> None:
    """Embeddings are an optional enhancement: a provider failure never takes extracted text offline.
    Passages without embeddings are still found by keyword search and are embedded by a later backfill."""
    if not ai.embeddings_enabled():
        return
    try:
        await ai.embed_paper_chunks(db, paper_id)
    except Exception:
        await db.rollback()
        log.warning("processing.embedding_failed", extra={"paper_id": str(paper_id)}, exc_info=True)


def _is_retryable(exc: Exception) -> bool:
    if isinstance(exc, AppError):
        return isinstance(exc, UpstreamError)  # network/storage/provider trouble; 4xx-type errors are final
    return True  # unexpected errors (lost DB connection, ...) deserve another attempt


async def run_job(job_id: uuid.UUID) -> Outcome:
    async with get_sessionmaker()() as db:
        claimed = await _claim(db, job_id)
        if isinstance(claimed, Outcome):
            return claimed
        attempt = claimed
        paper = await db.get(Paper, attempt.paper_id)
        if paper is None:
            await _finish(db, attempt, status=JobStatus.FAILED, error="Paper no longer exists.", finished_at=_now())
            await db.commit()
            return Outcome.DONE
        try:
            await _hold(db, attempt)  # fenced: a superseded attempt must not touch the paper at all
        except LeaseLost:
            await db.rollback()
            return Outcome.SKIPPED
        paper.status = PaperStatus.PROCESSING
        await db.commit()
        try:
            await _ingest(db, paper, attempt)
            published = await _finish(
                db,
                attempt,
                status=JobStatus.SUCCEEDED,
                error=None,
                finished_at=_now(),
                lease_expires_at=None,
                attempt_token=None,
            )
            if not published:
                raise LeaseLost
            await db.commit()  # chunks + paper status + job outcome become visible together
        except LeaseLost:
            await db.rollback()
            log.warning("processing.lease_lost", extra={"job_id": str(job_id)})
            return Outcome.SKIPPED
        except Exception as exc:
            await db.rollback()  # expires ORM state: from here on only `attempt` (plain values) is used
            message = exc.message if isinstance(exc, AppError) else "Unexpected processing error."
            if not isinstance(exc, AppError):
                log.exception("processing.unexpected_error", extra={"job_id": str(job_id)})
            retry = _is_retryable(exc) and attempt.number < MAX_ATTEMPTS
            if retry:
                owned = await _finish(
                    db,
                    attempt,
                    status=JobStatus.QUEUED,
                    error=message,
                    lease_expires_at=_now() + QUEUED_LEASE,
                    attempt_token=None,
                )
                paper_values = {"status": PaperStatus.QUEUED, "status_detail": f"Retrying after an error: {message}"}
            else:
                owned = await _finish(
                    db,
                    attempt,
                    status=JobStatus.FAILED,
                    error=message,
                    finished_at=_now(),
                    lease_expires_at=None,
                    attempt_token=None,
                )
                paper_values = {"status": PaperStatus.FAILED, "status_detail": message}
            if owned:
                await db.execute(update(Paper).where(Paper.id == attempt.paper_id).values(**paper_values))
            await db.commit()
            return Outcome.RETRY if (retry and owned) else (Outcome.DONE if owned else Outcome.SKIPPED)
        log.info("processing.succeeded", extra={"job_id": str(job_id), "paper_id": str(attempt.paper_id)})
        await _embed_best_effort(db, attempt.paper_id)
        return Outcome.DONE


register_inline_runner(run_job)
