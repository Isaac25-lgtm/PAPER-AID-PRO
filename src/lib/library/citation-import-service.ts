import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizeDoi } from "@/lib/identifiers";
import { classifyPaper } from "@/lib/auth/paper-authorization";
import { addPaperToCollection } from "./collections-service";
import { revalidatePath } from "next/cache";

export interface ParsedReferenceItem {
  rawId?: string;
  type?: string;
  title?: string;
  authors: string[];
  journal?: string;
  year?: string;
  doi?: string;
  abstract?: string;
  url?: string;
  sourceFormat: "BIBTEX" | "RIS";
}

export interface ReferencePreviewItem extends ParsedReferenceItem {
  id: string; // temporary key for preview selection
  validationStatus: "VALID" | "DUPLICATE" | "INVALID";
  validationMessage?: string;
  existingPaperId?: string;
}

export interface ImportPreviewSummary {
  format: "BIBTEX" | "RIS" | "UNKNOWN";
  totalFound: number;
  validCount: number;
  duplicateCount: number;
  invalidCount: number;
  items: ReferencePreviewItem[];
}

/**
 * Parses raw BibTeX string into structured reference objects.
 */
export function parseBibTeX(text: string): ParsedReferenceItem[] {
  const items: ParsedReferenceItem[] = [];
  // Match @entryType{citeKey, ...}
  const entryRegex = /@([a-zA-Z]+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n@|\n*$)/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(text)) !== null) {
    const entryType = match[1].toLowerCase();
    const citeKey = match[2];
    const body = match[3];

    const fields: Record<string, string> = {};
    // Match fieldName = {value} or fieldName = "value" or fieldName = value
    const fieldRegex = /([a-zA-Z_-]+)\s*=\s*(?:\{([\s\S]*?)\}|"([\s\S]*?)"|([^\n,}]+))/g;
    let fieldMatch: RegExpExecArray | null;

    while ((fieldMatch = fieldRegex.exec(body)) !== null) {
      const key = fieldMatch[1].toLowerCase().trim();
      const val = (fieldMatch[2] ?? fieldMatch[3] ?? fieldMatch[4] ?? "")
        .replace(/\s+/g, " ")
        .trim();
      fields[key] = val;
    }

    const title = fields.title || fields.booktitle || undefined;
    const authorRaw = fields.author || fields.authors || "";
    const authors = authorRaw
      ? authorRaw
          .split(/\s+and\s+/i)
          .map((a) => a.trim().replace(/^\{|\}$/g, ""))
          .filter(Boolean)
      : [];

    const journal = fields.journal || fields.booktitle || fields.publisher || undefined;
    const year = fields.year || (fields.date ? fields.date.slice(0, 4) : undefined);
    const doi = normalizeDoi(fields.doi) || undefined;
    const abstract = fields.abstract || undefined;
    const url = fields.url || undefined;

    items.push({
      rawId: citeKey,
      type: entryType,
      title: title?.replace(/^\{|\}$/g, ""),
      authors,
      journal,
      year,
      doi,
      abstract,
      url,
      sourceFormat: "BIBTEX",
    });
  }

  return items;
}

/**
 * Parses raw RIS (Research Information Systems) text into structured reference objects.
 */
export function parseRIS(text: string): ParsedReferenceItem[] {
  const items: ParsedReferenceItem[] = [];
  // Split references by ER  - (End of Reference)
  const rawRecords = text.split(/(?:^|\n)\s*ER\s+-(?:[^\n]*)?(?:\n|$)/);

  for (const raw of rawRecords) {
    if (!raw.trim()) continue;

    const lines = raw.split("\n");
    let entryType: string | undefined;
    let title: string | undefined;
    const authors: string[] = [];
    let journal: string | undefined;
    let year: string | undefined;
    let doi: string | undefined;
    let abstract: string | undefined;
    let url: string | undefined;

    for (const line of lines) {
      const tagMatch = /^([A-Z0-9]{2})\s*-\s*(.*)$/.exec(line.trim());
      if (!tagMatch) continue;

      const tag = tagMatch[1].toUpperCase();
      const val = tagMatch[2].trim();
      if (!val) continue;

      switch (tag) {
        case "TY":
          entryType = val.toLowerCase();
          break;
        case "TI":
        case "T1":
        case "CT":
          if (!title) title = val;
          break;
        case "AU":
        case "A1":
        case "A2":
          authors.push(val);
          break;
        case "JO":
        case "JF":
        case "JA":
        case "T2":
          if (!journal) journal = val;
          break;
        case "PY":
        case "Y1":
        case "DA":
          if (!year) {
            const yearMatch = /\d{4}/.exec(val);
            if (yearMatch) year = yearMatch[0];
          }
          break;
        case "DO":
          doi = normalizeDoi(val) || undefined;
          break;
        case "AB":
        case "N2":
          abstract = abstract ? `${abstract} ${val}` : val;
          break;
        case "UR":
        case "L1":
          if (!url) url = val;
          break;
      }
    }

    if (title || authors.length > 0 || doi) {
      items.push({
        type: entryType || "journal",
        title,
        authors,
        journal,
        year,
        doi,
        abstract,
        url,
        sourceFormat: "RIS",
      });
    }
  }

  return items;
}

/**
 * Auto-detects citation format and parses input string into normalized items.
 */
export function detectAndParseReferences(text: string): {
  format: "BIBTEX" | "RIS" | "UNKNOWN";
  items: ParsedReferenceItem[];
} {
  const clean = text.trim();

  // If text starts with or contains @article, @book, etc. -> BibTeX
  if (/@\s*[a-zA-Z]+\s*\{/.test(clean)) {
    return { format: "BIBTEX", items: parseBibTeX(clean) };
  }

  // If text contains TY  - -> RIS
  if (/(?:^|\n)\s*TY\s+-/.test(clean)) {
    return { format: "RIS", items: parseRIS(clean) };
  }

  return { format: "UNKNOWN", items: [] };
}

/**
 * Previews reference import: checks database duplicates and validates mandatory fields.
 */
export async function previewReferenceImport(
  userId: string,
  rawContent: string
): Promise<ImportPreviewSummary> {
  const { format, items } = detectAndParseReferences(rawContent);

  if (format === "UNKNOWN" || items.length === 0) {
    return {
      format: "UNKNOWN",
      totalFound: 0,
      validCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      items: [],
    };
  }

  // Collect all DOIs to query database in one batch
  const doisToCheck = items
    .map((i) => i.doi)
    .filter((d): d is string => Boolean(d));

  const existingPapers = doisToCheck.length > 0
    ? await prisma.paper.findMany({
        where: { doi: { in: doisToCheck } },
        select: { id: true, doi: true, title: true, sourceProvenance: true },
      })
    : [];

  const existingDoiMap = new Map<string, string>();
  for (const p of existingPapers) {
    const cls = classifyPaper(p);
    if (cls === "PRIVATE_USER_DOCUMENT") {
      const prov = p.sourceProvenance as any;
      const ownerId = prov?.uploadedByUserId || prov?.ownerId || (p as any).uploadedByUserId;
      if (ownerId !== userId) {
        continue; // Never match another researcher's private document
      }
    }
    if (p.doi) existingDoiMap.set(p.doi.toLowerCase(), p.id);
  }

  // Also check existing user bookmarks
  const userBookmarks = await prisma.bookmark.findMany({
    where: { userId },
    select: { paperId: true },
  });
  const bookmarkedPaperIds = new Set(userBookmarks.map((b) => b.paperId));

  let validCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;

  const previewItems: ReferencePreviewItem[] = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const previewId = `item-${idx}-${Date.now()}`;

    // 1. Validation check
    if (!item.title || item.title.trim().length < 3) {
      invalidCount++;
      previewItems.push({
        ...item,
        id: previewId,
        validationStatus: "INVALID",
        validationMessage: "Missing title or title too short.",
      });
      continue;
    }

    // 2. Duplicate check via DOI
    if (item.doi) {
      const normDoi = item.doi.toLowerCase();
      const existingId = existingDoiMap.get(normDoi);

      if (existingId) {
        duplicateCount++;
        const inUserLib = bookmarkedPaperIds.has(existingId);
        previewItems.push({
          ...item,
          id: previewId,
          existingPaperId: existingId,
          validationStatus: "DUPLICATE",
          validationMessage: inUserLib
            ? "Already saved in your research library."
            : "Already in scientific catalog (will link directly).",
        });
        continue;
      }
    }

    // 3. Valid entry
    validCount++;
    previewItems.push({
      ...item,
      id: previewId,
      validationStatus: "VALID",
      validationMessage: "Ready for library import.",
    });
  }

  return {
    format,
    totalFound: items.length,
    validCount,
    duplicateCount,
    invalidCount,
    items: previewItems,
  };
}

/**
 * Executes batch reference import into user's library.
 * Creates METADATA_ONLY paper records and user bookmarks.
 */
export async function executeReferenceImport(params: {
  userId: string;
  items: ReferencePreviewItem[];
  collectionName?: string;
  importDuplicates?: boolean;
}): Promise<{
  importedCount: number;
  skippedCount: number;
  createdPaperIds: string[];
  errors: string[];
}> {
  const { userId, items, collectionName, importDuplicates = false } = params;

  let importedCount = 0;
  let skippedCount = 0;
  const createdPaperIds: string[] = [];
  const errors: string[] = [];

  for (const item of items) {
    if (item.validationStatus === "INVALID") {
      skippedCount++;
      continue;
    }

    // If duplicate in DB but user wants to add to library
    if (item.validationStatus === "DUPLICATE") {
      if (item.existingPaperId) {
        // Link existing paper to user's bookmarks
        await prisma.bookmark.upsert({
          where: { userId_paperId: { userId, paperId: item.existingPaperId } },
          create: { userId, paperId: item.existingPaperId },
          update: {},
        });

        if (collectionName) {
          await addPaperToCollection(userId, item.existingPaperId, collectionName);
        }

        importedCount++;
        createdPaperIds.push(item.existingPaperId);
      } else {
        skippedCount++;
      }
      continue;
    }

    // Valid new paper to import
    try {
      const pubDate = item.year ? new Date(`${item.year}-01-01`) : null;

      const paper = await prisma.paper.create({
        data: {
          title: item.title!.trim(),
          abstract: item.abstract?.trim() || "Abstract not provided in reference file.",
          journal: item.journal?.trim() || null,
          publicationDate: pubDate && !isNaN(pubDate.getTime()) ? pubDate : null,
          doi: item.doi || null,
          status: "METADATA_ONLY",
          isOpenAccess: false,
          storagePath: null,
          sourceProvenance: {
            provider: `${item.sourceFormat}_IMPORT`,
            importedByUserId: userId,
            importedAt: new Date().toISOString(),
            isMetadataOnly: true,
          },
        },
      });

      createdPaperIds.push(paper.id);

      // Connect Authors
      if (item.authors && item.authors.length > 0) {
        for (let aIdx = 0; aIdx < item.authors.length; aIdx++) {
          const aName = item.authors[aIdx].trim();
          if (!aName) continue;

          let author = await prisma.author.findFirst({
            where: { name: { equals: aName, mode: "insensitive" } },
          });

          if (!author) {
            author = await prisma.author.create({
              data: { name: aName },
            });
          }

          await prisma.paperAuthor.create({
            data: {
              paperId: paper.id,
              authorId: author.id,
              orderIndex: aIdx,
            },
          }).catch(() => {});
        }
      }

      // Create Bookmark
      await prisma.bookmark.create({
        data: { userId, paperId: paper.id },
      });

      if (collectionName) {
        await addPaperToCollection(userId, paper.id, collectionName);
      }

      importedCount++;
    } catch (err: any) {
      errors.push(`${item.title}: ${err.message}`);
    }
  }

  try {
    revalidatePath("/library");
  } catch {}

  return {
    importedCount,
    skippedCount,
    createdPaperIds,
    errors,
  };
}
