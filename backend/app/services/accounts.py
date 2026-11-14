"""Account lifecycle: consent records, data export and account closure (self-service and operator script).

Closure order (each step idempotent, so a re-run after a partial failure completes the job):
1. Record the closure request (tombstone) and deactivate the account (committed first): from this moment every
   request with that identity is refused, including still-valid ID tokens, and the profile can never be
   re-created. If any later step fails, the request stays open and maintenance resumes it with back-off.
2. Delete the Firebase sign-in identity (also revokes refresh tokens).
3. In ONE transaction: record the stored PDFs for deletion and delete the user (cascades to owned rows).
   Consent records are kept with the user link removed, as evidence of what was agreed.
4. Delete the stored objects now; failures stay queued for maintenance.
"""

from __future__ import annotations

import json
import logging
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, exists, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import (
    ClosedAccount,
    Collection,
    CollectionPaper,
    ConsentRecord,
    Conversation,
    Document,
    DocumentCitation,
    DocumentRevision,
    LibraryItem,
    Message,
    Paper,
    PaperAuthor,
    PaperVisibility,
    User,
)
from app.policy import POLICY_VERSION
from app.services import identity
from app.services.citations.interchange import to_bibtex
from app.services.maintenance import process_deletions, schedule_deletion
from app.services.papers import to_csl_json, visible_papers_clause
from app.services.storage import get_storage

log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass
class ClosureResult:
    papers_deleted: int
    files_deleted: int
    identity_deleted: bool
    pending: bool = False  # a step failed; maintenance will finish the closure automatically


RESUME_AFTER = timedelta(minutes=5)  # leave an in-progress request alone before maintenance takes over
MAX_RESUME_BACKOFF = timedelta(hours=6)


async def record_consents(
    db: AsyncSession, user: User, granted: dict[str, bool], *, country: str | None = None
) -> None:
    for document, value in granted.items():
        db.add(
            ConsentRecord(
                user_id=user.id,
                firebase_uid=user.firebase_uid,
                document=document,
                version=POLICY_VERSION,
                granted=value,
                country=country,
            )
        )


async def close_account(
    db: AsyncSession, user: User, *, purge_public: bool = False, delete_identity: bool = True
) -> ClosureResult:
    uid, user_id = user.firebase_uid, user.id
    # 1. Refuse the identity everywhere before touching data; the request itself is durable.
    await db.execute(
        insert(ClosedAccount)
        .values(
            firebase_uid=uid,
            user_id=user_id,
            purge_public=purge_public,
            delete_identity=delete_identity,
            not_before=_now() + RESUME_AFTER,
        )
        .on_conflict_do_update(index_elements=["firebase_uid"], set_={"user_id": user_id})
    )
    user.is_active = False
    await db.commit()
    try:
        return await _finish_closure(db, uid, user_id, purge_public=purge_public, delete_identity=delete_identity)
    except Exception as exc:
        await db.rollback()
        await _record_closure_failure(db, uid, exc)
        log.warning("account.closure_pending", extra={"user_id": str(user_id)}, exc_info=True)
        return ClosureResult(papers_deleted=0, files_deleted=0, identity_deleted=False, pending=True)


async def _record_closure_failure(db: AsyncSession, uid: str, exc: Exception) -> None:
    row = await db.get(ClosedAccount, uid)
    if row is not None:
        row.attempts += 1
        row.last_error = repr(exc)[:500]
        row.not_before = _now() + min(timedelta(minutes=2**row.attempts), MAX_RESUME_BACKOFF)
    await db.commit()


async def _finish_closure(
    db: AsyncSession, uid: str, user_id: Any, *, purge_public: bool, delete_identity: bool
) -> ClosureResult:
    # 2. Sign-in identity.
    identity_deleted = await identity.delete_firebase_account(uid) if delete_identity else False
    # 3. Data, with durable storage-deletion records in the same transaction.
    private = list((await db.execute(select(Paper).where(Paper.owner_id == user_id))).scalars())
    public: list[Paper] = []
    if purge_public:
        others_saved = exists().where(LibraryItem.paper_id == Paper.id, LibraryItem.user_id != user_id)
        public = list(
            (
                await db.execute(
                    select(Paper).where(
                        Paper.created_by_id == user_id, Paper.visibility == PaperVisibility.PUBLIC, ~others_saved
                    )
                )
            ).scalars()
        )
    paths = [p.storage_path for p in [*private, *public] if p.storage_path]
    await schedule_deletion(db, *paths)
    if public:
        await db.execute(delete(Paper).where(Paper.id.in_([p.id for p in public])))
    await db.execute(delete(User).where(User.id == user_id))  # cascades; consent records keep user_id NULL
    await db.execute(
        update(ClosedAccount)
        .where(ClosedAccount.firebase_uid == uid)
        .values(completed_at=_now(), last_error=None, not_before=None)
    )
    await db.commit()
    # 4. Objects (anything that fails here stays queued for maintenance).
    removed = await process_deletions(db, limit=len(paths) or 1, keys=paths) if paths else 0
    return ClosureResult(
        papers_deleted=len(private) + len(public), files_deleted=removed, identity_deleted=identity_deleted
    )


async def resume_closures(db: AsyncSession, limit: int = 20) -> int:
    """Finish closure requests that did not complete (identity provider outage, lost connection, ...).
    Each request is claimed with a lease, so concurrent maintenance runs never process the same one."""
    now = _now()
    due = (
        select(ClosedAccount.firebase_uid)
        .where(ClosedAccount.completed_at.is_(None), ClosedAccount.not_before <= now)
        .order_by(ClosedAccount.not_before)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    claimed = list(
        (
            await db.execute(
                update(ClosedAccount)
                .where(ClosedAccount.firebase_uid.in_(due.scalar_subquery()))
                .values(not_before=now + RESUME_AFTER)
                .returning(
                    ClosedAccount.firebase_uid,
                    ClosedAccount.user_id,
                    ClosedAccount.purge_public,
                    ClosedAccount.delete_identity,
                )
            )
        ).all()
    )
    await db.commit()
    completed = 0
    for uid, user_id, purge_public, delete_identity in claimed:
        try:
            await _finish_closure(db, uid, user_id, purge_public=purge_public, delete_identity=delete_identity)
            completed += 1
        except Exception as exc:
            await db.rollback()
            await _record_closure_failure(db, uid, exc)
            log.warning("account.closure_resume_failed", extra={"firebase_uid_suffix": uid[-4:]}, exc_info=True)
    return completed


async def export_account(db: AsyncSession, user: User) -> tempfile.SpooledTemporaryFile[bytes]:
    """A ZIP of everything the person created, all with stable IDs: profile, consents, library (BibTeX, CSL-JSON,
    notes and tags), collections and their papers, documents (structured JSON, Word, revision history and the
    citation records their content refers to), research conversations and every PDF they uploaded (whether or not
    it is still in the library). `manifest.json` lists every file and any that could not be read.

    Only papers the person may CURRENTLY see are included: a stale library link, collection entry or citation never
    discloses another person's private paper."""
    from app.services.documents import render_citations
    from app.services.export import to_docx

    buffer: tempfile.SpooledTemporaryFile[bytes] = tempfile.SpooledTemporaryFile(max_size=64 * 1024 * 1024)
    storage = get_storage()
    visible = visible_papers_clause(user)
    files: list[str] = []
    missing: list[dict[str, str]] = []
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:

        def write(name: str, data: bytes | str) -> None:
            archive.writestr(name, data)
            files.append(name)

        def write_json(name: str, value: Any) -> None:
            write(name, json.dumps(value, ensure_ascii=False, indent=2, default=str))

        write_json(
            "profile.json",
            {
                "id": user.id,
                "email": user.email,
                "name": user.name,
                "created_at": user.created_at,
                "role": user.role.value,
                "accepted_policy_version": user.accepted_policy_version,
                "preferences": user.preferences,
            },
        )
        consents = (
            await db.execute(
                select(ConsentRecord).where(ConsentRecord.user_id == user.id).order_by(ConsentRecord.created_at)
            )
        ).scalars()
        write_json(
            "consents.json",
            [
                {"document": c.document, "version": c.version, "granted": c.granted, "at": c.created_at}
                for c in consents
            ],
        )
        items = list(
            (
                await db.execute(
                    select(LibraryItem)
                    .join(Paper, Paper.id == LibraryItem.paper_id)
                    .where(LibraryItem.user_id == user.id, visible)
                    .order_by(LibraryItem.created_at)
                    .options(
                        selectinload(LibraryItem.paper).selectinload(Paper.authors).selectinload(PaperAuthor.author)
                    )
                )
            ).scalars()
        )
        csl = [to_csl_json(i.paper) for i in items]
        write("library/library.bib", to_bibtex(csl))
        write_json("library/library.csl.json", csl)
        write_json(
            "library/items.json",
            [
                {
                    "paper_id": i.paper_id,
                    "title": i.paper.title,
                    "notes": i.notes,
                    "tags": i.tags,
                    "added_at": i.created_at,
                    "user_supplied": i.paper.metadata_source == "user",
                }
                for i in items
            ],
        )
        collections = list(
            (
                await db.execute(
                    select(Collection).where(Collection.user_id == user.id).order_by(Collection.created_at)
                )
            ).scalars()
        )
        members: dict[Any, list[Any]] = {}
        if collections:
            rows = await db.execute(
                select(CollectionPaper.collection_id, CollectionPaper.paper_id)
                .join(Paper, Paper.id == CollectionPaper.paper_id)
                .where(CollectionPaper.collection_id.in_([c.id for c in collections]), visible)
                .order_by(CollectionPaper.added_at)
            )
            for collection_id, paper_id in rows:
                members.setdefault(collection_id, []).append(paper_id)
        write_json(
            "library/collections.json",
            [
                {
                    "id": c.id,
                    "name": c.name,
                    "description": c.description,
                    "color": c.color,
                    "created_at": c.created_at,
                    "paper_ids": members.get(c.id, []),
                }
                for c in collections
            ],
        )
        # Every PDF this person uploaded, in the library or not.
        owned = list(
            (
                await db.execute(
                    select(Paper)
                    .where(Paper.owner_id == user.id, Paper.storage_path.is_not(None))
                    .order_by(Paper.created_at)
                )
            ).scalars()
        )
        for paper in owned:
            name = f"uploads/{paper.id}.pdf"
            try:
                write(name, await storage.get(paper.storage_path or ""))
            except Exception:  # a missing object must not block the rest of the export
                missing.append({"file": name, "title": paper.title, "reason": "could not be read from storage"})
        documents = list(
            (
                await db.execute(select(Document).where(Document.user_id == user.id).order_by(Document.created_at))
            ).scalars()
        )
        for doc in documents:
            citations = (
                await db.execute(
                    select(DocumentCitation, Paper.title)
                    .join(Paper, Paper.id == DocumentCitation.paper_id)
                    .where(DocumentCitation.document_id == doc.id, visible)
                    .order_by(DocumentCitation.created_at)
                )
            ).all()
            write_json(
                f"documents/{doc.id}.json",
                {
                    "id": doc.id,
                    "title": doc.title,
                    "type": doc.doc_type.value,
                    "citation_style": doc.csl_style,
                    "version": doc.version,
                    "created_at": doc.created_at,
                    "updated_at": doc.updated_at,
                    "content": doc.content,
                    # The content's citation nodes refer to these ids.
                    "citations": [
                        {
                            "id": c.id,
                            "paper_id": c.paper_id,
                            "paper_title": title,
                            "locator": c.locator,
                            "label": c.label,
                            "prefix": c.prefix,
                            "suffix": c.suffix,
                        }
                        for c, title in citations
                    ],
                },
            )
            revisions = (
                await db.execute(
                    select(DocumentRevision)
                    .where(DocumentRevision.document_id == doc.id)
                    .order_by(DocumentRevision.version, DocumentRevision.created_at)
                )
            ).scalars()
            write_json(
                f"documents/{doc.id}.history.json",
                [
                    {
                        "id": r.id,
                        "version": r.version,
                        "title": r.title,
                        "reason": r.reason,
                        "citation_style": r.csl_style,
                        "created_at": r.created_at,
                        "content": r.content,
                    }
                    for r in revisions
                ],
            )
            rendered = await render_citations(db, doc, user, output="text")
            write(f"documents/{doc.id}.docx", to_docx(doc.title, doc.content, rendered))
        conversations = list(
            (
                await db.execute(
                    select(Conversation).where(Conversation.user_id == user.id).order_by(Conversation.created_at)
                )
            ).scalars()
        )
        for convo in conversations:
            messages = (
                await db.execute(
                    select(Message)
                    .where(Message.conversation_id == convo.id)
                    .order_by(Message.turn_index, Message.created_at)
                )
            ).scalars()
            write_json(
                f"research/{convo.id}.json",
                {
                    "id": convo.id,
                    "title": convo.title,
                    "messages": [
                        {"role": m.role.value, "content": m.content, "citations": m.citations, "at": m.created_at}
                        for m in messages
                    ],
                },
            )
        write("README.txt", README)
        archive.writestr(
            "manifest.json",
            json.dumps({"files": [*files, "manifest.json"], "missing": missing}, ensure_ascii=False, indent=2),
        )
    buffer.seek(0)
    return buffer


README = (
    "Your PaperAid Pro data export.\n\n"
    "library/: your references (BibTeX for Zotero, Mendeley, EndNote; CSL-JSON), notes, tags and collections\n"
    "documents/: each document as Word and as structured JSON with its citation records, plus its version history "
    "(*.history.json)\n"
    "research/: your research conversations\n"
    "uploads/: every PDF you uploaded\n"
    "consents.json: what you agreed to and when\n"
    "manifest.json: every file in this archive and any that could not be included\n"
)
