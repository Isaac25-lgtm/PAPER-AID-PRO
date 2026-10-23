import "server-only";

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { downloadPaperPdf, uploadPaperPdf } from "@/lib/storage";
import { extractPdfText, ScannedPdfError } from "./extractor";
import { chunkManuscriptPages } from "./chunker";
import { embedPaperChunks } from "@/lib/ai/embedding-pipeline";
import { isMockEmbeddingMode } from "@/lib/ai/embeddings";
import {
  resolveScholarlySources,
  ScholarlySourceCandidate,
} from "@/lib/discovery/scholarly-source-resolver";
import {
  validateSafePdfUrlAsync,
} from "@/lib/discovery/full-text-service";
import {
  authorizePaperAccess,
  MinimalPaperRecord,
} from "@/lib/auth/paper-authorization";
import {
  PaperProcessingStatus,
  ProcessingStage,
  JobStatus,
} from "@prisma/client";

export const LEASE_TIMEOUT_MS = 60_000; // 60 seconds worker lease
const MAX_PDF_SIZE = 30 * 1024 * 1024; // 30 MB
const MAX_REDIRECTS = 3;
const DEFAULT_MAX_ATTEMPTS = 3;

export class WorkerFencingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerFencingError";
  }
}

export type OnDemandLogicalState =
  | "METADATA_ONLY"
  | "FULL_TEXT_RESOLVING"
  | "ACCESS_VERIFIED"
  | "DOWNLOADING"
  | "PARSING"
  | "CHUNKING"
  | "INDEXING"
  | "TEXT_EXTRACTED"
  | "READY"
  | "FAILED"
  | "RESTRICTED";

export interface OnDemandAnalysisResult {
  success: boolean;
  paperId: string;
  state: OnDemandLogicalState;
  status: PaperProcessingStatus;
  hasFullText?: boolean;
  hasExtractableText?: boolean;
  hasSemanticEmbeddings?: boolean;
  jobId?: string;
  chunkCount?: number;
  pageCount?: number;
  message: string;
  error?: string;
  errorCode?:
    | "NOT_FOUND"
    | "UNAUTHORIZED"
    | "RESTRICTED_LICENSE"
    | "NO_FULL_TEXT"
    | "DOWNLOAD_FAILED"
    | "OCR_REQUIRED"
    | "LEASE_EXPIRED"
    | "MAX_ATTEMPTS_EXCEEDED"
    | "INTERNAL_ERROR";
  externalLandingPageUrl?: string | null;
  externalPdfUrl?: string | null;
  license?: string | null;
  version?: string | null;
}

export interface PaperProcessingStatusInfo {
  paperId: string;
  paperStatus: PaperProcessingStatus;
  logicalState: OnDemandLogicalState;
  hasPdf: boolean;
  hasExtractableText: boolean;
  hasSemanticEmbeddings: boolean;
  indexingStatus: string;
  embeddingModel?: string | null;
  chunkCount: number;
  isProcessing: boolean;
  canChat: boolean;
  latestJob?: {
    id: string;
    stage: ProcessingStage;
    status: JobStatus;
    attempt: number;
    maxAttempts: number;
    errorMessage?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
  } | null;
  sourceResolution?: any;
}

/**
 * Downloads a remote PDF buffer with Anti-SSRF, DNS validation, manual redirect tracking (max 3),
 * Content-Type verification, 30MB ceiling, and %PDF- magic bytes check.
 */
export async function fetchRemotePdfSafely(targetUrl: string): Promise<Buffer> {
  let currentUrl = targetUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const urlCheck = await validateSafePdfUrlAsync(currentUrl, hop > 0);
    if (!urlCheck.safe || !urlCheck.parsedUrl) {
      throw new Error(urlCheck.error || "URL failed security validation.");
    }

    const reqHeaders: Record<string, string> = {
      "User-Agent":
        "AIResearchHub/1.0 (academic-intelligence-platform; mailto:scholar@airesearchhub.org)",
      Accept: "application/pdf,*/*",
    };

    const res = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: reqHeaders,
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      if (hop === MAX_REDIRECTS) {
        throw new Error(`Exceeded maximum redirect limit of ${MAX_REDIRECTS} hops.`);
      }
      const location = res.headers.get("location");
      if (!location) {
        throw new Error(`Redirect response (HTTP ${res.status}) missing Location header.`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!res.ok) {
      throw new Error(`Remote repository returned HTTP ${res.status}: ${res.statusText}`);
    }

    const contentLengthStr = res.headers.get("content-length");
    if (contentLengthStr) {
      const contentLength = parseInt(contentLengthStr, 10);
      if (contentLength > MAX_PDF_SIZE) {
        throw new Error(
          `File size exceeds 30 MB ceiling (${(contentLength / (1024 * 1024)).toFixed(1)} MB).`
        );
      }
    }

    const contentType = res.headers.get("content-type") || "";
    if (
      !contentType.includes("pdf") &&
      !contentType.includes("octet-stream")
    ) {
      throw new Error(
        `Expected application/pdf but received "${contentType}". This may be an HTML landing page.`
      );
    }

    if (!res.body) {
      throw new Error("Remote repository returned an empty response body.");
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
        if (receivedBytes > MAX_PDF_SIZE) {
          await reader.cancel("Download size exceeded maximum limit of 30 MB");
          throw new Error(
            `Downloaded file stream exceeded 30 MB ceiling (${(
              receivedBytes /
              (1024 * 1024)
            ).toFixed(1)} MB).`
          );
        }

        chunks.push(value);

        if (!magicChecked && receivedBytes >= 5) {
          const firstChunk = Buffer.from(chunks[0]);
          const magic = firstChunk.slice(0, 5).toString("utf-8");
          if (!magic.startsWith("%PDF-")) {
            await reader.cancel("Invalid PDF signature");
            throw new Error(
              `Downloaded file is not a valid PDF document (missing %PDF- header, received "${magic}").`
            );
          }
          magicChecked = true;
        }
      }
    }

    const pdfBuffer = Buffer.concat(chunks);
    if (pdfBuffer.length === 0) {
      throw new Error("Downloaded file is empty (0 bytes).");
    }

    if (!magicChecked) {
      const magic = pdfBuffer.slice(0, 5).toString("utf-8");
      if (!magic.startsWith("%PDF-")) {
        throw new Error(
          "Downloaded file is not a valid PDF document (missing %PDF- header)."
        );
      }
    }

    return pdfBuffer;
  }

  throw new Error("Failed downloading PDF: maximum redirect limit exceeded.");
}

/**
 * Claims or checks a database-enforced concurrency lease on a paper's processing job.
 * Generates an attempt-generation fencing leaseToken.
 * Prevents concurrent duplicate worker execution across tabs or users,
 * while allowing stale/interrupted workers (>60s) to be safely recovered.
 */
export async function claimOrCheckProcessingLease(
  paperId: string
): Promise<
  | { action: "ALREADY_ACTIVE"; job: any; leaseToken: string }
  | { action: "ACQUIRED"; job: any; leaseToken: string }
  | { action: "MAX_ATTEMPTS_EXCEEDED"; job: any }
> {
  const now = new Date();

  // Find latest job for this paper
  const latestJob = await prisma.processingJob.findFirst({
    where: { paperId },
    orderBy: { createdAt: "desc" },
  });

  if (latestJob && latestJob.status === "RUNNING") {
    const jobStartTime = latestJob.startedAt || latestJob.createdAt;
    const elapsedMs = now.getTime() - new Date(jobStartTime).getTime();

    if (elapsedMs < LEASE_TIMEOUT_MS) {
      // Active lease exists and is unexpired
      return {
        action: "ALREADY_ACTIVE",
        job: latestJob,
        leaseToken: latestJob.errorStack || "",
      };
    }

    // Worker lease has expired (>60s): mark previous attempt as interrupted
    await prisma.processingJob.update({
      where: { id: latestJob.id },
      data: {
        status: "FAILED",
        errorMessage: `Processing worker lease expired or was interrupted after ${Math.round(
          elapsedMs / 1000
        )}s.`,
        errorStack: null, // Revoke old worker lease token immediately
        completedAt: now,
      },
    });

    if (latestJob.attempt >= (latestJob.maxAttempts || DEFAULT_MAX_ATTEMPTS)) {
      await prisma.paper.update({
        where: { id: paperId },
        data: { status: "FAILED" },
      });
      return { action: "MAX_ATTEMPTS_EXCEEDED", job: latestJob };
    }

    // Create recovered retry job with unique attempt-generation fencing token
    const newAttempt = latestJob.attempt + 1;
    const newLeaseToken = `lease_${paperId}_att${newAttempt}_${now.getTime()}_${randomBytes(8).toString("hex")}`;
    const retryJob = await prisma.processingJob.create({
      data: {
        paperId,
        stage: "PDF_DOWNLOAD",
        status: "RUNNING",
        attempt: newAttempt,
        maxAttempts: latestJob.maxAttempts || DEFAULT_MAX_ATTEMPTS,
        startedAt: now,
        errorStack: newLeaseToken,
      },
    });

    await prisma.paper.update({
      where: { id: paperId },
      data: { status: "PROCESSING" },
    });

    return { action: "ACQUIRED", job: retryJob, leaseToken: newLeaseToken };
  }

  // Create new active processing job with initial fencing token
  const nextAttempt = latestJob ? latestJob.attempt + 1 : 1;
  const initialAttempt = nextAttempt > DEFAULT_MAX_ATTEMPTS ? 1 : nextAttempt;
  const initialLeaseToken = `lease_${paperId}_att${initialAttempt}_${now.getTime()}_${randomBytes(8).toString("hex")}`;

  const newJob = await prisma.processingJob.create({
    data: {
      paperId,
      stage: "PDF_DOWNLOAD",
      status: "RUNNING",
      attempt: initialAttempt,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      startedAt: now,
      errorStack: initialLeaseToken,
    },
  });

  await prisma.paper.update({
    where: { id: paperId },
    data: { status: "PROCESSING" },
  });

  return { action: "ACQUIRED", job: newJob, leaseToken: initialLeaseToken };
}

/**
 * Asserts that the worker still holds the valid active lease token,
 * heartbeats/renews the lease timestamp, and optionally advances stage.
 * Throws WorkerFencingError if lease has expired or was superseded.
 */
export async function assertAndRenewLease(params: {
  jobId: string;
  leaseToken: string;
  stage?: ProcessingStage;
}): Promise<void> {
  const { jobId, leaseToken, stage } = params;
  if (!leaseToken) {
    throw new WorkerFencingError("Missing lease token for worker fencing assertion.");
  }

  const updated = await prisma.processingJob.updateMany({
    where: {
      id: jobId,
      status: "RUNNING",
      errorStack: leaseToken,
    },
    data: {
      startedAt: new Date(),
      ...(stage ? { stage } : {}),
    },
  });

  if (updated.count === 0) {
    throw new WorkerFencingError(
      `Worker lease "${leaseToken}" for job ${jobId} was superseded or expired. Write operation rejected.`
    );
  }
}

/**
 * Commits chunks using atomic transactional fencing.
 * Rejects write and throws WorkerFencingError if the worker lease was superseded.
 */
export async function commitChunksWithFencing(params: {
  paperId: string;
  jobId: string;
  leaseToken: string;
  chunks: Array<{
    paperId: string;
    chunkIndex: number;
    text: string;
    section: string | null;
    pageNumber: number | null;
    tokenCount: number | null;
    metadata: any;
  }>;
}): Promise<boolean> {
  const { paperId, jobId, leaseToken, chunks } = params;

  return await prisma.$transaction(
    async (tx) => {
      const activeJob = await tx.processingJob.findFirst({
        where: {
          id: jobId,
          status: "RUNNING",
          errorStack: leaseToken,
        },
      });

      if (!activeJob) {
        throw new WorkerFencingError(
          `Worker lease "${leaseToken}" for job ${jobId} is no longer valid. Write rejected.`
        );
      }

      await tx.paperChunk.deleteMany({ where: { paperId } });
      await tx.paperChunk.createMany({
        data: chunks.map((c) => ({
          paperId: c.paperId,
          chunkIndex: c.chunkIndex,
          text: c.text,
          section: c.section,
          pageNumber: c.pageNumber,
          tokenCount: c.tokenCount,
          metadata: c.metadata,
        })),
      });

      await tx.paper.update({
        where: { id: paperId },
        data: { status: "TEXT_EXTRACTED" },
      });

      return true;
    },
    { maxWait: 10000, timeout: 20000 }
  );
}

/**
 * Main Orchestrator: Requests on-demand full-text analysis for an authorized paper.
 * Implements:
 * 1. User authorization & access validation
 * 2. Idempotency (returns READY if already completed)
 * 3. Concurrency lease locking (prevents duplicate processing)
 * 4. Stale job recovery
 * 5. Lawful scholarly source resolution (Phase 9B)
 * 6. Rights & license validation
 * 7. SSRF-safe download & content hash checks
 * 8. unpdf extraction & OCR detection
 * 9. Chunking & transaction persistence
 * 10. Cost-safe mock embedding execution boundary
 */
export async function requestOnDemandPaperAnalysis(params: {
  paperId: string;
  userId: string;
  forceReprocess?: boolean;
}): Promise<OnDemandAnalysisResult> {
  const { paperId, userId, forceReprocess = false } = params;

  // 1. Paper Lookup & Authorization Check
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      chunks: { select: { id: true } },
      processingJobs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!paper) {
    return {
      success: false,
      paperId,
      state: "FAILED",
      status: "FAILED",
      message: "Paper not found.",
      errorCode: "NOT_FOUND",
    };
  }

  // Fetch user role for authorization
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) {
    return {
      success: false,
      paperId,
      state: "FAILED",
      status: "FAILED",
      message: "Authentication required to analyze research papers.",
      errorCode: "UNAUTHORIZED",
    };
  }

  const auth = await authorizePaperAccess(
    paper as MinimalPaperRecord,
    user,
    "VIEW_METADATA"
  );

  if (!auth.allowed) {
    return {
      success: false,
      paperId,
      state: "FAILED",
      status: "FAILED",
      message: "You are not authorized to analyze this document.",
      errorCode: "UNAUTHORIZED",
    };
  }

  // 2. Completion Check: If already completed or text extracted with chunks and not forced, return immediately
  if (
    !forceReprocess &&
    (paper.status === "COMPLETED" || paper.status === "TEXT_EXTRACTED") &&
    paper.chunks.length > 0
  ) {
    const prov = (paper.sourceProvenance as any) || {};
    const hasSemanticEmbeddings = prov.hasSemanticEmbeddings === true;
    const isTextOnly = paper.status === "TEXT_EXTRACTED" || !hasSemanticEmbeddings;

    return {
      success: true,
      paperId,
      state: isTextOnly ? "TEXT_EXTRACTED" : "READY",
      status: paper.status,
      hasFullText: true,
      hasExtractableText: true,
      hasSemanticEmbeddings,
      chunkCount: paper.chunks.length,
      message: isTextOnly
        ? "Full text and evidence chunks are extracted (semantic vector indexing pending authorization)."
        : "Paper is already fully processed and indexed for AI analysis.",
    };
  }

  // 3. Claim or Check Concurrency Lease
  const leaseResult = await claimOrCheckProcessingLease(paperId);

  if (leaseResult.action === "ALREADY_ACTIVE") {
    return {
      success: true,
      paperId,
      state: "DOWNLOADING",
      status: "PROCESSING",
      jobId: leaseResult.job.id,
      message:
        "Document is currently being prepared by another active worker. Please check back shortly.",
    };
  }

  if (leaseResult.action === "MAX_ATTEMPTS_EXCEEDED") {
    return {
      success: false,
      paperId,
      state: "FAILED",
      status: "FAILED",
      jobId: leaseResult.job.id,
      message: "Maximum automated processing retry attempts (3) exceeded. Manual PDF upload is available.",
      errorCode: "MAX_ATTEMPTS_EXCEEDED",
    };
  }

  const activeJob = leaseResult.job;
  const activeLeaseToken = leaseResult.leaseToken;
  const prov = (paper.sourceProvenance as any) || {};

  try {
    let pdfBuffer: Buffer;
    let targetPdfUrl: string | null = null;
    let targetLicense: string | null = null;
    let targetVersion: string | null = null;
    let targetLandingPage: string | null = null;

    // 4. Source Resolution if Paper has no local Storage Path
    if (!paper.storagePath) {
      // Paper is currently METADATA_ONLY -> Resolve lawful sources
      await prisma.processingJob.update({
        where: { id: activeJob.id },
        data: { stage: "METADATA_EXTRACTION" },
      });

      const resolution = await resolveScholarlySources({
        doi: paper.doi || undefined,
        arxivId: paper.arxivId || undefined,
        pmid: paper.pmid || undefined,
        pmcid: paper.pmcid || undefined,
      });

      let best = resolution.bestCandidate;

      // Safe fallback: If resolver did not find candidate but record was already pre-verified as ingestible
      if ((!best || !best.canPlatformIngest) && prov?.canPlatformIngest && (paper.pdfUrl || prov?.pdfUrl)) {
        const fallbackUrl = paper.pdfUrl || prov?.pdfUrl;
        best = {
          paperIdentifier: paper.doi || paper.id,
          sourceProvider: "UNKNOWN",
          landingPageUrl: fallbackUrl,
          pdfUrl: fallbackUrl,
          manuscriptVersion: (prov?.version as any) || "publishedVersion",
          license: prov?.license || "CC-BY",
          licenseEvidence: prov?.licenseEvidence || "Pre-verified open access source",
          canDirectRead: true,
          canPlatformIngest: true,
          verificationStatus: "VERIFIED",
          lastCheckedAt: new Date().toISOString(),
        };
      }

      if (!best || !best.canPlatformIngest || !best.pdfUrl) {
        // Platform ingestion not permitted by license or no open PDF found
        await prisma.processingJob.update({
          where: { id: activeJob.id },
          data: {
            status: "COMPLETED",
            stage: "METADATA_EXTRACTION",
            completedAt: new Date(),
          },
        });

        await prisma.paper.update({
          where: { id: paperId },
          data: {
            status: "METADATA_ONLY",
            sourceProvenance: {
              ...prov,
              scholarlyClassification: resolution.classification,
              sourceResolution: resolution,
            },
          },
        });

        if (best && best.canDirectRead && best.landingPageUrl) {
          return {
            success: false,
            paperId,
            state: "RESTRICTED",
            status: "METADATA_ONLY",
            jobId: activeJob.id,
            license: best.license,
            externalLandingPageUrl: best.landingPageUrl,
            externalPdfUrl: best.pdfUrl || null,
            errorCode: "RESTRICTED_LICENSE",
            message: `Automated server ingestion is restricted by license (${best.license || "restricted"}). External reading link is preserved; personal PDF upload is available.`,
          };
        }

        return {
          success: false,
          paperId,
          state: "RESTRICTED",
          status: "METADATA_ONLY",
          jobId: activeJob.id,
          errorCode: "NO_FULL_TEXT",
          message: "No open-access full-text manuscript was located for automated analysis. You may upload a personal copy.",
        };
      }

      targetPdfUrl = best.pdfUrl;
      targetLicense = best.license;
      targetVersion = best.manuscriptVersion;
      targetLandingPage = best.landingPageUrl;

      // 5. Lawful Download
      await assertAndRenewLease({
        jobId: activeJob.id,
        leaseToken: activeLeaseToken,
        stage: "PDF_DOWNLOAD",
      });

      try {
        pdfBuffer = await fetchRemotePdfSafely(targetPdfUrl);
      } catch (fetchErr: any) {
        const errorMsg = `PDF download failed: ${fetchErr.message || "Failed retrieving remote manuscript"}`;
        await prisma.processingJob.update({
          where: { id: activeJob.id },
          data: {
            status: "FAILED",
            stage: "PDF_DOWNLOAD",
            errorMessage: errorMsg,
            completedAt: new Date(),
          },
        });
        await prisma.paper.update({
          where: { id: paperId },
          data: { status: "FAILED" },
        });
        return {
          success: false,
          paperId,
          state: "FAILED",
          status: "FAILED",
          jobId: activeJob.id,
          errorCode: "DOWNLOAD_FAILED",
          message: errorMsg,
        };
      }

      // Heartbeat lease after network download completes
      await assertAndRenewLease({
        jobId: activeJob.id,
        leaseToken: activeLeaseToken,
      });

      // Compute content hash
      const contentHash = createHash("sha256").update(pdfBuffer).digest("hex");

      // Upload to Storage
      const uploadRes = await uploadPaperPdf(paperId, pdfBuffer);

      await prisma.paper.update({
        where: { id: paperId },
        data: {
          storagePath: uploadRes.storagePath,
          pdfUrl: uploadRes.publicUrl,
          isOpenAccess: true,
          sourceProvenance: {
            ...prov,
            contentHash,
            license: targetLicense,
            version: targetVersion,
            acquisitionSource: best.sourceProvider,
            externalLandingPageUrl: targetLandingPage,
            isLawfulOpenAccess: true,
            isPublicOpenAccess: true,
          },
        },
      });
    } else {
      // Paper already has storagePath: download from storage
      try {
        pdfBuffer = await downloadPaperPdf(paper.storagePath);
      } catch (dlErr: any) {
        const errorMsg = `Storage retrieval failed: ${dlErr.message}`;
        await prisma.processingJob.update({
          where: { id: activeJob.id },
          data: {
            status: "FAILED",
            stage: "PDF_DOWNLOAD",
            errorMessage: errorMsg,
            completedAt: new Date(),
          },
        });
        await prisma.paper.update({
          where: { id: paperId },
          data: { status: "FAILED" },
        });
        return {
          success: false,
          paperId,
          state: "FAILED",
          status: "FAILED",
          jobId: activeJob.id,
          errorCode: "DOWNLOAD_FAILED",
          message: errorMsg,
        };
      }
    }

    // 6. Text Extraction (unpdf) & OCR Check
    await assertAndRenewLease({
      jobId: activeJob.id,
      leaseToken: activeLeaseToken,
      stage: "TEXT_EXTRACTION",
    });

    let extractionResult;
    try {
      extractionResult = await extractPdfText(pdfBuffer);
    } catch (extractErr: any) {
      const isScanned = extractErr instanceof ScannedPdfError;
      const errorMsg = isScanned
        ? extractErr.message
        : `Text extraction failed: ${extractErr.message || "Unreadable PDF"}`;

      await prisma.processingJob.update({
        where: { id: activeJob.id },
        data: {
          status: "FAILED",
          stage: "TEXT_EXTRACTION",
          errorMessage: errorMsg,
          completedAt: new Date(),
        },
      });

      await prisma.paper.update({
        where: { id: paperId },
        data: { status: "FAILED" },
      });

      return {
        success: false,
        paperId,
        state: "FAILED",
        status: "FAILED",
        jobId: activeJob.id,
        errorCode: isScanned ? "OCR_REQUIRED" : "INTERNAL_ERROR",
        message: isScanned
          ? "Document appears to be a scanned image or contains no digital text. OCR processing is required."
          : errorMsg,
      };
    }

    // 7. Chunking
    await assertAndRenewLease({
      jobId: activeJob.id,
      leaseToken: activeLeaseToken,
      stage: "CHUNKING",
    });

    const chunks = chunkManuscriptPages(paperId, extractionResult.pages);
    if (chunks.length === 0) {
      const errorMsg = "Extraction yielded 0 usable chunks. Document may be scanned or empty.";
      await prisma.processingJob.update({
        where: { id: activeJob.id },
        data: {
          status: "FAILED",
          stage: "CHUNKING",
          errorMessage: errorMsg,
          completedAt: new Date(),
        },
      });
      await prisma.paper.update({
        where: { id: paperId },
        data: { status: "FAILED" },
      });
      return {
        success: false,
        paperId,
        state: "FAILED",
        status: "FAILED",
        jobId: activeJob.id,
        errorCode: "OCR_REQUIRED",
        message: errorMsg,
      };
    }

    // 8. Atomically Persist Chunks (Worker lease fencing check)
    await prisma.$transaction(
      async (tx) => {
        // Verify this worker still holds the valid active leaseToken
        const currentJob = await tx.processingJob.findFirst({
          where: {
            id: activeJob.id,
            status: "RUNNING",
            errorStack: activeLeaseToken,
          },
        });
        if (!currentJob) {
          throw new WorkerFencingError(
            `Worker lease "${activeLeaseToken}" for job ${activeJob.id} is invalid or expired. Chunk persistence aborted.`
          );
        }

        // Delete previous chunks for idempotency
        await tx.paperChunk.deleteMany({ where: { paperId } });

        // Insert new chunks
        await tx.paperChunk.createMany({
          data: chunks.map((c) => ({
            paperId: c.paperId,
            chunkIndex: c.chunkIndex,
            text: c.text,
            section: c.section,
            pageNumber: c.pageNumber,
            tokenCount: c.tokenCount,
            metadata: c.metadata,
          })),
        });

        await tx.paper.update({
          where: { id: paperId },
          data: { status: "TEXT_EXTRACTED" },
        });
      },
      { maxWait: 10000, timeout: 20000 }
    );

    // 9. Indexing / Embeddings Step (Cost-safe execution boundary)
    await assertAndRenewLease({
      jobId: activeJob.id,
      leaseToken: activeLeaseToken,
      stage: "EMBEDDING_GENERATION",
    });

    await embedPaperChunks(paperId);

    // 10. Finalize Job & Paper State (Worker lease fencing check)
    const isMock = isMockEmbeddingMode();
    const finalPaperStatus: PaperProcessingStatus = isMock
      ? PaperProcessingStatus.TEXT_EXTRACTED
      : PaperProcessingStatus.COMPLETED;
    const finalLogicalState: OnDemandLogicalState = isMock
      ? "TEXT_EXTRACTED"
      : "READY";

    await prisma.$transaction(
      async (tx) => {
        const currentJob = await tx.processingJob.findFirst({
          where: {
            id: activeJob.id,
            status: "RUNNING",
            errorStack: activeLeaseToken,
          },
        });
        if (!currentJob) {
          throw new WorkerFencingError(
            `Worker lease "${activeLeaseToken}" for job ${activeJob.id} is invalid or expired. Finalization rejected.`
          );
        }

        await tx.processingJob.update({
          where: { id: activeJob.id },
          data: {
            status: "COMPLETED",
            stage: "EMBEDDING_GENERATION",
            completedAt: new Date(),
            errorMessage: null,
            errorStack: null, // clear lease token on completion
          },
        });

        const latestPaper = await tx.paper.findUnique({
          where: { id: paperId },
          select: { sourceProvenance: true },
        });
        const currentProv =
          latestPaper?.sourceProvenance && typeof latestPaper.sourceProvenance === "object"
            ? (latestPaper.sourceProvenance as Record<string, any>)
            : typeof paper.sourceProvenance === "object" && paper.sourceProvenance
            ? (paper.sourceProvenance as Record<string, any>)
            : {};

        await tx.paper.update({
          where: { id: paperId },
          data: {
            status: finalPaperStatus,
            sourceProvenance: {
              ...currentProv,
              isLawfulOpenAccess: true,
              isPublicOpenAccess: true,
              hasExtractableText: true,
              hasSemanticEmbeddings: !isMock,
              indexingStatus: isMock ? "TEXT_EXTRACTED" : "SEMANTICALLY_INDEXED",
              semanticIndexingPending: isMock,
            },
          },
        });
      },
      { maxWait: 10000, timeout: 20000 }
    );

    return {
      success: true,
      paperId,
      state: finalLogicalState,
      status: finalPaperStatus,
      hasFullText: true,
      hasExtractableText: true,
      hasSemanticEmbeddings: !isMock,
      jobId: activeJob.id,
      chunkCount: chunks.length,
      pageCount: extractionResult.totalPages,
      message: isMock
        ? "Full text acquired and parsed. Verbatim evidence and citations are ready (semantic vector indexing pending authorization)."
        : "Ready for AI! Full text acquired, parsed, and semantically indexed.",
    };
  } catch (err: any) {
    if (err instanceof WorkerFencingError) {
      console.warn(`[on-demand-processor] Fencing rejection for paper ${paperId}: ${err.message}`);
      return {
        success: false,
        paperId,
        state: "FAILED",
        status: PaperProcessingStatus.FAILED,
        jobId: activeJob.id,
        errorCode: "LEASE_EXPIRED",
        message: err.message,
      };
    }

    console.error(`[on-demand-processor] Unexpected error for paper ${paperId}:`, err);
    const errorMsg = `Processing failed: ${err.message || "Unknown error"}`;

    await prisma.processingJob.update({
      where: { id: activeJob.id },
      data: {
        status: "FAILED",
        errorMessage: errorMsg,
        completedAt: new Date(),
      },
    }).catch(() => {});

    await prisma.paper.update({
      where: { id: paperId },
      data: { status: "FAILED" },
    }).catch(() => {});

    return {
      success: false,
      paperId,
      state: "FAILED",
      status: "FAILED",
      jobId: activeJob.id,
      errorCode: "INTERNAL_ERROR",
      message: errorMsg,
    };
  }
}

/**
 * Retrieves the current processing status and telemetry for a paper.
 */
export async function getPaperProcessingStatus(params: {
  paperId: string;
  userId: string;
}): Promise<PaperProcessingStatusInfo | null> {
  const { paperId, userId } = params;

  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      chunks: { select: { id: true } },
      processingJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!paper) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  const auth = await authorizePaperAccess(
    paper as MinimalPaperRecord,
    user,
    "VIEW_METADATA"
  );

  if (!auth.allowed) {
    return null;
  }

  const latestJob = paper.processingJobs[0] || null;
  const prov = (paper.sourceProvenance as any) || {};
  const hasSemanticEmbeddings = prov.hasSemanticEmbeddings === true;
  const hasExtractableText = paper.chunks.length > 0;

  let logicalState: OnDemandLogicalState = "METADATA_ONLY";
  if (paper.status === "COMPLETED" && hasSemanticEmbeddings && paper.chunks.length > 0) {
    logicalState = "READY";
  } else if (
    paper.status === "TEXT_EXTRACTED" ||
    (hasExtractableText && !hasSemanticEmbeddings && (paper.status as string) !== "FAILED")
  ) {
    logicalState = "TEXT_EXTRACTED";
  } else if (paper.status === "PROCESSING" || latestJob?.status === "RUNNING") {
    logicalState =
      latestJob?.stage === "EMBEDDING_GENERATION"
        ? "INDEXING"
        : latestJob?.stage === "TEXT_EXTRACTION"
        ? "PARSING"
        : latestJob?.stage === "CHUNKING"
        ? "CHUNKING"
        : "DOWNLOADING";
  } else if (paper.status === "FAILED") {
    logicalState = "FAILED";
  } else if (prov?.scholarlyClassification === "READING_LINK_ONLY" || prov?.scholarlyClassification === "ABSTRACT_ONLY") {
    logicalState = "RESTRICTED";
  }

  return {
    paperId: paper.id,
    paperStatus: paper.status,
    logicalState,
    hasPdf: Boolean(paper.storagePath),
    hasExtractableText,
    hasSemanticEmbeddings,
    indexingStatus:
      prov.indexingStatus ||
      (paper.status === "TEXT_EXTRACTED"
        ? "TEXT_EXTRACTED"
        : paper.status === "COMPLETED"
        ? "SEMANTICALLY_INDEXED"
        : "METADATA_ONLY"),
    embeddingModel: (paper.chunks[0] as any)?.embeddingModel || null,
    chunkCount: paper.chunks.length,
    isProcessing: paper.status === "PROCESSING" || latestJob?.status === "RUNNING",
    canChat: hasExtractableText,
    latestJob: latestJob
      ? {
          id: latestJob.id,
          stage: latestJob.stage,
          status: latestJob.status,
          attempt: latestJob.attempt,
          maxAttempts: latestJob.maxAttempts,
          errorMessage: latestJob.errorMessage,
          startedAt: latestJob.startedAt,
          completedAt: latestJob.completedAt,
        }
      : null,
    sourceResolution: prov?.sourceResolution || null,
  };
}
