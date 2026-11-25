"""Federated search + identifier resolution across scholarly providers.

Ranking is deliberately simple and explainable: reciprocal-rank fusion of each provider's own relevance order,
plus query-term coverage of the title and a small citation-count tie-breaker. No topic-specific rules.
"""

from __future__ import annotations

import asyncio
import logging
import math
import re
import time
from collections import OrderedDict
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence

from app.config import get_settings
from app.errors import AppError
from app.services.scholarly.identifiers import Identifier, normalize_title
from app.services.scholarly.models import ALL_PROVIDERS, ProviderName, ProviderStatus, ScholarlyWork
from app.services.scholarly.providers import DEFAULT_PROVIDERS, PROVIDERS, available

log = logging.getLogger(__name__)

PROVIDER_TIMEOUT_SECONDS = 12.0
# A database's successful answer is reused for a few minutes, so "Retry" after a partial failure re-asks only the
# databases that failed, and paging back to a search is instant. Failures are never cached.
RESULT_CACHE_SECONDS = 300.0
_RESULT_CACHE_SIZE = 256
_result_cache: OrderedDict[tuple[object, ...], tuple[float, list[ScholarlyWork]]] = OrderedDict()


def _cached(key: tuple[object, ...]) -> list[ScholarlyWork] | None:
    entry = _result_cache.get(key)
    if entry is None or entry[0] < time.monotonic():
        _result_cache.pop(key, None)
        return None
    _result_cache.move_to_end(key)
    return entry[1]


def _remember(key: tuple[object, ...], works: list[ScholarlyWork]) -> None:
    _result_cache[key] = (time.monotonic() + RESULT_CACHE_SECONDS, works)
    _result_cache.move_to_end(key)
    while len(_result_cache) > _RESULT_CACHE_SIZE:
        _result_cache.popitem(last=False)


RRF_K = 60
_STOP = {"the", "a", "an", "of", "and", "or", "in", "on", "for", "to", "with", "by", "at", "from", "is", "are"}
_TOKEN = re.compile(r"[a-z0-9]+")


_STRONG_IDS = ("doi", "pmid", "arxiv_id")
MIN_TITLE_KEY_LENGTH = 20  # short generic titles ("Editorial", "Introduction") never merge on title alone


def _strong_keys(work: ScholarlyWork) -> list[str]:
    return [f"{field}:{getattr(work, field)}" for field in _STRONG_IDS if getattr(work, field)]


def _title_key(work: ScholarlyWork) -> str | None:
    title = normalize_title(work.title)
    if len(title) < MIN_TITLE_KEY_LENGTH or not work.year:
        return None
    return f"title:{title}:{work.year}"


def _conflicts(a: ScholarlyWork, b: ScholarlyWork) -> bool:
    """Two records are different publications if any persistent identifier they both carry disagrees."""
    return any(getattr(a, f) and getattr(b, f) and getattr(a, f) != getattr(b, f) for f in _STRONG_IDS)


def _first_author_family(work: ScholarlyWork) -> str:
    if not work.authors:
        return ""
    author = work.authors[0]
    return normalize_title(author.family or author.name.split(" ")[-1])


def _same_by_title(a: ScholarlyWork, b: ScholarlyWork) -> bool:
    """A weak (title + year) match must be CORROBORATED: the same first author, or (when a record lists no
    authors) the same journal. Thin records never merge on title alone."""
    fa, fb = _first_author_family(a), _first_author_family(b)
    if fa and fb:
        return fa == fb
    ja, jb = normalize_title(a.journal), normalize_title(b.journal)
    return bool(ja and jb and ja == jb)


def merge_works(primary: ScholarlyWork, other: ScholarlyWork) -> ScholarlyWork:
    """Fill gaps in `primary` from `other`; never overwrite a present value with a different one."""
    data = primary.model_dump()
    incoming = other.model_dump()
    for field, value in incoming.items():
        if field == "sources":
            data["sources"] = list(dict.fromkeys([*data["sources"], *value]))
        elif field == "abstract":
            if value and (not data["abstract"] or len(value) > len(data["abstract"]) * 1.3):
                data["abstract"] = value
        elif field == "authors":
            if len(value) > len(data["authors"]):
                data["authors"] = value
        elif field == "citation_count":
            data["citation_count"] = max(data["citation_count"], value or 0)
        elif field == "is_open_access":
            data["is_open_access"] = data["is_open_access"] or value
        elif field == "keywords":
            data["keywords"] = list(dict.fromkeys([*data["keywords"], *value]))[:12]
        elif data.get(field) in (None, "", []) and value not in (None, "", []):
            data[field] = value
    return ScholarlyWork.model_validate(data)


def merge_and_dedupe(result_lists: Sequence[list[ScholarlyWork]]) -> tuple[list[ScholarlyWork], dict[int, float]]:
    """Returns merged works and their fused reciprocal-rank score (keyed by list index).

    Records are grouped with a union-find. Two groups join when they share a strong identifier (DOI, PMID,
    arXiv) - transitively, so a record carrying both a DOI and a PMID bridges the DOI group and the PMID group -
    or when a corroborated title + year match links them. Groups whose identifiers conflict (two different DOIs)
    never join."""
    records: list[tuple[ScholarlyWork, int]] = [(w, rank) for works in result_lists for rank, w in enumerate(works)]
    parent = list(range(len(records)))
    group_work: dict[int, ScholarlyWork] = {i: w for i, (w, _) in enumerate(records)}

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra == rb or _conflicts(group_work[ra], group_work[rb]):
            return
        keep, drop = min(ra, rb), max(ra, rb)  # the earliest record (best-ranked provider list) stays primary
        parent[drop] = keep
        group_work[keep] = merge_works(group_work[keep], group_work[drop])

    by_strong: dict[str, int] = {}
    for index, (work, _) in enumerate(records):
        for key in _strong_keys(work):
            if key in by_strong:
                union(by_strong[key], index)
            else:
                by_strong[key] = index
    by_title: dict[str, list[int]] = {}
    for index, (work, _) in enumerate(records):
        if title_key := _title_key(work):
            for other in by_title.get(title_key, []):
                if _same_by_title(group_work[find(other)], work):
                    union(other, index)
            by_title.setdefault(title_key, []).append(index)

    merged: list[ScholarlyWork] = []
    scores: dict[int, float] = {}
    slot: dict[int, int] = {}
    for index, (_, rank) in enumerate(records):
        root = find(index)
        if root not in slot:
            slot[root] = len(merged)
            merged.append(group_work[root])
            scores[slot[root]] = 0.0
        scores[slot[root]] += 1.0 / (RRF_K + rank + 1)
    return merged, scores


def _terms(text: str) -> set[str]:
    return {t for t in _TOKEN.findall(text.lower()) if t not in _STOP and len(t) > 1}


def rank(works: list[ScholarlyWork], fused: dict[int, float], query: str) -> list[ScholarlyWork]:
    query_terms = _terms(query)

    def score(item: tuple[int, ScholarlyWork]) -> float:
        index, work = item
        rrf = fused.get(index, 0.0) * RRF_K  # ~1.0 for a first-place hit in one provider
        coverage = len(query_terms & _terms(work.title)) / len(query_terms) if query_terms else 0.0
        abstract_bonus = 0.1 if work.abstract else 0.0
        citations = min(math.log10(1 + work.citation_count) / 4, 0.3)
        return rrf + 0.8 * coverage + abstract_bonus + citations

    return [w for _, w in sorted(enumerate(works), key=score, reverse=True)]


class _Shared:
    """One upstream request shared by identical searches, and how many of them are still waiting for it."""

    def __init__(self, future: asyncio.Future[list[ScholarlyWork]]) -> None:
        self.future = future
        self.waiters = 0


_inflight: dict[tuple[object, ...], _Shared] = {}


def _settle(key: tuple[object, ...], shared: _Shared) -> None:
    if _inflight.get(key) is shared:
        del _inflight[key]
    if not shared.future.cancelled():
        shared.future.exception()  # retrieved here, so an outcome nobody awaited any more is never logged as lost


async def _await_shared(
    key: tuple[object, ...], start: Callable[[], Awaitable[list[ScholarlyWork]]]
) -> list[ScholarlyWork]:
    """Identical searches already on their way to a database share one request (audit SF06). One person leaving
    does not cancel it for the others; when the last one has left, it is cancelled and has ended before this
    returns, so nothing of an abandoned search keeps running (audit: stream lifecycle)."""
    shared = _inflight.get(key)
    if shared is None:
        shared = _Shared(asyncio.ensure_future(start()))
        _inflight[key] = shared
        shared.future.add_done_callback(lambda _done, key=key, shared=shared: _settle(key, shared))
    shared.waiters += 1
    try:
        return await asyncio.shield(shared.future)
    finally:
        shared.waiters -= 1
        if shared.waiters == 0 and not shared.future.done():
            shared.future.cancel()
            await asyncio.gather(shared.future, return_exceptions=True)


async def _run_provider(
    name: ProviderName,
    query: str,
    limit: int,
    year_from: int | None,
    year_to: int | None,
    oa_only: bool,
    subject: str | None = None,
) -> tuple[ProviderStatus, list[ScholarlyWork]]:
    provider = PROVIDERS[name]
    key = (name, query.casefold(), limit, year_from, year_to, oa_only, subject)
    cached = _cached(key)
    if cached is not None:
        return ProviderStatus(provider=name, ok=True, count=len(cached)), cached
    try:
        works = await _await_shared(
            key,
            lambda: asyncio.wait_for(
                provider.search(query, limit, year_from, year_to, oa_only, subject=subject),
                timeout=PROVIDER_TIMEOUT_SECONDS,
            ),
        )
        _remember(key, works)
        return ProviderStatus(provider=name, ok=True, count=len(works)), works
    except TimeoutError:
        return ProviderStatus(provider=name, ok=False, error="timed out"), []
    except AppError as exc:
        return ProviderStatus(provider=name, ok=False, error=exc.message), []
    except Exception as exc:  # a malformed upstream payload must not take down the whole search
        log.warning("scholarly.provider_failed", extra={"provider": name, "error": repr(exc)})
        return ProviderStatus(provider=name, ok=False, error="unexpected response"), []


def default_providers(subject: str = "all") -> list[ProviderName]:
    """The sources searched when none are chosen. Semantic Scholar joins only with its key: without one it refuses
    most requests (HTTP 429) and adds little beyond OpenAlex. It stays available when chosen explicitly and for
    identifier lookups (Deep Research audit, provider decision)."""
    keyed_s2 = bool(get_settings().semantic_scholar_api_key)
    return [
        p  # type: ignore[misc]
        for p in DEFAULT_PROVIDERS.get(subject, DEFAULT_PROVIDERS["all"])
        if available(p) and (p != "semantic_scholar" or keyed_s2)
    ]


async def federated_search(
    query: str,
    *,
    providers: Sequence[ProviderName] = ALL_PROVIDERS,
    limit: int = 20,
    year_from: int | None = None,
    year_to: int | None = None,
    open_access_only: bool = False,
    subject: str = "all",
) -> tuple[list[ScholarlyWork], list[ProviderStatus]]:
    per_provider = max(10, min(limit, 40))
    # Each provider at most once, and only those that are configured (CORE needs a key).
    selected = [p for p in dict.fromkeys(providers) if p in PROVIDERS and available(p)]
    outcomes = await asyncio.gather(
        *(_run_provider(p, query, per_provider, year_from, year_to, open_access_only, subject) for p in selected)
    )
    statuses = [status for status, _ in outcomes]
    return merged_results(
        [works for _, works in outcomes], query, limit=limit, open_access_only=open_access_only
    ), statuses


def merged_results(
    result_lists: Sequence[list[ScholarlyWork]], query: str, *, limit: int, open_access_only: bool = False
) -> list[ScholarlyWork]:
    """Merge the databases' answers, drop duplicates, rank, and cut to `limit` (shared by the one-shot and the
    streaming search)."""
    merged, fused = merge_and_dedupe(result_lists)
    if open_access_only:
        keep = [i for i, w in enumerate(merged) if w.is_open_access or w.oa_pdf_url]
        merged = [merged[i] for i in keep]
        fused = {new: fused[old] for new, old in enumerate(keep)}
    return rank(merged, fused, query)[:limit]


async def search_progressively(
    query: str,
    *,
    providers: Sequence[ProviderName],
    limit: int = 20,
    year_from: int | None = None,
    year_to: int | None = None,
    open_access_only: bool = False,
    subject: str = "all",
) -> AsyncIterator[tuple[ProviderStatus, list[ScholarlyWork]]]:
    """Each database's answer as soon as it arrives (fastest first). Unfinished requests are cancelled if the
    caller stops early, e.g. when the person leaves the page.

    open_access_only is passed to every database, exactly as federated_search does: filtering an unrestricted
    first page afterwards would miss open papers beyond it (audit SF04). merged_results still filters as a guard."""
    per_provider = max(10, min(limit, 40))
    selected = [p for p in dict.fromkeys(providers) if p in PROVIDERS and available(p)]
    tasks = [
        asyncio.create_task(_run_provider(p, query, per_provider, year_from, year_to, open_access_only, subject))
        for p in selected
    ]
    try:
        for finished in asyncio.as_completed(tasks):
            yield await finished
    finally:
        for task in tasks:
            task.cancel()
        # Joined, not just signalled: nothing of this search is still running once the stream has closed.
        await asyncio.gather(*tasks, return_exceptions=True)


_LOOKUP_ORDER: dict[str, tuple[ProviderName, ...]] = {
    "doi": ("crossref", "openalex", "pubmed", "semantic_scholar"),
    "pmid": ("pubmed", "openalex", "semantic_scholar"),
    "pmcid": ("pubmed", "openalex", "semantic_scholar"),
    "arxiv": ("arxiv", "semantic_scholar"),
}


async def resolve_identifier(identifier: Identifier) -> ScholarlyWork | None:
    """Authoritative metadata for one identifier, enriched (abstract, OA links, IDs) from other providers."""
    work, _ = await resolve_identifier_reporting(identifier)
    return work


async def resolve_identifier_reporting(identifier: Identifier) -> tuple[ScholarlyWork | None, list[ProviderStatus]]:
    """resolve_identifier, plus what each registry said: found it (count 1), has no record (ok, count 0) or could
    not be reached (not ok). An outage is never reported as "no registry has this paper" (audit SF07)."""
    order = _LOOKUP_ORDER[identifier.kind]

    async def attempt(name: ProviderName) -> tuple[ProviderStatus, ScholarlyWork | None]:
        try:
            work = await asyncio.wait_for(
                PROVIDERS[name].lookup(identifier.kind, identifier.value), timeout=PROVIDER_TIMEOUT_SECONDS
            )
        except TimeoutError:
            return ProviderStatus(provider=name, ok=False, error="timed out"), None
        except AppError as exc:
            return ProviderStatus(provider=name, ok=False, error=exc.message), None
        except Exception as exc:
            log.info("scholarly.lookup_failed", extra={"provider": name, "error": repr(exc)})
            return ProviderStatus(provider=name, ok=False, error="unexpected response"), None
        return ProviderStatus(provider=name, ok=True, count=1 if work else 0), work

    outcomes = await asyncio.gather(*(attempt(name) for name in order))
    statuses = [status for status, _ in outcomes]
    found = [w for _, w in outcomes if w is not None]
    if not found:
        return None, statuses
    work = found[0]
    for extra in found[1:]:
        if _conflicts(work, extra):  # a provider returned a different publication: never blend it in
            log.info("scholarly.lookup_conflict", extra={"identifier": identifier.value})
            continue
        work = merge_works(work, extra)
    # The arXiv/PubMed records may expose a DOI that unlocks richer Crossref/OpenAlex enrichment.
    if identifier.kind != "doi" and work.doi and "crossref" not in work.sources:
        enriched = await resolve_identifier(Identifier("doi", work.doi))
        if enriched and not _conflicts(work, enriched):
            work = merge_works(work, enriched)
    return work, statuses
