"""Personal library, collections, and BibTeX/RIS/CSL-JSON import & export."""

from __future__ import annotations

import json
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, File, Query, Response, UploadFile
from sqlalchemy import any_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import DB
from app.db.models import Collection, CollectionPaper, LibraryItem, Paper, PaperAuthor, PaperSource
from app.errors import Conflict, NotFound, PayloadTooLarge, ValidationFailed
from app.schemas import (
    CollectionIn,
    CollectionOut,
    ImportResult,
    LibraryAdd,
    LibraryItemOut,
    LibraryUpdate,
    PaperOut,
)
from app.security.auth import VerifiedUser
from app.security.rate_limit import enforce_rate_limit
from app.services.citations.interchange import parse_bibtex, parse_ris, to_bibtex, to_ris
from app.services.papers import create_private_paper, get_paper_for_user, to_csl_json, upsert_public_paper

router = APIRouter(tags=["library"])
MAX_IMPORT_BYTES = 5 * 1024 * 1024


async def _get_item(db: DB, user_id: uuid.UUID, paper_id: uuid.UUID) -> LibraryItem:
    item = (
        await db.execute(select(LibraryItem).where(LibraryItem.user_id == user_id, LibraryItem.paper_id == paper_id))
    ).scalar_one_or_none()
    if item is None:
        raise NotFound("That paper is not in your library.")
    return item


async def _get_collection(db: DB, user_id: uuid.UUID, collection_id: uuid.UUID) -> Collection:
    collection = await db.get(Collection, collection_id)
    if collection is None or collection.user_id != user_id:
        raise NotFound("Collection not found.")
    return collection


@router.get("/library", response_model=list[LibraryItemOut])
async def list_library(
    db: DB,
    user: VerifiedUser,
    collection_id: uuid.UUID | None = None,
    tag: Annotated[str | None, Query(max_length=50)] = None,
) -> list[LibraryItemOut]:
    stmt = (
        select(LibraryItem)
        .where(LibraryItem.user_id == user.id)
        .options(selectinload(LibraryItem.paper).selectinload(Paper.authors).joinedload(PaperAuthor.author))
        .order_by(LibraryItem.created_at.desc())
    )
    if collection_id:
        await _get_collection(db, user.id, collection_id)
        stmt = stmt.join(
            CollectionPaper,
            (CollectionPaper.paper_id == LibraryItem.paper_id) & (CollectionPaper.collection_id == collection_id),
        )
    if tag:
        stmt = stmt.where(tag == any_(LibraryItem.tags))
    items = list((await db.execute(stmt)).scalars().unique())
    memberships: dict[uuid.UUID, list[uuid.UUID]] = {}
    if items:
        rows = await db.execute(
            select(CollectionPaper.paper_id, CollectionPaper.collection_id)
            .join(Collection, Collection.id == CollectionPaper.collection_id)
            .where(Collection.user_id == user.id, CollectionPaper.paper_id.in_([i.paper_id for i in items]))
        )
        for paper_id, cid in rows:
            memberships.setdefault(paper_id, []).append(cid)
    return [
        LibraryItemOut(
            paper=PaperOut.build(i.paper, user_id=user.id, in_library=True),
            notes=i.notes,
            tags=i.tags,
            collection_ids=memberships.get(i.paper_id, []),
            added_at=i.created_at,
        )
        for i in items
    ]


@router.post("/library", response_model=LibraryItemOut, status_code=201)
async def add_to_library(body: LibraryAdd, db: DB, user: VerifiedUser) -> LibraryItemOut:
    paper = await get_paper_for_user(db, body.paper_id, user)
    item = LibraryItem(user_id=user.id, paper_id=paper.id, tags=[])
    db.add(item)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise Conflict("This paper is already in your library.") from exc
    return LibraryItemOut(
        paper=PaperOut.build(paper, user_id=user.id, in_library=True),
        notes=None,
        tags=[],
        collection_ids=[],
        added_at=item.created_at,
    )


@router.patch("/library/{paper_id}", response_model=LibraryItemOut)
async def update_library_item(paper_id: uuid.UUID, body: LibraryUpdate, db: DB, user: VerifiedUser) -> LibraryItemOut:
    item = await _get_item(db, user.id, paper_id)
    if body.notes is not None:
        item.notes = body.notes
    if body.tags is not None:
        item.tags = body.tags
    await db.commit()
    paper = await get_paper_for_user(db, paper_id, user)
    return LibraryItemOut(
        paper=PaperOut.build(paper, user_id=user.id, in_library=True),
        notes=item.notes,
        tags=item.tags,
        collection_ids=[],
        added_at=item.created_at,
    )


@router.delete("/library/{paper_id}", status_code=204)
async def remove_from_library(paper_id: uuid.UUID, db: DB, user: VerifiedUser) -> Response:
    item = await _get_item(db, user.id, paper_id)
    await db.delete(item)
    collection_ids = select(Collection.id).where(Collection.user_id == user.id)
    for link in (
        await db.execute(
            select(CollectionPaper).where(
                CollectionPaper.paper_id == paper_id, CollectionPaper.collection_id.in_(collection_ids)
            )
        )
    ).scalars():
        await db.delete(link)
    await db.commit()
    return Response(status_code=204)


@router.post("/library/import", response_model=ImportResult)
async def import_references(db: DB, user: VerifiedUser, file: Annotated[UploadFile, File()]) -> ImportResult:
    """Import a BibTeX (.bib) or RIS (.ris) file. Entries with a DOI/PMID become shared public records;
    entries without registry identifiers become private records owned by you."""
    await enforce_rate_limit(db, key=f"bibimport:{user.id}", limit=10, window_seconds=3600, action="imports")
    data = await file.read(MAX_IMPORT_BYTES + 1)
    if len(data) > MAX_IMPORT_BYTES:
        raise PayloadTooLarge("Reference files must be 5 MB or smaller.")
    text = data.decode("utf-8", errors="replace")
    name = (file.filename or "").lower()
    if name.endswith(".ris") or text.lstrip().startswith("TY  -"):
        works = parse_ris(text)
    elif name.endswith(".bib") or "@" in text[:2000]:
        works = parse_bibtex(text)
    else:
        raise ValidationFailed("Upload a BibTeX (.bib) or RIS (.ris) file.")
    imported, skipped, errors = 0, 0, []
    for work in works:
        try:
            if work.doi or work.pmid or work.arxiv_id:
                paper = await upsert_public_paper(db, work, created_by=user)
            else:
                paper = await create_private_paper(db, owner=user, work=work, source=PaperSource.IMPORT_FILE)
            exists = (
                await db.execute(
                    select(LibraryItem.id).where(LibraryItem.user_id == user.id, LibraryItem.paper_id == paper.id)
                )
            ).first()
            if exists:
                skipped += 1
                continue
            db.add(LibraryItem(user_id=user.id, paper_id=paper.id, tags=[]))
            await db.commit()
            imported += 1
        except Exception as exc:  # one bad entry must not abort the whole import
            await db.rollback()
            errors.append(f"{work.title[:80]}: {getattr(exc, 'message', 'could not be imported')}")
    return ImportResult(imported=imported, skipped=skipped, errors=errors[:50])


@router.get("/library/export")
async def export_library(
    db: DB,
    user: VerifiedUser,
    format: Literal["bibtex", "ris", "csl-json"] = "bibtex",
    collection_id: uuid.UUID | None = None,
) -> Response:
    stmt = (
        select(LibraryItem)
        .where(LibraryItem.user_id == user.id)
        .options(selectinload(LibraryItem.paper).selectinload(Paper.authors).joinedload(PaperAuthor.author))
        .order_by(LibraryItem.created_at)
    )
    if collection_id:
        await _get_collection(db, user.id, collection_id)
        stmt = stmt.join(
            CollectionPaper,
            (CollectionPaper.paper_id == LibraryItem.paper_id) & (CollectionPaper.collection_id == collection_id),
        )
    items = [to_csl_json(i.paper) for i in (await db.execute(stmt)).scalars().unique()]
    if format == "bibtex":
        body, media, ext = to_bibtex(items), "application/x-bibtex", "bib"
    elif format == "ris":
        body, media, ext = to_ris(items), "application/x-research-info-systems", "ris"
    else:
        body, media, ext = (
            json.dumps(items, ensure_ascii=False, indent=2),
            "application/vnd.citationstyles.csl+json",
            "json",
        )
    return Response(
        content=body,
        media_type=f"{media}; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="paperaid-library.{ext}"'},
    )


# ---------------------------------------------------------------------------------------------- collections
@router.get("/collections", response_model=list[CollectionOut])
async def list_collections(db: DB, user: VerifiedUser) -> list[CollectionOut]:
    counts = (
        select(CollectionPaper.collection_id, func.count().label("n"))
        .group_by(CollectionPaper.collection_id)
        .subquery()
    )
    rows = await db.execute(
        select(Collection, func.coalesce(counts.c.n, 0))
        .outerjoin(counts, counts.c.collection_id == Collection.id)
        .where(Collection.user_id == user.id)
        .order_by(Collection.name)
    )
    return [CollectionOut.model_validate(c).model_copy(update={"paper_count": n}) for c, n in rows]


@router.post("/collections", response_model=CollectionOut, status_code=201)
async def create_collection(body: CollectionIn, db: DB, user: VerifiedUser) -> CollectionOut:
    collection = Collection(user_id=user.id, name=body.name.strip(), description=body.description, color=body.color)
    db.add(collection)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise Conflict("You already have a collection with that name.") from exc
    return CollectionOut.model_validate(collection)


@router.patch("/collections/{collection_id}", response_model=CollectionOut)
async def update_collection(collection_id: uuid.UUID, body: CollectionIn, db: DB, user: VerifiedUser) -> CollectionOut:
    collection = await _get_collection(db, user.id, collection_id)
    collection.name, collection.description, collection.color = body.name.strip(), body.description, body.color
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise Conflict("You already have a collection with that name.") from exc
    return CollectionOut.model_validate(collection)


@router.delete("/collections/{collection_id}", status_code=204)
async def delete_collection(collection_id: uuid.UUID, db: DB, user: VerifiedUser) -> Response:
    await db.delete(await _get_collection(db, user.id, collection_id))
    await db.commit()
    return Response(status_code=204)


@router.put("/collections/{collection_id}/papers/{paper_id}", status_code=204)
async def add_to_collection(collection_id: uuid.UUID, paper_id: uuid.UUID, db: DB, user: VerifiedUser) -> Response:
    await _get_collection(db, user.id, collection_id)
    await _get_item(db, user.id, paper_id)  # only papers in your library can be organised
    if await db.get(CollectionPaper, (collection_id, paper_id)) is None:
        db.add(CollectionPaper(collection_id=collection_id, paper_id=paper_id))
        await db.commit()
    return Response(status_code=204)


@router.delete("/collections/{collection_id}/papers/{paper_id}", status_code=204)
async def remove_from_collection(collection_id: uuid.UUID, paper_id: uuid.UUID, db: DB, user: VerifiedUser) -> Response:
    await _get_collection(db, user.id, collection_id)
    link = await db.get(CollectionPaper, (collection_id, paper_id))
    if link is not None:
        await db.delete(link)
        await db.commit()
    return Response(status_code=204)
