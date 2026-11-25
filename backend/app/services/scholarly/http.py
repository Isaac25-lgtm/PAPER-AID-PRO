"""Shared async HTTP client for scholarly APIs with polite identification and bounded retries."""

from __future__ import annotations

import asyncio
import random
from typing import Any

import httpx

from app.config import get_settings
from app.errors import UpstreamError
from app.services.scholarly.pacing import pacer_for

_client: httpx.AsyncClient | None = None


def user_agent() -> str:
    contact = get_settings().contact_email
    base = "PaperAidPro/2.0 (https://paperaid.web.app)"
    return f"{base} mailto:{contact}" if contact else base


def get_http_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        settings = get_settings()
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(settings.http_timeout_seconds, connect=8.0),
            headers={"User-Agent": user_agent(), "Accept": "application/json"},
            limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
            follow_redirects=True,
        )
    return _client


async def close_http_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
    _client = None


OPENALEX_HOST = "api.openalex.org"


def _with_keys(url: str, headers: dict[str, str] | None) -> dict[str, str] | None:
    """OpenAlex requires an API key (free) for its own budget; without one, every request shares a small daily
    allowance per IP address, and Cloud Run's egress addresses are shared. The key goes in a header, never the URL,
    so it cannot appear in logged URLs or error messages."""
    key = get_settings().openalex_api_key
    if key and httpx.URL(url).host == OPENALEX_HOST:
        return {**(headers or {}), "Authorization": f"Bearer {key}"}
    return headers


async def get_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    retries: int = 2,
    not_found_ok: bool = False,
    optional: bool = False,
) -> Any:
    """GET JSON. `optional`: the caller can do without the answer (spelling help), so it never waits for the
    service's shared pace and returns None when no slot is free (audit SF06)."""
    client = get_http_client()
    headers = _with_keys(url, headers)
    pacer = pacer_for(url)
    for attempt in range(retries + 1):
        if pacer is not None and not await pacer.acquire(optional=optional):
            return None
        try:
            response = await client.get(url, params=params, headers=headers)
        except httpx.TimeoutException as exc:
            if attempt < retries:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            raise UpstreamError(f"Timed out contacting {httpx.URL(url).host}.") from exc
        except httpx.HTTPError as exc:
            raise UpstreamError(f"Could not reach {httpx.URL(url).host}.") from exc
        if response.status_code == 404 and not_found_ok:
            return None
        if response.status_code in {429, 500, 502, 503, 504} and attempt < retries:
            delay = _retry_after(response, pacer)
            if delay is None:  # asked to wait longer than a request should be held open: give up now
                raise UpstreamError(f"{httpx.URL(url).host} asked us to wait; try again shortly.")
            await asyncio.sleep(delay + random.random() * 0.2)
            continue
        if response.status_code >= 400:
            raise UpstreamError(f"{httpx.URL(url).host} returned HTTP {response.status_code}.")
        return response.json()
    raise UpstreamError(f"{httpx.URL(url).host} is unavailable.")


def _retry_after(response: httpx.Response, pacer: Any) -> float | None:
    """Seconds to wait before retrying, or None when the service asked for more than MAX_RETRY_WAIT. A Retry-After
    also pauses every other request to that service in this process (pacing.Pacer.back_off)."""
    header = response.headers.get("retry-after")
    if header and header.strip().isdigit():
        seconds = float(header.strip())
        if pacer is not None:
            pacer.back_off(seconds)
        return seconds if seconds <= MAX_RETRY_WAIT else None
    return 0.6


MAX_RETRY_WAIT = 3.0


async def get_text(url: str, *, params: dict[str, Any] | None = None, retries: int = 2) -> str:
    client = get_http_client()
    pacer = pacer_for(url)
    for attempt in range(retries + 1):
        if pacer is not None:
            await pacer.acquire()
        try:
            response = await client.get(url, params=params, headers={"Accept": "application/xml,text/xml,*/*"})
        except httpx.HTTPError as exc:
            if attempt < retries:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            raise UpstreamError(f"Could not reach {httpx.URL(url).host}.") from exc
        if response.status_code in {429, 500, 502, 503, 504} and attempt < retries:
            delay = _retry_after(response, pacer)
            if delay is None:
                raise UpstreamError(f"{httpx.URL(url).host} asked us to wait; try again shortly.")
            await asyncio.sleep(max(delay, 0.6 * (attempt + 1)))
            continue
        if response.status_code >= 400:
            raise UpstreamError(f"{httpx.URL(url).host} returned HTTP {response.status_code}.")
        return response.text
    raise UpstreamError(f"{httpx.URL(url).host} is unavailable.")
