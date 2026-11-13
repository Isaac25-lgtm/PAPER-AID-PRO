"""Local development launcher.

Starts an embedded PostgreSQL 16 + pgvector (pgserver, no Docker) unless DATABASE_URL is already set, applies
migrations, then serves the API with auto-reload disabled (stable on Windows). Usage:

    python scripts/dev.py            # http://127.0.0.1:8000/api/v1/docs
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)


def ensure_database() -> None:
    if os.environ.get("DATABASE_URL"):
        return
    import pgserver
    import psycopg

    server = pgserver.get_server(str(ROOT / ".pgdata"), cleanup_mode=None)
    base = server.get_uri().rsplit("/", 1)[0]
    with psycopg.connect(f"{base}/postgres", autocommit=True) as conn:
        if not conn.execute("select 1 from pg_database where datname = 'paperaid'").fetchone():
            conn.execute('create database "paperaid"')
    os.environ["DATABASE_URL"] = f"{base}/paperaid"
    print(f"Embedded PostgreSQL ready at {base}/paperaid")


def main() -> None:
    os.environ.setdefault("ENV", "development")
    ensure_database()
    from alembic import command
    from alembic.config import Config

    command.upgrade(Config(str(ROOT / "alembic.ini")), "head")
    if sys.platform == "win32":  # psycopg's async driver needs a selector event loop on Windows
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("PORT", "8000")), loop="none")


if __name__ == "__main__":
    main()
