/**
 * AI Research Hub — AI Research Snapshot Types
 *
 * Grounded in actual retrieved papers and explicit evidence modes.
 */

export type EvidenceMode = "ABSTRACT_EVIDENCE" | "FULL_TEXT_EVIDENCE";

export interface SnapshotProvenance {
  pageNumber?: number;
  section?: string;
  charOffset?: number;
  isFullText: boolean;
  sourceProvider?: string;
}

export interface SnapshotCitation {
  index: number; // 1-based [1], [2], ...
  paperId: string;
  title: string;
  authors: string;
  year?: number | null;
  journal?: string | null;
  doi?: string | null;
  pmid?: string | null;
  pmcid?: string | null;
  isOpenAccess: boolean;
  supportingSnippet: string; // Verifiable excerpt from abstract or full-text chunk
  provenance: SnapshotProvenance;
}

export interface ResearchSnapshot {
  query: string;
  theme: string;
  findings: string;
  limitations: string;
  summaryText: string;
  wordCount: number;
  evidenceMode: EvidenceMode;
  citations: SnapshotCitation[];
  isInsufficientEvidence: boolean;
  insufficientReason?: string;
  sourcesCount: number;
  retrievedCount?: number;
  citedCount?: number;
  generatedAt: string;
  cached: boolean;
}

export interface SnapshotRequestOptions {
  evidenceMode?: EvidenceMode;
  forceRefresh?: boolean;
  clientId?: string;
}
