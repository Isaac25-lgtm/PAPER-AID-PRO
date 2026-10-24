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

  // Extract substantive query keywords (>= 3 chars, not common filler words)
  const stopwords = new Set([
    "what", "were", "with", "this", "that", "from", "have", "about", "which",
    "there", "for", "and", "the", "are", "was", "how", "did", "does", "been",
    "reported", "showed", "study", "paper"
  ]);

  const queryWords = cleanQuestion
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopwords.has(w));

  // Extract consecutive bigram phrases for multi-part clinical entities
  const queryPhrases: string[] = [];
  for (let i = 0; i < queryWords.length - 1; i++) {
    queryPhrases.push(`${queryWords[i]} ${queryWords[i + 1]}`);
  }

  // 4. MOCK EMBEDDING / UNINDEXED SAFETY (Task 4)
  // If genuine embeddings do NOT exist, execute multi-term lexical retrieval fallback with section scoring.
  // Never treat mock vector similarity as meaningful and never invoke paid embedding APIs.
  if (genuineCount === 0) {
    const candidates: Array<{
      id: string;
      paperId: string;
      chunkIndex: number;
      section: string | null;
      pageNumber: number | null;
      text: string;
    }> = await prisma.$queryRaw`
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
          c.section IS NULL OR (
            c.section NOT ILIKE '%reference%'
            AND c.section NOT ILIKE '%bibliography%'
            AND c.section NOT ILIKE '%citation%'
          )
        )
      ORDER BY c."chunkIndex" ASC;
    `;

    // Score candidates across all substantive query words, phrases, and sections
    const scored = candidates.map((c) => {
      let score = 0;
      const lowerText = c.text.toLowerCase();
      const lowerSec = (c.section || "").toLowerCase();

      // Bigram phrase matches (high precision for clinical entities)
      for (const phrase of queryPhrases) {
        if (lowerText.includes(phrase)) score += 3.0;
      }

      // Word matches and section title alignment
      for (const word of queryWords) {
        const stem = word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word;
        if (lowerText.includes(word) || lowerText.includes(stem)) score += 1.0;
        if (lowerSec.length > 0 && (lowerSec.includes(word) || lowerSec.includes(stem) || word.includes(lowerSec))) {
          score += 3.0;
        }
      }

      // Query-directed section alignment
      if (/limit/i.test(cleanQuestion) && /limit/i.test(lowerSec)) {
        score += 4.0;
      } else if (/method/i.test(cleanQuestion) && /method/i.test(lowerSec)) {
        score += 3.0;
      } else if (/result|finding/i.test(cleanQuestion) && /result|finding/i.test(lowerSec)) {
        score += 3.0;
      }

      // Baseline empirical section weight
      if (/result|abstract|conclusion/i.test(lowerSec)) {
        score += 1.0;
      } else if (/method/i.test(lowerSec)) {
        score += 0.5;
      }

      return { ...c, score };
    });

    let lexicalRows: Array<{
      id: string;
      paperId: string;
      chunkIndex: number;
      section: string | null;
      pageNumber: number | null;
      text: string;
    }> = [];

    const matchingChunks = scored.filter((s) => s.score > 0);
    if (matchingChunks.length > 0) {
      matchingChunks.sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex);
      lexicalRows = matchingChunks.slice(0, finalLimit);
    } else {
      lexicalRows = candidates.slice(0, finalLimit);
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
    const candidates: Array<{
      id: string;
      paperId: string;
      chunkIndex: number;
      section: string | null;
      pageNumber: number | null;
      text: string;
    }> = await prisma.$queryRaw`
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
          c.section IS NULL OR (
            c.section NOT ILIKE '%reference%'
            AND c.section NOT ILIKE '%bibliography%'
            AND c.section NOT ILIKE '%citation%'
          )
        )
      ORDER BY c."chunkIndex" ASC;
    `;

    const scored = candidates.map((c) => {
      let score = 0;
      const lowerText = c.text.toLowerCase();
      const lowerSec = (c.section || "").toLowerCase();

      // Bigram phrase matches (high precision for clinical entities)
      for (const phrase of queryPhrases) {
        if (lowerText.includes(phrase)) score += 3.0;
      }

      // Word matches and section title alignment
      for (const word of queryWords) {
        const stem = word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word;
        if (lowerText.includes(word) || lowerText.includes(stem)) score += 1.0;
        if (lowerSec.length > 0 && (lowerSec.includes(word) || lowerSec.includes(stem) || word.includes(lowerSec))) {
          score += 3.0;
        }
      }

      // Query-directed section alignment
      if (/limit/i.test(cleanQuestion) && /limit/i.test(lowerSec)) {
        score += 4.0;
      } else if (/method/i.test(cleanQuestion) && /method/i.test(lowerSec)) {
        score += 3.0;
      } else if (/result|finding/i.test(cleanQuestion) && /result|finding/i.test(lowerSec)) {
        score += 3.0;
      }

      // Baseline empirical section weight
      if (/result|abstract|conclusion/i.test(lowerSec)) {
        score += 1.0;
      } else if (/method/i.test(lowerSec)) {
        score += 0.5;
      }

      return { ...c, score };
    });

    const matchingChunks = scored.filter((s) => s.score > 0);
    if (matchingChunks.length > 0) {
      matchingChunks.sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex);
      lexicalRows = matchingChunks.slice(0, 10);
    } else {
      lexicalRows = candidates.slice(0, 10);
    }
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

