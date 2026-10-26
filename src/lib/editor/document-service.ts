import { prisma } from "../prisma";
import { CitationType, DocumentType } from "@prisma/client";
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
} from "../citations/csl";

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
    select: { id: true, userId: true, version: true, content: true },
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

  if (updates.content !== undefined || updates.guidedMeta !== undefined) {
    let finalContent = updates.content !== undefined ? updates.content : existing.content;
    const existingMeta = (existing.content as any)?.meta;
    const incomingMeta = updates.guidedMeta !== undefined
      ? updates.guidedMeta
      : (finalContent && typeof finalContent === "object" ? (finalContent as any).meta : undefined);

    const mergedMeta = incomingMeta || existingMeta;

    if (mergedMeta && finalContent && typeof finalContent === "object") {
      finalContent = {
        ...(finalContent as any),
        meta: mergedMeta,
      };
      if (mergedMeta.citationStyle) {
        dataToUpdate.cslStyleId = mergedMeta.citationStyle;
      }
      if (mergedMeta.citationStyleRevision) {
        dataToUpdate.cslRevisionSha = mergedMeta.citationStyleRevision;
      }
    }
    dataToUpdate.content = finalContent;
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
  if (!input.paperId || input.paperId.trim() === "" || input.paperId === "unknown-ref") {
    throw new Error("A valid paperId is required to create a document citation.");
  }

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
  let verifiedChunkId: string | null = null;
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
    verifiedChunkId = input.chunkId;
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

  // 5. Enforce passage-verified distinction:
  // A citation can ONLY be PASSAGE_VERIFIED if an authenticated, valid chunk is linked.
  const finalCitationType = verifiedChunkId
    ? (input.citationType || CitationType.PASSAGE_VERIFIED)
    : CitationType.BIBLIOGRAPHIC;

  // 6. Create citation
  return await prisma.documentCitation.create({
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

export const addDocumentCitation = insertDocumentCitation;
 
export type ManuscriptExportFormat =
  | "markdown"
  | "text"
  | "html"
  | "bibtex"
  | "ris"
  | "json";

export interface ExportManuscriptResult {
  documentId: string;
  title: string;
  format: ManuscriptExportFormat;
  mimeType: string;
  filename: string;
  content: string;
  citationCount: number;
  sourceCount: number;
  exportedAt: string;
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
      const title = node.attrs?.styleTitle || "References";
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
      const title = node.attrs?.styleTitle || "References";
      if (entries.length === 0) return "";
      const listItems = entries.map((e) => `<li>${e}</li>`).join("\n");
      return `<section class="manuscript-references"><h2>${title}</h2><ol>${listItems}</ol></section>`;
    }
    default:
      return childHtml;
  }
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

  const citedPapers = (doc.linkedPapers || []).map((lp: any) => lp.paper).filter(Boolean);
  const citations = doc.citations || [];

  if (format === "markdown") {
    mimeType = "text/markdown; charset=utf-8";
    ext = "md";
    let body = serializeNodeToMarkdown(doc.content);
    if (!body.includes("## References") && citations.length > 0) {
      body += `\n\n## References\n\n`;
      const uniqueCites = Array.from(
        new Set(citations.map((c: any) => c.citationText).filter(Boolean))
      );
      if (uniqueCites.length > 0) {
        body += uniqueCites.map((c, i) => `${i + 1}. ${c}`).join("\n\n");
      }
    }
    content = body.trim() + "\n";
  } else if (format === "html") {
    mimeType = "text/html; charset=utf-8";
    ext = "html";
    const body = serializeNodeToHtml(doc.content);
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
    citationCount: citations.length,
    sourceCount: citedPapers.length,
    exportedAt: now,
  };
}


