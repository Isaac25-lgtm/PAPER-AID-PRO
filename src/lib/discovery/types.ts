/**
 * AI Research Hub — Phase 9: External Scholarly Discovery Types
 *
 * Core contracts for external provider adapters (PubMed, Crossref, Semantic Scholar),
 * normalized paper representation, identity resolution, deduplication, and
 * full-text availability.
 */

export type SourceProvider = "PUBMED" | "CROSSREF" | "SEMANTIC_SCHOLAR" | "CITED_EVIDENCE";

export type FullTextAvailabilityStatus =
  | "FULL_TEXT_AVAILABLE"
  | "METADATA_ONLY"
  | "USER_UPLOAD_REQUIRED"
  | "UNSUPPORTED_SOURCE"
  | "FAILED";

export interface NormalizedAuthor {
  name: string;
  institution?: string | null;
  orcid?: string | null;
}

export interface LocalPaperStatus {
  inLibrary: boolean;
  paperId?: string;
  processingStatus?: "METADATA_ONLY" | "UPLOADED" | "PROCESSING" | "TEXT_EXTRACTED" | "EMBEDDING" | "COMPLETED" | "FAILED";
  hasFullText?: boolean;
}

export interface NormalizedExternalPaper {
  /** Deterministic discovery key (e.g. "doi:10.xxx" or "pmid:123" or "s2:abc") */
  id: string;
  title: string;
  abstract?: string | null;
  authors: NormalizedAuthor[];
  publicationDate?: string | null;
  year?: number | null;
  journal?: string | null;
  doi?: string | null;
  pmid?: string | null;
  pmcid?: string | null;
  arxivId?: string | null;
  semanticScholarId?: string | null;
  externalUrl?: string | null;
  sourceProviders: SourceProvider[];
  citationCount?: number | null;
  isOpenAccess: boolean;
  license?: string | null;
  accessStatus?: string | null;
  openAccessPdfUrl?: string | null;
  fullTextAvailability: FullTextAvailabilityStatus;
  fullTextSource?: string | null;
  localStatus?: LocalPaperStatus;
  rawProviderMetadata?: Record<string, unknown>;
}

export interface ProviderExecutionResult {
  provider: SourceProvider;
  status: "SUCCESS" | "ERROR" | "TIMEOUT" | "RATE_LIMITED";
  count: number;
  error?: string;
  durationMs: number;
}

export interface DiscoverySearchResult {
  query: string;
  papers: NormalizedExternalPaper[];
  totalUniqueResults: number;
  totalRawResults: number;
  providerResults: Record<SourceProvider, ProviderExecutionResult>;
  timingMs: number;
}

export interface DiscoverySearchOptions {
  limitPerProvider?: number;
  timeoutMs?: number;
  yearStart?: number;
  yearEnd?: number;
  openAccessOnly?: boolean;
  enabledProviders?: SourceProvider[];
  userId?: string;
}

export interface ScholarlyProvider {
  readonly name: SourceProvider;
  search(query: string, options?: DiscoverySearchOptions): Promise<NormalizedExternalPaper[]>;
  getPaper?(identifier: { doi?: string; pmid?: string; semanticScholarId?: string }): Promise<NormalizedExternalPaper | null>;
}

export interface ImportPaperResult {
  success: boolean;
  paperId?: string;
  isExisting?: boolean;
  fullTextStatus?: string;
  message?: string;
  error?: string;
}
