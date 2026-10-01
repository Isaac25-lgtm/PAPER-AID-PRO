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
      return "Preparing paper";
    case "EMBEDDING":
      return "Preparing AI search";
    case "COMPLETED":
      return "Ready";
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
        label: "Preparing paper",
        variant: "secondary",
        className: "bg-indigo-50 text-indigo-700 border-indigo-200",
        description: "Text extracted; organizing evidence structure.",
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
        label: "Ready",
        variant: "success",
        className: "bg-emerald-50 text-emerald-800 border-emerald-200",
        description: "Full manuscript indexed and ready for grounded research and AI inquiry.",
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
