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

export interface ValidatedMultiPaperDisagreement {
  description: string;
  supportingPaperIds: string[];
  citations: HydratedMultiPaperAnchor[];
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
