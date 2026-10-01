import { z } from "zod";

/**
 * Schema for an empirical key finding anchored to exact PaperChunk IDs.
 */
export const KeyFindingSchema = z.object({
  finding: z
    .string()
    .describe("A distinct empirical finding, benchmark measurement, or verified outcome from the paper."),
  evidenceChunkIds: z
    .array(z.string())
    .describe(
      "List of exact Chunk IDs provided in the source evidence that substantiate this finding."
    ),
});

/**
 * Schema for a structured section with supporting Chunk IDs.
 */
export const GroundedSectionSchema = z.object({
  text: z
    .string()
    .describe("Factual summary or analysis of this section adhering strictly to the author's report."),
  evidenceChunkIds: z
    .array(z.string())
    .describe("List of exact Chunk IDs provided in the source evidence supporting this analysis."),
});

/**
 * Strict Structured Output Schema for Scientific Paper Understanding.
 */
export const PaperAnalysisSchema = z.object({
  summary: z
    .string()
    .describe("Comprehensive executive summary synthesizing the manuscript's core scientific objective and impact."),
  keyFindings: z
    .array(KeyFindingSchema)
    .min(1)
    .max(8)
    .describe("List of key empirical takeaways and benchmark findings with chunk citations."),
  methodologySummary: GroundedSectionSchema.describe(
    "Synthesized methodology explaining study design, model architecture, datasets, or lab procedures."
  ),
  limitations: GroundedSectionSchema.describe(
    "Author-stated limitations, hardware/sample constraints, or boundary edge cases reported in the text."
  ),
  conclusion: GroundedSectionSchema.describe(
    "Author conclusions, forward-looking scientific implications, and takeaways."
  ),
});

export type KeyFindingItem = z.infer<typeof KeyFindingSchema>;
export type GroundedSectionItem = z.infer<typeof GroundedSectionSchema>;
export type PaperAnalysisOutput = z.infer<typeof PaperAnalysisSchema>;

/**
 * Resolved provenance citation mapping for UI rendering.
 */
export interface CitationAnchor {
  chunkId: string;
  chunkIndex: number;
  pageNumber: number | null;
  section: string | null;
  snippet?: string;
}

export interface StructuredCitationsPayload {
  keyFindings: Array<{
    finding: string;
    chunkIds: string[];
    citations: CitationAnchor[];
  }>;
  methodology: {
    text: string;
    chunkIds: string[];
    citations: CitationAnchor[];
  };
  limitations: {
    text: string;
    chunkIds: string[];
    citations: CitationAnchor[];
  };
  conclusion: {
    text: string;
    chunkIds: string[];
    citations: CitationAnchor[];
  };
}
