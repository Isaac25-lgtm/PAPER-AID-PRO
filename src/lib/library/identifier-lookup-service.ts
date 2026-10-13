import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizeDoi, normalizePmid, normalizeArxivId } from "@/lib/identifiers";
import { CrossrefProvider } from "@/lib/discovery/providers/crossref";
import { PubMedProvider } from "@/lib/discovery/providers/pubmed";
import { addPaperToCollection } from "./collections-service";
import { revalidatePath } from "next/cache";

export type IdentifierType = "DOI" | "PMID" | "ARXIV" | "UNKNOWN";

export interface NormalizedLookupResult {
  type: IdentifierType;
  normalizedValue: string;
  displayValue: string;
}

export interface LookupPaperMetadata {
  title: string;
  abstract: string;
  authors: string[];
  journal?: string | null;
  publicationDate?: string | null;
  doi?: string | null;
  pmid?: string | null;
  arxivId?: string | null;
  citationCount?: number;
  provider: "DATABASE" | "CROSSREF" | "PUBMED" | "ARXIV";
}

/**
 * Normalizes and classifies an arbitrary academic identifier string.
 */
export function classifyAndNormalizeIdentifier(rawInput: string): NormalizedLookupResult {
  const clean = rawInput.trim();

  // 1. DOI detection: matches 10.xxxx/...
  if (clean.includes("10.") || clean.toLowerCase().includes("doi.org/")) {
    const doi = normalizeDoi(clean);
    if (doi) {
      return { type: "DOI", normalizedValue: doi, displayValue: doi };
    }
  }

  // 2. PMID detection: "pmid:12345" or raw 1-8 digit number
  if (/^pmid:\s*\d+$/i.test(clean) || /^\d{4,8}$/.test(clean)) {
    const pmid = normalizePmid(clean);
    if (pmid) {
      return { type: "PMID", normalizedValue: pmid, displayValue: `PMID:${pmid}` };
    }
  }

  // 3. arXiv detection: e.g. "1706.03762" or "arXiv:1706.03762"
  if (/arxiv:\s*\d{4}\.\d{4,5}/i.test(clean) || /^\d{4}\.\d{4,5}(v\d+)?$/i.test(clean)) {
    const arxivId = normalizeArxivId(clean);
    if (arxivId) {
      return { type: "ARXIV", normalizedValue: arxivId, displayValue: `arXiv:${arxivId}` };
    }
  }

  return { type: "UNKNOWN", normalizedValue: clean, displayValue: clean };
}

/**
 * Looks up paper metadata by DOI, PMID, or arXiv ID.
 * First checks local database; falls back to live scholarly providers.
 */
export async function lookupPaperByIdentifier(
  rawInput: string
): Promise<{
  success: boolean;
  metadata?: LookupPaperMetadata;
  existingPaperId?: string;
  error?: string;
}> {
  const classified = classifyAndNormalizeIdentifier(rawInput);

  if (classified.type === "UNKNOWN") {
    return {
      success: false,
      error: "Unrecognized identifier format. Please enter a valid DOI (e.g. 10.1038/s41586-024-07487-w) or PMID (e.g. 38720073).",
    };
  }

  // 1. Check local database
  const existingPaper = await prisma.paper.findFirst({
    where: {
      OR: [
        classified.type === "DOI" ? { doi: classified.normalizedValue } : {},
        classified.type === "PMID" ? { pmid: classified.normalizedValue } : {},
        classified.type === "ARXIV" ? { arxivId: classified.normalizedValue } : {},
      ].filter((obj) => Object.keys(obj).length > 0),
    },
    include: {
      authors: { include: { author: true }, orderBy: { orderIndex: "asc" } },
    },
  });

  if (existingPaper) {
    return {
      success: true,
      existingPaperId: existingPaper.id,
      metadata: {
        title: existingPaper.title,
        abstract: existingPaper.abstract,
        authors: existingPaper.authors.map((a) => a.author.name),
        journal: existingPaper.journal,
        publicationDate: existingPaper.publicationDate
          ? existingPaper.publicationDate.toISOString()
          : null,
        doi: existingPaper.doi,
        pmid: existingPaper.pmid,
        arxivId: existingPaper.arxivId,
        citationCount: existingPaper.citationCount,
        provider: "DATABASE",
      },
    };
  }

  // 2. Query external scholarly providers
  try {
    if (classified.type === "DOI") {
      const crossref = new CrossrefProvider();
      const results = await crossref.search(classified.normalizedValue, {
        limitPerProvider: 1,
        timeoutMs: 7000,
      });

      const paper = results.find(
        (p) => normalizeDoi(p.doi) === classified.normalizedValue
      ) || results[0];

      if (paper) {
        return {
          success: true,
          metadata: {
            title: paper.title,
            abstract: paper.abstract || "Abstract indexed via Crossref.",
            authors: (paper.authors || []).map((a: any) =>
              typeof a === "string" ? a : a.name
            ),
            journal: paper.journal,
            publicationDate: paper.publicationDate || null,
            doi: paper.doi,
            citationCount: paper.citationCount ?? undefined,
            provider: "CROSSREF",
          },
        };
      }
    } else if (classified.type === "PMID") {
      const pubmed = new PubMedProvider();
      const results = await pubmed.search(classified.normalizedValue, {
        limitPerProvider: 1,
        timeoutMs: 7000,
      });

      const paper = results.find(
        (p) => normalizePmid(p.pmid) === classified.normalizedValue
      ) || results[0];

      if (paper) {
        return {
          success: true,
          metadata: {
            title: paper.title,
            abstract: paper.abstract || "Abstract indexed via PubMed.",
            authors: (paper.authors || []).map((a: any) =>
              typeof a === "string" ? a : a.name
            ),
            journal: paper.journal,
            publicationDate: paper.publicationDate || null,
            doi: paper.doi || null,
            pmid: paper.pmid,
            provider: "PUBMED",
          },
        };
      }
    }

    return {
      success: false,
      error: `No scholarly metadata found for ${classified.displayValue}. Please verify the identifier.`,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Scholarly lookup failed: ${err.message || "Provider service unavailable."}`,
    };
  }
}

/**
 * Imports a paper into the user's library by DOI or PMID.
 * If the paper is already in the database, bookmarks it directly.
 * If external, creates a METADATA_ONLY record with provenance tracking.
 */
export async function importPaperByIdentifier(params: {
  userId: string;
  identifier: string;
  collectionName?: string;
}): Promise<{
  success: boolean;
  paperId: string;
  isDuplicate: boolean;
  message: string;
}> {
  const { userId, identifier, collectionName } = params;

  const lookup = await lookupPaperByIdentifier(identifier);
  if (!lookup.success || !lookup.metadata) {
    throw new Error(lookup.error || "Could not resolve paper identifier.");
  }

  const meta = lookup.metadata;
  let paperId = lookup.existingPaperId;

  // 1. If paper exists in database, check for duplicate bookmark
  if (paperId) {
    const existingBookmark = await prisma.bookmark.findUnique({
      where: { userId_paperId: { userId, paperId } },
    });

    if (existingBookmark) {
      if (collectionName) {
        await addPaperToCollection(userId, paperId, collectionName);
      }
      return {
        success: true,
        paperId,
        isDuplicate: true,
        message: `Paper "${meta.title}" is already in your library.`,
      };
    }

    // Add bookmark for user
    await prisma.bookmark.create({
      data: { userId, paperId },
    });

    if (collectionName) {
      await addPaperToCollection(userId, paperId, collectionName);
    }

    try {
      revalidatePath("/library");
    } catch {}

    return {
      success: true,
      paperId,
      isDuplicate: false,
      message: `Paper "${meta.title}" added to your library from database catalog.`,
    };
  }

  // 2. Paper does not exist in DB: Create METADATA_ONLY record with provenance
  const createdPaper = await prisma.paper.create({
    data: {
      title: meta.title,
      abstract: meta.abstract,
      journal: meta.journal,
      publicationDate: meta.publicationDate ? new Date(meta.publicationDate) : null,
      doi: meta.doi,
      pmid: meta.pmid,
      arxivId: meta.arxivId,
      citationCount: meta.citationCount || 0,
      status: "METADATA_ONLY",
      isOpenAccess: false,
      storagePath: null,
      sourceProvenance: {
        provider: meta.provider,
        importedByUserId: userId,
        importedAt: new Date().toISOString(),
        isMetadataOnly: true,
      },
    },
  });

  paperId = createdPaper.id;

  // Connect Authors
  if (meta.authors && meta.authors.length > 0) {
    for (let i = 0; i < meta.authors.length; i++) {
      const name = meta.authors[i].trim();
      if (!name) continue;

      let author = await prisma.author.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
      });

      if (!author) {
        author = await prisma.author.create({
          data: { name },
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

  // Create bookmark
  await prisma.bookmark.create({
    data: { userId, paperId },
  });

  if (collectionName) {
    await addPaperToCollection(userId, paperId, collectionName);
  }

  try {
    revalidatePath("/library");
  } catch {}

  return {
    success: true,
    paperId,
    isDuplicate: false,
    message: `Paper "${meta.title}" imported from ${meta.provider} into your library.`,
  };
}
