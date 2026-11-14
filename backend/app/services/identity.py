"""Firebase Authentication account administration (Identity Toolkit REST API, service-account credentials)."""

from __future__ import annotations

import asyncio

import google.auth
import google.auth.transport.requests
import httpx

from app.config import get_settings
from app.errors import UpstreamError

_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]


async def _token() -> str:
    credentials, _ = google.auth.default(scopes=_SCOPES)
    await asyncio.to_thread(credentials.refresh, google.auth.transport.requests.Request())
    return str(credentials.token)


async def delete_firebase_account(uid: str) -> bool:
    """Delete the Firebase identity (this also revokes its refresh tokens, ending every session).
    Returns False if the account was already gone. Idempotent."""
    project = get_settings().firebase_project_id
    url = f"https://identitytoolkit.googleapis.com/v1/projects/{project}/accounts:delete"
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(url, json={"localId": uid}, headers={"Authorization": f"Bearer {await _token()}"})
    if response.status_code == 200:
        return True
    if response.status_code == 400 and "USER_NOT_FOUND" in response.text:
        return False
    raise UpstreamError(f"Could not delete the Firebase account (HTTP {response.status_code}).")
