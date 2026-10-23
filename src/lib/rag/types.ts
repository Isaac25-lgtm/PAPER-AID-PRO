export type EvidenceType = "FULL_TEXT" | "ABSTRACT";
export type RetrievalMethod = "SEMANTIC" | "LEXICAL" | "HYBRID_RRF" | "ABSTRACT_FALLBACK";
export type PermissionScope = "PUBLIC_OPEN_ACCESS" | "PUBLIC_METADATA_ONLY" | "PRIVATE_USER" | "RESTRICTED";
export type ClaimSupportStatus = "SUPPORTED" | "CONTRADICTED" | "INSUFFICIENT" | "UNVERIFIED";

export interface EvidenceProvenance {
  paperId: string;
  chunkId?: string | null;
  evidenceType: EvidenceType;
  sourceTitle: string;
  doi?: string | null;
  authorizedSource: string; // e.g. "PostgreSQL:paper_chunks", "PostgreSQL:papers.abstract", "UserUpload:private"
  exactEvidenceText: string;
  pageNumber: number | null;
  section: string | null;
  retrievalMethod: RetrievalMethod;
  contentChecksum?: string | null; // e.g. SHA-256 hex of exact text
  permissionScope: PermissionScope;
  isInterpretation: boolean; // false for verbatim retrieved evidence, true for model paraphrase/synthesis
}

export interface GroundedCitationAnchor {
  chunkId: string;
  chunkIndex?: number;
  pageNumber: number | null;
  section: string | null;
  snippet: string; // Verbatim snippet extracted directly from PaperChunk.text or abstract
  fullText?: string; // Complete stored manuscript chunk text or abstract
  evidenceType?: EvidenceType;
  sourceTitle?: string;
  doi?: string | null;
  paperId?: string;
  retrievalMethod?: RetrievalMethod;
  isInterpretation?: boolean;
}

export interface GroundedClaim {
  text: string;
  citations: GroundedCitationAnchor[];
  supportStatus?: ClaimSupportStatus;
  evidenceType?: EvidenceType; // "FULL_TEXT" | "ABSTRACT"
  hasQuotationMismatch?: boolean;
  mismatchReason?: string;
  isInterpretation?: boolean;
}

export interface RetrievedEvidenceChunk {
  id: string;
  paperId: string;
  chunkIndex: number;
  section: string | null;
  pageNumber: number | null;
  text: string;
  evidenceType?: EvidenceType;
  sourceTitle?: string;
  doi?: string | null;
  retrievalMethod?: RetrievalMethod;
  permissionScope?: PermissionScope;
  contentChecksum?: string | null;
  isMockEmbedding?: boolean;
  similarity?: number;
  lexicalRank?: number | null;
  semanticRank?: number | null;
  rrfScore?: number;
}

export interface PaperQARequest {
  paperId: string;
  question: string;
  conversationId?: string;
}

export interface PaperQAResponse {
  success: boolean;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  answer: string;
  claims?: GroundedClaim[];
  citations: GroundedCitationAnchor[];
  insufficientEvidence: boolean;
  evidenceType?: EvidenceType;
  limitations?: string[];
  provenanceSummary?: {
    fullTextCount: number;
    abstractCount: number;
    lexicalFallbackUsed: boolean;
  };
  error?: string;
}

export interface ConversationMessageView {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  claims?: GroundedClaim[];
  citations?: GroundedCitationAnchor[];
  evidenceType?: EvidenceType;
  createdAt: string;
}

