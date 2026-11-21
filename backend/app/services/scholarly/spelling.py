"""Spelling correction for search queries ("malria preventon in scools" -> "malaria prevention in schools").

Scholarly databases match words literally, so one typo can return papers that share the typo instead of papers on
the topic. Correction is in two steps, and both must agree:

1. Suggest. NCBI's ESpell proposes a corrected query (it covers far more than medicine: it fixed medieval,
   architecture, climate, machine learning and crop yield in our checks).
2. Confirm against the literature. Each changed word is accepted only if, in OpenAlex (every discipline), the word
   as typed is at least CONFIRM_RATIO times rarer than the suggested word. Real typos are rare ("malria" 6k papers,
   "malaria" 720k); real words are not ("postcolonial" 336k is never turned into "opostcolonial"; French "filles"
   is never turned into "files"; "omics" is never turned into "comics").

Anything that fails, times out or looks like an identifier, acronym, gene name or number is left as typed. The
caller always offers the search exactly as typed, so a correction is a suggestion, never a trap.
"""

from __future__ import annotations

import asyncio
import difflib
import logging
import re
from collections import OrderedDict

from app.config import get_settings
from app.services.scholarly.http import get_http_client, get_json
from app.services.scholarly.identifiers import parse_identifier

log = logging.getLogger(__name__)

ESPELL_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/espell.fcgi"
OPENALEX_WORKS = "https://api.openalex.org/works"
CONFIRM_RATIO = 50  # the typed word must be at least this many times rarer than the correction
TIMEOUT_SECONDS = 4.0
MAX_QUERY_CHARS = 300
_CACHE_SIZE = 512
_CORRECTED = re.compile(r"<CorrectedQuery>([^<]*)</CorrectedQuery>")
_WORD = re.compile(r"^[^\W\d_]{3,}$")  # letters only, at least three

_cache: OrderedDict[str, str | None] = OrderedDict()


def _remember(key: str, value: str | None) -> str | None:
    _cache[key] = value
    _cache.move_to_end(key)
    while len(_cache) > _CACHE_SIZE:
        _cache.popitem(last=False)
    return value


def _checkable(token: str) -> bool:
    """Plain words only: never acronyms (HIV, mRNA, qPCR), numbers, codes or very short words."""
    if not _WORD.match(token):
        return False
    upper = sum(1 for ch in token if ch.isupper())
    return upper == 0 or (upper == 1 and token[0].isupper())


async def _espell(query: str) -> str | None:
    params = {"db": "pubmed", "term": query}
    key = get_settings().ncbi_api_key
    if key:
        params["api_key"] = key
    response = await get_http_client().get(ESPELL_URL, params=params, timeout=TIMEOUT_SECONDS)
    if response.status_code != 200:
        return None
    match = _CORRECTED.search(response.text)
    return match.group(1).strip() if match and match.group(1).strip() else None


async def _count(word: str) -> int | None:
    data = await get_json(OPENALEX_WORKS, params={"search": word, "per-page": 1, "select": "id"}, retries=0)
    count = (data or {}).get("meta", {}).get("count") if isinstance(data, dict) else None
    return count if isinstance(count, int) else None


def changed_words(original: str, suggested: str) -> list[tuple[int, str]]:
    """(position in the original's words, suggested word) for each one-for-one word replacement."""
    before, after = original.split(), suggested.split()
    pairs: list[tuple[int, str]] = []
    matcher = difflib.SequenceMatcher(a=[w.lower() for w in before], b=[w.lower() for w in after], autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag != "replace" or i2 - i1 != j2 - j1:
            continue  # merged or split words: too uncertain to apply
        for offset in range(i2 - i1):
            typed, proposed = before[i1 + offset], after[j1 + offset]
            if _checkable(typed) and _WORD.match(proposed) and typed.lower() != proposed.lower():
                pairs.append((i1 + offset, proposed.lower()))
    return pairs


async def _confirmed(typed: str, proposed: str) -> bool:
    typed_count, proposed_count = await asyncio.gather(_count(typed), _count(proposed))
    if typed_count is None or not proposed_count:
        return False
    return typed_count * CONFIRM_RATIO <= proposed_count


async def _suggest(query: str) -> str | None:
    suggested = await _espell(query)
    if not suggested or suggested.lower() == query.lower():
        return None
    pairs = changed_words(query, suggested)
    if not pairs:
        return None
    words = query.split()
    verdicts = await asyncio.gather(*(_confirmed(words[i], proposed) for i, proposed in pairs))
    accepted = [(i, proposed) for (i, proposed), ok in zip(pairs, verdicts, strict=True) if ok]
    if not accepted:
        return None
    for i, proposed in accepted:
        words[i] = proposed.capitalize() if words[i][0].isupper() else proposed
    corrected = " ".join(words)
    return corrected if corrected != " ".join(query.split()) else None


async def suggest_correction(query: str) -> str | None:
    """A corrected query, or None when the query looks right (or cannot be checked)."""
    query = " ".join(query.split())
    if len(query) < 3 or len(query) > MAX_QUERY_CHARS or parse_identifier(query) is not None:
        return None
    if not any(_checkable(word) for word in query.split()):
        return None
    key = query.lower()
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    try:
        result = await asyncio.wait_for(_suggest(query), timeout=TIMEOUT_SECONDS * 2)
    except Exception as exc:  # spelling help must never break a search
        log.info("spelling.unavailable", extra={"error": repr(exc)})
        return None  # not cached: try again next time
    return _remember(key, result)
