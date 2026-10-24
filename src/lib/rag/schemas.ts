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
      "A distinct, substantive empirical claim or finding answering the researcher's question that IS directly substantiated by the evidence blocks."
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
      "List of distinct, grounded empirical claims answering the question that ARE directly substantiated by the evidence blocks. Every substantive claim must have at least one supporting Chunk ID from the supplied evidence blocks. If none of the requested findings are supported by the evidence, provide an empty list."
    ),
  unverifiedAspects: z
    .array(z.string())
    .default([])
    .describe(
      "List of specific aspects, metrics, or entities requested in the researcher's question that could NOT be found or verified in the supplied manuscript evidence (e.g. 'Individual sensitivity and specificity figures for myometrial cysts were not reported in the accessible text'). If all requested findings were fully verified, provide an empty list."
    ),
  insufficientEvidence: z
    .boolean()
    .describe(
      "Set to true ONLY if the supplied manuscript evidence is completely missing, irrelevant, or fails to support ANY substantive finding for the question (i.e. claims array is empty). If at least one requested finding has valid supporting evidence, set insufficientEvidence to false."
    ),
});

export type PaperQAClaimOutput = z.infer<typeof PaperQAClaimSchema>;
export type PaperQAAnswerOutput = z.infer<typeof PaperQAAnswerSchema>;
export type PaperQAAnswer = PaperQAAnswerOutput;
