"""Housekeeping: durable storage cleanup, expired rate-limit buckets and abandoned processing jobs.

Storage objects are tracked in `storage_deletions`:
- `record_upload_intent(key)` is committed BEFORE an object is written. The transaction that later stores the
  object's key on its paper also removes the intent (`confirm_upload`). If anything fails in between - the write,
  a lost response, the database commit - the intent survives and maintenance deletes the object after a grace
  period. Nothing is ever orphaned silently.
- `schedule_deletion(db, key)` runs in the same transaction that drops the owning row.

Processing never holds a database transaction across storage calls: due rows are claimed with a short update
(their `not_before` moves forward, which also acts as a lease), then each is deleted or backed off on its own.

`run_maintenance()` is idempotent. A Cloud Scheduler job calls it every 15 minutes (POST /internal/maintenance);
it also runs shortly after each instance starts and on demand from the admin API.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import StorageDeletion
from app.db.session import get_sessionmaker
from app.security.rate_limit import purge_expired_buckets
from app.services.storage import get_storage

log = logging.getLogger(__name__)

UPLOAD_GRACE = timedelta(hours=1)  # an in-progress upload is never cleaned up before this
CLAIM_LEASE = timedelta(minutes=10)
MAX_BACKOFF = timedelta(days=1)


def _now() -> datetime:
    return datetime.now(UTC)


async def record_upload_intent(key: str) -> None:
    """Committed (in its own session) before an object is written; removed by `confirm_upload`."""
    async with get_sessionmaker()() as db:
        await db.execute(
            insert(StorageDeletion)
            .values(key=key, not_before=_now() + UPLOAD_GRACE)
            .on_conflict_do_update(index_elements=["key"], set_={"not_before": _now() + UPLOAD_GRACE})
        )
        await db.commit()


async def confirm_upload(db: AsyncSession, key: str) -> None:
    """Call in the transaction that stores `key` on its owning row: the object is now owned, not orphaned."""
    await db.execute(delete(StorageDeletion).where(StorageDeletion.key == key))


async def schedule_deletion(db: AsyncSession, *keys: str | None) -> None:
    """Record objects to delete. Call inside the transaction that drops (or abandons) their owning row."""
    for key in {k for k in keys if k}:
        await db.execute(
            insert(StorageDeletion)
            .values(key=key, not_before=_now())
            .on_conflict_do_update(index_elements=["key"], set_={"not_before": _now()})
        )


async def _claim(db: AsyncSession, keys: list[str] | None, limit: int) -> list[str]:
    due = select(StorageDeletion.key).where(StorageDeletion.not_before <= _now())
    if keys is not None:
        due = due.where(StorageDeletion.key.in_(keys))
    due = due.order_by(StorageDeletion.not_before).limit(limit).with_for_update(skip_locked=True)
    claimed = list(
        (
            await db.execute(
                update(StorageDeletion)
                .where(StorageDeletion.key.in_(due.scalar_subquery()))
                .values(not_before=_now() + CLAIM_LEASE)
                .returning(StorageDeletion.key)
            )
        ).scalars()
    )
    await db.commit()
    return claimed


async def process_deletions(db: AsyncSession, limit: int = 100, *, keys: list[str] | None = None) -> int:
    """Delete due objects (or exactly `keys`). Failures back off exponentially instead of blocking others."""
    claimed = await _claim(db, keys, limit)
    storage = get_storage()
    done = 0
    for key in claimed:
        try:
            await storage.delete(key)  # idempotent: deleting a missing object succeeds
        except Exception as exc:
            row = await db.get(StorageDeletion, key)
            if row is not None:
                row.attempts += 1
                row.last_error = repr(exc)[:500]
                row.not_before = _now() + min(timedelta(minutes=2**row.attempts), MAX_BACKOFF)
            await db.commit()
            continue
        await db.execute(delete(StorageDeletion).where(StorageDeletion.key == key))
        await db.commit()
        done += 1
    return done


async def delete_now_or_later(db: AsyncSession, *keys: str | None) -> None:
    """After a commit that recorded `keys` via schedule_deletion: try to delete exactly those objects now."""
    wanted = [k for k in keys if k]
    if not wanted:
        return
    try:
        await process_deletions(db, limit=len(wanted), keys=wanted)
    except Exception:  # the records persist; maintenance retries them
        await db.rollback()
        log.warning("storage.deferred_delete", exc_info=True)


@dataclass
class MaintenanceReport:
    storage_objects_deleted: int = 0
    rate_buckets_purged: int = 0
    jobs_reclaimed: int = 0


async def run_maintenance() -> MaintenanceReport:
    from app.services.processing import reclaim_abandoned_jobs  # local import: processing imports this module

    report = MaintenanceReport()
    async with get_sessionmaker()() as db:
        report.storage_objects_deleted = await process_deletions(db, limit=500)
        report.rate_buckets_purged = await purge_expired_buckets(db)
        report.jobs_reclaimed = await reclaim_abandoned_jobs(db)
    log.info("maintenance.completed", extra=asdict(report))
    return report
