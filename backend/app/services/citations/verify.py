"""Reference verification: does each reference correspond to a real, findable publication?

Deterministic and explainable. For each reference string we resolve its DOI (if present) or search Crossref, then
compare title, first author and year. Nothing is guessed: the result states what matched, what did not, what
could not be compared, and which registries could not be reached.

Crossref does not hold everything: arXiv preprints (DataCite DOIs), many conference papers and some books are
missing. A real paper must never be reported as "not found" (that reads as an accusation of a fabricated
reference), so when Crossref does not verify a reference its likely title is also looked up in OpenAlex, and the
best candidate from both is assessed.

Each reference is parsed ONCE (list labels and links removed, words normalised) and each candidate is assessed
ONCE. A registry that cannot be reached never discards what another registry returned; when the result is
inconclusive because a registry was unavailable, the verdict is "error" (could not check), never "not found"
(Deep Research audit F02-F04, F10).
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, Literal

from app.errors import AppError
from app.services.scholarly.http import get_json
from app.services.scholarly.identifiers import normalize_doi, normalize_title
from app.services.scholarly.models import ScholarlyWork
from app.services.scholarly.providers import Crossref, OpenAlex

Verdict = Literal["verified", "registered", "likely_match", "mismatch", "not_found", "error"]
MAX_REFERENCES = 50
MAX_REFERENCE_CHARS = 1500  # one reference; longer text is almost always several references pasted together
MAX_TOTAL_CHARS = 40_000  # the whole request
MIN_REFERENCE_CHARS = 12
_YEAR = re.compile(r"\b(1[5-9]\d\d|20\d\d)\b")
_SEGMENT = re.compile(r"(?<=[.?!])\s+")
# Web addresses and DOIs carry digits that look like years ("arXiv.1706.03762" is not the year 1706).
_LINKS = re.compile(r"https?://\S+|\bdoi:\s*\S+|\b10\.\d{4,9}/\S+|\barxiv:\s*\S+", re.IGNORECASE)
# A bibliography label at the very start: "1.", "12)", "[12]", "(3)". Numbers inside a title are kept.
_LIST_LABEL = re.compile(r"^\s*(?:\[\d{1,4}\]|\(\d{1,4}\)|\d{1,4}[.)])\s+")
_INITIALS = re.compile(r"[A-Z]\.(?:-?[A-Z]\.)*,?")
_LEADING_YEAR = re.compile(r"^\(?\d{4}[a-z]?\)?\.?\s*")
_LETTERS = re.compile(r"[^\W\d_]{4,}")
TITLE_MATCH = 0.85
TITLE_PARTIAL = 0.6


def title_segments(reference: str) -> list[str]:
    """Likely titles in a free-form reference: its sentence-like parts with 3-40 words, longest first, skipping
    author lists (commas with initials) and parts that are only numbers."""
    segments = []
    for raw in _SEGMENT.split(reference):
        part = _LEADING_YEAR.sub("", raw.strip(" .,;:()[]\"'“”"))
        words = part.split()
        if not 3 <= len(words) <= 40 or not _LETTERS.search(part):
            continue
        if sum(1 for w in words if len(w.strip(".,;:()[]")) >= 3 and w.strip(".,;:()[]").isalpha()) < 2:
            continue  # "Smith A (2017)": a name and a year, not a title
        if part.count(",") >= 2 and any(_INITIALS.fullmatch(w) for w in words):
            continue  # "Vaswani, A., Shazeer, N., ..."
        segments.append(part)
    return sorted(segments, key=len, reverse=True)[:2]


@dataclass(frozen=True)
class ParsedReference:
    """A reference as typed, prepared once for every comparison."""

    text: str  # as typed (trimmed), shown back to the person
    body: str  # without a leading list label and without links/DOIs
    words: list[str]  # normalised words of `body`
    doi: str | None
    titles: list[str]  # likely title segments (empty: the reference has no title to compare)

    @classmethod
    def parse(cls, reference: str) -> ParsedReference:
        text = reference.strip()
        unlabelled = _LIST_LABEL.sub("", text, count=1)
        body = _LINKS.sub(" ", unlabelled)
        return cls(
            text=text,
            body=body,
            words=normalize_title(body).split(),
            doi=normalize_doi(unlabelled),
            titles=title_segments(body),
        )


def _title_span(words: list[str], title: str) -> tuple[float, int, int]:
    """Best fuzzy match of the candidate title against word windows of the reference.
    Returns (score, first word index, end word index) in the normalised reference."""
    cand = normalize_title(title)
    if not cand or not words:
        return 0.0, 0, 0
    size = len(cand.split())
    best = (0.0, 0, 0)
    for start in range(0, max(1, len(words) - size + 1)):
        for width in (size, size + 1, size + 2):
            window = " ".join(words[start : start + width])
            score = 1.0 if window == cand else SequenceMatcher(None, window, cand).ratio()
            if score > best[0]:
                best = (score, start, start + width)
    return best


def _first_author_matches(before_title: list[str], family: str) -> bool | None:
    """Compare the FIRST listed author (skipping leading initials, e.g. IEEE "J. Smith") with the registry's."""
    names = [w for w in before_title if (len(w) > 1 or not w.isalpha()) and not w.isdigit()]
    while names and len(names[0]) == 1:
        names.pop(0)
    family_words = family.split()
    if not names or not family_words:
        return None
    return names[: len(family_words)] == family_words


def _field(value: bool | None) -> str:
    return "matched" if value else "not checked" if value is None else "does not match"


@dataclass
class Assessment:
    work: ScholarlyWork
    via_doi: bool
    title_score: float
    title_checked: bool
    year_ok: bool | None
    author_ok: bool | None
    verdict: Verdict = "not_found"
    ranking: float = 0.0

    def as_dict(self) -> dict[str, Any]:
        title_state = (
            "not checked"
            if not self.title_checked
            else "matched"
            if self.title_score >= TITLE_MATCH
            else "partial"
            if self.title_score >= TITLE_PARTIAL
            else "does not match"
        )
        return {
            "verdict": self.verdict,
            "via_doi": self.via_doi,
            "checks": {
                "title_similarity": round(self.title_score, 2),
                "year_matches": self.year_ok,
                "first_author_matches": self.author_ok,
                "fields": {"title": title_state, "year": _field(self.year_ok), "first_author": _field(self.author_ok)},
            },
        }


def assess(ref: ParsedReference, work: ScholarlyWork, *, via_doi: bool) -> Assessment:
    """Compare one reference with one registry record. Called once per candidate."""
    score, start, end = _title_span(ref.words, work.title)
    matched_title = score >= TITLE_PARTIAL
    # With no matching title, the reference still usually starts with its first author.
    before, outside = (
        (ref.words[:start], ref.words[:start] + ref.words[end:]) if matched_title else (ref.words, ref.words)
    )
    years = {int(y) for y in _YEAR.findall(" ".join(outside))}
    year_ok: bool | None = (work.year in years) if (years and work.year) else None
    family = normalize_title((work.authors[0].family or work.authors[0].name.split(" ")[-1]) if work.authors else "")
    author_ok = _first_author_matches(before, family) if family else None
    # A reference with no title text (a bare DOI, "Smith 2017 doi:...") has nothing to compare: not a conflict.
    title_checked = matched_title or bool(ref.titles)
    result = Assessment(work, via_doi, score, title_checked, year_ok, author_ok)
    if via_doi and not title_checked and year_ok is None and author_ok is None:
        result.verdict = "registered"  # the DOI resolves; the reference gives nothing else to compare
    elif score >= TITLE_MATCH and year_ok is True and author_ok is True:
        result.verdict = "verified"  # every field was actually compared and agreed
    elif (matched_title or (via_doi and not title_checked)) and year_ok is not False and author_ok is not False:
        result.verdict = "likely_match"  # nothing contradicts it, but something could not be checked
    elif via_doi or score >= TITLE_MATCH:
        result.verdict = "mismatch"  # a real publication, but the reference's author/year (or DOI target) disagree
    else:
        result.verdict = "not_found"
    bonus = sum(0.1 for ok in (year_ok, author_ok) if ok)
    penalty = sum(0.2 for ok in (year_ok, author_ok) if ok is False)
    result.ranking = score + bonus - penalty
    return result


def _explanation(a: Assessment) -> str:
    fields = a.as_dict()["checks"]["fields"]
    if a.verdict == "verified":
        return "Title, first author and year all match a registered publication."
    if a.verdict == "registered":
        return "This DOI is registered. The reference gives no title, author or year to compare with it."
    if a.verdict == "likely_match":
        unchecked = [name.replace("_", " ") for name, state in fields.items() if state == "not checked"]
        detail = f" Not checked: {', '.join(unchecked)} (missing from the reference)." if unchecked else ""
        return "A closely matching publication exists; check the details below." + detail
    if a.verdict == "mismatch":
        if a.via_doi and fields["title"] in {"does not match", "partial"}:
            return "The DOI resolves to a different publication than the reference describes."
        wrong = [name.replace("_", " ") for name, state in fields.items() if state == "does not match"]
        return "This publication exists, but the reference gets its " + " and ".join(wrong or ["details"]) + " wrong."
    return "No registered publication closely matches this reference."


@dataclass
class _Lookup:
    """Candidates gathered so far and which registries could not be reached."""

    candidates: list[ScholarlyWork] = field(default_factory=list)
    unavailable: list[str] = field(default_factory=list)

    def note(self, registry: str) -> None:
        if registry not in self.unavailable:
            self.unavailable.append(registry)


async def _crossref_search(ref: ParsedReference, found: _Lookup) -> None:
    try:
        data = await get_json(
            "https://api.crossref.org/works",
            params=Crossref._params({"query.bibliographic": ref.text[:500], "rows": 5, "select": Crossref._select}),
        )
    except AppError:
        found.note("Crossref")
        return
    found.candidates += [w for item in (data.get("message") or {}).get("items", []) if (w := Crossref.to_work(item))]


async def _openalex_search(ref: ParsedReference, found: _Lookup) -> None:
    for segment in ref.titles:  # each title segment separately: one failing keeps what the others returned
        try:
            data = await get_json(
                f"{OpenAlex.base}/works",
                params=OpenAlex._params(
                    {
                        "filter": f"title.search:{segment.replace(',', ' ')}",
                        "per-page": 5,
                        "sort": "cited_by_count:desc",
                    }
                ),
            )
        except AppError:
            found.note("OpenAlex")
            continue
        found.candidates += [w for item in (data or {}).get("results", []) if (w := OpenAlex.to_work(item))]


async def _resolve_doi(doi: str, found: _Lookup) -> ScholarlyWork | None:
    # arXiv and other DataCite DOIs are not in Crossref; OpenAlex resolves them. An outage of one registry still
    # lets the other answer.
    for registry, provider in (("Crossref", Crossref), ("OpenAlex", OpenAlex)):
        try:
            work = await provider.lookup("doi", doi)
        except AppError:
            found.note(registry)
            continue
        if work is not None:
            return work
    return None


def _coverage_note(found: _Lookup) -> str:
    if not found.unavailable:
        return ""
    return f" ({' and '.join(found.unavailable)} could not be reached, so this was checked against fewer registries.)"


def _unavailable(text: str, found: _Lookup, what: str) -> dict[str, Any]:
    return {
        "reference": text,
        "verdict": "error",
        "explanation": f"{what} could not be checked: {' and '.join(found.unavailable)} could not be reached. "
        "Try again in a few minutes.",
        "match": None,
        "unavailable": found.unavailable,
    }


async def verify_reference(reference: str) -> dict[str, Any]:
    ref = ParsedReference.parse(reference)
    found = _Lookup()
    best: Assessment | None
    if ref.doi:
        work = await _resolve_doi(ref.doi, found)
        if work is None:
            if found.unavailable:
                return _unavailable(ref.text, found, f"DOI {ref.doi}")
            return {
                "reference": ref.text,
                "verdict": "not_found",
                "explanation": f"DOI {ref.doi} is not registered with Crossref or OpenAlex.",
                "match": None,
                "unavailable": [],
            }
        best = assess(ref, work, via_doi=True)
    else:
        await _crossref_search(ref, found)
        assessed = [assess(ref, w, via_doi=False) for w in found.candidates]
        best_so_far = max(assessed, key=lambda a: a.ranking, default=None)
        if best_so_far is None or best_so_far.verdict != "verified":
            # Not confirmed by Crossref: a better record (an arXiv preprint, a conference version, the original
            # rather than a reprint) may be in OpenAlex; the best candidate from both is assessed.
            before = len(found.candidates)
            await _openalex_search(ref, found)
            assessed += [assess(ref, w, via_doi=False) for w in found.candidates[before:]]
        best = max(assessed, key=lambda a: a.ranking, default=None)
        if best is None or best.verdict == "not_found":
            if found.unavailable:  # inconclusive: never "not found" when a registry could not be asked
                return _unavailable(ref.text, found, "This reference")
            if best is None:
                return {
                    "reference": ref.text,
                    "verdict": "not_found",
                    "explanation": "No matching publication found in Crossref or OpenAlex.",
                    "match": None,
                    "unavailable": [],
                }
    assert best is not None  # every branch above returned when there was nothing to assess
    work = best.work
    return {
        "reference": ref.text,
        **best.as_dict(),
        "explanation": _explanation(best) + _coverage_note(found),
        "unavailable": found.unavailable,
        "match": {
            "title": work.title,
            "authors": [a.name for a in work.authors[:6]],
            "year": work.year,
            "journal": work.journal,
            "doi": work.doi,
        },
    }


async def verify_references(references: list[str]) -> list[dict[str, Any]]:
    cleaned = [r for r in (ref.strip() for ref in references) if len(r) >= MIN_REFERENCE_CHARS][:MAX_REFERENCES]
    semaphore = asyncio.Semaphore(4)

    async def run(ref: str) -> dict[str, Any]:
        async with semaphore:
            return await verify_reference(ref)

    return list(await asyncio.gather(*(run(r) for r in cleaned)))
