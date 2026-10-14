import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizeDoi, normalizePmid, normalizeArxivId } from "@/lib/identifiers";
import { CrossrefProvider } from "@/lib/discovery/providers/crossref";
import { PubMedProvider } from "@/lib/discovery/providers/pubmed";
import {
  discoverOpenAccessForDoi,
  OpenAccessDiscoveryStatus,
  OpenAccessVersion,
} from "@/lib/discovery/open-access-service";
import { acquireAndIngestLawfulFullText } from "@/lib/discovery/full-text-service";
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
  // Open-access discovery enhancements
  openAccessStatus?: OpenAccessDiscoveryStatus;
  openAccessPdfUrl?: string | null;
  openAccessLandingPage?: string | null;
  openAccessLicense?: string | null;
  openAccessVersion?: OpenAccessVersion;
  canAutoDownload?: boolean;
  openAccessExplanation?: string;
  isPreprint?: boolean;
}

/**
 * Normalizes and cleans scientific abstract text.
 * Strictly distinguishes an actual scientific abstract from an indexing note.
 * If no genuine abstract is available, returns "No abstract available."
 */
export function sanitizeScientificAbstract(rawAbstract: string | null | undefined): string {
  if (!rawAbstract || typeof rawAbstract !== "string") {
    return "No abstract available.";
  }

  const cleaned = rawAbstract
    .replace(/<jats:title>[^<]*<\/jats:title>/gi, "")
    .replace(/<jats:[^>]+>/gi, "")
    .replace(/<\/jats:[^>]+>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/^abstract\s*[:\.\-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < 20) {
    return "No abstract available.";
  }

  const lower = cleaned.toLowerCase();
  // Filter out artificial placeholder notes or indexing stubs
  if (
    lower.includes("indexed via crossref") ||
    lower.includes("indexed via pubmed") ||
    lower.includes("no abstract provided") ||
    lower.includes("abstract unavailable") ||
    lower === "no abstract available." ||
    lower === "abstract not available."
  ) {
    return "No abstract available.";
  }

  return cleaned;
}

/**
 * Normalizes and classifies an arbitrary academic identifier string.
 */
export function classifyAndNormalizeIdentifier(rawInput: string): NormalizedLookupResult {
  if (!rawInput || typeof rawInput !== "string") {
    return { type: "UNKNOWN", normalizedValue: "", displayValue: "" };
  }
  const clean = rawInput.trim();

  // 1. DOI detection: matches 10.xxxx/... or doi.org/... or doi:...
  if (clean.includes("10.") || clean.toLowerCase().includes("doi.org/") || /^doi\s*:/i.test(clean)) {
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
 * For DOIs, automatically executes open-access full-text discovery.
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
      _count: { select: { chunks: true } },
    },
  });

  if (existingPaper) {
    const hasFullText = Boolean(existingPaper.storagePath && existingPaper._count.chunks > 0);
    const prov = (existingPaper.sourceProvenance as any) || {};

    // For DOI in database, also check if OA full-text could be discovered if it's currently METADATA_ONLY
    let oaMetadata: Partial<LookupPaperMetadata> = {};
    if (existingPaper.doi && existingPaper.status === "METADATA_ONLY" && !hasFullText) {
      try {
        const oa = await discoverOpenAccessForDoi(existingPaper.doi);
        oaMetadata = {
          openAccessStatus: oa.status,
          openAccessPdfUrl: oa.bestLocation?.pdfUrl || null,
          openAccessLandingPage: oa.bestLocation?.landingPageUrl || null,
          openAccessLicense: oa.bestLocation?.license || null,
          openAccessVersion: oa.bestLocation?.version,
          canAutoDownload: Boolean(oa.bestLocation?.isLawfullyAcquirable && oa.bestLocation?.pdfUrl),
          openAccessExplanation: oa.explanation,
          isPreprint: oa.bestLocation?.isPreprint || false,
        };
      } catch {}
    }

    return {
      success: true,
      existingPaperId: existingPaper.id,
      metadata: {
        title: existingPaper.title,
        abstract: sanitizeScientificAbstract(existingPaper.abstract),
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
        openAccessStatus: hasFullText ? "READY_FOR_AI" : oaMetadata.openAccessStatus || "REFERENCE_SAVED_FULL_TEXT_NEEDED",
        openAccessPdfUrl: existingPaper.pdfUrl || oaMetadata.openAccessPdfUrl || null,
        openAccessVersion: prov?.version || oaMetadata.openAccessVersion,
        openAccessLicense: prov?.license || oaMetadata.openAccessLicense,
        canAutoDownload: oaMetadata.canAutoDownload || false,
        openAccessExplanation: hasFullText
          ? "Full text already processed and ready for AI analysis."
          : oaMetadata.openAccessExplanation || "Paper is in catalog as bibliographic reference.",
        isPreprint: prov?.version === "submittedVersion" || oaMetadata.isPreprint || false,
      },
    };
  }

  // 2. Query external scholarly providers
  try {
    if (classified.type === "DOI") {
      const crossref = new CrossrefProvider();
      const [crossrefResults, oaResult] = await Promise.all([
        crossref.search(classified.normalizedValue, {
          limitPerProvider: 1,
          timeoutMs: 7000,
        }).catch(() => []),
        discoverOpenAccessForDoi(classified.normalizedValue, { timeoutMs: 7000 }),
      ]);

      const paper =
        crossrefResults.find(
          (p) => normalizeDoi(p.doi) === classified.normalizedValue
        ) || crossrefResults[0];

      // Title determination: Crossref > OA discovery result
      const title = paper?.title || oaResult.title;
      if (!title) {
        return {
          success: false,
          error: `Could not resolve metadata for DOI "${classified.displayValue}". Please verify the DOI.`,
        };
      }

      // Abstract: Crossref > OA discovery > "No abstract available."
      let abstract = sanitizeScientificAbstract(paper?.abstract);
      if (abstract === "No abstract available." && oaResult.abstract) {
        abstract = sanitizeScientificAbstract(oaResult.abstract);
      }

      // Authors: Crossref > OA discovery > []
      let authors: string[] = [];
      if (paper?.authors && paper.authors.length > 0) {
        authors = paper.authors.map((a: any) =>
          typeof a === "string" ? a : a.name
        );
      } else if (oaResult.authors && oaResult.authors.length > 0) {
        authors = oaResult.authors;
      }

      const journal = paper?.journal || oaResult.journal || null;
      const publicationDate = paper?.publicationDate || oaResult.publicationDate || null;

      const canAutoDownload = Boolean(
        oaResult.bestLocation?.isLawfullyAcquirable && oaResult.bestLocation?.pdfUrl
      );

      return {
        success: true,
        metadata: {
          title,
          abstract,
          authors,
          journal,
          publicationDate,
          doi: classified.normalizedValue,
          citationCount: paper?.citationCount ?? undefined,
          provider: "CROSSREF",
          openAccessStatus: oaResult.status,
          openAccessPdfUrl: oaResult.bestLocation?.pdfUrl || null,
          openAccessLandingPage: oaResult.bestLocation?.landingPageUrl || null,
          openAccessLicense: oaResult.bestLocation?.license || null,
          openAccessVersion: oaResult.bestLocation?.version,
          canAutoDownload,
          openAccessExplanation: oaResult.explanation,
          isPreprint: oaResult.bestLocation?.isPreprint || false,
        },
      };
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
        const abstract = sanitizeScientificAbstract(paper.abstract);

        // Check if paper has a DOI for open-access lookup
        let oaData: Partial<LookupPaperMetadata> = {};
        if (paper.doi) {
          try {
            const oa = await discoverOpenAccessForDoi(paper.doi);
            oaData = {
              openAccessStatus: oa.status,
              openAccessPdfUrl: oa.bestLocation?.pdfUrl || null,
              openAccessLandingPage: oa.bestLocation?.landingPageUrl || null,
              openAccessLicense: oa.bestLocation?.license || null,
              openAccessVersion: oa.bestLocation?.version,
              canAutoDownload: Boolean(oa.bestLocation?.isLawfullyAcquirable && oa.bestLocation?.pdfUrl),
              openAccessExplanation: oa.explanation,
              isPreprint: oa.bestLocation?.isPreprint || false,
            };
          } catch {}
        }

        return {
          success: true,
          metadata: {
            title: paper.title,
            abstract,
            authors: (paper.authors || []).map((a: any) =>
              typeof a === "string" ? a : a.name
            ),
            journal: paper.journal,
            publicationDate: paper.publicationDate || null,
            doi: paper.doi || null,
            pmid: paper.pmid,
            provider: "PUBMED",
            ...oaData,
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
 * If the paper is already in the database:
 * - Creates a Bookmark for the user if not already present.
 * - If currently METADATA_ONLY and an eligible OA PDF is discovered, triggers acquisition.
 * If external:
 * - Creates Paper record with genuine abstract and metadata.
 * - Discovers open access: If permitted, automatically acquires and processes full-text PDF.
 * - Preserves reference and external reading links when automatic copy is not permitted.
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
  status?: string;
  hasFullText?: boolean;
}> {
  const { userId, identifier, collectionName } = params;

  const lookup = await lookupPaperByIdentifier(identifier);
  if (!lookup.success || !lookup.metadata) {
    throw new Error(lookup.error || "Could not resolve paper identifier.");
  }

  const meta = lookup.metadata;
  let paperId = lookup.existingPaperId;

  // 1. If paper exists in database:
  if (paperId) {
    const existingBookmark = await prisma.bookmark.findUnique({
      where: { userId_paperId: { userId, paperId } },
    });

    if (!existingBookmark) {
      await prisma.bookmark.create({
        data: { userId, paperId },
      });
    }

    if (collectionName) {
      await addPaperToCollection(userId, paperId, collectionName);
    }

    // Check if existing paper is METADATA_ONLY and can be upgraded via OA acquisition
    const existingPaper = await prisma.paper.findUnique({
      where: { id: paperId },
      select: { status: true, storagePath: true, doi: true, sourceProvenance: true },
    });

    let autoDownloaded = false;
    if (
      existingPaper &&
      existingPaper.status === "METADATA_ONLY" &&
      !existingPaper.storagePath &&
      meta.canAutoDownload &&
      meta.openAccessPdfUrl
    ) {
      try {
        const acq = await acquireAndIngestLawfulFullText(paperId, meta.openAccessPdfUrl, {
          license: meta.openAccessLicense,
          version: meta.openAccessVersion,
          sourceName: `Lawful OA (${meta.openAccessVersion || "open access"})`,
          userId,
        });
        autoDownloaded = acq.success;
      } catch (acqErr) {
        console.warn(`[importPaperByIdentifier] OA acquisition error for existing paper ${paperId}:`, acqErr);
      }
    }

    try {
      revalidatePath("/library");
      revalidatePath("/saved");
      revalidatePath(`/papers/${paperId}`);
    } catch {}

    const fullTextMessage = autoDownloaded
      ? " Open-access full text was successfully acquired and processed for AI analysis."
      : "";

    return {
      success: true,
      paperId,
      isDuplicate: Boolean(existingBookmark),
      hasFullText: autoDownloaded || Boolean(existingPaper?.storagePath),
      message: existingBookmark
        ? `Paper "${meta.title}" is already in your library.${fullTextMessage}`
        : `Paper "${meta.title}" added to your library.${fullTextMessage}`,
    };
  }

  // 2. Paper does not exist in DB: Create Paper record
  const initialProvenance: Record<string, any> = {
    provider: meta.provider,
    importedByUserId: userId,
    importedAt: new Date().toISOString(),
    isMetadataOnly: true,
    openAccessStatus: meta.openAccessStatus || "NO_OPEN_ACCESS_LOCATED",
    openAccessVersion: meta.openAccessVersion || null,
    openAccessLicense: meta.openAccessLicense || null,
    license: meta.openAccessLicense || null,
    isPreprint: meta.isPreprint || false,
    openAccessLandingPage: meta.openAccessLandingPage || null,
    isLawfulOpenAccess: false,
  };

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
      isOpenAccess: Boolean(
        meta.openAccessStatus === "OPEN_ACCESS_PDF_FOUND" ||
        meta.openAccessLandingPage ||
        meta.openAccessPdfUrl
      ),
      pdfUrl: meta.openAccessPdfUrl || meta.openAccessLandingPage || null,
      storagePath: null,
      sourceProvenance: initialProvenance,
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

  // 3. Automatic Open-Access PDF Acquisition & Processing Pipeline
  let acquisitionSuccess = false;
  let acquisitionError: string | undefined;

  if (meta.canAutoDownload && meta.openAccessPdfUrl) {
    try {
      const acqResult = await acquireAndIngestLawfulFullText(paperId, meta.openAccessPdfUrl, {
        license: meta.openAccessLicense,
        version: meta.openAccessVersion,
        sourceName: `Lawful OA (${meta.openAccessVersion || "open access"})`,
        userId,
      });

      acquisitionSuccess = acqResult.success;
      if (!acqResult.success) {
        acquisitionError = acqResult.error;
      }
    } catch (acqErr: any) {
      acquisitionError = acqErr.message || "Failed downloading open-access PDF";
      console.warn(`[importPaperByIdentifier] Acquisition exception for ${paperId}:`, acqErr);
    }
  }

  // Create bookmark for the user
  await prisma.bookmark.create({
    data: { userId, paperId },
  });

  if (collectionName) {
    await addPaperToCollection(userId, paperId, collectionName);
  }

  try {
    revalidatePath("/library");
    revalidatePath("/saved");
    revalidatePath(`/papers/${paperId}`);
  } catch {}

  let userMessage = `Paper "${meta.title}" added to your library.`;
  if (acquisitionSuccess) {
    const versionLabel =
      meta.openAccessVersion === "publishedVersion"
        ? "Publisher Version"
        : meta.openAccessVersion === "acceptedVersion"
        ? "Accepted Manuscript"
        : meta.openAccessVersion === "submittedVersion"
        ? "Preprint Version"
        : "Open Access";
    userMessage = `Paper "${meta.title}" imported (${versionLabel}) and full text processed for AI analysis.`;
  } else if (meta.canAutoDownload && acquisitionError) {
    userMessage = `Paper "${meta.title}" reference saved. Full-text download could not be completed (${acquisitionError}). Manual PDF upload is available.`;
  } else if (meta.openAccessLandingPage || meta.openAccessPdfUrl) {
    userMessage = `Paper "${meta.title}" saved. Open-access reading link preserved (direct server copy restricted by license).`;
  } else {
    userMessage = `Paper "${meta.title}" saved as bibliographic reference. No open-access PDF located.`;
  }

  return {
    success: true,
    paperId,
    isDuplicate: false,
    hasFullText: acquisitionSuccess,
    message: userMessage,
  };
}

/**
 * On-demand discovery and acquisition for an existing paper in the library.
 * Invoked when researcher clicks "Find Open-Access Version" on a paper detail page or library card.
 */
export async function discoverAndProcessPaperOpenAccess(
  paperId: string,
  userId: string
): Promise<{
  success: boolean;
  status: OpenAccessDiscoveryStatus;
  message: string;
  hasFullText: boolean;
}> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: {
      id: true,
      title: true,
      doi: true,
      status: true,
      storagePath: true,
      sourceProvenance: true,
      _count: { select: { chunks: true } },
    },
  });

  if (!paper) {
    return {
      success: false,
      status: "NO_OPEN_ACCESS_LOCATED",
      message: "Paper not found.",
      hasFullText: false,
    };
  }

  // If already processed with chunks, return immediately
  if (paper.status === "COMPLETED" && paper.storagePath && paper._count.chunks > 0) {
    return {
      success: true,
      status: "READY_FOR_AI",
      message: "Full text is already indexed and ready for AI analysis.",
      hasFullText: true,
    };
  }

  if (!paper.doi) {
    return {
      success: false,
      status: "REFERENCE_SAVED_FULL_TEXT_NEEDED",
      message: "Paper does not have a DOI registered for automated open-access discovery. Manual PDF upload is required.",
      hasFullText: false,
    };
  }

  // Execute open-access discovery
  const discovery = await discoverOpenAccessForDoi(paper.doi, { forceRefresh: true });

  if (!discovery.isFound || !discovery.bestLocation) {
    return {
      success: false,
      status: "NO_OPEN_ACCESS_LOCATED",
      message: "No open-access copy located across Unpaywall and OpenAlex.",
      hasFullText: false,
    };
  }

  const loc = discovery.bestLocation;

  // Case A: Directly acquirable permitted PDF
  if (loc.isLawfullyAcquirable && loc.pdfUrl) {
    const acq = await acquireAndIngestLawfulFullText(paper.id, loc.pdfUrl, {
      license: loc.license,
      version: loc.version,
      sourceName: loc.sourceName,
      userId,
    });

    try {
      revalidatePath("/library");
      revalidatePath("/saved");
      revalidatePath(`/papers/${paperId}`);
    } catch {}

    if (acq.success) {
      return {
        success: true,
        status: "READY_FOR_AI",
        message: `Open-access PDF discovered (${loc.version === "submittedVersion" ? "Preprint" : "Version of Record"}) and processed successfully!`,
        hasFullText: true,
      };
    } else {
      return {
        success: false,
        status: "IMPORT_FAILED",
        message: `Open-access PDF located, but processing could not complete: ${acq.error || "Extraction failed"}.`,
        hasFullText: false,
      };
    }
  }

  // Case B: External link only (unclear/restrictive license or landing page only)
  const extUrl = loc.landingPageUrl || loc.pdfUrl;
  if (extUrl) {
    await prisma.paper.update({
      where: { id: paperId },
      data: {
        pdfUrl: extUrl,
        isOpenAccess: true,
      },
    });

    try {
      revalidatePath("/library");
      revalidatePath("/saved");
      revalidatePath(`/papers/${paperId}`);
    } catch {}

    return {
      success: true,
      status: "OPEN_ACCESS_EXTERNAL_LINK_ONLY",
      message: `Open-access external reading link preserved (${loc.license || "unspecified license"}). Automated server ingestion is restricted by publisher terms; you may view the external full text or upload a personal PDF copy.`,
      hasFullText: false,
    };
  }

  return {
    success: false,
    status: "REFERENCE_SAVED_FULL_TEXT_NEEDED",
    message: "No legally accessible PDF found for automated import.",
    hasFullText: false,
  };
}
