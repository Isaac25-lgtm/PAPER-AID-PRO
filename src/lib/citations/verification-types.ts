/**
 * Citation Verification Types & Schemas
 *
 * Defines the four canonical verification states:
 * 1. VERIFIED: Identifier resolved and supplied metadata sufficiently matches authoritative records.
 * 2. MISMATCHED: Identifier resolved but supplied metadata conflicts.
 * 3. NOT FOUND: A completed authoritative lookup did not find the identifier.
 * 4. UNVERIFIABLE: Lookup unavailable, malformed/incomplete identifier, or insufficient evidence.
 */

export type CitationVerificationStatus =
  | "VERIFIED"
  | "MISMATCHED"
  | "NOT FOUND"
  | "UNVERIFIABLE";

export interface FieldDifference<T = string> {
  submitted: T;
  registered: T;
  matches: boolean;
  similarity?: number;
}

export interface CitationVerificationRequest {
  identifier?: string; // DOI, PMID, arXiv ID, or URL
  title?: string;
  authors?: string[];
  year?: number | string;
  journal?: string;
}

export interface ComparedFieldsSummary {
  matched: string[];
  conflicting: string[];
  notSupplied: string[];
}

export interface RegisteredMetadata {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  pmid?: string;
  sourceRegistry: string; // e.g. "CitedEvidence Scholar catalog (CEDOA / OpenAlex)"
  publicationType?: string; // e.g. "article", "preprint", "dissertation", "book"
  isPreprint?: boolean;
  openAccessUrl?: string | null;
}

export interface CitationVerificationResult {
  status: CitationVerificationStatus;
  statusDetails: string;
  submitted: CitationVerificationRequest;
  resolvedIdentifier?: {
    type: "DOI" | "PMID" | "ARXIV" | "UNKNOWN";
    raw: string;
    normalized: string;
    canonicalUrl?: string;
  };
  registeredMetadata?: RegisteredMetadata;
  comparedFields: ComparedFieldsSummary;
  discrepancies?: {
    title?: FieldDifference<string>;
    authors?: FieldDifference<string[]>;
    year?: FieldDifference<number | string>;
    venue?: FieldDifference<string>;
  };
  versionNotice?: string;
  academicIntegrityNotice: string;
  verifiedAt: string;
}
