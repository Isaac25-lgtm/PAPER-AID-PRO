"""Citation tools, multi-paper research (grounded synthesis + history) and AI writing assistance."""

from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Request, Response
from sqlalchemy import select

from app.api.deps import DB, AppSettings
from app.db.models import Conversation, Message, MessageRole
from app.errors import NotFound, ValidationFailed
from app.schemas import (
    CompleteRequest,
    ConversationOut,
    ConversationSummaryOut,
    FormatRequest,
    FormatResponse,
    FormattedEntry,
    GroundedAnswerOut,
    MessageOut,
    ResearchAskRequest,
    RewriteRequest,
    StyleOut,
    TextResult,
    VerifyRequest,
)
from app.security.auth import OptionalUser, VerifiedUser
from app.security.rate_limit import enforce_caller_limit, enforce_rate_limit
from app.services.ai import features as ai_features
from app.services.citations.csl import STYLES, format_citations
from app.services.citations.verify import verify_references
from app.services.documents import get_owned_document
from app.services.papers import get_papers_for_user, to_csl_json, work_to_csl_json
from app.services.scholarly.aggregator import resolve_identifier
from app.services.scholarly.identifiers import parse_identifier
from app.services.scholarly.models import ScholarlyWork

router = APIRouter()
ANON_MAX_IDENTIFIERS = 20
HISTORY_MESSAGES = 6  # three question/answer turns
MAX_THREAD_MESSAGES = 200


# ----------------------------------------------------------------------------------------------- citations
@router.get("/citations/styles", response_model=list[StyleOut], tags=["citations"])
async def styles() -> list[StyleOut]:
    return [StyleOut(id=s.id, title=s.title, kind=s.kind) for s in STYLES.values()]


@router.post("/citations/format", response_model=FormatResponse, tags=["citations"])
async def format_references(request: Request, body: FormatRequest, db: DB, user: OptionalUser) -> FormatResponse:
    """Format papers (by id) and/or identifiers (DOI/PMID/arXiv, resolved against registries) in a CSL style.

    All works are formatted together in ONE citeproc processor, so numeric styles number them 1..n and author-date
    styles disambiguate same-author/same-year works. Entries are returned in bibliography (CSL) order."""
    if body.style not in STYLES:
        raise ValidationFailed("Unknown citation style.")
    if not body.paper_ids and not body.identifiers:
        raise ValidationFailed("Provide paper_ids or identifiers.")
    if user is None and len(body.identifiers) > ANON_MAX_IDENTIFIERS:
        raise ValidationFailed(f"Sign in to format more than {ANON_MAX_IDENTIFIERS} identifiers at once.")
    await enforce_caller_limit(
        db, request, user, name="citefmt", user_limit=30, anon_limit=20, window_seconds=60, action="citation formatting"
    )
    records: list[tuple[dict[str, object], str, uuid.UUID | None]] = []
    seen: set[str] = set()  # the same work asked for twice (by id and by DOI) is formatted once

    def keys(doi: str | None, pmid: str | None, arxiv_id: str | None) -> set[str]:
        return {f"{k}:{v}" for k, v in (("doi", doi), ("pmid", pmid), ("arxiv", arxiv_id)) if v}

    for paper in await get_papers_for_user(db, list(dict.fromkeys(body.paper_ids)), user):
        records.append((to_csl_json(paper), paper.title, paper.id))
        seen |= keys(paper.doi, paper.pmid, paper.arxiv_id)
    await db.commit()  # release the DB connection while registries and the citation engine run

    semaphore = asyncio.Semaphore(5)

    async def resolve(raw: str) -> ScholarlyWork | None:
        identifier = parse_identifier(raw)
        if identifier is None:
            return None
        async with semaphore:
            return await resolve_identifier(identifier)

    raw_identifiers = list(dict.fromkeys(i.strip() for i in body.identifiers if i.strip()))
    unresolved = []
    for index, (raw, work) in enumerate(
        zip(raw_identifiers, await asyncio.gather(*(resolve(r) for r in raw_identifiers)), strict=True)
    ):
        if work is None:
            unresolved.append(raw)
            continue
        work_keys = keys(work.doi, work.pmid, work.arxiv_id)
        if work_keys & seen:
            continue
        seen |= work_keys
        records.append((work_to_csl_json(work, f"ext-{index}"), work.title, None))
    if not records:
        return FormatResponse(style=body.style, entries=[], unresolved=unresolved)
    items = [item for item, _, _ in records]
    formatted = await format_citations(
        items, style=body.style, clusters=[[{"id": item["id"]}] for item in items], output=body.output
    )
    by_id = {str(item["id"]): (index, title, pid) for index, (item, title, pid) in enumerate(records)}
    bibliography = dict(zip(formatted.bibliography_ids, formatted.bibliography, strict=False))
    order = [i for i in formatted.bibliography_ids if i in by_id] + [
        str(item["id"]) for item in items if str(item["id"]) not in bibliography
    ]
    entries = []
    for item_id in order:
        index, title, pid = by_id[item_id]
        entries.append(
            FormattedEntry(
                in_text=formatted.citations[index] if index < len(formatted.citations) else "",
                bibliography=bibliography.get(item_id, ""),
                paper_id=pid,
                title=title,
            )
        )
    return FormatResponse(style=body.style, entries=entries, unresolved=unresolved)


@router.post("/citations/verify", tags=["citations"])
async def verify(request: Request, body: VerifyRequest, db: DB, user: OptionalUser) -> dict[str, object]:
    """Check each reference against Crossref (title, first author, year). Deterministic; no AI involved."""
    await enforce_caller_limit(
        db, request, user, name="verify", user_limit=10, anon_limit=5, window_seconds=300, action="reference checks"
    )
    await db.commit()
    return {"results": await verify_references(body.references)}


# ------------------------------------------------------------------------------------------------ research
@router.post("/research/ask", response_model=GroundedAnswerOut, tags=["research"])
async def research_ask(
    body: ResearchAskRequest, db: DB, user: VerifiedUser, settings: AppSettings
) -> GroundedAnswerOut:
    await enforce_rate_limit(
        db, key=f"ai:{user.id}", limit=settings.rate_limit_ai_per_min, window_seconds=60, action="AI requests"
    )
    papers = await get_papers_for_user(db, list(dict.fromkeys(body.paper_ids)), user)
    if not papers:
        raise ValidationFailed("None of the selected papers are available to you.")
    history: list[tuple[str, str]] = []
    if body.conversation_id:
        conversation = await db.get(Conversation, body.conversation_id)
        if conversation is None or conversation.user_id != user.id:
            raise NotFound("Conversation not found.")
        # Bounded follow-up context: the last few turns, so "those studies" / "that outcome" resolve.
        recent = list(
            (
                await db.execute(
                    select(Message)
                    .where(Message.conversation_id == conversation.id)
                    .order_by(Message.created_at.desc())
                    .limit(HISTORY_MESSAGES)
                )
            ).scalars()
        )[::-1]
        question: str | None = None
        for message in recent:
            if message.role == MessageRole.USER:
                question = message.content
            elif question is not None:
                history.append((question, message.content))
                question = None
    else:
        conversation = None
    result = await ai_features.research_synthesis(db, papers, body.question, history=history)
    if conversation is None:
        conversation = Conversation(user_id=user.id, title=body.question[:120], paper_ids=[p.id for p in papers])
        db.add(conversation)
        await db.flush()
    else:
        conversation.paper_ids = [p.id for p in papers]
    db.add(Message(conversation_id=conversation.id, role=MessageRole.USER, content=body.question, citations=[]))
    db.add(
        Message(
            conversation_id=conversation.id,
            role=MessageRole.ASSISTANT,
            content=result["answer"],
            citations=result["citations"],
            model=result["model"],
            insufficient_evidence=result["insufficient_evidence"],
            gaps=result["gaps"],
        )
    )
    await db.commit()
    return GroundedAnswerOut(**result, conversation_id=conversation.id)


@router.get("/research/conversations", response_model=list[ConversationSummaryOut], tags=["research"])
async def conversations(db: DB, user: VerifiedUser) -> list[ConversationSummaryOut]:
    rows = await db.execute(
        select(Conversation).where(Conversation.user_id == user.id).order_by(Conversation.updated_at.desc()).limit(100)
    )
    return [ConversationSummaryOut.model_validate(c) for c in rows.scalars()]


@router.get("/research/conversations/{conversation_id}", response_model=ConversationOut, tags=["research"])
async def conversation(conversation_id: uuid.UUID, db: DB, user: VerifiedUser) -> ConversationOut:
    convo = await db.get(Conversation, conversation_id)
    if convo is None or convo.user_id != user.id:
        raise NotFound("Conversation not found.")
    messages = (
        await db.execute(
            select(Message)
            .where(Message.conversation_id == convo.id)
            .order_by(Message.created_at.desc())
            .limit(MAX_THREAD_MESSAGES)
        )
    ).scalars()
    messages = list(messages)[::-1]
    return ConversationOut(
        id=convo.id,
        title=convo.title,
        paper_ids=convo.paper_ids,
        updated_at=convo.updated_at,
        messages=[MessageOut.model_validate(m) for m in messages],
    )


@router.delete("/research/conversations/{conversation_id}", status_code=204, tags=["research"])
async def delete_conversation(conversation_id: uuid.UUID, db: DB, user: VerifiedUser) -> Response:
    convo = await db.get(Conversation, conversation_id)
    if convo is None or convo.user_id != user.id:
        raise NotFound("Conversation not found.")
    await db.delete(convo)
    await db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------------------------------- writing (AI)
@router.post("/ai/rewrite", response_model=TextResult, tags=["ai"])
async def rewrite(body: RewriteRequest, db: DB, user: VerifiedUser, settings: AppSettings) -> TextResult:
    await enforce_rate_limit(
        db, key=f"ai:{user.id}", limit=settings.rate_limit_ai_per_min, window_seconds=60, action="AI requests"
    )
    return TextResult(**await ai_features.rewrite_text(body.text, body.mode, body.context))


@router.post("/ai/complete", response_model=TextResult, tags=["ai"])
async def complete(body: CompleteRequest, db: DB, user: VerifiedUser, settings: AppSettings) -> TextResult:
    await enforce_rate_limit(
        db,
        key=f"aicomplete:{user.id}",
        limit=settings.rate_limit_ai_per_min * 3,
        window_seconds=60,
        action="autocomplete",
    )
    doc = await get_owned_document(db, body.document_id, user)
    return TextResult(**await ai_features.continue_text(body.preceding_text, doc.doc_type.value, doc.title))
