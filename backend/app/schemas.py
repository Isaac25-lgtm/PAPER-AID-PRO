"""Request/response schemas (the public API contract, published at /api/v1/openapi.json)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.models import DocumentType, Paper, PaperStatus
from app.services.scholarly.models import ProviderName, Subject


class Model(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------------------------------------- users
class UserOut(Model):
    id: uuid.UUID
    email: str
    name: str | None
    avatar_url: str | None
    role: str
    email_verified: bool
    created_at: datetime


class MeOut(UserOut):
    """The signed-in person, plus what the app needs to gate and personalise the experience."""

    accepted_policy_version: str | None
    policy_version: str = Field(description="Current Terms/Privacy version; accept it when it differs.")
    needs_consent: bool
    preferences: dict[str, Any]


class ProgressOut(BaseModel):
    library: int
    full_text: int
    collections: int
    documents: int
    conversations: int


class ConsentIn(BaseModel):
    """Required: terms, privacy, ai_processing, age_18 (all must be true). Optional: product_emails, analytics."""

    terms: bool
    privacy: bool
    ai_processing: bool
    age_18: bool
    product_emails: bool = False
    analytics: bool = False
    # The version of the notices the browser displayed. Acceptance is recorded only for that exact version.
    policy_version: str | None = Field(default=None, max_length=20)


class PreferencesIn(BaseModel):
    """Merged into the stored preferences (a value of null removes the key)."""

    values: dict[str, Any] = Field(max_length=50)


class DeleteAccountIn(BaseModel):
    confirm_email: str = Field(min_length=3, max_length=320)


class UserUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


# ------------------------------------------------------------------------------------------------ papers
class PaperOut(Model):
    id: uuid.UUID
    title: str
    abstract: str | None
    authors: list[str]
    year: int | None
    publication_date: date | None
    journal: str | None
    publisher: str | None
    volume: str | None
    issue: str | None
    pages: str | None
    work_type: str
    url: str | None
    doi: str | None
    pmid: str | None
    pmcid: str | None
    arxiv_id: str | None
    is_open_access: bool
    oa_pdf_url: str | None
    oa_license: str | None
    citation_count: int
    keywords: list[str]
    visibility: str
    source: str
    # "registry" (verified from Crossref/PubMed/...) or "user" (typed or uploaded by its owner)
    metadata_source: str = "registry"
    csl_extra: dict[str, Any] = Field(default_factory=dict)
    status: str
    status_detail: str | None
    has_full_text: bool
    has_pdf: bool
    page_count: int | None
    is_owner: bool = False
    in_library: bool = False
    created_at: datetime

    @classmethod
    def build(cls, paper: Paper, *, user_id: uuid.UUID | None = None, in_library: bool = False) -> PaperOut:
        return cls(
            **{
                f: getattr(paper, f)
                for f in (
                    "id",
                    "title",
                    "abstract",
                    "year",
                    "publication_date",
                    "journal",
                    "publisher",
                    "volume",
                    "issue",
                    "pages",
                    "work_type",
                    "url",
                    "doi",
                    "pmid",
                    "pmcid",
                    "arxiv_id",
                    "is_open_access",
                    "oa_pdf_url",
                    "oa_license",
                    "citation_count",
                    "keywords",
                    "status_detail",
                    "page_count",
                    "created_at",
                )
            },
            authors=[pa.author.name for pa in paper.authors],
            visibility=paper.visibility.value,
            source=paper.source.value,
            metadata_source=paper.metadata_source,
            csl_extra=paper.csl_extra or {},
            status=paper.status.value,
            has_full_text=paper.status == PaperStatus.READY,
            has_pdf=bool(paper.storage_path),
            is_owner=user_id is not None and paper.owner_id == user_id,
            in_library=in_library,
        )


class PaperPage(BaseModel):
    items: list[PaperOut]
    total: int
    page: int
    page_size: int
    matched_query: str | None = None  # set when a misspelled search was corrected


class ImportRequest(BaseModel):
    identifier: str = Field(min_length=3, max_length=500, description="DOI, PMID, PMCID, arXiv id or their URLs")
    add_to_library: bool = True
    fetch_full_text: bool = False


class PassageOut(BaseModel):
    chunk_id: uuid.UUID
    text: str
    section: str | None
    page_start: int | None
    page_end: int | None
    # Set when nothing matched the words as typed and a misspelling was corrected from the paper's own words.
    matched_query: str | None = None


class JobOut(Model):
    id: uuid.UUID
    paper_id: uuid.UUID
    kind: str
    status: str
    attempts: int
    error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


# --------------------------------------------------------------------------------------------- discovery
class WorkOut(BaseModel):
    title: str
    abstract: str | None
    authors: list[str]
    year: int | None
    journal: str | None
    doi: str | None
    pmid: str | None
    pmcid: str | None
    arxiv_id: str | None
    url: str | None
    is_open_access: bool
    oa_pdf_url: str | None
    citation_count: int
    sources: list[str]
    identifier: str | None = Field(description="Best identifier to import this work with")
    library_paper_id: uuid.UUID | None = None


class ProviderStatusOut(BaseModel):
    provider: str
    ok: bool
    count: int
    error: str | None


class SearchResponse(BaseModel):
    query: str  # what was searched
    corrected_from: str | None = None  # the query as typed, when a misspelling was corrected
    identifier: str | None = None  # "doi" | "pmid" | "pmcid" | "arxiv" when the query was looked up as an identifier
    results: list[WorkOut]
    providers: list[ProviderStatusOut]


class SnapshotRequest(BaseModel):
    query: str = Field(min_length=2, max_length=300)
    identifiers: list[str] = Field(min_length=2, max_length=10)


# ---------------------------------------------------------------------------------------------- library
class LibraryAdd(BaseModel):
    paper_id: uuid.UUID


class LibraryUpdate(BaseModel):
    notes: str | None = Field(default=None, max_length=20_000)
    tags: list[str] | None = Field(default=None, max_length=30)

    @field_validator("tags")
    @classmethod
    def _tags(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        return list(dict.fromkeys(t.strip()[:50] for t in value if t.strip()))


class LibraryItemOut(BaseModel):
    paper: PaperOut
    notes: str | None
    tags: list[str]
    collection_ids: list[uuid.UUID]
    added_at: datetime


class ImportResult(BaseModel):
    imported: int
    skipped: int
    errors: list[str]


class CollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class CollectionOut(Model):
    id: uuid.UUID
    name: str
    description: str | None
    color: str | None
    paper_count: int = 0
    created_at: datetime


# -------------------------------------------------------------------------------------------- documents
class DocumentCreate(BaseModel):
    title: str = Field(default="Untitled document", max_length=300)
    doc_type: DocumentType = DocumentType.DRAFT
    csl_style: str = "apa"
    content: dict[str, Any] | None = None


class DocumentUpdate(BaseModel):
    base_version: int = Field(ge=1)
    title: str | None = Field(default=None, max_length=300)
    doc_type: DocumentType | None = None
    csl_style: str | None = None
    content: dict[str, Any] | None = None
    checkpoint: bool = False


class RestoreRequest(BaseModel):
    base_version: int = Field(ge=1, description="The document version the user is looking at (409 if stale).")


class DocumentSummaryOut(Model):
    id: uuid.UUID
    title: str
    doc_type: str
    word_count: int
    csl_style: str
    version: int
    updated_at: datetime
    created_at: datetime


class DocumentOut(DocumentSummaryOut):
    content: dict[str, Any]


class CitationCreate(BaseModel):
    paper_id: uuid.UUID
    chunk_id: uuid.UUID | None = None
    locator: str | None = Field(default=None, max_length=50)
    label: Literal["page", "chapter", "section", "figure", "table", "paragraph"] = "page"
    prefix: str | None = Field(default=None, max_length=200)
    suffix: str | None = Field(default=None, max_length=200)


class CitationOut(Model):
    id: uuid.UUID
    paper_id: uuid.UUID
    chunk_id: uuid.UUID | None
    locator: str | None
    label: str
    prefix: str | None
    suffix: str | None


class RevisionSummaryOut(Model):
    id: uuid.UUID
    version: int
    title: str
    word_count: int
    reason: str
    created_at: datetime


class RevisionOut(RevisionSummaryOut):
    content: dict[str, Any]
    csl_style: str


# -------------------------------------------------------------------------------------------- citations
class StyleOut(BaseModel):
    id: str
    title: str
    kind: str
    group: str = ""
    has_bibliography: bool = True


class FormatRequest(BaseModel):
    paper_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    identifiers: list[str] = Field(default_factory=list, max_length=50)
    style: str = "apa"
    output: Literal["html", "text"] = "html"


class FormattedEntry(BaseModel):
    in_text: str
    bibliography: str
    paper_id: uuid.UUID | None = None
    title: str


class FormatResponse(BaseModel):
    style: str
    entries: list[FormattedEntry]
    unresolved: list[str]


class VerifyRequest(BaseModel):
    references: list[str] = Field(min_length=1, max_length=50)

    @field_validator("references")
    @classmethod
    def _bounded(cls, value: list[str]) -> list[str]:
        """Bound the work before any registry call or rate-limit charge (Deep Research audit F10)."""
        from app.services.citations.verify import MAX_REFERENCE_CHARS, MAX_TOTAL_CHARS

        for index, reference in enumerate(value, start=1):
            if len(reference.strip()) > MAX_REFERENCE_CHARS:
                raise ValueError(
                    f"Reference {index} is longer than {MAX_REFERENCE_CHARS:,} characters. Separate references with a "
                    "blank line."
                )
        if sum(len(r) for r in value) > MAX_TOTAL_CHARS:
            raise ValueError(f"The list is longer than {MAX_TOTAL_CHARS:,} characters. Check it in parts.")
        return value


# ---------------------------------------------------------------------------------------------- AI/research
class AskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=2000)


class ResearchAskRequest(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    paper_ids: list[uuid.UUID] = Field(min_length=1, max_length=30)
    conversation_id: uuid.UUID | None = None


class PassageCheckRequest(BaseModel):
    text: str = Field(min_length=3, max_length=2000)


class GroundedAnswerOut(BaseModel):
    answer: str
    insufficient_evidence: bool
    gaps: str
    citations: list[dict[str, Any]]
    model: str | None
    conversation_id: uuid.UUID | None = None
    # For "check against my sources": which sources were examined and how many were not.
    scope: dict[str, Any] | None = None


class DeepResearchRequest(BaseModel):
    question: str = Field(min_length=10, max_length=2000)
    subject: Subject = "all"
    year_from: int | None = Field(default=None, ge=1500, le=2100)
    year_to: int | None = Field(default=None, ge=1500, le=2100)
    # Off unless the person chose it: a question is never sent to a web search service by default (audit F01).
    include_web: bool = False

    @field_validator("question")
    @classmethod
    def _searchable(cls, value: str) -> str:
        """Whitespace is normalised and the question must still contain words to search for, checked before any
        quota is charged or provider asked (audit F14)."""
        from app.services.deep_research import usable_question

        usable = usable_question(value)
        if usable is None or len(usable) < 10:
            raise ValueError("Write a research question of at least 10 characters, with words to search for.")
        return usable


class DeepResearchStatusOut(BaseModel):
    databases: list[str]
    ai: bool  # a report can be written for this account
    web_search: bool  # the general web search service is connected


class DeepResearchOut(Model):
    id: uuid.UUID
    question: str
    options: dict[str, Any]
    queries: list[str]
    sources: list[dict[str, Any]]
    services: list[dict[str, Any]]
    report: str | None
    citations: list[dict[str, Any]]
    insufficient_evidence: bool
    gaps: str
    model: str | None
    # complete | ai_not_connected | withheld (failed the citation checks) | ai_failed
    report_status: str
    created_at: datetime


class DeepResearchSummaryOut(Model):
    id: uuid.UUID
    question: str
    report_status: str
    source_count: int
    created_at: datetime


class ConversationSummaryOut(Model):
    id: uuid.UUID
    title: str
    paper_ids: list[uuid.UUID]
    updated_at: datetime


class MessageOut(Model):
    id: uuid.UUID
    role: str
    content: str
    citations: list[dict[str, Any]]
    model: str | None
    insufficient_evidence: bool = False
    gaps: str = ""
    created_at: datetime


class ConversationOut(ConversationSummaryOut):
    messages: list[MessageOut]


class RewriteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    mode: Literal["academic", "concise", "expand", "simplify", "grammar"]
    context: str | None = Field(default=None, max_length=4000)


class CompleteRequest(BaseModel):
    document_id: uuid.UUID
    preceding_text: str = Field(min_length=20, max_length=8000)


class TextResult(BaseModel):
    text: str
    model: str


class AIStatus(BaseModel):
    enabled: bool  # for the signed-in account (provider configured AND in the AI cohort)
    provider: str
    model: str | None
    embeddings_enabled: bool
    autocomplete: bool = False  # inline suggestions available (deployment switch on, and `enabled`)


# --------------------------------------------------------------------------------------------------- admin
class AdminUserUpdate(BaseModel):
    role: Literal["user", "admin"] | None = None
    is_active: bool | None = None


class AdminUserOut(UserOut):
    is_active: bool
    last_seen_at: datetime | None


class StatsOut(BaseModel):
    users: int
    papers_public: int
    papers_private: int
    papers_with_full_text: int
    documents: int
    jobs_failed_24h: int
    jobs_queued: int
    ai_enabled: bool


class MaintenanceOut(BaseModel):
    storage_objects_deleted: int
    rate_buckets_purged: int
    jobs_reclaimed: int
    closures_completed: int = 0


class SearchFilters(BaseModel):
    q: str = Field(min_length=2, max_length=300)
    providers: list[ProviderName] | None = None
    limit: int = Field(default=20, ge=1, le=50)
    year_from: int | None = Field(default=None, ge=1500, le=2100)
    year_to: int | None = Field(default=None, ge=1500, le=2100)
    open_access_only: bool = False


PaperStatusFilter = Literal["metadata_only", "queued", "processing", "ready", "failed"]
