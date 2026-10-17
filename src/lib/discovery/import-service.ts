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
    // 1. Ensure a personal Bookmark association exists for this authenticated user
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
