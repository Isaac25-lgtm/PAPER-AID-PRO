"""Deep research: search the scholarly databases (and, when connected, the web) and write a verified report."""

from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Response
from sqlalchemy import delete, func, select

from app.api.deps import DB, AppSettings
from app.db.models import DeepResearchRun
from app.errors import NotFound, UpstreamError, ValidationFailed
from app.schemas import DeepResearchOut, DeepResearchRequest, DeepResearchStatusOut, DeepResearchSummaryOut
from app.security.auth import VerifiedUser, ai_allowed_for
from app.security.rate_limit import enforce_rate_limit
from app.services.ai.providers import llm_available
from app.services.deep_research import run_deep_research
from app.services.scholarly.aggregator import default_providers
from app.services.web_search import web_search_enabled

router = APIRouter(prefix="/research/deep", tags=["deep research"])

# Well inside Cloud Run's request limit, so a slow run ends with a clear message rather than a dropped connection.
RUN_TIMEOUT_SECONDS = 240.0


@router.get("/status", response_model=DeepResearchStatusOut)
async def status(user: VerifiedUser) -> DeepResearchStatusOut:
    """What Deep research can use for this account right now."""
    return DeepResearchStatusOut(
        databases=list(default_providers("all")),
        ai=llm_available() and ai_allowed_for(user),
        web_search=web_search_enabled(),
    )


@router.post("", response_model=DeepResearchOut)
async def start(body: DeepResearchRequest, db: DB, user: VerifiedUser, settings: AppSettings) -> DeepResearchRun:
    if body.year_from and body.year_to and body.year_from > body.year_to:
        raise ValidationFailed("The start year must not be after the end year.")
    await enforce_rate_limit(
        db,
        key=f"deep:{user.id}",
        limit=settings.rate_limit_deep_research_per_hour,
        window_seconds=3600,
        action="Deep research runs",
    )
    use_ai = llm_available() and ai_allowed_for(user)
    if use_ai:
        await enforce_rate_limit(
            db, key=f"ai:{user.id}", limit=settings.rate_limit_ai_per_min, window_seconds=60, action="AI requests"
        )
    try:
        return await asyncio.wait_for(
            run_deep_research(
                db,
                user,
                body.question.strip(),
                subject=body.subject,
                year_from=body.year_from,
                year_to=body.year_to,
                include_web=body.include_web,
                use_ai=use_ai,
            ),
            timeout=RUN_TIMEOUT_SECONDS,
        )
    except TimeoutError as exc:
        raise UpstreamError(
            "Deep research took too long this time and was stopped. Try a narrower question or try again shortly."
        ) from exc


@router.get("", response_model=list[DeepResearchSummaryOut])
async def history(db: DB, user: VerifiedUser) -> list[DeepResearchSummaryOut]:
    rows = await db.execute(
        select(
            DeepResearchRun.id,
            DeepResearchRun.question,
            DeepResearchRun.report_status,
            DeepResearchRun.created_at,
            func.jsonb_array_length(DeepResearchRun.sources).label("source_count"),
        )
        .where(DeepResearchRun.user_id == user.id)
        .order_by(DeepResearchRun.created_at.desc())
        .limit(100)
    )
    return [DeepResearchSummaryOut.model_validate(row, from_attributes=True) for row in rows]


async def _owned(db: DB, run_id: uuid.UUID, user_id: uuid.UUID) -> DeepResearchRun:
    run = await db.get(DeepResearchRun, run_id)
    if run is None or run.user_id != user_id:
        raise NotFound("Report not found.")
    return run


@router.get("/{run_id}", response_model=DeepResearchOut)
async def get_run(run_id: uuid.UUID, db: DB, user: VerifiedUser) -> DeepResearchRun:
    return await _owned(db, run_id, user.id)


@router.delete("/{run_id}", status_code=204)
async def delete_run(run_id: uuid.UUID, db: DB, user: VerifiedUser) -> Response:
    await _owned(db, run_id, user.id)
    await db.execute(delete(DeepResearchRun).where(DeepResearchRun.id == run_id, DeepResearchRun.user_id == user.id))
    await db.commit()
    return Response(status_code=204)
