import { prisma } from "../prisma";
import { CitationType, DocumentType } from "@prisma/client";

export interface CreateDocumentInput {
  title?: string;
  docType?: DocumentType;
  initialContent?: any;
}

export interface UpdateDocumentInput {
  title?: string;
  content?: any;
  textContent?: string;
  docType?: DocumentType;
  expectedVersion?: number;
}

export interface InsertCitationInput {
  paperId: string;
  chunkId?: string;
  citationKey?: string;
  citationText: string;
  citationType?: CitationType;
  pageNumber?: number;
  section?: string;
  prefix?: string;
  suffix?: string;
}

/**
 * Creates a default TipTap JSON document structure.
 */
export function createDefaultTipTapContent(title: string) {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: title || "Untitled Research Document" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Start drafting your research manuscript, literature review, or grant proposal here...",
          },
        ],
      },
    ],
  };
}

/**
 * Helper to check if a paper is accessible to a user.
 * Reuses existing multi-tenant privacy and benchmark fixture quarantine rules.
 */
export async function assertPaperAccess(userId: string, paperId: string): Promise<boolean> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: {
      id: true,
      sourceProvenance: true,
      rawMetadata: true,
    },
  });

  if (!paper) {
    throw new Error(`Paper '${paperId}' not found or inaccessible.`);
  }

  const provenance = (paper.sourceProvenance as any) || {};
  const rawMeta = (paper.rawMetadata as any) || {};

  // Check benchmark fixture quarantine (admin only)
  const isFixture = provenance.isBenchmarkFixture === true || rawMeta.adminOnly === true;
  if (isFixture) {
    // Regular users are forbidden from viewing or attaching benchmark fixtures
    throw new Error(`Paper '${paperId}' is a quarantined benchmark fixture and cannot be accessed.`);
  }

  // Check private document ownership
  const isPrivate = provenance.isPrivate === true || provenance.ownerUserId !== undefined;
  if (isPrivate) {
    const ownerId = provenance.ownerUserId || provenance.userId;
    if (ownerId && ownerId !== userId) {
      throw new Error(`Paper '${paperId}' is a private manuscript belonging to another researcher.`);
    }
  }

  return true;
}

/**
 * Creates a new research document belonging to the authenticated user.
 */
export async function createResearchDocument(
  userId: string,
  input: CreateDocumentInput = {}
) {
  const title = (input.title || "").trim() || "Untitled Research Document";
  const docType = input.docType || DocumentType.DRAFT;
  const content = input.initialContent || createDefaultTipTapContent(title);
  const textContent = `${title}\nStart drafting your research manuscript...`;

  return await prisma.researchDocument.create({
    data: {
      userId,
      title,
      docType,
      content,
      textContent,
      version: 1,
    },
  });
}

/**
 * Fetches a research document by ID with strict ownership verification.
 */
export async function getResearchDocument(userId: string, documentId: string) {
  const document = await prisma.researchDocument.findUnique({
    where: { id: documentId },
    include: {
      citations: {
        orderBy: { createdAt: "asc" },
        include: {
          paper: {
            select: {
              id: true,
              title: true,
              doi: true,
              arxivId: true,
              journal: true,
              publicationDate: true,
              status: true,
              authors: {
                include: { author: true },
                orderBy: { orderIndex: "asc" },
              },
            },
          },
          chunk: {
            select: {
              id: true,
              section: true,
              pageNumber: true,
              text: true,
            },
          },
        },
      },
      linkedPapers: {
        orderBy: { addedAt: "desc" },
        include: {
          paper: {
            select: {
              id: true,
              title: true,
              abstract: true,
              doi: true,
              arxivId: true,
              journal: true,
              publicationDate: true,
              status: true,
              authors: {
                include: { author: true },
                orderBy: { orderIndex: "asc" },
              },
              categories: {
                include: { category: true },
              },
              _count: {
                select: { chunks: true },
              },
            },
          },
        },
      },
    },
  });

  if (!document || document.userId !== userId) {
    throw new Error(`Research document '${documentId}' not found.`);
  }

  return document;
}

/**
 * Lists all research documents owned by the authenticated user.
 */
export async function listResearchDocuments(userId: string) {
  return await prisma.researchDocument.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        select: {
          citations: true,
          linkedPapers: true,
        },
      },
    },
  });
}

/**
 * Updates a document's content, title, or metadata with optimistic concurrency protection.
 */
export async function updateResearchDocument(
  userId: string,
  documentId: string,
  updates: UpdateDocumentInput
) {
  const existing = await prisma.researchDocument.findUnique({
    where: { id: documentId },
    select: { id: true, userId: true, version: true },
  });

  if (!existing || existing.userId !== userId) {
    throw new Error(`Research document '${documentId}' not found.`);
  }

  // Optimistic concurrency control: block concurrent overwrites
  if (
    typeof updates.expectedVersion === "number" &&
    existing.version !== updates.expectedVersion
  ) {
    throw new Error(
      `CONCURRENT_SAVE_CONFLICT: Document version mismatch (expected v${updates.expectedVersion}, but current is v${existing.version}). Please reload latest changes.`
    );
  }

  const dataToUpdate: any = {
    version: { increment: 1 },
  };

  if (updates.title !== undefined) {
    dataToUpdate.title = updates.title.trim() || "Untitled Research Document";
  }
  if (updates.content !== undefined) {
    dataToUpdate.content = updates.content;
  }
  if (updates.textContent !== undefined) {
    dataToUpdate.textContent = updates.textContent;
  }
  if (updates.docType !== undefined) {
    dataToUpdate.docType = updates.docType;
  }

  return await prisma.researchDocument.update({
    where: { id: documentId },
    data: dataToUpdate,
  });
}

/**
 * Renames a research document.
 */
export async function renameResearchDocument(
  userId: string,
  documentId: string,
  newTitle: string
) {
  const title = (newTitle || "").trim() || "Untitled Research Document";
  return await updateResearchDocument(userId, documentId, { title });
}

/**
 * Deletes a research document with cascading citations and relations.
 */
export async function deleteResearchDocument(userId: string, documentId: string) {
  const existing = await prisma.researchDocument.findUnique({
    where: { id: documentId },
    select: { id: true, userId: true },
  });

  if (!existing || existing.userId !== userId) {
    throw new Error(`Research document '${documentId}' not found.`);
  }

  return await prisma.researchDocument.delete({
    where: { id: documentId },
  });
}

/**
 * Attaches an accessible research paper from My Library to the document's sources tray.
 */
export async function attachDocumentPaper(
  userId: string,
  documentId: string,
  paperId: string
) {
  // 1. Verify document ownership
  const doc = await prisma.researchDocument.findUnique({
    where: { id: documentId },
    select: { id: true, userId: true },
  });
  if (!doc || doc.userId !== userId) {
    throw new Error(`Research document '${documentId}' not found.`);
  }

  // 2. Verify user has authorization to access this paper
  await assertPaperAccess(userId, paperId);

  // 3. Link paper to document
  return await prisma.documentPaper.upsert({
    where: {
      documentId_paperId: {
        documentId,
        paperId,
      },
    },
    update: {},
    create: {
      documentId,
      paperId,
    },
  });
}

/**
 * Detaches a research paper from the document's sources tray.
 */
export async function detachDocumentPaper(
  userId: string,
  documentId: string,
  paperId: string
) {
  const doc = await prisma.researchDocument.findUnique({
    where: { id: documentId },
    select: { id: true, userId: true },
  });
  if (!doc || doc.userId !== userId) {
    throw new Error(`Research document '${documentId}' not found.`);
  }

  return await prisma.documentPaper.deleteMany({
    where: {
      documentId,
      paperId,
    },
  });
}

/**
 * Inserts a verifiable citation record linking to a research paper or exact passage.
 */
export async function insertDocumentCitation(
  userId: string,
  documentId: string,
  input: InsertCitationInput
) {
  // 1. Verify document ownership
  const doc = await prisma.researchDocument.findUnique({
    where: { id: documentId },
    select: { id: true, userId: true },
  });
  if (!doc || doc.userId !== userId) {
    throw new Error(`Research document '${documentId}' not found.`);
  }

  // 2. Verify user has authorization to access this paper
  await assertPaperAccess(userId, input.paperId);

  // 3. If chunkId provided, verify it belongs strictly to this paper
  if (input.chunkId) {
    const chunk = await prisma.paperChunk.findUnique({
      where: { id: input.chunkId },
      select: { paperId: true },
    });
    if (!chunk || chunk.paperId !== input.paperId) {
      throw new Error(
        `Chunk '${input.chunkId}' does not belong to paper '${input.paperId}'. Provenance mismatch.`
      );
    }
  }

  // 4. Ensure paper is in linkedPapers tray
  await prisma.documentPaper.upsert({
    where: {
      documentId_paperId: {
        documentId,
        paperId: input.paperId,
      },
    },
    update: {},
    create: {
      documentId,
      paperId: input.paperId,
    },
  });

  // 5. Create citation
  return await prisma.documentCitation.create({
    data: {
      documentId,
      paperId: input.paperId,
      chunkId: input.chunkId || null,
      citationKey: input.citationKey || null,
      citationText: input.citationText,
      citationType: input.citationType || (input.chunkId ? CitationType.PASSAGE_VERIFIED : CitationType.BIBLIOGRAPHIC),
      pageNumber: input.pageNumber || null,
      section: input.section || null,
      prefix: input.prefix || null,
      suffix: input.suffix || null,
    },
    include: {
      paper: {
        select: {
          id: true,
          title: true,
          doi: true,
          journal: true,
          publicationDate: true,
        },
      },
      chunk: {
        select: {
          id: true,
          section: true,
          pageNumber: true,
          text: true,
        },
      },
    },
  });
}

/**
 * Deletes a document citation.
 */
export async function deleteDocumentCitation(
  userId: string,
  documentId: string,
  citationId: string
) {
  const doc = await prisma.researchDocument.findUnique({
    where: { id: documentId },
    select: { id: true, userId: true },
  });
  if (!doc || doc.userId !== userId) {
    throw new Error(`Research document '${documentId}' not found.`);
  }

  return await prisma.documentCitation.delete({
    where: { id: citationId },
  });
}
