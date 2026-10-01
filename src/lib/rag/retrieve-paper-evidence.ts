import "server-only";
import { prisma } from "../prisma";
import { generateEmbedding } from "../ai/embeddings";
import { RetrievedEvidenceChunk } from "./types";

export interface RetrievePaperEvidenceOptions {
  limit?: number; // Final fused evidence count (default: 8, max: 12)
}

const RRF_K = 60;

/**
 * Retrieves relevant manuscript chunks strictly scoped to a single paper.
 * 
 * Guarantees:
 * 1. Filtering by paperId occurs strictly inside the PostgreSQL queries.
 * 2. Semantic vector cosine similarity (pgvector <=> operator).
 * 3. In-paper lexical keyword search (ILIKE on chunk text and section).
 * 4. Deterministic Reciprocal Rank Fusion (RRF) combining semantic + lexical ranks.
 * 5. Returns only verified PaperChunk records belonging to the requested paperId.
 */
export async function retrievePaperEvidence(
  paperId: string,
  question: string,
  options: RetrievePaperEvidenceOptions = {}
): Promise<{
  paperTitle: string;
  evidenceChunks: RetrievedEvidenceChunk[];
  totalAvailableChunks: number;
}> {
  const finalLimit = Math.min(Math.max(options.limit || 8, 1), 12);
  const cleanQuestion = question.trim().slice(0, 500);

  // 1. Verify Paper exists and check chunk readiness
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: {
      id: true,
      title: true,
      _count: {
        select: { chunks: true },
      },
    },
  });

  if (!paper) {
    throw new Error(`Paper with ID "${paperId}" not found in database.`);
  }

  if (paper._count.chunks === 0) {
    throw new Error("Paper text has not been processed yet.");
  }

  // Check embedded chunk count for this paper
  const embeddedResult: Array<{ count: bigint }> = await prisma.$queryRaw`
    SELECT COUNT(*) as count
    FROM "paper_chunks"
    WHERE "paperId" = ${paperId} AND "embedding" IS NOT NULL;
  `;
  const embeddedCount = Number(embeddedResult[0]?.count ?? 0);

  if (embeddedCount === 0) {
    throw new Error("This paper is not ready for research Q&A yet.");
  }

  // 2. Generate Query Vector Embedding
  const queryVector = await generateEmbedding(cleanQuestion);
  const vectorString = `[${queryVector.join(",")}]`;

  // 3. Execute Paper-Scoped Semantic Retrieval (pgvector cosine distance)
  // STRICT FILTER: WHERE "paperId" = ${paperId} in the SQL query itself
  const semanticRows: Array<{
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
    WHERE c."paperId" = ${paperId}
      AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${vectorString}::vector ASC
    LIMIT 10;
  `;

  // 4. Execute Paper-Scoped Lexical Retrieval (terms from question)
  // Extract informative search terms (min 3 chars, alphanumeric)
  const queryWords = cleanQuestion
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !["what", "were", "with", "this", "that", "from", "have", "about"].includes(w));

  let lexicalRows: Array<{
    id: string;
    paperId: string;
    chunkIndex: number;
    section: string | null;
    pageNumber: number | null;
    text: string;
  }> = [];

  if (queryWords.length > 0) {
    // Pick the most distinctive keywords or contiguous phrase for substring search
    const primaryTerm = queryWords.slice(0, 3).join(" ");
    const singleTerm = queryWords[0];

    lexicalRows = await prisma.$queryRaw`
      SELECT 
        c.id,
        c."paperId",
        c."chunkIndex",
        c.section,
        c."pageNumber",
        c.text
      FROM "paper_chunks" c
      WHERE c."paperId" = ${paperId}
        AND (
          c.text ILIKE ${'%' + primaryTerm + '%'}
          OR c.text ILIKE ${'%' + singleTerm + '%'}
          OR c.section ILIKE ${'%' + singleTerm + '%'}
        )
      LIMIT 10;
    `;
  }

  // 5. Deterministic Reciprocal Rank Fusion (RRF) within the single paper
  const candidateScores = new Map<
    string,
    {
      chunk: RetrievedEvidenceChunk;
      semanticRank: number | null;
      lexicalRank: number | null;
      rrfScore: number;
    }
  >();

  // Process semantic candidates
  semanticRows.forEach((row, idx) => {
    const rank = idx + 1;
    const score = 1.0 / (RRF_K + rank);
    candidateScores.set(row.id, {
      chunk: {
        id: row.id,
        paperId: row.paperId,
        chunkIndex: row.chunkIndex,
        section: row.section,
        pageNumber: row.pageNumber,
        text: row.text,
        similarity: row.similarity,
        semanticRank: rank,
        lexicalRank: null,
      },
      semanticRank: rank,
      lexicalRank: null,
      rrfScore: score,
    });
  });

  // Process lexical candidates
  lexicalRows.forEach((row, idx) => {
    const rank = idx + 1;
    const score = 1.0 / (RRF_K + rank);
    const existing = candidateScores.get(row.id);
    if (existing) {
      existing.rrfScore += score;
      existing.lexicalRank = rank;
      existing.chunk.lexicalRank = rank;
    } else {
      candidateScores.set(row.id, {
        chunk: {
          id: row.id,
          paperId: row.paperId,
          chunkIndex: row.chunkIndex,
          section: row.section,
          pageNumber: row.pageNumber,
          text: row.text,
          semanticRank: null,
          lexicalRank: rank,
        },
        semanticRank: null,
        lexicalRank: rank,
        rrfScore: score,
      });
    }
  });

  // Sort by combined RRF score descending
  const sortedChunks: RetrievedEvidenceChunk[] = Array.from(candidateScores.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, finalLimit)
    .map((item) => ({
      ...item.chunk,
      rrfScore: item.rrfScore,
    }));

  return {
    paperTitle: paper.title,
    evidenceChunks: sortedChunks,
    totalAvailableChunks: paper._count.chunks,
  };
}
