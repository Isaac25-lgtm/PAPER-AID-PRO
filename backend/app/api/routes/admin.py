"""Administration: platform stats, users, processing jobs and paper moderation. Every change is audited."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Header, Query, Response
from sqlalchemy import func, select

from app.api.deps import DB, AppSettings
from app.db.models import (
    AuditEvent,
    Document,
    JobStatus,
    Paper,
    PaperStatus,
    PaperVisibility,
    ProcessingJob,
    User,
    UserRole,
)
from app.errors import NotFound, ValidationFailed
from app.schemas import AdminUserOut, AdminUserUpdate, JobOut, StatsOut
from app.security.auth import AdminUser
from app.services import processing
from app.services.storage import get_storage
from app.services.tasks import verify_task_request

router = APIRouter(prefix="/admin", tags=["admin"])
internal = APIRouter(prefix="/internal", include_in_schema=False)


async def _audit(db: DB, actor: User, action: str, target_type: str, target_id: str, **details: object) -> None:
    db.add(AuditEvent(actor_id=actor.id, action=action, target_type=target_type, target_id=target_id, details=details))


@router.get("/stats", response_model=StatsOut)
async def stats(db: DB, admin: AdminUser, settings: AppSettings) -> StatsOut:
    async def count(stmt: object) -> int:
        return int((await db.execute(stmt)).scalar_one())  # type: ignore[arg-type]

    since = datetime.now(UTC) - timedelta(hours=24)
    return StatsOut(
        users=await count(select(func.count()).select_from(User)),
        papers_public=await count(
            select(func.count()).select_from(Paper).where(Paper.visibility == PaperVisibility.PUBLIC)
        ),
        papers_private=await count(
            select(func.count()).select_from(Paper).where(Paper.visibility == PaperVisibility.PRIVATE)
        ),
        papers_with_full_text=await count(
            select(func.count()).select_from(Paper).where(Paper.status == PaperStatus.READY)
        ),
        documents=await count(select(func.count()).select_from(Document)),
        jobs_failed_24h=await count(
            select(func.count())
            .select_from(ProcessingJob)
            .where(ProcessingJob.status == JobStatus.FAILED, ProcessingJob.created_at >= since)
        ),
        jobs_queued=await count(
            select(func.count())
            .select_from(ProcessingJob)
            .where(ProcessingJob.status.in_([JobStatus.QUEUED, JobStatus.RUNNING]))
        ),
        ai_enabled=settings.ai_enabled,
    )


@router.get("/users", response_model=list[AdminUserOut])
async def users(
    db: DB,
    admin: AdminUser,
    q: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[AdminUserOut]:
    stmt = select(User).order_by(User.created_at.desc()).limit(limit)
    if q:
        stmt = stmt.where(User.email.ilike(f"%{q.strip()}%") | User.name.ilike(f"%{q.strip()}%"))
    return [AdminUserOut.model_validate(u) for u in (await db.execute(stmt)).scalars()]


@router.patch("/users/{user_id}", response_model=AdminUserOut)
async def update_user(user_id: uuid.UUID, body: AdminUserUpdate, db: DB, admin: AdminUser) -> AdminUserOut:
    target = await db.get(User, user_id)
    if target is None:
        raise NotFound("User not found.")
    if target.id == admin.id and (body.role == "user" or body.is_active is False):
        raise ValidationFailed("You cannot demote or deactivate your own account.")
    if body.role is not None and target.role.value != body.role:
        await _audit(db, admin, "user.role_changed", "user", str(target.id), old=target.role.value, new=body.role)
        target.role = UserRole(body.role)
    if body.is_active is not None and target.is_active != body.is_active:
        await _audit(db, admin, "user.active_changed", "user", str(target.id), active=body.is_active)
        target.is_active = body.is_active
    await db.commit()
    return AdminUserOut.model_validate(target)


@router.get("/jobs", response_model=list[JobOut])
async def jobs(
    db: DB,
    admin: AdminUser,
    status: Annotated[str | None, Query(pattern="^(queued|running|succeeded|failed)$")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[JobOut]:
    stmt = select(ProcessingJob).order_by(ProcessingJob.created_at.desc()).limit(limit)
    if status:
        stmt = stmt.where(ProcessingJob.status == JobStatus(status))
    return [JobOut.model_validate(j) for j in (await db.execute(stmt)).scalars()]


@router.post("/jobs/{job_id}/retry", response_model=JobOut, status_code=202)
async def retry_job(job_id: uuid.UUID, db: DB, admin: AdminUser) -> JobOut:
    job = await db.get(ProcessingJob, job_id)
    if job is None:
        raise NotFound("Job not found.")
    paper = await db.get(Paper, job.paper_id)
    if paper is None:
        raise NotFound("Paper not found.")
    await _audit(db, admin, "job.retried", "job", str(job.id))
    new_job = await processing.queue_ingest(db, paper, admin)
    return JobOut.model_validate(await db.get(ProcessingJob, new_job.id))


@router.delete("/papers/{paper_id}", status_code=204)
async def delete_paper(paper_id: uuid.UUID, db: DB, admin: AdminUser) -> Response:
    paper = await db.get(Paper, paper_id)
    if paper is None:
        raise NotFound("Paper not found.")
    storage_path = paper.storage_path
    await _audit(db, admin, "paper.deleted", "paper", str(paper.id), title=paper.title[:200])
    await db.delete(paper)
    await db.commit()
    if storage_path:
        await get_storage().delete(storage_path)
    return Response(status_code=204)


@internal.post("/tasks/run-job", status_code=204)
async def run_job(body: dict[str, str], authorization: Annotated[str | None, Header()] = None) -> Response:
    """Cloud Tasks delivery endpoint (OIDC-authenticated; not part of the public API)."""
    verify_task_request(authorization)
    try:
        job_id = uuid.UUID(body.get("job_id", ""))
    except ValueError as exc:
        raise ValidationFailed("Invalid job id.") from exc
    await processing.run_job(job_id)
    return Response(status_code=204)
