import { AI_CONFIG } from "./config";

export interface PaperMetadataContext {
  title: string;
  abstract: string;
  journal?: string | null;
  doi?: string | null;
  arxivId?: string | null;
  publicationDate?: Date | string | null;
  keywords?: string[];
  authors?: Array<{ name: string; institution?: string | null }>;
}

export interface ChunkInput {
  id: string;
  chunkIndex: number;
  text: string;
  section: string | null;
  pageNumber: number | null;
  tokenCount?: number | null;
  paperId?: string;
}

/**
 * System prompt embedding strict scientific integrity, zero-hallucination,
 * and chunk-anchored citation rules.
 */
export const SCIENTIFIC_INTEGRITY_SYSTEM_PROMPT = `You are an evidence-grounded scientific research intelligence engine for peer-reviewed academic literature.

PROMPT VERSION: ${AI_CONFIG.promptVersion}

STRICT RESEARCH INTEGRITY DIRECTIVES:
1. Grounding Guarantee: Analyze ONLY the supplied manuscript chunks. Do NOT use outside scientific knowledge, prior pre-training assumptions, or web information to invent facts.
2. Zero Numeric Hallucination: NEVER modify, extrapolate, or invent reported numerical values, sample sizes (N), BLEU scores, p-values, odds ratios, confidence intervals, or benchmark metrics. Use the exact numbers reported.
3. Speculation vs. Empirical Finding: Clearly distinguish between what the study empirically proved/measured versus author hypotheses or future outlook.
4. Scientific Uncertainty & Causality: Do not overstate causality. Do not claim therapeutic or clinical efficacy merely from observational correlations. Preserve the authors' stated confidence levels.
5. Missing Evidence: If a methodology detail, limitation, or finding is not explicitly reported in the supplied chunks, explicitly state: "Not clearly reported in the supplied manuscript evidence."
6. Strict Chunk Provenance: For every item in "keyFindings", "methodologySummary", "limitations", and "conclusion", you MUST populate "evidenceChunkIds" with the EXACT Chunk IDs from the provided context that directly substantiate that statement.
7. NEVER invent or hallucinate a Chunk ID. Only select Chunk IDs from the provided "=== CHUNK [ID: ...] ===" headers.`;

/**
 * Formats paper metadata and chunk evidence into a structured user prompt for OpenAI.
 * Applies intelligent evidence reduction for long papers.
 */
export function buildPaperAnalysisPrompt(
  metadata: PaperMetadataContext,
  chunks: ChunkInput[]
): { userPrompt: string; suppliedChunkIds: Set<string> } {
  const suppliedChunkIds = new Set<string>();

  // Filter out pure references / bibliography chunks if paper exceeds threshold to save tokens
  // while prioritizing substantive scientific sections
  let filteredChunks = chunks;
  if (chunks.length > 45) {
    filteredChunks = chunks.filter((c) => {
      const sec = (c.section || "").toLowerCase();
      return !sec.includes("reference") && !sec.includes("bibliography");
    });
  }

  // Ensure chunks are ordered by chunkIndex
  const sortedChunks = [...filteredChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

  const formattedChunks: string[] = [];

  for (const chunk of sortedChunks) {
    suppliedChunkIds.add(chunk.id);
    formattedChunks.push(
      `=== CHUNK [ID: ${chunk.id}] ===\nPage: ${chunk.pageNumber ?? "Unknown"} | Section: ${chunk.section || "Main Text"} | Chunk Index: ${chunk.chunkIndex}\n${chunk.text.trim()}`
    );
  }

  const authorsStr = metadata.authors?.length
    ? metadata.authors.map((a) => (a.institution ? `${a.name} (${a.institution})` : a.name)).join("; ")
    : "Not specified";

  const userPrompt = `MANUSCRIPT BIBLIOGRAPHIC RECORD:
Title: ${metadata.title}
Authors: ${authorsStr}
Journal/Conference: ${metadata.journal || "Not specified"}
DOI: ${metadata.doi || "Not specified"}
Publication Date: ${metadata.publicationDate ? new Date(metadata.publicationDate).toISOString().split("T")[0] : "Not specified"}
Keywords: ${metadata.keywords?.join(", ") || "None"}

ORIGINAL AUTHOR ABSTRACT:
${metadata.abstract}

================================================================================
MANUSCRIPT EVIDENCE CHUNKS (${sortedChunks.length} chunks supplied):
================================================================================

${formattedChunks.join("\n\n")}

================================================================================
INSTRUCTIONS:
Provide a rigorous, structured scientific synthesis of the manuscript above adhering strictly to the system directives. Every key finding and grounded section must link to the exact Chunk IDs ([ID: ...]) that substantiate it.
================================================================================`;

  return { userPrompt, suppliedChunkIds };
}
