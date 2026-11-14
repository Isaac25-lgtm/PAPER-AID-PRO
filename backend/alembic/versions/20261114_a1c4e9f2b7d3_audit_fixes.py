"""audit fixes: job leases + one active job per paper, message evidence status, durable storage deletions

Revision ID: a1c4e9f2b7d3
Revises: 76823bdc585a
Create Date: 2026-11-14 09:00:00

Expand-only: every change is additive, so the previous application revision keeps working while this runs.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a1c4e9f2b7d3"
down_revision: str | None = "76823bdc585a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("processing_jobs", sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True))
    # Before enforcing "one active job per paper", close any duplicates (keep the newest active job).
    op.execute(
        """
        UPDATE processing_jobs AS j
           SET status = 'failed', error = 'Superseded by a newer job.', finished_at = now()
         WHERE j.status IN ('queued', 'running')
           AND EXISTS (
                SELECT 1 FROM processing_jobs AS newer
                 WHERE newer.paper_id = j.paper_id
                   AND newer.status IN ('queued', 'running')
                   AND (newer.created_at, newer.id) > (j.created_at, j.id))
        """
    )
    op.create_index(
        "uq_processing_jobs_active_paper",
        "processing_jobs",
        ["paper_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )
    op.add_column(
        "messages",
        sa.Column("insufficient_evidence", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column("messages", sa.Column("gaps", sa.Text(), server_default=sa.text("''"), nullable=False))
    op.create_table(
        "storage_deletions",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_storage_deletions")),
    )


def downgrade() -> None:
    op.drop_table("storage_deletions")
    op.drop_column("messages", "gaps")
    op.drop_column("messages", "insufficient_evidence")
    op.drop_index("uq_processing_jobs_active_paper", table_name="processing_jobs")
    op.drop_column("processing_jobs", "lease_expires_at")
