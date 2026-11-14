// Types mirroring the backend API contract (backend/app/schemas.py, published at /api/v1/openapi.json).

export type Role = "user" | "admin";
export type PaperStatus = "metadata_only" | "queued" | "processing" | "ready" | "failed";

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: Role;
  email_verified: boolean;
  created_at: string;
  /** Terms/Privacy version this account accepted; the app asks again when `policy_version` changes. */
  accepted_policy_version?: string | null;
  policy_version?: string;
  needs_consent?: boolean;
  /** Per-account settings that follow the person across devices (guide state, defaults). */
  preferences?: Record<string, unknown>;
}

export interface Progress {
  library: number;
  full_text: number;
  collections: number;
  documents: number;
  conversations: number;
}

export interface QuoteSpan {
  text: string;
  start: number;
  end: number;
}

export interface Paper {
  id: string;
  /** "registry" = verified from Crossref/PubMed/...; "user" = typed or uploaded by its private owner. */
  metadata_source?: "registry" | "user" | "unverified";
  csl_extra?: Record<string, unknown>;
  title: string;
  abstract: string | null;
  authors: string[];
  year: number | null;
  publication_date: string | null;
  journal: string | null;
  publisher: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  work_type: string;
  url: string | null;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  arxiv_id: string | null;
  is_open_access: boolean;
  oa_pdf_url: string | null;
  oa_license: string | null;
  citation_count: number;
  keywords: string[];
  visibility: "public" | "private";
  source: string;
  status: PaperStatus;
  status_detail: string | null;
  has_full_text: boolean;
  has_pdf: boolean;
  page_count: number | null;
  is_owner: boolean;
  in_library: boolean;
  created_at: string;
}

export interface PaperPage {
  items: Paper[];
  total: number;
  page: number;
  page_size: number;
}

export interface Work {
  title: string;
  abstract: string | null;
  authors: string[];
  year: number | null;
  journal: string | null;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  arxiv_id: string | null;
  url: string | null;
  is_open_access: boolean;
  oa_pdf_url: string | null;
  citation_count: number;
  sources: string[];
  identifier: string | null;
  library_paper_id: string | null;
}

export interface ProviderStatus {
  provider: string;
  ok: boolean;
  count: number;
  error: string | null;
}

export interface SearchResponse {
  query: string;
  results: Work[];
  providers: ProviderStatus[];
}

export interface Passage {
  chunk_id: string;
  text: string;
  section: string | null;
  page_start: number | null;
  page_end: number | null;
}

export interface Job {
  id: string;
  paper_id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface LibraryItem {
  paper: Paper;
  notes: string | null;
  tags: string[];
  collection_ids: string[];
  added_at: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  paper_count: number;
  created_at: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export type DocumentType = "draft" | "manuscript" | "proposal" | "literature_review" | "thesis" | "report";

export interface DocumentSummary {
  id: string;
  title: string;
  doc_type: DocumentType;
  word_count: number;
  csl_style: string;
  version: number;
  updated_at: string;
  created_at: string;
}

export interface JSONContent {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JSONContent[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface ResearchDocument extends DocumentSummary {
  content: JSONContent;
}

export interface Citation {
  id: string;
  paper_id: string;
  chunk_id: string | null;
  locator: string | null;
  label: string;
  prefix: string | null;
  suffix: string | null;
}

export interface RenderedCitations {
  style: string;
  /** One entry per citation node, in document order. `text` is null when every cited source is gone. */
  clusters: { citation_ids: string[]; text: string | null; missing_ids: string[] }[];
  bibliography: string[];
}

export interface Revision {
  id: string;
  version: number;
  title: string;
  word_count: number;
  reason: string;
  created_at: string;
  content?: JSONContent;
}

export interface CitationStyle {
  id: string;
  title: string;
  kind: "author-date" | "numeric" | "note";
  /** Discipline group shown in style menus. */
  group?: string;
  /** False for footnote-only styles (no reference list), e.g. Bluebook. */
  has_bibliography?: boolean;
}

export type Subject = "all" | "health" | "life" | "physical" | "social" | "humanities";

export const SUBJECTS: { value: Subject; label: string }[] = [
  { value: "all", label: "All subjects" },
  { value: "health", label: "Health & medicine" },
  { value: "life", label: "Life sciences" },
  { value: "physical", label: "Physical sciences, engineering & computing" },
  { value: "social", label: "Social sciences, education, business & law" },
  { value: "humanities", label: "Arts & humanities" },
];

export interface FormattedEntry {
  in_text: string;
  bibliography: string;
  paper_id: string | null;
  title: string;
}

export interface VerifyResult {
  reference: string;
  verdict: "verified" | "likely_match" | "mismatch" | "not_found" | "error";
  explanation: string;
  checks?: {
    title_similarity: number;
    year_matches: boolean | null;
    first_author_matches: boolean | null;
    /** Per-field outcome: "matched" | "does not match" | "not checked" (title also "partial"). */
    fields?: Record<string, string>;
  };
  match: { title: string; authors: string[]; year: number | null; journal: string | null; doi: string | null } | null;
}

export interface AnswerCitation {
  key: string;
  paper_id: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  kind: "passage" | "abstract";
  chunk_id: string | null;
  section: string | null;
  page_start: number | null;
  page_end: number | null;
  excerpt: string;
  /** The verified supporting words, with positions inside `excerpt` (highlighted in the UI). */
  quotes?: QuoteSpan[];
  excerpt_truncated_start?: boolean;
  excerpt_truncated_end?: boolean;
}

export interface GroundedAnswer {
  answer: string;
  insufficient_evidence: boolean;
  gaps: string;
  citations: AnswerCitation[];
  model: string | null;
  conversation_id?: string | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  paper_ids: string[];
  updated_at: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: AnswerCitation[];
  model: string | null;
  insufficient_evidence: boolean;
  gaps: string;
  created_at: string;
}

export interface Conversation extends ConversationSummary {
  messages: Message[];
}

export interface SummaryPoint {
  text: string;
  evidence: { key: string; section: string | null; page_start: number | null; excerpt: string; kind: string }[];
}

export interface PaperSummary {
  content: {
    /** Verified overview sentences (each passed the same checks as Q&A claims). */
    overview: SummaryPoint[];
    research_question: SummaryPoint | null;
    methods: SummaryPoint | null;
    key_findings: SummaryPoint[];
    limitations: SummaryPoint[];
    based_on: "full_text" | "abstract";
    insufficient_evidence: boolean;
    /** e.g. "2 statements were removed because the cited sources did not support them." */
    removed_note: string;
  };
  model: string;
  created_at: string;
  label: string;
}

export interface AIStatus {
  enabled: boolean;
  provider: string;
  model: string | null;
  embeddings_enabled: boolean;
}

export interface AdminUser extends User {
  is_active: boolean;
  last_seen_at: string | null;
}

export interface Stats {
  users: number;
  papers_public: number;
  papers_private: number;
  papers_with_full_text: number;
  documents: number;
  jobs_failed_24h: number;
  jobs_queued: number;
  ai_enabled: boolean;
}
