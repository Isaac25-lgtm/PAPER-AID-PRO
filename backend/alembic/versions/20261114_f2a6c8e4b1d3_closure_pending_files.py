"""closure requests remember the stored files still to delete

Revision ID: f2a6c8e4b1d3
Revises: e5f3a8c1d927
Create Date: 2026-11-14 18:00:00

Expand-only: closed_accounts.pending_keys. A closure is complete only when its stored files are gone; until then
maintenance keeps retrying exactly those files.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f2a6c8e4b1d3"
down_revision: str | None = "e5f3a8c1d927"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "closed_accounts",
        sa.Column("pending_keys", postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("closed_accounts", "pending_keys")
