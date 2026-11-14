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


def _title_span(reference: str, title: str) -> tuple[float, int, int]:
    """Best fuzzy match of the candidate title against word windows of the reference.
    Returns (score, first word index, end word index) in the normalised reference."""
    ref_words, cand = normalize_title(reference).split(), normalize_title(title)
    if not cand:
        return 0.0, 0, 0
    size = len(cand.split())
    best = (0.0, 0, 0)
    for start in range(0, max(1, len(ref_words) - size + 1)):
        for width in (size, size + 1, size + 2):
            window = " ".join(ref_words[start : start + width])
            score = 1.0 if window == cand else SequenceMatcher(None, window, cand).ratio()
            if score > best[0]:
                best = (score, start, start + width)
    return best


def _title_in_reference(reference: str, title: str) -> float:
    return _title_span(reference, title)[0]


def _author_segment(reference: str, title: str) -> str:
    """The text before the title: where references list their authors (APA, Vancouver, IEEE, Harvard, ...).
    Searching only there stops a surname that happens to appear in a title or journal from counting."""
    score, start, _ = _title_span(reference, title)
    words = normalize_title(reference).split()
    return " ".join(words[:start]) if score >= 0.6 and start > 0 else ""


def _field(value: bool | None) -> str:
    return "matched" if value else "not checked" if value is None else "does not match"


def _assess(reference: str, work: ScholarlyWork, via_doi: bool) -> dict[str, Any]:
    title_score = _title_in_reference(reference, work.title)
    years = {int(y) for y in _YEAR.findall(reference)}
    year_ok: bool | None = (work.year in years) if (years and work.year) else None
    family = normalize_title((work.authors[0].family or work.authors[0].name.split(" ")[-1]) if work.authors else "")
    segment = _author_segment(reference, work.title)
    author_ok: bool | None = None
    if family and segment:
        author_ok = re.search(rf"(?<!\w){re.escape(family)}(?!\w)", segment) is not None
    checks = {
        "title_similarity": round(title_score, 2),
        "year_matches": year_ok,
        "first_author_matches": author_ok,
        "fields": {
            "title": "matched" if title_score >= 0.85 else "partial" if title_score >= 0.6 else "does not match",
            "year": _field(year_ok),
            "first_author": _field(author_ok),
        },
    }
    if title_score >= 0.85 and year_ok is True and author_ok is True:
        verdict: Verdict = "verified"  # every field was actually compared and agreed
    elif title_score >= 0.6 and year_ok is not False and author_ok is not False:
        verdict = "likely_match"  # nothing contradicts it, but something could not be checked (or title is close)
    elif via_doi:
        verdict = "mismatch"  # DOI resolves, but to a different work than the text describes
    else:
        verdict = "not_found"
    return {"verdict": verdict, "checks": checks}


def _candidate_score(reference: str, work: ScholarlyWork) -> float:
    assessment = _assess(reference, work, via_doi=False)["checks"]
    bonus = sum(0.1 for key in ("year_matches", "first_author_matches") if assessment[key])
    penalty = sum(0.2 for key in ("year_matches", "first_author_matches") if assessment[key] is False)
    return assessment["title_similarity"] + bonus - penalty


def _explanation(assessment: dict[str, Any]) -> str:
    fields = assessment["checks"]["fields"]
    verdict = assessment["verdict"]
    if verdict == "verified":
        return "Title, first author and year all match a registered publication."
    if verdict == "likely_match":
        unchecked = [name.replace("_", " ") for name, state in fields.items() if state == "not checked"]
        detail = f" Not checked: {', '.join(unchecked)} (missing from the reference)." if unchecked else ""
        return "A closely matching publication exists; check the details below." + detail
    if verdict == "mismatch":
        return "The DOI resolves to a different publication than the reference describes."
    return "No registered publication closely matches this reference."


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
                params=Crossref._params({"query.bibliographic": text[:500], "rows": 5, "select": Crossref._select}),
            )
            candidates = [w for item in (data.get("message") or {}).get("items", []) if (w := Crossref.to_work(item))]
            if not candidates:
                return {
                    **result,
                    "verdict": "not_found",
                    "explanation": "No matching publication found in Crossref.",
                    "match": None,
                }
            work = max(candidates, key=lambda w: _candidate_score(text, w))
            assessment = _assess(text, work, via_doi=False)
    except AppError as exc:
        return {**result, "verdict": "error", "explanation": exc.message, "match": None}
    return {
        **result,
        **assessment,
        "explanation": _explanation(assessment),
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
