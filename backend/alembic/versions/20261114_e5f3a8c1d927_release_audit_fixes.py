"""release audit fixes: durable account-closure requests, index for live-object checks

Revision ID: e5f3a8c1d927
Revises: c7e2d9a41f05
Create Date: 2026-11-14 15:00:00

Expand-only:
- closed_accounts becomes a durable closure request (user id, options, completion, attempts, back-off), so
  maintenance can finish a closure that failed part-way. Existing tombstones whose user row still exists are left
  open for maintenance to finish; the rest are marked complete.
- papers.storage_path is indexed: maintenance never deletes an object that a paper currently points to.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e5f3a8c1d927"
down_revision: str | None = "c7e2d9a41f05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("closed_accounts", sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column(
        "closed_accounts", sa.Column("purge_public", sa.Boolean(), server_default=sa.text("false"), nullable=False)
    )
    op.add_column(
        "closed_accounts", sa.Column("delete_identity", sa.Boolean(), server_default=sa.text("true"), nullable=False)
    )
    op.add_column("closed_accounts", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("closed_accounts", sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False))
    op.add_column("closed_accounts", sa.Column("last_error", sa.Text(), nullable=True))
    op.add_column("closed_accounts", sa.Column("not_before", sa.DateTime(timezone=True), nullable=True))
    # A tombstone whose user still exists is an unfinished closure: hand it to maintenance.
    op.execute(
        "UPDATE closed_accounts c SET user_id = u.id, not_before = now() FROM users u WHERE u.firebase_uid = c.firebase_uid"
    )
    op.execute("UPDATE closed_accounts SET completed_at = closed_at WHERE user_id IS NULL")
    op.create_index("ix_papers_storage_path", "papers", ["storage_path"])


def downgrade() -> None:
    op.drop_index("ix_papers_storage_path", table_name="papers")
    for column in (
        "not_before",
        "last_error",
        "attempts",
        "completed_at",
        "delete_identity",
        "purge_public",
        "user_id",
    ):
        op.drop_column("closed_accounts", column)
