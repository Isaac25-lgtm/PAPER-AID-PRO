"""Firebase Authentication account administration (Identity Toolkit REST API, service-account credentials)."""

from __future__ import annotations

import asyncio
import logging
import os

import google.auth
import google.auth.transport.requests
import httpx

from app.config import get_settings
from app.errors import UpstreamError

_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]
log = logging.getLogger(__name__)


async def _token() -> str:
    credentials, _ = google.auth.default(scopes=_SCOPES)
    await asyncio.to_thread(credentials.refresh, google.auth.transport.requests.Request())
    return str(credentials.token)


async def delete_firebase_account(uid: str) -> bool:
    """Delete the Firebase identity (this also revokes its refresh tokens, ending every session).
    Returns False if the account was already gone, or if deletion is not allowed here. Idempotent.

    Fails closed outside production: only a production deployment administers real sign-in identities. Local and
    test environments use the Firebase Auth emulator when FIREBASE_AUTH_EMULATOR_HOST is set, and otherwise skip
    the identity step entirely, so testing account deletion on a laptop can never delete a real person's sign-in
    (even if the developer's own credentials could)."""
    settings = get_settings()
    project = settings.firebase_project_id
    emulator = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST", "").strip()
    if emulator:
        url = f"http://{emulator}/identitytoolkit.googleapis.com/v1/projects/{project}/accounts:delete"
        headers = {"Authorization": "Bearer owner"}  # the emulator's admin token
    elif settings.is_production:
        url = f"https://identitytoolkit.googleapis.com/v1/projects/{project}/accounts:delete"
        headers = {"Authorization": f"Bearer {await _token()}"}
    else:
        log.warning("identity.deletion_skipped_outside_production", extra={"env": settings.env})
        return False
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(url, json={"localId": uid}, headers=headers)
    if response.status_code == 200:
        return True
    if response.status_code == 400 and "USER_NOT_FOUND" in response.text:
        return False
    raise UpstreamError(f"Could not delete the Firebase account (HTTP {response.status_code}).")
