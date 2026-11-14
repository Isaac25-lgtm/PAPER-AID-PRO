"""Fixed-window rate limiting stored in Postgres, so limits hold across all Cloud Run instances."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import Request
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import RateLimitBucket
from app.errors import RateLimited

if TYPE_CHECKING:
    from app.db.models import User

_UPSERT = text(
    """
    INSERT INTO rate_limit_buckets (key, window_start, count) VALUES (:key, :window_start, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_buckets.count + 1
    RETURNING count
    """
)


async def enforce_rate_limit(
    db: AsyncSession, *, key: str, limit: int, window_seconds: int, action: str = "this action"
) -> None:
    now = datetime.now(UTC)
    epoch = int(now.timestamp())
    window_start_epoch = epoch - (epoch % window_seconds)
    window_start = datetime.fromtimestamp(window_start_epoch, UTC)
    count = (await db.execute(_UPSERT, {"key": key, "window_start": window_start})).scalar_one()
    await db.commit()
    if count > limit:
        retry_after = max(1, window_start_epoch + window_seconds - epoch)
        raise RateLimited(
            f"Too many requests for {action}. Please wait {retry_after} seconds and try again.",
            retry_after=retry_after,
        )


async def purge_expired_buckets(db: AsyncSession, older_than_seconds: int = 7200) -> int:
    cutoff = datetime.fromtimestamp(datetime.now(UTC).timestamp() - older_than_seconds, UTC)
    result = await db.execute(delete(RateLimitBucket).where(RateLimitBucket.window_start < cutoff))
    await db.commit()
    return int(getattr(result, "rowcount", 0) or 0)


def client_address(request: Request) -> str:
    """Caller address. Behind Cloud Run only the LAST X-Forwarded-For hop is added by Google (clients can
    prepend anything), so that is the only entry trusted."""
    if get_settings().trusts_forwarded_for:
        hops = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",") if h.strip()]
        if hops:
            return hops[-1]
    return request.client.host if request.client else "unknown"


async def enforce_caller_limit(
    db: AsyncSession,
    request: Request,
    user: User | None,
    *,
    name: str,
    user_limit: int,
    anon_limit: int,
    window_seconds: int,
    action: str,
    anon_global_multiplier: int = 20,
) -> None:
    """Signed-in users get their own bucket. Anonymous callers get a per-address bucket (so one caller cannot
    exhaust everyone's allowance) plus a global anonymous ceiling that bounds total upstream load."""
    if user is not None:
        await enforce_rate_limit(
            db, key=f"{name}:user:{user.id}", limit=user_limit, window_seconds=window_seconds, action=action
        )
        return
    address = hashlib.sha256(client_address(request).encode()).hexdigest()[:24]  # no raw IPs stored
    await enforce_rate_limit(
        db, key=f"{name}:ip:{address}", limit=anon_limit, window_seconds=window_seconds, action=action
    )
    await enforce_rate_limit(
        db, key=f"{name}:anon", limit=anon_limit * anon_global_multiplier, window_seconds=window_seconds, action=action
    )
