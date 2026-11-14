"""Housekeeping: durable storage cleanup, expired rate-limit buckets and abandoned processing jobs.

`run_maintenance()` is idempotent and cheap. It runs in the background shortly after each instance starts
(Cloud Run starts instances regularly) and on demand from the admin API.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import StorageDeletion
from app.db.session import get_sessionmaker
from app.security.rate_limit import purge_expired_buckets
from app.services.storage import get_storage

log = logging.getLogger(__name__)


async def schedule_deletion(db: AsyncSession, *keys: str | None) -> None:
    """Record objects to delete. Call inside the transaction that drops (or abandons) their owning row."""
    for key in {k for k in keys if k}:
        await db.execute(insert(StorageDeletion).values(key=key).on_conflict_do_nothing(index_elements=["key"]))


async def process_deletions(db: AsyncSession, limit: int = 100) -> int:
    """Delete recorded objects from storage; failures stay queued with their error for the next run."""
    rows = list(
        (
            await db.execute(
                select(StorageDeletion)
                .order_by(StorageDeletion.created_at)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        ).scalars()
    )
    done = 0
    storage = get_storage()
    for row in rows:
        try:
            await storage.delete(row.key)  # idempotent: deleting a missing object succeeds
        except Exception as exc:  # keep the record; the next run retries
            row.attempts += 1
            row.last_error = repr(exc)[:500]
            continue
        await db.delete(row)
        done += 1
    await db.commit()
    return done


async def delete_now_or_later(db: AsyncSession, *keys: str | None) -> None:
    """After a commit that recorded `keys` via schedule_deletion: try to delete them immediately."""
    if not any(keys):
        return
    try:
        await process_deletions(db, limit=len(keys))
    except Exception:  # the records persist; maintenance retries them
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
