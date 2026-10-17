/**
 * Scholarly Identity Resolution & Deduplication Engine
 *
 * Merges multi-provider discovery results into canonical records based on:
 * 1. Normalized DOI (Primary)
 * 2. PMID / PMCID (Secondary)
 * 3. Semantic Scholar ID (Tertiary)
 * 4. Conservative Normalized Title + Year (Fallback only when strong IDs are absent)
 *
 * Preserves multi-provider provenance and applies deterministic metadata precedence.
 */

import { NormalizedExternalPaper, SourceProvider } from "./types";
import { normalizeDoi } from "@/lib/identifiers";

/**
 * Normalizes title conservatively for exact deduplication fallback.
 * Strips punctuation, collapses whitespace, lowercases.
 */
export function conservativeNormalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generates the canonical deduplication cluster key for a paper.
 */
export function getPaperClusterKey(paper: NormalizedExternalPaper): string {
  // 1. Normalized DOI
  if (paper.doi) {
    const cleanDoi = normalizeDoi(paper.doi);
    if (cleanDoi) return `doi:${cleanDoi}`;
  }

  // 2. PMID
  if (paper.pmid) {
    return `pmid:${paper.pmid}`;
  }

  // 3. PMCID
  if (paper.pmcid) {
    return `pmcid:${paper.pmcid.toUpperCase()}`;
  }

  // 4. ArXiv ID
  if (paper.arxivId) {
    return `arxiv:${paper.arxivId}`;
  }

  // 5. Semantic Scholar ID
  if (paper.semanticScholarId) {
    return `s2:${paper.semanticScholarId}`;
  }

  // 6. Conservative title matching (only if title is substantive)
  const normTitle = conservativeNormalizeTitle(paper.title);
  if (normTitle.length >= 20) {
    const yearSuffix = paper.year ? `:${paper.year}` : "";
    return `title:${normTitle}${yearSuffix}`;
  }

  // Unique fallback if no strong identifier exists
  return `raw:${paper.id}`;
}

/**
 * Merges two provider records representing the same scholarly paper.
 * Applies deterministic metadata precedence and preserves multi-provider provenance.
 */
export function mergePaperRecords(
  existing: NormalizedExternalPaper,
  incoming: NormalizedExternalPaper
): NormalizedExternalPaper {
  // Merge source providers without duplicates
  const providerSet = new Set<SourceProvider>([
    ...existing.sourceProviders,
    ...incoming.sourceProviders,
  ]);
  const sourceProviders = Array.from(providerSet);

  // Deterministic Precedence Rules:
  // DOI: Prefer Crossref > PubMed > Semantic Scholar
  const doi = existing.doi || incoming.doi || null;

  // PMID & PMCID: Prefer PubMed > Semantic Scholar
  const pmid = existing.pmid || incoming.pmid || null;
  const pmcid = existing.pmcid || incoming.pmcid || null;

  // ArXiv & S2
  const arxivId = existing.arxivId || incoming.arxivId || null;
  const semanticScholarId =
    existing.semanticScholarId || incoming.semanticScholarId || null;

  // Title: Prefer Crossref/PubMed (published title), or whichever is longer
  let title = existing.title;
  if (!title || (incoming.title && incoming.title.length > title.length && incoming.sourceProviders.includes("CROSSREF"))) {
    title = incoming.title;
  }

  // Abstract: Prefer PubMed > Semantic Scholar > Crossref, or whichever is substantive
  let abstract = existing.abstract;
  if (!abstract || (incoming.abstract && incoming.abstract.length > (abstract?.length || 0))) {
    abstract = incoming.abstract;
  }

  // Authors: Prefer the record with the most author entries
  let authors = existing.authors;
  if (incoming.authors && incoming.authors.length > (existing.authors?.length || 0)) {
    authors = incoming.authors;
  }

  // Journal / Venue: Prefer Crossref > PubMed > Semantic Scholar
  let journal = existing.journal;
  if (!journal || incoming.sourceProviders.includes("CROSSREF")) {
    journal = incoming.journal || journal;
  }

  // Publication Year & Date
  const year = existing.year || incoming.year || null;
  const publicationDate = existing.publicationDate || incoming.publicationDate || null;

  // External URL
  const externalUrl = existing.externalUrl || incoming.externalUrl || null;

  // Citation count: Prefer Semantic Scholar (academic graph) > Crossref
  let citationCount = existing.citationCount;
  if (incoming.sourceProviders.includes("SEMANTIC_SCHOLAR") && incoming.citationCount !== null) {
    citationCount = incoming.citationCount;
  } else if (citationCount === null && incoming.citationCount !== null) {
    citationCount = incoming.citationCount;
  }

  // Open Access: True if ANY provider confirms OA
  const isOpenAccess = existing.isOpenAccess || incoming.isOpenAccess;

  // Open Access PDF URL: Prefer PMC > Semantic Scholar OA > other
  let openAccessPdfUrl = existing.openAccessPdfUrl;
  let fullTextSource = existing.fullTextSource;
  let fullTextAvailability = existing.fullTextAvailability;

  if (pmcid) {
    openAccessPdfUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/pdf/`;
    fullTextSource = "PMC_OPEN_ACCESS";
    fullTextAvailability = "FULL_TEXT_AVAILABLE";
  } else if (incoming.openAccessPdfUrl && !openAccessPdfUrl) {
    openAccessPdfUrl = incoming.openAccessPdfUrl;
    fullTextSource = incoming.fullTextSource;
    fullTextAvailability = incoming.fullTextAvailability;
  }

  // Merge raw metadata
  const rawProviderMetadata = {
    ...(existing.rawProviderMetadata || {}),
    ...(incoming.rawProviderMetadata || {}),
  };

  const id = doi ? `doi:${doi}` : pmid ? `pmid:${pmid}` : existing.id;

  return {
    id,
    title,
    abstract,
    authors,
    publicationDate,
    year,
    journal,
    doi,
    pmid,
    pmcid,
    arxivId,
    semanticScholarId,
    externalUrl,
    sourceProviders,
    citationCount,
    isOpenAccess,
    openAccessPdfUrl,
    fullTextAvailability,
    fullTextSource,
    rawProviderMetadata,
  };
}

/**
 * Collects all known strong and secondary identifier keys for a paper.
 */
function getPaperIdentifierAliases(paper: NormalizedExternalPaper): string[] {
  const aliases: string[] = [];
  if (paper.doi) {
    const cleanDoi = normalizeDoi(paper.doi);
    if (cleanDoi) aliases.push(`doi:${cleanDoi}`);
  }
  if (paper.pmid) {
    aliases.push(`pmid:${paper.pmid}`);
  }
  if (paper.pmcid) {
    aliases.push(`pmcid:${paper.pmcid.toUpperCase()}`);
  }
  if (paper.arxivId) {
    aliases.push(`arxiv:${paper.arxivId}`);
  }
  if (paper.semanticScholarId) {
    aliases.push(`s2:${paper.semanticScholarId}`);
  }
  const normTitle = conservativeNormalizeTitle(paper.title);
  if (normTitle.length >= 20) {
    const yearSuffix = paper.year ? `:${paper.year}` : "";
    aliases.push(`title:${normTitle}${yearSuffix}`);
  }
  return aliases;
}

/**
 * Deduplicates an array of external papers from multiple providers.
 * Uses cross-identifier alias resolution so that a paper with PMID-only
 * merges correctly with a subsequent record carrying both PMID and DOI.
 */
export function deduplicateExternalPapers(
  rawPapers: NormalizedExternalPaper[]
): {
  papers: NormalizedExternalPaper[];
  duplicatesMergedCount: number;
} {
  const clusterMap = new Map<string, NormalizedExternalPaper>();
  const aliasToClusterKey = new Map<string, string>();
  let duplicatesMergedCount = 0;

  for (const paper of rawPapers) {
    const candidateAliases = getPaperIdentifierAliases(paper);

    // Check if any alias points to an existing cluster
    let existingClusterKey: string | null = null;
    for (const alias of candidateAliases) {
      if (aliasToClusterKey.has(alias)) {
        existingClusterKey = aliasToClusterKey.get(alias)!;
        break;
      }
    }

    if (existingClusterKey && clusterMap.has(existingClusterKey)) {
      const existing = clusterMap.get(existingClusterKey)!;
      const merged = mergePaperRecords(existing, paper);
      const newClusterKey = getPaperClusterKey(merged);

      if (newClusterKey !== existingClusterKey) {
        clusterMap.delete(existingClusterKey);
      }
      clusterMap.set(newClusterKey, merged);

      // Re-index all aliases for this cluster
      const allAliases = getPaperIdentifierAliases(merged);
      for (const a of allAliases) {
        aliasToClusterKey.set(a, newClusterKey);
      }

      duplicatesMergedCount++;
    } else {
      const clusterKey = getPaperClusterKey(paper);
      clusterMap.set(clusterKey, paper);
      for (const a of candidateAliases) {
        aliasToClusterKey.set(a, clusterKey);
      }
    }
  }

  return {
    papers: Array.from(clusterMap.values()),
    duplicatesMergedCount,
  };
}
