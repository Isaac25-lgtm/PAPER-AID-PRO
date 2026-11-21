"""Forgiving word matching for searches over the app's own records (library titles, catalog titles)."""

from __future__ import annotations

import difflib
import re
from collections.abc import Iterable

WORD = re.compile(r"[^\W_]+")
CLOSE_MATCH = 0.8  # difflib ratio: "malria" ~ "malaria" (0.92), "feding" ~ "feeding" (0.92)


def words_of(text: str) -> list[str]:
    return [w for w in WORD.findall(text.lower()) if w]


def correct_from_vocabulary(words: list[str], texts: Iterable[str]) -> list[str] | None:
    """Each word that never occurs in `texts` replaced by the closest word that does ("scool feding" ->
    "school feeding"), so only words the records really contain are ever proposed. None when nothing changes."""
    vocabulary = sorted({w for text in texts for w in words_of(text) if len(w) >= 3})
    known = set(vocabulary)
    corrected, changed = [], False
    for word in words:
        if len(word) >= 4 and word.isalpha() and word not in known:
            close = difflib.get_close_matches(word, vocabulary, n=1, cutoff=CLOSE_MATCH)
            if close:
                corrected.append(close[0])
                changed = True
                continue
        corrected.append(word)
    return corrected if changed else None
