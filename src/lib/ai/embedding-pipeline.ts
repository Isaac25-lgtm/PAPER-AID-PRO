import "server-only";
import { prisma } from "../prisma";
import { AI_CONFIG } from "./config";
import {
  generateEmbeddingsBatch,
  prepareChunkEmbeddingInput,
  computeEmbeddingInputHash,
} from "./embeddings";
import { ProcessingStage, JobStatus } from "@prisma/client";

export type EmbeddingStatus =
  | "NOT EMBEDDED"
  | "PARTIALLY EMBEDDED"
  | "EMBEDDING"
  | "EMBEDDED"
  | "FAILED";

export interface PaperEmbeddingStats {
  totalChunks: number;
  embeddedChunks: number;
  outdatedChunks: number;
  status: EmbeddingStatus;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  embeddedAt: Date | null;
  isCurrentModel: boolean;
}

export interface ChunkEmbeddingStalenessInput {
  hasVector: boolean;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  embeddingInputHash: string | null;
  currentTitle: string;
  currentSection: string | null | undefined;
  currentText: string;
  configuredModel?: string;
  configuredDimensions?: number;
}

export interface ChunkStalenessResult {
  isCurrent: boolean;
  expectedHash: string;
  reason?: "missing_vector" | "model_mismatch" | "dimensions_mismatch" | "hash_mismatch";
}

/**
 * Deterministically checks whether a chunk's stored embedding is current or stale.
 * 
 * An embedding is current IF AND ONLY IF:
 * 1. embedding exists in the database
 * 2. embeddingModel matches the configured model
 * 3. embeddingDimensions matches the configured dimension contract
 * 4. embeddingInputHash matches the deterministic SHA-256 hash of the prepared input
 *    (which incorporates title + section + chunk text).
 */
export function isChunkEmbeddingCurrent(params: ChunkEmbeddingStalenessInput): ChunkStalenessResult {
  const configuredModel = params.configuredModel || AI_CONFIG.embeddingModel;
  const configuredDimensions = params.configuredDimensions ?? AI_CONFIG.embeddingDimensions;

  const preparedInput = prepareChunkEmbeddingInput(
    params.currentTitle,
    params.currentSection,
    params.currentText
  );
  const expectedHash = computeEmbeddingInputHash(preparedInput);

  if (!params.hasVector) {
    return { isCurrent: false, expectedHash, reason: "missing_vector" };
  }

  if (params.embeddingModel !== configuredModel) {
    return { isCurrent: false, expectedHash, reason: "model_mismatch" };
  }

  if (params.embeddingDimensions !== configuredDimensions) {
    return { isCurrent: false, expectedHash, reason: "dimensions_mismatch" };
  }

  if (params.embeddingInputHash !== expectedHash) {
    return { isCurrent: false, expectedHash, reason: "hash_mismatch" };
  }

  return { isCurrent: true, expectedHash };
}

/**
 * Returns detailed embedding status and statistics for a given paper.
 */
export async function getPaperEmbeddingStats(paperId: string): Promise<PaperEmbeddingStats> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: {
      id: true,
      title: true,
      chunks: {
        select: {
          id: true,
          section: true,
          text: true,
          embeddingModel: true,
          embeddingDimensions: true,
          embeddingInputHash: true,
          embeddedAt: true,
        },
        orderBy: { chunkIndex: "asc" },
      },
    },
  });

  const totalChunks = paper?.chunks.length ?? 0;
  if (!paper || totalChunks === 0) {
    return {
      totalChunks: 0,
      embeddedChunks: 0,
      outdatedChunks: 0,
      status: "NOT EMBEDDED",
      embeddingModel: null,
      embeddingDimensions: null,
      embeddedAt: null,
      isCurrentModel: false,
    };
  }

  // Count chunks that have an embedding (check via raw query for embedding column)
  const vectorChunks: Array<{ id: string }> = await prisma.$queryRaw`
    SELECT "id" 
    FROM "paper_chunks" 
    WHERE "paperId" = ${paperId} AND "embedding" IS NOT NULL;
  `;
  const vectorIds = new Set(vectorChunks.map((c) => c.id));
  const embeddedChunks = vectorIds.size;

  let currentChunks = 0;
  for (const chunk of paper.chunks) {
    const check = isChunkEmbeddingCurrent({
      hasVector: vectorIds.has(chunk.id),
      embeddingModel: chunk.embeddingModel,
      embeddingDimensions: chunk.embeddingDimensions,
      embeddingInputHash: chunk.embeddingInputHash,
      currentTitle: paper.title,
      currentSection: chunk.section,
      currentText: chunk.text,
    });
    if (check.isCurrent) {
      currentChunks++;
    }
  }

  const outdatedChunks = embeddedChunks - currentChunks;

  // Check recent ProcessingJob for running state or failure
  const recentJob = await prisma.processingJob.findFirst({
    where: {
      paperId,
      stage: ProcessingStage.EMBEDDING_GENERATION,
    },
    orderBy: { createdAt: "desc" },
  });

  let status: EmbeddingStatus = "NOT EMBEDDED";
  if (recentJob && recentJob.status === JobStatus.RUNNING) {
    status = "EMBEDDING";
  } else if (embeddedChunks === 0) {
    status = recentJob?.status === JobStatus.FAILED ? "FAILED" : "NOT EMBEDDED";
  } else if (currentChunks === totalChunks) {
    status = "EMBEDDED";
  } else {
    status = "PARTIALLY EMBEDDED";
  }

  const latestChunkWithModel = paper.chunks.find((c) => c.embeddingModel);

  return {
    totalChunks,
    embeddedChunks,
    outdatedChunks,
    status,
    embeddingModel: latestChunkWithModel?.embeddingModel ?? null,
    embeddingDimensions: latestChunkWithModel?.embeddingDimensions ?? null,
    embeddedAt: latestChunkWithModel?.embeddedAt ?? null,
    isCurrentModel: currentChunks === totalChunks && totalChunks > 0,
  };
}

/**
 * Idempotently embeds PaperChunks for a paper using OpenAI's embedding API and stores
 * vectors in PostgreSQL using pgvector.
 *
 * Safe to rerun: chunks already embedded with the current model, dimension contract,
 * and input hash are skipped unless options.force is true.
 */
export async function embedPaperChunks(
  paperId: string,
  options?: { force?: boolean }
): Promise<{
  success: boolean;
  totalChunks: number;
  embeddedCount: number;
  skippedCount: number;
  error?: string;
}> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" },
      },
    },
  });

  if (!paper) {
    throw new Error(`Paper not found: ${paperId}`);
  }

  if (paper.chunks.length === 0) {
    throw new Error(
      `Paper "${paper.title}" has 0 chunks. PDF text extraction is required before generating embeddings.`
    );
  }

  // Create or record running ProcessingJob
  const job = await prisma.processingJob.create({
    data: {
      paperId,
      stage: ProcessingStage.EMBEDDING_GENERATION,
      status: JobStatus.RUNNING,
      startedAt: new Date(),
    },
  });

  try {
    // Check which chunks have an existing vector in PostgreSQL
    const vectorChunks: Array<{ id: string }> = await prisma.$queryRaw`
      SELECT "id"
      FROM "paper_chunks"
      WHERE "paperId" = ${paperId} AND "embedding" IS NOT NULL;
    `;
    const vectorIds = new Set(vectorChunks.map((c) => c.id));

    // Determine staleness and calculate input hash for each chunk
    const chunksWithPlan = paper.chunks.map((chunk) => {
      const staleness = isChunkEmbeddingCurrent({
        hasVector: vectorIds.has(chunk.id),
        embeddingModel: chunk.embeddingModel,
        embeddingDimensions: chunk.embeddingDimensions,
        embeddingInputHash: chunk.embeddingInputHash,
        currentTitle: paper.title,
        currentSection: chunk.section,
        currentText: chunk.text,
      });

      return {
        chunk,
        staleness,
        needsEmbedding: options?.force ? true : !staleness.isCurrent,
      };
    });

    const chunksToEmbed = chunksWithPlan.filter((c) => c.needsEmbedding);
    const skippedCount = paper.chunks.length - chunksToEmbed.length;

    if (chunksToEmbed.length === 0) {
      // All chunks are already up-to-date with current model, dimensions, and input hash
      await prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      return {
        success: true,
        totalChunks: paper.chunks.length,
        embeddedCount: 0,
        skippedCount,
      };
    }

    // Process in batches
    const batchSize = AI_CONFIG.embeddingBatchSize;
    let embeddedCount = 0;

    for (let i = 0; i < chunksToEmbed.length; i += batchSize) {
      const batch = chunksToEmbed.slice(i, i + batchSize);
      const inputs = batch.map((item) =>
        prepareChunkEmbeddingInput(paper.title, item.chunk.section, item.chunk.text)
      );

      const vectors = await generateEmbeddingsBatch(inputs);

      // Persist vectors, model, dimensions, input hash, and timestamp
      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const vector = vectors[j];
        const vectorString = `[${vector.join(",")}]`;
        const expectedHash = item.staleness.expectedHash;

        await prisma.$executeRaw`
          UPDATE "paper_chunks"
          SET 
            "embedding" = ${vectorString}::vector,
            "embeddingModel" = ${AI_CONFIG.embeddingModel},
            "embeddingDimensions" = ${AI_CONFIG.embeddingDimensions},
            "embeddingInputHash" = ${expectedHash},
            "embeddedAt" = NOW()
          WHERE "id" = ${item.chunk.id};
        `;
        embeddedCount++;
      }
    }

    // Complete the ProcessingJob
    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    return {
      success: true,
      totalChunks: paper.chunks.length,
      embeddedCount,
      skippedCount,
    };
  } catch (error: any) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const sanitizedError = rawMessage.replace(/sk-[a-zA-Z0-9_\-]{20,}/g, "[REDACTED_API_KEY]");

    console.error(`[EmbeddingPipeline] Failure for paper ${paperId}:`, sanitizedError);

    // Record failure in ProcessingJob
    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.FAILED,
        errorMessage: sanitizedError,
        completedAt: new Date(),
      },
    }).catch(() => {});

    return {
      success: false,
      totalChunks: paper.chunks.length,
      embeddedCount: 0,
      skippedCount: 0,
      error: sanitizedError,
    };
  }
}

/**
 * Controlled backfill utility for administrative corpus management.
 * Identifies papers with missing or outdated embeddings and processes them.
 */
export async function backfillCorpusEmbeddings(options?: {
  paperId?: string;
  force?: boolean;
}): Promise<{
  papersProcessed: number;
  totalEmbedded: number;
  totalSkipped: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let totalEmbedded = 0;
  let totalSkipped = 0;
  let papersProcessed = 0;

  const papers = await prisma.paper.findMany({
    where: options?.paperId ? { id: options.paperId } : undefined,
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
  });

  for (const paper of papers) {
    try {
      const stats = await getPaperEmbeddingStats(paper.id);
      if (stats.totalChunks === 0) {
        continue;
      }

      if (!options?.force && stats.isCurrentModel) {
        totalSkipped += stats.totalChunks;
        continue;
      }

      const res = await embedPaperChunks(paper.id, { force: options?.force });
      if (res.success) {
        totalEmbedded += res.embeddedCount;
        totalSkipped += res.skippedCount;
        papersProcessed++;
      } else if (res.error) {
        errors.push(`${paper.title}: ${res.error}`);
      }
    } catch (err: any) {
      errors.push(`${paper.title}: ${err.message || String(err)}`);
    }
  }

  return {
    papersProcessed,
    totalEmbedded,
    totalSkipped,
    errors,
  };
}
