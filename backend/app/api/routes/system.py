"""Health checks, current-user profile and AI status."""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from app.api.deps import DB, AppSettings
from app.schemas import AIStatus, UserOut, UserUpdate
from app.security.auth import CurrentUser
from app.services.ai.providers import ANTHROPIC_DEFAULT_MODEL

router = APIRouter()


@router.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    """Liveness: the process is up."""
    return {"status": "ok"}


@router.get("/ready", tags=["system"])
async def ready(db: DB) -> dict[str, str]:
    """Readiness: the database is reachable."""
    await db.execute(text("select 1"))
    return {"status": "ready"}


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
