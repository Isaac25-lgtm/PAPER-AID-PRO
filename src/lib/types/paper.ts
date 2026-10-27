export type PaperStatus =
  | "METADATA_ONLY"
  | "UPLOADED"
  | "PROCESSING"
  | "TEXT_EXTRACTED"
  | "EMBEDDING"
  | "COMPLETED"
  | "FAILED";

export interface Paper {
  id: string;
  title: string;
  abstract: string;
  publicationDate: string;
  journal: string;
  doi?: string;
  arxivId?: string;
  pmid?: string;
  pmcid?: string;
  semanticScholarId?: string;
  isOpenAccess?: boolean;
  pdfUrl?: string;
  storagePath?: string;
  status: PaperStatus;
  sourceProvenance?: Record<string, unknown> | null;
  researchQuestion?: string;
  methodology?: string;
  results?: string;
  limitations?: string;
  conclusion?: string;
  keywords: string[];
  citationCount?: number;
  aiSummary?: AISummary | null;
  authors: {
    id: string;
    name: string;
    institution?: string;
  }[];
  categories: {
    id: string;
    name: string;
  }[];
  _count?: {
    chunks?: number;
    bookmarks?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface PaperChunk {
  id: string;
  paperId: string;
  text: string;
  section?: string;
  pageNumber?: number;
  metadata?: Record<string, unknown>;
}

export interface AISummary {
  id: string;
  paperId: string;
  summary: string;
  keyFindings: string[];
  methodologySummary?: string;
  limitations?: string;
  conclusion?: string;
  modelUsed: string;
  createdAt: string;
}
