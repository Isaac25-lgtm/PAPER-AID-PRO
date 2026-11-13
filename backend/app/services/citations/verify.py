"""Reference verification: does each reference correspond to a real, findable publication?

Deterministic and explainable. For each reference string we resolve its DOI (if present) or run a Crossref
bibliographic search, then compare title, first author and year. Nothing is guessed: the result states what
matched and what did not.
"""

from __future__ import annotations

import asyncio
import re
from difflib import SequenceMatcher
from typing import Any, Literal

from app.errors import AppError
from app.services.scholarly.http import get_json
from app.services.scholarly.identifiers import normalize_doi, normalize_title
from app.services.scholarly.models import ScholarlyWork
from app.services.scholarly.providers import Crossref

Verdict = Literal["verified", "likely_match", "mismatch", "not_found", "error"]
MAX_REFERENCES = 50
_YEAR = re.compile(r"\b(1[5-9]\d\d|20\d\d)\b")


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize_title(a), normalize_title(b)).ratio()


def _title_in_reference(reference: str, title: str) -> float:
    """Best fuzzy match of the candidate title against windows of the reference text."""
    ref, cand = normalize_title(reference), normalize_title(title)
    if not cand:
        return 0.0
    if cand in ref:
        return 1.0
    words, size = ref.split(), len(cand.split())
    best = 0.0
    for start in range(0, max(1, len(words) - size + 1)):
        window = " ".join(words[start : start + size + 2])
        best = max(best, SequenceMatcher(None, window, cand).ratio())
    return best


def _assess(reference: str, work: ScholarlyWork, via_doi: bool) -> dict[str, Any]:
    title_score = _title_in_reference(reference, work.title)
    years = {int(y) for y in _YEAR.findall(reference)}
    year_ok = work.year in years if (years and work.year) else None
    family = (work.authors[0].family or "") if work.authors else ""
    author_ok = family.lower() in reference.lower() if family else None
    checks = {"title_similarity": round(title_score, 2), "year_matches": year_ok, "first_author_matches": author_ok}
    if title_score >= 0.85 and year_ok is not False and author_ok is not False:
        verdict: Verdict = "verified"
    elif title_score >= 0.6 and (year_ok or author_ok):
        verdict = "likely_match"
    elif via_doi:
        verdict = "mismatch"  # DOI resolves, but to a different work than the text describes
    else:
        verdict = "not_found"
    return {"verdict": verdict, "checks": checks}


async def verify_reference(reference: str) -> dict[str, Any]:
    text = reference.strip()
    result: dict[str, Any] = {"reference": text}
    try:
        doi = normalize_doi(text)
        if doi:
            work = await Crossref.lookup("doi", doi)
            if work is None:
                return {
                    **result,
                    "verdict": "not_found",
                    "explanation": f"DOI {doi} is not registered with Crossref.",
                    "match": None,
                }
            assessment = _assess(text, work, via_doi=True)
        else:
            data = await get_json(
                "https://api.crossref.org/works",
                params=Crossref._params({"query.bibliographic": text[:500], "rows": 3, "select": Crossref._select}),
            )
            candidates = [w for item in (data.get("message") or {}).get("items", []) if (w := Crossref.to_work(item))]
            if not candidates:
                return {
                    **result,
                    "verdict": "not_found",
                    "explanation": "No matching publication found in Crossref.",
                    "match": None,
                }
            scored = sorted(candidates, key=lambda w: _title_in_reference(text, w.title), reverse=True)
            work = scored[0]
            assessment = _assess(text, work, via_doi=False)
    except AppError as exc:
        return {**result, "verdict": "error", "explanation": exc.message, "match": None}
    explanations = {
        "verified": "Title, author and year match a registered publication.",
        "likely_match": "A closely matching publication exists; check the details flagged below.",
        "mismatch": "The DOI resolves to a different publication than the reference describes.",
        "not_found": "No registered publication closely matches this reference.",
    }
    return {
        **result,
        **assessment,
        "explanation": explanations[assessment["verdict"]],
        "match": {
            "title": work.title,
            "authors": [a.name for a in work.authors[:6]],
            "year": work.year,
            "journal": work.journal,
            "doi": work.doi,
        },
    }


async def verify_references(references: list[str]) -> list[dict[str, Any]]:
    cleaned = [r for r in (ref.strip() for ref in references) if len(r) >= 12][:MAX_REFERENCES]
    semaphore = asyncio.Semaphore(4)

    async def run(ref: str) -> dict[str, Any]:
        async with semaphore:
            return await verify_reference(ref)

    return list(await asyncio.gather(*(run(r) for r in cleaned)))
