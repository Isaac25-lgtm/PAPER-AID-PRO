"""Close an account: delete the user, all of their data AND their Firebase sign-in identity.

Removes: the Firebase Authentication account (which also ends every signed-in session, so the profile cannot be
re-created by an open tab), the user row and everything owned by it (library, collections, documents + revisions
+ citations, conversations, private uploads) and their stored PDFs. With --purge-created-public, public papers
that this user imported and that no other user has saved are removed too.

The work is done by app.services.accounts.close_account (the same code as self-service "Delete my account"):
the identity is tombstoned and deactivated first, so even a still-valid sign-in token is refused from then on.
Every step is idempotent: re-running the script after a partial failure completes the job.

Run on Cloud Run as a one-off job (see docs/DEPLOYMENT.md), or locally with DATABASE_URL set:
    python scripts/delete_user.py someone@example.com [--purge-created-public] [--keep-firebase] [--yes]
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import exists, select

from app.db.models import LibraryItem, Paper, PaperVisibility, User
from app.db.session import dispose_engine, get_sessionmaker
from app.services.accounts import close_account


async def run(email: str, purge_public: bool, confirmed: bool, *, delete_identity: bool = True) -> int:
    async with get_sessionmaker()() as db:
        user = (await db.execute(select(User).where(User.email == email.lower().strip()))).scalar_one_or_none()
        if user is None:
            print(f"No user with email {email}")
            return 1
        private = (await db.execute(select(Paper.id).where(Paper.owner_id == user.id))).scalars().all()
        public_count = 0
        if purge_public:
            others_saved = exists().where(LibraryItem.paper_id == Paper.id, LibraryItem.user_id != user.id)
            public_count = len(
                (
                    await db.execute(
                        select(Paper.id).where(
                            Paper.created_by_id == user.id, Paper.visibility == PaperVisibility.PUBLIC, ~others_saved
                        )
                    )
                )
                .scalars()
                .all()
            )
        print(f"User {user.id} ({user.email}): {len(private)} private uploads, {public_count} public papers to purge")
        if not confirmed:
            print("Dry run. Re-run with --yes to delete.")
            return 0
        result = await close_account(db, user, purge_public=purge_public, delete_identity=delete_identity)
    print(
        f"Closed account: Firebase identity {'deleted' if result.identity_deleted else 'already gone/kept'}, "
        f"{result.papers_deleted} papers and {result.files_deleted} stored PDFs removed now."
    )
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
