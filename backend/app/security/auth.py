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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.models import AuditEvent, ClosedAccount, User, UserRole
from app.db.session import get_db
from app.errors import (
    AccountConflict,
    ConsentRequired,
    EmailNotVerified,
    Forbidden,
    NotInvited,
    Unauthenticated,
)
from app.policy import POLICY_VERSION

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


async def _role_was_set_by_admin(db: AsyncSession, user: User) -> bool:
    return (
        await db.execute(
            select(AuditEvent.id)
            .where(
                AuditEvent.action == "user.role_changed",
                AuditEvent.target_type == "user",
                AuditEvent.target_id == str(user.id),
            )
            .limit(1)
        )
    ).first() is not None


async def _upsert_user(db: AsyncSession, claims: TokenClaims) -> User:
    """The Firebase UID is the durable account key. An email is never used to take over an existing account."""
    settings = get_settings()
    user = (await db.execute(select(User).where(User.firebase_uid == claims.uid))).scalar_one_or_none()
    now = datetime.now(UTC)
    if user is None:
        if await db.get(ClosedAccount, claims.uid) is not None:
            # A closed account's ID token can stay cryptographically valid for up to an hour; never let it
            # re-create a profile (or re-bootstrap an admin) after closure.
            raise Unauthenticated("This account has been closed.")
        holder = (await db.execute(select(User).where(User.email == claims.email))).scalar_one_or_none()
        if holder is not None:
            # A different Firebase identity with this email (e.g. a deleted and re-created Firebase account).
            # Linking must be an explicit, verified operator action (scripts/relink_user.py), never implicit.
            log.warning("auth.identity_conflict", extra={"user_id": str(holder.id)})
            raise AccountConflict(
                "This email is already linked to a different sign-in. Sign in the way you originally did, "
                "or ask the administrator to re-link your account."
            )
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
        try:
            await db.commit()
        except IntegrityError as exc:  # concurrent first requests for the same identity
            await db.rollback()
            user = (await db.execute(select(User).where(User.firebase_uid == claims.uid))).scalar_one_or_none()
            if user is None:
                raise AccountConflict("This email is already linked to a different sign-in.") from exc
            return user
        await db.refresh(user)
        log.info("user.created", extra={"user_id": str(user.id)})
        return user

    changed = False
    if user.email != claims.email:
        taken = (await db.execute(select(User.id).where(User.email == claims.email, User.id != user.id))).first()
        if taken:
            raise AccountConflict("Your new email address is already used by another account.")
        user.email, changed = claims.email, True
    if user.email_verified != claims.email_verified:
        user.email_verified, changed = claims.email_verified, True
    if claims.picture and user.avatar_url != claims.picture:
        user.avatar_url, changed = claims.picture, True
    # ADMIN_EMAILS bootstraps the role; once an admin has changed this user's role, that decision stands.
    if (
        claims.email in settings.admin_email_set
        and claims.email_verified
        and user.role != UserRole.ADMIN
        and not await _role_was_set_by_admin(db, user)
    ):
        user.role, changed = UserRole.ADMIN, True
    if user.last_seen_at is None or now - user.last_seen_at > timedelta(minutes=10):
        user.last_seen_at, changed = now, True
    if changed:
        await db.commit()
    return user


async def get_token_user(request: Request, db: Annotated[AsyncSession, Depends(get_db)]) -> User | None:
    """The signed-in identity, if any (no access policy applied yet)."""
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


def _is_invited(user: User) -> bool:
    return user.role == UserRole.ADMIN or get_settings().is_email_allowed(user.email)


def _is_verified(user: User) -> bool:
    return user.email_verified or not get_settings().require_email_verified


async def get_optional_user(user: Annotated[User | None, Depends(get_token_user)]) -> User | None:
    """Principal for public endpoints. Only an invited, verified account widens what is visible (its own
    private papers); anyone else is served exactly as an anonymous visitor."""
    if user is None or not _is_invited(user) or not _is_verified(user) or not _has_current_consent(user):
        return None
    return user


def _has_current_consent(user: User) -> bool:
    return not get_settings().require_policy_acceptance or user.accepted_policy_version == POLICY_VERSION


async def get_account_user(user: Annotated[User | None, Depends(get_token_user)]) -> User:
    """Principal for data-rights requests (download my data, delete my account): any active signed-in account,
    including one that has not accepted updated notices or is no longer on the tester list."""
    if user is None:
        raise Unauthenticated("Sign in to continue.")
    return user


async def get_current_user(user: Annotated[User | None, Depends(get_token_user)]) -> User:
    if user is None:
        raise Unauthenticated("Sign in to continue.")
    if not _is_invited(user):
        raise NotInvited("PaperAid Pro is in a private test. Your email is not on the tester list yet.")
    return user


async def get_verified_user(user: Annotated[User, Depends(get_current_user)]) -> User:
    if not _is_verified(user):
        raise EmailNotVerified("Verify your email address to use this feature.")
    if not _has_current_consent(user):
        raise ConsentRequired("Please review and accept the Terms of Service and Privacy Notice to continue.")
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
AccountUser = Annotated[User, Depends(get_account_user)]
AdminUser = Annotated[User, Depends(require_role(UserRole.ADMIN))]
