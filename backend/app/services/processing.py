"""Paper ingestion jobs: obtain the PDF, store it privately, extract + chunk text, then embed (if configured)."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import JobKind, JobStatus, Paper, PaperChunk, PaperStatus, ProcessingJob, User
from app.db.session import get_sessionmaker
from app.errors import AppError, Conflict, UpstreamError
from app.security.url_safety import fetch_pdf
from app.services import ai
from app.services.open_access import pdf_candidates
from app.services.pdf import chunk_pages, extract_pages
from app.services.storage import get_storage, pdf_key, sha256_hex
from app.services.tasks import enqueue_job, register_inline_runner

log = logging.getLogger(__name__)


async def store_pdf(db: AsyncSession, paper: Paper, data: bytes) -> None:
    digest = sha256_hex(data)
    key = pdf_key(str(paper.id), digest)
    await get_storage().put(key, data, "application/pdf")
    paper.storage_path = key
    paper.file_sha256 = digest
    paper.file_size = len(data)
    await db.commit()


async def queue_ingest(db: AsyncSession, paper: Paper, requested_by: User | None) -> ProcessingJob:
    active = (
        (
            await db.execute(
                select(ProcessingJob).where(
                    ProcessingJob.paper_id == paper.id,
                    ProcessingJob.status.in_([JobStatus.QUEUED, JobStatus.RUNNING]),
                )
            )
        )
        .scalars()
        .first()
    )
    if active is not None:
        raise Conflict("This paper is already being processed.")
    job = ProcessingJob(
        paper_id=paper.id, kind=JobKind.INGEST_PDF, requested_by_id=requested_by.id if requested_by else None
    )
    paper.status = PaperStatus.QUEUED
    paper.status_detail = None
    db.add(job)
    await db.commit()
    await enqueue_job(job.id)
    await db.refresh(job)
    return job


async def _obtain_pdf(db: AsyncSession, paper: Paper) -> bytes:
    if paper.storage_path:
        return await get_storage().get(paper.storage_path)
    errors: list[str] = []
    for url, origin in await pdf_candidates(paper):
        try:
            data = await fetch_pdf(url)
        except AppError as exc:
            errors.append(f"{origin}: {exc.message}")
            continue
        await store_pdf(db, paper, data)
        if not paper.oa_pdf_url:
            paper.oa_pdf_url = url
        return data
    detail = "; ".join(errors) if errors else "no open-access PDF location is known for this paper"
    raise UpstreamError(f"Could not obtain an open-access PDF ({detail}). You can upload the PDF yourself.")


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
    if ai.embeddings_enabled():
        await ai.embed_paper_chunks(db, paper.id)


async def run_job(job_id: uuid.UUID) -> None:
    async with get_sessionmaker()() as db:
        job = await db.get(ProcessingJob, job_id)
        if job is None or job.status in {JobStatus.SUCCEEDED, JobStatus.RUNNING}:
            return  # duplicate delivery from the queue
        paper = await db.get(Paper, job.paper_id)
        if paper is None:
            job.status, job.error = JobStatus.FAILED, "Paper no longer exists."
            await db.commit()
            return
        job.status, job.attempts, job.started_at = JobStatus.RUNNING, job.attempts + 1, datetime.now(UTC)
        paper.status = PaperStatus.PROCESSING
        await db.commit()
        try:
            await _ingest(db, paper)
        except Exception as exc:
            await db.rollback()
            message = exc.message if isinstance(exc, AppError) else "Unexpected processing error."
            if not isinstance(exc, AppError):
                log.exception("processing.unexpected_error", extra={"job_id": str(job_id)})
            job = await db.get(ProcessingJob, job_id)
            paper = await db.get(Paper, job.paper_id) if job else None
            if job is not None:
                job.status, job.error, job.finished_at = JobStatus.FAILED, message, datetime.now(UTC)
            if paper is not None:
                paper.status, paper.status_detail = PaperStatus.FAILED, message
            await db.commit()
            return
        job.status, job.error, job.finished_at = JobStatus.SUCCEEDED, None, datetime.now(UTC)
        await db.commit()
        log.info("processing.succeeded", extra={"job_id": str(job_id), "paper_id": str(paper.id)})


register_inline_runner(run_job)
