"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { uploadPaperPdf, deletePaperPdf } from "@/lib/storage";
import { processPaperDocument } from "@/lib/pdf/pipeline";
import { generatePaperSummary } from "@/lib/ai/generator";
import { embedPaperChunks, backfillCorpusEmbeddings } from "@/lib/ai/embedding-pipeline";
import {
  normalizeDoi,
  normalizeArxivId,
  getFriendlyP2002ErrorMessage,
} from "@/lib/identifiers";

export interface ActionResponse {
  success: boolean;
  message?: string;
  paperId?: string;
  error?: string;
}

const MAX_PDF_SIZE_BYTES = 30 * 1024 * 1024; // 30 MB

/**
 * Sanitizes and contextualizes database or storage errors to provide helpful,
 * actionable error messages without exposing internals or stack traces.
 */
function sanitizeActionError(err: any, stage: string): string {
  if (
    err?.code === "P2028" ||
    err?.message?.includes("Transaction API error") ||
    err?.message?.includes("Transactional API") ||
    err?.message?.includes("Unable to start a transaction")
  ) {
    return `Database connection timed out during ${stage}. The connection pool was busy. Please retry the operation.`;
  }
  if (err?.code === "P2002") {
    return getFriendlyP2002ErrorMessage(err);
  }
  return err?.message || `An unexpected error occurred during ${stage}.`;
}

/**
 * Validates file size and PDF magic bytes (%PDF-).
 */
async function validatePdfFile(file: File): Promise<Buffer> {
  if (file.size > MAX_PDF_SIZE_BYTES) {
    throw new Error(
      `PDF exceeds maximum allowed size of 30 MB (uploaded file: ${(file.size / (1024 * 1024)).toFixed(1)} MB).`
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const header = buffer.slice(0, 5).toString("utf-8");
  if (!header.startsWith("%PDF-")) {
    throw new Error("Invalid file format: Uploaded document does not contain a valid %PDF header signature.");
  }

  return buffer;
}

/**
 * Server Action for creating an academic paper with author relations, category tags,
 * and optional manuscript PDF upload to Supabase Storage.
 * Strictly checks for ADMIN session.
 */
export async function createPaper(formData: FormData): Promise<ActionResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "ADMIN") {
    return { success: false, error: "Unauthorized. Admin privileges required." };
  }

  try {
    const title = (formData.get("title") as string)?.trim();
    const abstract = (formData.get("abstract") as string)?.trim();
    const journal = (formData.get("journal") as string)?.trim() || null;
    const doi = normalizeDoi(formData.get("doi"));
    const arxivId = normalizeArxivId(formData.get("arxivId"));
    const pubDateStr = formData.get("publicationDate") as string;
    let pdfUrl = (formData.get("pdfUrl") as string)?.trim() || null;
    const keywordsStr = (formData.get("keywords") as string)?.trim() || "";
    const citationCountStr = formData.get("citationCount") as string;

    // Structured sections
    const researchQuestion = (formData.get("researchQuestion") as string)?.trim() || null;
    const methodology = (formData.get("methodology") as string)?.trim() || null;
    const results = (formData.get("results") as string)?.trim() || null;
    const limitations = (formData.get("limitations") as string)?.trim() || null;
    const conclusion = (formData.get("conclusion") as string)?.trim() || null;

    // Optional uploaded PDF file
    const pdfFile = formData.get("pdfFile") as File | null;
    const hasPdfFile = pdfFile && pdfFile.size > 0;

    // Validate PDF file before DB operations if supplied
    let pdfBuffer: Buffer | null = null;
    if (hasPdfFile) {
      pdfBuffer = await validatePdfFile(pdfFile);
    }

    // Authors payload
    const authorsRaw = (formData.get("authors") as string)?.trim() || "";
    // Categories payload
    const categoryIds = formData.getAll("categoryIds") as string[];

    if (!title || !abstract) {
      return { success: false, error: "Title and Abstract are mandatory." };
    }

    const keywords = keywordsStr
      ? keywordsStr.split(",").map((k) => k.trim()).filter(Boolean)
      : [];

    const citationCount = citationCountStr ? parseInt(citationCountStr, 10) || 0 : 0;
    const publicationDate = pubDateStr ? new Date(pubDateStr) : new Date();

    // Check for unique DOI collisions if DOI provided
    if (doi) {
      const existing = await prisma.paper.findUnique({ where: { doi } });
      if (existing) {
        return { success: false, error: `A paper with DOI "${doi}" already exists.` };
      }
    }

    // Check for unique arXiv ID collisions if arXiv ID provided
    if (arxivId) {
      const existingArxiv = await prisma.paper.findUnique({ where: { arxivId } });
      if (existingArxiv) {
        return { success: false, error: `A paper with arXiv ID "${arxivId}" already exists.` };
      }
    }

    // 1. Execute atomic transaction for Paper + Authors + Categories
    const createdPaper = await prisma.$transaction(
      async (tx) => {
        const paper = await tx.paper.create({
          data: {
            title,
            abstract,
            journal,
            doi,
            arxivId,
            publicationDate,
            pdfUrl,
            citationCount,
            keywords,
            researchQuestion,
            methodology,
            results,
            limitations,
            conclusion,
            status: hasPdfFile ? "PROCESSING" : "UPLOADED",
          },
        });

        // Process Authors
        const authorTokens = authorsRaw
          .split(/[;\n]/)
          .map((a) => a.trim())
          .filter(Boolean);

        const seenAuthorIds = new Set<string>();

        for (let i = 0; i < authorTokens.length; i++) {
          const token = authorTokens[i];
          let authorName = token;
          let institution: string | null = null;

          const match = token.match(/^(.+?)\s*\((.+?)\)$/);
          if (match) {
            authorName = match[1].trim();
            institution = match[2].trim();
          }

          let author = await tx.author.findFirst({
            where: { name: { equals: authorName, mode: "insensitive" } },
          });

          if (!author) {
            author = await tx.author.create({
              data: {
                name: authorName,
                institution,
              },
            });
          } else if (institution && !author.institution) {
            author = await tx.author.update({
              where: { id: author.id },
              data: { institution },
            });
          }

          if (seenAuthorIds.has(author.id)) {
            continue;
          }
          seenAuthorIds.add(author.id);

          await tx.paperAuthor.create({
            data: {
              paperId: paper.id,
              authorId: author.id,
              orderIndex: seenAuthorIds.size - 1,
              isCorresponding: seenAuthorIds.size === 1,
            },
          });
        }

        // Process Categories
        for (const catId of categoryIds) {
          if (catId) {
            await tx.paperCategory.create({
              data: {
                paperId: paper.id,
                categoryId: catId,
              },
            });
          }
        }

        return paper;
      },
      {
        maxWait: 15000, // 15s to acquire pooled connection over network
        timeout: 30000, // 30s to complete transactional mutations
      }
    );

    // 2. Handle PDF Upload & Processing if supplied (Strictly outside DB transaction)
    let uploadWarning: string | null = null;
    if (hasPdfFile && pdfBuffer) {
      try {
        const uploadResult = await uploadPaperPdf(createdPaper.id, pdfBuffer);
        await prisma.paper.update({
          where: { id: createdPaper.id },
          data: {
            storagePath: uploadResult.storagePath,
            pdfUrl: uploadResult.publicUrl,
            status: "PROCESSING",
          },
        });

        // Trigger deterministic document ingestion
        const pipelineResult = await processPaperDocument(createdPaper.id);
        if (!pipelineResult.success) {
          uploadWarning = `PDF stored, but ingestion reported: ${pipelineResult.error}`;
        }
      } catch (uploadErr: any) {
        console.error("PDF upload/processing error on createPaper:", uploadErr);
        uploadWarning = `Manuscript saved, but PDF upload failed: ${uploadErr.message || "Storage error"}`;
        await prisma.paper.update({
          where: { id: createdPaper.id },
          data: { status: "FAILED" },
        });
      }
    }

    revalidatePath("/papers");
    revalidatePath("/admin/papers");
    revalidatePath("/admin/processing");
    revalidatePath("/categories");
    revalidatePath("/authors");
    revalidatePath("/");

    return {
      success: true,
      message: uploadWarning
        ? `Manuscript published, but note: ${uploadWarning}`
        : "Manuscript published and processed successfully.",
      paperId: createdPaper.id,
    };
  } catch (err: any) {
    console.error("Failed to create paper:", err);
    return {
      success: false,
      error: sanitizeActionError(err, "manuscript creation"),
    };
  }
}

/**
 * Server Action for updating an existing academic paper with author relations,
 * category tags, and optional PDF manuscript update.
 * Strictly checks for ADMIN session.
 */
export async function updatePaper(
  paperId: string,
  formData: FormData
): Promise<ActionResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "ADMIN") {
    return { success: false, error: "Unauthorized. Admin privileges required." };
  }

  try {
    const title = (formData.get("title") as string)?.trim();
    const abstract = (formData.get("abstract") as string)?.trim();
    const journal = (formData.get("journal") as string)?.trim() || null;
    const doi = normalizeDoi(formData.get("doi"));
    const arxivId = normalizeArxivId(formData.get("arxivId"));
    const pubDateStr = formData.get("publicationDate") as string;
    let pdfUrl = (formData.get("pdfUrl") as string)?.trim() || null;
    const keywordsStr = (formData.get("keywords") as string)?.trim() || "";
    const citationCountStr = formData.get("citationCount") as string;

    // Structured sections
    const researchQuestion = (formData.get("researchQuestion") as string)?.trim() || null;
    const methodology = (formData.get("methodology") as string)?.trim() || null;
    const results = (formData.get("results") as string)?.trim() || null;
    const limitations = (formData.get("limitations") as string)?.trim() || null;
    const conclusion = (formData.get("conclusion") as string)?.trim() || null;

    // Optional uploaded PDF file
    const pdfFile = formData.get("pdfFile") as File | null;
    const hasPdfFile = pdfFile && pdfFile.size > 0;

    let pdfBuffer: Buffer | null = null;
    if (hasPdfFile) {
      pdfBuffer = await validatePdfFile(pdfFile);
    }

    // Authors payload
    const authorsRaw = (formData.get("authors") as string)?.trim() || "";
    // Categories payload
    const categoryIds = formData.getAll("categoryIds") as string[];

    if (!title || !abstract) {
      return { success: false, error: "Title and Abstract are mandatory." };
    }

    const keywords = keywordsStr
      ? keywordsStr.split(",").map((k) => k.trim()).filter(Boolean)
      : [];

    const citationCount = citationCountStr ? parseInt(citationCountStr, 10) || 0 : 0;
    const publicationDate = pubDateStr ? new Date(pubDateStr) : new Date();

    // Check for unique DOI collisions (excluding this paper)
    if (doi) {
      const existing = await prisma.paper.findFirst({
        where: {
          doi,
          id: { not: paperId },
        },
      });
      if (existing) {
        return { success: false, error: `Another paper with DOI "${doi}" already exists.` };
      }
    }

    // Check for unique arXiv ID collisions (excluding this paper)
    if (arxivId) {
      const existingArxiv = await prisma.paper.findFirst({
        where: {
          arxivId,
          id: { not: paperId },
        },
      });
      if (existingArxiv) {
        return { success: false, error: `Another paper with arXiv ID "${arxivId}" already exists.` };
      }
    }

    // Execute atomic transaction for Paper update + Authors + Categories
    const updatedPaper = await prisma.$transaction(async (tx) => {
      const paper = await tx.paper.update({
        where: { id: paperId },
        data: {
          title,
          abstract,
          journal,
          doi,
          arxivId,
          publicationDate,
          pdfUrl,
          citationCount,
          keywords,
          researchQuestion,
          methodology,
          results,
          limitations,
          conclusion,
        },
      });

      // Re-link Authors
      await tx.paperAuthor.deleteMany({
        where: { paperId },
      });

      const authorTokens = authorsRaw
        .split(/[;\n]/)
        .map((a) => a.trim())
        .filter(Boolean);

      const seenAuthorIds = new Set<string>();

      for (let i = 0; i < authorTokens.length; i++) {
        const token = authorTokens[i];
        let authorName = token;
        let institution: string | null = null;

        const match = token.match(/^(.+?)\s*\((.+?)\)$/);
        if (match) {
          authorName = match[1].trim();
          institution = match[2].trim();
        }

        let author = await tx.author.findFirst({
          where: { name: { equals: authorName, mode: "insensitive" } },
        });

        if (!author) {
          author = await tx.author.create({
            data: {
              name: authorName,
              institution,
            },
          });
        } else if (institution && !author.institution) {
          author = await tx.author.update({
            where: { id: author.id },
            data: { institution },
          });
        }

        if (seenAuthorIds.has(author.id)) {
          continue;
        }
        seenAuthorIds.add(author.id);

        await tx.paperAuthor.create({
          data: {
            paperId: paper.id,
            authorId: author.id,
            orderIndex: seenAuthorIds.size - 1,
            isCorresponding: seenAuthorIds.size === 1,
          },
        });
      }

      // Re-link Categories
      await tx.paperCategory.deleteMany({
        where: { paperId },
      });

      for (const catId of categoryIds) {
        if (catId) {
          await tx.paperCategory.create({
            data: {
              paperId: paper.id,
              categoryId: catId,
            },
          });
        }
      }

      return paper;
    },
    {
      maxWait: 15000, // 15s to acquire pooled connection over network
      timeout: 30000, // 30s to complete transactional mutations
    }
  );

    // Handle new PDF upload if provided (Strictly outside DB transaction)
    let uploadWarning: string | null = null;
    if (hasPdfFile && pdfBuffer) {
      try {
        const uploadResult = await uploadPaperPdf(paperId, pdfBuffer);
        await prisma.paper.update({
          where: { id: paperId },
          data: {
            storagePath: uploadResult.storagePath,
            pdfUrl: uploadResult.publicUrl,
            status: "PROCESSING",
          },
        });

        // Trigger deterministic document ingestion
        const pipelineResult = await processPaperDocument(paperId, { forceReprocess: true });
        if (!pipelineResult.success) {
          uploadWarning = `PDF updated, but ingestion reported: ${pipelineResult.error}`;
        }
      } catch (uploadErr: any) {
        console.error("PDF upload/processing error on updatePaper:", uploadErr);
        uploadWarning = `Metadata saved, but PDF upload failed: ${uploadErr.message || "Storage error"}`;
      }
    }

    revalidatePath("/papers");
    revalidatePath(`/papers/${paperId}`);
    revalidatePath("/admin/papers");
    revalidatePath(`/admin/papers/${paperId}/edit`);
    revalidatePath("/admin/processing");
    revalidatePath("/categories");
    revalidatePath("/authors");
    revalidatePath("/");

    return {
      success: true,
      message: uploadWarning
        ? `Manuscript updated, but note: ${uploadWarning}`
        : "Manuscript updated successfully.",
      paperId: updatedPaper.id,
    };
  } catch (err: any) {
    console.error("Failed to update paper:", err);
    return {
      success: false,
      error: sanitizeActionError(err, "manuscript update"),
    };
  }
}

/**
 * Server Action for attaching or replacing a PDF manuscript on an existing Paper.
 * Strictly checks for ADMIN session.
 */
export async function attachPaperPdfAction(
  paperId: string,
  formData: FormData
): Promise<ActionResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "ADMIN") {
    return { success: false, error: "Unauthorized. Admin privileges required." };
  }

  try {
    const pdfFile = formData.get("pdfFile") as File | null;
    if (!pdfFile || pdfFile.size === 0) {
      return { success: false, error: "No PDF file was provided for upload." };
    }

    const pdfBuffer = await validatePdfFile(pdfFile);

    const paper = await prisma.paper.findUnique({
      where: { id: paperId },
    });

    if (!paper) {
      return { success: false, error: `Paper with ID "${paperId}" not found.` };
    }

    // Upload to Supabase Storage: research-papers/<paperId>/original.pdf
    const uploadResult = await uploadPaperPdf(paperId, pdfBuffer);

    // Update paper storagePath and pdfUrl
    await prisma.paper.update({
      where: { id: paperId },
      data: {
        storagePath: uploadResult.storagePath,
        pdfUrl: uploadResult.publicUrl,
        status: "PROCESSING",
      },
    });

    // Run deterministic ingestion pipeline
    const pipelineRes = await processPaperDocument(paperId, { forceReprocess: true });

    revalidatePath("/papers");
    revalidatePath(`/papers/${paperId}`);
    revalidatePath("/admin/papers");
    revalidatePath(`/admin/papers/${paperId}/edit`);
    revalidatePath("/admin/processing");

    if (!pipelineRes.success) {
      return {
        success: false,
        error: `PDF uploaded, but ingestion pipeline failed: ${pipelineRes.error}`,
      };
    }

    return {
      success: true,
      message: `PDF attached and ingested successfully: ${pipelineRes.chunkCount} chunks generated across ${pipelineRes.pageCount} pages.`,
      paperId,
    };
  } catch (err: any) {
    console.error("Failed to attach PDF:", err);
    return {
      success: false,
      error: err.message || "An unexpected error occurred while attaching the PDF.",
    };
  }
}

/**
 * Server Action for deleting a paper. Cascades to junction relations and removes stored PDF.
 */
export async function deletePaper(paperId: string): Promise<ActionResponse> {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }

  if (!session?.user || session.user.role !== "ADMIN") {
    return { success: false, error: "Unauthorized. Admin privileges required." };
  }

  try {
    const paper = await prisma.paper.findUnique({ where: { id: paperId } });

    if (!paper) {
      return { success: false, error: "Manuscript not found or has already been deleted." };
    }

    if (paper.storagePath) {
      try {
        await deletePaperPdf(paper.storagePath);
      } catch (storageErr) {
        console.warn("Storage deletion warning:", storageErr);
      }
    }

    // Execute deletion inside transaction with explicit timeouts for connection pool resilience
    await prisma.$transaction(
      async (tx) => {
        await tx.paper.delete({
          where: { id: paperId },
        });
      },
      {
        maxWait: 15000,
        timeout: 30000,
      }
    );

    revalidatePath("/papers");
    revalidatePath("/admin/papers");
    revalidatePath("/admin/processing");
    revalidatePath("/");

    return { success: true, message: "Paper deleted successfully." };
  } catch (err: any) {
    console.error("Failed to delete paper:", err);
    return {
      success: false,
      error: sanitizeActionError(err, "paper deletion"),
    };
  }
}

/**
 * Server Action for generating or regenerating an evidence-grounded AI Summary for a paper.
 * Strictly verifies ADMIN role. Invokes OpenAI Structured Outputs, validates chunk references,
 * and updates AISummary atomically.
 */
export async function generatePaperSummaryAction(
  paperId: string,
  options: { forceRegenerate?: boolean } = {}
): Promise<ActionResponse & { modelUsed?: string; promptVersion?: string }> {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }

  if (!session?.user || session.user.role !== "ADMIN") {
    return { success: false, error: "Unauthorized. Admin privileges required." };
  }

  try {
    const result = await generatePaperSummary(paperId, options);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Failed to generate AI summary.",
      };
    }

    revalidatePath("/papers");
    revalidatePath(`/papers/${paperId}`);
    revalidatePath("/admin/papers");
    revalidatePath(`/admin/papers/${paperId}/edit`);
    revalidatePath("/admin/processing");

    return {
      success: true,
      paperId,
      modelUsed: result.modelUsed,
      promptVersion: result.promptVersion,
      message: `AI Summary generated successfully (${result.modelUsed}, ${result.promptVersion}). Validated ${result.validatedCitationsCount || 0} evidence citation anchors.`,
    };
  } catch (err: any) {
    console.error("AI summary generation server action error:", err);
    return {
      success: false,
      error: err.message || "An unexpected error occurred during AI summary generation.",
    };
  }
}

/**
 * Server Action for generating or regenerating vector embeddings for a paper's chunks.
 * Strictly verifies ADMIN role. Uses OpenAI embeddings and pgvector storage.
 */
export async function generatePaperEmbeddingsAction(
  paperId: string,
  options: { force?: boolean } = {}
): Promise<ActionResponse & { embeddedCount?: number; skippedCount?: number }> {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }

  if (!session?.user || session.user.role !== "ADMIN") {
    return { success: false, error: "Unauthorized. Admin privileges required." };
  }

  try {
    const result = await embedPaperChunks(paperId, options);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Failed to generate embeddings.",
      };
    }

    revalidatePath("/papers");
    revalidatePath(`/papers/${paperId}`);
    revalidatePath("/admin/papers");
    revalidatePath(`/admin/papers/${paperId}/edit`);
    revalidatePath("/admin/processing");

    return {
      success: true,
      paperId,
      embeddedCount: result.embeddedCount,
      skippedCount: result.skippedCount,
      message: `Embeddings generated: ${result.embeddedCount} embedded, ${result.skippedCount} skipped (up-to-date).`,
    };
  } catch (err: any) {
    console.error("Embeddings server action error:", err);
    return {
      success: false,
      error: err.message || "An unexpected error occurred during embedding generation.",
    };
  }
}

/**
 * Server Action for backfilling embeddings across the entire paper corpus.
 * Strictly verifies ADMIN role.
 */
export async function backfillEmbeddingsAction(
  options: { force?: boolean } = {}
): Promise<ActionResponse & { totalEmbedded?: number; totalSkipped?: number }> {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }

  if (!session?.user || session.user.role !== "ADMIN") {
    return { success: false, error: "Unauthorized. Admin privileges required." };
  }

  try {
    const result = await backfillCorpusEmbeddings(options);

    revalidatePath("/papers");
    revalidatePath("/admin/papers");
    revalidatePath("/admin/processing");

    return {
      success: true,
      totalEmbedded: result.totalEmbedded,
      totalSkipped: result.totalSkipped,
      message: `Backfill completed: ${result.papersProcessed} papers processed, ${result.totalEmbedded} chunks embedded, ${result.totalSkipped} skipped.`,
    };
  } catch (err: any) {
    console.error("Backfill server action error:", err);
    return {
      success: false,
      error: err.message || "An unexpected error occurred during embedding backfill.",
    };
  }
}
