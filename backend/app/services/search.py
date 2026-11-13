"""Evidence retrieval over extracted paper passages.

Hybrid retrieval: Postgres full-text search (always available) fused with pgvector cosine similarity when an
embedding provider is configured and the passages have embeddings. Reciprocal-rank fusion combines both lists.
References/acknowledgement sections are excluded from evidence.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import func, literal_column, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Paper, PaperChunk
from app.services.ai.providers import get_embedder
from app.services.pdf import NON_EVIDENCE_SECTIONS

RRF_K = 60


@dataclass
class Evidence:
    chunk_id: uuid.UUID
    paper_id: uuid.UUID
    text: str
    section: str | None
    page_start: int | None
    page_end: int | None
    score: float


async def _fts(db: AsyncSession, query: str, paper_ids: list[uuid.UUID], limit: int) -> list[PaperChunk]:
    tsquery = func.websearch_to_tsquery("english", query)
    # Fall back to OR semantics so long natural-language questions still match partially.
    or_query = func.to_tsquery(
        "english",
        func.array_to_string(
            func.regexp_split_to_array(func.trim(func.regexp_replace(query, r"[^\w\s]", " ", "g")), r"\s+"), " | "
        ),
    )
    rank = func.ts_rank_cd(PaperChunk.text_search, or_query)
    stmt = (
        select(PaperChunk)
        .where(
            PaperChunk.paper_id.in_(paper_ids),
            or_(PaperChunk.text_search.op("@@")(tsquery), PaperChunk.text_search.op("@@")(or_query)),
            (PaperChunk.section.is_(None)) | (PaperChunk.section.notin_(NON_EVIDENCE_SECTIONS)),
        )
        .order_by(rank.desc(), PaperChunk.chunk_index)
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars())


async def _vector(db: AsyncSession, query: str, paper_ids: list[uuid.UUID], limit: int) -> list[PaperChunk]:
    embedder = get_embedder()
    if embedder is None:
        return []
    [vector] = await embedder.embed([query], task="query")
    distance = PaperChunk.embedding.cosine_distance(vector)
    stmt = (
        select(PaperChunk)
        .where(
            PaperChunk.paper_id.in_(paper_ids),
            PaperChunk.embedding.is_not(None),
            (PaperChunk.section.is_(None)) | (PaperChunk.section.notin_(NON_EVIDENCE_SECTIONS)),
        )
        .order_by(distance)
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars())


async def search_evidence(
    db: AsyncSession, query: str, paper_ids: list[uuid.UUID], *, limit: int = 8, per_paper_cap: int | None = None
) -> list[Evidence]:
    if not paper_ids or not query.strip():
        return []
    candidates = max(limit * 4, 24)
    fused: dict[uuid.UUID, float] = {}
    chunks: dict[uuid.UUID, PaperChunk] = {}
    for result in (await _fts(db, query, paper_ids, candidates), await _vector(db, query, paper_ids, candidates)):
        for rank, chunk in enumerate(result):
            chunks[chunk.id] = chunk
            fused[chunk.id] = fused.get(chunk.id, 0.0) + 1.0 / (RRF_K + rank + 1)
    ordered = sorted(fused, key=lambda cid: fused[cid], reverse=True)
    picked: list[Evidence] = []
    per_paper: dict[uuid.UUID, int] = {}
    for cid in ordered:
        chunk = chunks[cid]
        if per_paper_cap and per_paper.get(chunk.paper_id, 0) >= per_paper_cap:
            continue
        per_paper[chunk.paper_id] = per_paper.get(chunk.paper_id, 0) + 1
        picked.append(
            Evidence(chunk.id, chunk.paper_id, chunk.text, chunk.section, chunk.page_start, chunk.page_end, fused[cid])
        )
        if len(picked) >= limit:
            break
    return picked


async def leading_chunks(db: AsyncSession, paper_id: uuid.UUID, limit: int) -> list[Evidence]:
    """The first passages of a paper (abstract/introduction) for whole-paper tasks like summaries."""
    stmt = (
        select(PaperChunk)
        .where(
            PaperChunk.paper_id == paper_id,
            (PaperChunk.section.is_(None)) | (PaperChunk.section.notin_(NON_EVIDENCE_SECTIONS)),
        )
        .order_by(PaperChunk.chunk_index)
        .limit(limit)
    )
    return [
        Evidence(c.id, c.paper_id, c.text, c.section, c.page_start, c.page_end, 0.0)
        for c in (await db.execute(stmt)).scalars()
    ]


async def search_catalog_ids(db: AsyncSession, query: str, visible_clause: object, limit: int) -> list[uuid.UUID]:
    tsquery = func.websearch_to_tsquery("english", query)
    stmt = (
        select(Paper.id)
        .where(visible_clause, Paper.search_vector.op("@@")(tsquery))  # type: ignore[arg-type]
        .order_by(func.ts_rank_cd(Paper.search_vector, tsquery).desc(), literal_column("1"))
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars())
