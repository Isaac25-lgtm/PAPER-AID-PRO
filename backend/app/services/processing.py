"""Paper ingestion jobs: obtain the PDF, store it privately, extract + chunk text, then embed (if configured).

Job state machine (all transitions are single conditional UPDATEs, so concurrent deliveries cannot both win):

    queued --claim--> running --success--> succeeded
       ^                 |--terminal error--> failed
       |                 '--transient error (attempt < MAX_ATTEMPTS)--> queued (Cloud Tasks redelivers)
       '-- dispatch failure / expired lease --> failed (reclaimable by a new request or an admin retry)

Queued and running jobs carry a lease (`lease_expires_at`). If a worker dies or a task is never delivered, the
lease expires and `reclaim_abandoned_jobs` marks the job failed, so the paper is never stuck.
A partial unique index guarantees at most one queued/running job per paper.
"""

from __future__ import annotations

import asyncio
import enum
import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import JobKind, JobStatus, Paper, PaperChunk, PaperStatus, ProcessingJob, User
from app.db.session import get_sessionmaker
from app.errors import AppError, Conflict, UpstreamError
from app.security.url_safety import fetch_pdf
from app.services import ai
from app.services.maintenance import schedule_deletion
from app.services.open_access import pdf_candidates
from app.services.pdf import chunk_pages, extract_pages
from app.services.storage import get_storage, pdf_key, sha256_hex
from app.services.tasks import enqueue_job, register_inline_runner

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


def _now() -> datetime:
    return datetime.now(UTC)


async def store_pdf(db: AsyncSession, paper: Paper, data: bytes) -> str:
    """Upload the PDF and point the paper at it (caller commits). A replaced object is queued for deletion."""
    digest = sha256_hex(data)
    key = pdf_key(str(paper.id), digest)
    await get_storage().put(key, data, "application/pdf")
    if paper.storage_path and paper.storage_path != key:
        await schedule_deletion(db, paper.storage_path)
    paper.storage_path = key
    paper.file_sha256 = digest
    paper.file_size = len(data)
    return key


async def reclaim_abandoned_jobs(db: AsyncSession, paper_id: uuid.UUID | None = None) -> int:
    """Fail queued/running jobs whose lease expired (worker died, task lost) and release their papers."""
    stmt = (
        update(ProcessingJob)
        .where(
            ProcessingJob.status.in_([JobStatus.QUEUED, JobStatus.RUNNING]),
            ProcessingJob.lease_expires_at < _now(),
        )
        .values(
            status=JobStatus.FAILED,
            error="Processing was interrupted before it finished. Please retry.",
            finished_at=_now(),
            lease_expires_at=None,
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
    try:
        await enqueue_job(job.id)
    except Exception as exc:
        # The task never reached the queue: close the job now instead of leaving it "queued" forever.
        message = exc.message if isinstance(exc, AppError) else "Could not queue the processing job."
        await db.execute(
            update(ProcessingJob)
            .where(ProcessingJob.id == job.id, ProcessingJob.status == JobStatus.QUEUED)
            .values(status=JobStatus.FAILED, error=message, finished_at=_now(), lease_expires_at=None)
        )
        await db.execute(
            update(Paper)
            .where(Paper.id == paper.id, Paper.status == PaperStatus.QUEUED)
            .values(status=previous_status, status_detail=previous_detail)
        )
        await db.commit()
        raise
    await db.refresh(job)
    return job


async def _obtain_pdf(db: AsyncSession, paper: Paper) -> bytes:
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
        await store_pdf(db, paper, data)
        if not paper.oa_pdf_url:
            paper.oa_pdf_url = url
        await db.commit()
        return data
    detail = "; ".join(errors) if errors else "no open-access PDF location is known for this paper"
    message = f"Could not obtain an open-access PDF ({detail}). You can upload the PDF yourself."
    if transient:
        raise UpstreamError(message)  # e.g. a publisher timeout: worth another attempt
    raise PdfUnavailable(message)


async def _ingest(db: AsyncSession, paper: Paper) -> None:
    data = await _obtain_pdf(db, paper)
    pages = await asyncio.to_thread(extract_pages, data)
    chunks = await asyncio.to_thread(chunk_pages, pages)
    await db.execute(delete(PaperChunk).where(PaperChunk.paper_id == paper.id))
    db.add_all(
        PaperChunk(
            paper_id=paper.id,
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
    await db.commit()


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


async def _claim(db: AsyncSession, job_id: uuid.UUID) -> ProcessingJob | None:
    """Atomically move queued (or lease-expired running) -> running. Duplicate deliveries get None."""
    now = _now()
    claimed = (
        await db.execute(
            update(ProcessingJob)
            .where(
                ProcessingJob.id == job_id,
                (ProcessingJob.status == JobStatus.QUEUED)
                | ((ProcessingJob.status == JobStatus.RUNNING) & (ProcessingJob.lease_expires_at < now)),
            )
            .values(
                status=JobStatus.RUNNING,
                attempts=ProcessingJob.attempts + 1,
                started_at=now,
                lease_expires_at=now + RUNNING_LEASE,
            )
            .returning(ProcessingJob.id)
        )
    ).scalar_one_or_none()
    await db.commit()
    if claimed is None:
        return None
    return (
        await db.execute(
            select(ProcessingJob).where(ProcessingJob.id == job_id).execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _finish(db: AsyncSession, job_id: uuid.UUID, **values: object) -> None:
    # Only the worker that still holds the job may finish it (a reclaimed job stays reclaimed).
    await db.execute(
        update(ProcessingJob)
        .where(ProcessingJob.id == job_id, ProcessingJob.status == JobStatus.RUNNING)
        .values(**values)
    )


async def run_job(job_id: uuid.UUID) -> Outcome:
    async with get_sessionmaker()() as db:
        job = await _claim(db, job_id)
        if job is None:
            return Outcome.SKIPPED  # duplicate delivery, or already finished
        paper = await db.get(Paper, job.paper_id)
        if paper is None:
            await _finish(db, job_id, status=JobStatus.FAILED, error="Paper no longer exists.", finished_at=_now())
            await db.commit()
            return Outcome.DONE
        paper.status = PaperStatus.PROCESSING
        await db.commit()
        try:
            await _ingest(db, paper)
        except Exception as exc:
            await db.rollback()
            message = exc.message if isinstance(exc, AppError) else "Unexpected processing error."
            if not isinstance(exc, AppError):
                log.exception("processing.unexpected_error", extra={"job_id": str(job_id)})
            retry = _is_retryable(exc) and job.attempts < MAX_ATTEMPTS
            if retry:
                await _finish(
                    db, job_id, status=JobStatus.QUEUED, error=message, lease_expires_at=_now() + QUEUED_LEASE
                )
                paper_values = {"status": PaperStatus.QUEUED, "status_detail": f"Retrying after an error: {message}"}
            else:
                await _finish(
                    db, job_id, status=JobStatus.FAILED, error=message, finished_at=_now(), lease_expires_at=None
                )
                paper_values = {"status": PaperStatus.FAILED, "status_detail": message}
            await db.execute(update(Paper).where(Paper.id == job.paper_id).values(**paper_values))
            await db.commit()
            return Outcome.RETRY if retry else Outcome.DONE
        await _finish(db, job_id, status=JobStatus.SUCCEEDED, error=None, finished_at=_now(), lease_expires_at=None)
        await db.commit()
        log.info("processing.succeeded", extra={"job_id": str(job_id), "paper_id": str(paper.id)})
        await _embed_best_effort(db, paper.id)
        return Outcome.DONE


register_inline_runner(run_job)
