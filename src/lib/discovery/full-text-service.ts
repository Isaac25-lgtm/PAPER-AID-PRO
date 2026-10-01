/**
 * Lawful Full-Text Acquisition Service & SSRF Protection
 *
 * Implements strict, lawful acquisition of open-access manuscripts from
 * trusted repositories (primarily PubMed Central / NCBI PMC).
 *
 * Strict Security Boundaries:
 * - Anti-SSRF: Only HTTPS to explicitly allowlisted trusted repository domains
 * - Private, local, and link-local IP resolution strictly rejected
 * - Content-Type validation and %PDF- magic bytes check
 * - 30 MB size ceiling
 * - Paywalls, shadow libraries, and publisher scraping are strictly forbidden
 * - Non-OA manuscripts transition to USER_UPLOAD_REQUIRED
 */

import { NormalizedExternalPaper, FullTextAvailabilityStatus } from "./types";
import { uploadPaperPdf } from "@/lib/storage";
import { processPaperDocument } from "@/lib/pdf/pipeline";
import { embedPaperChunks } from "@/lib/ai/embedding-pipeline";
import { prisma } from "@/lib/prisma";

const MAX_PDF_SIZE = 30 * 1024 * 1024; // 30 MB

// Strictly allowlisted trusted scholarly PDF hosts for automated server-side acquisition
const TRUSTED_PDF_DOMAINS = [
  "ncbi.nlm.nih.gov",
  "pmc.ncbi.nlm.nih.gov",
  "europepmc.org",
  "arxiv.org",
  "export.arxiv.org",
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
 * Validates whether an external PDF URL is safe to fetch server-side.
 * Mitigates SSRF attacks by enforcing HTTPS, domain allowlist, and IP checks.
 */
export function validateSafePdfUrl(urlString: string): { safe: boolean; error?: string; parsedUrl?: URL } {
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

    const isTrusted = TRUSTED_PDF_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );

    if (!isTrusted) {
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
 * Evaluates the full-text availability status for an external paper.
 */
export function resolveFullTextAvailability(
  paper: NormalizedExternalPaper
): { status: FullTextAvailabilityStatus; url: string | null; source: string | null } {
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

  // 3. Open Access ArXiv
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
  };
}

/**
 * Downloads, validates, and ingests an authentic open-access PDF into the local library.
 * Chains into the existing Phase 4 pipeline (processPaperDocument) and Phase 6 embeddings (embedPaperChunks).
 */
export async function acquireAndIngestLawfulFullText(
  paperId: string,
  targetPdfUrl: string
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

  // If already processed with full text, avoid duplicate ingestion
  if (paper.status === "COMPLETED" && paper.storagePath) {
    return {
      success: true,
      status: "FULL_TEXT_AVAILABLE",
      storagePath: paper.storagePath,
    };
  }

  // 1. Validate Safe URL
  const { safe, error: urlError } = validateSafePdfUrl(targetPdfUrl);
  if (!safe) {
    return {
      success: false,
      status: "USER_UPLOAD_REQUIRED",
      error: urlError,
    };
  }

  // 2. Fetch PDF with bounded timeout and size limit
  let pdfBuffer: Buffer;
  try {
    const res = await fetch(targetPdfUrl, {
      signal: AbortSignal.timeout(20000),
      headers: {
        "User-Agent": "AIResearchHub/1.0 (academic-intelligence-platform; mailto:scholar@airesearchhub.org)",
        Accept: "application/pdf,*/*",
      },
    });

    if (!res.ok) {
      return {
        success: false,
        status: "FAILED",
        error: `Remote repository returned HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const contentType = res.headers.get("content-type") || "";
    // Note: Some repositories return binary/octet-stream or application/x-pdf
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

    const arrayBuf = await res.arrayBuffer();
    pdfBuffer = Buffer.from(arrayBuf);

    if (pdfBuffer.length > MAX_PDF_SIZE) {
      return {
        success: false,
        status: "FAILED",
        error: `Downloaded file size exceeds 30 MB ceiling (${(pdfBuffer.length / (1024 * 1024)).toFixed(1)} MB).`,
      };
    }

    // Magic bytes check
    const magic = pdfBuffer.slice(0, 5).toString("utf-8");
    if (!magic.startsWith("%PDF-")) {
      return {
        success: false,
        status: "FAILED",
        error: "Downloaded file is not a valid PDF document (missing %PDF- header).",
      };
    }
  } catch (downloadErr: any) {
    return {
      success: false,
      status: "FAILED",
      error: `Network failure downloading PDF: ${downloadErr?.message || "Connection failed"}`,
    };
  }

  // 3. Upload to Supabase Storage using existing storage helper
  let storagePath: string;
  try {
    const uploadRes = await uploadPaperPdf(paperId, pdfBuffer);
    storagePath = uploadRes.storagePath;

    // Update paper with storage path
    await prisma.paper.update({
      where: { id: paperId },
      data: {
        storagePath,
        pdfUrl: uploadRes.publicUrl,
        status: "UPLOADED",
      },
    });
  } catch (storageErr: any) {
    return {
      success: false,
      status: "FAILED",
      error: `Failed storing PDF in Supabase Storage: ${storageErr?.message}`,
    };
  }

  // 4. Invoke existing Phase 4 ingestion pipeline
  const pipelineRes = await processPaperDocument(paperId);
  if (!pipelineRes.success) {
    return {
      success: false,
      status: "FAILED",
      storagePath,
      error: `Ingestion pipeline failed: ${pipelineRes.error}`,
    };
  }

  // 5. Invoke existing Phase 6 embeddings
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
