"""Database schema (SQLAlchemy 2.0 declarative). Alembic migrations are generated from these models."""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    Computed,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

EMBEDDING_DIMENSIONS = 1536

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {dict[str, Any]: JSONB, list[str]: ARRAY(Text)}


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def _created() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def _updated() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


def _enum(enum_cls: type[enum.Enum], name: str) -> Enum:
    return Enum(enum_cls, name=name, values_callable=lambda e: [m.value for m in e])


# --------------------------------------------------------------------------------------------------- enums
class UserRole(enum.StrEnum):
    USER = "user"
    ADMIN = "admin"


class PaperVisibility(enum.StrEnum):
    PUBLIC = "public"  # scholarly metadata imported from public sources
    PRIVATE = "private"  # user upload; visible to its owner (and admins) only


class PaperSource(enum.StrEnum):
    DISCOVERY = "discovery"
    UPLOAD = "upload"
    IMPORT_FILE = "import_file"
    MANUAL = "manual"


class PaperStatus(enum.StrEnum):
    METADATA_ONLY = "metadata_only"  # no full text
    QUEUED = "queued"
    PROCESSING = "processing"
    READY = "ready"  # full text extracted + chunked
    FAILED = "failed"


class JobKind(enum.StrEnum):
    INGEST_PDF = "ingest_pdf"
    EMBED_CHUNKS = "embed_chunks"


class JobStatus(enum.StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class DocumentType(enum.StrEnum):
    DRAFT = "draft"
    MANUSCRIPT = "manuscript"
    PROPOSAL = "proposal"
    LITERATURE_REVIEW = "literature_review"
    THESIS = "thesis"
    REPORT = "report"


class MessageRole(enum.StrEnum):
    USER = "user"
    ASSISTANT = "assistant"


# -------------------------------------------------------------------------------------------------- users
class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _uuid_pk()
    firebase_uid: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(200))
    avatar_url: Mapped[str | None] = mapped_column(String(1000))
    role: Mapped[UserRole] = mapped_column(_enum(UserRole, "user_role"), default=UserRole.USER, nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Version of the Terms/Privacy notice this account last accepted (None = must accept before using the app).
    accepted_policy_version: Mapped[str | None] = mapped_column(String(20))
    # Per-account settings that follow the person across devices (guide state, default style, field, ...).
    preferences: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False
    )
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


# ------------------------------------------------------------------------------------------------- papers
class Paper(Base):
    __tablename__ = "papers"

    id: Mapped[uuid.UUID] = _uuid_pk()
    title: Mapped[str] = mapped_column(Text, nullable=False)
    abstract: Mapped[str | None] = mapped_column(Text)
    publication_date: Mapped[date | None] = mapped_column(Date)
    year: Mapped[int | None] = mapped_column(Integer)
    journal: Mapped[str | None] = mapped_column(Text)
    publisher: Mapped[str | None] = mapped_column(Text)
    volume: Mapped[str | None] = mapped_column(String(50))
    issue: Mapped[str | None] = mapped_column(String(50))
    pages: Mapped[str | None] = mapped_column(String(50))
    work_type: Mapped[str] = mapped_column(String(50), default="article-journal", nullable=False)
    url: Mapped[str | None] = mapped_column(Text)

    doi: Mapped[str | None] = mapped_column(String(255))
    pmid: Mapped[str | None] = mapped_column(String(32))
    pmcid: Mapped[str | None] = mapped_column(String(32))
    arxiv_id: Mapped[str | None] = mapped_column(String(64))
    s2_id: Mapped[str | None] = mapped_column(String(64))
    openalex_id: Mapped[str | None] = mapped_column(String(64))

    is_open_access: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    oa_pdf_url: Mapped[str | None] = mapped_column(Text)
    oa_license: Mapped[str | None] = mapped_column(String(100))
    citation_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    keywords: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list, nullable=False)

    visibility: Mapped[PaperVisibility] = mapped_column(
        _enum(PaperVisibility, "paper_visibility"), default=PaperVisibility.PUBLIC, nullable=False
    )
    source: Mapped[PaperSource] = mapped_column(
        _enum(PaperSource, "paper_source"), default=PaperSource.DISCOVERY, nullable=False
    )
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    status: Mapped[PaperStatus] = mapped_column(
        _enum(PaperStatus, "paper_status"), default=PaperStatus.METADATA_ONLY, nullable=False
    )
    status_detail: Mapped[str | None] = mapped_column(Text)
    storage_path: Mapped[str | None] = mapped_column(Text, index=True)
    file_sha256: Mapped[str | None] = mapped_column(String(64))
    file_size: Mapped[int | None] = mapped_column(BigInteger)
    page_count: Mapped[int | None] = mapped_column(Integer)
    # Where the bibliographic fields came from: "registry" (Crossref/PubMed/...), "user" (typed or uploaded by
    # its private owner) or "unverified" (public record written from a user file under the old import policy).
    metadata_source: Mapped[str] = mapped_column(
        String(20), default="registry", server_default=text("'registry'"), nullable=False
    )
    # Extra CSL fields for manually entered sources (edition, place, ISBN, court, accessed date, editors, ...).
    csl_extra: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False
    )

    search_vector: Mapped[Any] = mapped_column(
        TSVECTOR,
        Computed(
            "setweight(to_tsvector('english', coalesce(title, '')), 'A') || "
            "setweight(to_tsvector('english', coalesce(journal, '')), 'C') || "
            "setweight(to_tsvector('english', coalesce(abstract, '')), 'B')",
            persisted=True,
        ),
    )
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()

    authors: Mapped[list[PaperAuthor]] = relationship(
        back_populates="paper", cascade="all, delete-orphan", order_by="PaperAuthor.position"
    )

    __table_args__ = (
        # Public identifiers are unique among public papers; private uploads may duplicate them.
        Index("uq_papers_public_doi", "doi", unique=True, postgresql_where=text("visibility = 'public'")),
        Index("uq_papers_public_pmid", "pmid", unique=True, postgresql_where=text("visibility = 'public'")),
        Index("uq_papers_public_arxiv", "arxiv_id", unique=True, postgresql_where=text("visibility = 'public'")),
        Index("ix_papers_search_vector", "search_vector", postgresql_using="gin"),
        Index("ix_papers_owner", "owner_id"),
        Index("ix_papers_status", "status"),
        Index("ix_papers_year", "year"),
    )


class Author(Base):
    __tablename__ = "authors"

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    family: Mapped[str | None] = mapped_column(String(200))
    given: Mapped[str | None] = mapped_column(String(200))
    orcid: Mapped[str | None] = mapped_column(String(19), unique=True)
    created_at: Mapped[datetime] = _created()

    __table_args__ = (Index("ix_authors_name_lower", func.lower(name)),)


class PaperAuthor(Base):
    __tablename__ = "paper_authors"

    paper_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), primary_key=True)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("authors.id", ondelete="CASCADE"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    paper: Mapped[Paper] = relationship(back_populates="authors")
    author: Mapped[Author] = relationship(lazy="joined")


class PaperChunk(Base):
    __tablename__ = "paper_chunks"

    id: Mapped[uuid.UUID] = _uuid_pk()
    paper_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    section: Mapped[str | None] = mapped_column(String(200))
    page_start: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    token_estimate: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    embedding: Mapped[Any | None] = mapped_column(Vector(EMBEDDING_DIMENSIONS))
    embedding_model: Mapped[str | None] = mapped_column(String(100))
    text_search: Mapped[Any] = mapped_column(TSVECTOR, Computed("to_tsvector('english', text)", persisted=True))
    created_at: Mapped[datetime] = _created()

    __table_args__ = (
        UniqueConstraint("paper_id", "chunk_index"),
        Index("ix_paper_chunks_paper", "paper_id"),
        Index("ix_paper_chunks_text_search", "text_search", postgresql_using="gin"),
        Index(
            "ix_paper_chunks_embedding",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )


class PaperSummary(Base):
    """AI-generated summary, stored separately from source metadata and always labelled as AI output."""

    __tablename__ = "paper_summaries"

    id: Mapped[uuid.UUID] = _uuid_pk()
    paper_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("papers.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    content: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = _created()


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    id: Mapped[uuid.UUID] = _uuid_pk()
    paper_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[JobKind] = mapped_column(_enum(JobKind, "job_kind"), nullable=False)
    status: Mapped[JobStatus] = mapped_column(_enum(JobStatus, "job_status"), default=JobStatus.QUEUED)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # A running job holds a lease; a worker that dies stops renewing it and the job becomes reclaimable.
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Fencing token for the current attempt: a worker may only publish results while it still holds it.
    attempt_token: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created()

    __table_args__ = (
        Index("ix_processing_jobs_paper", "paper_id"),
        Index("ix_processing_jobs_status", "status"),
        # At most one active (queued/running) job per paper, enforced atomically by the database.
        Index(
            "uq_processing_jobs_active_paper",
            "paper_id",
            unique=True,
            postgresql_where=text("status IN ('queued', 'running')"),
        ),
    )


# ------------------------------------------------------------------------------------------------ library
class LibraryItem(Base):
    __tablename__ = "library_items"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    paper_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(50)), default=list, nullable=False)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()

    paper: Mapped[Paper] = relationship()

    __table_args__ = (UniqueConstraint("user_id", "paper_id"), Index("ix_library_items_user", "user_id"))


class Collection(Base):
    __tablename__ = "collections"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()

    __table_args__ = (UniqueConstraint("user_id", "name"),)


class CollectionPaper(Base):
    __tablename__ = "collection_papers"

    collection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True)
    paper_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), primary_key=True)
    added_at: Mapped[datetime] = _created()


# ---------------------------------------------------------------------------------------------- documents
class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(300), default="Untitled document", nullable=False)
    doc_type: Mapped[DocumentType] = mapped_column(
        _enum(DocumentType, "document_type"), default=DocumentType.DRAFT, nullable=False
    )
    content: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    text_content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    csl_style: Mapped[str] = mapped_column(String(64), default="apa", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()

    __table_args__ = (Index("ix_documents_user_updated", "user_id", "updated_at"),)


class DocumentSource(Base):
    __tablename__ = "document_sources"

    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True)
    paper_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), primary_key=True)
    added_at: Mapped[datetime] = _created()


class DocumentCitation(Base):
    """One in-text citation. The editor content references it by id (citation node attrs.citationId)."""

    __tablename__ = "document_citations"

    id: Mapped[uuid.UUID] = _uuid_pk()
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    paper_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("papers.id", ondelete="CASCADE"), nullable=False)
    chunk_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("paper_chunks.id", ondelete="SET NULL"))
    locator: Mapped[str | None] = mapped_column(String(50))  # e.g. page "12" or "12-14"
    label: Mapped[str] = mapped_column(String(20), default="page", nullable=False)
    prefix: Mapped[str | None] = mapped_column(String(200))
    suffix: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = _created()

    __table_args__ = (Index("ix_document_citations_document", "document_id"),)


class DocumentRevision(Base):
    __tablename__ = "document_revisions"

    id: Mapped[uuid.UUID] = _uuid_pk()
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    content: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    csl_style: Mapped[str] = mapped_column(String(64), nullable=False)
    reason: Mapped[str] = mapped_column(String(40), default="autosave", nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _created()

    __table_args__ = (UniqueConstraint("document_id", "version"),)


# ------------------------------------------------------------------------------------------ conversations
class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    paper_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), default=list, nullable=False)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()

    __table_args__ = (Index("ix_conversations_user_updated", "user_id", "updated_at"),)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = _uuid_pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[MessageRole] = mapped_column(_enum(MessageRole, "message_role"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    citations: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)
    model: Mapped[str | None] = mapped_column(String(100))
    insufficient_evidence: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    gaps: Mapped[str] = mapped_column(Text, default="", server_default=text("''"), nullable=False)
    # Question and answer of one exchange share a turn; ordering never depends on equal timestamps.
    turn_index: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    created_at: Mapped[datetime] = _created()

    __table_args__ = (Index("ix_messages_conversation", "conversation_id", "created_at"),)


# ------------------------------------------------------------------------------------------- operational
class RateLimitBucket(Base):
    __tablename__ = "rate_limit_buckets"

    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class StorageDeletion(Base):
    """Durable to-do list of stored objects to delete. Written in the same transaction that removes (or never
    commits) the owning row, so a failed object delete is retried later instead of leaving an orphaned PDF."""

    __tablename__ = "storage_deletions"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text)
    # Not processed before this time: upload intents get a grace period; failures back off exponentially.
    not_before: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = _created()


class ClosedAccount(Base):
    """Firebase identities whose PaperAid account was closed. Still-valid ID tokens for them are refused, so a
    closed account cannot be re-created by an open browser tab before its token expires."""

    __tablename__ = "closed_accounts"

    firebase_uid: Mapped[str] = mapped_column(String(128), primary_key=True)
    closed_at: Mapped[datetime] = _created()
    # Closure is a durable request: maintenance resumes any closure that has not completed (e.g. the identity
    # provider timed out), so a person who asked to be deleted never depends on a manual recovery.
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))  # no FK: the user row is deleted
    purge_public: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    delete_identity: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text)
    not_before: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ConsentRecord(Base):
    """Evidence of what a person agreed to, which version, and when. Kept (pseudonymised) after account deletion."""

    __tablename__ = "consent_records"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    firebase_uid: Mapped[str] = mapped_column(String(128), nullable=False)
    document: Mapped[str] = mapped_column(String(40), nullable=False)  # terms | privacy | ai_processing | ...
    version: Mapped[str] = mapped_column(String(20), nullable=False)
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False)
    country: Mapped[str | None] = mapped_column(String(8))
    created_at: Mapped[datetime] = _created()

    __table_args__ = (Index("ix_consent_records_user", "user_id", "document", "created_at"),)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = _uuid_pk()
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    target_type: Mapped[str] = mapped_column(String(40), nullable=False)
    target_id: Mapped[str] = mapped_column(String(64), nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = _created()

    __table_args__ = (Index("ix_audit_events_created", "created_at"),)
