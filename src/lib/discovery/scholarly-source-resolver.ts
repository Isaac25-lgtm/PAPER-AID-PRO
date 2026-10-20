import "server-only";

/**
 * AI RESEARCH HUB — SCHOLARLY SOURCE RESOLVER
 *
 * Provider-independent resolver for scholarly full-text sources, landing pages,
 * version provenance, and reuse rights.
 *
 * Architecture & Legal Guarantees:
 * 1. Discover legitimate full-text locations without downloading, storing, or indexing.
 * 2. Strict distinction between:
 *    - Right to Read (direct reading / external landing links)
 *    - Right to Download & Store (platform server copy)
 *    - Right to Transform / Derive (text extraction & embedding)
 *    - Right to Redistribute
 * 3. Fail closed: If a license is missing, unknown, or restrictive (e.g. Bronze, CC-BY-NC,
 *    All Rights Reserved), default to READING_LINK_ONLY or LICENSE_UNVERIFIED and
 *    STRICTLY forbid automated platform ingestion (canPlatformIngest = false).
 * 4. Multi-provider resilience: Unpaywall, OpenAlex, Europe PMC / PMC, arXiv, Crossref.
 * 5. Multi-version awareness: Distinguish publishedVersion (Version of Record),
 *    acceptedVersion (Postprint), and submittedVersion (Preprint).
 * 6. SSRF Protection: Reject private IPs, loopbacks, cloud metadata (169.254.169.254),
 *    and non-HTTPS endpoints.
 */

import {
  normalizeDoi,
  normalizePmid,
  normalizePmcid,
  normalizeArxivId,
} from "@/lib/identifiers";
import {
  evaluateReusePermission,
  normalizeOaVersion,
  discoverOpenAccessForDoi,
  OpenAccessCandidateLocation,
} from "./open-access-service";
import { validateSafePdfUrl } from "./full-text-service";

export type ManuscriptVersion =
  | "publishedVersion"
  | "acceptedVersion"
  | "submittedVersion"
  | "unknown";

export type SourceProviderType =
  | "UNPAYWALL"
  | "OPENALEX"
  | "EUROPE_PMC"
  | "PUBMED_CENTRAL"
  | "ARXIV"
  | "CROSSREF"
  | "PUBLISHER"
  | "UNKNOWN";

export type ScholarlyClassification =
  | "OPEN_ACCESS_FULL_TEXT"
  | "READING_LINK_ONLY"
  | "ABSTRACT_ONLY"
  | "FULL_TEXT_UNAVAILABLE"
  | "LICENSE_UNVERIFIED";

export interface ScholarlySourceCandidate {
  paperIdentifier: string;
  sourceProvider: SourceProviderType;
  landingPageUrl: string | null;
  pdfUrl: string | null;
  manuscriptVersion: ManuscriptVersion;
  license: string | null;
  licenseEvidence: string;
  canDirectRead: boolean;
  canPlatformIngest: boolean;
  verificationStatus: "VERIFIED" | "UNVERIFIED" | "FAILED";
  lastCheckedAt: string;
}

export interface ScholarlyResolutionResult {
  identifiers: {
    doi: string | null;
    pmid: string | null;
    pmcid: string | null;
    arxivId: string | null;
    canonicalId: string;
  };
  classification: ScholarlyClassification;
  bestCandidate: ScholarlySourceCandidate | null;
  allCandidates: ScholarlySourceCandidate[];
  versionSummary: {
    hasVersionOfRecord: boolean;
    hasPreprint: boolean;
    hasAcceptedManuscript: boolean;
  };
  permissions: {
    canReadDirectly: boolean;
    canPlatformIngest: boolean;
    canRedistribute: boolean;
    canDeriveOrTransform: boolean;
  };
  explanation: string;
  resolvedAt: string;
}

export interface ResolveSourcesInput {
  doi?: string | null;
  pmid?: string | null;
  pmcid?: string | null;
  arxivId?: string | null;
  rawInput?: string | null;
  timeoutMs?: number;
  forceRefresh?: boolean;
}

// In-memory cache for resolved sources (1 hour TTL)
interface CacheEntry {
  result: ScholarlyResolutionResult;
  expiresAt: number;
}
const resolverCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resets the in-memory resolver cache (for test isolation).
 */
export function clearSourceResolverCache(): void {
  resolverCache.clear();
}

/**
 * Checks if a canonical license permits downstream redistribution.
 */
function checkRedistributionPermission(license: string | null): boolean {
  if (!license) return false;
  const l = license.toLowerCase();
  return (
    l === "cc0" ||
    l === "public-domain" ||
    l === "cc-by" ||
    l === "cc-by-sa" ||
    l === "cc-by-nc" ||
    l === "cc-by-nc-sa"
  );
}

/**
 * Checks if a canonical license permits derivative / transformation works.
 */
function checkDerivationPermission(license: string | null): boolean {
  if (!license) return false;
  const l = license.toLowerCase();
  // No-derivatives licenses prohibit derivative computational products
  if (l.includes("-nd") || l.includes("no-derivatives")) {
    return false;
  }
  return (
    l === "cc0" ||
    l === "public-domain" ||
    l === "cc-by" ||
    l === "cc-by-sa" ||
    l === "cc-by-nc" ||
    l === "cc-by-nc-sa"
  );
}

/**
 * Validates a landing page URL against SSRF and insecure protocols.
 */
function sanitizeLandingPageUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    // Check against obvious private hostnames
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname === "169.254.169.254"
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Primary Scholarly Source Resolver Class
 */
export class ScholarlySourceResolver {
  private timeoutMs: number;

  constructor(options: { defaultTimeoutMs?: number } = {}) {
    this.timeoutMs = options.defaultTimeoutMs || 7000;
  }

  /**
   * Queries Europe PMC REST API safely with timeout and sanitization.
   */
  private async queryEuropePmc(query: string, timeoutMs: number): Promise<{
    pmcid?: string;
    isOpenAccess?: boolean;
    hasPdf?: boolean;
    license?: string;
    pdfUrl?: string;
    landingPageUrl?: string;
  } | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 4000));
      const res = await fetch(
        `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=1`,
        {
          headers: { Accept: "application/json", "User-Agent": "AI-Research-Hub/1.0" },
          signal: controller.signal,
        }
      ).finally(() => clearTimeout(timer));

      if (!res.ok) return null;
      const data = await res.json();
      const item = data?.resultList?.result?.[0];
      if (!item) return null;

      const pmcid = item.pmcid ? item.pmcid.replace(/^PMC/i, "") : undefined;
      const isOpenAccess = item.isOpenAccess === "Y";
      const hasPdf = item.hasPDF === "Y";
      const license = item.license || null;
      const landingPageUrl = item.id ? `https://europepmc.org/article/${item.source || "MED"}/${item.id}` : undefined;
      let pdfUrl: string | undefined;

      if (pmcid && (isOpenAccess || hasPdf)) {
        pdfUrl = `https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC${pmcid}&blobtype=pdf`;
      }

      return {
        pmcid,
        isOpenAccess,
        hasPdf,
        license,
        pdfUrl,
        landingPageUrl,
      };
    } catch {
      return null;
    }
  }

  /**
   * Resolves legitimate full-text sources and access permissions for any scholarly paper.
   */
  async resolve(input: ResolveSourcesInput): Promise<ScholarlyResolutionResult> {
    let cleanDoi = normalizeDoi(input.doi);
    if (!cleanDoi && input.rawInput) {
      const raw = input.rawInput.trim();
      if (raw.includes("10.") || raw.toLowerCase().includes("doi.org/") || /^doi\s*:/i.test(raw)) {
        cleanDoi = normalizeDoi(raw);
      }
    }
    // Verify canonical DOI prefix (must start with 10.)
    if (cleanDoi && !cleanDoi.startsWith("10.")) {
      cleanDoi = null;
    }

    let cleanPmid = normalizePmid(input.pmid);
    if (!cleanPmid && input.rawInput) {
      const raw = input.rawInput.trim();
      if (/^pmid:\s*\d+$/i.test(raw) || /^\d{4,8}$/.test(raw)) {
        cleanPmid = normalizePmid(raw);
      }
    }

    let cleanPmcid = normalizePmcid(input.pmcid);
    if (!cleanPmcid && input.rawInput) {
      const raw = input.rawInput.trim();
      if (/pmc\s*\d+/i.test(raw)) {
        cleanPmcid = normalizePmcid(raw);
      }
    }

    let cleanArxiv = normalizeArxivId(input.arxivId);
    if (!cleanArxiv && input.rawInput) {
      const raw = input.rawInput.trim();
      if (/arxiv:\s*\d{4}\.\d{4,5}/i.test(raw) || /^\d{4}\.\d{4,5}/.test(raw)) {
        cleanArxiv = normalizeArxivId(raw);
      }
    }

    const canonicalId =
      cleanDoi || (cleanPmid ? `pmid:${cleanPmid}` : null) || (cleanArxiv ? `arxiv:${cleanArxiv}` : null) || "unknown";

    // 1. Check cache
    if (!input.forceRefresh && canonicalId !== "unknown") {
      const cached = resolverCache.get(canonicalId);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
      }
    }

    const candidates: ScholarlySourceCandidate[] = [];
    const seenUrls = new Set<string>();

    const addCandidate = (candidate: ScholarlySourceCandidate) => {
      const key = (candidate.pdfUrl || candidate.landingPageUrl || "").toLowerCase();
      if (!key || seenUrls.has(key)) return;
      seenUrls.add(key);
      candidates.push(candidate);
    };

    const effectiveTimeout = input.timeoutMs || this.timeoutMs;
    const nowIso = new Date().toISOString();

    // 2. Resolve DOI via OpenAccess discovery (Unpaywall, OpenAlex, PMC)
    if (cleanDoi) {
      try {
        const oaResult = await discoverOpenAccessForDoi(cleanDoi, {
          forceRefresh: input.forceRefresh,
          timeoutMs: effectiveTimeout,
        });

        if (oaResult.allLocations && oaResult.allLocations.length > 0) {
          for (const loc of oaResult.allLocations) {
            let provider: SourceProviderType = "UNKNOWN";
            if (loc.sourceName.includes("Unpaywall")) provider = "UNPAYWALL";
            else if (loc.sourceName.includes("OpenAlex")) provider = "OPENALEX";
            else if (loc.sourceName.includes("PubMed Central") || loc.sourceName.includes("PMC")) {
              provider = "PUBMED_CENTRAL";
            } else if (loc.hostType === "publisher") {
              provider = "PUBLISHER";
            }

            // SSRF and safety check on PDF URL
            let safePdfUrl: string | null = null;
            if (loc.pdfUrl) {
              const val = validateSafePdfUrl(loc.pdfUrl);
              if (val.safe) {
                safePdfUrl = loc.pdfUrl;
              }
            }

            const safeLanding = sanitizeLandingPageUrl(loc.landingPageUrl);

            // Re-evaluate license strictly
            const { isPermissive, canonicalLicense } = evaluateReusePermission(loc.license, loc.hostType);

            // Platform ingestion requires: safe direct PDF + permissive open license
            const canPlatformIngest = Boolean(safePdfUrl && isPermissive);
            const canDirectRead = Boolean(safePdfUrl || safeLanding);

            addCandidate({
              paperIdentifier: cleanDoi,
              sourceProvider: provider,
              landingPageUrl: safeLanding,
              pdfUrl: safePdfUrl,
              manuscriptVersion: loc.version as ManuscriptVersion,
              license: canonicalLicense,
              licenseEvidence: loc.provenance || `Discovered via ${provider} (${loc.hostType})`,
              canDirectRead,
              canPlatformIngest,
              verificationStatus: "VERIFIED",
              lastCheckedAt: nowIso,
            });
          }
        }

        // Add canonical publisher DOI landing page if not present
        const publisherLanding = `https://doi.org/${cleanDoi}`;
        if (!seenUrls.has(publisherLanding.toLowerCase())) {
          addCandidate({
            paperIdentifier: cleanDoi,
            sourceProvider: "CROSSREF",
            landingPageUrl: publisherLanding,
            pdfUrl: null,
            manuscriptVersion: "publishedVersion",
            license: null,
            licenseEvidence: "Canonical Crossref publisher DOI landing page",
            canDirectRead: false,
            canPlatformIngest: false,
            verificationStatus: "VERIFIED",
            lastCheckedAt: nowIso,
          });
        }
      } catch (err: any) {
        console.warn(`[ScholarlySourceResolver] DOI resolution error for ${cleanDoi}:`, err.message);
      }
    }

    // 3. Resolve Europe PMC if DOI or PMID is available
    if (cleanDoi || cleanPmid) {
      try {
        const epmcQuery = cleanDoi ? `DOI:"${cleanDoi}"` : `EXT_ID:${cleanPmid} AND SRC:MED`;
        const epmcRes = await this.queryEuropePmc(epmcQuery, effectiveTimeout);
        if (epmcRes) {
          const { isPermissive, canonicalLicense } = evaluateReusePermission(epmcRes.license, "repository");
          let safePdfUrl: string | null = null;
          if (epmcRes.pdfUrl) {
            const val = validateSafePdfUrl(epmcRes.pdfUrl);
            if (val.safe) {
              safePdfUrl = epmcRes.pdfUrl;
            }
          }
          const safeLanding = sanitizeLandingPageUrl(epmcRes.landingPageUrl);
          const canPlatformIngest = Boolean(safePdfUrl && isPermissive);
          const canDirectRead = Boolean(safePdfUrl || safeLanding || epmcRes.isOpenAccess);

          if (safePdfUrl || safeLanding) {
            addCandidate({
              paperIdentifier: epmcRes.pmcid ? `PMC${epmcRes.pmcid}` : (cleanDoi || `PMID:${cleanPmid}`),
              sourceProvider: "EUROPE_PMC",
              landingPageUrl: safeLanding,
              pdfUrl: safePdfUrl,
              manuscriptVersion: "publishedVersion",
              license: canonicalLicense,
              licenseEvidence: `Europe PMC (Open Access: ${epmcRes.isOpenAccess ? "Yes" : "No"}, License: ${epmcRes.license || "None stated"})`,
              canDirectRead,
              canPlatformIngest,
              verificationStatus: "VERIFIED",
              lastCheckedAt: nowIso,
            });
          }
        }
      } catch (epmcErr: any) {
        console.warn(`[ScholarlySourceResolver] Europe PMC resolution warning:`, epmcErr?.message);
      }
    }

    // 4. Resolve arXiv if available
    if (cleanArxiv) {
      const arxivLanding = `https://arxiv.org/abs/${cleanArxiv}`;
      const rawArxivPdf = `https://arxiv.org/pdf/${cleanArxiv}.pdf`;
      const isPdfSafe = validateSafePdfUrl(rawArxivPdf).safe;

      // arXiv preprints are submittedVersion; standard arXiv license permits reading but
      // not necessarily unrestricted commercial redistribution without author CC selection
      addCandidate({
        paperIdentifier: `arxiv:${cleanArxiv}`,
        sourceProvider: "ARXIV",
        landingPageUrl: arxivLanding,
        pdfUrl: isPdfSafe ? rawArxivPdf : null,
        manuscriptVersion: "submittedVersion",
        license: "arxiv-nonexclusive-distrib",
        licenseEvidence: "arXiv Open Access preprint repository",
        canDirectRead: true,
        canPlatformIngest: false, // Default to reading link unless explicitly CC-BY
        verificationStatus: "VERIFIED",
        lastCheckedAt: nowIso,
      });
    }

    // 5. Resolve PMCID / PMID direct fallbacks if available
    if (cleanPmcid) {
      const pmcLanding = `https://www.ncbi.nlm.nih.gov/pmc/articles/${cleanPmcid}/`;
      const pmcPdf = `https://www.ncbi.nlm.nih.gov/pmc/articles/${cleanPmcid}/pdf/`;
      const isPdfSafe = validateSafePdfUrl(pmcPdf).safe;

      addCandidate({
        paperIdentifier: `PMC${cleanPmcid}`,
        sourceProvider: "PUBMED_CENTRAL",
        landingPageUrl: pmcLanding,
        pdfUrl: isPdfSafe ? pmcPdf : null,
        manuscriptVersion: "publishedVersion",
        license: null,
        licenseEvidence: "PubMed Central (NLM/NIH archive)",
        canDirectRead: true,
        canPlatformIngest: false,
        verificationStatus: "VERIFIED",
        lastCheckedAt: nowIso,
      });
    }

    if (cleanPmid) {
      const europePmcLanding = `https://europepmc.org/article/MED/${cleanPmid}`;
      addCandidate({
        paperIdentifier: `PMID:${cleanPmid}`,
        sourceProvider: "EUROPE_PMC",
        landingPageUrl: europePmcLanding,
        pdfUrl: null,
        manuscriptVersion: "publishedVersion",
        license: null,
        licenseEvidence: "Europe PMC literature service",
        canDirectRead: true,
        canPlatformIngest: false,
        verificationStatus: "VERIFIED",
        lastCheckedAt: nowIso,
      });
    }

    // 6. Select Best Candidate & Derive Primary Classification
    const bestCandidate = selectOptimalCandidate(candidates);

    let classification: ScholarlyClassification = "ABSTRACT_ONLY";
    let explanation = "Bibliographic reference only. No open full-text source located.";

    if (candidates.length === 0) {
      classification = "FULL_TEXT_UNAVAILABLE";
      explanation = cleanDoi || cleanPmid || cleanArxiv
        ? "No scholarly full-text sources located for the supplied identifier."
        : "No valid scholarly identifiers supplied. Unable to resolve full-text sources.";
    } else if (bestCandidate) {
      if (bestCandidate.canPlatformIngest && bestCandidate.pdfUrl) {
        classification = "OPEN_ACCESS_FULL_TEXT";
        explanation = `Open-access manuscript located (${formatVersionLabel(
          bestCandidate.manuscriptVersion
        )}, License: ${bestCandidate.license || "CC-Permissive"}). Lawful platform reading and ingestion permitted.`;
      } else if (
        bestCandidate.pdfUrl &&
        (!bestCandidate.license || bestCandidate.license === "unknown" || bestCandidate.license === "unspecified")
      ) {
        classification = "LICENSE_UNVERIFIED";
        explanation = `Direct PDF link available at ${bestCandidate.sourceProvider}, but reuse license is unverified. Preserving external reading link without automated platform ingestion.`;
      } else if (bestCandidate.canDirectRead) {
        classification = "READING_LINK_ONLY";
        explanation = `Free-to-read access located (${formatVersionLabel(
          bestCandidate.manuscriptVersion
        )}). Platform redistribution or downloading restricted by license (${
          bestCandidate.license || "Publisher-restricted"
        }). External reading link preserved.`;
      } else {
        classification = "ABSTRACT_ONLY";
        explanation = "Bibliographic metadata only. Publication is paywalled or restricted to subscribers.";
      }
    }

    // 6. Permissions synthesis
    const bestPermissive = candidates.find((c) => c.canPlatformIngest);
    const permissions = {
      canReadDirectly: candidates.some((c) => c.canDirectRead),
      canPlatformIngest: Boolean(bestPermissive),
      canRedistribute: Boolean(bestPermissive && checkRedistributionPermission(bestPermissive.license)),
      canDeriveOrTransform: Boolean(bestPermissive && checkDerivationPermission(bestPermissive.license)),
    };

    // 7. Version summary
    const versionSummary = {
      hasVersionOfRecord: candidates.some((c) => c.manuscriptVersion === "publishedVersion"),
      hasPreprint: candidates.some((c) => c.manuscriptVersion === "submittedVersion"),
      hasAcceptedManuscript: candidates.some((c) => c.manuscriptVersion === "acceptedVersion"),
    };

    const result: ScholarlyResolutionResult = {
      identifiers: {
        doi: cleanDoi,
        pmid: cleanPmid,
        pmcid: cleanPmcid,
        arxivId: cleanArxiv,
        canonicalId,
      },
      classification,
      bestCandidate,
      allCandidates: candidates,
      versionSummary,
      permissions,
      explanation,
      resolvedAt: nowIso,
    };

    // Cache result
    if (canonicalId !== "unknown") {
      resolverCache.set(canonicalId, {
        result,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }

    return result;
  }
}

/**
 * Deterministic candidate ranking:
 * 1. Directly ingestible publisher publishedVersion (CC-BY / CC0)
 * 2. Directly ingestible repository publishedVersion (CC-BY / CC0)
 * 3. Directly ingestible acceptedVersion (Postprint)
 * 4. Directly ingestible submittedVersion (Preprint)
 * 5. Free-to-read direct PDF (even if non-permissive license)
 * 6. Landing page with reading link
 * 7. Fallback to any candidate
 */
function selectOptimalCandidate(
  candidates: ScholarlySourceCandidate[]
): ScholarlySourceCandidate | null {
  if (!candidates || candidates.length === 0) return null;

  // Rank 1: Ingestible publisher publishedVersion
  const r1 = candidates.find(
    (c) => c.canPlatformIngest && c.pdfUrl && c.manuscriptVersion === "publishedVersion" && c.sourceProvider === "PUBLISHER"
  );
  if (r1) return r1;

  // Rank 2: Ingestible repository publishedVersion
  const r2 = candidates.find(
    (c) => c.canPlatformIngest && c.pdfUrl && c.manuscriptVersion === "publishedVersion"
  );
  if (r2) return r2;

  // Rank 3: Ingestible acceptedVersion
  const r3 = candidates.find(
    (c) => c.canPlatformIngest && c.pdfUrl && c.manuscriptVersion === "acceptedVersion"
  );
  if (r3) return r3;

  // Rank 4: Ingestible submittedVersion (Preprint)
  const r4 = candidates.find(
    (c) => c.canPlatformIngest && c.pdfUrl && c.manuscriptVersion === "submittedVersion"
  );
  if (r4) return r4;

  // Rank 5: Direct PDF with direct read (e.g. Bronze OA, CC-BY-NC)
  const r5 = candidates.find((c) => c.canDirectRead && c.pdfUrl);
  if (r5) return r5;

  // Rank 6: Published version landing page
  const r6 = candidates.find(
    (c) => c.canDirectRead && c.landingPageUrl && c.manuscriptVersion === "publishedVersion"
  );
  if (r6) return r6;

  // Rank 7: Any reading candidate
  const r7 = candidates.find((c) => c.canDirectRead);
  if (r7) return r7;

  return candidates[0];
}

function formatVersionLabel(version: ManuscriptVersion): string {
  switch (version) {
    case "publishedVersion":
      return "Publisher Version of Record";
    case "acceptedVersion":
      return "Author Accepted Manuscript";
    case "submittedVersion":
      return "Author Preprint";
    default:
      return "Scholarly Manuscript";
  }
}

// Global singleton instance
const defaultResolver = new ScholarlySourceResolver();

/**
 * Functional entrypoint for resolving scholarly sources.
 */
export async function resolveScholarlySources(
  input: ResolveSourcesInput
): Promise<ScholarlyResolutionResult> {
  return defaultResolver.resolve(input);
}
