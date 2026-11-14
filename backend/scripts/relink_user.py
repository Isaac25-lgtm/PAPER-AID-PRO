"""Re-link a PaperAid account to a new Firebase identity (operator action, after verifying the person).

The API never moves an account between Firebase identities on its own: a different Firebase UID presenting an
email that already has an account gets 409 ACCOUNT_CONFLICT. When the legitimate owner really did get a new
Firebase identity (e.g. their Firebase account was deleted and re-created), an operator verifies them out of band
and runs:
    python scripts/relink_user.py someone@example.com <new-firebase-uid> [--yes]

The new UID must belong to a Firebase account with this email and a VERIFIED email address.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.db.models import AuditEvent, User
from app.db.session import dispose_engine, get_sessionmaker


async def run(email: str, new_uid: str, confirmed: bool, *, firebase_email: str, firebase_verified: bool) -> int:
    email = email.lower().strip()
    if firebase_email.lower().strip() != email or not firebase_verified:
        print("Refusing: the new Firebase account must have this exact email, verified.")
        return 2
    async with get_sessionmaker()() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            print(f"No user with email {email}")
            return 1
        clash = (await db.execute(select(User.id).where(User.firebase_uid == new_uid))).first()
        if clash:
            print("Refusing: that Firebase UID is already linked to another account.")
            return 2
        print(f"User {user.id}: {user.firebase_uid} -> {new_uid}")
        if not confirmed:
            print("Dry run. Re-run with --yes to apply.")
            return 0
        db.add(
            AuditEvent(
                actor_id=None,
                action="user.identity_relinked",
                target_type="user",
                target_id=str(user.id),
                details={"old_uid": user.firebase_uid, "new_uid": new_uid},
            )
        )
        user.firebase_uid = new_uid
        await db.commit()
    print("Re-linked.")
    return 0


async def _lookup(uid: str) -> tuple[str, bool]:
    import google.auth
    import google.auth.transport.requests
    import httpx

    from app.config import get_settings

    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    await asyncio.to_thread(credentials.refresh, google.auth.transport.requests.Request())
    project = get_settings().firebase_project_id
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"https://identitytoolkit.googleapis.com/v1/projects/{project}/accounts:lookup",
            json={"localId": [uid]},
            headers={"Authorization": f"Bearer {credentials.token}"},
        )
    response.raise_for_status()
    users = response.json().get("users") or []
    if not users:
        return "", False
    return users[0].get("email", ""), bool(users[0].get("emailVerified"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email")
    parser.add_argument("new_uid")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    async def _main() -> int:
        try:
            firebase_email, verified = await _lookup(args.new_uid)
            return await run(
                args.email, args.new_uid, args.yes, firebase_email=firebase_email, firebase_verified=verified
            )
        finally:
            await dispose_engine()

    raise SystemExit(asyncio.run(_main()))


if __name__ == "__main__":
    main()
