"""Account lifecycle: consent records, data export and account closure (self-service and operator script).

Closure order (each step idempotent, so a re-run after a partial failure completes the job):
1. Tombstone the Firebase UID and deactivate the account (committed first): from this moment every request with
   that identity is refused, including still-valid ID tokens, and the profile can never be re-created.
2. Delete the Firebase sign-in identity (also revokes refresh tokens).
3. In ONE transaction: record the stored PDFs for deletion and delete the user (cascades to owned rows).
   Consent records are kept with the user link removed, as evidence of what was agreed.
4. Delete the stored objects now; failures stay queued for maintenance.
"""

from __future__ import annotations

import json
import tempfile
import zipfile
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, exists, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import (
    ClosedAccount,
    ConsentRecord,
    Conversation,
    Document,
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
from app.services.papers import to_csl_json
from app.services.storage import get_storage


@dataclass
class ClosureResult:
    papers_deleted: int
    files_deleted: int
    identity_deleted: bool


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
    # 1. Refuse the identity everywhere before touching data.
    await db.execute(insert(ClosedAccount).values(firebase_uid=uid).on_conflict_do_nothing())
    user.is_active = False
    await db.commit()
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
    await db.commit()
    # 4. Objects.
    removed = await process_deletions(db, limit=len(paths) or 1, keys=paths) if paths else 0
    return ClosureResult(
        papers_deleted=len(private) + len(public), files_deleted=removed, identity_deleted=identity_deleted
    )


async def export_account(db: AsyncSession, user: User) -> tempfile.SpooledTemporaryFile[bytes]:
    """A ZIP of everything the person created: profile, consents, library (BibTeX + CSL-JSON), documents
    (structured JSON and Word), research conversations and their uploaded PDFs."""
    from app.services.documents import render_citations
    from app.services.export import to_docx

    buffer: tempfile.SpooledTemporaryFile[bytes] = tempfile.SpooledTemporaryFile(max_size=64 * 1024 * 1024)
    storage = get_storage()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:

        def write_json(name: str, value: Any) -> None:
            archive.writestr(name, json.dumps(value, ensure_ascii=False, indent=2, default=str))

        write_json(
            "profile.json",
            {
                "email": user.email,
                "name": user.name,
                "created_at": user.created_at,
                "role": user.role.value,
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
                    .where(LibraryItem.user_id == user.id)
                    .options(
                        selectinload(LibraryItem.paper).selectinload(Paper.authors).selectinload(PaperAuthor.author)
                    )
                )
            ).scalars()
        )
        csl = [to_csl_json(i.paper) for i in items]
        archive.writestr("library/library.bib", to_bibtex(csl))
        write_json("library/library.csl.json", csl)
        write_json("library/notes.json", [{"paper": i.paper.title, "notes": i.notes, "tags": i.tags} for i in items])
        for item in items:
            paper = item.paper
            if paper.owner_id == user.id and paper.storage_path:
                try:
                    archive.writestr(f"uploads/{paper.id}.pdf", await storage.get(paper.storage_path))
                except Exception:  # a missing object must not block the rest of the export
                    archive.writestr(f"uploads/{paper.id}.MISSING.txt", "This file could not be read from storage.")
        documents = list((await db.execute(select(Document).where(Document.user_id == user.id))).scalars())
        for doc in documents:
            write_json(
                f"documents/{doc.id}.json", {"title": doc.title, "type": doc.doc_type.value, "content": doc.content}
            )
            rendered = await render_citations(db, doc, user, output="text")
            archive.writestr(f"documents/{doc.id}.docx", to_docx(doc.title, doc.content, rendered))
        conversations = list((await db.execute(select(Conversation).where(Conversation.user_id == user.id))).scalars())
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
                    "title": convo.title,
                    "messages": [
                        {"role": m.role.value, "content": m.content, "citations": m.citations, "at": m.created_at}
                        for m in messages
                    ],
                },
            )
        archive.writestr(
            "README.txt",
            "Your PaperAid Pro data export.\n\nlibrary/: your references (BibTeX for Zotero, Mendeley, EndNote; "
            "CSL-JSON)\ndocuments/: each document as Word and as structured JSON\nresearch/: your research "
            "conversations\nuploads/: PDFs you uploaded\nconsents.json: what you agreed to and when\n",
        )
    buffer.seek(0)
    return buffer
