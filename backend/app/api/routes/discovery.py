"""Federated scholarly search and the AI research overview of results.

Two ways to search the same databases:
- GET /discovery/search: one answer when every database has replied (used where a single list is needed, e.g. the
  editor's cite palette).
- GET /discovery/search/stream: newline-delimited JSON events, so the page shows results as each database answers,
  says which are still searching, and can retry the ones that failed (Silver's feedback, 25 November 2026).

Both look up an identifier typed into the box (DOI or DOI link, "PMID 123", PMC ID, arXiv ID) exactly instead of
searching its characters as words, and both correct an obvious misspelling unless `exact=true`.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DB, AppSettings
from app.db.models import Paper, PaperVisibility, User
from app.db.session import get_sessionmaker
from app.errors import ValidationFailed
from app.schemas import GroundedAnswerOut, ProviderStatusOut, SearchResponse, SnapshotRequest, WorkOut
from app.security.auth import AIUser, OptionalUser
from app.security.rate_limit import enforce_caller_limit, enforce_rate_limit
from app.services.ai.features import discovery_snapshot
from app.services.papers import upsert_public_paper
from app.services.scholarly.aggregator import (
    default_providers,
    federated_search,
    merged_results,
    resolve_identifier,
    search_progressively,
)
from app.services.scholarly.identifiers import Identifier, exact_identifier, parse_identifier
from app.services.scholarly.models import ALL_PROVIDERS, ProviderName, ProviderStatus, ScholarlyWork, Subject
from app.services.scholarly.spelling import suggest_correction

router = APIRouter(prefix="/discovery", tags=["discovery"])

# How long a finished search waits for its spelling check before showing the typed results as they are.
SPELLING_GRACE_SECONDS = 1.5
# The streaming search decides on a correction first (so results never jump from one query to another), but never
# waits for the spelling service longer than this before searching the words as typed.
STREAM_SPELLING_WAIT_SECONDS = 3.0


def _identifier(work: ScholarlyWork) -> str | None:
    if work.doi:
        return work.doi
    if work.pmid:
        return f"PMID:{work.pmid}"
    if work.arxiv_id:
        return f"arXiv:{work.arxiv_id}"
    return None


async def _results(db: AsyncSession, works: list[ScholarlyWork]) -> list[WorkOut]:
    """Works as the page shows them, each linked to its PaperAid record when the catalogue already has it."""
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
    return results


def _provider_list(providers: list[ProviderName] | None, subject: str) -> list[ProviderName]:
    # Each provider is queried at most once, whatever the client sends.
    return [p for p in ALL_PROVIDERS if p in set(providers)] if providers else default_providers(subject)


async def _start(
    request: Request,
    db: DB,
    settings: AppSettings,
    user: User | None,
    year_from: int | None,
    year_to: int | None,
) -> None:
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
    await db.commit()  # do not hold a DB connection while the providers are queried


async def _lookup(identifier: Identifier) -> list[ScholarlyWork]:
    work = await resolve_identifier(identifier)
    return [work] if work else []


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
    exact: bool = False,
) -> SearchResponse:
    """`exact=true` searches the words exactly as typed; otherwise an obvious misspelling is corrected (and the
    response says so, with the original, so the person can search for exactly what they typed)."""
    await _start(request, db, settings, user, year_from, year_to)
    selected = _provider_list(providers, subject)
    typed = " ".join(q.split())
    identifier = exact_identifier(typed)
    if identifier is not None:  # an identifier is looked up exactly, never searched as words
        works = await _lookup(identifier)
        return SearchResponse(query=typed, identifier=identifier.kind, results=await _results(db, works), providers=[])

    async def run(query: str) -> tuple[list[ScholarlyWork], list[ProviderStatus]]:
        return await federated_search(
            query,
            providers=selected,
            subject=subject,
            limit=limit,
            year_from=year_from,
            year_to=year_to,
            open_access_only=open_access_only,
        )

    corrected: str | None = None
    if exact:
        works, statuses = await run(typed)
    else:
        # The spelling check runs beside the search. Once the typed search is back it may take at most
        # SPELLING_GRACE_SECONDS more, so a slow spelling service never holds up a correct query (audit Q3).
        spelling = asyncio.create_task(suggest_correction(typed))
        works, statuses = await run(typed)
        try:
            corrected = await asyncio.wait_for(spelling, timeout=SPELLING_GRACE_SECONDS)
        except TimeoutError:
            corrected = None
        if corrected:
            retry_works, retry_statuses = await run(corrected)
            if retry_works:
                works, statuses = retry_works, retry_statuses
            else:  # the correction found nothing: keep what the typed words found
                corrected = None
    return SearchResponse(
        query=corrected or typed,
        corrected_from=typed if corrected else None,
        results=await _results(db, works),
        providers=[ProviderStatusOut(**s.model_dump()) for s in statuses],
    )


def _event(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, default=str) + "\n").encode("utf-8")


@router.get("/search/stream")
async def search_stream(
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
    exact: bool = False,
) -> StreamingResponse:
    """Results as each database answers. Events, one JSON object per line:

    - `{"type": "query", "query", "corrected_from", "identifier", "pending": [databases]}`: what is being searched;
    - `{"type": "results", "results", "providers": [...], "pending": [...]}`: the merged, ranked list so far, after
      every database that answers (a failed database appears in `providers` with `ok: false`);
    - `{"type": "suggestion", "query"}`: in exact mode only, a spelling the person may prefer (never applied);
    - `{"type": "done"}`.

    A database's successful answer is cached for a few minutes, so repeating the search (the page's "Retry") asks
    again only the databases that failed."""
    await _start(request, db, settings, user, year_from, year_to)
    selected = _provider_list(providers, subject)
    typed = " ".join(q.split())
    sessions = get_sessionmaker()

    async def shown(works: list[ScholarlyWork]) -> list[dict[str, Any]]:
        async with sessions() as session:  # short-lived: the request's own session is already released
            return [r.model_dump(mode="json") for r in await _results(session, works)]

    async def events() -> AsyncIterator[bytes]:
        identifier = exact_identifier(typed)
        if identifier is not None:
            yield _event(
                {"type": "query", "query": typed, "corrected_from": None, "identifier": identifier.kind, "pending": []}
            )
            works = await _lookup(identifier)
            yield _event({"type": "results", "results": await shown(works), "providers": [], "pending": []})
            yield _event({"type": "done"})
            return

        spelling = asyncio.create_task(suggest_correction(typed))
        try:
            query, corrected_from = typed, None
            if not exact:
                try:
                    corrected = await asyncio.wait_for(asyncio.shield(spelling), timeout=STREAM_SPELLING_WAIT_SECONDS)
                except TimeoutError:
                    corrected = None
                if corrected:
                    query, corrected_from = corrected, typed

            async def stream(text: str) -> AsyncIterator[tuple[bytes, int]]:
                lists: list[list[ScholarlyWork]] = []
                statuses: list[ProviderStatusOut] = []
                pending = list(selected)
                async for status, works in search_progressively(
                    text, providers=selected, limit=limit, year_from=year_from, year_to=year_to, subject=subject
                ):
                    pending.remove(status.provider)
                    statuses.append(ProviderStatusOut(**status.model_dump()))
                    lists.append(works)
                    merged = merged_results(lists, text, limit=limit, open_access_only=open_access_only)
                    payload = {
                        "type": "results",
                        "results": await shown(merged),
                        "providers": [s.model_dump() for s in statuses],
                        "pending": pending,
                    }
                    yield _event(payload), len(merged)

            yield _event(
                {
                    "type": "query",
                    "query": query,
                    "corrected_from": corrected_from,
                    "identifier": None,
                    "pending": selected,
                }
            )
            found = 0
            async for line, count in stream(query):
                found = count
                yield line
            if corrected_from and not found:  # the correction found nothing: show what the typed words find
                yield _event(
                    {"type": "query", "query": typed, "corrected_from": None, "identifier": None, "pending": selected}
                )
                async for line, _ in stream(typed):
                    yield line
            if exact:  # offer, never apply, a spelling the person may have meant
                try:
                    suggestion = await asyncio.wait_for(asyncio.shield(spelling), timeout=SPELLING_GRACE_SECONDS)
                except TimeoutError:
                    suggestion = None
                if suggestion:
                    yield _event({"type": "suggestion", "query": suggestion})
            yield _event({"type": "done"})
        finally:
            spelling.cancel()

    return StreamingResponse(
        events(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"}
    )


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
