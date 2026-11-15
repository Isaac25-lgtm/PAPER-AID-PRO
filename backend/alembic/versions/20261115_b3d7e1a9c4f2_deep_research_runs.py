"""deep research reports

Revision ID: b3d7e1a9c4f2
Revises: f2a6c8e4b1d3
Create Date: 2026-11-15 12:00:00

Expand-only: a new table. Running code never reads it, so the migration can precede the release safely.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b3d7e1a9c4f2"
down_revision: str | None = "f2a6c8e4b1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "deep_research_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("options", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("queries", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("sources", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("services", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("report", sa.Text(), nullable=True),
        sa.Column("citations", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("insufficient_evidence", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("gaps", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column("report_status", sa.String(40), nullable=False, server_default=sa.text("'complete'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_deep_research_runs_user_created", "deep_research_runs", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_deep_research_runs_user_created", table_name="deep_research_runs")
    op.drop_table("deep_research_runs")
