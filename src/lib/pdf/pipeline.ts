import { prisma } from "@/lib/prisma";
import { downloadPaperPdf } from "@/lib/storage";
import { extractPdfText, ScannedPdfError } from "./extractor";
import { chunkManuscriptPages } from "./chunker";
import { revalidatePath } from "next/cache";

export interface PipelineResult {
  success: boolean;
  jobId?: string;
  paperId: string;
  chunkCount?: number;
  pageCount?: number;
  error?: string;
}

/**
 * Executes the deterministic document ingestion pipeline for a research paper.
 * Pipeline stages: PDF_DOWNLOAD -> TEXT_EXTRACTION -> CHUNKING -> COMPLETED (or FAILED).
 * Completely deterministic; does NOT invoke an LLM.
 */
export async function processPaperDocument(
  paperId: string,
  options: { forceReprocess?: boolean } = {}
): Promise<PipelineResult> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      processingJobs: {
        orderBy: [{ attempt: "desc" }, { createdAt: "desc" }],
        take: 1,
      },
    },
  });

  if (!paper) {
    return {
      success: false,
      paperId,
      error: `Paper with ID "${paperId}" not found in database.`,
    };
  }

  if (!paper.storagePath) {
    return {
      success: false,
      paperId,
      error: `Paper "${paper.title}" has no associated storagePath. Please upload a PDF manuscript first.`,
    };
  }

  const latestJob = paper.processingJobs[0];
  const nextAttempt = latestJob ? latestJob.attempt + 1 : 1;

  // 1. Initialize Processing Job in DB
  const job = await prisma.processingJob.create({
    data: {
      paperId,
      stage: "PDF_DOWNLOAD",
      status: "RUNNING",
      attempt: nextAttempt,
      startedAt: new Date(),
    },
  });

  await prisma.paper.update({
    where: { id: paperId },
    data: { status: "PROCESSING" },
  });

  try {
    // -------------------------------------------------------------------------
    // STAGE 1: PDF_DOWNLOAD
    // -------------------------------------------------------------------------
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await downloadPaperPdf(paper.storagePath);
    } catch (downloadErr: any) {
      const errorMsg = `Storage download failed: ${downloadErr.message || "Could not retrieve manuscript file"}`;
      await prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          stage: "PDF_DOWNLOAD",
          errorMessage: errorMsg,
          errorStack: downloadErr.stack || null,
          completedAt: new Date(),
        },
      });
      await prisma.paper.update({
        where: { id: paperId },
        data: { status: "FAILED" },
      });
      return { success: false, jobId: job.id, paperId, error: errorMsg };
    }

    // -------------------------------------------------------------------------
    // STAGE 2: TEXT_EXTRACTION
    // -------------------------------------------------------------------------
    await prisma.processingJob.update({
      where: { id: job.id },
      data: { stage: "TEXT_EXTRACTION" },
    });

    let extractionResult;
    try {
      extractionResult = await extractPdfText(pdfBuffer);
    } catch (extractErr: any) {
      const isScanned = extractErr instanceof ScannedPdfError;
      const errorMsg = isScanned
        ? extractErr.message
        : `Text extraction failed: ${extractErr.message || "Corrupted or unreadable PDF structure"}`;

      await prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          stage: "TEXT_EXTRACTION",
          errorMessage: errorMsg,
          errorStack: extractErr.stack || null,
          completedAt: new Date(),
        },
      });
      await prisma.paper.update({
        where: { id: paperId },
        data: { status: "FAILED" },
      });
      return { success: false, jobId: job.id, paperId, error: errorMsg };
    }

    // -------------------------------------------------------------------------
    // STAGE 3: CHUNKING
    // -------------------------------------------------------------------------
    await prisma.processingJob.update({
      where: { id: job.id },
      data: { stage: "CHUNKING" },
    });

    const chunks = chunkManuscriptPages(paperId, extractionResult.pages);

    if (chunks.length === 0) {
      const errorMsg = "Chunking failed: Extracted document yielded 0 valid text chunks.";
      await prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          stage: "CHUNKING",
          errorMessage: errorMsg,
          completedAt: new Date(),
        },
      });
      await prisma.paper.update({
        where: { id: paperId },
        data: { status: "FAILED" },
      });
      return { success: false, jobId: job.id, paperId, error: errorMsg };
    }

    // -------------------------------------------------------------------------
    // STAGE 4 (DORMANT PREPARATION): TABLE_EXTRACTION
    // Controlled Phase 3C preparation: strictly default-OFF via ENABLE_TABLE_EXTRACTION="true".
    // When disabled (default), table extraction is completely bypassed:
    // zero external API calls, zero database writes, zero chunk/embedding alterations.
    // -------------------------------------------------------------------------
    const enableTableExtraction = process.env.ENABLE_TABLE_EXTRACTION === "true";
    if (enableTableExtraction) {
      // Dormant hook: When Stage 2 is migrated and activated, isolated TablePersistenceService
      // will be invoked here to persist candidate tables and verify cells.
    }

    // Atomically replace previous chunks and persist new chunks
    await prisma.$transaction(async (tx) => {
      // Clean up previous chunks for this paper (ensures zero duplicates on reprocess)
      await tx.paperChunk.deleteMany({
        where: { paperId },
      });

      // Insert new chunks
      await tx.paperChunk.createMany({
        data: chunks.map((c) => ({
          paperId: c.paperId,
          chunkIndex: c.chunkIndex,
          text: c.text,
          section: c.section,
          pageNumber: c.pageNumber,
          tokenCount: c.tokenCount,
          metadata: c.metadata,
        })),
      });

      // Mark Job as COMPLETED
      await tx.processingJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          stage: "CHUNKING",
          completedAt: new Date(),
          errorMessage: null,
          errorStack: null,
        },
      });

      // Mark Paper as COMPLETED
      await tx.paper.update({
        where: { id: paperId },
        data: { status: "COMPLETED" },
      });
    });

    try {
      revalidatePath("/admin/processing");
      revalidatePath("/admin/papers");
      revalidatePath(`/papers/${paperId}`);
    } catch {
      // In non-request contexts, ignore revalidate errors
    }

    return {
      success: true,
      jobId: job.id,
      paperId,
      chunkCount: chunks.length,
      pageCount: extractionResult.totalPages,
    };
  } catch (unexpectedErr: any) {
    console.error("Unexpected error in PDF ingestion pipeline:", unexpectedErr);
    const errorMsg = `Pipeline exception: ${unexpectedErr.message || "Unknown error"}`;
    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorMessage: errorMsg,
        errorStack: unexpectedErr.stack || null,
        completedAt: new Date(),
      },
    });
    await prisma.paper.update({
      where: { id: paperId },
      data: { status: "FAILED" },
    });
    return { success: false, jobId: job.id, paperId, error: errorMsg };
  }
}
