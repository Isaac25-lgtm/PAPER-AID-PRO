/**
 * Lawful Full-Text Acquisition Service & SSRF Protection
 *
 * Implements strict, lawful acquisition of open-access manuscripts from
 * trusted repositories (NCBI PMC, ArXiv, Europe PMC, CitedEvidence CEDOA).
 *
 * Strict Security Boundaries & Hardening:
 * - Anti-SSRF: Only secure HTTPS to allowlisted repositories and verified storage CDNs
 * - Manual redirect handling (max 3 hops) with destination re-validation on every hop
 * - DNS resolution & rebinding protection: resolves and rejects private, loopback,
 *   link-local, and cloud metadata IPs (169.254.169.254, AWS/GCP/Azure)
 * - Secret hygiene: API authorization headers are strictly isolated to CitedEvidence
 *   and NEVER forwarded to redirected CDNs or external hosts
 * - Content-Type validation and %PDF- magic bytes check
 * - 30 MB size ceiling with pre-download Content-Length fast rejection
 * - 20-second per-hop request timeout
 * - Non-OA manuscripts transition to USER_UPLOAD_REQUIRED
 */

import * as dns from "dns";
import { NormalizedExternalPaper, FullTextAvailabilityStatus } from "./types";
import { evaluateReusePermission } from "./open-access-service";
import { uploadPaperPdf } from "@/lib/storage";
import { processPaperDocument } from "@/lib/pdf/pipeline";
import { embedPaperChunks } from "@/lib/ai/embedding-pipeline";
import { prisma } from "@/lib/prisma";

const MAX_PDF_SIZE = 30 * 1024 * 1024; // 30 MB
const MAX_REDIRECTS = 3;

// Strictly allowlisted trusted scholarly repositories and publishers for primary acquisition
export const TRUSTED_PDF_DOMAINS = [
  // Primary repositories & preprints
  "ncbi.nlm.nih.gov",
  "pmc.ncbi.nlm.nih.gov",
  "europepmc.org",
  "arxiv.org",
  "export.arxiv.org",
  "scholar.citedevidence.com",
  "citedevidence.com",
  "biorxiv.org",
  "medrxiv.org",
  "zenodo.org",
  "osf.io",
  "figshare.com",
  "hal.science",
  "citeseerx.ist.psu.edu",
  "core.ac.uk",
  "scielo.org",
  "nih.gov",
  // Major open-access publishers
  "nature.com",
  "springer.com",
  "biomedcentral.com",
  "frontiersin.org",
  "plos.org",
  "mdpi.com",
  "wiley.com",
  "sciencedirect.com",
  "elsevier.com",
  "oup.com",
  "royalsocietypublishing.org",
  "cell.com",
  "ieee.org",
  "acm.org",
  "pnas.org",
  "tandfonline.com",
  "sagepub.com",
];

// Permitted CDN/object storage domains ONLY when redirected from an allowlisted repository
export const TRUSTED_REDIRECT_CDN_DOMAINS = [
  "cloudfront.net",
  "s3.amazonaws.com",
  "storage.googleapis.com",
  "blob.core.windows.net",
  "osf.io",
  "fastly.net",
];

// Disallowed private/loopback/internal host patterns
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

export interface AcquisitionResult {
  success: boolean;
  status: FullTextAvailabilityStatus;
  storagePath?: string;
  chunkCount?: number;
  error?: string;
}

/**
 * Checks whether an IP address belongs to private, loopback, link-local,
 * or cloud metadata service ranges.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const cleanIp = ip.trim().toLowerCase();

  // IPv4 Checks
  if (cleanIp.includes(".")) {
    // Handle IPv4-mapped IPv6 (::ffff:127.0.0.1)
    const v4 = cleanIp.startsWith("::ffff:") ? cleanIp.replace("::ffff:", "") : cleanIp;
    const parts = v4.split(".").map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return true;

    const [a, b] = parts;
    if (a === 127) return true; // Loopback
    if (a === 10) return true; // RFC 1918 Private
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918 Private
    if (a === 192 && b === 168) return true; // RFC 1918 Private
    if (a === 169 && b === 254) return true; // Link-local / Cloud Metadata (169.254.169.254)
    if (a === 0) return true; // Current network
    if (a === 100 && b >= 64 && b <= 127) return true; // Carrier Grade NAT
    if (a >= 224) return true; // Multicast / Reserved
  }

  // IPv6 Checks
  if (cleanIp.includes(":")) {
    if (cleanIp === "::1" || cleanIp === "::") return true; // Loopback / Unspecified
    if (cleanIp.startsWith("fc") || cleanIp.startsWith("fd")) return true; // Unique local (fc00::/7)
    if (cleanIp.startsWith("fe80")) return true; // Link-local (fe80::/10)
  }

  return false;
}

/**
 * Synchronous URL format check (for initial filtering).
 */
export function validateSafePdfUrl(
  urlString: string,
  isRedirectHop: boolean = false
): { safe: boolean; error?: string; parsedUrl?: URL } {
  try {
    const parsed = new URL(urlString);

    if (parsed.protocol !== "https:") {
      return { safe: false, error: "Only secure HTTPS URLs are permitted for PDF acquisition." };
    }

    const hostname = parsed.hostname.toLowerCase();

    for (const pattern of BLOCKED_HOST_PATTERNS) {
      if (pattern.test(hostname)) {
        return { safe: false, error: "Access to private, loopback, or local network addresses is forbidden." };
      }
    }

    const isAcademicInstitution =
      hostname.endsWith(".edu") ||
      hostname.endsWith(".ac.uk") ||
      hostname.endsWith(".edu.au");

    const isTrustedRepo =
      isAcademicInstitution ||
      TRUSTED_PDF_DOMAINS.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
      );

    const isTrustedCdn =
      isRedirectHop &&
      TRUSTED_REDIRECT_CDN_DOMAINS.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
      );

    if (!isTrustedRepo && !isTrustedCdn) {
      return {
        safe: false,
        error: `Host "${hostname}" is not in the trusted scholarly repository allowlist. User upload is required for publisher websites.`,
      };
    }

    return { safe: true, parsedUrl: parsed };
  } catch (err: any) {
    return { safe: false, error: `Invalid URL format: ${err?.message || "Malformed URI"}` };
  }
}

/**
 * Asynchronous validation with DNS resolution and DNS rebinding protection.
 */
export async function validateSafePdfUrlAsync(
  urlString: string,
  isRedirectHop: boolean = false
): Promise<{ safe: boolean; error?: string; parsedUrl?: URL }> {
  const syncCheck = validateSafePdfUrl(urlString, isRedirectHop);
  if (!syncCheck.safe || !syncCheck.parsedUrl) {
    return syncCheck;
  }

  const hostname = syncCheck.parsedUrl.hostname;

  // Resolve DNS to verify destination IP addresses
  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    for (const addr of addresses) {
      if (isPrivateOrReservedIp(addr.address)) {
        return {
          safe: false,
          error: `DNS resolution for "${hostname}" resolved to forbidden private IP address (${addr.address}).`,
        };
      }
    }
  } catch (dnsErr: any) {
    return {
      safe: false,
      error: `DNS resolution failed for host "${hostname}": ${dnsErr?.message || "Lookup error"}`,
    };
  }

  return syncCheck;
}

/**
 * Evaluates the full-text availability status for an external paper.
 */
export function resolveFullTextAvailability(
  paper: NormalizedExternalPaper
): { status: FullTextAvailabilityStatus; url: string | null; source: string | null; reason?: string } {
  // If explicitly closed access, require manual user upload
  if (paper.isOpenAccess === false && !paper.pmcid && !paper.arxivId && !paper.openAccessPdfUrl) {
    return {
      status: "USER_UPLOAD_REQUIRED",
      url: null,
      source: null,
      reason: "Manuscript is not open access. Manual user upload is required.",
    };
  }

  // License inspection: do not assume blanket permission.
  // If license is specified and non-permissive (e.g. CC BY-NC, CC BY-NC-ND, Bronze, Closed, Unspecified),
  // automated downloading is prohibited and manual user upload is required.
  if (paper.license) {
    const { isPermissive, canonicalLicense } = evaluateReusePermission(paper.license);
    if (!isPermissive) {
      return {
        status: "USER_UPLOAD_REQUIRED",
        url: null,
        source: null,
        reason: `Work license "${canonicalLicense || paper.license}" restricts automated platform storage. Manual user upload required.`,
      };
    }
  }

  // 1. PubMed Central (PMC) — primary lawful route
  if (paper.pmcid) {
    return {
      status: "FULL_TEXT_AVAILABLE",
      url: `https://www.ncbi.nlm.nih.gov/pmc/articles/${paper.pmcid}/pdf/`,
      source: "PMC_OPEN_ACCESS",
    };
  }

  // 2. Open Access PDF URL from a trusted repository
  if (paper.openAccessPdfUrl) {
    const { safe } = validateSafePdfUrl(paper.openAccessPdfUrl);
    if (safe) {
      return {
        status: "FULL_TEXT_AVAILABLE",
        url: paper.openAccessPdfUrl,
        source: paper.fullTextSource || "TRUSTED_OA_REPOSITORY",
      };
    }
  }

  // 3. Open Access ArXiv (preprints with permissive / unreserved distribution)
  if (paper.arxivId) {
    return {
      status: "FULL_TEXT_AVAILABLE",
      url: `https://arxiv.org/pdf/${paper.arxivId}.pdf`,
      source: "ARXIV_OPEN_ACCESS",
    };
  }

  // 4. Default: Manuscript full text requires user upload
  return {
    status: "USER_UPLOAD_REQUIRED",
    url: null,
    source: null,
    reason: "No direct open-access PDF located. Manual user upload required.",
  };
}

export interface LawfulIngestionOptions {
  license?: string | null;
  version?: string | null;
  sourceName?: string | null;
  provenance?: string | null;
  userId?: string | null;
}

/**
 * Downloads, validates, and ingests an authentic open-access PDF into the local library.
 * Implements manual redirect handling, per-hop DNS validation, and secret header hygiene.
 */
export async function acquireAndIngestLawfulFullText(
  paperId: string,
  targetPdfUrl: string,
  options: LawfulIngestionOptions = {}
): Promise<AcquisitionResult> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
  });

  if (!paper) {
    return {
      success: false,
      status: "FAILED",
      error: `Paper with ID "${paperId}" not found in database.`,
    };
  }

  const prov = (paper.sourceProvenance as any) || {};
  const isPrivateDoc = Boolean(prov.uploadedByUserId || prov.ownerId);

  // If paper is a private user document, NEVER overwrite its manuscript!
  if (isPrivateDoc && paper.storagePath) {
    return {
      success: false,
      status: "FAILED",
      error: "Cannot overwrite private user-owned research document with external full text.",
    };
  }

  // If already processed with full text, avoid duplicate ingestion
  if (paper.status === "COMPLETED" && paper.storagePath) {
    return {
      success: true,
      status: "FULL_TEXT_AVAILABLE",
      storagePath: paper.storagePath,
    };
  }

  // License verification: Ensure individual work's license permits automated platform downloading & processing
  const licenseToCheck = options.license || prov.license || prov.canonicalLicense;
  if (licenseToCheck) {
    const { isPermissive, canonicalLicense } = evaluateReusePermission(licenseToCheck);
    if (!isPermissive) {
      return {
        success: false,
        status: "USER_UPLOAD_REQUIRED",
        error: `Automated downloading and platform storage is restricted by license "${canonicalLicense || licenseToCheck}". Manual PDF upload is required.`,
      };
    }
  }

  // 1. Fetch PDF with manual redirect handling and per-hop DNS validation
  let currentUrl = targetPdfUrl;
  let pdfBuffer: Buffer;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Validate current URL (allow CDNs only on redirect hops)
      const urlCheck = await validateSafePdfUrlAsync(currentUrl, hop > 0);
      if (!urlCheck.safe || !urlCheck.parsedUrl) {
        return {
          success: false,
          status: "USER_UPLOAD_REQUIRED",
          error: urlCheck.error || "URL failed security validation",
        };
      }

      const reqHeaders: Record<string, string> = {
        "User-Agent": "AIResearchHub/1.0 (academic-intelligence-platform; mailto:scholar@airesearchhub.org)",
        Accept: "application/pdf,*/*",
      };

      // Secret Header Hygiene: ONLY send API key to CitedEvidence endpoints
      const host = urlCheck.parsedUrl.hostname.toLowerCase();
      if (host === "scholar.citedevidence.com" || host.endsWith(".citedevidence.com")) {
        const ceKey = process.env.CITEDEVIDENCE_API_KEY || process.env.CE_API_KEY;
        if (ceKey) {
          reqHeaders["Authorization"] = `Bearer ${ceKey.trim()}`;
        }
      }

      const res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual", // Enforce manual redirect handling to intercept 3xx hops
        signal: AbortSignal.timeout(20000),
        headers: reqHeaders,
      });

      // Handle Redirects
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        if (hop === MAX_REDIRECTS) {
          return {
            success: false,
            status: "FAILED",
            error: `Exceeded maximum redirect limit of ${MAX_REDIRECTS} hops.`,
          };
        }

        const location = res.headers.get("location");
        if (!location) {
          return {
            success: false,
            status: "FAILED",
            error: `Redirect response (HTTP ${res.status}) missing Location header.`,
          };
        }

        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!res.ok) {
        return {
          success: false,
          status: "FAILED",
          error: `Remote repository returned HTTP ${res.status}: ${res.statusText}`,
        };
      }

      // Fast check for oversized Content-Length before downloading
      const contentLengthStr = res.headers.get("content-length");
      if (contentLengthStr) {
        const contentLength = parseInt(contentLengthStr, 10);
        if (contentLength > MAX_PDF_SIZE) {
          return {
            success: false,
            status: "FAILED",
            error: `File size exceeds 30 MB ceiling (${(contentLength / (1024 * 1024)).toFixed(1)} MB).`,
          };
        }
      }

      const contentType = res.headers.get("content-type") || "";
      if (
        !contentType.includes("pdf") &&
        !contentType.includes("octet-stream")
      ) {
        return {
          success: false,
          status: "FAILED",
          error: `Expected application/pdf but received content-type "${contentType}". This may be an HTML landing page.`,
        };
      }

      // Streaming download with real-time byte counter and early magic byte validation
      if (!res.body) {
        return {
          success: false,
          status: "FAILED",
          error: "Remote repository returned an empty response body.",
        };
      }

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;
      let magicChecked = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value && value.length > 0) {
          receivedBytes += value.length;

          // Streaming size ceiling enforcement (aborts TCP stream immediately)
          if (receivedBytes > MAX_PDF_SIZE) {
            await reader.cancel("Download size exceeded maximum limit of 30 MB");
            return {
              success: false,
              status: "FAILED",
              error: `Downloaded file stream exceeded 30 MB ceiling (${(receivedBytes / (1024 * 1024)).toFixed(1)} MB).`,
            };
          }

          chunks.push(value);

          // Early magic bytes inspection on the very first received chunk
          if (!magicChecked && receivedBytes >= 5) {
            const firstChunk = Buffer.from(chunks[0]);
            const magic = firstChunk.slice(0, 5).toString("utf-8");
            if (!magic.startsWith("%PDF-")) {
              await reader.cancel("Invalid PDF signature");
              return {
                success: false,
                status: "FAILED",
                error: `Downloaded file is not a valid PDF document (missing %PDF- header, received "${magic}").`,
              };
            }
            magicChecked = true;
          }
        }
      }

      pdfBuffer = Buffer.concat(chunks);

      if (pdfBuffer.length === 0) {
        return {
          success: false,
          status: "FAILED",
          error: "Downloaded file is empty (0 bytes).",
        };
      }

      // Final magic verification if total buffer was under 5 bytes initially
      if (!magicChecked) {
        const magic = pdfBuffer.slice(0, 5).toString("utf-8");
        if (!magic.startsWith("%PDF-")) {
          return {
            success: false,
            status: "FAILED",
            error: "Downloaded file is not a valid PDF document (missing %PDF- header).",
          };
        }
      }

      // PDF downloaded and validated successfully
      break;
    }
  } catch (downloadErr: any) {
    return {
      success: false,
      status: "FAILED",
      error: `Network failure downloading PDF: ${downloadErr?.message || "Connection failed"}`,
    };
  }

  // 2. Upload to Supabase Storage using existing storage helper
  let storagePath: string;
  try {
    const uploadRes = await uploadPaperPdf(paperId, pdfBuffer!);
    storagePath = uploadRes.storagePath;

    const updatedProv = {
      ...prov,
      acquisitionSource: options.sourceName || "LAWFULLY_ACQUIRED_OPEN_ACCESS",
      sourceName: options.sourceName || "LAWFULLY_ACQUIRED_OPEN_ACCESS",
      acquiredAt: new Date().toISOString(),
      license: options.license || null,
      version: options.version || null,
      isLawfulOpenAccess: true,
      isPublicOpenAccess: true,
      originalPdfUrl: targetPdfUrl,
    };

    // Update paper with storage path, open-access flag, and structured provenance
    await prisma.paper.update({
      where: { id: paperId },
      data: {
        storagePath,
        pdfUrl: uploadRes.publicUrl,
        status: "UPLOADED",
        isOpenAccess: true,
        sourceProvenance: updatedProv,
      },
    });
  } catch (storageErr: any) {
    return {
      success: false,
      status: "FAILED",
      error: `Failed storing PDF in Supabase Storage: ${storageErr?.message}`,
    };
  }

  // 3. Invoke existing Phase 4 ingestion pipeline
  const pipelineRes = await processPaperDocument(paperId);
  if (!pipelineRes.success) {
    return {
      success: false,
      status: "FAILED",
      storagePath,
      error: `Ingestion pipeline failed: ${pipelineRes.error}`,
    };
  }

  // Verify that usable extracted content exists before marking ready
  if (!pipelineRes.chunkCount || pipelineRes.chunkCount === 0) {
    await prisma.paper.update({
      where: { id: paperId },
      data: { status: "FAILED" },
    });
    return {
      success: false,
      status: "FAILED",
      storagePath,
      error: "PDF text extraction produced 0 usable chunks. Document may be scanned or empty.",
    };
  }

  // 4. Invoke existing Phase 6 embeddings
  try {
    await embedPaperChunks(paperId);
  } catch (embedErr: any) {
    console.warn(`Embedding generation post-ingestion warning for ${paperId}:`, embedErr.message);
  }

  return {
    success: true,
    status: "FULL_TEXT_AVAILABLE",
    storagePath,
    chunkCount: pipelineRes.chunkCount,
  };
}
