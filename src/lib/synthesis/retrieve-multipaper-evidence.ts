import "server-only";
import { prisma } from "../prisma";
import { DiscoveredPaper, PaperEvidenceSet } from "./types";
import { RetrievedEvidenceChunk } from "../rag/types";

export interface RetrieveMultiPaperEvidenceOptions {
  chunksPerPaper?: number; // Target chunks per paper (default: 4, max: 5)
  maxTotalChunks?: number; // Global evidence cap across all papers (default: 20)
  queryVector: number[];   // Reused from discovery
}

export const DEFAULT_CHUNKS_PER_PAPER = 4;
export const DEFAULT_MAX_TOTAL_CHUNKS = 20;

/**
 * Identifies chunks that merely review or summarize third-party external studies
 * (e.g. "In the study presented in [17]...", "The study [32] proposed...").
 * These should not be retrieved as the current paper's own empirical results.
 */
export function isThirdPartyLiteratureChunk(section: string | null, text: string): boolean {
  const trimmed = text.trim();
  const thirdPartyPattern =
    /\b(in\s+the\s+study\s+presented\s+in\s+\[\d+\]|the\s+study\s+\[\d+\]\s+proposed|the\s+study\s+conducted\s+by\s+\[\d+\]|in\s+this\s+article,\s+we\s+cite\s+the\s+relevant\s+content\s+from\s+this\s+literature|according\s+to\s+\[\d+\]|studies\s+in\s+\[\d+\]|prior\s+studies\s+in\s+\[\d+\]|in\s+\[\d+\],\s*(various|several|authors|researchers|a\s+transfer|deep-learning|a\s+vector))/i;
  return thirdPartyPattern.test(trimmed);
}

/**
 * Robustly identifies bibliographic references, citation indices, and literature lists
 * so they are never presented as primary empirical findings.
 */
export function isReferenceChunk(section: string | null, text: string): boolean {
  if (section && /reference|bibliography|citation|literature\s+cited/i.test(section)) {
    return true;
  }
  const trimmed = text.trim();
  // Detect chunks that are predominantly numbered bibliographic entries
  const citationPatternCount = (trimmed.match(/(\[\d+\]|\b\d+\.)\s+[A-Z][a-z]+/g) || []).length;
  if (citationPatternCount >= 3 && /journal|proceedings|doi\.org|vol\.|pp\.|et\s+al\./i.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Retrieves evidence independently from EACH selected paper with strict paper scoping
 * and anti-dominance evidence balancing.
 *
 * Guarantees:
 * 1. Strictly scopes each query: WHERE "paperId" = $paperId.
 * 2. Reuses precomputed query vector (zero redundant OpenAI API calls).
 * 3. Enforces per-paper quota (max 4 chunks per paper).
 * 4. Enforces global evidence cap (max 20 chunks total across all papers).
 */
export async function retrieveMultiPaperEvidence(
  selectedPapers: DiscoveredPaper[],
  question: string,
  options: RetrieveMultiPaperEvidenceOptions
): Promise<{
  evidenceSets: PaperEvidenceSet[];
  totalChunks: number;
  allChunks: RetrievedEvidenceChunk[];
}> {
  const chunksPerPaper = Math.min(Math.max(options.chunksPerPaper || DEFAULT_CHUNKS_PER_PAPER, 1), 5);
  const maxTotalChunks = options.maxTotalChunks || DEFAULT_MAX_TOTAL_CHUNKS;
  const vectorString = `[${options.queryVector.join(",")}]`;

  const evidenceSets: PaperEvidenceSet[] = [];
  const allChunks: RetrievedEvidenceChunk[] = [];
  let cumulativeChunks = 0;

  // Retrieve evidence independently for each selected paper
  for (const paper of selectedPapers) {
    if (cumulativeChunks >= maxTotalChunks) {
      break;
    }

    const remainingGlobalQuota = maxTotalChunks - cumulativeChunks;
    const paperLimit = Math.min(chunksPerPaper, remainingGlobalQuota);

    const candidateLimit = Math.min(paperLimit * 4, 16);

    // STRICT PAPER-SCOPED QUERY with reference/bibliography exclusion:
    const rows: Array<{
      id: string;
      paperId: string;
      chunkIndex: number;
      section: string | null;
      pageNumber: number | null;
      text: string;
      similarity: number;
    }> = await prisma.$queryRaw`
      SELECT 
        c.id,
        c."paperId",
        c."chunkIndex",
        c.section,
        c."pageNumber",
        c.text,
        1 - (c.embedding <=> ${vectorString}::vector) AS similarity
      FROM "paper_chunks" c
      WHERE c."paperId" = ${paper.paperId}
        AND c.embedding IS NOT NULL
        AND (c.section IS NULL OR (
          c.section NOT ILIKE '%reference%' 
          AND c.section NOT ILIKE '%bibliography%' 
          AND c.section NOT ILIKE '%citation%'
        ))
      ORDER BY c.embedding <=> ${vectorString}::vector ASC
      LIMIT ${candidateLimit};
    `;

    // Filter out reference-like content and third-party literature reviews
    const nonRefRows = rows.filter(
      (r) => !isReferenceChunk(r.section, r.text) && !isThirdPartyLiteratureChunk(r.section, r.text)
    );

    // Distinguish empirical sections (Results, Discussion, Methods, Conclusion, Abstract)
    // from introductory background (Background, Introduction)
    const empiricalRows = nonRefRows.filter(
      (r) => r.section && /result|discussion|method|conclusion|abstract/i.test(r.section)
    );
    const backgroundRows = nonRefRows.filter(
      (r) => !r.section || /background|intro/i.test(r.section)
    );

    const selectedRows: typeof rows = [];

    // Prioritize empirical chunks that directly describe the study's own findings/methods
    if (empiricalRows.length > 0) {
      selectedRows.push(...empiricalRows.slice(0, paperLimit));
    }

    // Only if empirical rows were insufficient to reach paperLimit, allow background chunks for context
    const remainingSlots = paperLimit - selectedRows.length;
    if (remainingSlots > 0 && backgroundRows.length > 0) {
      selectedRows.push(...backgroundRows.slice(0, Math.min(remainingSlots, 1)));
    }

    // If still under quota, fill from any remaining non-reference chunks
    for (const r of nonRefRows) {
      if (selectedRows.length >= paperLimit) break;
      if (!selectedRows.some((s) => s.id === r.id)) {
        selectedRows.push(r);
      }
    }

    // Sort selected chunks descending by vector similarity
    selectedRows.sort((a, b) => b.similarity - a.similarity);

    const paperChunks: RetrievedEvidenceChunk[] = selectedRows.map((r, idx) => ({
      id: r.id,
      paperId: r.paperId,
      chunkIndex: r.chunkIndex,
      section: r.section,
      pageNumber: r.pageNumber,
      text: r.text,
      similarity: Number(r.similarity),
      semanticRank: idx + 1,
    }));

    evidenceSets.push({
      paperId: paper.paperId,
      paperTitle: paper.title,
      authors: paper.authors,
      publicationDate: paper.publicationDate,
      doi: paper.doi,
      journal: paper.journal,
      citationCount: paper.citationCount,
      chunks: paperChunks,
    });

    for (const c of paperChunks) {
      allChunks.push(c);
    }

    cumulativeChunks += paperChunks.length;
  }

  return {
    evidenceSets,
    totalChunks: allChunks.length,
    allChunks,
  };
}
