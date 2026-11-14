"""Download headers that work for any title (RFC 6266 / RFC 5987)."""

from __future__ import annotations

import re
import unicodedata
from typing import Literal
from urllib.parse import quote

_UNSAFE = re.compile(r'[\x00-\x1f\x7f"\\/:*?<>|;]+')


def content_disposition(filename: str, *, disposition: Literal["inline", "attachment"] = "attachment") -> str:
    """`filename=` carries an ASCII fallback; `filename*=` carries the exact UTF-8 name for modern clients."""
    name = _UNSAFE.sub(" ", filename).strip()[:150] or "download"
    stem, dot, ext = name.rpartition(".")
    if not dot:
        stem, ext = name, ""
    ascii_stem = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode("ascii")
    ascii_stem = re.sub(r"[^A-Za-z0-9 ._-]+", "", ascii_stem).strip() or "download"
    fallback = f"{ascii_stem}.{ext}" if ext else ascii_stem
    return f"{disposition}; filename=\"{fallback}\"; filename*=UTF-8''{quote(name, safe='')}"
