/**
 * AI Research Hub — Phase 10: Agent Tool Registry
 *
 * Exposes a small, strictly typed set of capabilities mapping to existing
 * validated Phase 6, 7, 8, and 9 systems.
 *
 * Security & Boundary Rules:
 * - ZERO raw Prisma or arbitrary SQL exposed
 * - ZERO shell, filesystem, or arbitrary HTTP fetch exposed
 * - External searching calls Phase 9 aggregator strictly (never raw provider APIs directly)
 * - Evidence retrieval enforces Paper.status === 'COMPLETED'
 */

import { prisma } from "@/lib/prisma";
import { discoverRelevantPapers } from "@/lib/synthesis/discover-papers";
import { retrieveMultiPaperEvidence } from "@/lib/synthesis/retrieve-multipaper-evidence";
import { generateEmbedding } from "@/lib/ai/embeddings";
import { ScholarlyAggregator } from "@/lib/discovery/scholarly-aggregator";
import {
  resolveFullTextAvailability,
  acquireAndIngestLawfulFullText,
} from "@/lib/discovery/full-text-service";
import {
  DiscoveredPaper,
  PaperEvidenceSet,
  RetrievedEvidenceChunk,
} from "@/lib/synthesis/types";
import {
  DiscoverySearchResult,
  NormalizedExternalPaper,
  FullTextAvailabilityStatus,
} from "@/lib/discovery/types";
import { paperVisibilityFilter } from "@/lib/auth/paper-visibility";

export interface AgentToolRegistry {
  /**
   * Searches the local PostgreSQL library for completed, evidence-ready papers using pgvector hybrid search.
   */
  searchLocalLibrary(
    query: string,
    options?: { limit?: number; userId?: string | null; userRole?: string | null }
  ): Promise<DiscoveredPaper[]>;

  /**
   * Searches external scholarly sources (PubMed, Crossref, Semantic Scholar) through the Phase 9 aggregator.
   */
  searchExternalLiterature(
    query: string,
    options?: { limitPerProvider?: number }
  ): Promise<DiscoverySearchResult>;

  /**
   * Retrieves paper metadata, chunk counts, and processing status from the local database.
   */
  inspectPaperDetails(
    paperId: string,
    options?: { userId?: string | null; userRole?: string | null }
  ): Promise<{
    id: string;
    title: string;
    doi: string | null;
    status: string;
    hasFullText: boolean;
    chunkCount: number;
    embeddedCount: number;
  } | null>;

  /**
   * Retrieves balanced, section-aware evidence chunks for a set of completed papers.
   */
  retrievePaperEvidence(
    paperIds: string[],
    question: string,
    options?: {
      chunksPerPaper?: number;
      globalChunkCap?: number;
      userId?: string | null;
      userRole?: string | null;
    }
  ): Promise<{
    evidenceSets: PaperEvidenceSet[];
    allChunks: RetrievedEvidenceChunk[];
  }>;

  /**
   * Checks lawful full-text accessibility for an external paper.
   */
  resolveFullTextStatus(
    paper: NormalizedExternalPaper
  ): { status: FullTextAvailabilityStatus; url: string | null; source: string | null };

  /**
   * Lawfully acquires an open-access PDF from a trusted repository, chaining Phase 4 and Phase 6 pipelines.
   */
  acquireOpenAccessFullText(
    paperId: string,
    targetPdfUrl: string
  ): Promise<{ success: boolean; status: FullTextAvailabilityStatus; chunkCount?: number; error?: string }>;
}

export class DefaultAgentToolRegistry implements AgentToolRegistry {
  private aggregator = new ScholarlyAggregator();

  async searchLocalLibrary(
    query: string,
    options: { limit?: number; userId?: string | null; userRole?: string | null } = {}
  ): Promise<DiscoveredPaper[]> {
    const limit = options.limit || 8;
    const res = await discoverRelevantPapers(query, {
      candidateLimit: limit * 2,
      maxSelected: limit,
      userId: options.userId || undefined,
      userRole: options.userRole || undefined,
    });
    // PART 1.1: Return filtered selectedPapers (enforces minSimilarity and anatomical domain alignment)
    return res.selectedPapers;
  }

  async searchExternalLiterature(
    query: string,
    options: { limitPerProvider?: number } = {}
  ): Promise<DiscoverySearchResult> {
    return this.aggregator.search(query, {
      limitPerProvider: options.limitPerProvider || 5,
    });
  }

  async inspectPaperDetails(
    paperId: string,
    options?: { userId?: string | null; userRole?: string | null }
  ) {
    const paper = await prisma.paper.findFirst({
      where: {
        AND: [
          { id: paperId },
          paperVisibilityFilter(options?.userId, { role: options?.userRole }),
        ],
      },
      include: {
        _count: {
          select: { chunks: true },
        },
      },
    });

    if (!paper) return null;

    let embeddedCount = 0;
    try {
      const embeddedResult = await prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint as count
        FROM paper_chunks
        WHERE "paperId" = ${paperId}
          AND embedding IS NOT NULL
      `;
      embeddedCount = Number(embeddedResult[0]?.count || 0);
    } catch {
      try {
        await prisma.$connect();
        const embeddedResult = await prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*)::bigint as count
          FROM paper_chunks
          WHERE "paperId" = ${paperId}
            AND embedding IS NOT NULL
        `;
        embeddedCount = Number(embeddedResult[0]?.count || 0);
      } catch {
        embeddedCount = paper._count.chunks;
      }
    }

    return {
      id: paper.id,
      title: paper.title,
      doi: paper.doi,
      status: paper.status,
      hasFullText: Boolean(paper.storagePath) && paper.status === "COMPLETED",
      chunkCount: paper._count.chunks,
      embeddedCount,
    };
  }

  async retrievePaperEvidence(
    paperIds: string[],
    question: string,
    options: {
      chunksPerPaper?: number;
      globalChunkCap?: number;
      userId?: string | null;
      userRole?: string | null;
    } = {}
  ): Promise<{
    evidenceSets: PaperEvidenceSet[];
    allChunks: RetrievedEvidenceChunk[];
  }> {
    const chunksPerPaper = options.chunksPerPaper || 4;
    const globalChunkCap = options.globalChunkCap || 32;

    const queryVector = await generateEmbedding(question);

    const papers = await prisma.paper.findMany({
      where: {
        AND: [
          { id: { in: paperIds } },
          { status: "COMPLETED" },
          paperVisibilityFilter(options.userId, { role: options.userRole }),
        ],
      },
      include: {
        authors: {
          include: { author: true },
          orderBy: { orderIndex: "asc" },
        },
      },
    });

    const discoveredPapers: DiscoveredPaper[] = papers.map((p) => ({
      paperId: p.id,
      title: p.title,
      authors: p.authors.map((a) => a.author.name),
      doi: p.doi,
      journal: p.journal,
      publicationDate: p.publicationDate ? p.publicationDate.toISOString() : null,
      citationCount: p.citationCount,
      relevanceScore: 1.0,
      bestChunkSimilarity: 1.0,
      matchingChunksCount: 1,
    }));

    const result = await retrieveMultiPaperEvidence(discoveredPapers, question, {
      queryVector,
      chunksPerPaper,
      maxTotalChunks: globalChunkCap,
      userId: options.userId,
      userRole: options.userRole,
    });

    return {
      evidenceSets: result.evidenceSets,
      allChunks: result.allChunks,
    };
  }

  resolveFullTextStatus(paper: NormalizedExternalPaper) {
    return resolveFullTextAvailability(paper);
  }

  async acquireOpenAccessFullText(paperId: string, targetPdfUrl: string) {
    return acquireAndIngestLawfulFullText(paperId, targetPdfUrl);
  }
}
