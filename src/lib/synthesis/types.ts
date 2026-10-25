import { RetrievedEvidenceChunk, GroundedCitationAnchor } from "../rag/types";
export type { RetrievedEvidenceChunk, GroundedCitationAnchor };

export interface DiscoveredPaper {
  paperId: string;
  title: string;
  authors: string[];
  publicationDate: string | null;
  doi: string | null;
  journal: string | null;
  citationCount: number;
  relevanceScore: number;
  bestChunkSimilarity: number;
  matchingChunksCount: number;
  bestChunkSnippet?: string;
  bestChunkPage?: number | null;
  bestChunkSection?: string | null;
}

export type EvidenceAvailability = "FULL_TEXT" | "ABSTRACT_ONLY" | "METADATA_ONLY";

/**
 * Deterministically checks whether an abstract string contains genuine, substantive academic text
 * rather than missing content or placeholder labels (e.g. "Abstract not provided in scholarly metadata.").
 */
export function hasSubstantiveAbstract(abstract: string | null | undefined): boolean {
  if (!abstract) return false;
  const clean = abstract.trim();
  if (clean.length < 50) return false;
  const lower = clean.toLowerCase();
  if (
    lower.startsWith("abstract not provided") ||
    lower.startsWith("no abstract available") ||
    lower.startsWith("abstract unavailable") ||
    lower.startsWith("abstract not available")
  ) {
    return false;
  }
  return true;
}

/**
 * Computes the evidence availability category for a paper:
 * - FULL_TEXT: Ingested manuscript with chunkCount > 0 and not METADATA_ONLY
 * - ABSTRACT_ONLY: Has substantive published abstract without ingested full text
 * - METADATA_ONLY: Bibliographic metadata/title only without abstract or full text
 */
export function getPaperEvidenceAvailability(paper: {
  status: string;
  chunkCount: number;
  abstract?: string | null;
}): EvidenceAvailability {
  if (paper.chunkCount > 0 && paper.status !== "METADATA_ONLY") {
    return "FULL_TEXT";
  }
  if (hasSubstantiveAbstract(paper.abstract)) {
    return "ABSTRACT_ONLY";
  }
  return "METADATA_ONLY";
}

export interface PaperEvidenceSet {
  paperId: string;
  paperTitle: string;
  authors: string[];
  publicationDate: string | null;
  doi: string | null;
  journal: string | null;
  citationCount: number;
  chunks: RetrievedEvidenceChunk[];
  abstract?: string;
  isMetadataOnly?: boolean;
  hasAbstract?: boolean;
  evidenceAvailability?: EvidenceAvailability;
}

export interface HydratedMultiPaperAnchor extends GroundedCitationAnchor {
  paperId: string;
  paperTitle: string;
  authors: string[];
  doi: string | null;
  publicationDate: string | null;
  journal: string | null;
}

export interface ValidatedMultiPaperClaim {
  text: string;
  supportingPaperIds: string[];
  supportingPaperCount: number;
  citations: HydratedMultiPaperAnchor[];
}

export type CrossStudyRelationType = "DISAGREEMENT" | "CONTRAST" | "UNCERTAINTY";

export interface ValidatedMultiPaperDisagreement {
  description: string;
  supportingPaperIds: string[];
  citations: HydratedMultiPaperAnchor[];
  classification?: CrossStudyRelationType;
  contrastReason?: string;
}

export interface ValidatedMultiPaperLimitation {
  text: string;
  supportingPaperIds: string[];
  citations: HydratedMultiPaperAnchor[];
}

export interface MultiPaperSynthesisResult {
  success: boolean;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  question: string;
  claims: ValidatedMultiPaperClaim[];
  disagreements: ValidatedMultiPaperDisagreement[];
  limitations: ValidatedMultiPaperLimitation[];
  selectedPapers: Array<{
    paperId: string;
    paperTitle: string;
    authors: string[];
    doi: string | null;
    publicationDate: string | null;
    journal: string | null;
    chunksContributed: number;
    isMetadataOnly?: boolean;
    hasAbstract?: boolean;
    evidenceAvailability?: EvidenceAvailability;
    isSupporting?: boolean;
  }>;
  supportingPapers?: Array<{
    paperId: string;
    paperTitle: string;
    authors: string[];
    doi: string | null;
    publicationDate: string | null;
    journal: string | null;
    chunksContributed: number;
    isMetadataOnly?: boolean;
    hasAbstract?: boolean;
    evidenceAvailability?: EvidenceAvailability;
  }>;
  candidatePapersCount?: number;
  totalEvidenceChunks: number;
  insufficientEvidence: boolean;
  libraryScopeNote: string;
  rejectedCitationCount: number;
  rejectedClaimsCount: number;
  omittedSourcesNotice?: string;
  error?: string;
}

export interface ResearchSynthesisRequest {
  question: string;
  userId: string;
  conversationId?: string;
  isNewThread?: boolean;
  maxPapers?: number;
  selectedPaperIds?: string[];
  contextMode?: "SELECTED_PAPERS" | "ALL_LIBRARY" | "LIBRARY_AND_SCHOLARLY";
}
