"""CSL citation/bibliography formatting via citeproc-js (the reference CSL processor used by Zotero/Mendeley).

The Python API sends CSL-JSON + the style XML to a pinned Node runner (engine/format.cjs) over stdin/stdout.
Styles are the official CSL repository files bundled in ./csl (CC BY-SA 3.0).
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from dataclasses import dataclass, field
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
    group: str  # discipline grouping shown in style pickers
    has_bibliography: bool = True  # False for footnote-only styles (e.g. Bluebook law review)


# Official CSL repository styles (CC BY-SA 3.0), bundled so formatting never depends on a network call.
STYLES: dict[str, StyleInfo] = {
    s.id: s
    for s in [
        StyleInfo("apa", "APA 7th edition", "author-date", "Widely used"),
        StyleInfo("harvard", "Harvard (Cite Them Right)", "author-date", "Widely used"),
        StyleInfo("mla", "MLA 9th edition", "author-date", "Humanities"),
        StyleInfo("chicago-author-date", "Chicago 18th (author-date)", "author-date", "Humanities"),
        StyleInfo("chicago-note", "Chicago 18th (notes & bibliography)", "note", "Humanities"),
        StyleInfo("asa", "ASA (American Sociological Association)", "author-date", "Social sciences"),
        StyleInfo("apsa", "APSA (political science)", "author-date", "Social sciences"),
        StyleInfo("aaa", "AAA (anthropology)", "author-date", "Social sciences"),
        StyleInfo("oscola", "OSCOLA 4th edition (law, UK & Commonwealth)", "note", "Law"),
        StyleInfo("bluebook", "Bluebook (law review, US; footnotes only)", "note", "Law", has_bibliography=False),
        StyleInfo("vancouver", "Vancouver (NLM/ICMJE)", "numeric", "Health & life sciences"),
        StyleInfo("ama", "AMA 11th edition", "numeric", "Health & life sciences"),
        StyleInfo("nature", "Nature", "numeric", "Sciences"),
        StyleInfo("science", "Science", "numeric", "Sciences"),
        StyleInfo("acs", "ACS (chemistry)", "numeric", "Sciences"),
        StyleInfo("ieee", "IEEE", "numeric", "Engineering & computing"),
        StyleInfo("elsevier-harvard", "Elsevier Harvard (with titles)", "author-date", "Publishers"),
        StyleInfo("springer-author-date", "Springer basic (author-date)", "author-date", "Publishers"),
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
    bibliography_ids: list[str] = field(default_factory=list)  # item id of each bibliography entry (CSL order)


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
    return Formatted(
        citations=result.get("citations", []),
        bibliography=result.get("bibliography", []),
        bibliography_ids=result.get("bibliography_ids", []),
    )
