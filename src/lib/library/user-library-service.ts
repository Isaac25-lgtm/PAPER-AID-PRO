import "server-only";
import { prisma } from "@/lib/prisma";
import { uploadPaperPdf, deletePaperPdf, isLocalPdfAvailable } from "@/lib/storage";
import { validateSafePdfUrl } from "@/lib/discovery/full-text-service";
import { processPaperDocument } from "@/lib/pdf/pipeline";
import { embedPaperChunks } from "@/lib/ai/embedding-pipeline";
import { revalidatePath } from "next/cache";
import { PaperProcessingStatus } from "@prisma/client";
import { formatMetadataText } from "@/lib/utils";
import { paperVisibilityFilter } from "@/lib/auth/paper-visibility";
import { normalizeDoi } from "@/lib/identifiers";

export const MAX_USER_PDF_SIZE_BYTES = 35 * 1024 * 1024; // 35 MB

export type UserDocumentType =
  | "RESEARCH_ARTICLE"
  | "JOURNAL_ARTICLE"
  | "THESIS"
  | "MASTERS_THESIS"
  | "DISSERTATION"
  | "PHD_DISSERTATION"
  | "UNPUBLISHED_MANUSCRIPT"
  | "MANUSCRIPT"
  | "PROPOSAL"
  | "RESEARCH_PROPOSAL"
  | "TEXTBOOK_STUDY_NOTES"
  | "LECTURE_MATERIAL"
  | "ESSAY_ASSIGNMENT"
  | "STUDENT_PAPER"
  | "TECHNICAL_REPORT"
  | "BUSINESS_REPORT"
  | "INSTITUTIONAL_REPORT"
  | "OTHER_DOCUMENT"
  | "DRAFT";

export interface UserDocumentMetadata {
  title?: string;
  authors?: string;
  institution?: string;
  researchCategory?: string;
  documentType?: UserDocumentType | string;
  description?: string;
  doi?: string;
  journal?: string;
  year?: number | string;
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
  hasLocalPdf?: boolean;
  localPdfAvailable?: boolean;
  externalPdfUrl?: string | null;
  externalLandingPageUrl?: string | null;
  storagePath?: string | null;
  pdfUrl?: string | null;
  doi?: string | null;
  arxiv?: string | null;
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
  const title = metadata?.title?.trim() || cleanFilename || "Untitled Document";
  const abstract =
    metadata?.description?.trim() ||
    `Personal document (${metadata?.documentType || "general document"}) uploaded to My Library.`;
  const documentType = (metadata?.documentType as UserDocumentType) || "OTHER_DOCUMENT";
  const canonicalDoi = normalizeDoi(metadata?.doi) || null;
  const journal = metadata?.journal?.trim() || null;
  const publicationDate = metadata?.year ? new Date(`${metadata.year}-01-01`) : null;

  // 2. Create Paper record first to obtain canonical cuid ID.
  // Private user documents NEVER occupy unique identifier columns (doi, arxivId, pmid, pmcid, semanticScholarId);
  // any DOI is stored strictly in sourceProvenance.canonicalDoi.
  const paper = await prisma.paper.create({
    data: {
      title,
      abstract,
      journal,
      publicationDate: publicationDate && !isNaN(publicationDate.getTime()) ? publicationDate : null,
      doi: null,
      arxivId: null,
      pmid: null,
      pmcid: null,
      semanticScholarId: null,
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
        canonicalDoi,
        canonicalJournal: journal,
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
 * Attaches a user-provided PDF to an existing paper (e.g. a saved METADATA_ONLY reference)
 * in the user's library.
 *
 * Guarantees (Copy-on-Write Ownership-Safe Attachment Pattern):
 * 1. If target paper is ALREADY private and owned by this user, updates it in-place.
 * 2. If target paper is a SHARED PUBLIC scholarly paper (e.g. DOI reference saved by multiple users),
 *    the shared public paper is NEVER mutated or claimed. It remains public and METADATA_ONLY.
 * 3. A private clone of the paper is created specifically for this user with canonical metadata copied,
 *    storing the PDF in user-scoped storage (research-papers/users/<userId>/papers/<privatePaperId>/original.pdf).
 * 4. Other users who saved the public paper retain their public reference without any leakage
 *    of this user's private PDF, text chunks, embeddings, summaries, or chat history.
 * 5. Neither user's upload can overwrite or alter the other user's ownership.
 * 6. Deleting the private copy never affects the shared public paper or another user's library.
 */
export async function attachPdfToExistingPaper(params: {
  userId: string;
  paperId: string;
  fileBuffer: Buffer;
  filename: string;
  autoProcess?: boolean;
}): Promise<{
  success: boolean;
  paperId: string;
  storagePath: string;
  chunkCount?: number;
  pageCount?: number;
  error?: string;
}> {
  const { userId, paperId, fileBuffer, filename, autoProcess = true } = params;

  // 1. Validate PDF signature & size
  validateUserPdfBuffer(fileBuffer);

  // 2. Fetch existing paper with authors and categories for cloning if needed
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      authors: true,
      categories: true,
    },
  });

  if (!paper) {
    throw new Error(`Target document "${paperId}" not found.`);
  }

  const existingProv = (paper.sourceProvenance as Record<string, any>) || {};
  const isAlreadyPrivateOwnedByUser =
    existingProv.isPrivate === true &&
    (existingProv.ownerId === userId || existingProv.uploadedByUserId === userId);

  let targetPaperId = paperId;
  let targetStoragePath = "";
  let isNewlyCreatedClone = false;

  if (isAlreadyPrivateOwnedByUser) {
    // Branch A: In-place update for existing private user document owned by caller
    const uploadResult = await uploadPaperPdf(
      paperId,
      fileBuffer,
      "application/pdf",
      { userId }
    );
    targetStoragePath = uploadResult.storagePath;

    const updatedProv = {
      ...existingProv,
      attachedByUserId: userId,
      ownerId: userId,
      isPrivate: true,
      canonicalDoi: paper.doi || existingProv.canonicalDoi || null,
      canonicalArxivId: paper.arxivId || existingProv.canonicalArxivId || null,
      attachedFilename: filename,
      attachedAt: new Date().toISOString(),
      hasUserSuppliedPdf: true,
    };

    await prisma.paper.update({
      where: { id: paperId },
      data: {
        doi: null,
        arxivId: null,
        pmid: null,
        pmcid: null,
        semanticScholarId: null,
        storagePath: targetStoragePath,
        status: "UPLOADED",
        sourceProvenance: updatedProv,
      },
    });

    await prisma.bookmark.upsert({
      where: {
        userId_paperId: {
          userId,
          paperId,
        },
      },
      create: {
        userId,
        paperId,
      },
      update: {},
    });
  } else {
    // Branch B: Copy-on-Write for Shared Public Scholarly Paper
    // 1. Check if caller ALREADY has an existing private clone attached to this public paper
    const existingUserClone = await prisma.paper.findFirst({
      where: {
        sourceProvenance: {
          path: ["attachedToPublicPaperId"],
          equals: paper.id,
        },
        AND: {
          sourceProvenance: {
            path: ["ownerId"],
            equals: userId,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingUserClone) {
      // Reuse existing clone (idempotent re-attach / overwrite)
      targetPaperId = existingUserClone.id;

      const uploadResult = await uploadPaperPdf(
        targetPaperId,
        fileBuffer,
        "application/pdf",
        { userId }
      );
      targetStoragePath = uploadResult.storagePath;

      const cloneProv = (existingUserClone.sourceProvenance as Record<string, any>) || {};
      await prisma.paper.update({
        where: { id: targetPaperId },
        data: {
          doi: null,
          arxivId: null,
          pmid: null,
          pmcid: null,
          semanticScholarId: null,
          storagePath: targetStoragePath,
          status: "UPLOADED",
          sourceProvenance: {
            ...cloneProv,
            canonicalDoi: existingUserClone.doi || cloneProv.canonicalDoi || paper.doi || existingProv.canonicalDoi || null,
            canonicalArxivId: existingUserClone.arxivId || cloneProv.canonicalArxivId || paper.arxivId || existingProv.canonicalArxivId || null,
            attachedFilename: filename,
            attachedAt: new Date().toISOString(),
            hasUserSuppliedPdf: true,
          },
        },
      });

      // Ensure bookmark points to the clone
      await prisma.bookmark.deleteMany({
        where: { userId, paperId: paper.id },
      }).catch(() => {});
      const existingBm = await prisma.bookmark.findUnique({
        where: { userId_paperId: { userId, paperId: targetPaperId } },
      }).catch(() => null);
      if (!existingBm) {
        await prisma.bookmark.create({
          data: { userId, paperId: targetPaperId },
        }).catch(() => {});
      }
    } else {
      // Create new private clone
      isNewlyCreatedClone = true;
      const privatePaper = await prisma.paper.create({
        data: {
          title: paper.title,
          abstract: paper.abstract,
          status: "UPLOADED",
          isOpenAccess: false,
          publicationDate: paper.publicationDate,
          journal: paper.journal,
          keywords: paper.keywords || [],
          // Omit unique fields on clone to strictly prevent PostgreSQL @unique collision
          doi: null,
          arxivId: null,
          pmid: null,
          pmcid: null,
          semanticScholarId: null,
          sourceProvenance: {
            ...existingProv,
            isPrivate: true,
            ownerId: userId,
            uploadedByUserId: userId,
            attachedByUserId: userId,
            documentType: existingProv.documentType || "RESEARCH_ARTICLE",
            attachedToPublicPaperId: paper.id,
            canonicalDoi: paper.doi || existingProv.canonicalDoi || null,
            canonicalArxivId: paper.arxivId || existingProv.canonicalArxivId || null,
            canonicalJournal: paper.journal || existingProv.canonicalJournal || null,
            attachedFilename: filename,
            attachedAt: new Date().toISOString(),
            hasUserSuppliedPdf: true,
          },
        },
      });

      targetPaperId = privatePaper.id;

      // Concurrency collision check: if another request created a clone concurrently, deduplicate
      const allClones = await prisma.paper.findMany({
        where: {
          sourceProvenance: {
            path: ["attachedToPublicPaperId"],
            equals: paper.id,
          },
          AND: {
            sourceProvenance: {
              path: ["ownerId"],
              equals: userId,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      if (allClones.length > 1) {
        const primaryClone = allClones[0];
        if (targetPaperId !== primaryClone.id) {
          // Redundant concurrent clone: delete it and adopt primary clone
          await prisma.paper.delete({ where: { id: targetPaperId } }).catch(() => {});
          targetPaperId = primaryClone.id;
          isNewlyCreatedClone = false;
        }
      }

      try {
        // Upload PDF to user-scoped storage path under targetPaperId
        const uploadResult = await uploadPaperPdf(
          targetPaperId,
          fileBuffer,
          "application/pdf",
          { userId }
        );
        targetStoragePath = uploadResult.storagePath;
      } catch (uploadErr: any) {
        // Storage upload failed: clean up newly created clone and restore original public bookmark
        if (isNewlyCreatedClone) {
          await prisma.paper.delete({ where: { id: targetPaperId } }).catch(() => {});
          await prisma.bookmark.upsert({
            where: { userId_paperId: { userId, paperId: paper.id } },
            create: { userId, paperId: paper.id },
            update: {},
          }).catch(() => {});
        }
        throw new Error(`Failed to upload PDF attachment to storage: ${uploadErr.message}`);
      }

      try {
        await prisma.paper.update({
          where: { id: targetPaperId },
          data: {
            storagePath: targetStoragePath,
          },
        });

        // Copy authors to private paper
        if (paper.authors && paper.authors.length > 0) {
          for (const pa of paper.authors) {
            await prisma.paperAuthor.create({
              data: {
                paperId: targetPaperId,
                authorId: pa.authorId,
                orderIndex: pa.orderIndex,
              },
            }).catch(() => {});
          }
        }

        // Copy categories to private paper
        if (paper.categories && paper.categories.length > 0) {
          for (const pc of paper.categories) {
            await prisma.paperCategory.create({
              data: {
                paperId: targetPaperId,
                categoryId: pc.categoryId,
              },
            }).catch(() => {});
          }
        }

        // Repoint user's bookmark from public paper to the private paper
        await prisma.bookmark.deleteMany({
          where: {
            userId,
            paperId: paper.id,
          },
        }).catch(() => {});

        const existingCloneBm = await prisma.bookmark.findUnique({
          where: { userId_paperId: { userId, paperId: targetPaperId } },
        }).catch(() => null);
        if (!existingCloneBm) {
          await prisma.bookmark.create({
            data: { userId, paperId: targetPaperId },
          }).catch(() => {});
        }
      } catch (dbErr: any) {
        // Database update failed after storage upload: purge storage file and delete clone
        if (isNewlyCreatedClone) {
          if (targetStoragePath) {
            await deletePaperPdf(targetStoragePath).catch(() => {});
          }
          await prisma.paper.delete({ where: { id: targetPaperId } }).catch(() => {});
          await prisma.bookmark.upsert({
            where: { userId_paperId: { userId, paperId: paper.id } },
            create: { userId, paperId: paper.id },
            update: {},
          }).catch(() => {});
        }
        throw new Error(`Failed to finalize document attachment in database: ${dbErr.message}`);
      }
    }
  }

  // 6. Run pipeline on the target paper if autoProcess is true
  let chunkCount = 0;
  let pageCount = 0;
  if (autoProcess) {
    try {
      const processResult = await processPaperDocument(targetPaperId, { forceReprocess: true });
      if (processResult.success) {
        chunkCount = processResult.chunkCount || 0;
        pageCount = processResult.pageCount || 0;
        try {
          await embedPaperChunks(targetPaperId, { force: true });
        } catch (embedErr: any) {
          console.warn(`[attachPdfToExistingPaper] Embedding note for ${targetPaperId}:`, embedErr.message);
        }
      }
    } catch (procErr: any) {
      console.warn(`[attachPdfToExistingPaper] Pipeline processing note for ${targetPaperId}:`, procErr.message);
    }
  }

  try {
    revalidatePath("/library");
    revalidatePath("/saved");
    revalidatePath(`/papers/${targetPaperId}`);
    revalidatePath(`/papers/${paperId}`);
    revalidatePath("/");
  } catch {}

  return {
    success: true,
    paperId: targetPaperId,
    storagePath: targetStoragePath,
    chunkCount,
    pageCount,
  };
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
  const ownerId = prov?.uploadedByUserId || prov?.ownerId || prov?.attachedByUserId;

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
    where: {
      userId,
      paper: paperVisibilityFilter(userId),
    },
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
    const isPrivate =
      prov?.uploadedByUserId === userId ||
      prov?.ownerId === userId ||
      prov?.attachedByUserId === userId;
    const latestJob = paper.processingJobs?.[0];

    const authorsList = paper.authors?.map((a: any) => a.author.name) || [];
    const categoriesList = paper.categories?.map((c: any) => c.category.name) || [];
    const collectionNames: string[] =
      paper.collections?.map((cp: any) => cp.collection.name) || [];

    // Distinct Availability Semantics:
    // 1. Local storage check (zero network overhead, instant synchronous disk/memory lookup)
    const localPdfAvailable = isLocalPdfAvailable(paper.storagePath);

    // 2. Verified external reading links (strictly separating direct PDF endpoints from article landing pages)
    let externalPdfUrl: string | null = null;
    let externalLandingPageUrl: string | null = null;

    const hasExternalAccess =
      !isPrivate &&
      (paper.isOpenAccess === true ||
        prov?.isLawfulOpenAccess === true ||
        prov?.isPublicOpenAccess === true ||
        prov?.scholarlyClassification === "READING_LINK_ONLY" ||
        prov?.sourceResolution?.permissions?.canReadDirectly === true);

    if (hasExternalAccess) {
      // 2a. Direct PDF candidates (must point to a PDF resource, not an HTML landing page)
      const directPdfCandidates: (string | null | undefined)[] = [
        prov?.openAccessPdfUrl,
        prov?.originalPdfUrl,
        prov?.externalPdfUrl,
        prov?.sourceResolution?.bestCandidate?.pdfUrl,
        paper.pdfUrl && !paper.pdfUrl.includes("/api/papers/") && !paper.pdfUrl.includes(".supabase.co/storage/")
          ? paper.pdfUrl
          : null,
      ];

      for (const candidate of directPdfCandidates) {
        if (!candidate || typeof candidate !== "string" || !candidate.startsWith("https://")) {
          continue;
        }
        const isPdfTarget =
          candidate.toLowerCase().includes(".pdf") ||
          candidate.includes("blobtype=pdf") ||
          candidate.includes("/pdf/") ||
          candidate === prov?.openAccessPdfUrl ||
          candidate === prov?.originalPdfUrl;

        if (isPdfTarget && validateSafePdfUrl(candidate).safe) {
          externalPdfUrl = candidate;
          break;
        }
      }

      // 2b. Article Landing Page candidates (for viewing the article externally in a browser)
      const landingCandidates: (string | null | undefined)[] = [
        prov?.externalLandingPageUrl,
        prov?.sourceResolution?.bestCandidate?.landingPageUrl,
        prov?.externalUrl,
        paper.doi ? `https://doi.org/${paper.doi}` : null,
      ];

      for (const candidate of landingCandidates) {
        if (!candidate || typeof candidate !== "string" || !candidate.startsWith("https://")) {
          continue;
        }
        if (validateSafePdfUrl(candidate).safe) {
          externalLandingPageUrl = candidate;
          break;
        }
      }
    }

    const item: UserLibraryItem = {
      id: paper.id,
      bookmarkId,
      title: formatMetadataText(paper.title),
      abstract: paper.abstract,
      authors: authorsList,
      institution: prov?.institution || null,
      isPrivate,
      documentType:
        prov?.documentType || (isPrivate ? "OTHER_DOCUMENT" : "PUBLISHED_PAPER"),
      status: paper.status,
      hasPdf: Boolean(localPdfAvailable || externalPdfUrl),
      hasLocalPdf: localPdfAvailable,
      localPdfAvailable,
      externalPdfUrl,
      externalLandingPageUrl,
      storagePath: paper.storagePath,
      pdfUrl: localPdfAvailable ? `/api/papers/${paper.id}/pdf` : (externalPdfUrl || null),
      doi: paper.doi || prov?.canonicalDoi || null,
      arxiv: paper.arxivId || prov?.arxivId || null,
      isOpenAccess: Boolean(paper.isOpenAccess),
      isPreprint: prov?.version === "submittedVersion" || prov?.isPreprint === true,
      sourceProvenance: prov || null,
      chunkCount: paper._count?.chunks || 0,
      canChat:
        paper.status === "COMPLETED" ||
        (paper.status === "TEXT_EXTRACTED" && paper._count?.chunks > 0) ||
        (paper._count?.chunks > 0 && isPrivate) ||
        (paper._count?.chunks > 0 && prov?.attachedByUserId === userId),
      latestJobStage: latestJob?.stage || null,
      latestJobStatus: latestJob?.status || null,
      latestJobError: latestJob?.errorMessage || null,
      publicationDate: paper.publicationDate
        ? paper.publicationDate.toISOString()
        : null,
      journal: formatMetadataText(paper.journal || prov?.canonicalJournal) || null,
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
