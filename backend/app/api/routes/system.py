"""Health checks, current-user profile and AI status."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import APIRouter
from sqlalchemy import text

from app.api.deps import DB, AppSettings
from app.errors import AppError
from app.schemas import AIStatus, UserOut, UserUpdate
from app.security.auth import CurrentUser
from app.services.ai.providers import ANTHROPIC_DEFAULT_MODEL

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
    current = (await db.execute(text("select version_num from alembic_version"))).scalar_one_or_none()
    expected = expected_schema_revision()
    if current != expected:
        raise SchemaNotReady(
            "The database schema does not match this release.", details={"database": current, "expected": expected}
        )
    return {"status": "ready", "schema": current}


@router.get("/me", response_model=UserOut, tags=["account"])
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut, tags=["account"])
async def update_me(body: UserUpdate, user: CurrentUser, db: DB) -> UserOut:
    user.name = body.name.strip()
    await db.commit()
    return UserOut.model_validate(user)


@router.get("/ai/status", response_model=AIStatus, tags=["ai"])
async def ai_status(settings: AppSettings) -> AIStatus:
    model = settings.ai_model or (ANTHROPIC_DEFAULT_MODEL if settings.ai_provider == "anthropic" else None)
    return AIStatus(
        enabled=settings.ai_enabled,
        provider=settings.ai_provider,
        model=model if settings.ai_enabled else None,
        embeddings_enabled=settings.embeddings_enabled,
    )
