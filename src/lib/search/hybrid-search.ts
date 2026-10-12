import "server-only";
import { prisma } from "../prisma";
import { generateEmbedding } from "../ai/embeddings";
import { Paper } from "../types/paper";
import { ADMIN_TEST_FIXTURE_IDS } from "../auth/paper-authorization";

export interface MatchedEvidenceSnippet {
  chunkId: string;
  chunkIndex: number;
  section: string | null;
  pageNumber: number | null;
  text: string;
  similarity: number;
}

export interface RankedPaperResult {
  paper: Paper;
  rrfScore: number;
  lexicalRank: number | null;
  semanticRank: number | null;
  matchedSnippet?: MatchedEvidenceSnippet;
  matchType: "hybrid" | "exact" | "semantic" | "lexical";
}

export interface HybridSearchResult {
  papers: RankedPaperResult[];
  total: number;
  isFallback: boolean;
  query: string;
  executionTimeMs: number;
}

export interface SearchPapersOptions {
  query: string;
  categorySlug?: string;
  sort?: string;
  limit?: number;
  excludeFixtures?: boolean; // Defaults to true to hide admin test fixtures
}

// RRF constant k (standard information retrieval setting)
const RRF_K = 60;

/**
 * Truncates text snippet safely at word boundaries.
 */
function formatSnippet(text: string, maxLength: number = 280): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  const truncated = cleaned.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 50 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

/**
 * Executes hybrid search combining PostgreSQL lexical search and pgvector semantic retrieval.
 * Uses Reciprocal Rank Fusion (RRF) with exact-match priority boosts.
 * Automatically falls back to lexical search if OpenAI embeddings fail.
 */
export async function searchPapersHybrid(
  options: SearchPapersOptions
): Promise<HybridSearchResult> {
  const startTime = Date.now();
  const rawQuery = options.query?.trim() || "";
  const categorySlug = options.categorySlug?.trim() || "";
  const limit = Math.min(Math.max(options.limit || 20, 1), 50);
  const excludeFixtures = options.excludeFixtures !== false;

  // If query is empty, return default listing sorted by citationCount or requested sort
  if (!rawQuery) {
    return browsePapers({ categorySlug, sort: options.sort, limit, excludeFixtures });
  }

  // Guard against overly long queries
  const safeQuery = rawQuery.slice(0, 500);

  // 1. Execute Lexical Retrieval (PostgreSQL)
  const lexicalPapers = await fetchLexicalCandidates(safeQuery, categorySlug, excludeFixtures);

  // 2. Execute Semantic Retrieval (OpenAI Embeddings + pgvector Cosine Search)
  let semanticCandidates: Map<string, { rank: number; snippet: MatchedEvidenceSnippet }> = new Map();
  let isFallback = false;

  try {
    const queryVector = await generateEmbedding(safeQuery);
    semanticCandidates = await fetchSemanticCandidates(queryVector, categorySlug, excludeFixtures);
  } catch (embeddingError: any) {
    console.warn(
      "[HybridSearch] Embedding generation failed. Falling back gracefully to lexical search:",
      embeddingError?.message || String(embeddingError)
    );
    isFallback = true;
  }

  // 3. Reciprocal Rank Fusion (RRF) & Exact Match Priority
  const paperScores = new Map<
    string,
    {
      paper: any;
      rrfScore: number;
      lexicalRank: number | null;
      semanticRank: number | null;
      matchedSnippet?: MatchedEvidenceSnippet;
      matchType: "hybrid" | "exact" | "semantic" | "lexical";
    }
  >();

  const lowerQuery = safeQuery.toLowerCase();
  const normalizedQueryDoi = lowerQuery.replace(/^doi:\s*/i, "").trim();

  // Process Lexical Results
  for (let i = 0; i < lexicalPapers.length; i++) {
    const paper = lexicalPapers[i];
    const rank = i + 1; // 1-based rank
    const lexicalScore = 1.0 / (RRF_K + rank);

    // Exact Match Boosts
    let exactBoost = 0;
    let isExact = false;

    if (paper.doi && paper.doi.toLowerCase().includes(normalizedQueryDoi)) {
      exactBoost += 100.0; // Absolute top priority for DOI match
      isExact = true;
    } else if (paper.title.toLowerCase() === lowerQuery) {
      exactBoost += 10.0; // Very high priority for exact title
      isExact = true;
    } else if (
      paper.authors.some((pa: any) => pa.author.name.toLowerCase() === lowerQuery)
    ) {
      exactBoost += 2.0; // Author match boost
      isExact = true;
    }

    paperScores.set(paper.id, {
      paper,
      rrfScore: lexicalScore + exactBoost,
      lexicalRank: rank,
      semanticRank: null,
      matchType: isExact ? "exact" : "lexical",
    });
  }

  // Fetch full paper records for any semantic-only candidates
  const semanticOnlyIds = Array.from(semanticCandidates.keys()).filter(
    (id) => !paperScores.has(id)
  );

  let semanticOnlyPapers: any[] = [];
  if (semanticOnlyIds.length > 0) {
    semanticOnlyPapers = await prisma.paper.findMany({
      where: { id: { in: semanticOnlyIds } },
      include: {
        authors: {
          include: { author: true },
          orderBy: { orderIndex: "asc" },
        },
        categories: {
          include: { category: true },
        },
        aiSummary: true,
      },
    });
  }

  const allPaperLookup = new Map<string, any>();
  for (const p of lexicalPapers) allPaperLookup.set(p.id, p);
  for (const p of semanticOnlyPapers) allPaperLookup.set(p.id, p);

  // Fuse Semantic Results
  semanticCandidates.forEach((semData, paperId) => {
    const semanticScore = 1.0 / (RRF_K + semData.rank);
    const existing = paperScores.get(paperId);

    if (existing) {
      existing.rrfScore += semanticScore;
      existing.semanticRank = semData.rank;
      existing.matchedSnippet = semData.snippet;
      if (existing.matchType !== "exact") {
        existing.matchType = "hybrid";
      }
    } else {
      const paperRecord = allPaperLookup.get(paperId);
      if (paperRecord) {
        paperScores.set(paperId, {
          paper: paperRecord,
          rrfScore: semanticScore,
          lexicalRank: null,
          semanticRank: semData.rank,
          matchedSnippet: semData.snippet,
          matchType: "semantic",
        });
      }
    }
  });

  // Sort by combined RRF score descending
  const sortedResults = Array.from(paperScores.values()).sort(
    (a, b) => b.rrfScore - a.rrfScore
  );

  // Map to domain Paper format and apply limit
  const finalPapers: RankedPaperResult[] = sortedResults
    .slice(0, limit)
    .map((item) => ({
      paper: formatToDomainPaper(item.paper),
      rrfScore: item.rrfScore,
      lexicalRank: item.lexicalRank,
      semanticRank: item.semanticRank,
      matchedSnippet: item.matchedSnippet,
      matchType: item.matchType,
    }));

  return {
    papers: finalPapers,
    total: sortedResults.length,
    isFallback,
    query: safeQuery,
    executionTimeMs: Date.now() - startTime,
  };
}

/**
 * Fetch lexical candidates using PostgreSQL text search across title, abstract, DOI, keywords, and author names.
 */
async function fetchLexicalCandidates(
  query: string,
  categorySlug?: string,
  excludeFixtures: boolean = true
): Promise<any[]> {
  const where: any = {
    OR: [
      { title: { contains: query, mode: "insensitive" } },
      { abstract: { contains: query, mode: "insensitive" } },
      { doi: { contains: query, mode: "insensitive" } },
      { keywords: { has: query } },
      {
        authors: {
          some: {
            author: {
              name: { contains: query, mode: "insensitive" },
            },
          },
        },
      },
    ],
  };

  if (excludeFixtures) {
    where.id = { notIn: Array.from(ADMIN_TEST_FIXTURE_IDS) };
    where.storagePath = null;
  }

  if (categorySlug) {
    where.categories = {
      some: {
        category: {
          slug: categorySlug,
        },
      },
    };
  }

  return prisma.paper.findMany({
    where,
    include: {
      authors: {
        include: { author: true },
        orderBy: { orderIndex: "asc" },
      },
      categories: {
        include: { category: true },
      },
      aiSummary: true,
    },
    orderBy: [{ citationCount: "desc" }, { createdAt: "desc" }],
    take: 50,
  });
}

/**
 * Fetch semantic candidates using pgvector cosine similarity (<=>).
 * Groups chunks by paperId to select the single best matching chunk per paper.
 */
async function fetchSemanticCandidates(
  queryVector: number[],
  categorySlug?: string,
  excludeFixtures: boolean = true
): Promise<Map<string, { rank: number; snippet: MatchedEvidenceSnippet }>> {
  const vectorString = `[${queryVector.join(",")}]`;

  // Raw parameterized SQL query on pgvector
  let rawChunks: Array<{
    chunkId: string;
    paperId: string;
    chunkIndex: number;
    section: string | null;
    pageNumber: number | null;
    chunkText: string;
    similarity: number;
  }> = [];

  if (categorySlug) {
    rawChunks = await prisma.$queryRaw`
      SELECT 
        c.id AS "chunkId",
        c."paperId",
        c."chunkIndex",
        c.section,
        c."pageNumber",
        c.text AS "chunkText",
        1 - (c.embedding <=> ${vectorString}::vector) AS similarity
      FROM "paper_chunks" c
      JOIN "papers" p ON c."paperId" = p.id
      JOIN "paper_categories" pc ON p.id = pc."paperId"
      JOIN "categories" cat ON pc."categoryId" = cat.id
      WHERE c.embedding IS NOT NULL
        AND cat.slug = ${categorySlug}
      ORDER BY c.embedding <=> ${vectorString}::vector ASC
      LIMIT 50;
    `;
  } else {
    rawChunks = await prisma.$queryRaw`
      SELECT 
        c.id AS "chunkId",
        c."paperId",
        c."chunkIndex",
        c.section,
        c."pageNumber",
        c.text AS "chunkText",
        1 - (c.embedding <=> ${vectorString}::vector) AS similarity
      FROM "paper_chunks" c
      JOIN "papers" p ON c."paperId" = p.id
      WHERE c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${vectorString}::vector ASC
      LIMIT 50;
    `;
  }

  // Deduplicate at paper level, keeping the chunk with highest similarity
  const paperBestChunk = new Map<
    string,
    {
      similarity: number;
      snippet: MatchedEvidenceSnippet;
    }
  >();

  for (const row of rawChunks) {
    const existing = paperBestChunk.get(row.paperId);
    if (!existing || row.similarity > existing.similarity) {
      paperBestChunk.set(row.paperId, {
        similarity: row.similarity,
        snippet: {
          chunkId: row.chunkId,
          chunkIndex: row.chunkIndex,
          section: row.section,
          pageNumber: row.pageNumber,
          text: formatSnippet(row.chunkText),
          similarity: Number(row.similarity),
        },
      });
    }
  }

  // Rank deduplicated papers by best chunk similarity descending
  let sortedPaperEntries = Array.from(paperBestChunk.entries()).sort(
    (a, b) => b[1].similarity - a[1].similarity
  );

  // Security Access Control: Exclude administrator test fixtures
  if (excludeFixtures) {
    sortedPaperEntries = sortedPaperEntries.filter(
      ([paperId]) => !ADMIN_TEST_FIXTURE_IDS.has(paperId)
    );
  }

  const semanticRanking = new Map<string, { rank: number; snippet: MatchedEvidenceSnippet }>();
  sortedPaperEntries.forEach(([paperId, data], idx) => {
    semanticRanking.set(paperId, {
      rank: idx + 1,
      snippet: data.snippet,
    });
  });

  return semanticRanking;
}

/**
 * Fallback / default browse when query is empty.
 */
async function browsePapers(options: {
  categorySlug?: string;
  sort?: string;
  limit: number;
  excludeFixtures?: boolean;
}): Promise<HybridSearchResult> {
  const startTime = Date.now();
  const where: any = {};

  if (options.excludeFixtures !== false) {
    where.id = { notIn: Array.from(ADMIN_TEST_FIXTURE_IDS) };
    where.storagePath = null;
  }

  if (options.categorySlug) {
    where.categories = {
      some: {
        category: {
          slug: options.categorySlug,
        },
      },
    };
  }

  let orderBy: any = [{ citationCount: "desc" }, { createdAt: "desc" }];
  if (options.sort === "newest") {
    orderBy = [{ publicationDate: "desc" }, { createdAt: "desc" }];
  } else if (options.sort === "oldest") {
    orderBy = [{ publicationDate: "asc" }, { createdAt: "desc" }];
  } else if (options.sort === "title") {
    orderBy = [{ title: "asc" }];
  }

  const dbPapers = await prisma.paper.findMany({
    where,
    include: {
      authors: {
        include: { author: true },
        orderBy: { orderIndex: "asc" },
      },
      categories: {
        include: { category: true },
      },
      aiSummary: true,
    },
    orderBy,
    take: options.limit,
  });

  const papers: RankedPaperResult[] = dbPapers.map((p, idx) => ({
    paper: formatToDomainPaper(p),
    rrfScore: 1.0 / (RRF_K + idx + 1),
    lexicalRank: idx + 1,
    semanticRank: null,
    matchType: "lexical",
  }));

  return {
    papers,
    total: dbPapers.length,
    isFallback: false,
    query: "",
    executionTimeMs: Date.now() - startTime,
  };
}

/**
 * Formats a Prisma Paper record into the shared Domain Paper model.
 */
function formatToDomainPaper(p: any): Paper {
  return {
    id: p.id,
    title: p.title,
    abstract: p.abstract,
    publicationDate: p.publicationDate?.toISOString() || new Date().toISOString(),
    journal: p.journal || "Research Manuscript",
    doi: p.doi || undefined,
    pdfUrl: p.pdfUrl || undefined,
    storagePath: p.storagePath || undefined,
    status: p.status,
    researchQuestion: p.researchQuestion || undefined,
    methodology: p.methodology || undefined,
    results: p.results || undefined,
    limitations: p.limitations || undefined,
    conclusion: p.conclusion || undefined,
    keywords: p.keywords || [],
    citationCount: p.citationCount || 0,
    aiSummary: p.aiSummary
      ? {
          id: p.aiSummary.id,
          paperId: p.aiSummary.paperId,
          summary: p.aiSummary.summary,
          keyFindings: p.aiSummary.keyFindings,
          methodologySummary: p.aiSummary.methodologySummary || undefined,
          limitations: p.aiSummary.limitations || undefined,
          conclusion: p.aiSummary.conclusion || undefined,
          modelUsed: p.aiSummary.modelUsed,
          createdAt: p.aiSummary.createdAt.toISOString(),
        }
      : null,
    authors: p.authors.map((pa: any) => ({
      id: pa.author.id,
      name: pa.author.name,
      institution: pa.author.institution || undefined,
    })),
    categories: p.categories.map((pc: any) => ({
      id: pc.category.id,
      name: pc.category.name,
    })),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
