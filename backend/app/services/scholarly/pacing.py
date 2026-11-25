"""Shared pacing for the scholarly services whose allowance belongs to PaperAid as a whole, not to one user.

PaperAid's own rate limits count each person's searches; they say nothing about how fast all searches together call
NCBI (ESpell, PubMed: 3 requests/second without an API key, 10 with one) or OpenAlex (one key's budget). Without a
shared pace, several people searching at once can exhaust that allowance or trigger a burst of HTTP 429s while each
stays within their own limit (audit SF06).

Each service has a token bucket shared by every request in this server process:

- a required request (the search itself) waits for a token, at most `max_wait` seconds, then fails as "busy";
- an optional request (spelling help) waits at most `optional_wait` (well inside the search's spelling budget) and
  is otherwise skipped, so when the allowance is genuinely spent the searches go first;
- a `Retry-After` from the service blocks the bucket until then. Requests in that window fail or skip at once rather
  than holding a connection open while they sleep.

The pace is per server instance. Cloud Run runs at most a few instances (see DEPLOYMENT.md), so the configured
rates are kept below each service's documented allowance. A pace shared across instances would need a shared store.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

import httpx

from app.config import get_settings
from app.errors import UpstreamError

Clock = Callable[[], float]
Sleep = Callable[[float], Awaitable[None]]


class ServiceBusy(UpstreamError):
    """No request slot for this service right now (its shared pace is exhausted, or it asked us to wait)."""


@dataclass
class Pacer:
    name: str
    rate: float  # tokens per second
    burst: int  # tokens available at once
    max_wait: float  # longest a required request may wait for its turn
    optional_wait: float = 0.0  # longest an optional request may wait before it is skipped
    clock: Clock = time.monotonic
    sleep: Sleep = asyncio.sleep
    _tokens: float = field(init=False)
    _updated: float = field(init=False)
    _blocked_until: float = field(init=False, default=0.0)

    def __post_init__(self) -> None:
        self._tokens = float(self.burst)
        self._updated = self.clock()

    def _refill(self, now: float) -> None:
        self._tokens = min(float(self.burst), self._tokens + (now - self._updated) * self.rate)
        self._updated = now

    async def acquire(self, *, optional: bool = False) -> bool:
        """Take a request slot. Returns False only for an optional request that should be skipped; a required
        request either gets its slot (perhaps after a short wait) or raises ServiceBusy."""
        now = self.clock()
        if now < self._blocked_until:
            if optional:
                return False
            raise ServiceBusy(f"{self.name} asked us to wait; try again shortly.")
        self._refill(now)
        self._tokens -= 1  # reserve a slot; a negative balance is the queue in front of us
        if self._tokens >= 0:
            return True
        wait = -self._tokens / self.rate
        if wait > (self.optional_wait if optional else self.max_wait):
            self._tokens += 1  # give the reservation back
            if optional:
                return False
            raise ServiceBusy(f"{self.name} is busy; try again shortly.")
        await self.sleep(wait)
        return True

    def back_off(self, seconds: float) -> None:
        """The service said Retry-After: nobody in this process calls it again before then."""
        self._blocked_until = max(self._blocked_until, self.clock() + max(0.0, seconds))


_pacers: dict[str, Pacer] = {}


def pacer_for(url: str) -> Pacer | None:
    """The shared pacer for this URL's service, or None for services that are not paced here."""
    host = httpx.URL(url).host
    if host == "eutils.ncbi.nlm.nih.gov":
        key = "ncbi"
        rate = 9.0 if get_settings().ncbi_api_key else 3.0  # NCBI allows 10/s with a key, 3/s without
    elif host == "api.openalex.org":
        key, rate = "openalex", 8.0  # OpenAlex allows 10 requests/second per key
    else:
        return None
    pacer = _pacers.get(key)
    if pacer is None or pacer.rate != rate:
        # The burst is one second's allowance: a search's spelling check (one whole-query ESpell call and up to
        # three single-word rechecks) fits without waiting when nobody else is searching.
        pacer = _pacers[key] = Pacer(name=host, rate=rate, burst=max(1, int(rate)), max_wait=2.0, optional_wait=0.8)
    return pacer


def reset_pacers() -> None:
    """Forget all pacing state (tests)."""
    _pacers.clear()
