"""Close an account: delete the user, all of their data AND their Firebase sign-in identity.

Removes: the Firebase Authentication account (which also ends every signed-in session, so the profile cannot be
re-created by an open tab), the user row and everything owned by it (library, collections, documents + revisions
+ citations, conversations, private uploads) and their stored PDFs. With --purge-created-public, public papers
that this user imported and that no other user has saved are removed too.

Stored PDFs are recorded in `storage_deletions` in the SAME transaction as the row deletes, so a storage failure
is retried by maintenance instead of leaving an orphaned file. Every step is idempotent: re-running the script
after a partial failure completes the job.

Run on Cloud Run as a one-off job (see docs/DEPLOYMENT.md), or locally with DATABASE_URL set:
    python scripts/delete_user.py someone@example.com [--purge-created-public] [--keep-firebase] [--yes]
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete, exists, select

from app.db.models import LibraryItem, Paper, PaperVisibility, User
from app.db.session import dispose_engine, get_sessionmaker
from app.services.identity import delete_firebase_account
from app.services.maintenance import process_deletions, schedule_deletion


async def run(email: str, purge_public: bool, confirmed: bool, *, delete_identity: bool = True) -> int:
    async with get_sessionmaker()() as db:
        user = (await db.execute(select(User).where(User.email == email.lower().strip()))).scalar_one_or_none()
        if user is None:
            print(f"No user with email {email}")
            return 1
        private = list((await db.execute(select(Paper).where(Paper.owner_id == user.id))).scalars())
        public: list[Paper] = []
        if purge_public:
            others_saved = exists().where(LibraryItem.paper_id == Paper.id, LibraryItem.user_id != user.id)
            public = list(
                (
                    await db.execute(
                        select(Paper).where(
                            Paper.created_by_id == user.id, Paper.visibility == PaperVisibility.PUBLIC, ~others_saved
                        )
                    )
                ).scalars()
            )
        print(f"User {user.id} ({user.email}): {len(private)} private uploads, {len(public)} public papers to purge")
        if not confirmed:
            print("Dry run. Re-run with --yes to delete.")
            return 0
        # 1. Identity first: once it is gone no token can re-create the profile while we delete data.
        if delete_identity:
            existed = await delete_firebase_account(user.firebase_uid)
            print("Firebase account deleted." if existed else "Firebase account was already deleted.")
        # 2. Data + durable storage-deletion records in one transaction.
        paths = [p.storage_path for p in [*private, *public] if p.storage_path]
        await schedule_deletion(db, *paths)
        if public:
            await db.execute(delete(Paper).where(Paper.id.in_([p.id for p in public])))
        await db.execute(delete(User).where(User.id == user.id))  # cascades to owned rows
        await db.commit()
        # 3. Objects (anything that fails stays recorded and is retried by maintenance).
        removed = await process_deletions(db, limit=max(len(paths), 1) + 100)
    print(f"Deleted user and {len(private) + len(public)} papers; {removed} stored PDFs removed now.")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email")
    parser.add_argument("--purge-created-public", action="store_true")
    parser.add_argument("--keep-firebase", action="store_true", help="leave the Firebase sign-in account in place")
    parser.add_argument("--yes", action="store_true", help="actually delete (default is a dry run)")
    args = parser.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    async def _main() -> int:
        try:
            return await run(args.email, args.purge_created_public, args.yes, delete_identity=not args.keep_firebase)
        finally:
            await dispose_engine()

    raise SystemExit(asyncio.run(_main()))


if __name__ == "__main__":
    main()
