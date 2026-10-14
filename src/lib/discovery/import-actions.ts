"use server";

/**
 * Server Actions for Scholarly Discovery & Controlled Metadata Import
 *
 * Implements:
 * - Server-side external discovery search across PubMed, Crossref, Semantic Scholar
 * - Idempotent, deduplicated metadata import into PostgreSQL
 * - Author entity linking
 * - Full-text acquisition trigger for PMC / open-access papers
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
  NormalizedExternalPaper,
  DiscoverySearchOptions,
  DiscoverySearchResult,
} from "./types";
import { ScholarlyAggregator } from "./scholarly-aggregator";
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

export interface ImportPaperResult {
  success: boolean;
  paperId?: string;
  isExisting?: boolean;
  fullTextStatus?: string;
  message?: string;
  error?: string;
}

const aggregator = new ScholarlyAggregator();

/**
 * Executes multi-provider scholarly discovery search from the server boundary.
 * Keeps provider API keys securely server-side.
 */
export async function searchScholarlyAction(
  query: string,
  options: DiscoverySearchOptions = {}
): Promise<DiscoverySearchResult> {
  const session = await getServerSession(authOptions);
  return aggregator.search(query, {
    ...options,
    userId: session?.user?.id,
  });
}

/**
 * Imports external paper metadata into the local library.
 * Fully idempotent: Repeated calls for the same DOI/PMID/paper return the existing record.
 */
export async function importPaperMetadataAction(
  externalPaper: NormalizedExternalPaper,
  options: { attemptFullTextFetch?: boolean } = {}
): Promise<ImportPaperResult> {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return { success: false, error: "Authentication required to import research papers." };
  }

  const cleanDoi = normalizeDoi(externalPaper.doi);
  const cleanPmid = normalizePmid(externalPaper.pmid);
  const cleanPmcid = normalizePmcid(externalPaper.pmcid);
  const cleanArxiv = normalizeArxivId(externalPaper.arxivId);
  const cleanS2Id = normalizeSemanticScholarId(externalPaper.semanticScholarId);

  // 1. Idempotency Check: Does this paper already exist in the database?
  let existing = await prisma.paper.findFirst({
    where: {
      OR: [
        ...(cleanDoi ? [{ doi: cleanDoi }] : []),
        ...(cleanPmid ? [{ pmid: cleanPmid }] : []),
        ...(cleanPmcid ? [{ pmcid: cleanPmcid }] : []),
        ...(cleanArxiv ? [{ arxivId: cleanArxiv }] : []),
        ...(cleanS2Id ? [{ semanticScholarId: cleanS2Id }] : []),
      ],
    },
    include: {
      authors: { include: { author: true } },
    },
  });

  // Fallback title check if identifiers are absent
  if (!existing && externalPaper.title) {
    const normSearchTitle = conservativeNormalizeTitle(externalPaper.title);
    if (normSearchTitle.length >= 20) {
      const candidates = await prisma.paper.findMany({
        select: { id: true, title: true, status: true, storagePath: true },
      });
      for (const cand of candidates) {
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
    // If paper already exists, check if user requested full-text acquisition and it's missing
    if (options.attemptFullTextFetch && existing.status === "METADATA_ONLY") {
      const ftRes = resolveFullTextAvailability(externalPaper);
      if (ftRes.status === "FULL_TEXT_AVAILABLE" && ftRes.url) {
        const acqRes = await acquireAndIngestLawfulFullText(existing.id, ftRes.url);
        revalidatePath("/papers");
        revalidatePath("/discover");
        return {
          success: true,
          paperId: existing.id,
          isExisting: true,
          fullTextStatus: acqRes.status,
          message: acqRes.success
            ? "Paper was already in library. Full text successfully acquired and processed."
            : `Paper was already in library. Full text acquisition failed: ${acqRes.error}`,
        };
      }
    }

    return {
      success: true,
      paperId: existing.id,
      isExisting: true,
      fullTextStatus: existing.status,
      message: "Paper is already in your library.",
    };
  }

  // 2. Prepare Source Provenance Metadata
  const sourceProvenance = {
    discoveredAt: new Date().toISOString(),
    importedByUserId: session.user.id,
    sourceProviders: externalPaper.sourceProviders,
    originalIdentifiers: {
      doi: cleanDoi,
      pmid: cleanPmid,
      pmcid: cleanPmcid,
      arxivId: cleanArxiv,
      semanticScholarId: cleanS2Id,
    },
    externalUrl: externalPaper.externalUrl,
    isOpenAccess: externalPaper.isOpenAccess,
    openAccessPdfUrl: externalPaper.openAccessPdfUrl,
    rawMetadata: externalPaper.rawProviderMetadata || {},
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
      const acqRes = await acquireAndIngestLawfulFullText(createdPaperId, ftRes.url);
      if (acqRes.success) {
        fullTextStatus = "FULL_TEXT_AVAILABLE";
        fullTextMessage = "Metadata and open-access full text successfully imported and processed.";
      } else {
        fullTextMessage = `Metadata imported. Full text acquisition failed: ${acqRes.error}`;
      }
    }
  }

  try {
    revalidatePath("/papers");
    revalidatePath("/discover");
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
