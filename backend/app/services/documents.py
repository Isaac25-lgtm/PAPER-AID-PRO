"""Research documents: sanitised rich-text (TipTap/ProseMirror JSON), optimistic-concurrency autosave,
revision history and citation rendering."""

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Document, DocumentCitation, DocumentRevision, DocumentSource, Paper, User
from app.errors import Conflict, NotFound, ValidationFailed
from app.services.citations.csl import format_citations
from app.services.papers import get_papers_for_user, to_csl_json

MAX_CONTENT_BYTES = 2_000_000
REVISION_INTERVAL = timedelta(minutes=10)
MAX_REVISIONS_KEPT = 200

ALLOWED_NODES = {
    "doc",
    "paragraph",
    "heading",
    "text",
    "bulletList",
    "orderedList",
    "listItem",
    "blockquote",
    "hardBreak",
    "horizontalRule",
    "table",
    "tableRow",
    "tableCell",
    "tableHeader",
    "citation",
    "codeBlock",
}
ALLOWED_MARKS = {"bold", "italic", "underline", "strike", "superscript", "subscript", "code", "link"}
_NODE_ATTRS = {
    "heading": {"level"},
    "orderedList": {"start"},
    "tableCell": {"colspan", "rowspan"},
    "tableHeader": {"colspan", "rowspan"},
    "citation": {"citationIds"},
    "paragraph": {"textAlign"},
}
_SAFE_HREF = re.compile(r"^(https?://|mailto:)", re.IGNORECASE)

EMPTY_DOC: dict[str, Any] = {"type": "doc", "content": [{"type": "paragraph"}]}


def sanitize_content(node: Any, depth: int = 0) -> dict[str, Any] | None:
    """Keep only known node types, marks and attributes. Unknown nodes are dropped (their text is kept)."""
    if depth > 60 or not isinstance(node, dict):
        return None
    node_type = node.get("type")
    if node_type == "text":
        text = node.get("text")
        if not isinstance(text, str) or not text:
            return None
        out: dict[str, Any] = {"type": "text", "text": text[:100_000]}
        marks = []
        for mark in node.get("marks") or []:
            if not isinstance(mark, dict) or mark.get("type") not in ALLOWED_MARKS:
                continue
            if mark["type"] == "link":
                href = str((mark.get("attrs") or {}).get("href", ""))
                if not _SAFE_HREF.match(href):
                    continue
                marks.append({"type": "link", "attrs": {"href": href[:2000]}})
            else:
                marks.append({"type": mark["type"]})
        if marks:
            out["marks"] = marks
        return out
    if node_type not in ALLOWED_NODES:
        # Unknown wrapper: keep its children by flattening into a paragraph-compatible list.
        children = [c for c in (sanitize_content(ch, depth + 1) for ch in node.get("content") or []) if c]
        return {"type": "paragraph", "content": children} if children else None
    out = {"type": node_type}
    attrs = {k: v for k, v in (node.get("attrs") or {}).items() if k in _NODE_ATTRS.get(node_type, set())}
    if node_type == "heading":
        attrs["level"] = min(max(int(attrs.get("level", 2) or 2), 1), 4)
    if node_type == "citation":
        ids = [str(i) for i in (attrs.get("citationIds") or []) if isinstance(i, str | int)][:20]
        if not ids:
            return None
        attrs = {"citationIds": ids}
    if attrs:
        out["attrs"] = attrs
    children = [c for c in (sanitize_content(ch, depth + 1) for ch in node.get("content") or []) if c]
    if children:
        out["content"] = children
    return out


def normalise_document(content: Any) -> dict[str, Any]:
    if len(json.dumps(content, ensure_ascii=False)) > MAX_CONTENT_BYTES:
        raise ValidationFailed("Document is too large (2 MB limit).")
    clean = sanitize_content(content)
    if not clean or clean.get("type") != "doc":
        raise ValidationFailed("Document content must be a rich-text 'doc' node.")
    if not clean.get("content"):
        clean["content"] = [{"type": "paragraph"}]
    return clean


def plain_text(node: dict[str, Any]) -> str:
    parts: list[str] = []

    def walk(n: dict[str, Any]) -> None:
        if n.get("type") == "text":
            parts.append(n.get("text", ""))
        elif n.get("type") == "hardBreak":
            parts.append("\n")
        for child in n.get("content") or []:
            walk(child)
        if n.get("type") in {"paragraph", "heading", "listItem", "blockquote", "tableRow", "codeBlock"}:
            parts.append("\n")

    walk(node)
    return re.sub(r"\n{3,}", "\n\n", "".join(parts)).strip()


def word_count(text: str) -> int:
    return len(re.findall(r"\b[\w'-]+\b", text))


def citation_clusters(content: dict[str, Any]) -> list[list[str]]:
    clusters: list[list[str]] = []

    def walk(n: dict[str, Any]) -> None:
        if n.get("type") == "citation":
            clusters.append(list((n.get("attrs") or {}).get("citationIds") or []))
        for child in n.get("content") or []:
            walk(child)

    walk(content)
    return clusters


async def get_owned_document(db: AsyncSession, document_id: uuid.UUID, user: User) -> Document:
    doc = await db.get(Document, document_id)
    if doc is None or doc.user_id != user.id:
        raise NotFound("Document not found.")
    return doc


async def create_document(
    db: AsyncSession, user: User, *, title: str, doc_type: str, csl_style: str, content: dict[str, Any] | None
) -> Document:
    clean = normalise_document(content or EMPTY_DOC)
    text = plain_text(clean)
    doc = Document(
        user_id=user.id,
        title=title.strip()[:300] or "Untitled document",
        doc_type=doc_type,
        csl_style=csl_style,
        content=clean,
        text_content=text,
        word_count=word_count(text),
        version=1,
    )
    db.add(doc)
    await db.flush()
    db.add(
        DocumentRevision(
            document_id=doc.id,
            version=1,
            title=doc.title,
            content=clean,
            word_count=doc.word_count,
            csl_style=csl_style,
            reason="created",
            created_by_id=user.id,
        )
    )
    await db.commit()
    await db.refresh(doc)
    return doc


async def _snapshot(db: AsyncSession, doc: Document, user: User, reason: str) -> None:
    exists = (
        await db.execute(
            select(DocumentRevision.id).where(
                DocumentRevision.document_id == doc.id, DocumentRevision.version == doc.version
            )
        )
    ).first()
    if exists:
        return  # this exact version is already preserved
    db.add(
        DocumentRevision(
            document_id=doc.id,
            version=doc.version,
            title=doc.title,
            content=doc.content,
            word_count=doc.word_count,
            csl_style=doc.csl_style,
            reason=reason,
            created_by_id=user.id,
        )
    )
    await db.flush()
    count = (
        await db.execute(
            select(func.count()).select_from(DocumentRevision).where(DocumentRevision.document_id == doc.id)
        )
    ).scalar_one()
    if count > MAX_REVISIONS_KEPT:
        oldest = (
            await db.execute(
                select(DocumentRevision.id)
                .where(DocumentRevision.document_id == doc.id)
                .order_by(DocumentRevision.version)
                .limit(count - MAX_REVISIONS_KEPT)
            )
        ).scalars()
        await db.execute(delete(DocumentRevision).where(DocumentRevision.id.in_(list(oldest))))


async def save_document(
    db: AsyncSession,
    doc: Document,
    user: User,
    *,
    base_version: int,
    title: str | None,
    content: dict[str, Any] | None,
    csl_style: str | None,
    doc_type: str | None,
    checkpoint: bool,
) -> Document:
    if base_version != doc.version:
        raise Conflict(
            "This document was changed elsewhere since you opened it.", details={"server_version": doc.version}
        )
    if content is not None:
        doc.content = normalise_document(content)
        doc.text_content = plain_text(doc.content)
        doc.word_count = word_count(doc.text_content)
    if title is not None:
        doc.title = title.strip()[:300] or "Untitled document"
    if csl_style is not None:
        doc.csl_style = csl_style
    if doc_type is not None:
        doc.doc_type = doc_type
    doc.version += 1
    last = (
        await db.execute(
            select(DocumentRevision.created_at)
            .where(DocumentRevision.document_id == doc.id)
            .order_by(DocumentRevision.version.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if checkpoint or last is None or datetime.now(UTC) - last >= REVISION_INTERVAL:
        await _snapshot(db, doc, user, "checkpoint" if checkpoint else "autosave")
    await db.commit()
    await db.refresh(doc)
    return doc


async def restore_revision(db: AsyncSession, doc: Document, user: User, revision_id: uuid.UUID) -> Document:
    revision = await db.get(DocumentRevision, revision_id)
    if revision is None or revision.document_id != doc.id:
        raise NotFound("Revision not found.")
    await _snapshot(db, doc, user, "before_restore")
    doc.content, doc.title, doc.csl_style = revision.content, revision.title, revision.csl_style
    doc.text_content = plain_text(doc.content)
    doc.word_count = word_count(doc.text_content)
    doc.version += 1
    await _snapshot(db, doc, user, "restored")
    await db.commit()
    await db.refresh(doc)
    return doc


async def add_source(db: AsyncSession, doc: Document, paper: Paper) -> None:
    exists = await db.get(DocumentSource, (doc.id, paper.id))
    if exists is None:
        db.add(DocumentSource(document_id=doc.id, paper_id=paper.id))
        await db.commit()


async def render_citations(
    db: AsyncSession, doc: Document, user: User, *, style: str | None = None, output: str = "html"
) -> dict[str, Any]:
    """Formatted in-text citations (document order) + bibliography of the works actually cited."""
    style = style or doc.csl_style
    clusters = citation_clusters(doc.content)
    ids = {uuid.UUID(c) for cluster in clusters for c in cluster if _is_uuid(c)}
    citations = (
        {
            str(c.id): c
            for c in (
                await db.execute(
                    select(DocumentCitation).where(DocumentCitation.document_id == doc.id, DocumentCitation.id.in_(ids))
                )
            ).scalars()
        }
        if ids
        else {}
    )
    paper_ids = list(dict.fromkeys(c.paper_id for c in citations.values()))
    papers = {p.id: p for p in await get_papers_for_user(db, paper_ids, user)}
    valid_clusters: list[list[dict[str, Any]]] = []
    cluster_keys: list[list[str]] = []
    for cluster in clusters:
        entries, keys = [], []
        for cid in cluster:
            citation = citations.get(cid)
            if citation is None or citation.paper_id not in papers:
                continue
            entry: dict[str, Any] = {"id": str(citation.paper_id)}
            if citation.locator:
                entry.update(locator=citation.locator, label=citation.label)
            if citation.prefix:
                entry["prefix"] = citation.prefix
            if citation.suffix:
                entry["suffix"] = citation.suffix
            entries.append(entry)
            keys.append(cid)
        if entries:
            valid_clusters.append(entries)
            cluster_keys.append(keys)
    if not valid_clusters:
        return {"style": style, "clusters": [], "bibliography": []}
    items = [to_csl_json(papers[pid]) for pid in paper_ids if pid in papers]
    formatted = await format_citations(
        items, style=style, clusters=valid_clusters, bibliography=True, output="text" if output == "text" else "html"
    )
    return {
        "style": style,
        "clusters": [
            {"citation_ids": keys, "text": text} for keys, text in zip(cluster_keys, formatted.citations, strict=False)
        ],
        "bibliography": formatted.bibliography,
    }


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True
