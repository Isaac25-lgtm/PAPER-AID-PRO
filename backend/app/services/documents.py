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
from app.errors import Conflict, NotFound, UpstreamError, ValidationFailed
from app.services.citations.csl import format_citations
from app.services.papers import get_papers_for_user, to_csl_json

MAX_CONTENT_BYTES = 2_000_000
REVISION_INTERVAL = timedelta(minutes=10)
MAX_REVISIONS_KEPT = 200

MAX_NODES = 50_000
MAX_DEPTH = 40

# A small ProseMirror-style schema: what each node may contain. Anything else is normalised or rejected.
BLOCK_NODES = {
    "paragraph",
    "heading",
    "bulletList",
    "orderedList",
    "blockquote",
    "horizontalRule",
    "table",
    "codeBlock",
}
INLINE_NODES = {"text", "hardBreak", "citation"}
_CONTENT: dict[str, str] = {
    "doc": "block",
    "paragraph": "inline",
    "heading": "inline",
    "codeBlock": "text",
    "blockquote": "block",
    "bulletList": "listItem",
    "orderedList": "listItem",
    "listItem": "block",
    "table": "tableRow",
    "tableRow": "cell",
    "tableCell": "block",
    "tableHeader": "block",
    "horizontalRule": "none",
}
ALLOWED_MARKS = {"bold", "italic", "underline", "strike", "superscript", "subscript", "code", "link"}
_ALIGN = {"left", "center", "right", "justify"}
_SAFE_HREF = re.compile(r"^(https?://|mailto:)", re.IGNORECASE)

EMPTY_DOC: dict[str, Any] = {"type": "doc", "content": [{"type": "paragraph"}]}


def _int(value: Any, default: int, low: int, high: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        return default
    return min(max(number, low), high)


class _Sanitizer:
    """Normalises untrusted editor JSON into a tree that TipTap and both exporters can render."""

    def __init__(self) -> None:
        self.count = 0

    def tick(self, depth: int) -> None:
        self.count += 1
        if self.count > MAX_NODES:
            raise ValidationFailed(f"Document is too complex (more than {MAX_NODES:,} elements).")
        if depth > MAX_DEPTH:
            raise ValidationFailed("Document nesting is too deep.")

    @staticmethod
    def children(node: dict[str, Any]) -> list[Any]:
        content = node.get("content")
        return content if isinstance(content, list) else []

    @staticmethod
    def marks(raw: Any) -> list[dict[str, Any]]:
        marks: list[dict[str, Any]] = []
        if not isinstance(raw, list):
            return marks
        seen: set[str] = set()
        for mark in raw:
            if not isinstance(mark, dict) or mark.get("type") not in ALLOWED_MARKS or mark["type"] in seen:
                continue
            seen.add(mark["type"])
            if mark["type"] == "link":
                attrs = mark.get("attrs") if isinstance(mark.get("attrs"), dict) else {}
                href = attrs.get("href") if isinstance(attrs.get("href"), str) else ""
                if _SAFE_HREF.match(href):
                    marks.append({"type": "link", "attrs": {"href": href[:2000]}})
            else:
                marks.append({"type": mark["type"]})
        return marks

    def inline(self, nodes: list[Any], depth: int, *, plain: bool = False) -> list[dict[str, Any]]:
        """Inline content. `plain` (code blocks) keeps text only, without marks, breaks or citations."""
        out: list[dict[str, Any]] = []
        for node in nodes:
            if not isinstance(node, dict):
                continue
            self.tick(depth)
            kind = node.get("type")
            if kind == "text":
                text = node.get("text")
                if isinstance(text, str) and text:
                    item: dict[str, Any] = {"type": "text", "text": text[:100_000]}
                    node_marks = [] if plain else self.marks(node.get("marks"))
                    if node_marks:
                        item["marks"] = node_marks
                    out.append(item)
            elif kind == "hardBreak" and not plain:
                out.append({"type": "hardBreak"})
            elif kind == "citation" and not plain:
                attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
                raw_ids = attrs.get("citationIds")
                ids = (
                    [str(i)[:64] for i in raw_ids if isinstance(i, str | int)][:20] if isinstance(raw_ids, list) else []
                )
                if ids:
                    out.append({"type": "citation", "attrs": {"citationIds": ids}})
            else:  # a block (or unknown) node in inline position: keep its text, drop the structure
                out.extend(self.inline(self.children(node), depth + 1, plain=plain))
        return out

    def blocks(self, nodes: list[Any], depth: int) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        loose: list[Any] = []

        def flush_loose() -> None:
            if loose:
                content = self.inline(list(loose), depth + 1)
                if content:
                    out.append({"type": "paragraph", "content": content})
                loose.clear()

        for node in nodes:
            if not isinstance(node, dict):
                continue
            kind = node.get("type")
            if kind in INLINE_NODES:
                loose.append(node)
                continue
            flush_loose()
            if kind in BLOCK_NODES:
                block = self.node(node, depth + 1)
                if block is not None:
                    out.append(block)
            elif kind == "listItem":
                item = self.node(node, depth + 1)
                if item is not None:
                    out.append({"type": "bulletList", "content": [item]})
            else:  # unknown wrapper (or misplaced table part): keep its children
                self.tick(depth)
                out.extend(self.blocks(self.children(node), depth + 1))
        flush_loose()
        return out

    def node(self, node: dict[str, Any], depth: int) -> dict[str, Any] | None:
        self.tick(depth)
        kind = node["type"]
        attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
        children = self.children(node)
        out: dict[str, Any] = {"type": kind}
        if kind == "heading":
            out["attrs"] = {"level": _int(attrs.get("level"), 2, 1, 4)}
        elif kind == "paragraph" and attrs.get("textAlign") in _ALIGN:
            out["attrs"] = {"textAlign": attrs["textAlign"]}
        elif kind == "orderedList" and "start" in attrs:
            out["attrs"] = {"start": _int(attrs.get("start"), 1, 1, 10_000)}
        elif kind in {"tableCell", "tableHeader"}:
            cell = {k: _int(attrs.get(k), 1, 1, 50) for k in ("colspan", "rowspan") if k in attrs}
            if cell:
                out["attrs"] = cell

        rule = _CONTENT.get(kind, "none")
        content: list[dict[str, Any]] = []
        if rule == "inline":
            content = self.inline(children, depth + 1)
        elif rule == "text":
            content = self.inline(children, depth + 1, plain=True)
        elif rule == "block":
            content = self.blocks(children, depth + 1)
            if kind in {"listItem", "tableCell", "tableHeader"} and (not content or content[0]["type"] != "paragraph"):
                content.insert(0, {"type": "paragraph"})
        elif rule == "listItem":
            for child in children:
                if not isinstance(child, dict):
                    continue
                if child.get("type") == "listItem":
                    item = self.node(child, depth + 1)
                    if item is not None:
                        content.append(item)
                else:
                    wrapped = self.blocks([child], depth + 1)
                    if wrapped:
                        if wrapped[0]["type"] != "paragraph":
                            wrapped.insert(0, {"type": "paragraph"})
                        content.append({"type": "listItem", "content": wrapped})
            if not content:
                return None
        elif rule == "tableRow":
            for child in children:
                if isinstance(child, dict) and child.get("type") == "tableRow":
                    row = self.node(child, depth + 1)
                    if row is not None:
                        content.append(row)
            if not content:
                return None
        elif rule == "cell":
            for child in children:
                if not isinstance(child, dict):
                    continue
                if child.get("type") in {"tableCell", "tableHeader"}:
                    cell_node = self.node(child, depth + 1)
                    if cell_node is not None:
                        content.append(cell_node)
                else:
                    blocks = self.blocks([child], depth + 1)
                    if not blocks or blocks[0]["type"] != "paragraph":
                        blocks.insert(0, {"type": "paragraph"})
                    content.append({"type": "tableCell", "content": blocks})
            if not content:
                return None
        if content:
            out["content"] = content
        return out


def sanitize_content(node: Any) -> dict[str, Any] | None:
    """Keep only known node types, marks and attributes, in valid parent/child positions."""
    if not isinstance(node, dict) or node.get("type") != "doc":
        return None
    sanitizer = _Sanitizer()
    return {"type": "doc", "content": sanitizer.blocks(sanitizer.children(node), 1)}


def normalise_document(content: Any) -> dict[str, Any]:
    try:
        size = len(json.dumps(content, ensure_ascii=False))
    except (TypeError, ValueError) as exc:
        raise ValidationFailed("Document content is not valid JSON.") from exc
    if size > MAX_CONTENT_BYTES:
        raise ValidationFailed("Document is too large (2 MB limit).")
    clean = sanitize_content(content)
    if not clean:
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


async def get_owned_document(db: AsyncSession, document_id: uuid.UUID, user: User, *, lock: bool = False) -> Document:
    """Load a document the user owns. `lock=True` takes a row lock (SELECT ... FOR UPDATE) for the rest of the
    transaction, so concurrent writers are serialised and each sees the version the previous one committed."""
    stmt = select(Document).where(Document.id == document_id).execution_options(populate_existing=True)
    if lock:
        stmt = stmt.with_for_update()
    doc = (await db.execute(stmt)).scalar_one_or_none()
    if doc is None or doc.user_id != user.id:
        raise NotFound("Document not found.")
    return doc


def _check_version(doc: Document, base_version: int | None) -> None:
    if base_version is not None and base_version != doc.version:
        raise Conflict(
            "This document was changed elsewhere since you opened it.", details={"server_version": doc.version}
        )


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
    """`doc` must have been loaded with lock=True (the route does this) so the version check is race-free."""
    _check_version(doc, base_version)
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


async def restore_revision(
    db: AsyncSession, doc: Document, user: User, revision_id: uuid.UUID, *, base_version: int | None = None
) -> Document:
    """`doc` must be row-locked. With `base_version`, the restore only applies to the version the user saw."""
    _check_version(doc, base_version)
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
    """One entry per citation node, in document order, plus the bibliography of the works actually cited.

    Every node keeps its own entry even when its sources are gone (text=None, missing_ids listed), so exporters
    and the editor can never shift a formatted citation onto the wrong claim."""
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
    entries: list[dict[str, Any]] = []
    formattable: list[list[dict[str, Any]]] = []
    for cluster in clusters:
        items, missing = [], []
        for cid in cluster:
            citation = citations.get(cid)
            if citation is None or citation.paper_id not in papers:
                missing.append(cid)
                continue
            item: dict[str, Any] = {"id": str(citation.paper_id)}
            if citation.locator:
                item.update(locator=citation.locator, label=citation.label)
            if citation.prefix:
                item["prefix"] = citation.prefix
            if citation.suffix:
                item["suffix"] = citation.suffix
            items.append(item)
        entry: dict[str, Any] = {"citation_ids": cluster, "text": None, "missing_ids": missing}
        if items:
            entry["_slot"] = len(formattable)
            formattable.append(items)
        entries.append(entry)
    bibliography: list[str] = []
    if formattable:
        csl_items = [to_csl_json(papers[pid]) for pid in paper_ids if pid in papers]
        formatted = await format_citations(
            csl_items,
            style=style,
            clusters=formattable,
            bibliography=True,
            output="text" if output == "text" else "html",
        )
        if len(formatted.citations) != len(formattable):
            raise UpstreamError("The citation engine returned an unexpected number of citations.")
        bibliography = formatted.bibliography
        for entry in entries:
            if "_slot" in entry:
                entry["text"] = formatted.citations[entry.pop("_slot")]
    return {"style": style, "clusters": entries, "bibliography": bibliography}


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True
