"""Research documents (editor): CRUD, autosave with conflict detection, sources, citations, revisions, export."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Response
from sqlalchemy import select

from app.api.deps import DB
from app.api.downloads import content_disposition
from app.db.models import Document, DocumentCitation, DocumentRevision, DocumentSource, PaperChunk
from app.errors import NotFound, ValidationFailed
from app.schemas import (
    CitationCreate,
    CitationOut,
    DocumentCreate,
    DocumentOut,
    DocumentSummaryOut,
    DocumentUpdate,
    PaperOut,
    RestoreRequest,
    RevisionOut,
    RevisionSummaryOut,
)
from app.security.auth import VerifiedUser
from app.services import documents as svc
from app.services.citations.csl import STYLES
from app.services.export import to_docx, to_pdf
from app.services.papers import get_paper_for_user, get_papers_for_user

router = APIRouter(prefix="/documents", tags=["documents"])


def _check_style(style: str | None) -> None:
    if style is not None and style not in STYLES:
        raise ValidationFailed("Unknown citation style.")


@router.get("", response_model=list[DocumentSummaryOut])
async def list_documents(db: DB, user: VerifiedUser) -> list[DocumentSummaryOut]:
    rows = await db.execute(select(Document).where(Document.user_id == user.id).order_by(Document.updated_at.desc()))
    return [DocumentSummaryOut.model_validate(d) for d in rows.scalars()]


@router.post("", response_model=DocumentOut, status_code=201)
async def create_document(body: DocumentCreate, db: DB, user: VerifiedUser) -> DocumentOut:
    _check_style(body.csl_style)
    doc = await svc.create_document(
        db, user, title=body.title, doc_type=body.doc_type, csl_style=body.csl_style, content=body.content
    )
    return DocumentOut.model_validate(doc)


@router.get("/{document_id}", response_model=DocumentOut)
async def get_document(document_id: uuid.UUID, db: DB, user: VerifiedUser) -> DocumentOut:
    return DocumentOut.model_validate(await svc.get_owned_document(db, document_id, user))


@router.patch("/{document_id}", response_model=DocumentOut)
async def save_document(document_id: uuid.UUID, body: DocumentUpdate, db: DB, user: VerifiedUser) -> DocumentOut:
    """Autosave. `base_version` must equal the current version, otherwise 409 (edited in another tab/device)."""
    _check_style(body.csl_style)
    doc = await svc.get_owned_document(db, document_id, user, lock=True)
    doc = await svc.save_document(
        db,
        doc,
        user,
        base_version=body.base_version,
        title=body.title,
        content=body.content,
        csl_style=body.csl_style,
        doc_type=body.doc_type,
        checkpoint=body.checkpoint,
    )
    return DocumentOut.model_validate(doc)


@router.delete("/{document_id}", status_code=204)
async def delete_document(document_id: uuid.UUID, db: DB, user: VerifiedUser) -> Response:
    await db.delete(await svc.get_owned_document(db, document_id, user))
    await db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------------------------------------- sources
@router.get("/{document_id}/sources", response_model=list[PaperOut])
async def list_sources(document_id: uuid.UUID, db: DB, user: VerifiedUser) -> list[PaperOut]:
    await svc.get_owned_document(db, document_id, user)
    ids = list(
        (
            await db.execute(
                select(DocumentSource.paper_id)
                .where(DocumentSource.document_id == document_id)
                .order_by(DocumentSource.added_at)
            )
        ).scalars()
    )
    return [PaperOut.build(p, user_id=user.id) for p in await get_papers_for_user(db, ids, user)]


@router.put("/{document_id}/sources/{paper_id}", status_code=204)
async def add_source(document_id: uuid.UUID, paper_id: uuid.UUID, db: DB, user: VerifiedUser) -> Response:
    doc = await svc.get_owned_document(db, document_id, user)
    await svc.add_source(db, doc, await get_paper_for_user(db, paper_id, user))
    return Response(status_code=204)


@router.delete("/{document_id}/sources/{paper_id}", status_code=204)
async def remove_source(document_id: uuid.UUID, paper_id: uuid.UUID, db: DB, user: VerifiedUser) -> Response:
    await svc.get_owned_document(db, document_id, user)
    link = await db.get(DocumentSource, (document_id, paper_id))
    if link is not None:
        await db.delete(link)
        await db.commit()
    return Response(status_code=204)


# ----------------------------------------------------------------------------------------------- citations
@router.post("/{document_id}/citations", response_model=CitationOut, status_code=201)
async def create_citation(document_id: uuid.UUID, body: CitationCreate, db: DB, user: VerifiedUser) -> CitationOut:
    """Create a citation record; the editor inserts a citation node referencing the returned id."""
    doc = await svc.get_owned_document(db, document_id, user)
    paper = await get_paper_for_user(db, body.paper_id, user)
    if body.chunk_id is not None:
        chunk = await db.get(PaperChunk, body.chunk_id)
        if chunk is None or chunk.paper_id != paper.id:
            raise ValidationFailed("That passage does not belong to the cited paper.")
    await svc.add_source(db, doc, paper)
    citation = DocumentCitation(document_id=doc.id, **body.model_dump())
    db.add(citation)
    await db.commit()
    return CitationOut.model_validate(citation)


@router.get("/{document_id}/citations", response_model=list[CitationOut])
async def list_citations(document_id: uuid.UUID, db: DB, user: VerifiedUser) -> list[CitationOut]:
    await svc.get_owned_document(db, document_id, user)
    rows = await db.execute(select(DocumentCitation).where(DocumentCitation.document_id == document_id))
    return [CitationOut.model_validate(c) for c in rows.scalars()]


@router.get("/{document_id}/rendered-citations")
async def rendered_citations(
    document_id: uuid.UUID, db: DB, user: VerifiedUser, style: str | None = None
) -> dict[str, object]:
    """In-text citation text for each citation node (document order) and the formatted bibliography."""
    _check_style(style)
    doc = await svc.get_owned_document(db, document_id, user)
    return await svc.render_citations(db, doc, user, style=style)


# ----------------------------------------------------------------------------------------------- revisions
@router.get("/{document_id}/revisions", response_model=list[RevisionSummaryOut])
async def list_revisions(document_id: uuid.UUID, db: DB, user: VerifiedUser) -> list[RevisionSummaryOut]:
    await svc.get_owned_document(db, document_id, user)
    rows = await db.execute(
        select(DocumentRevision)
        .where(DocumentRevision.document_id == document_id)
        .order_by(DocumentRevision.created_at.desc(), DocumentRevision.version.desc())
        .limit(100)
    )
    return [RevisionSummaryOut.model_validate(r) for r in rows.scalars()]


@router.get("/{document_id}/revisions/{revision_id}", response_model=RevisionOut)
async def get_revision(document_id: uuid.UUID, revision_id: uuid.UUID, db: DB, user: VerifiedUser) -> RevisionOut:
    await svc.get_owned_document(db, document_id, user)
    revision = await db.get(DocumentRevision, revision_id)
    if revision is None or revision.document_id != document_id:
        raise NotFound("Revision not found.")
    return RevisionOut.model_validate(revision)


@router.post("/{document_id}/revisions/{revision_id}/restore", response_model=DocumentOut)
async def restore_revision(
    document_id: uuid.UUID, revision_id: uuid.UUID, db: DB, user: VerifiedUser, body: RestoreRequest | None = None
) -> DocumentOut:
    """Restore a revision. Send `base_version` so a restore never silently overwrites newer edits (409 instead)."""
    doc = await svc.get_owned_document(db, document_id, user, lock=True)
    base_version = body.base_version if body else None
    return DocumentOut.model_validate(await svc.restore_revision(db, doc, user, revision_id, base_version=base_version))


# -------------------------------------------------------------------------------------------------- export
@router.get("/{document_id}/export")
async def export_document(
    document_id: uuid.UUID, db: DB, user: VerifiedUser, format: Literal["docx", "pdf"] = "docx"
) -> Response:
    doc = await svc.get_owned_document(db, document_id, user)
    rendered = await svc.render_citations(db, doc, user, output="text")
    if format == "docx":
        body = to_docx(doc.title, doc.content, rendered)
        media = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        body = to_pdf(doc.title, doc.content, rendered)
        media = "application/pdf"
    return Response(
        content=body,
        media_type=media,
        headers={"Content-Disposition": content_disposition(f"{doc.title[:120] or 'document'}.{format}")},
    )
