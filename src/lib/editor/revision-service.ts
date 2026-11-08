import { prisma } from "../prisma";
import { DocumentType, CitationType } from "@prisma/client";
import {
  exportDocumentAst,
  ManuscriptExportFormat,
  ExportManuscriptResult,
  calculateCountsFromContent,
  assertPaperAccess,
  acquireDocumentTransactionGuard,
} from "./document-service";

export const DEFAULT_MAX_REVISIONS = 50;

let schemaReadyCache: boolean | null = null;
let schemaReadyOverride: boolean | null = null;

/**
 * Sets an explicit schema readiness override for test environments.
 */
export function setSchemaReadyOverrideForTesting(override: boolean | null): void {
  schemaReadyOverride = override;
}

let restoreFaultHook: ((stage: "after_guard_acquired" | "after_relation_writes" | "before_commit", tx?: any) => Promise<void> | void) | null = null;
let snapshotFaultHook: ((stage: "before_insert" | "after_insert") => void) | null = null;

/**
 * Sets a fault injection hook for testing transactional rollback during restore.
 * Kept strictly external to client restore requests and public actions.
 */
export function setRestoreFaultHookForTesting(
  hook: ((stage: "after_guard_acquired" | "after_relation_writes" | "before_commit", tx?: any) => Promise<void> | void) | null
): void {
  restoreFaultHook = hook;
}

/**
 * Sets a fault injection hook for testing transactional rollback during snapshot creation.
 * Kept strictly external to client save requests and public actions.
 */
export function setSnapshotFaultHookForTesting(
  hook: ((stage: "before_insert" | "after_insert") => void) | null
): void {
  snapshotFaultHook = hook;
}

/**
 * Verifies whether the document_revisions table exists in the connected database schema.
 * Caches positive detection to avoid redundant queries during high-throughput editing.
 */
export async function isDocumentRevisionSchemaReady(txOrPrisma: any = prisma): Promise<boolean> {
  if (schemaReadyOverride !== null) {
    return schemaReadyOverride;
  }
  if (schemaReadyCache === true) {
    return true;
  }
  try {
    const result = await txOrPrisma.$queryRawUnsafe(
      `SELECT to_regclass('public.document_revisions') IS NOT NULL AS exists`
    );
    const exists = Boolean(result?.[0]?.exists);
    if (exists) {
      schemaReadyCache = true;
    }
    return exists;
  } catch {
    return false;
  }
}

/**
 * Resets the schema readiness cache (used in test suites when altering schemas).
 */
export function resetSchemaReadyCache(): void {
  schemaReadyCache = null;
}

/**
 * Returns the configurable retention limit for document revisions.
 * Defaults to 50 revisions per document.
 */
export function getRevisionRetentionLimit(): number {
  const envVal = process.env.DOCUMENT_REVISION_RETENTION_LIMIT;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_MAX_REVISIONS;
}

export interface SerializedCitationSnapshot {
  id: string;
  paperId: string;
  chunkId?: string | null;
  citationKey?: string | null;
  citationText: string;
  citationType: CitationType;
  pageNumber?: number | null;
  section?: string | null;
  prefix?: string | null;
  suffix?: string | null;
  paper?: {
    id: string;
    title: string;
    doi?: string | null;
    arxivId?: string | null;
    journal?: string | null;
    publicationDate?: string | null;
    status?: string | null;
    sourceProvenance?: string | null;
    authors?: Array<{
      orderIndex: number;
      name: string;
      author?: {
        id: string;
        name: string;
        orcid?: string | null;
      };
    }>;
  };
  chunk?: {
    id: string;
    section?: string | null;
    pageNumber?: number | null;
    text?: string | null;
  };
}

export interface SerializedLinkedPaperSnapshot {
  id: string;
  paperId: string;
  addedAt?: string | null;
  paper?: {
    id: string;
    title: string;
    doi?: string | null;
    arxivId?: string | null;
    journal?: string | null;
    publicationDate?: string | null;
    authors?: Array<{
      orderIndex?: number;
      name: string;
    }>;
  };
}

export interface CreateSnapshotOptions {
  description?: string;
  userId?: string;
  retentionLimit?: number;
}

export interface RevisionSummary {
  id: string;
  documentId: string;
  version: number;
  title: string;
  docType: DocumentType;
  wordCount: number;
  charCount: number;
  cslStyleId: string | null;
  description: string | null;
  createdAt: Date;
  createdByUserId: string | null;
  citationCount: number;
  sourceCount: number;
}

export interface RestoreRevisionInput {
  targetRevisionId: string;
  expectedCurrentVersion: number;
  description?: string;
}

export interface RestoreRevisionResult {
  success: boolean;
  restoredRevisionId: string;
  preRestoreSnapshotId: string;
  document: any;
  previousVersion: number;
  newVersion: number;
  missingReferences?: {
    citationsSkipped: number;
    linkedPapersSkipped: number;
  };
}

/**
 * Enforces the retention limit for revisions of a document.
 * Prunes the oldest revisions if the total count exceeds the limit.
 */
async function enforceRevisionRetention(
  tx: any,
  documentId: string,
  limit: number = getRevisionRetentionLimit()
): Promise<number> {
  const revisions = await tx.documentRevision.findMany({
    where: { documentId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  if (revisions.length >= limit) {
    const deleteCount = revisions.length - limit + 1;
    const toDeleteIds = revisions.slice(0, deleteCount).map((r: any) => r.id);
    if (toDeleteIds.length > 0) {
      await tx.documentRevision.deleteMany({
        where: { id: { in: toDeleteIds } },
      });
      return toDeleteIds.length;
    }
  }
  return 0;
}

/**
 * Serializes citations into a durable JSON snapshot.
 */
export function serializeCitationsForSnapshot(citations: any[] = []): SerializedCitationSnapshot[] {
  return citations.map((c: any) => ({
    id: c.id,
    paperId: c.paperId,
    chunkId: c.chunkId || null,
    citationKey: c.citationKey || null,
    citationText: c.citationText,
    citationType: c.citationType || "BIBLIOGRAPHIC",
    pageNumber: c.pageNumber || null,
    section: c.section || null,
    prefix: c.prefix || null,
    suffix: c.suffix || null,
    paper: c.paper
      ? {
          id: c.paper.id,
          title: c.paper.title,
          doi: c.paper.doi || null,
          arxivId: c.paper.arxivId || null,
          journal: c.paper.journal || null,
          publicationDate: c.paper.publicationDate
            ? new Date(c.paper.publicationDate).toISOString()
            : null,
          status: c.paper.status || null,
          sourceProvenance: c.paper.sourceProvenance || null,
          authors: Array.isArray(c.paper.authors)
            ? c.paper.authors.map((pa: any) => ({
                orderIndex: pa.orderIndex ?? 0,
                name: pa.author?.name || pa.name || "Unknown Author",
                author: pa.author
                  ? {
                      id: pa.author.id,
                      name: pa.author.name,
                      orcid: pa.author.orcid || null,
                    }
                  : undefined,
              }))
            : [],
        }
      : undefined,
    chunk: c.chunk
      ? {
          id: c.chunk.id,
          section: c.chunk.section || null,
          pageNumber: c.chunk.pageNumber || null,
          text: c.chunk.text || null,
        }
      : undefined,
  }));
}

/**
 * Serializes attached source papers into a durable JSON snapshot.
 */
export function serializeLinkedPapersForSnapshot(linkedPapers: any[] = []): SerializedLinkedPaperSnapshot[] {
  return linkedPapers.map((lp: any) => ({
    id: lp.id,
    paperId: lp.paperId,
    addedAt: lp.addedAt ? new Date(lp.addedAt).toISOString() : new Date().toISOString(),
    paper: lp.paper
      ? {
          id: lp.paper.id,
          title: lp.paper.title,
          doi: lp.paper.doi || null,
          arxivId: lp.paper.arxivId || null,
          journal: lp.paper.journal || null,
          publicationDate: lp.paper.publicationDate
            ? new Date(lp.paper.publicationDate).toISOString()
            : null,
          authors: Array.isArray(lp.paper.authors)
            ? lp.paper.authors.map((pa: any) => ({
                orderIndex: pa.orderIndex ?? 0,
                name: pa.author?.name || pa.name || "Unknown Author",
              }))
            : [],
        }
      : undefined,
  }));
}

/**
 * Creates an immutable snapshot of a document in its current state.
 * Executed atomically in database transactions prior to substantive changes or restores.
 */
export async function createDocumentRevisionSnapshot(
  tx: any,
  document: {
    id: string;
    version: number;
    title: string;
    docType: DocumentType;
    content: any;
    textContent?: string | null;
    wordCount?: number;
    charCount?: number;
    cslStyleId?: string | null;
    cslRevisionSha?: string | null;
    citations?: any[];
    linkedPapers?: any[];
  },
  options: CreateSnapshotOptions = {}
) {
  const limit = options.retentionLimit || getRevisionRetentionLimit();
  await enforceRevisionRetention(tx, document.id, limit);

  if (snapshotFaultHook) {
    snapshotFaultHook("before_insert");
  }

  const metrics =
    document.wordCount !== undefined && document.charCount !== undefined
      ? { words: document.wordCount, chars: document.charCount }
      : calculateCountsFromContent(document.content);

  const serializedCitations = serializeCitationsForSnapshot(document.citations);
  const serializedLinkedPapers = serializeLinkedPapersForSnapshot(document.linkedPapers);

  return await tx.documentRevision.create({
    data: {
      documentId: document.id,
      version: document.version,
      title: document.title || "Untitled Research Document",
      docType: document.docType || DocumentType.DRAFT,
      content: document.content ? JSON.parse(JSON.stringify(document.content)) : null,
      textContent: document.textContent || null,
      wordCount: metrics.words,
      charCount: metrics.chars,
      cslStyleId: document.cslStyleId || "apa",
      cslRevisionSha: document.cslRevisionSha || null,
      citations: serializedCitations,
      linkedPapers: serializedLinkedPapers,
      description: options.description || `Snapshot v${document.version}`,
      createdByUserId: options.userId || null,
    },
  });
}

/**
 * Lists all revisions for a research document owned by the authenticated user.
 * Sorted chronologically descending (newest version first).
 */
export async function listDocumentRevisions(
  userId: string,
  documentId: string
): Promise<RevisionSummary[]> {
  const doc = await prisma.researchDocument.findUnique({
    where: { id: documentId },
    select: { id: true, userId: true },
  });

  if (!doc || doc.userId !== userId) {
    throw new Error(`Research document '${documentId}' not found.`);
  }

  const revisions = await prisma.documentRevision.findMany({
    where: { documentId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      documentId: true,
      version: true,
      title: true,
      docType: true,
      wordCount: true,
      charCount: true,
      cslStyleId: true,
      description: true,
      createdAt: true,
      createdByUserId: true,
      citations: true,
      linkedPapers: true,
    },
  });

  return revisions.map((rev) => ({
    id: rev.id,
    documentId: rev.documentId,
    version: rev.version,
    title: rev.title,
    docType: rev.docType,
    wordCount: rev.wordCount,
    charCount: rev.charCount,
    cslStyleId: rev.cslStyleId,
    description: rev.description,
    createdAt: rev.createdAt,
    createdByUserId: rev.createdByUserId,
    citationCount: Array.isArray(rev.citations) ? rev.citations.length : 0,
    sourceCount: Array.isArray(rev.linkedPapers) ? rev.linkedPapers.length : 0,
  }));
}

/**
 * Retrieves a full revision record for read-only preview.
 * Strictly verifies document ownership.
 */
export async function getDocumentRevision(
  userId: string,
  documentId: string,
  revisionId: string
) {
  const doc = await prisma.researchDocument.findUnique({
    where: { id: documentId },
    select: { id: true, userId: true },
  });

  if (!doc || doc.userId !== userId) {
    throw new Error(`Research document '${documentId}' not found.`);
  }

  const revision = await prisma.documentRevision.findFirst({
    where: {
      id: revisionId,
      documentId,
    },
  });

  if (!revision) {
    throw new Error(`Document revision '${revisionId}' not found.`);
  }

  return revision;
}

/**
 * Restores a document to a historical revision with optimistic concurrency protection
 * and an automatic pre-restore snapshot of the current state.
 */
export async function restoreDocumentRevision(
  userId: string,
  documentId: string,
  input: RestoreRevisionInput
): Promise<RestoreRevisionResult> {
  if (
    typeof input.expectedCurrentVersion !== "number" ||
    Number.isNaN(input.expectedCurrentVersion)
  ) {
    throw new Error("expectedCurrentVersion is required for restore.");
  }

  return await prisma.$transaction(
    async (tx) => {
      // 0a. Schema readiness check
      const ready = await isDocumentRevisionSchemaReady(tx);
      if (!ready) {
        throw new Error("Document revision schema is not ready.");
      }

      // 0b. Acquire shared per-document transaction guard
      await acquireDocumentTransactionGuard(tx, documentId);

      if (restoreFaultHook) {
        await restoreFaultHook("after_guard_acquired", tx);
      }

      // 1. Fetch current document with citations and linkedPapers under guard
      const current = await tx.researchDocument.findUnique({
        where: { id: documentId },
        include: {
          citations: {
            include: {
              paper: {
                include: {
                  authors: { include: { author: true }, orderBy: { orderIndex: "asc" } },
                },
              },
              chunk: true,
            },
          },
          linkedPapers: {
            include: {
              paper: {
                include: {
                  authors: { include: { author: true }, orderBy: { orderIndex: "asc" } },
                },
              },
            },
          },
        },
      });

      if (!current || current.userId !== userId) {
        throw new Error(`Research document '${documentId}' not found.`);
      }

      // 2. Concurrency check
      if (current.version !== input.expectedCurrentVersion) {
        throw new Error(
          `CONCURRENT_SAVE_CONFLICT: Document version mismatch (expected v${input.expectedCurrentVersion}, but current is v${current.version}). Please refresh and review latest changes before restoring.`
        );
      }

      // 3. Fetch and validate target revision
      const targetRevision = await tx.documentRevision.findUnique({
        where: { id: input.targetRevisionId },
      });

      if (!targetRevision || targetRevision.documentId !== documentId) {
        throw new Error(
          `Target document revision '${input.targetRevisionId}' does not belong to document '${documentId}'.`
        );
      }

      // 4. Strict reference validation: fail-closed if any cited paper, chunk, or linked source is missing or inaccessible
      const rawCitations = Array.isArray(targetRevision.citations)
        ? (targetRevision.citations as any[])
        : [];
      const rawLinkedPapers = Array.isArray(targetRevision.linkedPapers)
        ? (targetRevision.linkedPapers as any[])
        : [];

      // Validate all cited papers and passage chunks
      for (const cit of rawCitations) {
        if (!cit.paperId) {
          throw new Error(
            `RESTORE_MISSING_REFERENCE: Cannot restore revision v${targetRevision.version}. Citation record is missing required paperId.`
          );
        }
        try {
          await assertPaperAccess(userId, cit.paperId, tx);
        } catch (err: any) {
          throw new Error(
            `RESTORE_MISSING_REFERENCE: Cannot restore revision v${targetRevision.version}. Required historical paper '${cit.paperId}' is missing or inaccessible (${err.message}).`
          );
        }

        if (cit.chunkId) {
          const chunk = await tx.paperChunk.findUnique({
            where: { id: cit.chunkId },
            select: { id: true, paperId: true },
          });
          if (!chunk || chunk.paperId !== cit.paperId) {
            throw new Error(
              `RESTORE_MISSING_REFERENCE: Cannot restore revision v${targetRevision.version}. Required historical passage chunk '${cit.chunkId}' for paper '${cit.paperId}' is missing or invalid.`
            );
          }
        }
      }

      // Validate all linked source papers
      for (const lp of rawLinkedPapers) {
        if (!lp.paperId) {
          throw new Error(
            `RESTORE_MISSING_REFERENCE: Cannot restore revision v${targetRevision.version}. Linked source record is missing required paperId.`
          );
        }
        try {
          await assertPaperAccess(userId, lp.paperId, tx);
        } catch (err: any) {
          throw new Error(
            `RESTORE_MISSING_REFERENCE: Cannot restore revision v${targetRevision.version}. Required historical linked source paper '${lp.paperId}' is missing or inaccessible (${err.message}).`
          );
        }
      }

      // Reconcile CSL Catalog Revision foreign key if present
      let verifiedCslRevisionSha: string | null = null;
      if (targetRevision.cslRevisionSha) {
        const catRev = await tx.cslCatalogRevision.findUnique({
          where: { revisionSha: targetRevision.cslRevisionSha },
          select: { revisionSha: true },
        });
        if (catRev) {
          verifiedCslRevisionSha = catRev.revisionSha;
        }
      }

      // 5. Create automatic pre-restore snapshot of current state ONLY after all validations pass
      const preRestoreSnapshot = await createDocumentRevisionSnapshot(tx, current, {
        userId,
        description:
          input.description ||
          `Automatic snapshot prior to restoring v${targetRevision.version}`,
      });

      // 6. Delete current relational citations and linked papers
      await tx.documentCitation.deleteMany({ where: { documentId } });
      await tx.documentPaper.deleteMany({ where: { documentId } });

      // 7. Re-insert validated citations
      for (const cit of rawCitations) {
        await tx.documentCitation.create({
          data: {
            documentId,
            paperId: cit.paperId,
            chunkId: cit.chunkId || null,
            citationKey: cit.citationKey || null,
            citationText: cit.citationText || "Citation",
            citationType: cit.citationType || "BIBLIOGRAPHIC",
            pageNumber: cit.pageNumber || null,
            section: cit.section || null,
            prefix: cit.prefix || null,
            suffix: cit.suffix || null,
          },
        });
      }

      // 8. Re-insert validated linked papers
      for (const lp of rawLinkedPapers) {
        await tx.documentPaper.create({
          data: {
            documentId,
            paperId: lp.paperId,
          },
        });
      }

      // Optional test fault injection hook: verify atomic rollback if failure happens after relation writes
      if (restoreFaultHook) {
        await restoreFaultHook("after_relation_writes", tx);
      }

      // 9. Atomic optimistic concurrency update
      const newVersion = current.version + 1;
      const updateResult = await tx.researchDocument.updateMany({
        where: {
          id: documentId,
          version: current.version,
        },
        data: {
          title: targetRevision.title,
          docType: targetRevision.docType,
          content: targetRevision.content as any,
          textContent: targetRevision.textContent,
          cslStyleId: targetRevision.cslStyleId,
          cslRevisionSha: verifiedCslRevisionSha,
          version: newVersion,
          updatedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        throw new Error(
          `CONCURRENT_SAVE_CONFLICT: Document was modified concurrently (expected v${current.version}). Please refresh and review latest changes before restoring.`
        );
      }

      const updatedDoc = await tx.researchDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: {
          citations: {
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
            },
          },
          linkedPapers: {
            include: {
              paper: {
                select: {
                  id: true,
                  title: true,
                  doi: true,
                },
              },
            },
          },
        },
      });

      return {
        success: true,
        restoredRevisionId: targetRevision.id,
        preRestoreSnapshotId: preRestoreSnapshot.id,
        document: updatedDoc,
        previousVersion: current.version,
        newVersion,
      };
    },
    { maxWait: 15000, timeout: 30000 }
  );
}

/**
 * Read-only export of a specific historical revision in any supported academic format.
 * Strictly non-mutating: does not alter the current document or create new revisions.
 */
export async function exportDocumentRevision(
  userId: string,
  documentId: string,
  revisionId: string,
  format: ManuscriptExportFormat = "markdown"
): Promise<ExportManuscriptResult> {
  const revision = await getDocumentRevision(userId, documentId, revisionId);

  const cleanTitle = (revision.title || "Untitled Research Document").trim();
  const slug =
    cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "manuscript";

  const rawCitations = Array.isArray(revision.citations) ? (revision.citations as any[]) : [];
  const rawLinkedPapers = Array.isArray(revision.linkedPapers) ? (revision.linkedPapers as any[]) : [];

  const virtualDoc = {
    id: revision.documentId,
    title: revision.title,
    docType: revision.docType,
    version: revision.version,
    cslStyleId: revision.cslStyleId,
    cslRevisionSha: revision.cslRevisionSha,
    content: revision.content,
    textContent: revision.textContent,
    citations: rawCitations,
    linkedPapers: rawLinkedPapers,
  };

  const exportResult = await exportDocumentAst(virtualDoc, format);
  // Qualify filename with revision version for clear archival identity
  const ext = exportResult.filename.split(".").pop();
  return {
    ...exportResult,
    filename: `${slug}-v${revision.version}.${ext}`,
  };
}
