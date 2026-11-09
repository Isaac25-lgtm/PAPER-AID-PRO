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
import {
  resolveScholarlySources,
  ScholarlyClassification,
  ScholarlyResolutionResult,
} from "@/lib/discovery/scholarly-source-resolver";
import { acquireAndIngestLawfulFullText } from "@/lib/discovery/full-text-service";
import { addPaperToCollection } from "./collections-service";
import { revalidatePath } from "next/cache";
import { paperVisibilityFilter } from "@/lib/auth/paper-visibility";

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
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  rawProviderMetadata?: Record<string, any> | null;
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
  // Scholarly source resolution enhancements
  scholarlyClassification?: ScholarlyClassification;
  sourceResolution?: ScholarlyResolutionResult;
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

  // 1. Check local database (strictly public scholarly catalog papers only; private user documents never occupy DOI/PMID/arXiv columns)
  const existingPaper = await prisma.paper.findFirst({
    where: {
      AND: [
        paperVisibilityFilter(null),
        {
          OR: [
            classified.type === "DOI" ? { doi: classified.normalizedValue } : {},
            classified.type === "PMID" ? { pmid: classified.normalizedValue } : {},
            classified.type === "ARXIV" ? { arxivId: classified.normalizedValue } : {},
          ].filter((obj) => Object.keys(obj).length > 0),
        },
      ],
    },
    include: {
      authors: { include: { author: true }, orderBy: { orderIndex: "asc" } },
      _count: { select: { chunks: true } },
    },
  });

  if (existingPaper) {
    const hasFullText = Boolean(existingPaper.storagePath && existingPaper._count.chunks > 0);
    const prov = (existingPaper.sourceProvenance as any) || {};
    const rawMeta = prov?.rawMetadata || {};
    let resolvedVolume: string | null =
      prov?.volume || rawMeta?.crossref?.volume || rawMeta?.pubmed?.volume || null;
    let resolvedIssue: string | null =
      prov?.issue || rawMeta?.crossref?.issue || rawMeta?.pubmed?.issue || null;
    let resolvedPages: string | null =
      prov?.pages ||
      prov?.page ||
      rawMeta?.crossref?.page ||
      rawMeta?.crossref?.pages ||
      rawMeta?.pubmed?.pages ||
      rawMeta?.pubmed?.page ||
      null;
    let resolvedRawMetadata: Record<string, any> = { ...rawMeta };

    // If existing record is missing volume, issue, or pages, opportunistically query provider to enrich
    if (!resolvedVolume || !resolvedIssue || !resolvedPages) {
      try {
        if (classified.type === "DOI" || existingPaper.doi) {
          const targetDoi = existingPaper.doi || classified.normalizedValue;
          const crResults = await new CrossrefProvider()
            .search(targetDoi, { limitPerProvider: 1, timeoutMs: 5000 })
            .catch(() => []);
          const crPaper =
            crResults.find((p) => normalizeDoi(p.doi) === normalizeDoi(targetDoi)) ||
            (targetDoi ? undefined : crResults[0]);
          if (crPaper) {
            resolvedVolume = resolvedVolume || crPaper.volume || null;
            resolvedIssue = resolvedIssue || crPaper.issue || null;
            resolvedPages = resolvedPages || crPaper.pages || null;
            if (crPaper.rawProviderMetadata) {
              resolvedRawMetadata = mergeProviderMetadata(
                resolvedRawMetadata,
                crPaper.rawProviderMetadata
              );
            }
          }
        } else if (classified.type === "PMID" || existingPaper.pmid) {
          const targetPmid = existingPaper.pmid || classified.normalizedValue;
          const pmResults = await new PubMedProvider()
            .search(targetPmid, { limitPerProvider: 1, timeoutMs: 5000 })
            .catch(() => []);
          const pmPaper =
            pmResults.find((p) => normalizePmid(p.pmid) === normalizePmid(targetPmid)) ||
            (targetPmid ? undefined : pmResults[0]);
          if (pmPaper) {
            resolvedVolume = resolvedVolume || pmPaper.volume || null;
            resolvedIssue = resolvedIssue || pmPaper.issue || null;
            resolvedPages = resolvedPages || pmPaper.pages || null;
            if (pmPaper.rawProviderMetadata) {
              resolvedRawMetadata = mergeProviderMetadata(
                resolvedRawMetadata,
                pmPaper.rawProviderMetadata
              );
            }
          }
        }
      } catch {}
    }

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

    const sourceResolution = await resolveScholarlySources({
      doi: existingPaper.doi,
      pmid: existingPaper.pmid,
      arxivId: existingPaper.arxivId,
    });

    return {
      success: true,
      existingPaperId: existingPaper.id,
      metadata: {
        title: existingPaper.title,
        abstract: sanitizeScientificAbstract(existingPaper.abstract),
        authors: existingPaper.authors.map((a) => a.author.name),
        journal: existingPaper.journal,
        volume: resolvedVolume,
        issue: resolvedIssue,
        pages: resolvedPages,
        rawProviderMetadata:
          Object.keys(resolvedRawMetadata).length > 0 ? resolvedRawMetadata : null,
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
        scholarlyClassification: sourceResolution.classification,
        sourceResolution,
      },
    };
  }

  // 2. Query external scholarly providers
  try {
    if (classified.type === "DOI") {
      const crossref = new CrossrefProvider();
      const [crossrefResults, oaResult, sourceResolution] = await Promise.all([
        crossref.search(classified.normalizedValue, {
          limitPerProvider: 1,
          timeoutMs: 7000,
        }).catch(() => []),
        discoverOpenAccessForDoi(classified.normalizedValue, { timeoutMs: 7000 }),
        resolveScholarlySources({ doi: classified.normalizedValue }),
      ]);

      const paper =
        crossrefResults.find(
          (p) => normalizeDoi(p.doi) === classified.normalizedValue
        ) || (classified.type === "DOI" ? undefined : crossrefResults[0]);

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
          volume: paper?.volume || null,
          issue: paper?.issue || null,
          pages: paper?.pages || null,
          rawProviderMetadata: paper?.rawProviderMetadata || null,
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
          scholarlyClassification: sourceResolution.classification,
          sourceResolution,
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

        // Check if paper has a DOI for open-access lookup and source resolution
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

        const sourceResolution = await resolveScholarlySources({
          doi: paper.doi || null,
          pmid: classified.normalizedValue,
        });

        return {
          success: true,
          metadata: {
            title: paper.title,
            abstract,
            authors: (paper.authors || []).map((a: any) =>
              typeof a === "string" ? a : a.name
            ),
            journal: paper.journal,
            volume: paper.volume || null,
            issue: paper.issue || null,
            pages: paper.pages || null,
            rawProviderMetadata: paper.rawProviderMetadata || null,
            publicationDate: paper.publicationDate || null,
            doi: paper.doi || null,
            pmid: paper.pmid,
            provider: "PUBMED",
            scholarlyClassification: sourceResolution.classification,
            sourceResolution,
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
 * Metadata-First Saving (Phase 9B):
 * 1. Normalizes scholarly identifiers.
 * 2. Finds or creates the appropriate Paper metadata record in METADATA_ONLY status.
 * 3. Associates user bookmark / library collection.
 * 4. Resolves legitimate scholarly source locations and attaches provenance.
 * 5. Returns immediately WITHOUT starting PDF download, storage upload, or AI processing jobs.
 */
/**
 * Deep merges provider raw metadata objects while preserving existing nested
 * properties when incoming fields are omitted, null, or blank strings.
 */
function isBlankValue(val: unknown): boolean {
  if (val === undefined || val === null) return true;
  if (typeof val === "string" && val.trim().length === 0) return true;
  return false;
}

export function mergeProviderMetadata(
  existingMeta: Record<string, any> = {},
  incomingMeta: Record<string, any> = {}
): Record<string, any> {
  const result: Record<string, any> = { ...existingMeta };

  for (const [providerKey, incomingVal] of Object.entries(incomingMeta)) {
    if (incomingVal && typeof incomingVal === "object" && !Array.isArray(incomingVal)) {
      const existingVal =
        existingMeta[providerKey] &&
        typeof existingMeta[providerKey] === "object" &&
        !Array.isArray(existingMeta[providerKey])
          ? existingMeta[providerKey]
          : {};

      const mergedProvider: Record<string, any> = { ...existingVal };
      for (const [k, v] of Object.entries(incomingVal)) {
        if (!isBlankValue(v)) {
          mergedProvider[k] = typeof v === "string" ? v.trim() : v;
        }
      }
      result[providerKey] = mergedProvider;
    } else if (!isBlankValue(incomingVal)) {
      result[providerKey] = typeof incomingVal === "string" ? incomingVal.trim() : incomingVal;
    }
  }

  return result;
}

export async function importPaperByIdentifier(params: {
  userId: string;
  identifier: string;
  collectionName?: string;
  attemptFullTextAcquisition?: boolean;
}): Promise<{
  success: boolean;
  paperId: string;
  isDuplicate: boolean;
  message: string;
  status?: string;
  hasFullText?: boolean;
}> {
  const { userId, identifier, collectionName, attemptFullTextAcquisition = false } = params;

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

    const existingPaper = await prisma.paper.findUnique({
      where: { id: paperId },
      select: { status: true, storagePath: true, doi: true, sourceProvenance: true },
    });

    if (existingPaper) {
      const prevProv = (existingPaper.sourceProvenance as Record<string, any>) || {};
      const prevRawMeta = (prevProv.rawMetadata as Record<string, any>) || {};
      const existingVol =
        prevProv.volume || prevRawMeta.crossref?.volume || prevRawMeta.pubmed?.volume;
      const existingIssue =
        prevProv.issue || prevRawMeta.crossref?.issue || prevRawMeta.pubmed?.issue;
      const existingPages =
        prevProv.pages ||
        prevProv.page ||
        prevRawMeta.crossref?.page ||
        prevRawMeta.crossref?.pages ||
        prevRawMeta.pubmed?.pages ||
        prevRawMeta.pubmed?.page;

      const resolvedVolume = existingVol || meta.volume || undefined;
      const resolvedIssue = existingIssue || meta.issue || undefined;
      const resolvedPages = existingPages || meta.pages || undefined;

      const needsProvenanceUpdate =
        (!prevProv.volume && Boolean(resolvedVolume)) ||
        (!prevProv.issue && Boolean(resolvedIssue)) ||
        (!prevProv.pages && Boolean(resolvedPages));

      if (needsProvenanceUpdate) {
        const mergedRawMeta = mergeProviderMetadata(
          prevRawMeta,
          meta.rawProviderMetadata || {}
        );
        await prisma.paper.update({
          where: { id: paperId },
          data: {
            sourceProvenance: {
              ...prevProv,
              ...(resolvedVolume ? { volume: resolvedVolume } : {}),
              ...(resolvedIssue ? { issue: resolvedIssue } : {}),
              ...(resolvedPages ? { pages: resolvedPages } : {}),
              ...(Object.keys(mergedRawMeta).length > 0 ? { rawMetadata: mergedRawMeta } : {}),
            },
          },
        });
      }
    }

    let autoDownloaded = false;
    // Only attempt full text acquisition if explicitly requested (default is false)
    if (
      attemptFullTextAcquisition &&
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

    return {
      success: true,
      paperId,
      isDuplicate: Boolean(existingBookmark),
      hasFullText: autoDownloaded || Boolean(existingPaper?.storagePath),
      status: existingPaper?.status || "METADATA_ONLY",
      message: existingBookmark
        ? `Paper "${meta.title}" is already in your library.`
        : `Paper "${meta.title}" added to your library as reference metadata.`,
    };
  }

  // 2. Paper does not exist in DB: Create Paper record
  const initialProvenance: Record<string, any> = {
    provider: meta.provider,
    importedByUserId: userId,
    importedAt: new Date().toISOString(),
    isMetadataOnly: true,
    ...(meta.volume ? { volume: meta.volume } : {}),
    ...(meta.issue ? { issue: meta.issue } : {}),
    ...(meta.pages ? { pages: meta.pages } : {}),
    ...(meta.rawProviderMetadata ? { rawMetadata: meta.rawProviderMetadata } : {}),
    openAccessStatus: meta.openAccessStatus || "NO_OPEN_ACCESS_LOCATED",
    openAccessVersion: meta.openAccessVersion || null,
    openAccessLicense: meta.openAccessLicense || null,
    license: meta.openAccessLicense || null,
    isPreprint: meta.isPreprint || false,
    openAccessLandingPage: meta.openAccessLandingPage || null,
    isLawfulOpenAccess: false,
    scholarlyClassification: meta.scholarlyClassification || "ABSTRACT_ONLY",
    sourceResolution: meta.sourceResolution || null,
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
        meta.openAccessPdfUrl ||
        meta.sourceResolution?.bestCandidate?.pdfUrl
      ),
      pdfUrl: meta.sourceResolution?.bestCandidate?.pdfUrl || meta.openAccessPdfUrl || meta.openAccessLandingPage || null,
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

  // 3. Optional Open-Access PDF Acquisition: ONLY if explicitly opted in by caller
  let acquisitionSuccess = false;
  if (attemptFullTextAcquisition && meta.canAutoDownload && meta.openAccessPdfUrl) {
    try {
      const acqResult = await acquireAndIngestLawfulFullText(paperId, meta.openAccessPdfUrl, {
        license: meta.openAccessLicense,
        version: meta.openAccessVersion,
        sourceName: `Lawful OA (${meta.openAccessVersion || "open access"})`,
        userId,
      });

      acquisitionSuccess = acqResult.success;
    } catch (acqErr: any) {
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

  const userMessage = `Paper "${meta.title}" added to your library as reference metadata.`;

  return {
    success: true,
    paperId,
    isDuplicate: false,
    hasFullText: acquisitionSuccess,
    status: acquisitionSuccess ? "COMPLETED" : "METADATA_ONLY",
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
      arxivId: true,
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

  const prov = (paper.sourceProvenance as any) || {};
  const effectiveDoi = paper.doi || prov.canonicalDoi || null;
  const effectiveArxivId = paper.arxivId || prov.canonicalArxivId || null;

  if (!effectiveDoi) {
    if (effectiveArxivId) {
      const arxivUrl = `https://arxiv.org/pdf/${effectiveArxivId}.pdf`;
      const acq = await acquireAndIngestLawfulFullText(paper.id, arxivUrl, {
        license: prov.license || prov.canonicalLicense || null,
        version: "submittedVersion",
        sourceName: "arXiv Open Access",
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
          message: "Open-access preprint acquired from arXiv and processed successfully!",
          hasFullText: true,
        };
      } else {
        return {
          success: false,
          status: "IMPORT_FAILED",
          message: `arXiv acquisition failed: ${acq.error}`,
          hasFullText: false,
        };
      }
    }

    return {
      success: false,
      status: "REFERENCE_SAVED_FULL_TEXT_NEEDED",
      message: "Paper does not have a DOI or arXiv ID registered for automated open-access discovery. Manual PDF upload is required.",
      hasFullText: false,
    };
  }

  // Execute open-access discovery
  const discovery = await discoverOpenAccessForDoi(effectiveDoi, { forceRefresh: true });

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
