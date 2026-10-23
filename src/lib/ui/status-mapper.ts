import { PaperProcessingStatus, ProcessingStage } from "@prisma/client";

export interface StatusBadgeInfo {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline" | "academic" | "success" | "warning";
  className: string;
  description: string;
}

/**
 * Human-readable paper status mapper for scientific research users.
 * Strictly translates internal database enums into researcher-facing language.
 * Never exposes raw enum identifiers (e.g. METADATA_ONLY, TEXT_EXTRACTED) in user UI.
 */
export function getPaperStatusLabel(status: PaperProcessingStatus | string | null | undefined): string {
  switch (status) {
    case "METADATA_ONLY":
      return "Full text needed";
    case "UPLOADED":
      return "Uploaded";
    case "PROCESSING":
      return "Processing paper";
    case "TEXT_EXTRACTED":
      return "Full text extracted";
    case "EMBEDDING":
      return "Preparing AI search";
    case "COMPLETED":
      return "Ready for AI";
    case "FAILED":
      return "Processing failed";
    default:
      return "Status unknown";
  }
}

/**
 * Maps paper status to human-friendly styling badges and descriptions.
 */
export function getPaperStatusBadge(status: PaperProcessingStatus | string | null | undefined): StatusBadgeInfo {
  switch (status) {
    case "METADATA_ONLY":
      return {
        label: "Full text needed",
        variant: "warning",
        className: "bg-amber-50 text-amber-800 border-amber-200",
        description: "Paper discovered and saved, but the full manuscript PDF is not yet attached for AI analysis.",
      };
    case "UPLOADED":
      return {
        label: "Uploaded",
        variant: "secondary",
        className: "bg-sky-50 text-sky-700 border-sky-200",
        description: "PDF uploaded and queued for manuscript reading.",
      };
    case "PROCESSING":
      return {
        label: "Processing paper",
        variant: "secondary",
        className: "bg-blue-50 text-blue-700 border-blue-200 animate-pulse",
        description: "Reading manuscript and extracting sections.",
      };
    case "TEXT_EXTRACTED":
      return {
        label: "Full text extracted",
        variant: "academic",
        className: "bg-indigo-50 text-indigo-700 border-indigo-200",
        description: "Full manuscript extracted and structured. Semantic AI indexing pending authorization.",
      };
    case "EMBEDDING":
      return {
        label: "Preparing AI search",
        variant: "secondary",
        className: "bg-purple-50 text-purple-700 border-purple-200",
        description: "Indexing manuscript chunks for precision retrieval.",
      };
    case "COMPLETED":
      return {
        label: "Ready for AI",
        variant: "success",
        className: "bg-emerald-50 text-emerald-800 border-emerald-200",
        description: "Full manuscript semantically indexed and ready for grounded research and AI inquiry.",
      };
    case "FAILED":
      return {
        label: "Processing failed",
        variant: "destructive",
        className: "bg-rose-50 text-rose-800 border-rose-200",
        description: "We could not process this document. You can retry processing or re-upload the PDF.",
      };
    default:
      return {
        label: "Unknown",
        variant: "outline",
        className: "bg-slate-50 text-slate-600 border-slate-200",
        description: "Status is currently pending update.",
      };
  }
}

/**
 * Human-readable translation for pipeline stages.
 */
export function getProcessingStageLabel(stage: ProcessingStage | string | null | undefined): string {
  switch (stage) {
    case "PDF_DOWNLOAD":
      return "Downloading PDF";
    case "TEXT_EXTRACTION":
      return "Reading manuscript text";
    case "CHUNKING":
      return "Structuring paper sections";
    case "EMBEDDING_GENERATION":
      return "Indexing research evidence";
    case "SUMMARY_GENERATION":
      return "Generating evidence summary";
    case "CITATION_ANALYSIS":
      return "Validating citation references";
    case "METADATA_EXTRACTION":
      return "Extracting bibliographic data";
    default:
      return "Processing";
  }
}

/**
 * Checks whether a paper is ready for grounded AI research inquiry.
 */
export function isPaperReadyForAI(status: PaperProcessingStatus | string | null | undefined): boolean {
  return status === "COMPLETED";
}

/**
 * Checks whether a paper requires full-text upload before AI operations.
 */
export function isPaperFullTextNeeded(status: PaperProcessingStatus | string | null | undefined): boolean {
  return status === "METADATA_ONLY";
}

export type OpenAccessDisplayStatus =
  | "SEARCHING_FOR_OPEN_ACCESS"
  | "OPEN_ACCESS_PDF_FOUND"
  | "PROCESSING_FULL_TEXT"
  | "READY_FOR_AI_ANALYSIS"
  | "REFERENCE_SAVED_FULL_TEXT_NEEDED"
  | "IMPORT_FAILED";

export function getOpenAccessDisplayState(params: {
  status: PaperProcessingStatus | string | null | undefined;
  hasPdf?: boolean;
  chunkCount?: number;
  isOpenAccess?: boolean;
  isSearching?: boolean;
  importError?: string | null;
}): {
  key: OpenAccessDisplayStatus;
  label: string;
  className: string;
  description: string;
} {
  if (params.isSearching) {
    return {
      key: "SEARCHING_FOR_OPEN_ACCESS",
      label: "Searching for Open Access",
      className: "bg-indigo-50 text-indigo-700 border-indigo-200 animate-pulse",
      description: "Querying Unpaywall, OpenAlex, and verified repositories for open-access copies.",
    };
  }

  if (params.importError || params.status === "FAILED") {
    return {
      key: "IMPORT_FAILED",
      label: "Import Failed",
      className: "bg-rose-50 text-rose-800 border-rose-200",
      description: params.importError || "Document acquisition or extraction could not be completed.",
    };
  }

  if (params.status === "COMPLETED" && (params.chunkCount ?? 0) > 0) {
    return {
      key: "READY_FOR_AI_ANALYSIS",
      label: "Ready for AI Analysis",
      className: "bg-emerald-50 text-emerald-800 border-emerald-200",
      description: "Full manuscript is indexed with verifiable evidence chunks.",
    };
  }

  if (
    params.status === "PROCESSING" ||
    params.status === "TEXT_EXTRACTED" ||
    params.status === "EMBEDDING" ||
    params.status === "UPLOADED"
  ) {
    return {
      key: "PROCESSING_FULL_TEXT",
      label: "Processing Full Text",
      className: "bg-blue-50 text-blue-700 border-blue-200 animate-pulse",
      description: "Reading manuscript, parsing sections, and computing neural embeddings.",
    };
  }

  return {
    key: "REFERENCE_SAVED_FULL_TEXT_NEEDED",
    label: "Reference Saved — Full Text Needed",
    className: "bg-amber-50 text-amber-800 border-amber-200",
    description: "Bibliographic metadata is saved in library. Full-text manuscript needed for AI features.",
  };
}
