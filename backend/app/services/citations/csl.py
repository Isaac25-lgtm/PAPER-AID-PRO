"""CSL citation/bibliography formatting via citeproc-js (the reference CSL processor used by Zotero/Mendeley).

The Python API sends CSL-JSON + the style XML to a pinned Node runner (engine/format.cjs) over stdin/stdout.
Styles are the official CSL repository files bundled in ./csl (CC BY-SA 3.0).
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from app.errors import UpstreamError, ValidationFailed

_DIR = Path(__file__).parent
_RUNNER = _DIR / "engine" / "format.cjs"
_TIMEOUT_SECONDS = 15


@dataclass(frozen=True)
class StyleInfo:
    id: str
    title: str
    kind: Literal["author-date", "numeric", "note"]


STYLES: dict[str, StyleInfo] = {
    s.id: s
    for s in [
        StyleInfo("apa", "APA 7th edition", "author-date"),
        StyleInfo("mla", "MLA 9th edition", "author-date"),
        StyleInfo("chicago-author-date", "Chicago 18th (author-date)", "author-date"),
        StyleInfo("chicago-note", "Chicago 18th (notes & bibliography)", "note"),
        StyleInfo("harvard", "Harvard (Cite Them Right)", "author-date"),
        StyleInfo("vancouver", "Vancouver (NLM/ICMJE)", "numeric"),
        StyleInfo("ieee", "IEEE", "numeric"),
        StyleInfo("ama", "AMA 11th edition", "numeric"),
        StyleInfo("nature", "Nature", "numeric"),
        StyleInfo("science", "Science", "numeric"),
    ]
}


@lru_cache(maxsize=32)
def _style_xml(style_id: str) -> str:
    if style_id not in STYLES:
        raise ValidationFailed(f"Unknown citation style '{style_id}'.")
    return (_DIR / "csl" / f"{style_id}.csl").read_text(encoding="utf-8")


@lru_cache(maxsize=1)
def _locale_xml() -> str:
    return (_DIR / "csl" / "locales-en-US.xml").read_text(encoding="utf-8")


def _node() -> str:
    node = shutil.which("node")
    if node is None:
        raise UpstreamError("The citation engine is unavailable (Node.js runtime missing).")
    return node


@dataclass
class Formatted:
    citations: list[str]
    bibliography: list[str]


async def format_citations(
    items: list[dict[str, Any]],
    *,
    style: str,
    clusters: list[list[dict[str, Any]]] | None = None,
    bibliography: bool = True,
    output: Literal["html", "text"] = "html",
) -> Formatted:
    """Format in-text citation clusters (in document order) and/or the bibliography for `items`."""
    if not items:
        return Formatted([], [])
    request = {
        "style": _style_xml(style),
        "locale": _locale_xml(),
        "items": items,
        "clusters": [{"items": cluster} for cluster in (clusters or [])],
        "bibliography": bibliography,
        "format": output,
        "note": STYLES[style].kind == "note",
    }
    # A worker thread (not asyncio subprocesses) keeps this portable across event-loop implementations.
    try:
        completed = await asyncio.to_thread(
            subprocess.run,
            [_node(), str(_RUNNER)],
            input=json.dumps(request).encode("utf-8"),
            capture_output=True,
            timeout=_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise UpstreamError("Citation formatting timed out.") from exc
    stdout = completed.stdout
    try:
        result = json.loads(stdout.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise UpstreamError("The citation engine returned an invalid response.") from exc
    if "error" in result:
        raise UpstreamError(f"Citation formatting failed: {result['error']}")
    return Formatted(citations=result.get("citations", []), bibliography=result.get("bibliography", []))
