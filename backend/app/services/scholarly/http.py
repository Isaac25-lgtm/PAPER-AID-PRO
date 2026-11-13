"""Shared async HTTP client for scholarly APIs with polite identification and bounded retries."""

from __future__ import annotations

import asyncio
import random
from typing import Any

import httpx

from app.config import get_settings
from app.errors import UpstreamError

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


async def get_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    retries: int = 2,
    not_found_ok: bool = False,
) -> Any:
    client = get_http_client()
    for attempt in range(retries + 1):
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
            retry_after = response.headers.get("retry-after")
            delay = float(retry_after) if retry_after and retry_after.isdigit() else 0.6 * (attempt + 1)
            await asyncio.sleep(min(delay, 3.0) + random.random() * 0.2)
            continue
        if response.status_code >= 400:
            raise UpstreamError(f"{httpx.URL(url).host} returned HTTP {response.status_code}.")
        return response.json()
    raise UpstreamError(f"{httpx.URL(url).host} is unavailable.")


async def get_text(url: str, *, params: dict[str, Any] | None = None, retries: int = 2) -> str:
    client = get_http_client()
    for attempt in range(retries + 1):
        try:
            response = await client.get(url, params=params, headers={"Accept": "application/xml,text/xml,*/*"})
        except httpx.HTTPError as exc:
            if attempt < retries:
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            raise UpstreamError(f"Could not reach {httpx.URL(url).host}.") from exc
        if response.status_code in {429, 500, 502, 503, 504} and attempt < retries:
            await asyncio.sleep(0.6 * (attempt + 1))
            continue
        if response.status_code >= 400:
            raise UpstreamError(f"{httpx.URL(url).host} returned HTTP {response.status_code}.")
        return response.text
    raise UpstreamError(f"{httpx.URL(url).host} is unavailable.")
