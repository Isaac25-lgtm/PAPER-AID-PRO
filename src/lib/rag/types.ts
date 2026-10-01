export interface GroundedCitationAnchor {
  chunkId: string;
  chunkIndex: number;
  pageNumber: number | null;
  section: string | null;
  snippet: string; // Verbatim snippet extracted directly from PaperChunk.text
}

export interface GroundedClaim {
  text: string;
  citations: GroundedCitationAnchor[];
}

export interface RetrievedEvidenceChunk {
  id: string;
  paperId: string;
  chunkIndex: number;
  section: string | null;
  pageNumber: number | null;
  text: string;
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
  error?: string;
}

export interface ConversationMessageView {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  claims?: GroundedClaim[];
  citations?: GroundedCitationAnchor[];
  createdAt: string;
}
