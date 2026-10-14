import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * AI RESEARCH HUB — PHASE 4B
 * CENTRALIZED PAPER ACCESS CONTROL & AUTHORIZATION ENGINE
 *
 * Implements strict, server-side access control across research manuscripts:
 * 1. Administrator Testing Fixtures: Strictly restricted to ADMIN role.
 * 2. Private User Documents: Strictly restricted to the owning researcher (ownerId).
 * 3. Public Scholarly Metadata: Bibliographic citations viewable by all; PDF downloads
 *    restricted to legitimate open-access external redirects (no direct storage access).
 * 4. Ambiguous Historical Records: Fail-closed policy (denies access to non-admin users).
 * 5. Security Defense-in-Depth: Uses HTTP 401 for unauthenticated sessions and HTTP 404
 *    for forbidden private/fixture identifiers to prevent resource enumeration.
 */

export type PaperClassification =
  | "ADMIN_TEST_FIXTURE"
  | "PRIVATE_USER_DOCUMENT"
  | "PUBLIC_SCHOLARLY_METADATA"
  | "AMBIGUOUS_HISTORICAL";

export type PaperAction =
  | "VIEW_METADATA"
  | "DOWNLOAD_PDF"
  | "VIEW_EVIDENCE"
  | "INTERACT_AI"
  | "VIEW_SUMMARY"
  | "MANAGE_PAPER";

export interface UserContext {
  id: string;
  role: "USER" | "ADMIN" | string;
}

export interface PaperAuthorizationResult {
  allowed: boolean;
  classification: PaperClassification;
  statusCode: 200 | 401 | 403 | 404;
  reason?: string;
}

export interface MinimalPaperRecord {
  id: string;
  storagePath?: string | null;
  pdfUrl?: string | null;
  sourceProvenance?: any;
  doi?: string | null;
  arxivId?: string | null;
  pmid?: string | null;
  pmcid?: string | null;
  semanticScholarId?: string | null;
  title?: string;
}

/**
 * Explicit registry of historical benchmark and development test fixtures.
 * These records support automated table extraction and reasoning benchmarks,
 * but must NEVER be accessible to ordinary researchers or exposed in public views.
 */
export const ADMIN_TEST_FIXTURE_IDS = new Set<string>([
  "cmumgtiix0000vr445cn8ry7o", // Kim et al. (BUSI)
  "cmunotrr10000vrusnqyv61ut", // Lymph node TB radiomics
  "cmunwc3ev001xvrusq53yvo9b", // Su et al. (ARU-Net)
  "cmunwm6m2004ivrusrlr89j95", // Breast Ultrasound CNN
  "cmunwvfkr006uvrus0m3ky4wn", // Zakareya et al.
  "cmunx4c1b009pvrusz5785bw3", // Cervical spondylotic myelopathy
  "cmunxiwf900blvruskrclq381", // Skin tumors
  "cmunxw9il00dnvrus7w9mqij9", // Li et al. (BI-RADS 4)
  "cmuwcdg910000vrss3yjvxncw", // Practical Quantum Error Mitigation
  "cmuwceqie0035vrss654u0nvy", // piCRISPR
  "cmuwcfd5h004vvrss925t6jo2", // SelfCheckGPT
  "cmuwcfyqc006ovrss8qyhxa1u", // PointPillars Table 1
  "cmuwcgoeq008nvrssu7qwcat7", // Whole-slide lung cancer
]);

/**
 * Classifies a paper into its canonical access control category.
 * Enforces a strict FAIL-CLOSED policy: If a record holds stored files
 * but lacks clear user ownership, it is quarantined as an administrator fixture.
 */
export function classifyPaper(paper: MinimalPaperRecord): PaperClassification {
  // 1. Explicit Administrator Fixture Registry
  if (ADMIN_TEST_FIXTURE_IDS.has(paper.id)) {
    return "ADMIN_TEST_FIXTURE";
  }

  const prov = paper.sourceProvenance as any;
  if (prov?.isSystemFixture === true) {
    return "ADMIN_TEST_FIXTURE";
  }

  // 2. Private User Document (Uploaded or owned by a researcher)
  const ownerId =
    prov?.uploadedByUserId ||
    prov?.ownerId ||
    (paper as any).uploadedByUserId;
  if (
    prov?.isPrivate === true ||
    (ownerId && typeof ownerId === "string" && ownerId.trim().length > 0)
  ) {
    return "PRIVATE_USER_DOCUMENT";
  }

  // 3. Public Open Access Papers (Lawfully acquired open-access manuscripts with academic identifiers)
  const isLawfulOaPaper =
    (prov?.isPublicOpenAccess === true ||
      prov?.isLawfulOpenAccess === true ||
      (paper as any).isOpenAccess === true) &&
    Boolean(
      paper.doi ||
        paper.arxivId ||
        paper.pmid ||
        paper.pmcid ||
        paper.semanticScholarId
    );

  if (isLawfulOaPaper) {
    return "PUBLIC_SCHOLARLY_METADATA";
  }

  // 4. Historical benchmark fixtures with attached storage files:
  // Pre-Phase 4 files in Supabase Storage without ownerId or OA provenance are quarantined.
  if (paper.storagePath && paper.storagePath.trim().length > 0) {
    return "ADMIN_TEST_FIXTURE";
  }

  // 5. Public Scholarly Metadata:
  // Canonical academic records without proprietary stored manuscripts.
  const hasAcademicIdentifier = Boolean(
    paper.doi ||
      paper.arxivId ||
      paper.pmid ||
      paper.pmcid ||
      paper.semanticScholarId
  );

  if (hasAcademicIdentifier) {
    return "PUBLIC_SCHOLARLY_METADATA";
  }

  // 6. Fail closed for ambiguous historical records
  return "AMBIGUOUS_HISTORICAL";
}

/**
 * Evaluates whether a manuscript is permitted for public scholarly views,
 * search indexing, browsing, and discovery previews.
 */
export function isPublicScholarlyPaper(paper: MinimalPaperRecord): boolean {
  return classifyPaper(paper) === "PUBLIC_SCHOLARLY_METADATA";
}

/**
 * Canonical Prisma WHERE clause for public scholarly search, browsing and counts.
 * Excludes administrator benchmark fixtures and non-open-access stored files at DB query time.
 */
export function getPublicPaperWhereInput(): any {
  return {
    id: { notIn: Array.from(ADMIN_TEST_FIXTURE_IDS) },
    OR: [
      { doi: { not: null } },
      { arxivId: { not: null } },
      { pmid: { not: null } },
      { pmcid: { not: null } },
      { semanticScholarId: { not: null } },
    ],
    NOT: [
      {
        AND: [
          { storagePath: { not: null } },
          { isOpenAccess: false },
        ],
      },
    ],
  };
}

/**
 * Central authorization decision engine.
 * Determines whether a user context (or anonymous visitor) is permitted
 * to execute the requested action on the given paper record.
 */
export async function authorizePaperAccess(
  paper: MinimalPaperRecord,
  user: UserContext | null | undefined,
  action: PaperAction
): Promise<PaperAuthorizationResult> {
  const classification = classifyPaper(paper);

  // RULE 1: Administrators have privileged access for system maintenance and benchmarking
  if (user?.role === "ADMIN") {
    return { allowed: true, classification, statusCode: 200 };
  }

  // RULE 2: Administrator Test Fixtures and Ambiguous Records
  // Non-admins receive zero access. We return 404 (or 401 if unauthenticated)
  // to avoid leaking the existence of internal benchmark records.
  if (classification === "ADMIN_TEST_FIXTURE" || classification === "AMBIGUOUS_HISTORICAL") {
    return {
      allowed: false,
      classification,
      statusCode: user ? 404 : 401,
      reason: "Document is restricted to system administrators.",
    };
  }

  // RULE 3: Private User Documents
  if (classification === "PRIVATE_USER_DOCUMENT") {
    if (!user) {
      return {
        allowed: false,
        classification,
        statusCode: 401,
        reason: "Authentication required to access private document.",
      };
    }

    const prov = paper.sourceProvenance as any;
    const ownerId = prov?.uploadedByUserId || prov?.ownerId;

    if (user.id !== ownerId) {
      return {
        allowed: false,
        classification,
        statusCode: 404, // 404 hides resource existence from unauthorized researchers
        reason: "Document not found.",
      };
    }

    return { allowed: true, classification, statusCode: 200 };
  }

  // RULE 4: Public Scholarly Metadata
  if (classification === "PUBLIC_SCHOLARLY_METADATA") {
    // 4A: Anyone may view public bibliographic metadata (title, abstract, authors, DOI)
    if (action === "VIEW_METADATA") {
      return { allowed: true, classification, statusCode: 200 };
    }

    // 4B: Public metadata records have no local PDF storage.
    // External open-access redirections are permitted.
    if (action === "DOWNLOAD_PDF") {
      return { allowed: true, classification, statusCode: 200 };
    }

    // 4C: Public evidence chunks and summaries from public literature are accessible for scholarly discovery
    if (action === "VIEW_EVIDENCE" || action === "VIEW_SUMMARY") {
      return { allowed: true, classification, statusCode: 200 };
    }

    // 4D: Interactive AI synthesis, Q&A, and thread generation require authenticated researcher
    if (action === "INTERACT_AI") {
      if (!user) {
        return {
          allowed: false,
          classification,
          statusCode: 401,
          reason: "You must be signed in to query or interact with scientific literature.",
        };
      }
      return { allowed: true, classification, statusCode: 200 };
    }

    // 4E: Managing, editing, or deleting canonical scholarly metadata requires ADMIN role
    if (action === "MANAGE_PAPER") {
      return {
        allowed: false,
        classification,
        statusCode: user ? 403 : 401,
        reason: "Admin privileges required to manage canonical scholarly metadata.",
      };
    }
  }

  // Default fail-closed fallback
  return {
    allowed: false,
    classification,
    statusCode: 404,
    reason: "Access denied.",
  };
}

/**
 * Convenience helper to authorize access using the current request's NextAuth session.
 */
export async function authorizeCurrentSession(
  paper: MinimalPaperRecord,
  action: PaperAction
): Promise<PaperAuthorizationResult> {
  const session = await getServerSession(authOptions);
  return authorizePaperAccess(paper, session?.user, action);
}
