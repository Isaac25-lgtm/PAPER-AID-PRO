"""Authentication: Firebase ID tokens verified server-side; roles are authoritative in our database.

The browser signs in with Firebase Authentication and sends `Authorization: Bearer <ID token>`. We verify the
token signature, audience and issuer with google-auth (Google's public certs, cached), then upsert the user.
Role checks always read the database row, never a token claim, so demotion takes effect immediately.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Protocol

import google.auth.transport.requests
import requests
from fastapi import Depends, Request
from google.oauth2 import id_token as google_id_token
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import User, UserRole
from app.db.session import get_db
from app.errors import EmailNotVerified, Forbidden, Unauthenticated

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class TokenClaims:
    uid: str
    email: str
    email_verified: bool
    name: str | None = None
    picture: str | None = None


class TokenVerifier(Protocol):
    def __call__(self, token: str) -> TokenClaims: ...


class FirebaseTokenVerifier:
    """Verifies Firebase Authentication ID tokens. Public keys are cached via the shared requests session."""

    def __init__(self, project_id: str) -> None:
        self._project_id = project_id
        self._session = requests.Session()
        self._request = google.auth.transport.requests.Request(session=self._session)

    def __call__(self, token: str) -> TokenClaims:
        try:
            claims: dict[str, Any] = google_id_token.verify_firebase_token(
                token, self._request, audience=self._project_id, clock_skew_in_seconds=10
            )
        except Exception as exc:  # google-auth raises ValueError / TransportError subclasses
            raise Unauthenticated("Your session is invalid or has expired. Please sign in again.") from exc
        expected_issuer = f"https://securetoken.google.com/{self._project_id}"
        if claims.get("iss") != expected_issuer or not claims.get("sub"):
            raise Unauthenticated("Token was not issued for this application.")
        email = (claims.get("email") or "").strip().lower()
        if not email:
            raise Unauthenticated("An email address is required to use PaperAid Pro.")
        return TokenClaims(
            uid=str(claims["sub"]),
            email=email,
            email_verified=bool(claims.get("email_verified")),
            name=claims.get("name"),
            picture=claims.get("picture"),
        )


_verifier: TokenVerifier | None = None


def get_token_verifier() -> TokenVerifier:
    global _verifier
    if _verifier is None:
        _verifier = FirebaseTokenVerifier(get_settings().firebase_project_id)
    return _verifier


def set_token_verifier(verifier: TokenVerifier | None) -> None:
    """Test hook. Refuses to run in production."""
    if get_settings().is_production:
        raise RuntimeError("Token verifier overrides are not allowed in production.")
    global _verifier
    _verifier = verifier


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() == "bearer" and token.strip():
        return token.strip()
    return None


async def _upsert_user(db: AsyncSession, claims: TokenClaims) -> User:
    settings = get_settings()
    user = (await db.execute(select(User).where(User.firebase_uid == claims.uid))).scalar_one_or_none()
    now = datetime.now(UTC)
    if user is None:
        # An account created with the same email under a different provider keeps its row.
        user = (await db.execute(select(User).where(User.email == claims.email))).scalar_one_or_none()
        if user is not None:
            user.firebase_uid = claims.uid
    if user is None:
        user = User(
            firebase_uid=claims.uid,
            email=claims.email,
            name=claims.name,
            avatar_url=claims.picture,
            email_verified=claims.email_verified,
            role=UserRole.ADMIN
            if claims.email in settings.admin_email_set and claims.email_verified
            else UserRole.USER,
            last_seen_at=now,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        log.info("user.created", extra={"user_id": str(user.id)})
        return user

    changed = False
    if user.email != claims.email:
        user.email, changed = claims.email, True
    if user.email_verified != claims.email_verified:
        user.email_verified, changed = claims.email_verified, True
    if claims.picture and user.avatar_url != claims.picture:
        user.avatar_url, changed = claims.picture, True
    if claims.email in settings.admin_email_set and claims.email_verified and user.role != UserRole.ADMIN:
        user.role, changed = UserRole.ADMIN, True
    if user.last_seen_at is None or now - user.last_seen_at > timedelta(minutes=10):
        user.last_seen_at, changed = now, True
    if changed:
        await db.commit()
    return user


async def get_optional_user(request: Request, db: Annotated[AsyncSession, Depends(get_db)]) -> User | None:
    token = _bearer_token(request)
    if token is None:
        return None
    verifier = get_token_verifier()
    claims = await asyncio.to_thread(verifier, token)
    user = await _upsert_user(db, claims)
    if not user.is_active:
        raise Forbidden("This account has been deactivated.")
    request.state.user_id = str(user.id)
    return user


async def get_current_user(user: Annotated[User | None, Depends(get_optional_user)]) -> User:
    if user is None:
        raise Unauthenticated("Sign in to continue.")
    return user


async def get_verified_user(user: Annotated[User, Depends(get_current_user)]) -> User:
    if get_settings().require_email_verified and not user.email_verified:
        raise EmailNotVerified("Verify your email address to use this feature.")
    return user


def require_role(role: UserRole) -> Callable[..., Any]:
    async def dependency(user: Annotated[User, Depends(get_verified_user)]) -> User:
        if user.role != role:
            raise Forbidden("You do not have permission to do that.")
        return user

    return dependency


CurrentUser = Annotated[User, Depends(get_current_user)]
VerifiedUser = Annotated[User, Depends(get_verified_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
AdminUser = Annotated[User, Depends(require_role(UserRole.ADMIN))]
