"""Federated scholarly search and the AI research overview of results."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Request
from sqlalchemy import or_, select

from app.api.deps import DB, AppSettings
from app.db.models import Paper, PaperVisibility
from app.errors import ValidationFailed
from app.schemas import GroundedAnswerOut, ProviderStatusOut, SearchResponse, SnapshotRequest, WorkOut
from app.security.auth import AIUser, OptionalUser
from app.security.rate_limit import enforce_caller_limit, enforce_rate_limit
from app.services.ai.features import discovery_snapshot
from app.services.papers import upsert_public_paper
from app.services.scholarly.aggregator import default_providers, federated_search, resolve_identifier
from app.services.scholarly.identifiers import parse_identifier
from app.services.scholarly.models import ALL_PROVIDERS, ProviderName, ScholarlyWork, Subject

router = APIRouter(prefix="/discovery", tags=["discovery"])


def _identifier(work: ScholarlyWork) -> str | None:
    if work.doi:
        return work.doi
    if work.pmid:
        return f"PMID:{work.pmid}"
    if work.arxiv_id:
        return f"arXiv:{work.arxiv_id}"
    return None


@router.get("/search", response_model=SearchResponse)
async def search(
    request: Request,
    db: DB,
    settings: AppSettings,
    user: OptionalUser,
    q: Annotated[str, Query(min_length=2, max_length=300)],
    providers: Annotated[list[ProviderName] | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    year_from: Annotated[int | None, Query(ge=1500, le=2100)] = None,
    year_to: Annotated[int | None, Query(ge=1500, le=2100)] = None,
    open_access_only: bool = False,
    subject: Subject = "all",
) -> SearchResponse:
    if year_from and year_to and year_from > year_to:
        raise ValidationFailed("year_from must not be after year_to.")
    await enforce_caller_limit(
        db,
        request,
        user,
        name="search",
        user_limit=settings.rate_limit_search_per_min,
        anon_limit=settings.rate_limit_search_per_min,
        window_seconds=60,
        action="search",
    )
    # Each provider is queried at most once, whatever the client sends.
    selected = [p for p in ALL_PROVIDERS if p in set(providers)] if providers else default_providers(subject)
    await db.commit()  # do not hold a DB connection while the providers are queried
    works, statuses = await federated_search(
        q.strip(),
        providers=selected,
        subject=subject,
        limit=limit,
        year_from=year_from,
        year_to=year_to,
        open_access_only=open_access_only,
    )
    dois = [w.doi for w in works if w.doi]
    pmids = [w.pmid for w in works if w.pmid]
    known: dict[str, Paper] = {}
    if dois or pmids:
        rows = (
            await db.execute(
                select(Paper).where(
                    Paper.visibility == PaperVisibility.PUBLIC,
                    or_(Paper.doi.in_(dois or [""]), Paper.pmid.in_(pmids or [""])),
                )
            )
        ).scalars()
        for paper in rows:
            if paper.doi:
                known[f"doi:{paper.doi}"] = paper
            if paper.pmid:
                known[f"pmid:{paper.pmid}"] = paper
    results = []
    for w in works:
        match = known.get(f"doi:{w.doi}") or known.get(f"pmid:{w.pmid}")
        results.append(
            WorkOut(
                title=w.title,
                abstract=w.abstract,
                authors=[a.name for a in w.authors][:20],
                year=w.year,
                journal=w.journal,
                doi=w.doi,
                pmid=w.pmid,
                pmcid=w.pmcid,
                arxiv_id=w.arxiv_id,
                url=w.url,
                is_open_access=w.is_open_access or bool(w.oa_pdf_url),
                oa_pdf_url=w.oa_pdf_url,
                citation_count=w.citation_count,
                sources=list(w.sources),
                identifier=_identifier(w),
                library_paper_id=match.id if match else None,
            )
        )
    return SearchResponse(query=q, results=results, providers=[ProviderStatusOut(**s.model_dump()) for s in statuses])


@router.post("/snapshot", response_model=GroundedAnswerOut)
async def snapshot(body: SnapshotRequest, db: DB, user: AIUser, settings: AppSettings) -> GroundedAnswerOut:
    """AI overview of the top search results, grounded only in their abstracts (records are resolved server-side)."""
    await enforce_rate_limit(
        db, key=f"ai:{user.id}", limit=settings.rate_limit_ai_per_min, window_seconds=60, action="AI requests"
    )
    papers = []
    for raw in body.identifiers:
        identifier = parse_identifier(raw)
        if identifier is None:
            continue
        work = await resolve_identifier(identifier)
        if work is not None:
            papers.append(await upsert_public_paper(db, work, created_by=user))
    result = await discovery_snapshot(db, papers, body.query)
    return GroundedAnswerOut(**result)
