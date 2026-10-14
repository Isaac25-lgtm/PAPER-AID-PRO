import "server-only";
import { normalizeDoi, normalizePmcid } from "@/lib/identifiers";
import { validateSafePdfUrl } from "./full-text-service";
import { reconstructAbstract } from "@/lib/citedevidence/client";

export type OpenAccessVersion =
  | "publishedVersion"
  | "acceptedVersion"
  | "submittedVersion"
  | "unknown";

export type OpenAccessDiscoveryStatus =
  | "SEARCHING"
  | "OPEN_ACCESS_PDF_FOUND"
  | "OPEN_ACCESS_EXTERNAL_LINK_ONLY"
  | "NO_OPEN_ACCESS_LOCATED"
  | "PROCESSING_FULL_TEXT"
  | "READY_FOR_AI"
  | "REFERENCE_SAVED_FULL_TEXT_NEEDED"
  | "IMPORT_FAILED";

export interface OpenAccessCandidateLocation {
  pdfUrl: string | null;
  landingPageUrl: string | null;
  isDirectPdf: boolean;
  version: OpenAccessVersion;
  license: string | null;
  hostType: "publisher" | "repository" | "unknown";
  sourceName: string;
  isLawfullyAcquirable: boolean;
  isPreprint: boolean;
  provenance: string;
}

export interface OpenAccessDiscoveryResult {
  doi: string;
  isFound: boolean;
  status: OpenAccessDiscoveryStatus;
  bestLocation: OpenAccessCandidateLocation | null;
  allLocations: OpenAccessCandidateLocation[];
  title?: string | null;
  journal?: string | null;
  publicationDate?: string | null;
  abstract?: string | null;
  authors?: string[];
  pmcid?: string | null;
  explanation: string;
  provider: "UNPAYWALL" | "OPENALEX" | "PMC" | "NONE";
}

// In-memory discovery cache with 1 hour (3600s) TTL
interface CacheEntry {
  result: OpenAccessDiscoveryResult;
  expiresAt: number;
}
const discoveryCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Normalizes academic license strings and evaluates whether automated
 * downloading, storing, and computational extraction is permissible.
 */
export function evaluateReusePermission(
  licenseStr: string | null | undefined,
  hostType: "publisher" | "repository" | "unknown" = "unknown"
): { isPermissive: boolean; canonicalLicense: string | null } {
  if (!licenseStr || typeof licenseStr !== "string") {
    return { isPermissive: false, canonicalLicense: null };
  }

  const clean = licenseStr.trim().toLowerCase();

  let canonicalLicense = clean;
  if (clean.includes("cc-by-nc-nd") || clean.includes("/by-nc-nd/")) {
    canonicalLicense = "cc-by-nc-nd";
  } else if (clean.includes("cc-by-nc-sa") || clean.includes("/by-nc-sa/")) {
    canonicalLicense = "cc-by-nc-sa";
  } else if (clean.includes("cc-by-nc") || clean.includes("/by-nc/")) {
    canonicalLicense = "cc-by-nc";
  } else if (clean.includes("cc-by-sa") || clean.includes("/by-sa/")) {
    canonicalLicense = "cc-by-sa";
  } else if (clean.includes("cc-by-nd") || clean.includes("/by-nd/")) {
    canonicalLicense = "cc-by-nd";
  } else if (clean.includes("cc-by") || clean.includes("/by/")) {
    canonicalLicense = "cc-by";
  } else if (clean.includes("cc0") || clean.includes("/zero/")) {
    canonicalLicense = "cc0";
  } else if (clean.includes("publicdomain") || clean.includes("public-domain")) {
    canonicalLicense = "public-domain";
  }

  // Non-commercial, no-derivatives, bronze, or publisher-specific licenses
  // are NOT blanket permission for automated platform downloading and server-side storage.
  const isNonCommercial =
    canonicalLicense === "cc-by-nc" ||
    canonicalLicense === "cc-by-nc-sa" ||
    canonicalLicense === "cc-by-nc-nd" ||
    clean.includes("noncommercial") ||
    clean.includes("/by-nc") ||
    clean.includes("-nc");

  const isNoDerivatives =
    canonicalLicense === "cc-by-nd" ||
    canonicalLicense === "cc-by-nc-nd" ||
    clean.includes("/by-nd") ||
    clean.includes("-nd");

  const isRestrictedOrVague =
    clean.includes("publisher-specific") ||
    clean === "bronze" ||
    clean === "closed" ||
    clean === "unspecified";

  if (isNonCommercial || isNoDerivatives || isRestrictedOrVague) {
    return { isPermissive: false, canonicalLicense };
  }

  // Fully permissive open access licenses allowing computational reproduction:
  // CC0, Public Domain, CC-BY, CC-BY-SA
  const isPermissive =
    canonicalLicense === "cc0" ||
    canonicalLicense === "public-domain" ||
    canonicalLicense === "cc-by" ||
    canonicalLicense === "cc-by-sa";

  return { isPermissive, canonicalLicense };
}

/**
 * Maps arbitrary version string to canonical OpenAccessVersion.
 */
export function normalizeOaVersion(rawVersion: string | null | undefined): OpenAccessVersion {
  if (!rawVersion) return "unknown";
  const lower = rawVersion.toLowerCase();
  if (lower.includes("published") || lower === "vor" || lower === "publishedversion") {
    return "publishedVersion";
  }
  if (lower.includes("accepted") || lower === "am" || lower === "postprint" || lower === "acceptedversion") {
    return "acceptedVersion";
  }
  if (lower.includes("submitted") || lower === "sm" || lower === "preprint" || lower === "submittedversion") {
    return "submittedVersion";
  }
  return "unknown";
}

/**
 * Configured polite contact email for scholarly APIs.
 */
function getConfiguredContactEmail(): string {
  return (
    process.env.UNPAYWALL_EMAIL?.trim() ||
    process.env.CROSSREF_MAILTO?.trim() ||
    "scholar@airesearchhub.org"
  );
}

/**
 * Searches Unpaywall DOI API (Primary official lookup).
 * GET https://api.unpaywall.org/v2/{doi}?email={configured_contact_email}
 */
async function queryUnpaywall(
  normalizedDoi: string,
  timeoutMs = 7000
): Promise<{
  success: boolean;
  locations: OpenAccessCandidateLocation[];
  title?: string | null;
  journal?: string | null;
  publicationDate?: string | null;
  abstract?: string | null;
  pmcid?: string | null;
  isOa: boolean;
}> {
  const email = encodeURIComponent(getConfiguredContactEmail());
  const url = `https://api.unpaywall.org/v2/${encodeURIComponent(normalizedDoi)}?email=${email}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": `AIResearchHub/1.0 (academic-platform; mailto:${getConfiguredContactEmail()})`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status === 404) {
      return { success: true, locations: [], isOa: false };
    }

    if (!res.ok) {
      return { success: false, locations: [], isOa: false };
    }

    const data = await res.json();
    const isOa = Boolean(data.is_oa);
    const rawLocations = Array.isArray(data.oa_locations) ? data.oa_locations : [];
    if (data.best_oa_location && !rawLocations.some((l: any) => l.url === data.best_oa_location.url)) {
      rawLocations.unshift(data.best_oa_location);
    }

    const locations: OpenAccessCandidateLocation[] = [];

    for (const loc of rawLocations) {
      const pdfUrl = loc.url_for_pdf || (loc.url && loc.url.toLowerCase().endsWith(".pdf") ? loc.url : null);
      const landingPageUrl = loc.url_for_landing_page || loc.url || null;
      const hostType = loc.host_type === "publisher" ? "publisher" : "repository";
      const version = normalizeOaVersion(loc.version);
      const { isPermissive, canonicalLicense } = evaluateReusePermission(loc.license, hostType);

      // Verify URL safety (must be HTTPS and not match obvious blocked hosts)
      const isDirectPdf = Boolean(pdfUrl && validateSafePdfUrl(pdfUrl).safe);

      locations.push({
        pdfUrl: isDirectPdf ? pdfUrl : null,
        landingPageUrl,
        isDirectPdf,
        version,
        license: canonicalLicense,
        hostType,
        sourceName: loc.endpoint_id ? `Unpaywall:${loc.endpoint_id}` : `Unpaywall:${hostType}`,
        isLawfullyAcquirable: isDirectPdf && isPermissive,
        isPreprint: version === "submittedVersion",
        provenance: `Unpaywall API (host: ${hostType}, evidence: ${loc.evidence || "oa_location"})`,
      });
    }

    // Extract PMCID if present in pmh_id or metadata
    let pmcid: string | null = null;
    if (data.pmh_id && data.pmh_id.toLowerCase().includes("pmc")) {
      pmcid = normalizePmcid(data.pmh_id);
    }

    return {
      success: true,
      locations,
      title: data.title || null,
      journal: data.journal_name || null,
      publicationDate: data.published_date || null,
      pmcid,
      isOa,
    };
  } catch (err) {
    return { success: false, locations: [], isOa: false };
  }
}

/**
 * Searches OpenAlex Works API (Secondary official lookup).
 * GET https://api.openalex.org/works/https://doi.org/{doi}
 */
async function queryOpenAlex(
  normalizedDoi: string,
  timeoutMs = 7000
): Promise<{
  success: boolean;
  locations: OpenAccessCandidateLocation[];
  title?: string | null;
  journal?: string | null;
  publicationDate?: string | null;
  abstract?: string | null;
  authors?: string[];
  pmcid?: string | null;
  isOa: boolean;
}> {
  const email = encodeURIComponent(getConfiguredContactEmail());
  const url = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(normalizedDoi)}?mailto=${email}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": `AIResearchHub/1.0 (academic-platform; mailto:${getConfiguredContactEmail()})`,
  };

  const apiKey = process.env.OPENALEX_API_KEY?.trim();
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status === 404) {
      return { success: true, locations: [], isOa: false };
    }

    if (!res.ok) {
      return { success: false, locations: [], isOa: false };
    }

    const work = await res.json();
    const isOa = Boolean(work.open_access?.is_oa);
    const rawLocations = Array.isArray(work.locations) ? work.locations : [];
    if (work.best_oa_location && !rawLocations.some((l: any) => l.landing_page_url === work.best_oa_location.landing_page_url)) {
      rawLocations.unshift(work.best_oa_location);
    }

    const locations: OpenAccessCandidateLocation[] = [];

    for (const loc of rawLocations) {
      if (!loc.is_oa && !loc.pdf_url) continue;

      const pdfUrl = loc.pdf_url || (loc.landing_page_url && loc.landing_page_url.toLowerCase().endsWith(".pdf") ? loc.landing_page_url : null);
      const landingPageUrl = loc.landing_page_url || loc.pdf_url || null;
      const hostType = loc.source?.type === "journal" || loc.source?.type === "publisher" ? "publisher" : "repository";
      const version = normalizeOaVersion(loc.version);
      const { isPermissive, canonicalLicense } = evaluateReusePermission(loc.license, hostType);

      const isDirectPdf = Boolean(pdfUrl && validateSafePdfUrl(pdfUrl).safe);

      locations.push({
        pdfUrl: isDirectPdf ? pdfUrl : null,
        landingPageUrl,
        isDirectPdf,
        version,
        license: canonicalLicense,
        hostType,
        sourceName: loc.source?.display_name ? `OpenAlex:${loc.source.display_name}` : `OpenAlex:${hostType}`,
        isLawfullyAcquirable: isDirectPdf && isPermissive,
        isPreprint: version === "submittedVersion",
        provenance: `OpenAlex Works API (${loc.source?.display_name || hostType})`,
      });
    }

    // Reconstruct abstract from inverted index if present
    let abstract: string | null = null;
    if (work.abstract_inverted_index) {
      abstract = reconstructAbstract(work.abstract_inverted_index);
    }

    // Authors
    const authors: string[] = [];
    if (Array.isArray(work.authorships)) {
      for (const a of work.authorships) {
        if (a.author?.display_name) {
          authors.push(a.author.display_name.trim());
        }
      }
    }

    // Primary location source journal
    const journal = work.primary_location?.source?.display_name || null;

    return {
      success: true,
      locations,
      title: work.title || work.display_name || null,
      journal,
      publicationDate: work.publication_date || null,
      abstract,
      authors,
      isOa,
    };
  } catch (err) {
    return { success: false, locations: [], isOa: false };
  }
}

/**
 * Selects the optimal location according to deterministic priority rules:
 * 1. Verified publisher-hosted OA PDF with suitable reuse rights (publishedVersion)
 * 2. Trusted institutional or disciplinary repository copy with suitable reuse rights
 * 3. Accepted manuscript with suitable reuse rights
 * 4. Submitted preprint with suitable reuse rights (clearly preserved as preprint)
 * 5. External landing page / link-only (when license is unclear or no direct PDF exists)
 */
export function selectBestOpenAccessLocation(
  locations: OpenAccessCandidateLocation[]
): OpenAccessCandidateLocation | null {
  if (!locations || locations.length === 0) return null;

  // Rank 1: Directly acquirable publisher published version
  const rank1 = locations.find(
    (l) => l.isLawfullyAcquirable && l.isDirectPdf && l.hostType === "publisher" && l.version === "publishedVersion"
  );
  if (rank1) return rank1;

  // Rank 2: Directly acquirable trusted repository published version
  const rank2 = locations.find(
    (l) => l.isLawfullyAcquirable && l.isDirectPdf && l.version === "publishedVersion"
  );
  if (rank2) return rank2;

  // Rank 3: Directly acquirable accepted manuscript (postprint)
  const rank3 = locations.find(
    (l) => l.isLawfullyAcquirable && l.isDirectPdf && l.version === "acceptedVersion"
  );
  if (rank3) return rank3;

  // Rank 4: Directly acquirable submitted preprint
  const rank4 = locations.find(
    (l) => l.isLawfullyAcquirable && l.isDirectPdf && l.version === "submittedVersion"
  );
  if (rank4) return rank4;

  // Rank 5: Any other directly acquirable PDF
  const rank5 = locations.find((l) => l.isLawfullyAcquirable && l.isDirectPdf);
  if (rank5) return rank5;

  // Rank 6: Direct PDF available but reuse permission is unclear or restrictive
  // (Cannot automatically download into storage, but preserved for reading)
  const rank6 = locations.find((l) => l.isDirectPdf && l.pdfUrl);
  if (rank6) return rank6;

  // Rank 7: Best external landing page
  const rank7 = locations.find((l) => l.landingPageUrl);
  if (rank7) return rank7;

  return locations[0];
}

/**
 * Master Open-Access Discovery Orchestrator.
 * Accepts any DOI string, normalizes it, queries official Unpaywall & OpenAlex APIs,
 * applies deterministic license and source selection rules, and caches results.
 */
export async function discoverOpenAccessForDoi(
  rawDoi: string,
  options: { forceRefresh?: boolean; timeoutMs?: number } = {}
): Promise<OpenAccessDiscoveryResult> {
  const doi = normalizeDoi(rawDoi);
  if (!doi) {
    return {
      doi: rawDoi || "",
      isFound: false,
      status: "NO_OPEN_ACCESS_LOCATED",
      bestLocation: null,
      allLocations: [],
      explanation: "Invalid DOI format provided.",
      provider: "NONE",
    };
  }

  // Check cache unless forceRefresh is true
  if (!options.forceRefresh) {
    const cached = discoveryCache.get(doi);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
  }

  const timeoutMs = options.timeoutMs || 8000;

  // 1. Primary Lookup: Unpaywall
  const unpaywallRes = await queryUnpaywall(doi, timeoutMs);

  // 2. Secondary Lookup: OpenAlex
  const openAlexRes = await queryOpenAlex(doi, timeoutMs);

  // Combine and deduplicate locations
  const allLocations: OpenAccessCandidateLocation[] = [];
  const seenUrls = new Set<string>();

  const addLocation = (loc: OpenAccessCandidateLocation) => {
    const key = (loc.pdfUrl || loc.landingPageUrl || "").toLowerCase();
    if (!key || seenUrls.has(key)) return;
    seenUrls.add(key);
    allLocations.push(loc);
  };

  for (const loc of unpaywallRes.locations) addLocation(loc);
  for (const loc of openAlexRes.locations) addLocation(loc);

  // 3. Fallback: PMC check if PMCID detected
  const pmcid = unpaywallRes.pmcid || openAlexRes.pmcid || null;
  if (pmcid) {
    const pmcPdfUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/pdf/`;
    if (!seenUrls.has(pmcPdfUrl.toLowerCase())) {
      allLocations.push({
        pdfUrl: pmcPdfUrl,
        landingPageUrl: `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/`,
        isDirectPdf: true,
        version: "publishedVersion",
        license: "cc-by",
        hostType: "repository",
        sourceName: "PubMed Central (PMC)",
        isLawfullyAcquirable: true,
        isPreprint: false,
        provenance: `PubMed Central Open Access (PMCID: ${pmcid})`,
      });
    }
  }

  const bestLocation = selectBestOpenAccessLocation(allLocations);

  let status: OpenAccessDiscoveryStatus = "NO_OPEN_ACCESS_LOCATED";
  let explanation = "No verified open-access manuscript was located.";
  let provider: "UNPAYWALL" | "OPENALEX" | "PMC" | "NONE" = "NONE";

  if (bestLocation) {
    provider = bestLocation.sourceName.startsWith("Unpaywall")
      ? "UNPAYWALL"
      : bestLocation.sourceName.startsWith("OpenAlex")
      ? "OPENALEX"
      : bestLocation.sourceName.includes("PubMed Central")
      ? "PMC"
      : "UNPAYWALL";

    if (bestLocation.isLawfullyAcquirable && bestLocation.pdfUrl) {
      status = "OPEN_ACCESS_PDF_FOUND";
      const verText =
        bestLocation.version === "publishedVersion"
          ? "Publisher Version of Record"
          : bestLocation.version === "acceptedVersion"
          ? "Author Accepted Manuscript (Postprint)"
          : "Author Submitted Preprint";
      explanation = `Legally accessible open-access PDF located (${verText}, License: ${bestLocation.license || "CC-Open"}). Ready for automatic ingestion.`;
    } else if (bestLocation.isDirectPdf && !bestLocation.isLawfullyAcquirable) {
      status = "OPEN_ACCESS_EXTERNAL_LINK_ONLY";
      explanation = `Direct PDF link available at external host, but redistribution or automated copying rights are restricted or unclear (License: ${bestLocation.license || "unspecified"}). External reading link preserved.`;
    } else if (bestLocation.landingPageUrl) {
      status = "OPEN_ACCESS_EXTERNAL_LINK_ONLY";
      explanation = `Open-access landing page located. Automated PDF acquisition requires direct file access; link preserved for external reading.`;
    }
  }

  const result: OpenAccessDiscoveryResult = {
    doi,
    isFound: Boolean(bestLocation),
    status,
    bestLocation,
    allLocations,
    title: unpaywallRes.title || openAlexRes.title || null,
    journal: unpaywallRes.journal || openAlexRes.journal || null,
    publicationDate: unpaywallRes.publicationDate || openAlexRes.publicationDate || null,
    abstract: openAlexRes.abstract || unpaywallRes.abstract || null,
    authors: openAlexRes.authors && openAlexRes.authors.length > 0 ? openAlexRes.authors : undefined,
    pmcid,
    explanation,
    provider,
  };

  // Cache result
  discoveryCache.set(doi, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return result;
}

/**
 * Clears or invalidates a cached DOI discovery result.
 */
export function invalidateDiscoveryCache(doi: string): void {
  const norm = normalizeDoi(doi);
  if (norm) {
    discoveryCache.delete(norm);
  }
}
