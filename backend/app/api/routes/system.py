"""Health checks, current-user profile and AI status."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import APIRouter, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import Select, func, select, text
from sqlalchemy.exc import ProgrammingError

from app.api.deps import DB, AppSettings
from app.api.downloads import content_disposition
from app.config import get_settings
from app.db.models import Collection, Conversation, Document, LibraryItem, Paper, PaperStatus, User
from app.errors import AppError, ValidationFailed
from app.policy import OPTIONAL_CONSENTS, POLICY_VERSION, REQUIRED_CONSENTS
from app.schemas import (
    AIStatus,
    ConsentIn,
    DeleteAccountIn,
    MeOut,
    PreferencesIn,
    ProgressOut,
    UserOut,
    UserUpdate,
)
from app.security.auth import CurrentUser, VerifiedUser
from app.services.accounts import close_account, export_account, record_consents
from app.services.ai.providers import ANTHROPIC_DEFAULT_MODEL
from app.services.papers import visible_papers_clause

router = APIRouter()


@router.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    """Liveness: the process is up."""
    return {"status": "ok"}


class SchemaNotReady(AppError):
    status_code = 503
    code = "SCHEMA_NOT_READY"


@lru_cache(maxsize=1)
def expected_schema_revision() -> str:
    root = Path(__file__).resolve().parents[3]  # backend/
    config = Config()
    config.set_main_option("script_location", str(root / "alembic"))
    head = ScriptDirectory.from_config(config).get_current_head()
    if head is None:
        raise RuntimeError("No Alembic head revision found")
    return head


@router.get("/ready", tags=["system"])
async def ready(db: DB) -> dict[str, str]:
    """Readiness: the database is reachable AND migrated to the revision this code expects.
    Use it as the release gate before routing traffic to a new revision."""
    try:
        current = (await db.execute(text("select version_num from alembic_version"))).scalar_one_or_none()
    except ProgrammingError:  # no alembic_version table: the database was never migrated
        await db.rollback()
        current = None
    expected = expected_schema_revision()
    if current != expected:
        raise SchemaNotReady(
            "The database schema does not match this release.", details={"database": current, "expected": expected}
        )
    return {"status": "ready", "schema": current}


def _me(user: User) -> MeOut:
    settings = get_settings()
    needs = settings.require_policy_acceptance and user.accepted_policy_version != POLICY_VERSION
    return MeOut(
        **UserOut.model_validate(user).model_dump(),
        accepted_policy_version=user.accepted_policy_version,
        policy_version=POLICY_VERSION,
        needs_consent=needs,
        preferences=user.preferences or {},
    )


@router.get("/me", response_model=MeOut, tags=["account"])
async def me(user: CurrentUser) -> MeOut:
    return _me(user)


@router.patch("/me", response_model=MeOut, tags=["account"])
async def update_me(body: UserUpdate, user: CurrentUser, db: DB) -> MeOut:
    user.name = body.name.strip()
    await db.commit()
    return _me(user)


@router.get("/me/progress", response_model=ProgressOut, tags=["account"])
async def my_progress(user: VerifiedUser, db: DB) -> ProgressOut:
    """Exact counts behind the getting-started checklist (one cheap request instead of several lists)."""

    async def count(stmt: Select[tuple[int]]) -> int:
        return int((await db.execute(stmt)).scalar_one())

    visible = (
        select(LibraryItem.id)
        .join(Paper, Paper.id == LibraryItem.paper_id)
        .where(LibraryItem.user_id == user.id, visible_papers_clause(user))
    )
    return ProgressOut(
        library=await count(select(func.count()).select_from(visible.subquery())),
        full_text=await count(
            select(func.count()).select_from(visible.where(Paper.status == PaperStatus.READY).subquery())
        ),
        collections=await count(select(func.count()).select_from(Collection).where(Collection.user_id == user.id)),
        documents=await count(select(func.count()).select_from(Document).where(Document.user_id == user.id)),
        conversations=await count(
            select(func.count()).select_from(Conversation).where(Conversation.user_id == user.id)
        ),
    )


@router.post("/me/consent", response_model=MeOut, tags=["account"])
async def give_consent(body: ConsentIn, user: CurrentUser, db: DB) -> MeOut:
    """Accept the current Terms, Privacy Notice and AI notice and confirm age (all required); optional choices
    are recorded separately. Every decision is stored in consent_records with the policy version and time."""
    choices = body.model_dump()
    missing = [name for name in REQUIRED_CONSENTS if not choices[name]]
    if missing:
        raise ValidationFailed("All required items must be accepted to use PaperAid Pro.", details={"missing": missing})
    await record_consents(db, user, {name: bool(choices[name]) for name in (*REQUIRED_CONSENTS, *OPTIONAL_CONSENTS)})
    user.accepted_policy_version = POLICY_VERSION
    user.preferences = {**(user.preferences or {}), **{f"consent_{n}": bool(choices[n]) for n in OPTIONAL_CONSENTS}}
    await db.commit()
    return _me(user)


@router.patch("/me/preferences", response_model=MeOut, tags=["account"])
async def update_preferences(body: PreferencesIn, user: CurrentUser, db: DB) -> MeOut:
    merged = dict(user.preferences or {})
    for key, value in body.values.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[str(key)[:100]] = value
    if len(json.dumps(merged)) > 20_000:
        raise ValidationFailed("Too many preferences stored.")
    user.preferences = merged
    await db.commit()
    return _me(user)


@router.post("/me/optional-consents", response_model=MeOut, tags=["account"])
async def update_optional_consents(body: dict[str, bool], user: CurrentUser, db: DB) -> MeOut:
    """Grant or withdraw optional consents (product emails, analytics) at any time."""
    unknown = set(body) - set(OPTIONAL_CONSENTS)
    if unknown:
        raise ValidationFailed("Unknown consent.", details={"unknown": sorted(unknown)})
    await record_consents(db, user, {k: bool(v) for k, v in body.items()})
    user.preferences = {**(user.preferences or {}), **{f"consent_{k}": bool(v) for k, v in body.items()}}
    await db.commit()
    return _me(user)


@router.get("/me/export", tags=["account"])
async def export_my_data(user: VerifiedUser, db: DB) -> StreamingResponse:
    """Download everything you created (documents, library, research conversations, uploads, consents) as ZIP."""
    archive = await export_account(db, user)
    archive.seek(0, 2)
    size = archive.tell()
    archive.seek(0)

    async def chunks():  # type: ignore[no-untyped-def]
        try:
            while block := archive.read(64 * 1024):
                yield block
        finally:
            archive.close()

    return StreamingResponse(
        chunks(),
        media_type="application/zip",
        headers={
            "Content-Disposition": content_disposition("paperaid-my-data.zip"),
            "Content-Length": str(size),
        },
    )


@router.delete("/me", status_code=204, tags=["account"])
async def delete_me(body: DeleteAccountIn, user: CurrentUser, db: DB) -> Response:
    """Close your account: your sign-in, documents, library, conversations and uploads are deleted.
    Confirm by typing your email address. This cannot be undone."""
    if body.confirm_email.strip().lower() != user.email.lower():
        raise ValidationFailed("Type your account email address exactly to confirm.")
    await close_account(db, user)
    return Response(status_code=204)


@router.get("/ai/status", response_model=AIStatus, tags=["ai"])
async def ai_status(settings: AppSettings) -> AIStatus:
    model = settings.ai_model or (ANTHROPIC_DEFAULT_MODEL if settings.ai_provider == "anthropic" else None)
    return AIStatus(
        enabled=settings.ai_enabled,
        provider=settings.ai_provider,
        model=model if settings.ai_enabled else None,
        embeddings_enabled=settings.embeddings_enabled,
    )
