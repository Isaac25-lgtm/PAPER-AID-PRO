"""follow-up audit fixes: closed accounts, consent records, preferences, metadata provenance, job fencing,
message turns, deletion back-off; repair rows created under earlier policies

Revision ID: c7e2d9a41f05
Revises: a1c4e9f2b7d3
Create Date: 2026-11-14 12:00:00

Expand-only schema changes plus data repairs:
- active jobs created before leases existed get a lease, so recovery can expire them;
- links to private papers that a user does not own (possible under the former admin policy) are removed, and
  stored AI answers that cited such papers are redacted;
- public records written from user files under the former import policy are marked "unverified", so the next
  registry import replaces their metadata;
- existing messages get turn numbers in their stored order.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c7e2d9a41f05"
down_revision: str | None = "a1c4e9f2b7d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOT_OWNER = "p.visibility = 'private' AND (p.owner_id IS NULL OR p.owner_id <> {owner})"


def upgrade() -> None:
    # ---------------------------------------------------------------------------------------- schema
    op.add_column("users", sa.Column("accepted_policy_version", sa.String(length=20), nullable=True))
    op.add_column(
        "users",
        sa.Column("preferences", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
    )
    op.add_column(
        "papers",
        sa.Column("metadata_source", sa.String(length=20), server_default=sa.text("'registry'"), nullable=False),
    )
    op.add_column(
        "papers",
        sa.Column("csl_extra", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
    )
    op.add_column("processing_jobs", sa.Column("attempt_token", sa.UUID(), nullable=True))
    op.add_column(
        "storage_deletions",
        sa.Column("not_before", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.add_column("messages", sa.Column("turn_index", sa.Integer(), server_default=sa.text("0"), nullable=False))
    op.create_table(
        "closed_accounts",
        sa.Column("firebase_uid", sa.String(length=128), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("firebase_uid", name=op.f("pk_closed_accounts")),
    )
    op.create_table(
        "consent_records",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("firebase_uid", sa.String(length=128), nullable=False),
        sa.Column("document", sa.String(length=40), nullable=False),
        sa.Column("version", sa.String(length=20), nullable=False),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.Column("country", sa.String(length=8), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_consent_records_user_id_users"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_consent_records")),
    )
    op.create_index("ix_consent_records_user", "consent_records", ["user_id", "document", "created_at"])

    # ----------------------------------------------------------------------------------- data repairs
    # Jobs that predate leases: give them a lease from when they last made progress, so they become reclaimable.
    op.execute(
        """
        UPDATE processing_jobs
           SET lease_expires_at = CASE WHEN status = 'running'
                                       THEN coalesce(started_at, created_at) + interval '16 minutes'
                                       ELSE created_at + interval '30 minutes' END
         WHERE status IN ('queued', 'running') AND lease_expires_at IS NULL
        """
    )
    # Private papers reachable by someone other than their owner (possible under the former admin policy).
    op.execute(
        f"DELETE FROM library_items li USING papers p WHERE li.paper_id = p.id AND {_NOT_OWNER.format(owner='li.user_id')}"
    )
    op.execute(
        "DELETE FROM collection_papers cp USING collections c, papers p "
        f"WHERE cp.collection_id = c.id AND cp.paper_id = p.id AND {_NOT_OWNER.format(owner='c.user_id')}"
    )
    op.execute(
        "DELETE FROM document_sources ds USING documents d, papers p "
        f"WHERE ds.document_id = d.id AND ds.paper_id = p.id AND {_NOT_OWNER.format(owner='d.user_id')}"
    )
    op.execute(
        "DELETE FROM document_citations dc USING documents d, papers p "
        f"WHERE dc.document_id = d.id AND dc.paper_id = p.id AND {_NOT_OWNER.format(owner='d.user_id')}"
    )
    # Stored answers that drew on another person's private paper: redact the answer and its excerpts.
    op.execute(
        f"""
        UPDATE messages m
           SET content = '[Removed: this answer used a private paper that is not yours.]',
               citations = '[]'::jsonb
          FROM conversations cv
         WHERE m.conversation_id = cv.id
           AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(m.citations) AS c
                  JOIN papers p ON p.id::text = c ->> 'paper_id'
                 WHERE {_NOT_OWNER.format(owner="cv.user_id")})
        """
    )
    op.execute(
        f"""
        UPDATE conversations cv
           SET paper_ids = coalesce((SELECT array_agg(pid) FROM unnest(cv.paper_ids) AS pid
                                      WHERE NOT EXISTS (SELECT 1 FROM papers p WHERE p.id = pid
                                                          AND {_NOT_OWNER.format(owner="cv.user_id")})),
                                    '{{}}')
        """
    )
    # Provenance of existing records.
    op.execute("UPDATE papers SET metadata_source = 'user' WHERE visibility = 'private'")
    op.execute(
        "UPDATE papers SET metadata_source = 'unverified' WHERE visibility = 'public' AND source = 'import_file'"
    )
    # Turn numbers for existing messages, in stored order (two per exchange). A question and its answer were
    # written in one transaction (same timestamp); the role enum sorts 'user' before 'assistant'.
    op.execute(
        """
        UPDATE messages m SET turn_index = ordered.turn
          FROM (SELECT id, (row_number() OVER (PARTITION BY conversation_id ORDER BY created_at, role, id) - 1) / 2
                           AS turn
                  FROM messages) AS ordered
         WHERE m.id = ordered.id
        """
    )


def downgrade() -> None:
    op.drop_index("ix_consent_records_user", table_name="consent_records")
    op.drop_table("consent_records")
    op.drop_table("closed_accounts")
    op.drop_column("messages", "turn_index")
    op.drop_column("storage_deletions", "not_before")
    op.drop_column("processing_jobs", "attempt_token")
    op.drop_column("papers", "csl_extra")
    op.drop_column("papers", "metadata_source")
    op.drop_column("users", "preferences")
    op.drop_column("users", "accepted_policy_version")
