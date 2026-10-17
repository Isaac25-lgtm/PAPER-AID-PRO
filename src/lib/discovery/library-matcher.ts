/**
 * Local Library Duplicate Matcher
 *
 * Compares external discovered papers against the local PostgreSQL library.
 * Matches by:
 * 1. Normalized DOI (Primary)
 * 2. PMID / PMCID (Secondary)
 * 3. Conservative Normalized Title + Year (Fallback)
 *
 * Hydrates each external paper with its `localStatus` flag so the UI can
 * distinguish "In Library", "Available to Import", "Metadata Only", etc.
 */

import { prisma } from "@/lib/prisma";
import { NormalizedExternalPaper, LocalPaperStatus } from "./types";
import { normalizeDoi } from "@/lib/identifiers";
import { conservativeNormalizeTitle } from "./deduplicate";
import { ADMIN_TEST_FIXTURE_IDS, classifyPaper } from "@/lib/auth/paper-authorization";

export async function matchPapersAgainstLocalLibrary(
  externalPapers: NormalizedExternalPaper[],
  userId?: string
): Promise<NormalizedExternalPaper[]> {
  if (externalPapers.length === 0) return [];

  // Extract all non-null identifiers from candidate papers
  const dois = externalPapers
    .map((p) => p.doi ? normalizeDoi(p.doi) : null)
    .filter((d): d is string => Boolean(d));

  const pmids = externalPapers
    .map((p) => p.pmid)
    .filter((id): id is string => Boolean(id));

  const pmcids = externalPapers
    .map((p) => p.pmcid)
    .filter((id): id is string => Boolean(id));

  // Query existing papers from local PostgreSQL library, excluding administrator fixtures
  const matchedPapers = await prisma.paper.findMany({
    where: {
      id: { notIn: Array.from(ADMIN_TEST_FIXTURE_IDS) },
      OR: [
        ...(dois.length > 0 ? [{ doi: { in: dois } }] : []),
        ...(pmids.length > 0 ? [{ pmid: { in: pmids } }] : []),
        ...(pmcids.length > 0 ? [{ pmcid: { in: pmcids } }] : []),
      ],
    },
    select: {
      id: true,
      title: true,
      doi: true,
      pmid: true,
      pmcid: true,
      status: true,
      storagePath: true,
      sourceProvenance: true,
    },
  });

  // Filter out any private user uploads or system fixtures from public matching
  const safeMatchedPapers = matchedPapers.filter((p) => {
    const cls = classifyPaper(p);
    if (cls === "ADMIN_TEST_FIXTURE" || cls === "AMBIGUOUS_HISTORICAL") return false;
    if (cls === "PRIVATE_USER_DOCUMENT") {
      const prov = p.sourceProvenance as any;
      const ownerId = prov?.uploadedByUserId || prov?.ownerId || (p as any).uploadedByUserId;
      if (!userId || ownerId !== userId) {
        return false;
      }
    }
    return true;
  });

  // Build lookup indexes
  const doiIndex = new Map<string, typeof matchedPapers[0]>();
  const pmidIndex = new Map<string, typeof matchedPapers[0]>();
  const pmcidIndex = new Map<string, typeof matchedPapers[0]>();

  for (const p of safeMatchedPapers) {
    if (p.doi) doiIndex.set(p.doi.toLowerCase(), p);
    if (p.pmid) pmidIndex.set(p.pmid, p);
    if (p.pmcid) pmcidIndex.set(p.pmcid.toUpperCase(), p);
  }

  // Also fetch all titles if any papers have no identifiers
  const hasUnidentified = externalPapers.some((p) => !p.doi && !p.pmid && !p.pmcid);
  let localTitleMap: Map<string, typeof matchedPapers[0]> | null = null;

  if (hasUnidentified) {
    const allTitles = await prisma.paper.findMany({
      where: {
        id: { notIn: Array.from(ADMIN_TEST_FIXTURE_IDS) },
      },
      select: {
        id: true,
        title: true,
        doi: true,
        pmid: true,
        pmcid: true,
        status: true,
        storagePath: true,
        sourceProvenance: true,
      },
    });
    localTitleMap = new Map();
    for (const p of allTitles) {
      const cls = classifyPaper(p);
      if (cls === "ADMIN_TEST_FIXTURE" || cls === "AMBIGUOUS_HISTORICAL") continue;
      if (cls === "PRIVATE_USER_DOCUMENT") {
        const prov = p.sourceProvenance as any;
        const ownerId = prov?.uploadedByUserId || prov?.ownerId || (p as any).uploadedByUserId;
        if (!userId || ownerId !== userId) continue;
      }
      const norm = conservativeNormalizeTitle(p.title);
      if (norm.length >= 20) {
        localTitleMap.set(norm, p);
      }
    }
  }

  // Query user-specific bookmarks if userId is provided to ensure multi-tenant library isolation
  const userLibraryPaperIds = new Set<string>();
  if (userId) {
    const candidatePaperIds = new Set<string>();
    for (const p of safeMatchedPapers) {
      candidatePaperIds.add(p.id);
    }
    if (localTitleMap) {
      localTitleMap.forEach((p) => {
        candidatePaperIds.add(p.id);
      });
    }
    if (candidatePaperIds.size > 0) {
      const bookmarks = await prisma.bookmark.findMany({
        where: {
          userId,
          paperId: { in: Array.from(candidatePaperIds) },
        },
        select: { paperId: true },
      });
      for (const b of bookmarks) {
        userLibraryPaperIds.add(b.paperId);
      }
    }
  }

  // Hydrate each external paper with local library status
  return externalPapers.map((paper) => {
    let localMatch: typeof matchedPapers[0] | undefined;

    // 1. Check DOI
    if (paper.doi) {
      const cleanDoi = normalizeDoi(paper.doi);
      if (cleanDoi) {
        localMatch = doiIndex.get(cleanDoi);
      }
    }

    // 2. Check PMID
    if (!localMatch && paper.pmid) {
      localMatch = pmidIndex.get(paper.pmid);
    }

    // 3. Check PMCID
    if (!localMatch && paper.pmcid) {
      localMatch = pmcidIndex.get(paper.pmcid.toUpperCase());
    }

    // 4. Check Title
    if (!localMatch && localTitleMap) {
      const normTitle = conservativeNormalizeTitle(paper.title);
      if (normTitle.length >= 20) {
        localMatch = localTitleMap.get(normTitle);
      }
    }

    let localStatus: LocalPaperStatus;

    if (localMatch) {
      const prov = localMatch.sourceProvenance as any;
      const isOwner = Boolean(
        userId && (prov?.uploadedByUserId === userId || prov?.ownerId === userId)
      );
      const isBookmarkedByUser = Boolean(userId && userLibraryPaperIds.has(localMatch.id));
      const isInUserLibrary = isOwner || isBookmarkedByUser;

      localStatus = {
        inLibrary: isInUserLibrary,
        paperId: localMatch.id,
        processingStatus: localMatch.status as any,
        hasFullText: Boolean(localMatch.storagePath) && localMatch.status === "COMPLETED",
      };
    } else {
      localStatus = {
        inLibrary: false,
      };
    }

    return {
      ...paper,
      localStatus,
    };
  });
}
