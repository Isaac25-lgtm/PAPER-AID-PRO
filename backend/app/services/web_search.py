"""General web search for Deep research (optional).

Off until WEB_SEARCH_PROVIDER=tavily and TAVILY_API_KEY are set. Results are web pages, not peer-reviewed
records: Deep research labels them as web pages, cites them by address and never adds them to the catalogue.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from app.config import get_settings
from app.errors import UpstreamError
from app.services.scholarly.http import get_http_client

log = logging.getLogger(__name__)

TAVILY_URL = "https://api.tavily.com/search"
MAX_CONTENT_CHARS = 1800
_YEAR = re.compile(r"\b(19|20)\d{2}\b")
# Evidence is wrapped in <evidence> tags for the model; page text must not be able to close or open one.
_TAGLIKE = re.compile(r"</?\s*evidence\b[^>]*>", re.I)
_SPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class WebResult:
    url: str
    title: str
    site: str
    content: str
    year: int | None = None


def web_search_enabled() -> bool:
    return get_settings().web_search_enabled


def _clean(text: str, limit: int) -> str:
    return _SPACE.sub(" ", _TAGLIKE.sub(" ", text or "")).strip()[:limit]


def _site(url: str) -> str:
    host = urlsplit(url).hostname or ""
    return host.removeprefix("www.")


def _year(raw: object) -> int | None:
    match = _YEAR.search(str(raw or ""))
    return int(match.group(0)) if match else None


def parse_results(payload: object) -> list[WebResult]:
    """Keep only well-formed http(s) results with some text; drop everything else."""
    items = payload.get("results") if isinstance(payload, dict) else None
    results: list[WebResult] = []
    seen: set[str] = set()
    for raw in items if isinstance(items, list) else []:
        if not isinstance(raw, dict):
            continue
        url = str(raw.get("url") or "").strip()
        parts = urlsplit(url)
        if parts.scheme not in {"http", "https"} or not parts.hostname or url in seen:
            continue
        content = _clean(str(raw.get("content") or ""), MAX_CONTENT_CHARS)
        title = _clean(str(raw.get("title") or ""), 300).replace('"', "'") or _site(url)
        if len(content) < 40:
            continue
        seen.add(url)
        results.append(
            WebResult(url=url, title=title, site=_site(url), content=content, year=_year(raw.get("published_date")))
        )
    return results


async def search_web(query: str, *, limit: int = 5) -> list[WebResult]:
    """One web search. Raises UpstreamError when the service cannot be reached or refuses the request."""
    settings = get_settings()
    if not settings.web_search_enabled:
        return []
    try:
        response = await get_http_client().post(
            TAVILY_URL,
            json={"query": query[:400], "max_results": limit, "search_depth": "basic", "include_answer": False},
            headers={"Authorization": f"Bearer {settings.tavily_api_key}", "Content-Type": "application/json"},
        )
    except httpx.HTTPError as exc:
        raise UpstreamError("Could not reach the web search service.") from exc
    if response.status_code >= 400:
        # Never echo the response body: it may repeat the request, key included.
        raise UpstreamError(f"The web search service returned HTTP {response.status_code}.")
    try:
        return parse_results(response.json())[:limit]
    except ValueError as exc:
        raise UpstreamError("The web search service sent an unreadable response.") from exc
