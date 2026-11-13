"""Citation tools, multi-paper research (grounded synthesis + history) and AI writing assistance."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Response
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
from app.security.rate_limit import enforce_rate_limit
from app.services.ai import features as ai_features
from app.services.citations.csl import STYLES, format_citations
from app.services.citations.verify import verify_references
from app.services.documents import get_owned_document
from app.services.papers import get_papers_for_user, to_csl_json, work_to_csl_json
from app.services.scholarly.aggregator import resolve_identifier
from app.services.scholarly.identifiers import parse_identifier

router = APIRouter()


# ----------------------------------------------------------------------------------------------- citations
@router.get("/citations/styles", response_model=list[StyleOut], tags=["citations"])
async def styles() -> list[StyleOut]:
    return [StyleOut(id=s.id, title=s.title, kind=s.kind) for s in STYLES.values()]


@router.post("/citations/format", response_model=FormatResponse, tags=["citations"])
async def format_references(body: FormatRequest, db: DB, user: OptionalUser) -> FormatResponse:
    """Format papers (by id) and/or identifiers (DOI/PMID/arXiv, resolved against registries) in a CSL style."""
    if body.style not in STYLES:
        raise ValidationFailed("Unknown citation style.")
    if not body.paper_ids and not body.identifiers:
        raise ValidationFailed("Provide paper_ids or identifiers.")
    key = f"citefmt:{user.id}" if user else "citefmt:anon"
    await enforce_rate_limit(db, key=key, limit=30 if user else 60, window_seconds=60, action="citation formatting")
    items, titles, paper_ids, unresolved = [], [], [], []
    for paper in await get_papers_for_user(db, list(body.paper_ids), user):
        items.append(to_csl_json(paper))
        titles.append(paper.title)
        paper_ids.append(paper.id)
    for index, raw in enumerate(body.identifiers):
        identifier = parse_identifier(raw)
        work = await resolve_identifier(identifier) if identifier else None
        if work is None:
            unresolved.append(raw)
            continue
        item = work_to_csl_json(work, f"ext-{index}")
        items.append(item)
        titles.append(work.title)
        paper_ids.append(None)
    if not items:
        return FormatResponse(style=body.style, entries=[], unresolved=unresolved)
    entries = []
    for item, title, pid in zip(items, titles, paper_ids, strict=True):
        single = await format_citations([item], style=body.style, clusters=[[{"id": item["id"]}]], output=body.output)
        entries.append(
            FormattedEntry(
                in_text=single.citations[0] if single.citations else "",
                bibliography=single.bibliography[0] if single.bibliography else "",
                paper_id=pid,
                title=title,
            )
        )
    return FormatResponse(style=body.style, entries=entries, unresolved=unresolved)


@router.post("/citations/verify", tags=["citations"])
async def verify(body: VerifyRequest, db: DB, user: OptionalUser) -> dict[str, object]:
    """Check each reference against Crossref (title, first author, year). Deterministic; no AI involved."""
    key = f"verify:{user.id}" if user else "verify:anon"
    await enforce_rate_limit(db, key=key, limit=10 if user else 20, window_seconds=300, action="reference checks")
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
    if body.conversation_id:
        conversation = await db.get(Conversation, body.conversation_id)
        if conversation is None or conversation.user_id != user.id:
            raise NotFound("Conversation not found.")
    else:
        conversation = None
    result = await ai_features.research_synthesis(db, papers, body.question)
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
        await db.execute(select(Message).where(Message.conversation_id == convo.id).order_by(Message.created_at))
    ).scalars()
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
