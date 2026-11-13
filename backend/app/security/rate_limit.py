"""Fixed-window rate limiting stored in Postgres, so limits hold across all Cloud Run instances."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import RateLimitBucket
from app.errors import RateLimited

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
