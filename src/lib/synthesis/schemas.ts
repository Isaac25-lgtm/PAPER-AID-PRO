import { z } from "zod";

/**
 * Strict Structured Output Schema for Multi-Paper Research Synthesis.
 *
 * Notice:
 * 1. The model outputs ONLY paperId and chunkId identifiers for each claim.
 * 2. Every substantive statement must map to concrete evidence.
 * 3. Page numbers, sections, titles, and snippets are strictly hydrated server-side from PostgreSQL.
 */
export const PaperEvidenceReferenceSchema = z.object({
  paperId: z
    .string()
    .describe("Exact Paper ID of the supporting manuscript from the supplied evidence blocks."),
  chunkIds: z
    .array(z.string())
    .describe("Exact Chunk IDs from this specific paper that directly substantiate the claim."),
});

export const MultiPaperClaimSchema = z.object({
  text: z
    .string()
    .describe("A factual, empirical claim or finding directly reported in the literature."),
  evidence: z
    .array(PaperEvidenceReferenceSchema)
    .describe("One or more papers and their respective chunk IDs providing direct empirical support for this claim."),
});

export const MultiPaperDisagreementSchema = z.object({
  description: z
    .string()
    .describe("A clear description of materially conflicting findings or differing results between papers."),
  evidence: z
    .array(PaperEvidenceReferenceSchema)
    .describe("The conflicting papers and respective chunk IDs showing differing observations."),
});

export const MultiPaperLimitationSchema = z.object({
  text: z
    .string()
    .describe("A specific limitation, uncertainty, or methodological constraint explicitly stated in the evidence."),
  evidence: z
    .array(PaperEvidenceReferenceSchema)
    .describe("The papers and chunk IDs where this limitation was explicitly reported."),
});

export const MultiPaperSynthesisSchema = z.object({
  claims: z
    .array(MultiPaperClaimSchema)
    .describe("Distinct empirical claims supported by the literature. If evidence is lacking, leave empty."),
  disagreements: z
    .array(MultiPaperDisagreementSchema)
    .describe("Material disagreements or conflicting results between studies. If all studies agree or evidence is one-sided, leave empty."),
  limitations: z
    .array(MultiPaperLimitationSchema)
    .describe("Methodological or scope limitations explicitly reported in the evidence. If none mentioned, leave empty."),
  insufficientEvidence: z
    .boolean()
    .describe("Set to true if the supplied manuscript evidence is missing or insufficient to answer the question."),
});

export type MultiPaperSynthesisOutput = z.infer<typeof MultiPaperSynthesisSchema>;
export type MultiPaperClaimOutput = z.infer<typeof MultiPaperClaimSchema>;
export type MultiPaperDisagreementOutput = z.infer<typeof MultiPaperDisagreementSchema>;
export type MultiPaperLimitationOutput = z.infer<typeof MultiPaperLimitationSchema>;
