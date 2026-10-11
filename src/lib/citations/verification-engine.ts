/**
 * Server-Side Citation Verification Engine
 *
 * Implements deterministic scholarly registry cross-checks against
 * Crossref, PubMed, OpenAlex, and CitedEvidence CEDOA.
 *
 * Classifies outcomes into exactly 4 scientifically precise states:
 * - VERIFIED: Identifier resolved and metadata sufficiently matches.
 * - MISMATCHED: Identifier resolved but metadata conflicts.
 * - NOT FOUND: Completed authoritative lookup did not find the identifier.
 * - UNVERIFIABLE: Incomplete/malformed identifier, provider timeout, or insufficient evidence.
 *
 * Scientific Integrity Guarantee:
 * Verification of a citation's existence does NOT certify peer-review status,
 * empirical truth, scientific reproducibility, or support for specific claims.
 */

import {
  CitationVerificationRequest,
  CitationVerificationResult,
  RegisteredMetadata,
} from "./verification-types";
import { citedEvidenceClient } from "@/lib/citedevidence/client";

export const ACADEMIC_INTEGRITY_NOTICE =
  "Bibliographic verification confirms registry existence and metadata correspondence only. It does not certify peer-review status, scientific validity, editorial equivalence, or support for specific research statements.";

export const REGISTRY_CATALOG_NAME =
  "CitedEvidence Scholar catalog (covering CEDOA, OpenAlex, and indexed open scholarly records)";

/**
 * Normalizes text for comparison by lowercasing, removing punctuation, and collapsing whitespace.
 */
export function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Strip diacritics
    .replace(/[^\w\s]/g, " ") // Replace punctuation with space
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calculates token-level Jaccard similarity between two strings (0.0 to 1.0).
 */
export function calculateTitleSimilarity(titleA: string, titleB: string): number {
  const normA = normalizeText(titleA);
  const normB = normalizeText(titleB);

  if (!normA && !normB) return 1.0;
  if (!normA || !normB) return 0.0;
  if (normA === normB) return 1.0;

  // Substring check (e.g. title with vs without subtitle)
  if (normA.includes(normB) || normB.includes(normA)) {
    const minLen = Math.min(normA.length, normB.length);
    const maxLen = Math.max(normA.length, normB.length);
    if (minLen / maxLen >= 0.7) return 0.95;
  }

  const tokensA = new Set(normA.split(" ").filter((w) => w.length > 1));
  const tokensB = new Set(normB.split(" ").filter((w) => w.length > 1));

  if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

  let intersection = 0;
  tokensA.forEach((token) => {
    if (tokensB.has(token)) intersection++;
  });

  const unionSize = new Set([...Array.from(tokensA), ...Array.from(tokensB)]).size;
  return unionSize === 0 ? 0.0 : intersection / unionSize;
}

/**
 * Extracts a surname from an author name string (handles "First Last" and "Last, First").
 */
export function extractSurname(fullName: string): string {
  let cleaned = (fullName || "")
    .trim()
    .replace(/\bet\s+al\.?$/i, "")
    .trim();
  if (!cleaned) return "";

  if (cleaned.includes(",")) {
    // "Vaswani, Ashish" -> "vaswani"
    return normalizeText(cleaned.split(",")[0]);
  }

  // "Ashish Vaswani" -> "vaswani"
  const parts = cleaned.split(/\s+/);
  return normalizeText(parts[parts.length - 1]);
}

/**
 * Compares author lists.
 */
export function compareAuthors(
  submitted: string[] = [],
  registered: string[] = []
): { matches: boolean; similarity: number } {
  if (submitted.length === 0) {
    return { matches: true, similarity: 1.0 }; // Not supplied
  }
  if (registered.length === 0) {
    return { matches: false, similarity: 0.0 };
  }

  const submittedSurnames = submitted.map(extractSurname).filter(Boolean);
  const registeredSurnames = new Set(registered.map(extractSurname).filter(Boolean));

  if (submittedSurnames.length === 0) {
    return { matches: true, similarity: 1.0 };
  }

  let matchedCount = 0;
  for (const s of submittedSurnames) {
    if (registeredSurnames.has(s)) {
      matchedCount++;
    }
  }

  const ratio = matchedCount / submittedSurnames.length;
  // First author match is a strong anchor
  const firstAuthorMatch =
    submittedSurnames.length > 0 &&
    registeredSurnames.has(submittedSurnames[0]);

  const matches = (firstAuthorMatch && ratio >= 0.5) || ratio >= 0.7;
  return { matches, similarity: ratio };
}

/**
 * Parses and normalizes academic identifiers (DOI, PMID, arXiv).
 */
export function parseIdentifier(rawInput?: string): {
  type: "DOI" | "PMID" | "ARXIV" | "UNKNOWN";
  raw: string;
  normalized: string;
  canonicalUrl?: string;
  isValid: boolean;
} {
  const raw = (rawInput || "").trim();
  if (!raw) {
    return { type: "UNKNOWN", raw: "", normalized: "", isValid: false };
  }

  // 1. DOI Pattern (10.xxxx/...)
  const doiMatch = raw.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/);
  if (doiMatch) {
    // Strip trailing punctuation often caught in raw citations
    const cleanDoi = doiMatch[0].replace(/[.,;:)\]]+$/, "");
    return {
      type: "DOI",
      raw,
      normalized: cleanDoi,
      canonicalUrl: `https://doi.org/${cleanDoi}`,
      isValid: true,
    };
  }

  // 2. PMID Pattern (digits 6 to 9)
  const pmidMatch = raw.match(/(?:pmid:?\s*)?(\d{6,9})/i);
  if (pmidMatch && !raw.includes(".")) {
    const cleanPmid = pmidMatch[1];
    return {
      type: "PMID",
      raw,
      normalized: cleanPmid,
      canonicalUrl: `https://pubmed.ncbi.nlm.nih.gov/${cleanPmid}/`,
      isValid: true,
    };
  }

  // 3. arXiv ID Pattern (e.g. 1706.03762 or arXiv:1706.03762)
  const arxivMatch = raw.match(/(?:arxiv:?\s*)?(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  if (arxivMatch) {
    const cleanArxiv = arxivMatch[1];
    return {
      type: "ARXIV",
      raw,
      normalized: cleanArxiv,
      canonicalUrl: `https://arxiv.org/abs/${cleanArxiv}`,
      isValid: true,
    };
  }

  return { type: "UNKNOWN", raw, normalized: raw, isValid: false };
}

/**
 * Core Citation Verification Orchestrator.
 * Deterministically verifies reference data against scholarly registries.
 */
export async function verifyCitation(
  request: CitationVerificationRequest,
  options: { userId?: string; timeoutMs?: number } = {}
): Promise<CitationVerificationResult> {
  const timestamp = new Date().toISOString();
  const parsedId = parseIdentifier(request.identifier);

  // Helper for empty field tracking
  const emptyFields = {
    matched: [] as string[],
    conflicting: [] as string[],
    notSupplied: ["title", "authors", "year", "venue"],
  };

  // Case 1: No identifier provided
  if (!request.identifier || !request.identifier.trim()) {
    return {
      status: "UNVERIFIABLE",
      statusDetails:
        "No verifiable persistent identifier (DOI or PMID) was provided. Unindexed or custom citations without a persistent identifier cannot be resolved against authoritative registries.",
      submitted: request,
      comparedFields: emptyFields,
      academicIntegrityNotice: ACADEMIC_INTEGRITY_NOTICE,
      verifiedAt: timestamp,
    };
  }

  // Case 2: Malformed identifier syntax
  if (!parsedId.isValid) {
    return {
      status: "UNVERIFIABLE",
      statusDetails: `The provided identifier "${request.identifier}" does not match recognized academic DOI, PMID, or arXiv identifier formats.`,
      submitted: request,
      resolvedIdentifier: parsedId,
      comparedFields: emptyFields,
      academicIntegrityNotice: ACADEMIC_INTEGRITY_NOTICE,
      verifiedAt: timestamp,
    };
  }

  // Case 3: Upstream Client not configured
  if (!citedEvidenceClient.isConfigured()) {
    return {
      status: "UNVERIFIABLE",
      statusDetails:
        "The scholarly registry verification service is not configured on the server (missing CITEDEVIDENCE_API_KEY).",
      submitted: request,
      resolvedIdentifier: parsedId,
      comparedFields: emptyFields,
      academicIntegrityNotice: ACADEMIC_INTEGRITY_NOTICE,
      verifiedAt: timestamp,
    };
  }

  // Execute Upstream Resolution via find_paper (against CitedEvidence Scholar catalog)
  let upstreamPaper: any = null;
  let upstreamError: any = null;

  try {
    const response = await citedEvidenceClient.executeTool(
      "find_paper",
      { identifier: parsedId.normalized },
      { userId: options.userId, timeoutMs: options.timeoutMs || 15000 }
    );

    if (response?.structuredContent?.result) {
      upstreamPaper = response.structuredContent.result;
    } else if (response?.content) {
      const textChunk = response.content.find((c: any) => c.type === "text")?.text;
      if (textChunk) {
        try {
          upstreamPaper = JSON.parse(textChunk);
        } catch {
          // ignore
        }
      }
    }
  } catch (err: any) {
    upstreamError = err;
  }

  // Handle Upstream Network / Rate Limit / Timeout Failures
  if (upstreamError) {
    const isRateLimit = upstreamError?.status === 429 || upstreamError?.message?.includes("429");
    const isCircuitOpen = upstreamError?.message?.includes("Circuit breaker");
    const isTimeout =
      upstreamError?.name === "TimeoutError" ||
      upstreamError?.message?.toLowerCase().includes("timeout") ||
      upstreamError?.message?.toLowerCase().includes("aborted");

    return {
      status: "UNVERIFIABLE",
      statusDetails: isRateLimit
        ? "Scholarly registry verification rate limit reached. Please wait a moment and retry."
        : isCircuitOpen
        ? "Scholarly registry lookup service is temporarily in cooldown. Retry shortly."
        : isTimeout
        ? "Scholarly registry lookup timed out while querying the catalog."
        : `Scholarly registry lookup failed due to network or upstream provider outage: ${upstreamError.message}`,
      submitted: request,
      resolvedIdentifier: parsedId,
      comparedFields: emptyFields,
      academicIntegrityNotice: ACADEMIC_INTEGRITY_NOTICE,
      verifiedAt: timestamp,
    };
  }

  const rawErrorMessage = (upstreamPaper?.error || "").toString();
  const lowerError = rawErrorMessage.toLowerCase();

  // Check if response indicates missing index coverage
  const isMissingIndexCoverage =
    lowerError.includes("index coverage") ||
    lowerError.includes("unindexed") ||
    lowerError.includes("coverage unavailable") ||
    lowerError.includes("repository not indexed");

  if (isMissingIndexCoverage) {
    return {
      status: "UNVERIFIABLE",
      statusDetails: `The scholarly catalog does not currently index this repository or source collection (${rawErrorMessage}).`,
      submitted: request,
      resolvedIdentifier: parsedId,
      comparedFields: emptyFields,
      academicIntegrityNotice: ACADEMIC_INTEGRITY_NOTICE,
      verifiedAt: timestamp,
    };
  }

  // Check if response indicates provider outage, service degradation, rate limits, or server errors
  const isProviderOutageOrDegradation =
    lowerError.includes("outage") ||
    lowerError.includes("service unavailable") ||
    lowerError.includes("temporarily unavailable") ||
    lowerError.includes("timeout") ||
    lowerError.includes("rate limit") ||
    lowerError.includes("429") ||
    lowerError.includes("500") ||
    lowerError.includes("502") ||
    lowerError.includes("503") ||
    lowerError.includes("504") ||
    lowerError.includes("internal error") ||
    lowerError.includes("service error") ||
    lowerError.includes("server error") ||
    lowerError.includes("database connection") ||
    lowerError.includes("network error") ||
    lowerError.includes("gateway") ||
    lowerError.includes("connection refused") ||
    lowerError.includes("failed to fetch");

  if (isProviderOutageOrDegradation) {
    return {
      status: "UNVERIFIABLE",
      statusDetails: `Scholarly registry lookup could not be completed due to upstream provider outage or service degradation (${rawErrorMessage}).`,
      submitted: request,
      resolvedIdentifier: parsedId,
      comparedFields: emptyFields,
      academicIntegrityNotice: ACADEMIC_INTEGRITY_NOTICE,
      verifiedAt: timestamp,
    };
  }

  // Incomplete / truncated / empty response received without explicit not-found indication
  const hasNoData =
    !upstreamPaper ||
    (typeof upstreamPaper === "object" &&
      Object.keys(upstreamPaper).length === 0) ||
    (!upstreamPaper.title && !upstreamPaper.doi && !upstreamPaper.year && !upstreamPaper.error);

  if (hasNoData) {
    return {
      status: "UNVERIFIABLE",
      statusDetails:
        "Incomplete or unparseable record received from scholarly registry provider.",
      submitted: request,
      resolvedIdentifier: parsedId,
      comparedFields: emptyFields,
      academicIntegrityNotice: ACADEMIC_INTEGRITY_NOTICE,
      verifiedAt: timestamp,
    };
  }

  // Case 4: Identifier explicitly not found by catalog lookup
  const isNotFound = Boolean(upstreamPaper.error);

  if (isNotFound) {
    return {
      status: "NOT FOUND",
      statusDetails: `The identifier "${parsedId.normalized}" was not found in the CitedEvidence Scholar catalog (covering CEDOA, OpenAlex, and indexed open scholarly records). This indicates absence from these indexed collections, but does not definitively establish non-existence in unindexed publisher repositories or private registries.`,
      submitted: request,
      resolvedIdentifier: parsedId,
      comparedFields: emptyFields,
      academicIntegrityNotice: ACADEMIC_INTEGRITY_NOTICE,
      verifiedAt: timestamp,
    };
  }

  // Registered metadata found
  const registered: RegisteredMetadata = {
    title: upstreamPaper.title || "",
    authors: Array.isArray(upstreamPaper.authors) ? upstreamPaper.authors : [],
    year: upstreamPaper.year ? Number(upstreamPaper.year) : undefined,
    venue: upstreamPaper.venue || upstreamPaper.journal || "",
    volume: upstreamPaper.volume || undefined,
    issue: upstreamPaper.issue || undefined,
    pages: upstreamPaper.pages || undefined,
    doi: upstreamPaper.doi || (parsedId.type === "DOI" ? parsedId.normalized : undefined),
    pmid: upstreamPaper.pmid || (parsedId.type === "PMID" ? parsedId.normalized : undefined),
    sourceRegistry:
      upstreamPaper.source_name ||
      (upstreamPaper.source === "pmc" ? "PubMed Central (via CitedEvidence)" : REGISTRY_CATALOG_NAME),
    publicationType:
      upstreamPaper.type ||
      ((upstreamPaper.venue && /arxiv|biorxiv|medrxiv/i.test(upstreamPaper.venue)) ? "preprint" : undefined),
    isPreprint:
      (upstreamPaper.venue && /arxiv|biorxiv|medrxiv/i.test(upstreamPaper.venue)) ||
      (upstreamPaper.type && /preprint/i.test(upstreamPaper.type)),
    openAccessUrl: upstreamPaper.open_access_url || null,
  };

  // Deterministic Metadata Matching and Field Accounting
  const matchedFields: string[] = [];
  const conflictingFields: string[] = [];
  const notSuppliedFields: string[] = [];
  const discrepancies: CitationVerificationResult["discrepancies"] = {};

  // 1. Title Matching
  if (request.title && request.title.trim()) {
    const similarity = calculateTitleSimilarity(request.title, registered.title);
    const titleMatches = similarity >= 0.85;
    discrepancies.title = {
      submitted: request.title,
      registered: registered.title,
      matches: titleMatches,
      similarity: Number(similarity.toFixed(2)),
    };
    if (titleMatches) {
      matchedFields.push("title");
    } else {
      conflictingFields.push("title");
    }
  } else {
    notSuppliedFields.push("title");
  }

  // 2. Author Matching
  const hasSuppliedAuthors =
    Array.isArray(request.authors) &&
    request.authors.some((a) => typeof a === "string" && a.trim().length > 0);

  if (hasSuppliedAuthors) {
    const authorComparison = compareAuthors(request.authors, registered.authors);
    discrepancies.authors = {
      submitted: request.authors!,
      registered: registered.authors,
      matches: authorComparison.matches,
      similarity: Number(authorComparison.similarity.toFixed(2)),
    };
    if (authorComparison.matches) {
      matchedFields.push("authors");
    } else {
      conflictingFields.push("authors");
    }
  } else {
    notSuppliedFields.push("authors");
  }

  // 3. Year Matching
  const hasSuppliedYear =
    request.year !== undefined && request.year !== null && String(request.year).trim().length > 0;

  if (hasSuppliedYear) {
    const subYear = Number(request.year);
    const regYear = registered.year;
    const yearMatches =
      !isNaN(subYear) && regYear !== undefined && Math.abs(subYear - regYear) <= 1;
    discrepancies.year = {
      submitted: request.year!,
      registered: registered.year ?? "N/A",
      matches: yearMatches,
    };
    if (yearMatches) {
      matchedFields.push("year");
    } else {
      conflictingFields.push("year");
    }
  } else {
    notSuppliedFields.push("year");
  }

  // 4. Venue Matching (Informative, non-blocking if submitted was omitted)
  if (request.journal && request.journal.trim()) {
    const subNorm = normalizeText(request.journal);
    const regNorm = normalizeText(registered.venue || "");
    const venueMatches =
      subNorm.length === 0 ||
      regNorm.length === 0 ||
      subNorm.includes(regNorm) ||
      regNorm.includes(subNorm) ||
      calculateTitleSimilarity(request.journal, registered.venue || "") >= 0.6;

    discrepancies.venue = {
      submitted: request.journal,
      registered: registered.venue || "Unspecified",
      matches: venueMatches,
    };
    if (venueMatches) {
      matchedFields.push("venue");
    } else {
      conflictingFields.push("venue");
    }
  } else {
    notSuppliedFields.push("venue");
  }

  // Detect Preprint vs. Published Edition Differences (Scientifically Neutral)
  let versionNotice: string | undefined;
  const isArxivInput =
    parsedId.type === "ARXIV" || /arxiv/i.test(parsedId.normalized);

  if (isArxivInput && registered.venue && !/arxiv/i.test(registered.venue)) {
    versionNotice = `Preprint record (${parsedId.type === "ARXIV" ? "arXiv" : "open repository"}) correlates with published venue record (${registered.venue}). Bibliographic correlation does not certify that the preprint text underwent peer review or is identical to the final published edition.`;
  } else if (registered.isPreprint || registered.publicationType === "preprint") {
    versionNotice = `Document registered as an unreviewed preprint in an open repository (publication type: ${registered.publicationType || "preprint"}). Revisions, peer-review certification, and editorial status are unverified.`;
  } else if (registered.publicationType) {
    versionNotice = `Registered record publication type: ${registered.publicationType}.`;
  }

  const hasConflicts = conflictingFields.length > 0;
  const finalStatus: "VERIFIED" | "MISMATCHED" = hasConflicts
    ? "MISMATCHED"
    : "VERIFIED";

  let statusDetails: string;

  if (finalStatus === "MISMATCHED") {
    const conflictStr = conflictingFields.join(", ");
    const matchedStr =
      matchedFields.length > 0 ? ` Matched fields: ${matchedFields.join(", ")}.` : "";
    const omittedStr =
      notSuppliedFields.length > 0
        ? ` Unsupplied fields: ${notSuppliedFields.join(", ")}.`
        : "";
    statusDetails = `Identifier resolved in ${registered.sourceRegistry}, but metadata discrepancies were detected in: ${conflictStr}.${matchedStr}${omittedStr}`;
  } else {
    // finalStatus === "VERIFIED"
    if (matchedFields.length === 0) {
      // Identifier-only submission: User provided identifier with no bibliographic fields
      statusDetails = `Identifier "${parsedId.normalized}" was verified in ${registered.sourceRegistry} and authoritative registry metadata was retrieved. No bibliographic fields were supplied for metadata cross-matching.`;
    } else if (notSuppliedFields.length === 0) {
      // All 4 fields supplied and all matched
      statusDetails = `Identifier verified in ${registered.sourceRegistry}. All supplied bibliographic metadata (${matchedFields.join(", ")}) aligns with official records.`;
    } else {
      // Partial metadata: some matched, none conflicted, some not supplied
      statusDetails = `Identifier verified in ${registered.sourceRegistry}. Compared fields (${matchedFields.join(", ")}) align with official registry records. Fields not supplied for comparison: ${notSuppliedFields.join(", ")}.`;
    }
  }

  return {
    status: finalStatus,
    statusDetails,
    submitted: request,
    resolvedIdentifier: parsedId,
    registeredMetadata: registered,
    comparedFields: {
      matched: matchedFields,
      conflicting: conflictingFields,
      notSupplied: notSuppliedFields,
    },
    discrepancies: Object.keys(discrepancies).length > 0 ? discrepancies : undefined,
    versionNotice,
    academicIntegrityNotice: ACADEMIC_INTEGRITY_NOTICE,
    verifiedAt: timestamp,
  };
}
