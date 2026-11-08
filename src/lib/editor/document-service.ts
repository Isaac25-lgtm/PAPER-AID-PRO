import { prisma } from "../prisma";
import { CitationType, DocumentType } from "@prisma/client";
import { createDocumentRevisionSnapshot, isDocumentRevisionSchemaReady } from "./revision-service";
import { areTipTapNodesEqual } from "./content-sanitizer";
import { ADMIN_TEST_FIXTURE_IDS } from "../auth/paper-authorization";
import {
  GuidedDocumentConfig,
  createGuidedTipTapContent,
} from "./guided-templates";
import {
  mapReferenceToCslJson,
  exportMultipleToBibTeX,
  exportMultipleToRIS,
  stripHtmlTags,
  decodeHtmlEntities,
  createCiteprocEngine,
  renderBibliography,
  BUNDLED_STYLES,
} from "../citations/csl";
import { exportTipTapToDocx, resolveBibliographyHeading } from "./docx-exporter";
import {
  exportTipTapToPdf,
  reconcileExportTipTapAst,
  REFERENCES_GUIDANCE_TEXT,
  getNodeText,
} from "./pdf-exporter";

export interface CreateDocumentInput {
  title?: string;
  docType?: DocumentType;
  initialContent?: any;
  guidedConfig?: GuidedDocumentConfig;
}

export interface UpdateDocumentInput {
  title?: string;
  content?: any;
  textContent?: string;
  docType?: DocumentType;
  expectedVersion?: number;
  guidedMeta?: any;
  description?: string;
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
export async function assertPaperAccess(
  userId: string,
  paperId: string,
  client: any = prisma
): Promise<boolean> {
  const paper = await client.paper.findUnique({
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
  const isFixture =
    ADMIN_TEST_FIXTURE_IDS.has(paperId) ||
    provenance.isBenchmarkFixture === true ||
    rawMeta.adminOnly === true;
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
  let title = (input.title || "").trim();
  let docType = input.docType || DocumentType.DRAFT;
  let content = input.initialContent;
  let textContent = "";

  if (input.guidedConfig) {
    title = (input.guidedConfig.topic || "").trim() || "Untitled Guided Document";
    docType = input.guidedConfig.docType || DocumentType.MANUSCRIPT;
    content = createGuidedTipTapContent(input.guidedConfig);
    const objText = input.guidedConfig.generalObjective ? `Objective: ${input.guidedConfig.generalObjective}` : "";
    const headingsText = (input.guidedConfig.headings || []).join("\n");
    textContent = `${title}\n${objText}\n${headingsText}`;
  } else {
    title = title || "Untitled Research Document";
    content = content || createDefaultTipTapContent(title);
    textContent = `${title}\nStart drafting your research manuscript...`;
  }

  const initialStyleId = (content as any)?.meta?.citationStyle || "apa";
  const initialRevisionSha = (content as any)?.meta?.citationStyleRevision || "v1.0.2-baseline-catalog";

  return await prisma.researchDocument.create({
    data: {
      userId,
      title,
      docType,
      content,
      textContent,
      version: 1,
      cslStyleId: initialStyleId,
      cslRevisionSha: initialRevisionSha,
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
              sourceProvenance: true,
              rawMetadata: true,
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
              sourceProvenance: true,
              rawMetadata: true,
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
 * Acquires an exclusive row-level lock on the research document within an interactive transaction.
 * Ensures that saves, restores, citations, and source mutations are serialized per document.
 */
export async function acquireDocumentTransactionGuard(
  tx: any,
  documentId: string
): Promise<{ id: string; version: number }> {
  const rows = await tx.$queryRawUnsafe(
    `SELECT id, version FROM "research_documents" WHERE id = $1 FOR UPDATE`,
    documentId
  );
  if (!rows || rows.length === 0) {
    throw new Error(`Research document '${documentId}' not found.`);
  }
  return { id: rows[0].id, version: Number(rows[0].version) };
}

/**
 * Updates a document's content, title, or metadata with optimistic concurrency protection.
 */
export async function updateResearchDocument(
  userId: string,
  documentId: string,
  updates: UpdateDocumentInput
) {
  return await prisma.$transaction(
    async (tx) => {
      // 0. Acquire per-document transaction guard
      await acquireDocumentTransactionGuard(tx, documentId);

      // 1. Read current state inside transaction with relations
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

      // 2. Optimistic concurrency control: block concurrent overwrites
      if (
        typeof updates.expectedVersion === "number" &&
        current.version !== updates.expectedVersion
      ) {
        throw new Error(
          `CONCURRENT_SAVE_CONFLICT: Document version mismatch (expected v${updates.expectedVersion}, but current is v${current.version}). Please reload latest changes.`
        );
      }

      const incomingTitle =
        updates.title !== undefined ? updates.title.trim() || "Untitled Research Document" : undefined;
      const isTitleChanged = incomingTitle !== undefined && incomingTitle !== current.title;
      const isDocTypeChanged = updates.docType !== undefined && updates.docType !== current.docType;
      const isTextContentChanged =
        updates.textContent !== undefined && updates.textContent !== current.textContent;

      let isContentChanged = false;
      let finalContent = current.content;
      let newStyleId: string | undefined = undefined;
      let newStyleSha: string | undefined = undefined;

      if (updates.content !== undefined || updates.guidedMeta !== undefined) {
        let candidateContent = updates.content !== undefined ? updates.content : current.content;
        const existingMeta = (current.content as any)?.meta;
        const incomingMeta =
          updates.guidedMeta !== undefined
            ? updates.guidedMeta
            : candidateContent && typeof candidateContent === "object"
            ? (candidateContent as any).meta
            : undefined;

        const mergedMeta = incomingMeta || existingMeta;

        if (mergedMeta && candidateContent && typeof candidateContent === "object") {
          candidateContent = {
            ...(candidateContent as any),
            meta: mergedMeta,
          };
          if (mergedMeta.citationStyle) {
            newStyleId = mergedMeta.citationStyle;
          }
          if (mergedMeta.citationStyleRevision) {
            newStyleSha = mergedMeta.citationStyleRevision;
          }
        }
        finalContent = candidateContent;
        if (!areTipTapNodesEqual(candidateContent, current.content)) {
          isContentChanged = true;
        }
      }

      const isStyleChanged =
        (newStyleId !== undefined && newStyleId !== current.cslStyleId) ||
        (newStyleSha !== undefined && newStyleSha !== current.cslRevisionSha);

      // No-op detection: return current document without incrementing version or taking duplicate snapshot
      if (
        !isTitleChanged &&
        !isDocTypeChanged &&
        !isTextContentChanged &&
        !isContentChanged &&
        !isStyleChanged
      ) {
        return current;
      }

      // 3. Create pre-change snapshot from current state inside tx if schema is ready
      const schemaReady = await isDocumentRevisionSchemaReady(tx);
      if (schemaReady) {
        // Any unexpected snapshot creation failure intentionally throws to rollback tx
        await createDocumentRevisionSnapshot(tx, current, {
          userId,
          description: updates.description || `Autosave before v${current.version + 1}`,
        });
      }

      const dataToUpdate: any = {
        version: current.version + 1,
        updatedAt: new Date(),
      };

      if (isTitleChanged) {
        dataToUpdate.title = incomingTitle;
      }
      if (isDocTypeChanged) {
        dataToUpdate.docType = updates.docType;
      }
      if (isTextContentChanged) {
        dataToUpdate.textContent = updates.textContent;
      }
      if (isContentChanged || updates.content !== undefined || updates.guidedMeta !== undefined) {
        dataToUpdate.content = finalContent;
      }
      if (newStyleId) {
        dataToUpdate.cslStyleId = newStyleId;
      }
      if (newStyleSha) {
        // Validate against csl_catalog_revisions if present
        const catRev = await tx.cslCatalogRevision.findUnique({
          where: { revisionSha: newStyleSha },
          select: { revisionSha: true },
        });
        if (catRev) {
          dataToUpdate.cslRevisionSha = newStyleSha;
        }
      }

      // 4. Atomic conditional update: guarantee that losing concurrent race returns 0 rows updated
      const updateResult = await tx.researchDocument.updateMany({
        where: {
          id: documentId,
          version: current.version,
        },
        data: dataToUpdate,
      });

      if (updateResult.count === 0) {
        throw new Error(
          `CONCURRENT_SAVE_CONFLICT: Document was modified concurrently (expected v${current.version}). Please reload latest changes.`
        );
      }

      return await tx.researchDocument.findUniqueOrThrow({
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
    },
    { maxWait: 15000, timeout: 30000 }
  );
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
 * Coordinated under the shared per-document transaction guard.
 */
export async function attachDocumentPaper(
  userId: string,
  documentId: string,
  paperId: string
) {
  return await prisma.$transaction(
    async (tx) => {
      // 0. Acquire per-document transaction guard
      await acquireDocumentTransactionGuard(tx, documentId);

      // 1. Verify document ownership
      const doc = await tx.researchDocument.findUnique({
        where: { id: documentId },
        select: { id: true, userId: true },
      });
      if (!doc || doc.userId !== userId) {
        throw new Error(`Research document '${documentId}' not found.`);
      }

      // 2. Verify user has authorization to access this paper
      await assertPaperAccess(userId, paperId, tx);

      // 3. Link paper to document
      return await tx.documentPaper.upsert({
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
    },
    { maxWait: 15000, timeout: 30000 }
  );
}

/**
 * Detaches a research paper from the document's sources tray.
 * Coordinated under the shared per-document transaction guard.
 */
export async function detachDocumentPaper(
  userId: string,
  documentId: string,
  paperId: string
) {
  return await prisma.$transaction(
    async (tx) => {
      // 0. Acquire per-document transaction guard
      await acquireDocumentTransactionGuard(tx, documentId);

      const doc = await tx.researchDocument.findUnique({
        where: { id: documentId },
        select: { id: true, userId: true },
      });
      if (!doc || doc.userId !== userId) {
        throw new Error(`Research document '${documentId}' not found.`);
      }

      return await tx.documentPaper.deleteMany({
        where: {
          documentId,
          paperId,
        },
      });
    },
    { maxWait: 15000, timeout: 30000 }
  );
}

/**
 * Inserts a verifiable citation record linking to a research paper or exact passage.
 * Coordinated under the shared per-document transaction guard.
 */
export async function insertDocumentCitation(
  userId: string,
  documentId: string,
  input: InsertCitationInput
) {
  if (!input.paperId || input.paperId.trim() === "" || input.paperId === "unknown-ref") {
    throw new Error("A valid paperId is required to create a document citation.");
  }

  return await prisma.$transaction(
    async (tx) => {
      // 0. Acquire per-document transaction guard
      await acquireDocumentTransactionGuard(tx, documentId);

      // 1. Verify document ownership
      const doc = await tx.researchDocument.findUnique({
        where: { id: documentId },
        select: { id: true, userId: true },
      });
      if (!doc || doc.userId !== userId) {
        throw new Error(`Research document '${documentId}' not found.`);
      }

      // 2. Verify user has authorization to access this paper
      await assertPaperAccess(userId, input.paperId, tx);

      // 3. If chunkId provided, verify it belongs strictly to this paper
      let verifiedChunkId: string | null = null;
      if (input.chunkId) {
        const chunk = await tx.paperChunk.findUnique({
          where: { id: input.chunkId },
          select: { paperId: true },
        });
        if (!chunk || chunk.paperId !== input.paperId) {
          throw new Error(
            `Chunk '${input.chunkId}' does not belong to paper '${input.paperId}'. Provenance mismatch.`
          );
        }
        verifiedChunkId = input.chunkId;
      }

      // 4. Ensure paper is in linkedPapers tray
      await tx.documentPaper.upsert({
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

      // 5. Enforce passage-verified distinction:
      // A citation can ONLY be PASSAGE_VERIFIED if an authenticated, valid chunk is linked.
      const finalCitationType = verifiedChunkId
        ? (input.citationType || CitationType.PASSAGE_VERIFIED)
        : CitationType.BIBLIOGRAPHIC;

      // 6. Create citation
      return await tx.documentCitation.create({
        data: {
          documentId,
          paperId: input.paperId,
          chunkId: verifiedChunkId,
          citationKey: input.citationKey || null,
          citationText: input.citationText,
          citationType: finalCitationType,
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
    },
    { maxWait: 15000, timeout: 30000 }
  );
}

/**
 * Deletes a document citation.
 * Coordinated under the shared per-document transaction guard.
 */
export async function deleteDocumentCitation(
  userId: string,
  documentId: string,
  citationId: string
) {
  return await prisma.$transaction(
    async (tx) => {
      // 0. Acquire per-document transaction guard
      await acquireDocumentTransactionGuard(tx, documentId);

      const doc = await tx.researchDocument.findUnique({
        where: { id: documentId },
        select: { id: true, userId: true },
      });
      if (!doc || doc.userId !== userId) {
        throw new Error(`Research document '${documentId}' not found.`);
      }

      const cit = await tx.documentCitation.findUnique({
        where: { id: citationId },
        select: { documentId: true },
      });
      if (!cit || cit.documentId !== documentId) {
        throw new Error(`Citation '${citationId}' does not belong to document '${documentId}'.`);
      }

      return await tx.documentCitation.delete({
        where: { id: citationId },
      });
    },
    { maxWait: 15000, timeout: 30000 }
  );
}

export const addDocumentCitation = insertDocumentCitation;
 
export type ManuscriptExportFormat =
  | "markdown"
  | "text"
  | "html"
  | "bibtex"
  | "ris"
  | "json"
  | "docx"
  | "pdf";

export interface ExportManuscriptResult {
  documentId: string;
  title: string;
  format: ManuscriptExportFormat;
  mimeType: string;
  filename: string;
  content: string;
  isBinary?: boolean;
  citationCount: number;
  sourceCount: number;
  exportedAt: string;
  unsupportedNodes?: string[];
}

/**
 * Serializes TipTap JSON document node tree into formatted Markdown.
 */
function serializeNodeToMarkdown(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;

  if (node.type === "text") {
    let t = node.text || "";
    if (Array.isArray(node.marks)) {
      for (const m of node.marks) {
        if (m.type === "bold") t = `**${t}**`;
        if (m.type === "italic") t = `*${t}*`;
        if (m.type === "code") t = `\`${t}\``;
      }
    }
    return t;
  }

  if (node.type === "citation") {
    return node.attrs?.renderedText || "(Citation)";
  }

  const childContent = Array.isArray(node.content)
    ? node.content.map(serializeNodeToMarkdown).join("")
    : "";

  switch (node.type) {
    case "doc":
      return Array.isArray(node.content)
        ? node.content.map(serializeNodeToMarkdown).join("\n\n")
        : "";
    case "heading": {
      const level = node.attrs?.level || 1;
      return `${"#".repeat(level)} ${childContent}`;
    }
    case "paragraph":
      return childContent;
    case "blockquote":
      return `> ${childContent.replace(/\n/g, "\n> ")}`;
    case "bulletList":
      return Array.isArray(node.content)
        ? node.content.map((li: any) => `- ${serializeNodeToMarkdown(li).trim()}`).join("\n")
        : "";
    case "orderedList":
      return Array.isArray(node.content)
        ? node.content
            .map((li: any, idx: number) => `${idx + 1}. ${serializeNodeToMarkdown(li).trim()}`)
            .join("\n")
        : "";
    case "listItem":
      return childContent;
    case "table": {
      if (!Array.isArray(node.content) || node.content.length === 0) return "";
      const rows = node.content;
      const mdRows: string[] = [];
      rows.forEach((rowNode: any, rIdx: number) => {
        if (!Array.isArray(rowNode.content)) return;
        const cells = rowNode.content.map((cell: any) =>
          serializeNodeToMarkdown(cell).replace(/\n+/g, " ").trim()
        );
        mdRows.push(`| ${cells.join(" | ")} |`);
        if (rIdx === 0) {
          mdRows.push(`| ${new Array(cells.length).fill("---").join(" | ")} |`);
        }
      });
      return mdRows.join("\n");
    }
    case "tableRow":
    case "tableCell":
    case "tableHeader":
      return childContent;
    case "bibliography": {
      const entries: string[] = node.attrs?.entries || [];
      const title = resolveBibliographyHeading(node.attrs?.styleId, node.attrs?.styleTitle);
      if (entries.length === 0) return "";
      const formatted = entries
        .map((e, idx) => `${idx + 1}. ${decodeHtmlEntities(stripHtmlTags(e))}`)
        .join("\n\n");
      return `## ${title}\n\n${formatted}`;
    }
    default:
      return childContent;
  }
}

/**
 * Serializes TipTap JSON document node tree into semantic academic HTML.
 */
function serializeNodeToHtml(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;

  if (node.type === "text") {
    let t = (node.text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    if (Array.isArray(node.marks)) {
      for (const m of node.marks) {
        if (m.type === "bold") t = `<strong>${t}</strong>`;
        if (m.type === "italic") t = `<em>${t}</em>`;
        if (m.type === "underline") t = `<u>${t}</u>`;
        if (m.type === "code") t = `<code>${t}</code>`;
      }
    }
    return t;
  }

  if (node.type === "citation") {
    const text = node.attrs?.renderedText || "(Citation)";
    const cid = node.attrs?.citationId || "";
    return `<cite class="csl-citation" data-citation-id="${cid}">${text}</cite>`;
  }

  const childHtml = Array.isArray(node.content)
    ? node.content.map(serializeNodeToHtml).join("")
    : "";

  switch (node.type) {
    case "doc":
      return Array.isArray(node.content)
        ? node.content.map(serializeNodeToHtml).join("\n")
        : "";
    case "heading": {
      const level = node.attrs?.level || 1;
      return `<h${level}>${childHtml}</h${level}>`;
    }
    case "paragraph":
      return `<p>${childHtml}</p>`;
    case "blockquote":
      return `<blockquote>${childHtml}</blockquote>`;
    case "bulletList":
      return `<ul>${childHtml}</ul>`;
    case "orderedList":
      return `<ol>${childHtml}</ol>`;
    case "listItem":
      return `<li>${childHtml}</li>`;
    case "table":
      return `<table class="academic-table">${childHtml}</table>`;
    case "tableRow":
      return `<tr>${childHtml}</tr>`;
    case "tableHeader":
      return `<th>${childHtml}</th>`;
    case "tableCell":
      return `<td>${childHtml}</td>`;
    case "bibliography": {
      const entries: string[] = node.attrs?.entries || [];
      const title = resolveBibliographyHeading(node.attrs?.styleId, node.attrs?.styleTitle);
      if (entries.length === 0) return "";
      const listItems = entries.map((e) => `<li>${e}</li>`).join("\n");
      return `<section class="manuscript-references"><h2>${title}</h2><ol>${listItems}</ol></section>`;
    }
    default:
      return childHtml;
  }
}

export {
  getNodeText as extractPlainTextFromTipTapNode,
  isReferencesHeadingNode,
  isPlaceholderParagraphNode,
  reconcileExportTipTapAst,
} from "./pdf-exporter";

/**
 * Calculates word and character count directly from a TipTap AST node.
 */
export function calculateCountsFromContent(content: any): { words: number; chars: number } {
  if (!content) return { words: 0, chars: 0 };
  const text = getNodeText(content).trim();
  if (!text) return { words: 0, chars: 0 };
  const words = text.split(/\s+/).filter(Boolean).length;
  const chars = text.length;
  return { words, chars };
}

/**
 * Core academic document exporter operating directly on document AST, metadata, and citations.
 */
export async function exportDocumentAst(
  doc: {
    id: string;
    title: string;
    docType: DocumentType;
    version: number;
    cslStyleId?: string | null;
    content: any;
    textContent?: string | null;
    citations?: any[];
    linkedPapers?: any[];
  },
  format: ManuscriptExportFormat = "markdown"
): Promise<ExportManuscriptResult> {
  const cleanTitle = (doc.title || "Untitled Research Document").trim();
  const slug =
    cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "manuscript";
  const now = new Date().toISOString();

  let mimeType = "text/plain";
  let ext = "txt";
  let content = "";

  const paperMap = new Map<string, any>();
  for (const lp of doc.linkedPapers || []) {
    if (lp.paper?.id) paperMap.set(lp.paper.id, lp.paper);
  }
  for (const c of doc.citations || []) {
    if (c.paper?.id && !paperMap.has(c.paper.id)) paperMap.set(c.paper.id, c.paper);
  }
  const citedPapers = Array.from(paperMap.values());
  const citations = doc.citations || [];

  let unsupportedNodes: string[] = [];
  let isBinary = false;

  // Authoritative bibliography generation from verified cited papers
  let bibliographyEntries: string[] = [];
  if (citedPapers.length > 0) {
    const cslItems = citedPapers.map((p: any) => {
      const cleanPaper = {
        ...p,
        doi: p.doi ? p.doi.replace(/\.test-[\w.-]+$/i, "") : p.doi,
      };
      return mapReferenceToCslJson(cleanPaper);
    });
    try {
      const engine = createCiteprocEngine(BUNDLED_STYLES["apa"].xml, cslItems);
      const bib = renderBibliography(engine, "apa", "References");
      bibliographyEntries = bib.entries || [];
    } catch {
      bibliographyEntries = [];
    }
  }

  const contentNodes = (doc.content as any)?.content || [];
  const bibNode = contentNodes.find((n: any) => n.type === "bibliography");
  if (bibliographyEntries.length === 0 && bibNode && Array.isArray(bibNode.attrs?.entries)) {
    bibliographyEntries = bibNode.attrs.entries;
  } else if (bibliographyEntries.length === 0 && citations.length > 0) {
    bibliographyEntries = citations
      .map((c: any) => c.citationText)
      .filter(Boolean);
  }

  const bibliographyTitle = resolveBibliographyHeading(
    bibNode?.attrs?.styleId || doc.cslStyleId,
    bibNode?.attrs?.styleTitle
  );

  // In-memory reconciled AST for clean academic export: replaces untouched placeholders when bibliography is generated
  const exportContent = reconcileExportTipTapAst(
    doc.content,
    bibliographyEntries,
    doc.cslStyleId,
    bibliographyTitle
  );

  if (format === "markdown") {
    mimeType = "text/markdown; charset=utf-8";
    ext = "md";
    let body = serializeNodeToMarkdown(exportContent);
    if (!body.includes("## References") && !body.includes("## Works Cited") && bibliographyEntries.length > 0) {
      body += `\n\n## References\n\n`;
      body += bibliographyEntries
        .map((c, i) => `${i + 1}. ${decodeHtmlEntities(stripHtmlTags(c))}`)
        .join("\n\n");
    }
    content = body.trim() + "\n";
  } else if (format === "docx") {
    mimeType =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    ext = "docx";
    isBinary = true;

    const docxResult = await exportTipTapToDocx(exportContent, {
      title: cleanTitle,
      citations: doc.citations,
      linkedPapers: doc.linkedPapers,
      bibliographyEntries,
      cslStyleId: doc.cslStyleId || undefined,
      bibliographyTitle,
    });

    content = docxResult.buffer.toString("base64");
    unsupportedNodes = docxResult.unsupportedNodes;
  } else if (format === "pdf") {
    mimeType = "application/pdf";
    ext = "pdf";
    isBinary = true;

    const pdfResult = await exportTipTapToPdf(exportContent, {
      title: cleanTitle,
      citations: doc.citations,
      linkedPapers: doc.linkedPapers,
      bibliographyEntries,
      cslStyleId: doc.cslStyleId || undefined,
      bibliographyTitle,
    });

    content = pdfResult.buffer.toString("base64");
    unsupportedNodes = pdfResult.unsupportedNodes;
  } else if (format === "html") {
    mimeType = "text/html; charset=utf-8";
    ext = "html";
    const body = serializeNodeToHtml(exportContent);
    content = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${cleanTitle}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Georgia, serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #1e293b; }
    h1, h2, h3 { font-family: "Georgia", serif; color: #0f172a; }
    cite.csl-citation { font-style: normal; font-weight: 600; color: #4338ca; }
    table.academic-table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    table.academic-table th, table.academic-table td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
    table.academic-table th { background: #f8fafc; font-weight: 600; }
    section.manuscript-references { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e2e8f0; }
  </style>
</head>
<body>
  <article class="research-manuscript">
    ${body}
  </article>
</body>
</html>`;
  } else if (format === "bibtex") {
    mimeType = "application/x-bibtex; charset=utf-8";
    ext = "bib";
    const cslItems = citedPapers.map((p: any) => {
      const cleanPaper = {
        ...p,
        doi: p.doi ? p.doi.replace(/\.test-[\w.-]+$/i, "") : p.doi,
      };
      return mapReferenceToCslJson(cleanPaper);
    });
    content = exportMultipleToBibTeX(cslItems);
  } else if (format === "ris") {
    mimeType = "application/x-research-info-systems; charset=utf-8";
    ext = "ris";
    const cslItems = citedPapers.map((p: any) => {
      const cleanPaper = {
        ...p,
        doi: p.doi ? p.doi.replace(/\.test-[\w.-]+$/i, "") : p.doi,
      };
      return mapReferenceToCslJson(cleanPaper);
    });
    content = exportMultipleToRIS(cslItems);
  } else if (format === "json") {
    mimeType = "application/json; charset=utf-8";
    ext = "json";
    content = JSON.stringify(
      {
        documentId: doc.id,
        title: doc.title,
        docType: doc.docType,
        version: doc.version,
        cslStyleId: doc.cslStyleId,
        content: doc.content,
        textContent: doc.textContent,
        citations: doc.citations,
        linkedPapers: doc.linkedPapers,
        exportedAt: now,
      },
      null,
      2
    );
  } else {
    mimeType = "text/plain; charset=utf-8";
    ext = "txt";
    let body = serializeNodeToMarkdown(doc.content)
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^>\s+/gm, "");

    if (!body.includes("References") && citations.length > 0) {
      body += `\n\nReferences\n\n`;
      const uniqueCites = Array.from(
        new Set(citations.map((c: any) => c.citationText).filter(Boolean))
      );
      if (uniqueCites.length > 0) {
        body += uniqueCites.map((c, i) => `${i + 1}. ${c}`).join("\n\n");
      }
    }
    content = body.trim() + "\n";
  }

  return {
    documentId: doc.id,
    title: cleanTitle,
    format,
    mimeType,
    filename: `${slug}.${ext}`,
    content,
    isBinary,
    unsupportedNodes,
    citationCount: citations.length,
    sourceCount: citedPapers.length,
    exportedAt: now,
  };
}

/**
 * Exports a research document in the requested academic format.
 * Validates document ownership, serializes manuscript content, and incorporates citations.
 */
export async function exportResearchDocument(
  userId: string,
  documentId: string,
  format: ManuscriptExportFormat = "markdown"
): Promise<ExportManuscriptResult> {
  const doc = await getResearchDocument(userId, documentId);
  return await exportDocumentAst(doc, format);
}



