"""Papers: catalog, detail, import, upload, full text, passages, citation, PDF, AI summary and Q&A."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, File, Form, Query, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import func, select, text, update
from starlette.background import BackgroundTask

from app.api.deps import DB, AppSettings
from app.api.downloads import content_disposition
from app.db.models import (
    LibraryItem,
    Paper,
    PaperAuthor,
    PaperChunk,
    PaperSource,
    PaperStatus,
    PaperSummary,
    PaperVisibility,
    ProcessingJob,
    User,
)
from app.errors import AppError, Conflict, Forbidden, NotFound, PayloadTooLarge, ValidationFailed
from app.schemas import (
    AskRequest,
    GroundedAnswerOut,
    ImportRequest,
    JobOut,
    PaperOut,
    PaperPage,
    PaperStatusFilter,
    PassageOut,
)
from app.security.auth import OptionalUser, VerifiedUser
from app.security.rate_limit import enforce_rate_limit
from app.services import manual, processing
from app.services.ai import features as ai_features
from app.services.citations.csl import STYLES, format_citations
from app.services.maintenance import delete_now_or_later, schedule_deletion
from app.services.manual import ManualSourceIn
from app.services.papers import (
    author_rows,
    can_manage,
    create_private_paper,
    get_paper_for_user,
    to_csl_json,
    upsert_public_paper,
    visible_papers_clause,
    with_authors,
)
from app.services.scholarly.aggregator import resolve_identifier
from app.services.scholarly.identifiers import parse_identifier
from app.services.scholarly.models import ScholarlyWork
from app.services.search import search_evidence
from app.services.storage import get_storage, sha256_hex

router = APIRouter(prefix="/papers", tags=["papers"])


async def _in_library(db: DB, user_id: uuid.UUID | None, paper_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if user_id is None or not paper_ids:
        return set()
    rows = await db.execute(
        select(LibraryItem.paper_id).where(LibraryItem.user_id == user_id, LibraryItem.paper_id.in_(paper_ids))
    )
    return set(rows.scalars())


async def _ensure_library(db: DB, user_id: uuid.UUID, paper_id: uuid.UUID) -> None:
    exists = (
        await db.execute(select(LibraryItem.id).where(LibraryItem.user_id == user_id, LibraryItem.paper_id == paper_id))
    ).first()
    if not exists:
        db.add(LibraryItem(user_id=user_id, paper_id=paper_id, tags=[]))
        await db.commit()


@router.get("", response_model=PaperPage)
async def list_papers(
    db: DB,
    user: OptionalUser,
    q: Annotated[str | None, Query(max_length=300)] = None,
    status: PaperStatusFilter | None = None,
    sort: Annotated[str, Query(pattern="^(recent|year|citations|relevance)$")] = "recent",
    page: Annotated[int, Query(ge=1, le=1000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> PaperPage:
    """The catalog of papers imported into PaperAid (public records + your private uploads)."""

    filters = [visible_papers_clause(user)]
    if status:
        filters.append(Paper.status == PaperStatus(status))
    rank = None
    if q and q.strip():
        tsquery = func.websearch_to_tsquery("english", q.strip())
        filters.append(Paper.search_vector.op("@@")(tsquery))
        rank = func.ts_rank_cd(Paper.search_vector, tsquery)
    total = (await db.execute(select(func.count()).select_from(Paper).where(*filters))).scalar_one()
    if sort == "relevance" and rank is not None:
        order = [rank.desc(), Paper.created_at.desc(), Paper.id]
    else:
        order = {
            "recent": [Paper.created_at.desc()],
            "year": [Paper.year.desc().nulls_last(), Paper.created_at.desc()],
            "citations": [Paper.citation_count.desc(), Paper.created_at.desc()],
            "relevance": [Paper.created_at.desc()],
        }[sort] + [Paper.id]  # deterministic tie-breaker keeps pages stable
    stmt = with_authors(select(Paper).where(*filters).order_by(*order).offset((page - 1) * page_size).limit(page_size))
    papers = list((await db.execute(stmt)).scalars().unique())
    library = await _in_library(db, user.id if user else None, [p.id for p in papers])
    return PaperPage(
        items=[PaperOut.build(p, user_id=user.id if user else None, in_library=p.id in library) for p in papers],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/import", response_model=PaperOut, status_code=201)
async def import_paper(body: ImportRequest, db: DB, user: VerifiedUser, settings: AppSettings) -> PaperOut:
    """Import a paper by identifier. Metadata always comes from the registries, never from the client."""
    await enforce_rate_limit(db, key=f"import:{user.id}", limit=60, window_seconds=60, action="imports")
    identifier = parse_identifier(body.identifier)
    if identifier is None:
        raise ValidationFailed("Enter a DOI, PubMed ID, PMC ID or arXiv ID.")
    work = await resolve_identifier(identifier)
    if work is None:
        raise NotFound(f"No publication was found for {identifier.kind.upper()} {identifier.value}.")
    paper = await upsert_public_paper(db, work, created_by=user)
    if body.add_to_library:
        await _ensure_library(db, user.id, paper.id)
    if body.fetch_full_text and paper.status in {PaperStatus.METADATA_ONLY, PaperStatus.FAILED}:
        await processing.queue_ingest(db, paper, user)
        paper = await get_paper_for_user(db, paper.id, user)
    return PaperOut.build(paper, user_id=user.id, in_library=body.add_to_library)


@router.post("/upload", response_model=PaperOut, status_code=201)
async def upload_paper(
    db: DB,
    user: VerifiedUser,
    settings: AppSettings,
    file: Annotated[UploadFile, File(description="PDF file")],
    title: Annotated[str | None, Form(max_length=500)] = None,
    identifier: Annotated[str | None, Form(max_length=500)] = None,
) -> PaperOut:
    """Upload a private PDF. Optionally attach a DOI/PMID so citations use registry metadata."""
    await enforce_rate_limit(
        db, key=f"upload:{user.id}", limit=settings.rate_limit_upload_per_hour, window_seconds=3600, action="uploads"
    )
    data = await file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise PayloadTooLarge(f"PDFs must be {settings.max_upload_mb} MB or smaller.")
    if not data.lstrip()[:5] == b"%PDF-":
        raise ValidationFailed("The uploaded file is not a PDF.")
    work: ScholarlyWork | None = None
    if identifier and identifier.strip():
        parsed = parse_identifier(identifier)
        if parsed is None:
            raise ValidationFailed("The identifier is not a valid DOI, PMID, PMCID or arXiv ID.")
        work = await resolve_identifier(parsed)
    if work is None:
        name = (title or file.filename or "Uploaded document").strip()
        if name.lower().endswith(".pdf"):
            name = name[:-4]
        work = ScholarlyWork(title=name[:500] or "Uploaded document", work_type="article")
    # Re-uploading the same file is idempotent: return the paper it already created (and retry its extraction
    # if that never succeeded, so a re-upload is a way to recover).
    digest = sha256_hex(data)
    existing = await _owned_upload(db, user, digest)
    if existing is not None:
        return await _reuse_upload(db, user, existing)
    await db.commit()  # no DB connection is held while the object is written
    # The object is written first (after a durable upload intent), then ONE transaction creates the paper with
    # its PDF pointer and library entry and clears the intent. Any failure leaves the intent for cleanup.
    paper_id = uuid.uuid4()
    key, digest = await processing.put_pdf(paper_id, data)
    # Concurrent uploads of the same file by the same person are serialized here, and the duplicate check is
    # repeated under the lock: exactly one paper is created; the loser's object is queued for deletion.
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"upload:{user.id}:{digest}"}
    )
    existing = await _owned_upload(db, user, digest)
    if existing is not None:
        await schedule_deletion(db, key)
        await db.commit()
        return await _reuse_upload(db, user, existing)
    paper = await create_private_paper(
        db, owner=user, work=work, source=PaperSource.UPLOAD, commit=False, paper_id=paper_id
    )
    await processing.attach_pdf(db, paper, key, digest, len(data))
    db.add(LibraryItem(user_id=user.id, paper_id=paper.id, tags=[]))
    await db.commit()
    await _start_extraction(db, paper, user)
    paper = await get_paper_for_user(db, paper_id, user)
    return PaperOut.build(paper, user_id=user.id, in_library=True)


EXTRACTION_NOT_STARTED = "Text extraction could not be started. Use “Retry text extraction” on this page."


async def _owned_upload(db: DB, user: User, digest: str) -> uuid.UUID | None:
    return (
        await db.execute(select(Paper.id).where(Paper.owner_id == user.id, Paper.file_sha256 == digest).limit(1))
    ).scalar_one_or_none()


async def _start_extraction(db: DB, paper: Paper, user: User) -> None:
    """Queue text extraction. If it cannot start, the upload still stands: the reason is shown on the paper,
    which offers a retry (failing the upload would only invite a duplicate re-upload)."""
    paper_id = paper.id
    try:
        await processing.queue_ingest(db, paper, user)
    except Conflict:
        pass  # already queued or running
    except AppError:
        await db.execute(update(Paper).where(Paper.id == paper_id).values(status_detail=EXTRACTION_NOT_STARTED))
        await db.commit()
    db.expunge_all()  # queue_ingest may have rolled back: re-read rows fresh instead of using expired objects


async def _reuse_upload(db: DB, user: User, paper_id: uuid.UUID) -> PaperOut:
    await _ensure_library(db, user.id, paper_id)
    paper = await get_paper_for_user(db, paper_id, user)
    if paper.status == PaperStatus.FAILED or paper.status_detail == EXTRACTION_NOT_STARTED:
        await _start_extraction(db, paper, user)
        paper = await get_paper_for_user(db, paper_id, user)
    return PaperOut.build(paper, user_id=user.id, in_library=True)


@router.post("/manual", response_model=PaperOut, status_code=201)
async def add_manual_source(body: ManualSourceIn, db: DB, user: VerifiedUser) -> PaperOut:
    """Add a source that has no registry identifier (book, chapter, report, court case, statute, web page, ...).
    It is private to you and labelled user-supplied; it never enters the shared catalog."""
    await enforce_rate_limit(db, key=f"manual:{user.id}", limit=120, window_seconds=3600, action="manual entries")
    work, extra = manual.to_work(body)
    paper = await create_private_paper(db, owner=user, work=work, source=PaperSource.MANUAL, commit=False)
    paper.csl_extra = extra
    db.add(LibraryItem(user_id=user.id, paper_id=paper.id, tags=[]))
    await db.commit()
    return PaperOut.build(await get_paper_for_user(db, paper.id, user), user_id=user.id, in_library=True)


@router.put("/{paper_id}/manual", response_model=PaperOut)
async def edit_manual_source(paper_id: uuid.UUID, body: ManualSourceIn, db: DB, user: VerifiedUser) -> PaperOut:
    """Correct a source you entered manually (only your own, user-supplied records can be edited)."""
    paper = await get_paper_for_user(db, paper_id, user)
    if not can_manage(paper, user) or paper.metadata_source != "user":
        raise Forbidden("Only sources you entered yourself can be edited.")
    work, extra = manual.to_work(body)
    for field in ("title", "year", "journal", "publisher", "volume", "issue", "pages", "work_type", "url"):
        setattr(paper, field, getattr(work, field))
    paper.csl_extra = extra
    paper.authors.clear()
    await db.flush()
    for position, author in enumerate(await author_rows(db, work)):
        db.add(PaperAuthor(paper_id=paper.id, author_id=author.id, position=position))
    await db.commit()
    return PaperOut.build(await get_paper_for_user(db, paper.id, user), user_id=user.id, in_library=True)


@router.get("/lookup/isbn/{isbn}")
async def lookup_isbn(isbn: str, db: DB, user: VerifiedUser) -> dict[str, object]:
    """Pre-fill a book from its ISBN (Open Library). Nothing is saved until you add the source."""
    await enforce_rate_limit(db, key=f"isbn:{user.id}", limit=60, window_seconds=3600, action="ISBN lookups")
    try:
        cleaned = ManualSourceIn.model_validate({"type": "book", "title": "x", "isbn": isbn}).isbn
    except PydanticValidationError as exc:
        raise ValidationFailed("Enter a 10- or 13-digit ISBN.") from exc
    await db.commit()
    found = await manual.lookup_isbn(cleaned or "")
    if found is None:
        raise NotFound("No book with that ISBN was found in Open Library. You can still enter it manually.")
    return found


@router.get("/{paper_id}", response_model=PaperOut)
async def get_paper(paper_id: uuid.UUID, db: DB, user: OptionalUser) -> PaperOut:
    paper = await get_paper_for_user(db, paper_id, user)
    library = await _in_library(db, user.id if user else None, [paper.id])
    return PaperOut.build(paper, user_id=user.id if user else None, in_library=paper.id in library)


@router.delete("/{paper_id}", status_code=204)
async def delete_paper(paper_id: uuid.UUID, db: DB, user: VerifiedUser) -> Response:
    paper = await get_paper_for_user(db, paper_id, user)
    if not can_manage(paper, user):
        raise Forbidden("Only the owner of an uploaded paper can delete it.")
    storage_path = paper.storage_path
    await schedule_deletion(db, storage_path)  # same transaction as the row delete: never orphaned
    await db.delete(paper)
    await db.commit()
    await delete_now_or_later(db, storage_path)
    return Response(status_code=204)


@router.post("/{paper_id}/full-text", response_model=JobOut, status_code=202)
async def request_full_text(paper_id: uuid.UUID, db: DB, user: VerifiedUser) -> JobOut:
    """Retrieve the open-access PDF (or reprocess the stored one) and extract its text."""
    await enforce_rate_limit(db, key=f"fulltext:{user.id}", limit=30, window_seconds=3600, action="full-text requests")
    paper = await get_paper_for_user(db, paper_id, user)
    if paper.visibility == PaperVisibility.PRIVATE and not can_manage(paper, user):
        raise Forbidden("You cannot process this paper.")
    job = await processing.queue_ingest(db, paper, user)
    return JobOut.model_validate(await db.get(ProcessingJob, job.id))


@router.get("/{paper_id}/jobs", response_model=list[JobOut])
async def paper_jobs(paper_id: uuid.UUID, db: DB, user: OptionalUser) -> list[JobOut]:
    await get_paper_for_user(db, paper_id, user)
    rows = await db.execute(
        select(ProcessingJob)
        .where(ProcessingJob.paper_id == paper_id)
        .order_by(ProcessingJob.created_at.desc())
        .limit(10)
    )
    return [JobOut.model_validate(j) for j in rows.scalars()]


@router.get("/{paper_id}/pdf")
async def paper_pdf(paper_id: uuid.UUID, db: DB, user: VerifiedUser) -> Response:
    """Streams the stored PDF (constant memory). Never cached: access can be revoked at any time."""
    paper = await get_paper_for_user(db, paper_id, user)
    if not paper.storage_path:
        raise NotFound("No PDF is stored for this paper.")
    storage_path, title, size = paper.storage_path, paper.title, paper.file_size
    await db.commit()  # release the DB connection before the (possibly long) transfer
    body = await get_storage().open_stream(storage_path)
    headers = {
        "Content-Disposition": content_disposition(f"{title[:120]}.pdf", disposition="inline"),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }
    if size:
        headers["Content-Length"] = str(size)
    # The stream is closed when the response finishes, fails or the client disconnects (background task).
    return StreamingResponse(
        body, media_type="application/pdf", headers=headers, background=BackgroundTask(body.aclose)
    )


@router.get("/{paper_id}/passages", response_model=list[PassageOut])
async def passages(
    paper_id: uuid.UUID,
    db: DB,
    user: OptionalUser,
    q: Annotated[str | None, Query(max_length=500)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> list[PassageOut]:
    """Search within a paper's full text (or list its first passages)."""
    paper = await get_paper_for_user(db, paper_id, user)
    if paper.status != PaperStatus.READY:
        return []
    if q and q.strip():
        hits = await search_evidence(db, q, [paper.id], limit=limit)
        return [
            PassageOut(
                chunk_id=h.chunk_id, text=h.text, section=h.section, page_start=h.page_start, page_end=h.page_end
            )
            for h in hits
        ]
    rows = await db.execute(
        select(PaperChunk).where(PaperChunk.paper_id == paper.id).order_by(PaperChunk.chunk_index).limit(limit)
    )
    return [
        PassageOut(chunk_id=c.id, text=c.text, section=c.section, page_start=c.page_start, page_end=c.page_end)
        for c in rows.scalars()
    ]


@router.get("/{paper_id}/cite")
async def cite_paper(
    paper_id: uuid.UUID,
    db: DB,
    user: OptionalUser,
    style: Annotated[str, Query()] = "apa",
) -> dict[str, str]:
    if style not in STYLES:
        raise ValidationFailed("Unknown citation style.")
    paper = await get_paper_for_user(db, paper_id, user)
    formatted = await format_citations([to_csl_json(paper)], style=style, clusters=[[{"id": str(paper.id)}]])
    return {
        "style": style,
        "in_text": formatted.citations[0] if formatted.citations else "",
        "bibliography": formatted.bibliography[0] if formatted.bibliography else "",
    }


@router.get("/{paper_id}/summary")
async def get_summary(paper_id: uuid.UUID, db: DB, user: OptionalUser) -> dict[str, object]:
    await get_paper_for_user(db, paper_id, user)
    summary = (await db.execute(select(PaperSummary).where(PaperSummary.paper_id == paper_id))).scalar_one_or_none()
    if summary is None or summary.prompt_version != ai_features.SUMMARY_PROMPT_VERSION:
        raise NotFound("No AI summary has been generated for this paper yet.")
    return {
        "content": summary.content,
        "model": summary.model,
        "created_at": summary.created_at.isoformat(),
        "label": "AI-generated summary. Verify against the cited passages.",
    }


@router.post("/{paper_id}/summary")
async def generate_summary(
    paper_id: uuid.UUID, db: DB, user: VerifiedUser, settings: AppSettings, force: bool = False
) -> dict[str, object]:
    await enforce_rate_limit(
        db, key=f"ai:{user.id}", limit=settings.rate_limit_ai_per_min, window_seconds=60, action="AI requests"
    )
    paper = await get_paper_for_user(db, paper_id, user)
    summary = await ai_features.summarize_paper(db, paper, force=force)
    return {
        "content": summary.content,
        "model": summary.model,
        "created_at": summary.created_at.isoformat(),
        "label": "AI-generated summary. Verify against the cited passages.",
    }


@router.post("/{paper_id}/ask", response_model=GroundedAnswerOut)
async def ask_paper(
    paper_id: uuid.UUID, body: AskRequest, db: DB, user: VerifiedUser, settings: AppSettings
) -> GroundedAnswerOut:
    await enforce_rate_limit(
        db, key=f"ai:{user.id}", limit=settings.rate_limit_ai_per_min, window_seconds=60, action="AI requests"
    )
    paper = await get_paper_for_user(db, paper_id, user)
    return GroundedAnswerOut(**await ai_features.ask_paper(db, paper, body.question))
