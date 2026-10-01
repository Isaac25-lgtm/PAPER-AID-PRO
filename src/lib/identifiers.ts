/**
 * Academic Identifier Normalization & Validation Utilities
 *
 * Normalizes optional unique academic identifiers (DOI, arXiv ID) to canonical
 * stored values at the server boundary before database persistence.
 * Ensures whitespace/blank inputs evaluate to null rather than empty strings,
 * preventing unique constraint collisions while preserving legitimate uniqueness checks.
 */

/**
 * Normalizes an arbitrary optional string identifier (e.g. arXiv ID, ORCID, DOI).
 * - Trims whitespace
 * - Converts empty string or whitespace-only to null
 */
export function normalizeOptionalIdentifier(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

/**
 * Normalizes a DOI string to its canonical stored format.
 *
 * Rules:
 * - Trims leading/trailing whitespace
 * - Strips protocol & domain prefixes: "https://doi.org/", "http://doi.org/", "http://dx.doi.org/", "https://dx.doi.org/"
 * - Strips "doi:" prefix case-insensitively (e.g. "DOI: ", "doi:", "DOI :")
 * - Consistently lowercases the DOI prefix and identifier path
 * - Converts empty / blank result to null
 *
 * Examples:
 * - "https://doi.org/10.3390/cancers14020277" -> "10.3390/cancers14020277"
 * - "http://doi.org/10.3390/cancers14020277" -> "10.3390/cancers14020277"
 * - "doi:10.3390/cancers14020277" -> "10.3390/cancers14020277"
 * - "DOI: 10.3390/cancers14020277" -> "10.3390/cancers14020277"
 * - "DOI: 10.3390/CANCERS14020277" -> "10.3390/cancers14020277"
 * - "10.3390/cancers14020277" -> "10.3390/cancers14020277"
 * - "   " -> null
 * - "" -> null
 */
export function normalizeDoi(value: unknown): string | null {
  const raw = normalizeOptionalIdentifier(value);
  if (!raw) return null;

  let cleaned = raw
    // Strip URL prefixes case-insensitively
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    // Strip "doi:" or "doi :" prefix case-insensitively
    .replace(/^doi\s*:\s*/i, "")
    .trim();

  if (!cleaned) return null;

  // Normalize casing consistently (lowercase)
  return cleaned.toLowerCase();
}

/**
 * Normalizes an arXiv identifier to its canonical stored format.
 *
 * Rules:
 * - Trims leading/trailing whitespace
 * - Strips arXiv URL prefixes: "https://arxiv.org/abs/", "http://arxiv.org/abs/", "https://arxiv.org/pdf/", etc.
 * - Strips "arxiv:" or "arXiv:" prefix case-insensitively
 * - Converts empty / blank result to null
 *
 * Examples:
 * - "arXiv:1706.03762" -> "1706.03762"
 * - "https://arxiv.org/abs/1706.03762" -> "1706.03762"
 * - "1706.03762" -> "1706.03762"
 * - "" -> null
 * - "   " -> null
 */
export function normalizeArxivId(value: unknown): string | null {
  const raw = normalizeOptionalIdentifier(value);
  if (!raw) return null;

  let cleaned = raw
    .replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//i, "")
    .replace(/^arxiv\s*:\s*/i, "")
    .replace(/\.pdf$/i, "")
    .trim();

  if (!cleaned) return null;
  return cleaned;
}

/**
 * Normalizes a PubMed ID (PMID) to its canonical numeric string format.
 *
 * Rules:
 * - Trims whitespace
 * - Strips URL prefixes: "https://pubmed.ncbi.nlm.nih.gov/", "http://pubmed.ncbi.nlm.nih.gov/"
 * - Strips "pmid:" or "PMID:" prefix
 * - Converts empty / blank result to null
 */
export function normalizePmid(value: unknown): string | null {
  const raw = normalizeOptionalIdentifier(value);
  if (!raw) return null;

  let cleaned = raw
    .replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//i, "")
    .replace(/^pmid\s*:\s*/i, "")
    .replace(/\/.*$/, "")
    .trim();

  if (!cleaned || !/^\d+$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Normalizes a PubMed Central ID (PMCID) to its canonical "PMC..." format.
 *
 * Rules:
 * - Trims whitespace
 * - Strips URL prefixes: "https://www.ncbi.nlm.nih.gov/pmc/articles/", "https://pmc.ncbi.nlm.nih.gov/articles/"
 * - Strips "pmcid:" or "pmc:" prefix
 * - Ensures canonical uppercase "PMC" prefix if numeric digits follow
 * - Converts empty / blank result to null
 */
export function normalizePmcid(value: unknown): string | null {
  const raw = normalizeOptionalIdentifier(value);
  if (!raw) return null;

  let cleaned = raw
    .replace(/^https?:\/\/(www\.)?(pmc\.)?ncbi\.nlm\.nih\.gov\/pmc\/articles\//i, "")
    .replace(/^https?:\/\/pmc\.ncbi\.nlm\.nih\.gov\/articles\//i, "")
    .replace(/^pmc(-id)?\s*:\s*/i, "")
    .replace(/^pmcid?\s*:\s*/i, "")
    .replace(/[;\/\s].*$/, "")
    .trim();

  if (!cleaned) return null;

  // Extract numeric PMCID digits and prepend canonical uppercase PMC
  const match = cleaned.match(/^(?:PMC)?(\d+)$/i);
  if (match) {
    return `PMC${match[1]}`;
  }

  return cleaned.toUpperCase();
}

/**
 * Normalizes a Semantic Scholar ID.
 *
 * Rules:
 * - Trims whitespace
 * - Strips URL prefixes: "https://www.semanticscholar.org/paper/"
 * - Converts empty / blank result to null
 */
export function normalizeSemanticScholarId(value: unknown): string | null {
  const raw = normalizeOptionalIdentifier(value);
  if (!raw) return null;

  let cleaned = raw
    .replace(/^https?:\/\/(www\.)?semanticscholar\.org\/paper\/([^\/]+\/)?/i, "")
    .replace(/\/.*$/, "")
    .trim();

  if (!cleaned) return null;
  return cleaned.toLowerCase();
}

/**
 * Maps a Prisma P2002 unique constraint error to a clear, actionable user message.
 * Inspects `err.meta.target` to distinguish DOI, arXiv, PMID, PMCID, author, and account collisions
 * without exposing raw database exceptions or stack traces.
 */
export function getFriendlyP2002ErrorMessage(err: any): string {
  const target = err?.meta?.target;
  const targetStr = Array.isArray(target) ? target.join(", ") : String(target || "");

  if (targetStr.includes("doi")) {
    return "A paper with this DOI already exists.";
  }
  if (targetStr.includes("arxivId") || targetStr.includes("arxiv_id")) {
    return "A paper with this arXiv ID already exists.";
  }
  if (targetStr.includes("pmid")) {
    return "A paper with this PubMed ID (PMID) already exists.";
  }
  if (targetStr.includes("pmcid")) {
    return "A paper with this PubMed Central ID (PMCID) already exists.";
  }
  if (targetStr.includes("semanticScholarId")) {
    return "A paper with this Semantic Scholar ID already exists.";
  }
  if (
    (targetStr.includes("paperId") && targetStr.includes("authorId")) ||
    targetStr.includes("paper_authors")
  ) {
    return "An author was listed multiple times for this paper.";
  }
  if (targetStr.includes("email")) {
    return "An account with this email already exists.";
  }
  if (targetStr.includes("title")) {
    return "A paper with this title already exists.";
  }
  return "A paper with one of these unique identifiers already exists.";
}
