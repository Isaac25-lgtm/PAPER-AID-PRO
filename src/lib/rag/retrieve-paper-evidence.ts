import "server-only";
import { prisma } from "../prisma";
import { generateEmbedding } from "../ai/embeddings";
import { RetrievedEvidenceChunk, EvidenceType, RetrievalMethod, PermissionScope } from "./types";
import { authorizePaperAccess, UserContext, classifyPaper } from "../auth/paper-authorization";
import { createHash } from "crypto";

export interface RetrievePaperEvidenceOptions {
  limit?: number; // Final fused evidence count (default: 8, max: 12)
  user?: UserContext | null; // User context for authorization
  allowAbstractFallback?: boolean; // Defaults to true
}

export interface RetrievedPaperEvidenceResult {
  paperTitle: string;
  evidenceChunks: RetrievedEvidenceChunk[];
  totalAvailableChunks: number;
  evidenceType: EvidenceType;
  retrievalMethod: RetrievalMethod;
  insufficientEvidence: boolean;
  isMockEmbeddingFallback: boolean;
}

const RRF_K = 60;

/**
 * Retrieves relevant manuscript evidence strictly scoped to a single paper.
 * 
 * Guarantees:
 * 1. Filtering by paperId occurs strictly inside PostgreSQL queries.
 * 2. Abstract Fallback: When full-text chunks are not present, securely provides
 *    explicitly labeled ABSTRACT evidence without fabricating unrecorded sections.
 * 3. Mock Embedding Safety: When only mock-sha256 or unindexed chunks exist, falls back
 *    to lexical retrieval and never treats pseudo-vector similarity as meaningful.
 * 4. Genuine Semantic Retrieval: When true semantic embeddings exist, executes pgvector <=>
 *    cosine distance combined with lexical search via Reciprocal Rank Fusion (RRF).
 * 5. Evidence Provenance: Tags every chunk with evidenceType, pageNumber (or null), section,
 *    sourceTitle, DOI, and permissionScope.
 * 6. Access Control: Evaluates authorizePaperAccess before retrieving any evidence.
 */
export async function retrievePaperEvidence(
  paperId: string,
  question: string,
  options: RetrievePaperEvidenceOptions = {}
): Promise<RetrievedPaperEvidenceResult> {
  const finalLimit = Math.min(Math.max(options.limit || 8, 1), 12);
  const cleanQuestion = question.trim().slice(0, 500);

  // 1. Verify Paper exists, check authorization, and determine permission scope
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: {
      id: true,
      title: true,
      abstract: true,
      storagePath: true,
      pdfUrl: true,
      isOpenAccess: true,
      sourceProvenance: true,
      doi: true,
      arxivId: true,
      pmid: true,
      pmcid: true,
      semanticScholarId: true,
      _count: {
        select: { chunks: true },
      },
    },
  });

  if (!paper) {
    throw new Error(`Paper with ID "${paperId}" not found in database.`);
  }

  // Security Access Control Check
  const auth = await authorizePaperAccess(paper, options.user, "VIEW_EVIDENCE");
  if (!auth.allowed) {
    throw new Error(`Unauthorized: Access to document evidence for paper "${paper.title}" is restricted.`);
  }

  const classification = classifyPaper(paper);
  const permissionScope: PermissionScope =
    classification === "PRIVATE_USER_DOCUMENT"
      ? "PRIVATE_USER"
      : classification === "ADMIN_TEST_FIXTURE" || classification === "AMBIGUOUS_HISTORICAL"
      ? "RESTRICTED"
      : (paper.isOpenAccess ? "PUBLIC_OPEN_ACCESS" : "PUBLIC_METADATA_ONLY");

  // 2. ABSTRACT-ONLY EVIDENCE FALLBACK
  // When no full-text chunks have been ingested (e.g. metadata-only catalog entry)
  if (paper._count.chunks === 0) {
    const rawAbstract = paper.abstract?.trim() || "";
    if (rawAbstract.length > 0 && options.allowAbstractFallback !== false) {
      const hash = createHash("sha256").update(rawAbstract).digest("hex");
      const abstractChunk: RetrievedEvidenceChunk = {
        id: `abstract-${paper.id}`,
        paperId: paper.id,
        chunkIndex: 0,
        section: "Abstract",
        pageNumber: null, // Null accurately, never synthetic
        text: rawAbstract,
        evidenceType: "ABSTRACT",
        sourceTitle: paper.title,
        doi: paper.doi,
        retrievalMethod: "ABSTRACT_FALLBACK",
        permissionScope,
        contentChecksum: hash,
        isMockEmbedding: false,
      };

      return {
        paperTitle: paper.title,
        evidenceChunks: [abstractChunk],
        totalAvailableChunks: 0,
        evidenceType: "ABSTRACT",
        retrievalMethod: "ABSTRACT_FALLBACK",
        insufficientEvidence: false,
        isMockEmbeddingFallback: false,
      };
    }

    // Neither full-text chunks nor abstract exist
    return {
      paperTitle: paper.title,
      evidenceChunks: [],
      totalAvailableChunks: 0,
      evidenceType: "ABSTRACT",
      retrievalMethod: "ABSTRACT_FALLBACK",
      insufficientEvidence: true,
      isMockEmbeddingFallback: false,
    };
  }

  // 3. FULL-TEXT RETRIEVAL: Inspect embedding state
  const embeddingStats: Array<{
    genuineCount: bigint;
    mockCount: bigint;
    totalEmbedded: bigint;
  }> = await prisma.$queryRaw`
    SELECT 
      COUNT(*) FILTER (WHERE embedding IS NOT NULL AND ("embeddingModel" IS NULL OR "embeddingModel" != 'mock-sha256')) as "genuineCount",
      COUNT(*) FILTER (WHERE "embeddingModel" = 'mock-sha256') as "mockCount",
      COUNT(*) FILTER (WHERE embedding IS NOT NULL) as "totalEmbedded"
    FROM "paper_chunks"
    WHERE "paperId" = ${paperId};
  `;

  const genuineCount = Number(embeddingStats[0]?.genuineCount ?? 0);
  const mockCount = Number(embeddingStats[0]?.mockCount ?? 0);

  // Extract query keywords for lexical matching (>= 3 chars, not stopwords)
  const queryWords = cleanQuestion
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !["what", "were", "with", "this", "that", "from", "have", "about", "which", "there"].includes(w));

  // 4. MOCK EMBEDDING / UNINDEXED SAFETY (Task 4)
  // If genuine embeddings do NOT exist, execute pure lexical/text-based retrieval fallback.
  // Never treat mock vector similarity as meaningful and never invoke paid embedding APIs.
  if (genuineCount === 0) {
    let lexicalRows: Array<{
      id: string;
      paperId: string;
      chunkIndex: number;
      section: string | null;
      pageNumber: number | null;
      text: string;
    }> = [];

    if (queryWords.length > 0) {
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
        ORDER BY c."chunkIndex" ASC
        LIMIT ${finalLimit};
      `;
    }

    // If keyword matching yielded zero rows or question had no keywords, fetch initial sequence chunks
    if (lexicalRows.length === 0) {
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
        ORDER BY c."chunkIndex" ASC
        LIMIT ${finalLimit};
      `;
    }

    const lexicalChunks: RetrievedEvidenceChunk[] = lexicalRows.map((row, idx) => ({
      id: row.id,
      paperId: row.paperId,
      chunkIndex: row.chunkIndex,
      section: row.section,
      pageNumber: row.pageNumber, // Accurate page number, null if unrecorded
      text: row.text,
      evidenceType: "FULL_TEXT",
      sourceTitle: paper.title,
      doi: paper.doi,
      retrievalMethod: "LEXICAL",
      permissionScope,
      contentChecksum: createHash("sha256").update(row.text).digest("hex"),
      isMockEmbedding: mockCount > 0,
      lexicalRank: idx + 1,
      semanticRank: null,
      rrfScore: 1.0 / (RRF_K + (idx + 1)),
    }));

    return {
      paperTitle: paper.title,
      evidenceChunks: lexicalChunks,
      totalAvailableChunks: paper._count.chunks,
      evidenceType: "FULL_TEXT",
      retrievalMethod: "LEXICAL",
      insufficientEvidence: lexicalChunks.length === 0,
      isMockEmbeddingFallback: true,
    };
  }

  // 5. GENUINE SEMANTIC + LEXICAL RETRIEVAL (pgvector <=> operator + RRF)
  const queryVector = await generateEmbedding(cleanQuestion);
  const vectorString = `[${queryVector.join(",")}]`;

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
      AND (c."embeddingModel" IS NULL OR c."embeddingModel" != 'mock-sha256')
    ORDER BY c.embedding <=> ${vectorString}::vector ASC
    LIMIT 10;
  `;

  let lexicalRows: Array<{
    id: string;
    paperId: string;
    chunkIndex: number;
    section: string | null;
    pageNumber: number | null;
    text: string;
  }> = [];

  if (queryWords.length > 0) {
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

  // Reciprocal Rank Fusion (RRF)
  const candidateScores = new Map<
    string,
    {
      chunk: RetrievedEvidenceChunk;
      semanticRank: number | null;
      lexicalRank: number | null;
      rrfScore: number;
    }
  >();

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
        evidenceType: "FULL_TEXT",
        sourceTitle: paper.title,
        doi: paper.doi,
        retrievalMethod: "HYBRID_RRF",
        permissionScope,
        contentChecksum: createHash("sha256").update(row.text).digest("hex"),
        isMockEmbedding: false,
        similarity: row.similarity,
        semanticRank: rank,
        lexicalRank: null,
      },
      semanticRank: rank,
      lexicalRank: null,
      rrfScore: score,
    });
  });

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
          evidenceType: "FULL_TEXT",
          sourceTitle: paper.title,
          doi: paper.doi,
          retrievalMethod: "HYBRID_RRF",
          permissionScope,
          contentChecksum: createHash("sha256").update(row.text).digest("hex"),
          isMockEmbedding: false,
          semanticRank: null,
          lexicalRank: rank,
        },
        semanticRank: null,
        lexicalRank: rank,
        rrfScore: score,
      });
    }
  });

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
    evidenceType: "FULL_TEXT",
    retrievalMethod: "HYBRID_RRF",
    insufficientEvidence: sortedChunks.length === 0,
    isMockEmbeddingFallback: false,
  };
}

