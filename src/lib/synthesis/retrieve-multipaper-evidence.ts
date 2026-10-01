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

    // STRICT PAPER-SCOPED QUERY:
    // WHERE c."paperId" = ${paper.paperId} AND c.embedding IS NOT NULL
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
      ORDER BY c.embedding <=> ${vectorString}::vector ASC
      LIMIT ${paperLimit};
    `;

    const paperChunks: RetrievedEvidenceChunk[] = rows.map((r, idx) => ({
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
