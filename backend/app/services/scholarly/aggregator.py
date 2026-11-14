"""Federated search + identifier resolution across scholarly providers.

Ranking is deliberately simple and explainable: reciprocal-rank fusion of each provider's own relevance order,
plus query-term coverage of the title and a small citation-count tie-breaker. No topic-specific rules.
"""

from __future__ import annotations

import asyncio
import logging
import math
import re
from collections.abc import Sequence

from app.errors import AppError
from app.services.scholarly.identifiers import Identifier, normalize_title
from app.services.scholarly.models import ALL_PROVIDERS, ProviderName, ProviderStatus, ScholarlyWork
from app.services.scholarly.providers import PROVIDERS

log = logging.getLogger(__name__)

PROVIDER_TIMEOUT_SECONDS = 12.0
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
    """A weak (title + year) match additionally needs agreeing first authors when both list authors."""
    fa, fb = _first_author_family(a), _first_author_family(b)
    return not (fa and fb and fa != fb)


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

    Strong identifiers (DOI, PMID, arXiv) decide identity. Title + year is only a fallback, never merges records
    whose identifiers conflict, and requires agreeing first authors."""
    merged: list[ScholarlyWork] = []
    scores: dict[int, float] = {}
    by_strong: dict[str, int] = {}
    by_title: dict[str, list[int]] = {}
    for works in result_lists:
        for rank, work in enumerate(works):
            existing = next((by_strong[k] for k in _strong_keys(work) if k in by_strong), None)
            if existing is not None and _conflicts(merged[existing], work):
                existing = None
            if existing is None and (title_key := _title_key(work)):
                existing = next(
                    (
                        i
                        for i in by_title.get(title_key, [])
                        if not _conflicts(merged[i], work) and _same_by_title(merged[i], work)
                    ),
                    None,
                )
            if existing is None:
                merged.append(work)
                existing = len(merged) - 1
                scores[existing] = 0.0
            else:
                merged[existing] = merge_works(merged[existing], work)
            scores[existing] += 1.0 / (RRF_K + rank + 1)
            for key in _strong_keys(merged[existing]):
                by_strong.setdefault(key, existing)
            if title_key := _title_key(merged[existing]):
                if existing not in by_title.setdefault(title_key, []):
                    by_title[title_key].append(existing)
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


async def _run_provider(
    name: ProviderName, query: str, limit: int, year_from: int | None, year_to: int | None, oa_only: bool
) -> tuple[ProviderStatus, list[ScholarlyWork]]:
    provider = PROVIDERS[name]
    try:
        works = await asyncio.wait_for(
            provider.search(query, limit, year_from, year_to, oa_only), timeout=PROVIDER_TIMEOUT_SECONDS
        )
        return ProviderStatus(provider=name, ok=True, count=len(works)), works
    except TimeoutError:
        return ProviderStatus(provider=name, ok=False, error="timed out"), []
    except AppError as exc:
        return ProviderStatus(provider=name, ok=False, error=exc.message), []
    except Exception as exc:  # a malformed upstream payload must not take down the whole search
        log.warning("scholarly.provider_failed", extra={"provider": name, "error": repr(exc)})
        return ProviderStatus(provider=name, ok=False, error="unexpected response"), []


async def federated_search(
    query: str,
    *,
    providers: Sequence[ProviderName] = ALL_PROVIDERS,
    limit: int = 20,
    year_from: int | None = None,
    year_to: int | None = None,
    open_access_only: bool = False,
) -> tuple[list[ScholarlyWork], list[ProviderStatus]]:
    per_provider = max(10, min(limit, 40))
    selected = [p for p in dict.fromkeys(providers) if p in PROVIDERS]  # each provider at most once
    outcomes = await asyncio.gather(
        *(_run_provider(p, query, per_provider, year_from, year_to, open_access_only) for p in selected)
    )
    statuses = [status for status, _ in outcomes]
    merged, fused = merge_and_dedupe([works for _, works in outcomes])
    if open_access_only:
        keep = [i for i, w in enumerate(merged) if w.is_open_access or w.oa_pdf_url]
        merged = [merged[i] for i in keep]
        fused = {new: fused[old] for new, old in enumerate(keep)}
    return rank(merged, fused, query)[:limit], statuses


_LOOKUP_ORDER: dict[str, tuple[ProviderName, ...]] = {
    "doi": ("crossref", "openalex", "pubmed", "semantic_scholar"),
    "pmid": ("pubmed", "openalex", "semantic_scholar"),
    "pmcid": ("pubmed", "openalex", "semantic_scholar"),
    "arxiv": ("arxiv", "semantic_scholar"),
}


async def resolve_identifier(identifier: Identifier) -> ScholarlyWork | None:
    """Authoritative metadata for one identifier, enriched (abstract, OA links, IDs) from other providers."""
    order = _LOOKUP_ORDER[identifier.kind]

    async def attempt(name: ProviderName) -> ScholarlyWork | None:
        try:
            return await asyncio.wait_for(
                PROVIDERS[name].lookup(identifier.kind, identifier.value), timeout=PROVIDER_TIMEOUT_SECONDS
            )
        except Exception as exc:
            log.info("scholarly.lookup_failed", extra={"provider": name, "error": repr(exc)})
            return None

    results = await asyncio.gather(*(attempt(name) for name in order))
    found = [w for w in results if w is not None]
    if not found:
        return None
    work = found[0]
    for extra in found[1:]:
        work = merge_works(work, extra)
    # The arXiv/PubMed records may expose a DOI that unlocks richer Crossref/OpenAlex enrichment.
    if identifier.kind != "doi" and work.doi and "crossref" not in work.sources:
        enriched = await resolve_identifier(Identifier("doi", work.doi))
        if enriched:
            work = merge_works(work, enriched)
    return work
