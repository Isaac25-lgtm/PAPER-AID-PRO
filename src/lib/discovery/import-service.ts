import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { NormalizedExternalPaper, ImportPaperResult } from "./types";
import {
  normalizeDoi,
  normalizePmid,
  normalizePmcid,
  normalizeArxivId,
  normalizeSemanticScholarId,
  getFriendlyP2002ErrorMessage,
} from "@/lib/identifiers";
import {
  resolveFullTextAvailability,
  acquireAndIngestLawfulFullText,
} from "./full-text-service";
import { conservativeNormalizeTitle } from "./deduplicate";
import { classifyPaper } from "@/lib/auth/paper-authorization";
import { paperVisibilityFilter } from "@/lib/auth/paper-visibility";

function cleanBibliographicField(val: unknown): string | undefined {
  if (typeof val === "string" || typeof val === "number") {
    const trimmed = String(val).trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function isBlankValue(val: unknown): boolean {
  if (val === undefined || val === null) return true;
  if (typeof val === "string" && val.trim().length === 0) return true;
  return false;
}

/**
 * Preservation-aware metadata merger.
 * Recursively merges incoming provider metadata into target metadata:
 * - Retains existing target properties and nested provider sibling objects.
 * - Ignores undefined, null, empty (""), and whitespace-only incoming values.
 * - Non-blank incoming values enrich or update target values.
 */
export function mergePreservingMetadata(
  target: Record<string, any> = {},
  incoming: Record<string, any> = {}
): Record<string, any> {
  const result: Record<string, any> = { ...target };

  for (const [key, incomingVal] of Object.entries(incoming)) {
    if (incomingVal && typeof incomingVal === "object" && !Array.isArray(incomingVal)) {
      const targetSub =
        target[key] && typeof target[key] === "object" && !Array.isArray(target[key])
          ? target[key]
          : {};
      result[key] = mergePreservingMetadata(targetSub, incomingVal);
    } else if (!isBlankValue(incomingVal)) {
      result[key] = typeof incomingVal === "string" ? incomingVal.trim() : incomingVal;
    }
  }

  return result;
}

/**
 * Internal core service for importing external paper metadata into the local database
 * and associating it with a user's library.
 *
 * Security Guarantee:
 * - This function is an internal domain service, NOT a Next.js Server Action.
 * - It cannot be invoked directly over HTTP or RPC from client browsers.
 * - It requires an already-authenticated and verified userId.
 */
export async function executePaperMetadataImport(
  externalPaper: NormalizedExternalPaper,
  userId: string,
  options: { attemptFullTextFetch?: boolean } = {}
): Promise<ImportPaperResult> {
  if (!userId || typeof userId !== "string" || userId.trim() === "") {
    return { success: false, error: "Valid authenticated user ID is required." };
  }

  const cleanDoi = normalizeDoi(externalPaper.doi);
  const cleanPmid = normalizePmid(externalPaper.pmid);
  const cleanPmcid = normalizePmcid(externalPaper.pmcid);
  const cleanArxiv = normalizeArxivId(externalPaper.arxivId);
  const cleanS2Id = normalizeSemanticScholarId(externalPaper.semanticScholarId);

  const rawProviderMeta = (externalPaper.rawProviderMetadata as Record<string, any>) || {};
  const rawCr = (rawProviderMeta.crossref as Record<string, any>) || {};
  const rawPm = (rawProviderMeta.pubmed as Record<string, any>) || {};

  const incomingVolume =
    cleanBibliographicField(externalPaper.volume) ??
    cleanBibliographicField(rawProviderMeta.volume) ??
    cleanBibliographicField(rawCr.volume) ??
    cleanBibliographicField(rawPm.volume);

  const incomingIssue =
    cleanBibliographicField(externalPaper.issue) ??
    cleanBibliographicField(rawProviderMeta.issue) ??
    cleanBibliographicField(rawCr.issue) ??
    cleanBibliographicField(rawPm.issue);

  const incomingPages =
    cleanBibliographicField(externalPaper.pages) ??
    cleanBibliographicField(rawProviderMeta.pages) ??
    cleanBibliographicField(rawProviderMeta.page) ??
    cleanBibliographicField(rawCr.pages) ??
    cleanBibliographicField(rawCr.page) ??
    cleanBibliographicField(rawPm.pages) ??
    cleanBibliographicField(rawPm.page);

  const incomingPublisher =
    cleanBibliographicField(externalPaper.publisher) ??
    cleanBibliographicField(rawProviderMeta.publisher) ??
    cleanBibliographicField(rawCr.publisher);

  // 1. Idempotency Check: Does this public paper already exist in the database?
  // Private user papers (clones and uploads) never occupy unique identifier columns (doi, pmid, pmcid, arxivId, semanticScholarId).
  // We strictly match only public catalog papers and NEVER mutate another user's private paper record.
  const idConditions = [
    ...(cleanDoi ? [{ doi: cleanDoi }] : []),
    ...(cleanPmid ? [{ pmid: cleanPmid }] : []),
    ...(cleanPmcid ? [{ pmcid: cleanPmcid }] : []),
    ...(cleanArxiv ? [{ arxivId: cleanArxiv }] : []),
    ...(cleanS2Id ? [{ semanticScholarId: cleanS2Id }] : []),
  ];

  const rawExisting =
    idConditions.length > 0
      ? await prisma.paper.findFirst({
          where: {
            AND: [
              paperVisibilityFilter(null),
              {
                OR: idConditions,
              },
            ],
          },
          include: {
            authors: { include: { author: true } },
          },
        })
      : null;

  let existing: typeof rawExisting =
    rawExisting && classifyPaper(rawExisting) !== "PRIVATE_USER_DOCUMENT"
      ? rawExisting
      : null;

  // Fallback title check if identifiers do not conflict (strictly against public papers only)
  if (!existing && externalPaper.title) {
    const normSearchTitle = conservativeNormalizeTitle(externalPaper.title);
    if (normSearchTitle.length >= 20) {
      const candidates = await prisma.paper.findMany({
        where: {
          ...paperVisibilityFilter(null),
        },
        select: {
          id: true,
          title: true,
          status: true,
          storagePath: true,
          doi: true,
          pmid: true,
          pmcid: true,
          arxivId: true,
          semanticScholarId: true,
          sourceProvenance: true,
        },
      });
      for (const cand of candidates) {
        if (classifyPaper(cand) === "PRIVATE_USER_DOCUMENT") {
          continue;
        }
        const hasIdentifierConflict =
          (cleanDoi && cand.doi && normalizeDoi(cand.doi) !== cleanDoi) ||
          (cleanPmid && cand.pmid && normalizePmid(cand.pmid) !== cleanPmid) ||
          (cleanPmcid && cand.pmcid && normalizePmcid(cand.pmcid) !== cleanPmcid) ||
          (cleanArxiv && cand.arxivId && normalizeArxivId(cand.arxivId) !== cleanArxiv) ||
          (cleanS2Id && cand.semanticScholarId && normalizeSemanticScholarId(cand.semanticScholarId) !== cleanS2Id);
        if (hasIdentifierConflict) {
          continue;
        }
        if (conservativeNormalizeTitle(cand.title) === normSearchTitle) {
          existing = (await prisma.paper.findUnique({
            where: { id: cand.id },
            include: { authors: { include: { author: true } } },
          })) as any;
          break;
        }
      }
    }
  }

  if (existing) {
    // 1. Enrich missing bibliographic fields on re-import while preserving existing populated values
    const existingProv = ((existing.sourceProvenance as Record<string, any>) || {});
    const existingRawMeta = ((existingProv.rawMetadata as Record<string, any>) || {});

    const existingVolume =
      cleanBibliographicField(existingProv.volume) ??
      cleanBibliographicField(existingRawMeta.volume) ??
      cleanBibliographicField(existingRawMeta.crossref?.volume) ??
      cleanBibliographicField(existingRawMeta.pubmed?.volume);

    const existingIssue =
      cleanBibliographicField(existingProv.issue) ??
      cleanBibliographicField(existingRawMeta.issue) ??
      cleanBibliographicField(existingRawMeta.crossref?.issue) ??
      cleanBibliographicField(existingRawMeta.pubmed?.issue);

    const existingPages =
      cleanBibliographicField(existingProv.pages) ??
      cleanBibliographicField(existingProv.pageRange) ??
      cleanBibliographicField(existingRawMeta.pages) ??
      cleanBibliographicField(existingRawMeta.page) ??
      cleanBibliographicField(existingRawMeta.crossref?.pages) ??
      cleanBibliographicField(existingRawMeta.crossref?.page) ??
      cleanBibliographicField(existingRawMeta.pubmed?.pages) ??
      cleanBibliographicField(existingRawMeta.pubmed?.page);

    const existingPublisher =
      cleanBibliographicField(existingProv.publisher) ??
      cleanBibliographicField(existingRawMeta.publisher) ??
      cleanBibliographicField(existingRawMeta.crossref?.publisher);

    const mergedVolume = existingVolume ?? incomingVolume;
    const mergedIssue = existingIssue ?? incomingIssue;
    const mergedPages = existingPages ?? incomingPages;
    const mergedPublisher = existingPublisher ?? incomingPublisher;

    const needsProvenanceUpdate =
      (!existingVolume && Boolean(incomingVolume)) ||
      (!existingIssue && Boolean(incomingIssue)) ||
      (!existingPages && Boolean(incomingPages)) ||
      (!existingPublisher && Boolean(incomingPublisher)) ||
      (existingVolume && existingProv.volume !== existingVolume) ||
      (existingIssue && existingProv.issue !== existingIssue) ||
      (existingPages && existingProv.pages !== existingPages) ||
      (existingPublisher && existingProv.publisher !== existingPublisher) ||
      (!existing.journal && Boolean(externalPaper.journal?.trim()));

    if (needsProvenanceUpdate) {
      const mergedProviders = Array.from(
        new Set([
          ...(Array.isArray(existingProv.sourceProviders) ? existingProv.sourceProviders : []),
          ...(Array.isArray(externalPaper.sourceProviders) ? externalPaper.sourceProviders : []),
        ])
      );

      const updatedRawMeta = mergePreservingMetadata(
        existingRawMeta,
        rawProviderMeta
      );

      if (mergedVolume) updatedRawMeta.volume = mergedVolume;
      if (mergedIssue) updatedRawMeta.issue = mergedIssue;
      if (mergedPages) updatedRawMeta.pages = mergedPages;
      if (mergedPublisher) updatedRawMeta.publisher = mergedPublisher;

      const updatedProvenance: Record<string, any> = {
        ...existingProv,
        ...(mergedProviders.length > 0 ? { sourceProviders: mergedProviders } : {}),
        ...(mergedVolume ? { volume: mergedVolume } : {}),
        ...(mergedIssue ? { issue: mergedIssue } : {}),
        ...(mergedPages ? { pages: mergedPages } : {}),
        ...(mergedPublisher ? { publisher: mergedPublisher } : {}),
        rawMetadata: updatedRawMeta,
      };

      await prisma.paper.update({
        where: { id: existing.id },
        data: {
          ...(!existing.journal && externalPaper.journal?.trim()
            ? { journal: externalPaper.journal.trim() }
            : {}),
          sourceProvenance: updatedProvenance as any,
        },
      });
    }

    // 2. Ensure a personal Bookmark association exists for this authenticated user
    try {
      await prisma.bookmark.upsert({
        where: {
          userId_paperId: {
            userId,
            paperId: existing.id,
          },
        },
        create: {
          userId,
          paperId: existing.id,
        },
        update: {},
      });
    } catch (bmErr: any) {
      console.error("[executePaperMetadataImport] Failed to bookmark existing paper:", bmErr);
      return {
        success: false,
        error: `Failed to save paper to your library: ${bmErr.message || "Database error"}`,
      };
    }

    // If paper already exists, check if user requested full-text acquisition and it's missing
    if (options.attemptFullTextFetch && existing.status === "METADATA_ONLY") {
      const ftRes = resolveFullTextAvailability(externalPaper);
      if (ftRes.status === "FULL_TEXT_AVAILABLE" && ftRes.url) {
        const acqRes = await acquireAndIngestLawfulFullText(existing.id, ftRes.url, {
          license: externalPaper.license,
          version: externalPaper.arxivId ? "submittedVersion" : "publishedVersion",
          sourceName: ftRes.source || undefined,
          userId,
        });
        try {
          revalidatePath("/papers");
          revalidatePath("/discover");
          revalidatePath("/library");
          revalidatePath("/saved");
        } catch {}
        return {
          success: true,
          paperId: existing.id,
          isExisting: true,
          fullTextStatus: acqRes.status,
          message: acqRes.success
            ? "Paper saved to your library. Full text successfully acquired and processed."
            : `Paper saved to your library. Full text acquisition failed: ${acqRes.error}`,
        };
      }
    }

    try {
      revalidatePath("/papers");
      revalidatePath("/discover");
      revalidatePath("/library");
      revalidatePath("/saved");
    } catch {}

    return {
      success: true,
      paperId: existing.id,
      isExisting: true,
      fullTextStatus: existing.status,
      message: "Paper saved to your library.",
    };
  }

  // 2. Prepare Source Provenance Metadata
  const sourceProvenance = {
    discoveredAt: new Date().toISOString(),
    importedByUserId: userId,
    sourceProviders: externalPaper.sourceProviders,
    originalIdentifiers: {
      doi: cleanDoi,
      pmid: cleanPmid,
      pmcid: cleanPmcid,
      arxivId: cleanArxiv,
      semanticScholarId: cleanS2Id,
    },
    ...(incomingVolume ? { volume: incomingVolume } : {}),
    ...(incomingIssue ? { issue: incomingIssue } : {}),
    ...(incomingPages ? { pages: incomingPages } : {}),
    ...(incomingPublisher ? { publisher: incomingPublisher } : {}),
    externalUrl: externalPaper.externalUrl,
    isOpenAccess: externalPaper.isOpenAccess,
    openAccessPdfUrl: externalPaper.openAccessPdfUrl,
    rawMetadata: {
      ...mergePreservingMetadata({}, rawProviderMeta),
      ...(incomingVolume ? { volume: incomingVolume } : {}),
      ...(incomingIssue ? { issue: incomingIssue } : {}),
      ...(incomingPages ? { pages: incomingPages } : {}),
      ...(incomingPublisher ? { publisher: incomingPublisher } : {}),
    },
  };

  // 3. Atomic Database Insertion: Paper + Author Junctions
  let createdPaperId: string;
  try {
    const publicationDate = externalPaper.publicationDate
      ? new Date(externalPaper.publicationDate)
      : externalPaper.year
      ? new Date(`${externalPaper.year}-01-01`)
      : new Date();

    const result = await prisma.$transaction(
      async (tx) => {
        // Create Paper in METADATA_ONLY status
        const paper = await tx.paper.create({
          data: {
            title: externalPaper.title.trim(),
            abstract: (externalPaper.abstract || "Abstract not provided in scholarly metadata.").trim(),
            journal: externalPaper.journal?.trim() || null,
            doi: cleanDoi,
            pmid: cleanPmid,
            pmcid: cleanPmcid,
            arxivId: cleanArxiv,
            semanticScholarId: cleanS2Id,
            publicationDate,
            citationCount: externalPaper.citationCount || 0,
            isOpenAccess: externalPaper.isOpenAccess,
            status: "METADATA_ONLY",
            sourceProvenance: sourceProvenance as any,
          },
        });

        // Link / Create Authors
        const seenAuthorIds = new Set<string>();

        for (let i = 0; i < externalPaper.authors.length; i++) {
          const authItem = externalPaper.authors[i];
          const name = authItem.name.trim();
          if (!name) continue;

          let author = await tx.author.findFirst({
            where: { name: { equals: name, mode: "insensitive" } },
          });

          if (!author) {
            author = await tx.author.create({
              data: {
                name,
                institution: authItem.institution?.trim() || null,
                orcid: authItem.orcid?.trim() || null,
              },
            });
          } else if (authItem.institution && !author.institution) {
            author = await tx.author.update({
              where: { id: author.id },
              data: { institution: authItem.institution.trim() },
            });
          }

          if (!seenAuthorIds.has(author.id)) {
            seenAuthorIds.add(author.id);
            await tx.paperAuthor.create({
              data: {
                paperId: paper.id,
                authorId: author.id,
                orderIndex: i,
              },
            });
          }
        }

        // Persist personal library association for authenticated user
        await tx.bookmark.upsert({
          where: {
            userId_paperId: {
              userId,
              paperId: paper.id,
            },
          },
          create: {
            userId,
            paperId: paper.id,
          },
          update: {},
        });

        return paper;
      },
      { maxWait: 10000, timeout: 20000 }
    );

    createdPaperId = result.id;
  } catch (err: any) {
    if (err?.code === "P2002") {
      return { success: false, error: getFriendlyP2002ErrorMessage(err) };
    }
    return {
      success: false,
      error: `Failed to import paper metadata: ${err?.message || "Database error"}`,
    };
  }

  // 4. If requested and available, acquire full text lawfully
  let fullTextStatus = "METADATA_ONLY";
  let fullTextMessage = "Metadata successfully imported into library.";

  if (options.attemptFullTextFetch) {
    const ftRes = resolveFullTextAvailability(externalPaper);
    if (ftRes.status === "FULL_TEXT_AVAILABLE" && ftRes.url) {
      const acqRes = await acquireAndIngestLawfulFullText(createdPaperId, ftRes.url, {
        license: externalPaper.license,
        version: externalPaper.arxivId ? "submittedVersion" : "publishedVersion",
        sourceName: ftRes.source || undefined,
        userId,
      });
      if (acqRes.success) {
        fullTextStatus = "COMPLETED";
        fullTextMessage = "Metadata and open-access full text successfully imported and processed.";
      } else {
        fullTextMessage = `Metadata imported. Full text acquisition failed: ${acqRes.error}`;
      }
    }
  }

  try {
    revalidatePath("/papers");
    revalidatePath("/discover");
    revalidatePath("/library");
    revalidatePath("/saved");
  } catch {
    // Non-request context
  }

  return {
    success: true,
    paperId: createdPaperId,
    isExisting: false,
    fullTextStatus,
    message: fullTextMessage,
  };
}
