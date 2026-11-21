"""Forgiving word matching for searches over the app's own records: passages of a paper, library titles, catalogue
titles. One implementation for all three (Deep Research audit Q1).

Policy (Q2, F05, F09):
- Only when nothing matches the words as typed, each unknown word of four or more letters is replaced by the closest
  word the records really contain (difflib ratio >= CLOSE_MATCH; ties go to the more frequent word). Nothing outside
  the records is ever proposed, and no outside service is called.
- The caller always reports the effective query, so the screen can say "Showing results for ..." and offer the exact
  words. `exact=True` skips the correction entirely.

A similar word is not necessarily the same subject ("fetal" and "metal" differ by one letter): that is why the
substitution is always shown and reversible, never silent.
"""

from __future__ import annotations

import difflib
import re
from collections import Counter
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass

WORD = re.compile(r"[^\W_]+")
CLOSE_MATCH = (
    0.8  # difflib ratio: "malria" ~ "malaria" (0.92), "atention" ~ "attention" (0.94), "heds" ~ "heads" (0.89)
)
MIN_CORRECTED_LENGTH = 4


def words_of(text: str) -> list[str]:
    """Lower-case words (letters and digits). Punctuation, %, _ and other wildcard characters are dropped."""
    return [w for w in WORD.findall(text.lower()) if w]


def correct_from_vocabulary(words: list[str], texts: Iterable[str]) -> list[str] | None:
    """Each word that never occurs in `texts` replaced by the closest word that does ("scool feding" -> "school
    feeding"), so only words the records really contain are ever proposed. None when nothing changes."""
    frequency = Counter(w for text in texts for w in words_of(text) if len(w) >= 3)
    if not frequency:
        return None
    vocabulary = sorted(frequency)
    corrected, changed = [], False
    for word in words:
        if len(word) >= MIN_CORRECTED_LENGTH and word.isalpha() and word not in frequency:
            close = difflib.get_close_matches(word, vocabulary, n=3, cutoff=CLOSE_MATCH)
            if close:
                corrected.append(
                    max(close, key=lambda c: (difflib.SequenceMatcher(None, word, c).ratio(), frequency[c]))
                )
                changed = True
                continue
        corrected.append(word)
    return corrected if changed else None


@dataclass(frozen=True)
class Outcome:
    """What a search over the app's own records actually searched for."""

    query: str  # the words searched (the typed words, or their correction)
    total: int
    corrected_from: str | None = None  # the typed words, when a correction was used


async def search_with_correction(
    typed: str,
    *,
    exact: bool,
    count: Callable[[str], Awaitable[int]],
    vocabulary: Callable[[], Awaitable[Iterable[str]]],
) -> Outcome:
    """Count matches for the typed words; when there are none (and the search is not exact), retry once with the
    words corrected against `vocabulary()`. The correction is kept only if it finds something."""
    query = " ".join(typed.split())  # as typed (search syntax such as quotes is kept for the first attempt)
    total = await count(query)
    if exact or total or not query:
        return Outcome(query, total)
    corrected = correct_from_vocabulary(words_of(query), await vocabulary())
    if not corrected:
        return Outcome(query, total)
    retry = " ".join(corrected)
    retry_total = await count(retry)
    return Outcome(retry, retry_total, corrected_from=query) if retry_total else Outcome(query, total)
