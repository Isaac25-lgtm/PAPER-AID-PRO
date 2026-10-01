import { z } from "zod";

/**
 * Strict Structured Output Schema for Single-Paper Research Q&A (Claim-Level Provenance).
 * 
 * Notice: The model returns ONLY chunkId references for each claim.
 * Page numbers, sections, snippets, and paper metadata are strictly
 * hydrated server-side from PostgreSQL to guarantee zero fabrication.
 */
export const PaperQAClaimSchema = z.object({
  text: z
    .string()
    .describe(
      "A distinct, substantive empirical claim or finding answering the researcher's question."
    ),
  evidenceChunkIds: z
    .array(z.string())
    .describe(
      "List of exact Chunk IDs from the supplied evidence blocks that directly substantiate this specific claim."
    ),
});

export const PaperQAAnswerSchema = z.object({
  claims: z
    .array(PaperQAClaimSchema)
    .describe(
      "List of distinct, grounded empirical claims answering the question. Every substantive claim must have at least one supporting Chunk ID from the supplied evidence blocks. If the evidence does not clearly support any claims, provide an empty list."
    ),
  insufficientEvidence: z
    .boolean()
    .describe(
      "Set to true if the supplied manuscript evidence is missing, ambiguous, or insufficient to answer the question with empirical certainty."
    ),
});

export type PaperQAClaimOutput = z.infer<typeof PaperQAClaimSchema>;
export type PaperQAAnswerOutput = z.infer<typeof PaperQAAnswerSchema>;
