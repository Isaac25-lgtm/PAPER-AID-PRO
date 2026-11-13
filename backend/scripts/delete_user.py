"""Delete a user and all of their data (account-deletion requests, test cleanup).

Removes: the user row and everything owned by it (library, collections, documents + revisions + citations,
conversations, private uploads and their stored PDFs). With --purge-created-public, public papers that this user
imported and that no other user has saved are removed too (with their stored PDFs).

Run on Cloud Run as a one-off job (see docs/DEPLOYMENT.md), or locally with DATABASE_URL set:
    python scripts/delete_user.py someone@example.com [--purge-created-public] [--yes]
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
from app.services.storage import get_storage


async def run(email: str, purge_public: bool, confirmed: bool) -> int:
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
        paths = [p.storage_path for p in [*private, *public] if p.storage_path]
        if public:
            await db.execute(delete(Paper).where(Paper.id.in_([p.id for p in public])))
        await db.execute(delete(User).where(User.id == user.id))  # cascades to owned rows
        await db.commit()
    storage = get_storage()
    for path in paths:
        await storage.delete(path)
    print(f"Deleted user, {len(private) + len(public)} papers and {len(paths)} stored PDFs.")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email")
    parser.add_argument("--purge-created-public", action="store_true")
    parser.add_argument("--yes", action="store_true", help="actually delete (default is a dry run)")
    args = parser.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    async def _main() -> int:
        try:
            return await run(args.email, args.purge_created_public, args.yes)
        finally:
            await dispose_engine()

    raise SystemExit(asyncio.run(_main()))


if __name__ == "__main__":
    main()
