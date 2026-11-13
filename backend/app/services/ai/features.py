"""AI features. Every function either returns a validated, evidence-grounded result or raises; none fabricate."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Paper, PaperChunk, PaperStatus, PaperSummary
from app.errors import AIOutputInvalid, ValidationFailed
from app.services.ai.grounding import (
    GROUNDING_RULES,
    EvidenceItem,
    GroundedAnswer,
    citation_payload,
    render_evidence,
    validate_grounded,
)
from app.services.ai.providers import get_embedder, get_llm
from app.services.search import leading_chunks, search_evidence

SUMMARY_PROMPT_VERSION = "2026-11-v1"
EMBED_BATCH = 64


# ------------------------------------------------------------------------------------------- embeddings
def embeddings_enabled() -> bool:
    return get_embedder() is not None


async def embed_paper_chunks(db: AsyncSession, paper_id: uuid.UUID) -> int:
    embedder = get_embedder()
    if embedder is None:
        return 0
    rows = list(
        (
            await db.execute(
                select(PaperChunk.id, PaperChunk.text)
                .where(PaperChunk.paper_id == paper_id, PaperChunk.embedding.is_(None))
                .order_by(PaperChunk.chunk_index)
            )
        ).all()
    )
    for start in range(0, len(rows), EMBED_BATCH):
        batch = rows[start : start + EMBED_BATCH]
        vectors = await embedder.embed([text for _, text in batch], task="document")
        for (chunk_id, _), vector in zip(batch, vectors, strict=True):
            await db.execute(
                update(PaperChunk)
                .where(PaperChunk.id == chunk_id)
                .values(embedding=vector, embedding_model=embedder.model)
            )
        await db.commit()
    return len(rows)


# --------------------------------------------------------------------------------------- evidence helpers
def _abstract_evidence(papers: list[Paper], start: int = 1) -> list[EvidenceItem]:
    return [
        EvidenceItem(key=f"E{start + i}", paper=p, text=p.abstract or "", kind="abstract")
        for i, p in enumerate(p for p in papers if p.abstract)
    ]


async def gather_evidence(
    db: AsyncSession, question: str, papers: list[Paper], *, limit: int = 12
) -> list[EvidenceItem]:
    """Full-text passages for processed papers, abstracts for metadata-only papers."""
    by_id = {p.id: p for p in papers}
    ready = [p.id for p in papers if p.status == PaperStatus.READY]
    cap = max(2, limit // max(1, len(ready))) if len(ready) > 1 else None
    passages = await search_evidence(db, question, ready, limit=limit, per_paper_cap=cap)
    items = [
        EvidenceItem(
            key=f"E{i + 1}",
            paper=by_id[e.paper_id],
            text=e.text,
            kind="passage",
            chunk_id=e.chunk_id,
            section=e.section,
            page_start=e.page_start,
            page_end=e.page_end,
        )
        for i, e in enumerate(passages)
    ]
    covered = {e.paper.id for e in items}
    # Keyword search can miss a paper entirely (e.g. vague questions); fall back to its opening passages.
    for paper_id in ready:
        if paper_id not in covered:
            for e in await leading_chunks(db, paper_id, 4):
                items.append(
                    EvidenceItem(
                        key=f"E{len(items) + 1}",
                        paper=by_id[paper_id],
                        text=e.text,
                        kind="passage",
                        chunk_id=e.chunk_id,
                        section=e.section,
                        page_start=e.page_start,
                        page_end=e.page_end,
                    )
                )
            covered.add(paper_id)
    items += _abstract_evidence([p for p in papers if p.id not in covered], start=len(items) + 1)
    return items


async def grounded_answer(question: str, items: list[EvidenceItem], *, task: str, feature: str) -> dict[str, Any]:
    if not items:
        return {
            "answer": "None of the selected papers contain text that addresses this question. Add papers "
            "with full text or abstracts and try again.",
            "insufficient_evidence": True,
            "gaps": "No evidence available.",
            "citations": [],
            "model": None,
        }
    llm = get_llm(feature)
    system = f"You are a careful research assistant for academic researchers. Task: {task}\n\n{GROUNDING_RULES}"
    prompt = f"{render_evidence(items)}\n\n<question>{question}</question>"
    result, model = await llm.generate_json(system=system, prompt=prompt, schema=GroundedAnswer, max_tokens=8000)
    result = validate_grounded(result, items)
    return {
        "answer": result.answer,
        "insufficient_evidence": result.insufficient_evidence,
        "gaps": result.gaps,
        "citations": citation_payload(result.answer, items),
        "model": model,
    }


# ------------------------------------------------------------------------------------------------ features
async def ask_paper(db: AsyncSession, paper: Paper, question: str) -> dict[str, Any]:
    items = await gather_evidence(db, question, [paper], limit=10)
    return await grounded_answer(
        question,
        items,
        feature="Paper Q&A",
        task="Answer the researcher's question about this single paper using only its passages.",
    )


async def research_synthesis(db: AsyncSession, papers: list[Paper], question: str) -> dict[str, Any]:
    if not papers:
        raise ValidationFailed("Select at least one paper.")
    items = await gather_evidence(db, question, papers, limit=16)
    return await grounded_answer(
        question,
        items,
        feature="Research synthesis",
        task=(
            "Synthesise what these papers say about the question. Compare and contrast findings across "
            "papers, note agreement and disagreement, and name methodological differences when the evidence "
            "shows them."
        ),
    )


async def discovery_snapshot(papers: list[Paper], query: str) -> dict[str, Any]:
    items = _abstract_evidence(papers[:10])
    if len(items) < 2:
        return {
            "answer": "Not enough abstracts in these results to write an overview.",
            "insufficient_evidence": True,
            "gaps": "Fewer than two results have abstracts.",
            "citations": [],
            "model": None,
        }
    return await grounded_answer(
        query,
        items,
        feature="Research overview",
        task=(
            "Write a short (120-180 word) overview of what these search results report about the query, "
            "based only on their abstracts. Make clear it is based on abstracts."
        ),
    )


class SummaryPoint(BaseModel):
    text: str
    evidence_ids: list[str]


class PaperSummaryOut(BaseModel):
    overview: str = Field(description="2-3 sentence plain-language overview with inline [E#] markers.")
    research_question: SummaryPoint
    methods: SummaryPoint
    key_findings: list[SummaryPoint]
    limitations: list[SummaryPoint]
    insufficient_evidence: bool


async def summarize_paper(db: AsyncSession, paper: Paper, *, force: bool = False) -> PaperSummary:
    existing = (await db.execute(select(PaperSummary).where(PaperSummary.paper_id == paper.id))).scalar_one_or_none()
    if existing and not force and existing.prompt_version == SUMMARY_PROMPT_VERSION:
        return existing
    if paper.status == PaperStatus.READY:
        passages = await leading_chunks(db, paper.id, 14)
        passages += [
            e
            for e in await search_evidence(db, "results limitations conclusion", [paper.id], limit=8)
            if e.chunk_id not in {p.chunk_id for p in passages}
        ]
        items = [
            EvidenceItem(
                key=f"E{i + 1}",
                paper=paper,
                text=e.text,
                kind="passage",
                chunk_id=e.chunk_id,
                section=e.section,
                page_start=e.page_start,
                page_end=e.page_end,
            )
            for i, e in enumerate(passages)
        ]
    else:
        items = _abstract_evidence([paper])
    if not items:
        raise ValidationFailed("This paper has no abstract or full text to summarise yet.")
    llm = get_llm("Paper summaries")
    system = (
        "You summarise academic papers for researchers. Every point must cite the evidence ids it comes from."
        f"\n\n{GROUNDING_RULES}"
    )
    out, model = await llm.generate_json(
        system=system,
        prompt=render_evidence(items) + "\n\nSummarise this paper.",
        schema=PaperSummaryOut,
        max_tokens=6000,
    )
    valid = {i.key for i in items}
    points = [out.research_question, out.methods, *out.key_findings, *out.limitations]
    if not out.insufficient_evidence and any(not p.evidence_ids or set(p.evidence_ids) - valid for p in points):
        raise AIOutputInvalid("The AI summary cited evidence that does not exist and was discarded.")
    by_key = {i.key: i for i in items}

    def cite(point: SummaryPoint) -> dict[str, Any]:
        return {
            "text": point.text,
            "evidence": [
                {
                    "key": k,
                    "section": by_key[k].section,
                    "page_start": by_key[k].page_start,
                    "excerpt": by_key[k].text[:400],
                    "kind": by_key[k].kind,
                }
                for k in point.evidence_ids
                if k in by_key
            ],
        }

    content = {
        "overview": out.overview,
        "research_question": cite(out.research_question),
        "methods": cite(out.methods),
        "key_findings": [cite(p) for p in out.key_findings],
        "limitations": [cite(p) for p in out.limitations],
        "based_on": "full_text" if paper.status == PaperStatus.READY else "abstract",
        "insufficient_evidence": out.insufficient_evidence,
    }
    if existing:
        existing.content, existing.model, existing.prompt_version = content, model, SUMMARY_PROMPT_VERSION
        summary = existing
    else:
        summary = PaperSummary(paper_id=paper.id, content=content, model=model, prompt_version=SUMMARY_PROMPT_VERSION)
        db.add(summary)
    await db.commit()
    await db.refresh(summary)
    return summary


RewriteMode = Literal["academic", "concise", "expand", "simplify", "grammar"]
_REWRITE_INSTRUCTIONS: dict[str, str] = {
    "academic": "Rewrite in a formal academic register.",
    "concise": "Make it more concise without losing meaning.",
    "expand": "Expand it with clearer explanation and transitions, without adding new facts.",
    "simplify": "Rewrite it in plain language for a general reader.",
    "grammar": "Fix grammar, spelling and punctuation only; change nothing else.",
}


async def rewrite_text(text: str, mode: str, context: str | None) -> dict[str, Any]:
    llm = get_llm("AI rewriting")
    system = (
        "You are an academic writing editor. Return only the rewritten passage. Never add facts, numbers, "
        "claims or citations that are not in the original. Keep any existing citation markers unchanged."
    )
    prompt = (
        f"Instruction: {_REWRITE_INSTRUCTIONS[mode]}\n\n"
        + (f"<surrounding_context>{context[:3000]}</surrounding_context>\n\n" if context else "")
        + f"<passage>{text}</passage>"
    )
    result = await llm.generate_text(system=system, prompt=prompt, max_tokens=4000)
    return {"text": result.text, "model": result.model}


async def continue_text(preceding: str, doc_type: str, title: str) -> dict[str, Any]:
    llm = get_llm("AI autocomplete")
    system = (
        "You help a researcher draft. Continue their text with ONE or TWO sentences in the same voice. "
        "Do not invent findings, statistics or references; keep it to framing, transitions or structure. "
        "Return only the continuation text."
    )
    prompt = f"Document type: {doc_type}. Title: {title}.\n\n<text_so_far>{preceding[-4000:]}</text_so_far>"
    result = await llm.generate_text(system=system, prompt=prompt, max_tokens=300)
    return {"text": result.text, "model": result.model}
