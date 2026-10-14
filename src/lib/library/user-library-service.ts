import "server-only";
import { prisma } from "@/lib/prisma";
import { uploadPaperPdf, deletePaperPdf } from "@/lib/storage";
import { processPaperDocument } from "@/lib/pdf/pipeline";
import { embedPaperChunks } from "@/lib/ai/embedding-pipeline";
import { revalidatePath } from "next/cache";
import { PaperProcessingStatus } from "@prisma/client";

export const MAX_USER_PDF_SIZE_BYTES = 35 * 1024 * 1024; // 35 MB

export type UserDocumentType =
  | "THESIS"
  | "DISSERTATION"
  | "PROPOSAL"
  | "DRAFT"
  | "STUDENT_PAPER"
  | "JOURNAL_ARTICLE"
  | "MANUSCRIPT";

export interface UserDocumentMetadata {
  title?: string;
  authors?: string;
  institution?: string;
  researchCategory?: string;
  documentType?: UserDocumentType | string;
  description?: string;
}

export interface UserLibraryItem {
  id: string;
  bookmarkId?: string;
  title: string;
  abstract: string;
  authors: string[];
  institution?: string | null;
  isPrivate: boolean;
  documentType: string;
  status: PaperProcessingStatus;
  hasPdf: boolean;
  storagePath?: string | null;
  pdfUrl?: string | null;
  doi?: string | null;
  isOpenAccess?: boolean;
  isPreprint?: boolean;
  sourceProvenance?: any;
  chunkCount: number;
  canChat: boolean;
  latestJobStage?: string | null;
  latestJobStatus?: string | null;
  latestJobError?: string | null;
  publicationDate?: string | null;
  journal?: string | null;
  categories: string[];
  collections: string[];
  createdAt: string;
}

/**
 * Validates PDF buffer signature (%PDF-) and file size limits.
 */
export function validateUserPdfBuffer(buffer: Buffer): void {
  if (buffer.length === 0) {
    throw new Error("Uploaded file is empty.");
  }
  if (buffer.length > MAX_USER_PDF_SIZE_BYTES) {
    throw new Error(
      `File exceeds maximum permitted size of 35 MB (uploaded file: ${(
        buffer.length /
        (1024 * 1024)
      ).toFixed(1)} MB).`
    );
  }

  const header = buffer.slice(0, 5).toString("utf-8");
  if (!header.startsWith("%PDF-")) {
    throw new Error(
      "Invalid file format: Uploaded file does not contain a valid %PDF header signature."
    );
  }
}

/**
 * Uploads an unpublished or personal PDF to the user's private library.
 * Completely zero requirement for DOI, journal name, publisher, or public URL.
 * Stored strictly in the user-scoped private storage path:
 * research-papers/users/<userId>/papers/<paperId>/original.pdf
 */
export async function uploadUserPrivateDocument(params: {
  userId: string;
  fileBuffer: Buffer;
  filename: string;
  metadata?: UserDocumentMetadata;
  autoProcess?: boolean;
}): Promise<{
  success: boolean;
  paperId: string;
  storagePath: string;
  error?: string;
}> {
  const { userId, fileBuffer, filename, metadata, autoProcess = true } = params;

  // 1. Validate PDF
  validateUserPdfBuffer(fileBuffer);

  const cleanFilename = filename.replace(/\.pdf$/i, "").trim();
  const title = metadata?.title?.trim() || cleanFilename || "Untitled Manuscript";
  const abstract =
    metadata?.description?.trim() ||
    `Personal research document (${metadata?.documentType || "manuscript"}) uploaded to My Library.`;
  const documentType = (metadata?.documentType as UserDocumentType) || "MANUSCRIPT";

  // 2. Create Paper record first to obtain canonical cuid ID
  const paper = await prisma.paper.create({
    data: {
      title,
      abstract,
      status: "UPLOADED",
      isOpenAccess: false,
      sourceProvenance: {
        uploadedByUserId: userId,
        ownerId: userId,
        isPrivate: true,
        documentType,
        originalFilename: filename,
        fileSize: fileBuffer.length,
        mimeType: "application/pdf",
        institution: metadata?.institution?.trim() || null,
        researchCategory: metadata?.researchCategory?.trim() || null,
        description: metadata?.description?.trim() || null,
        uploadedAt: new Date().toISOString(),
      },
    },
  });

  const paperId = paper.id;

  try {
    // 3. Upload PDF to user-scoped private Supabase Storage path
    const uploadResult = await uploadPaperPdf(
      paperId,
      fileBuffer,
      "application/pdf",
      { userId }
    );

    // 4. Update Paper with storagePath
    await prisma.paper.update({
      where: { id: paperId },
      data: {
        storagePath: uploadResult.storagePath,
      },
    });

    // 5. Connect Authors if provided
    if (metadata?.authors && metadata.authors.trim().length > 0) {
      const authorNames = metadata.authors
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      for (let i = 0; i < authorNames.length; i++) {
        const name = authorNames[i];
        let author = await prisma.author.findFirst({
          where: { name: { equals: name, mode: "insensitive" } },
        });

        if (!author) {
          author = await prisma.author.create({
            data: {
              name,
              institution: metadata.institution?.trim() || null,
            },
          });
        }

        await prisma.paperAuthor.create({
          data: {
            paperId,
            authorId: author.id,
            orderIndex: i,
          },
        }).catch(() => {});
      }
    }

    // 6. Connect Category if provided
    if (metadata?.researchCategory && metadata.researchCategory.trim().length > 0) {
      const catName = metadata.researchCategory.trim();
      const existingCategory = await prisma.category.findFirst({
        where: { name: { equals: catName, mode: "insensitive" } },
      });

      if (existingCategory) {
        await prisma.paperCategory.create({
          data: {
            paperId,
            categoryId: existingCategory.id,
          },
        }).catch(() => {});
      }
    }

    // 7. Create Bookmark for user so it appears in their personal library
    await prisma.bookmark.create({
      data: {
        userId,
        paperId,
      },
    }).catch(() => {});

    // 8. Trigger document processing pipeline if autoProcess is enabled
    if (autoProcess) {
      try {
        await processUserDocumentPipeline(paperId, userId);
      } catch (procErr: any) {
        console.warn(`[uploadUserPrivateDocument] Auto-processing note: ${procErr.message}`);
        // Non-blocking: document is uploaded even if background processing needs retry
      }
    }

    try {
      revalidatePath("/library");
      revalidatePath("/saved");
    } catch {}

    return {
      success: true,
      paperId,
      storagePath: uploadResult.storagePath,
    };
  } catch (err: any) {
    console.error("[uploadUserPrivateDocument] Error during upload:", err);
    // Cleanup incomplete record if storage upload failed
    await prisma.paper.delete({ where: { id: paperId } }).catch(() => {});
    throw err;
  }
}

/**
 * Executes document extraction and chunk embedding for a user document.
 * Ensures strict ownership isolation and prevents duplicate concurrent runs.
 */
export async function processUserDocumentPipeline(
  paperId: string,
  userId: string
): Promise<{
  success: boolean;
  chunkCount: number;
  pageCount: number;
  isEmbedded: boolean;
  error?: string;
}> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: {
      id: true,
      title: true,
      storagePath: true,
      sourceProvenance: true,
      processingJobs: {
        where: { status: "RUNNING" },
        take: 1,
      },
    },
  });

  if (!paper) {
    throw new Error(`Document "${paperId}" not found.`);
  }

  // Ownership verification
  const prov = paper.sourceProvenance as any;
  const ownerId = prov?.uploadedByUserId || prov?.ownerId;

  // Allow document owner or system admin
  if (ownerId && ownerId !== userId) {
    const caller = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (caller?.role !== "ADMIN") {
      throw new Error("Unauthorized: You do not own this research document.");
    }
  }

  // Concurrency guard
  if (paper.processingJobs.length > 0) {
    throw new Error("Document processing is already in progress.");
  }

  // 1. Run deterministic PDF extraction & chunking
  const extractResult = await processPaperDocument(paperId, { forceReprocess: true });
  if (!extractResult.success) {
    return {
      success: false,
      chunkCount: 0,
      pageCount: 0,
      isEmbedded: false,
      error: extractResult.error,
    };
  }

  // 2. Automatically generate chunk embeddings for RAG & PDF Chat
  let isEmbedded = false;
  try {
    const embedResult = await embedPaperChunks(paperId, { force: true });
    isEmbedded = embedResult.success;
  } catch (embedErr: any) {
    console.warn(
      `[processUserDocumentPipeline] Embedding note for ${paperId}:`,
      embedErr.message
    );
  }

  try {
    revalidatePath("/library");
    revalidatePath("/saved");
    revalidatePath(`/papers/${paperId}`);
  } catch {}

  return {
    success: true,
    chunkCount: extractResult.chunkCount || 0,
    pageCount: extractResult.pageCount || 0,
    isEmbedded,
  };
}

/**
 * Removes an item from the user's research library.
 *
 * Scoped deletion semantics:
 * 1. Saved Public Paper: ONLY deletes the user's Bookmark record.
 *    The public paper, authors, citations, and chunks remain 100% intact.
 * 2. User Private Document: Deletes the user-owned PDF from Supabase Storage,
 *    and deletes the Paper record (cascading chunks, bookmarks, jobs).
 */
export async function deleteUserLibraryItem(
  userId: string,
  paperId: string
): Promise<{
  success: boolean;
  action: "REMOVED_SAVED_BOOKMARK" | "DELETED_PRIVATE_DOCUMENT";
  message: string;
}> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: {
      id: true,
      title: true,
      storagePath: true,
      sourceProvenance: true,
    },
  });

  if (!paper) {
    // If paper is already gone, check and clean up any orphan bookmark
    await prisma.bookmark.deleteMany({
      where: { userId, paperId },
    }).catch(() => {});
    return {
      success: true,
      action: "REMOVED_SAVED_BOOKMARK",
      message: "Item removed from library.",
    };
  }

  const prov = paper.sourceProvenance as any;
  const isOwner = prov?.uploadedByUserId === userId || prov?.ownerId === userId;

  if (isOwner) {
    // A: Private user document — delete file from storage and remove paper entity
    if (paper.storagePath) {
      try {
        await deletePaperPdf(paper.storagePath);
      } catch (storageErr: any) {
        console.warn(`[deleteUserLibraryItem] Storage file cleanup warning:`, storageErr.message);
      }
    }

    // Deletes paper, cascading bookmarks, chunks, conversations, and jobs
    await prisma.paper.delete({
      where: { id: paperId },
    });

    try {
      revalidatePath("/library");
      revalidatePath("/saved");
    } catch {}

    return {
      success: true,
      action: "DELETED_PRIVATE_DOCUMENT",
      message: `Private document "${paper.title}" deleted from storage and library.`,
    };
  } else {
    // B: Saved public paper — remove ONLY the bookmark
    const bookmark = await prisma.bookmark.findUnique({
      where: {
        userId_paperId: {
          userId,
          paperId,
        },
      },
    });

    if (bookmark) {
      await prisma.bookmark.delete({
        where: { id: bookmark.id },
      });
    }

    try {
      revalidatePath("/library");
      revalidatePath("/saved");
      revalidatePath(`/papers/${paperId}`);
    } catch {}

    return {
      success: true,
      action: "REMOVED_SAVED_BOOKMARK",
      message: `Saved paper "${paper.title}" removed from your library.`,
    };
  }
}

/**
 * Retrieves all items in the user's research library (both private uploads and saved papers).
 */
export async function getUserLibraryItems(userId: string): Promise<UserLibraryItem[]> {
  // 1. Fetch bookmarked papers
  const bookmarks = await prisma.bookmark.findMany({
    where: { userId },
    include: {
      paper: {
        include: {
          authors: {
            include: { author: true },
            orderBy: { orderIndex: "asc" },
          },
          categories: {
            include: { category: true },
          },
          collections: {
            where: {
              collection: {
                userId,
              },
            },
            include: {
              collection: {
                select: {
                  name: true,
                },
              },
            },
          },
          processingJobs: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          _count: {
            select: { chunks: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // 2. Fetch papers uploaded by this user
  const userUploads = await prisma.paper.findMany({
    where: {
      sourceProvenance: {
        path: ["uploadedByUserId"],
        equals: userId,
      },
    },
    include: {
      authors: {
        include: { author: true },
        orderBy: { orderIndex: "asc" },
      },
      categories: {
        include: { category: true },
      },
      collections: {
        where: {
          collection: {
            userId,
          },
        },
        include: {
          collection: {
            select: {
              name: true,
            },
          },
        },
      },
      processingJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      _count: {
        select: { chunks: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // 3. Merge & Deduplicate
  const itemMap = new Map<string, UserLibraryItem>();

  const processPaper = (paper: any, bookmarkId?: string) => {
    if (itemMap.has(paper.id)) return;

    const prov = paper.sourceProvenance as any;
    const isPrivate = prov?.uploadedByUserId === userId || prov?.ownerId === userId;
    const latestJob = paper.processingJobs?.[0];

    const authorsList = paper.authors?.map((a: any) => a.author.name) || [];
    const categoriesList = paper.categories?.map((c: any) => c.category.name) || [];
    const collectionNames: string[] =
      paper.collections?.map((cp: any) => cp.collection.name) || [];

    const item: UserLibraryItem = {
      id: paper.id,
      bookmarkId,
      title: paper.title,
      abstract: paper.abstract,
      authors: authorsList,
      institution: prov?.institution || null,
      isPrivate,
      documentType:
        prov?.documentType || (isPrivate ? "MANUSCRIPT" : "PUBLISHED_PAPER"),
      status: paper.status,
      hasPdf: Boolean(paper.storagePath || paper.pdfUrl),
      storagePath: paper.storagePath,
      pdfUrl: paper.pdfUrl || null,
      doi: paper.doi || null,
      isOpenAccess: Boolean(paper.isOpenAccess),
      isPreprint: prov?.version === "submittedVersion" || prov?.isPreprint === true,
      sourceProvenance: prov || null,
      chunkCount: paper._count?.chunks || 0,
      canChat:
        paper.status === "COMPLETED" ||
        (paper._count?.chunks > 0 && isPrivate),
      latestJobStage: latestJob?.stage || null,
      latestJobStatus: latestJob?.status || null,
      latestJobError: latestJob?.errorMessage || null,
      publicationDate: paper.publicationDate
        ? paper.publicationDate.toISOString()
        : null,
      journal: paper.journal || null,
      categories: categoriesList,
      collections: collectionNames,
      createdAt: paper.createdAt.toISOString(),
    };

    itemMap.set(paper.id, item);
  };

  // Add bookmarks first
  for (const b of bookmarks) {
    processPaper(b.paper, b.id);
  }

  // Add any uploaded papers that might not be bookmarked yet
  for (const p of userUploads) {
    processPaper(p);
  }

  return Array.from(itemMap.values());
}
