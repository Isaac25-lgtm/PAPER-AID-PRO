import "server-only";
import { prisma } from "../prisma";
import { generateEmbedding } from "../ai/embeddings";
import { DiscoveredPaper } from "./types";

export interface DiscoverPapersOptions {
  candidateLimit?: number; // Maximum candidate papers to discover (default: 20)
  maxSelected?: number;    // Top papers to select for synthesis (default: 5)
  minSimilarity?: number;  // Minimum cosine similarity threshold (default: 0.25)
  categorySlug?: string;
  precomputedVector?: number[];
}

export const DEFAULT_CANDIDATE_LIMIT = 20;
export const DEFAULT_MAX_SELECTED_PAPERS = 5;
export const MIN_RELEVANCE_SIMILARITY = 0.25;

/**
 * Discovers and ranks relevant papers from the library for a given research question.
 * 
 * Aggregation Policy (Anti-Dominance):
 * Instead of summing chunk similarities (which biases toward long manuscripts),
 * paper relevance is computed from the average of its top 2 highest-scoring chunks
 * plus an exact title/DOI lexical boost when applicable.
 */
export async function discoverRelevantPapers(
  question: string,
  options: DiscoverPapersOptions = {}
): Promise<{
  candidatePapers: DiscoveredPaper[];
  selectedPapers: DiscoveredPaper[];
  queryVector: number[];
  executionTimeMs: number;
}> {
  const startTime = Date.now();
  const cleanQuestion = question.trim().slice(0, 500);
  const candidateLimit = options.candidateLimit || DEFAULT_CANDIDATE_LIMIT;
  const maxSelected = options.maxSelected || DEFAULT_MAX_SELECTED_PAPERS;
  const minSimilarity = options.minSimilarity ?? MIN_RELEVANCE_SIMILARITY;

  // 1. Generate or reuse query embedding (reused across discovery & per-paper retrieval)
  const queryVector = options.precomputedVector || (await generateEmbedding(cleanQuestion));
  const vectorString = `[${queryVector.join(",")}]`;

  // 2. Query top matching chunks across the entire library with pgvector
  // Fetch up to 80 chunks to discover papers broadly
  const chunkRows: Array<{
    chunkId: string;
    paperId: string;
    chunkIndex: number;
    section: string | null;
    pageNumber: number | null;
    chunkText: string;
    similarity: number;
    paperTitle: string;
    doi: string | null;
    publicationDate: Date | null;
    journal: string | null;
    citationCount: number;
  }> = await prisma.$queryRaw`
    SELECT 
      c.id AS "chunkId",
      c."paperId",
      c."chunkIndex",
      c.section,
      c."pageNumber",
      c.text AS "chunkText",
      1 - (c.embedding <=> ${vectorString}::vector) AS similarity,
      p.title AS "paperTitle",
      p.doi,
      p."publicationDate",
      p.journal,
      p."citationCount"
    FROM "paper_chunks" c
    JOIN "papers" p ON c."paperId" = p.id
    WHERE c.embedding IS NOT NULL
      AND p.status = 'COMPLETED'
      AND (c.section IS NULL OR (
        c.section NOT ILIKE '%reference%' 
        AND c.section NOT ILIKE '%bibliography%'
        AND c.section NOT ILIKE '%citation%'
      ))
    ORDER BY c.embedding <=> ${vectorString}::vector ASC
    LIMIT 250;
  `;

  // 3. Aggregate chunks by paper ID
  interface PaperAggregate {
    paperId: string;
    title: string;
    doi: string | null;
    publicationDate: string | null;
    journal: string | null;
    citationCount: number;
    chunkSimilarities: number[];
    bestChunk: {
      similarity: number;
      snippet: string;
      page: number | null;
      section: string | null;
    };
  }

  const paperMap = new Map<string, PaperAggregate>();

  for (const row of chunkRows) {
    const sim = Number(row.similarity);
    let agg = paperMap.get(row.paperId);

    if (!agg) {
      agg = {
        paperId: row.paperId,
        title: row.paperTitle,
        doi: row.doi,
        publicationDate: row.publicationDate ? row.publicationDate.toISOString() : null,
        journal: row.journal,
        citationCount: row.citationCount,
        chunkSimilarities: [],
        bestChunk: {
          similarity: sim,
          snippet: row.chunkText.slice(0, 200).replace(/\s+/g, " ").trim() + "...",
          page: row.pageNumber,
          section: row.section,
        },
      };
      paperMap.set(row.paperId, agg);
    }

    agg.chunkSimilarities.push(sim);
    if (sim > agg.bestChunk.similarity) {
      agg.bestChunk = {
        similarity: sim,
        snippet: row.chunkText.slice(0, 200).replace(/\s+/g, " ").trim() + "...",
        page: row.pageNumber,
        section: row.section,
      };
    }
  }

  // Also perform lexical check on title/DOI for exact user mentions
  const lowerQuery = cleanQuestion.toLowerCase();
  const lexicalPapers = await prisma.paper.findMany({
    where: {
      status: "COMPLETED",
      OR: [
        { title: { contains: cleanQuestion.slice(0, 80), mode: "insensitive" } },
        { doi: { contains: cleanQuestion.replace(/^doi:\s*/i, "").trim().slice(0, 50), mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      title: true,
      doi: true,
      publicationDate: true,
      journal: true,
      citationCount: true,
    },
    take: 10,
  });

  for (const lp of lexicalPapers) {
    if (!paperMap.has(lp.id)) {
      paperMap.set(lp.id, {
        paperId: lp.id,
        title: lp.title,
        doi: lp.doi,
        publicationDate: lp.publicationDate ? lp.publicationDate.toISOString() : null,
        journal: lp.journal,
        citationCount: lp.citationCount,
        chunkSimilarities: [0.3], // baseline lexical discovery
        bestChunk: {
          similarity: 0.3,
          snippet: "Discovered via direct lexical title/DOI match.",
          page: null,
          section: "Title Match",
        },
      });
    }
  }

  // 4. Fetch authors for all discovered papers
  const paperIds = Array.from(paperMap.keys());
  const authorsByPaper = new Map<string, string[]>();

  if (paperIds.length > 0) {
    const authors = await prisma.paperAuthor.findMany({
      where: { paperId: { in: paperIds } },
      include: { author: { select: { name: true } } },
      orderBy: { orderIndex: "asc" },
    });

    for (const pa of authors) {
      const existing = authorsByPaper.get(pa.paperId) || [];
      existing.push(pa.author.name);
      authorsByPaper.set(pa.paperId, existing);
    }
  }

  // 5. Score papers using Anti-Dominance Aggregation
  // Score = average of top 2 chunk similarities (or single best chunk if only 1)
  // + lexical boost if exact title/DOI match
  const rankedCandidates: DiscoveredPaper[] = Array.from(paperMap.values()).map((agg) => {
    // Sort similarities descending
    const sortedSims = [...agg.chunkSimilarities].sort((a, b) => b - a);
    const topN = sortedSims.slice(0, 2);
    const avgTopSim = topN.reduce((acc, v) => acc + v, 0) / topN.length;

    let score = avgTopSim;

    // Lexical boosts for exact title/DOI matches
    if (agg.doi && lowerQuery.includes(agg.doi.toLowerCase())) {
      score += 0.5;
    } else if (lowerQuery.includes(agg.title.toLowerCase())) {
      score += 0.3;
    }

    // Specific clinical/anatomical domain alignment
    // When the query explicitly targets a anatomical/disease domain (e.g. "breast"),
    // papers with that explicit domain in their title receive an alignment boost
    const targetDomains = ["breast", "skin", "liver", "thyroid", "lymph", "spine", "cervical", "lung", "brain", "prostate", "retina"];
    const matchedDomains = targetDomains.filter((d) => lowerQuery.includes(d));
    if (matchedDomains.length > 0) {
      const lowerTitle = agg.title.toLowerCase();
      const titleMatchesTarget = matchedDomains.some((d) => lowerTitle.includes(d));
      if (titleMatchesTarget) {
        score += 0.15;
      }
    }

    return {
      paperId: agg.paperId,
      title: agg.title,
      authors: authorsByPaper.get(agg.paperId) || [],
      publicationDate: agg.publicationDate,
      doi: agg.doi,
      journal: agg.journal,
      citationCount: agg.citationCount,
      relevanceScore: Number(score.toFixed(4)),
      bestChunkSimilarity: Number(agg.bestChunk.similarity.toFixed(4)),
      matchingChunksCount: agg.chunkSimilarities.length,
      bestChunkSnippet: agg.bestChunk.snippet,
      bestChunkPage: agg.bestChunk.page,
      bestChunkSection: agg.bestChunk.section,
    };
  });

  // Sort descending by relevance score
  rankedCandidates.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const boundedCandidates = rankedCandidates.slice(0, candidateLimit);

  // Filter selected papers meeting the minimum relevance threshold
  const selectedPapers = boundedCandidates
    .filter((p) => p.bestChunkSimilarity >= minSimilarity || p.relevanceScore >= minSimilarity)
    .slice(0, maxSelected);

  const durationMs = Date.now() - startTime;

  return {
    candidatePapers: boundedCandidates,
    selectedPapers,
    queryVector,
    executionTimeMs: durationMs,
  };
}
