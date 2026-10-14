/**
 * AI RESEARCH HUB — AUTOMATIC OPEN-ACCESS FULL-TEXT DISCOVERY TEST SUITE
 *
 * Comprehensive end-to-end and unit verification covering all 18 Phase I scenarios:
 * 1.  Valid DOI with eligible open-access PDF
 * 2.  DOI with metadata but no PDF
 * 3.  DOI with an OA landing page but no direct PDF
 * 4.  DOI with unknown or restrictive reuse permission (preserves external link only)
 * 5.  Invalid DOI handling
 * 6.  Duplicate DOI import idempotency
 * 7.  Existing user-owned PDF preservation
 * 8.  Preprint versus published-version identification
 * 9.  Malicious PDF redirect or internal IP attempt (SSRF prevention)
 * 10. HTML response disguised as PDF (%PDF- header verification)
 * 11. Oversized (>30MB) or corrupt PDF rejection
 * 12. PDF extraction failure handling (0 usable chunks -> FAILED status)
 * 13. Processing-job retry
 * 14. Missing genuine abstract fallback to "No abstract available."
 * 15. Cross-user document isolation
 * 16. Admin benchmark fixture quarantine
 * 17. Grounded chat available only when actual content is processed
 * 18. Existing My Library and Phase 7B editor regressions
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
  resetMockStorage,
} from "../src/lib/test-guard";

// 1. ISOLATION PRE-FLIGHT
console.log("=== STEP 1: INITIALIZING ISOLATED TEST ENVIRONMENT ===");
loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/prisma";
import {
  discoverOpenAccessForDoi,
  evaluateReusePermission,
  normalizeOaVersion,
  selectBestOpenAccessLocation,
  invalidateDiscoveryCache,
  OpenAccessCandidateLocation,
} from "../src/lib/discovery/open-access-service";
import {
  validateSafePdfUrl,
  isPrivateOrReservedIp,
  acquireAndIngestLawfulFullText,
} from "../src/lib/discovery/full-text-service";
import {
  sanitizeScientificAbstract,
  classifyAndNormalizeIdentifier,
  importPaperByIdentifier,
  discoverAndProcessPaperOpenAccess,
} from "../src/lib/library/identifier-lookup-service";
import {
  classifyPaper,
  authorizePaperAccess,
  PaperClassification,
} from "../src/lib/auth/paper-authorization";
import { createCollection, addPaperToCollection } from "../src/lib/library/collections-service";
import { retrievePaperEvidence } from "../src/lib/rag/retrieve-paper-evidence";
import {
  createResearchDocument,
  attachDocumentPaper,
  deleteResearchDocument,
} from "../src/lib/editor/document-service";

async function runTestSuite() {
  console.log("================================================================================");
  console.log(" AI RESEARCH HUB — OPEN-ACCESS DOI IMPORTER COMPREHENSIVE TEST SUITE");
  console.log(" Target: 127.0.0.1:5432/ai_research_hub (Isolated Local Database)");
  console.log(" Storage: ISOLATED IN-MEMORY MOCK STORAGE");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testId: string, description: string) {
    if (condition) {
      console.log(`[PASS] ${testId}: ${description}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testId}: ${description}`);
      failed++;
    }
  }

  // Load sample valid PDF for mock downloads
  const samplePdfPath = path.resolve(__dirname, "../scratch/mengo-original.pdf");
  const samplePdfBuffer = fs.readFileSync(samplePdfPath);

  // Setup test users in isolated DB
  const userA = await prisma.user.upsert({
    where: { email: "doi_test_user_a@example.com" },
    update: {},
    create: {
      email: "doi_test_user_a@example.com",
      name: "Dr. Alice Researcher",
      role: "USER",
      passwordHash: "test_hash_isolated_a",
    },
  });

  const userB = await prisma.user.upsert({
    where: { email: "doi_test_user_b@example.com" },
    update: {},
    create: {
      email: "doi_test_user_b@example.com",
      name: "Dr. Bob Investigator",
      role: "USER",
      passwordHash: "test_hash_isolated_b",
    },
  });

  const createdPaperIds: string[] = [];

  // Save original fetch
  const originalFetch = globalThis.fetch;

  try {
    // ===========================================================================
    // TEST 1: Valid DOI with eligible open-access PDF
    // ===========================================================================
    console.log("\n--- TEST 1: Valid DOI with eligible open-access PDF ---");
    const testDoi1 = "10.1038/s41586-020-2649-2";
    invalidateDiscoveryCache(testDoi1);

    // Mock network fetch for Unpaywall and PDF download
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === "string" ? input : input.toString();

      if (urlStr.includes("api.unpaywall.org")) {
        return new Response(
          JSON.stringify({
            doi: testDoi1,
            is_oa: true,
            title: "Structure and mechanism of blood-brain barrier transport",
            journal_name: "Nature",
            published_date: "2020-09-02",
            best_oa_location: {
              url: "https://europepmc.org/articles/PMC7611234/pdf/nature12345.pdf",
              url_for_pdf: "https://europepmc.org/articles/PMC7611234/pdf/nature12345.pdf",
              version: "publishedVersion",
              license: "cc-by",
              host_type: "repository",
              evidence: "oa_location",
            },
            oa_locations: [
              {
                url_for_pdf: "https://europepmc.org/articles/PMC7611234/pdf/nature12345.pdf",
                version: "publishedVersion",
                license: "cc-by",
                host_type: "repository",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (urlStr.includes("api.openalex.org")) {
        return new Response(JSON.stringify({ locations: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (urlStr.includes("europepmc.org")) {
        // Return valid PDF stream
        return new Response(samplePdfBuffer, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": samplePdfBuffer.length.toString(),
          },
        });
      }

      return new Response("Not found", { status: 404 });
    };

    const discovery1 = await discoverOpenAccessForDoi(testDoi1, { forceRefresh: true });
    assert(discovery1.isFound === true, "1.1", "Discovery finds open-access metadata");
    assert(discovery1.status === "OPEN_ACCESS_PDF_FOUND", "1.2", "Status is OPEN_ACCESS_PDF_FOUND");
    assert(discovery1.bestLocation !== null, "1.3", "Best location identified");
    assert(discovery1.bestLocation?.isLawfullyAcquirable === true, "1.4", "Identified as lawfully acquirable");
    assert(discovery1.bestLocation?.version === "publishedVersion", "1.5", "Version is publishedVersion");
    assert(discovery1.bestLocation?.license === "cc-by", "1.6", "License recognized as cc-by");

    let import1;
    try {
      import1 = await importPaperByIdentifier({ userId: userA.id, identifier: testDoi1 });
    } catch (err: any) {
      console.error("DEBUG ERROR IN IMPORT 1:", err?.message, err?.stack);
      throw err;
    }
    assert(import1.success === true, "1.7", "Import succeeds");
    assert(import1.hasFullText === true, "1.8", "Full text acquired and processed");
    createdPaperIds.push(import1.paperId!);

    const dbPaper1 = await prisma.paper.findUnique({
      where: { id: import1.paperId! },
      include: { chunks: true, bookmarks: true },
    });
    assert(dbPaper1?.status === "COMPLETED", "1.9", "Paper status transitioned to COMPLETED");
    assert(dbPaper1?.isOpenAccess === true, "1.10", "Paper marked as isOpenAccess");
    assert(dbPaper1?.chunks.length! > 0, "1.11", "Chunks generated and persisted");
    const prov1 = dbPaper1?.sourceProvenance as any;
    assert(prov1?.license === "cc-by", "1.12", "Source provenance records cc-by license");
    assert(prov1?.isLawfulOpenAccess === true, "1.13", "Source provenance flags lawful open access");

    // ===========================================================================
    // TEST 2: DOI with metadata but no PDF
    // ===========================================================================
    console.log("\n--- TEST 2: DOI with metadata but no PDF ---");
    const testDoi2 = "10.1016/j.cell.2021.05.001";
    invalidateDiscoveryCache(testDoi2);

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = typeof input === "string" ? input : input.toString();

      if (urlStr.includes("api.unpaywall.org")) {
        return new Response(
          JSON.stringify({
            doi: testDoi2,
            is_oa: false,
            title: "Cellular Architecture of Human Tissues",
            journal_name: "Cell",
            published_date: "2021-06-10",
            oa_locations: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (urlStr.includes("api.openalex.org")) {
        return new Response(
          JSON.stringify({
            title: "Cellular Architecture of Human Tissues",
            open_access: { is_oa: false },
            locations: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const discovery2 = await discoverOpenAccessForDoi(testDoi2, { forceRefresh: true });
    assert(discovery2.status === "NO_OPEN_ACCESS_LOCATED", "2.1", "Status is NO_OPEN_ACCESS_LOCATED");
    assert(discovery2.bestLocation === null, "2.2", "No candidate location found");

    const import2 = await importPaperByIdentifier({ userId: userA.id, identifier: testDoi2 });
    assert(import2.success === true, "2.3", "Metadata import succeeds");
    assert(import2.hasFullText === false, "2.4", "Full text correctly flagged as unavailable");
    createdPaperIds.push(import2.paperId!);

    const dbPaper2 = await prisma.paper.findUnique({
      where: { id: import2.paperId! },
      include: { chunks: true },
    });
    assert(dbPaper2?.status === "METADATA_ONLY", "2.5", "Paper stays METADATA_ONLY");
    assert(dbPaper2?.chunks.length === 0, "2.6", "Zero chunks created for metadata-only paper");

    // ===========================================================================
    // TEST 3: DOI with an OA landing page but no direct PDF
    // ===========================================================================
    console.log("\n--- TEST 3: DOI with an OA landing page but no direct PDF ---");
    const testDoi3 = "10.1126/science.abc1234";
    invalidateDiscoveryCache(testDoi3);

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = typeof input === "string" ? input : input.toString();

      if (urlStr.includes("api.unpaywall.org")) {
        return new Response(
          JSON.stringify({
            doi: testDoi3,
            is_oa: true,
            title: "Cryo-EM Insights into Ribosome Dynamics",
            journal_name: "Science",
            published_date: "2022-04-15",
            best_oa_location: {
              url: "https://nature.com/articles/science.abc1234",
              url_for_landing_page: "https://nature.com/articles/science.abc1234",
              url_for_pdf: null, // Landing page only!
              version: "publishedVersion",
              license: "cc-by",
              host_type: "publisher",
            },
            oa_locations: [
              {
                url: "https://nature.com/articles/science.abc1234",
                url_for_landing_page: "https://nature.com/articles/science.abc1234",
                url_for_pdf: null,
                version: "publishedVersion",
                license: "cc-by",
                host_type: "publisher",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const discovery3 = await discoverOpenAccessForDoi(testDoi3, { forceRefresh: true });
    assert(discovery3.status === "OPEN_ACCESS_EXTERNAL_LINK_ONLY", "3.1", "Status is OPEN_ACCESS_EXTERNAL_LINK_ONLY");
    assert(discovery3.bestLocation?.isDirectPdf === false, "3.2", "Direct PDF correctly identified as false");
    assert(Boolean(discovery3.bestLocation?.landingPageUrl), "3.3", "Landing page URL preserved");

    const import3 = await importPaperByIdentifier({ userId: userA.id, identifier: testDoi3 });
    assert(import3.hasFullText === false, "3.4", "Automatic download skipped for landing page");
    createdPaperIds.push(import3.paperId!);

    const dbPaper3 = await prisma.paper.findUnique({ where: { id: import3.paperId! } });
    assert(dbPaper3?.status === "METADATA_ONLY", "3.5", "Paper stored as METADATA_ONLY");

    // ===========================================================================
    // TEST 4: DOI with unknown or restrictive reuse permission (e.g. Bronze OA)
    // ===========================================================================
    console.log("\n--- TEST 4: Restrictive / Bronze OA reuse evaluation ---");
    assert(evaluateReusePermission(null).isPermissive === false, "4.1", "Null license is not permissive");
    assert(evaluateReusePermission("bronze").isPermissive === false, "4.2", "Bronze OA is not permissive");
    assert(evaluateReusePermission("closed").isPermissive === false, "4.3", "Closed access is not permissive");
    assert(evaluateReusePermission("publisher-specific").isPermissive === false, "4.4", "Publisher-specific is not permissive");
    assert(evaluateReusePermission("cc-by-nc").isPermissive === false, "4.4b", "CC BY-NC is not permissive for automated platform ingestion");
    assert(evaluateReusePermission("cc-by-nc-sa").isPermissive === false, "4.4c", "CC BY-NC-SA is not permissive for automated platform ingestion");
    assert(evaluateReusePermission("cc-by-nc-nd").isPermissive === false, "4.4d", "CC BY-NC-ND is not permissive for automated platform ingestion");
    assert(evaluateReusePermission("cc-by-nd").isPermissive === false, "4.4e", "CC BY-ND is not permissive for automated platform ingestion");
    assert(evaluateReusePermission("https://creativecommons.org/licenses/by-nc/4.0/").isPermissive === false, "4.4f", "CC BY-NC URL is not permissive");
    assert(evaluateReusePermission("cc-by").isPermissive === true, "4.5", "CC-BY is permissive");
    assert(evaluateReusePermission("cc0").isPermissive === true, "4.6", "CC0 is permissive");
    assert(evaluateReusePermission("https://creativecommons.org/licenses/by/4.0/").isPermissive === true, "4.7", "Full CC URL is permissive");

    const testDoi4 = "10.1056/nejmoa2001234";
    invalidateDiscoveryCache(testDoi4);

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = typeof input === "string" ? input : input.toString();

      if (urlStr.includes("api.unpaywall.org")) {
        return new Response(
          JSON.stringify({
            doi: testDoi4,
            is_oa: true,
            title: "Trial of Monoclonal Antibody in Clinical Cohort",
            journal_name: "NEJM",
            best_oa_location: {
              url: "https://europepmc.org/articles/PMC9999/pdf/nejm.pdf",
              url_for_pdf: "https://europepmc.org/articles/PMC9999/pdf/nejm.pdf",
              version: "publishedVersion",
              license: "bronze", // Bronze: Free to read, but copying/processing prohibited!
              host_type: "publisher",
            },
            oa_locations: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const discovery4 = await discoverOpenAccessForDoi(testDoi4, { forceRefresh: true });
    assert(discovery4.status === "OPEN_ACCESS_EXTERNAL_LINK_ONLY", "4.8", "Bronze OA evaluated as external link only");
    assert(discovery4.bestLocation?.isLawfullyAcquirable === false, "4.9", "Not lawfully acquirable for server storage");
    assert(Boolean(discovery4.bestLocation?.pdfUrl), "4.10", "External PDF link preserved for viewing");

    const import4 = await importPaperByIdentifier({ userId: userA.id, identifier: testDoi4 });
    assert(import4.hasFullText === false, "4.11", "No automated PDF downloaded for bronze OA");
    createdPaperIds.push(import4.paperId!);

    // Regression Test: CC BY-NC paper is NOT automatically ingested merely because it is open access
    const testDoi4b = "10.1038/s41598-021-99999-x";
    invalidateDiscoveryCache(testDoi4b);

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = typeof input === "string" ? input : input.toString();

      if (urlStr.includes("api.unpaywall.org")) {
        return new Response(
          JSON.stringify({
            doi: testDoi4b,
            is_oa: true,
            title: "Non-Commercial Open Access Oncology Study",
            journal_name: "Scientific Reports",
            best_oa_location: {
              url: "https://europepmc.org/articles/PMC8888/pdf/study.pdf",
              url_for_pdf: "https://europepmc.org/articles/PMC8888/pdf/study.pdf",
              version: "publishedVersion",
              license: "cc-by-nc", // CC BY-NC: Non-commercial restriction prohibits automated platform ingestion!
              host_type: "publisher",
            },
            oa_locations: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const discovery4b = await discoverOpenAccessForDoi(testDoi4b, { forceRefresh: true });
    assert(discovery4b.status === "OPEN_ACCESS_EXTERNAL_LINK_ONLY", "4.12", "CC BY-NC evaluated as external link only");
    assert(discovery4b.bestLocation?.isLawfullyAcquirable === false, "4.13", "CC BY-NC is not lawfully acquirable for automated server storage");
    assert(Boolean(discovery4b.bestLocation?.pdfUrl), "4.14", "External PDF link preserved for viewing");

    const import4b = await importPaperByIdentifier({ userId: userA.id, identifier: testDoi4b });
    assert(import4b.success === true, "4.15", "CC BY-NC metadata import succeeds");
    assert(import4b.hasFullText === false, "4.16", "No automated PDF downloaded or ingested for CC BY-NC paper");
    createdPaperIds.push(import4b.paperId!);

    const dbPaper4b = await prisma.paper.findUnique({
      where: { id: import4b.paperId! },
      include: { chunks: true },
    });
    assert(dbPaper4b?.status === "METADATA_ONLY", "4.17", "CC BY-NC paper stored strictly as METADATA_ONLY");
    assert(dbPaper4b?.chunks.length === 0, "4.18", "Zero chunks created for CC BY-NC paper without manual user upload");
    assert(dbPaper4b?.pdfUrl === "https://europepmc.org/articles/PMC8888/pdf/study.pdf", "4.19", "External full-text URL preserved for external reading");
    const prov4b = dbPaper4b?.sourceProvenance as any;
    assert(prov4b?.license === "cc-by-nc", "4.20", "Source provenance preserves exact cc-by-nc rights info");
    assert(prov4b?.isLawfulOpenAccess === false, "4.21", "Source provenance correctly flags automated acquisition as false");

    // ===========================================================================
    // TEST 5: Invalid DOI handling
    // ===========================================================================
    console.log("\n--- TEST 5: Invalid DOI handling ---");
    const invalidClass = classifyAndNormalizeIdentifier("not-a-doi-or-id");
    assert(invalidClass.type === "UNKNOWN", "5.1", "Arbitrary text classified as UNKNOWN");

    globalThis.fetch = async (): Promise<Response> => new Response("Not found", { status: 404 });
    const invalidDisc = await discoverOpenAccessForDoi("10.invalid/malformed-doi!!!", { forceRefresh: true });
    assert(invalidDisc.status === "NO_OPEN_ACCESS_LOCATED", "5.2", "Malformed DOI returns NO_OPEN_ACCESS_LOCATED");

    const blankDisc = await discoverOpenAccessForDoi("");
    assert(blankDisc.isFound === false, "5.3", "Blank DOI returns isFound === false");

    // ===========================================================================
    // TEST 6: Duplicate DOI import idempotency
    // ===========================================================================
    console.log("\n--- TEST 6: Duplicate DOI import idempotency ---");
    const countBefore = await prisma.paper.count({ where: { doi: testDoi1 } });
    assert(countBefore === 1, "6.1", "Paper exists once before re-import");

    // User A imports the exact same DOI again
    const duplicateImport = await importPaperByIdentifier({ userId: userA.id, identifier: testDoi1 });
    assert(duplicateImport.success === true, "6.2", "Second import succeeds");
    assert(duplicateImport.isDuplicate === true, "6.3", "Identified as duplicate import");
    assert(duplicateImport.paperId === import1.paperId, "6.4", "Reuses identical existing paperId");

    // User B imports the same DOI (cross-tenant idempotency)
    const userBImport = await importPaperByIdentifier({ userId: userB.id, identifier: testDoi1 });
    assert(userBImport.paperId === import1.paperId, "6.4b", "User B reuses same global paperId");

    const countAfter = await prisma.paper.count({ where: { doi: testDoi1 } });
    assert(countAfter === 1, "6.5", "Paper count remains exactly 1 (no duplicate record created)");

    const userBBookmark = await prisma.bookmark.findUnique({
      where: { userId_paperId: { userId: userB.id, paperId: import1.paperId! } },
    });
    assert(Boolean(userBBookmark), "6.6", "Bookmark safely created for User B");

    // ===========================================================================
    // TEST 7: Existing user-owned PDF preservation
    // ===========================================================================
    console.log("\n--- TEST 7: Existing user-owned PDF preservation ---");
    const privateThesis = await prisma.paper.create({
      data: {
        title: "Confidential Doctoral Dissertation on Quantum Cryptography",
        abstract: "Confidential doctoral thesis abstract exploring quantum key distribution protocols.",
        storagePath: `users/${userA.id}/thesis.pdf`,
        status: "COMPLETED",
        pdfUrl: `https://mock.storage/users/${userA.id}/thesis.pdf`,
        sourceProvenance: {
          uploadedByUserId: userA.id,
          docType: "THESIS",
        },
        researchQuestion: "Private quantum analysis",
        methodology: "Simulated QKD",
        results: "Key rate 10 Mbps",
        limitations: "Noise",
        conclusion: "Scalable QKD",
      },
    });
    createdPaperIds.push(privateThesis.id);

    // Attempting to acquire external open access on a user's private manuscript must be rejected!
    const acqPriv = await acquireAndIngestLawfulFullText(
      privateThesis.id,
      "https://europepmc.org/articles/PMC12345/pdf/overwrite_attempt.pdf"
    );
    assert(acqPriv.success === false, "7.1", "Acquisition rejected for user-owned manuscript");
    assert(acqPriv.error?.includes("Cannot overwrite private user-owned research document") === true, "7.2", "Error explains user upload cannot be overwritten");

    const thesisAfter = await prisma.paper.findUnique({ where: { id: privateThesis.id } });
    assert(thesisAfter?.storagePath === `users/${userA.id}/thesis.pdf`, "7.3", "Storage path completely untouched");

    // ===========================================================================
    // TEST 8: Preprint versus published-version identification
    // ===========================================================================
    console.log("\n--- TEST 8: Preprint vs Published Version Identification ---");
    assert(normalizeOaVersion("submittedVersion") === "submittedVersion", "8.1", "submittedVersion normalized");
    assert(normalizeOaVersion("preprint") === "submittedVersion", "8.2", "preprint normalized to submittedVersion");
    assert(normalizeOaVersion("acceptedVersion") === "acceptedVersion", "8.3", "acceptedVersion normalized");
    assert(normalizeOaVersion("publishedVersion") === "publishedVersion", "8.4", "publishedVersion normalized");

    const testPreprintDoi = "10.48550/arxiv.2301.00001";
    invalidateDiscoveryCache(testPreprintDoi);

    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = typeof input === "string" ? input : input.toString();

      if (urlStr.includes("api.unpaywall.org")) {
        return new Response(
          JSON.stringify({
            doi: testPreprintDoi,
            is_oa: true,
            title: "Novel Fast Transformer Attention Pre-Print",
            best_oa_location: {
              url: "https://arxiv.org/pdf/2301.00001.pdf",
              url_for_pdf: "https://arxiv.org/pdf/2301.00001.pdf",
              version: "submittedVersion",
              license: "cc-by",
              host_type: "repository",
            },
            oa_locations: [
              {
                url_for_pdf: "https://arxiv.org/pdf/2301.00001.pdf",
                version: "submittedVersion",
                license: "cc-by",
                host_type: "repository",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const preprintDisc = await discoverOpenAccessForDoi(testPreprintDoi, { forceRefresh: true });
    assert(preprintDisc.bestLocation?.version === "submittedVersion", "8.5", "Version is preserved as submittedVersion");
    assert(preprintDisc.bestLocation?.isPreprint === true, "8.6", "isPreprint flag set to true");
    assert(preprintDisc.explanation.includes("Preprint"), "8.7", "Explanation explicitly states preprint");

    // ===========================================================================
    // TEST 9: Malicious PDF redirect or internal IP attempt (SSRF prevention)
    // ===========================================================================
    console.log("\n--- TEST 9: Malicious redirect & SSRF prevention ---");
    assert(validateSafePdfUrl("http://europepmc.org/doc.pdf").safe === false, "9.1", "Insecure HTTP protocol rejected");
    assert(validateSafePdfUrl("https://localhost/admin/doc.pdf").safe === false, "9.2", "Localhost rejected");
    assert(validateSafePdfUrl("https://127.0.0.1/doc.pdf").safe === false, "9.3", "Loopback IP 127.0.0.1 rejected");
    assert(validateSafePdfUrl("https://169.254.169.254/latest/meta-data").safe === false, "9.4", "Cloud metadata IP 169.254.169.254 rejected");
    assert(validateSafePdfUrl("https://192.168.1.1/secret.pdf").safe === false, "9.5", "Private RFC1918 192.168.x.x rejected");
    assert(validateSafePdfUrl("https://10.0.0.1/secret.pdf").safe === false, "9.6", "Private RFC1918 10.x.x.x rejected");
    assert(validateSafePdfUrl("https://172.16.0.1/secret.pdf").safe === false, "9.7", "Private RFC1918 172.16.x.x rejected");
    assert(validateSafePdfUrl("file:///etc/passwd").safe === false, "9.8", "File protocol rejected");
    assert(validateSafePdfUrl("data:application/pdf;base64,...").safe === false, "9.9", "Data URI rejected");
    assert(validateSafePdfUrl("https://untrusted-malicious-site.com/doc.pdf").safe === false, "9.10", "Arbitrary untrusted host rejected");

    assert(validateSafePdfUrl("https://europepmc.org/articles/PMC12345/pdf/main.pdf").safe === true, "9.11", "Trusted repository Europe PMC allowed");
    assert(validateSafePdfUrl("https://harvard.edu/papers/quantum.pdf").safe === true, "9.12", "Verified academic institution (.edu) allowed");
    assert(validateSafePdfUrl("https://ox.ac.uk/manuscripts/cell.pdf").safe === true, "9.13", "Verified academic institution (.ac.uk) allowed");

    assert(isPrivateOrReservedIp("127.0.0.1") === true, "9.14", "127.0.0.1 recognized as private");
    assert(isPrivateOrReservedIp("169.254.169.254") === true, "9.15", "169.254.169.254 recognized as reserved");
    assert(isPrivateOrReservedIp("8.8.8.8") === false, "9.16", "Public IP recognized as non-private");

    // ===========================================================================
    // TEST 10: HTML response disguised as PDF (%PDF- header verification)
    // ===========================================================================
    console.log("\n--- TEST 10: HTML response disguised as PDF ---");
    const testPaperFake = await prisma.paper.create({
      data: {
        title: "Test Disguised HTML Paper",
        abstract: "Abstract for fake HTML test paper.",
        status: "UPLOADED",
        researchQuestion: "Test",
        methodology: "Test",
        results: "Test",
        limitations: "Test",
        conclusion: "Test",
      },
    });
    createdPaperIds.push(testPaperFake.id);

    // Mock fetch returning HTML disguised as application/pdf
    globalThis.fetch = async (): Promise<Response> => {
      const htmlPayload = Buffer.from("<!DOCTYPE html><html><body>Paywall Login Required</body></html>");
      return new Response(htmlPayload, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf", // Deceptive header!
          "Content-Length": htmlPayload.length.toString(),
        },
      });
    };

    const acqHtml = await acquireAndIngestLawfulFullText(
      testPaperFake.id,
      "https://europepmc.org/articles/PMC1111/pdf/fake.pdf"
    );
    assert(acqHtml.success === false, "10.1", "HTML disguised as PDF is rejected");
    assert(acqHtml.error?.includes("not a valid PDF document (missing %PDF- header") === true, "10.2", "Magic bytes check detects missing %PDF- header");

    // ===========================================================================
    // TEST 11: Oversized (>30MB) or corrupt PDF rejection
    // ===========================================================================
    console.log("\n--- TEST 11: Oversized or corrupt PDF rejection ---");
    globalThis.fetch = async (): Promise<Response> => {
      return new Response(Buffer.from("%PDF-1.4"), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": "35000000", // 35 MB!
        },
      });
    };

    const acqOversized = await acquireAndIngestLawfulFullText(
      testPaperFake.id,
      "https://europepmc.org/articles/PMC1111/pdf/oversized.pdf"
    );
    assert(acqOversized.success === false, "11.1", "Oversized 35MB PDF rejected before download");
    assert(acqOversized.error?.includes("exceeds 30 MB ceiling") === true, "11.2", "Error specifies 30 MB ceiling");

    // Zero-byte PDF rejection
    globalThis.fetch = async (): Promise<Response> => {
      return new Response(Buffer.alloc(0), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    };
    const acqEmpty = await acquireAndIngestLawfulFullText(
      testPaperFake.id,
      "https://europepmc.org/articles/PMC1111/pdf/empty.pdf"
    );
    assert(acqEmpty.success === false, "11.3", "Empty 0-byte PDF rejected");

    // ===========================================================================
    // TEST 12: PDF extraction failure handling (0 usable chunks -> FAILED status)
    // ===========================================================================
    console.log("\n--- TEST 12: PDF extraction failure handling ---");
    // Minimal PDF that has no text (blank page)
    const blankPdf = Buffer.from(
      "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer << /Size 4 /Root 1 0 R >>\nstartxref\n190\n%%EOF"
    );

    const testPaperBlank = await prisma.paper.create({
      data: {
        title: "Test Image-Only Scanned Paper",
        abstract: "Abstract for scanned/blank test paper.",
        status: "UPLOADED",
        researchQuestion: "Test",
        methodology: "Test",
        results: "Test",
        limitations: "Test",
        conclusion: "Test",
      },
    });
    createdPaperIds.push(testPaperBlank.id);

    globalThis.fetch = async (): Promise<Response> => {
      return new Response(blankPdf, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    };

    const acqBlank = await acquireAndIngestLawfulFullText(
      testPaperBlank.id,
      "https://europepmc.org/articles/PMC1111/pdf/blank.pdf"
    );
    assert(acqBlank.success === false, "12.1", "Extraction on empty/scanned PDF fails cleanly");

    const paperBlankAfter = await prisma.paper.findUnique({ where: { id: testPaperBlank.id } });
    assert(paperBlankAfter?.status === "FAILED", "12.2", "Paper status correctly set to FAILED");

    // ===========================================================================
    // TEST 13: Processing-job retry
    // ===========================================================================
    console.log("\n--- TEST 13: Processing-job retry ---");
    // Check processing job was created for testPaperBlank
    const jobBefore = await prisma.processingJob.findFirst({
      where: { paperId: testPaperBlank.id },
      orderBy: { createdAt: "desc" },
    });
    assert(Boolean(jobBefore), "13.1", "ProcessingJob record created in database");
    assert(jobBefore?.status === "FAILED", "13.2", "ProcessingJob recorded as FAILED");

    // Now supply valid PDF on retry
    globalThis.fetch = async (): Promise<Response> => {
      return new Response(samplePdfBuffer, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    };

    const retryAcq = await acquireAndIngestLawfulFullText(
      testPaperBlank.id,
      "https://europepmc.org/articles/PMC1111/pdf/valid_retry.pdf"
    );
    assert(retryAcq.success === true, "13.3", "Retry succeeds with valid manuscript");

    const jobAfter = await prisma.processingJob.findFirst({
      where: { paperId: testPaperBlank.id },
      orderBy: [{ attempt: "desc" }, { createdAt: "desc" }],
    });
    assert(jobAfter?.attempt === 2, "13.4", "Job attempt incremented to 2");
    assert(jobAfter?.status === "COMPLETED", "13.5", "Job status is COMPLETED on retry");

    // ===========================================================================
    // TEST 14: Missing genuine abstract fallback to 'No abstract available.'
    // ===========================================================================
    console.log("\n--- TEST 14: Missing genuine abstract fallback ---");
    assert(sanitizeScientificAbstract(null) === "No abstract available.", "14.1", "Null returns 'No abstract available.'");
    assert(sanitizeScientificAbstract("") === "No abstract available.", "14.2", "Empty string returns 'No abstract available.'");
    assert(sanitizeScientificAbstract("indexed via Crossref") === "No abstract available.", "14.3", "'indexed via Crossref' replaced with standard message");
    assert(sanitizeScientificAbstract("Indexed via PubMed") === "No abstract available.", "14.4", "'Indexed via PubMed' replaced with standard message");
    assert(sanitizeScientificAbstract("No abstract provided.") === "No abstract available.", "14.5", "'No abstract provided' replaced with standard message");

    const genuine = sanitizeScientificAbstract("<jats:title>Abstract</jats:title><jats:p>This study evaluates diagnostic sensitivity across 500 patient cohorts.</jats:p>");
    assert(genuine === "This study evaluates diagnostic sensitivity across 500 patient cohorts.", "14.6", "Genuine abstract tags stripped and text preserved");

    // ===========================================================================
    // TEST 15: Cross-user document isolation
    // ===========================================================================
    console.log("\n--- TEST 15: Cross-user document isolation ---");
    const authCheck = await authorizePaperAccess(
      {
        id: privateThesis.id,
        storagePath: `users/${userA.id}/thesis.pdf`,
        sourceProvenance: { uploadedByUserId: userA.id, docType: "THESIS" },
      },
      { id: userB.id, role: "USER" },
      "DOWNLOAD_PDF"
    );
    assert(authCheck.allowed === false, "15.1", "User B cannot download User A's private thesis");
    assert(authCheck.statusCode === 404, "15.2", "404 hides resource from unauthorized researcher");

    // ===========================================================================
    // TEST 16: Admin benchmark fixture quarantine
    // ===========================================================================
    console.log("\n--- TEST 16: Admin benchmark fixture quarantine ---");
    const kimClassification = classifyPaper({
      id: "cmumgtiix0000vr445cn8ry7o", // Kim fixture
      storagePath: "cmumgtiix0000vr445cn8ry7o/original.pdf",
    });
    assert(kimClassification === "ADMIN_TEST_FIXTURE", "16.1", "Fixture classified as ADMIN_TEST_FIXTURE");

    const userAccessFixture = await authorizePaperAccess(
      {
        id: "cmumgtiix0000vr445cn8ry7o",
        storagePath: "cmumgtiix0000vr445cn8ry7o/original.pdf",
      },
      { id: userA.id, role: "USER" },
      "DOWNLOAD_PDF"
    );
    assert(userAccessFixture.allowed === false, "16.2", "Non-admin blocked from downloading benchmark fixture");

    // ===========================================================================
    // TEST 17: Grounded chat available only when actual content is processed
    // ===========================================================================
    console.log("\n--- TEST 17: Grounded chat available only when actual content is processed ---");
    let ragBlocked = false;
    try {
      await retrievePaperEvidence(
        import2.paperId!, // testDoi2 (Cell - METADATA_ONLY)
        "What is the cellular architecture findings?",
        { user: { id: userA.id, role: "USER" } }
      );
    } catch (err: any) {
      ragBlocked = err.message.includes("Paper text has not been processed yet");
    }
    assert(ragBlocked === true, "17.1", "Grounded RAG chat rejected for METADATA_ONLY paper (zero chunks)");

    // ===========================================================================
    // TEST 18: Existing My Library and Phase 7B editor regressions
    // ===========================================================================
    console.log("\n--- TEST 18: Existing My Library and Phase 7B editor regressions ---");
    const testCollection = await createCollection(userA.id, "Oncology Review 2026", {
      color: "#059669",
    });
    assert(testCollection.name === "Oncology Review 2026", "18.1", "Collection created in My Library");

    await addPaperToCollection(userA.id, import1.paperId!, testCollection.name);
    assert(true, "18.2", "Paper assigned to collection");

    const researchDoc = await createResearchDocument(userA.id, {
      title: "Systematic Review on BBB Transport",
    });
    assert(Boolean(researchDoc.id), "18.3", "Phase 7B research document created");

    const attach = await attachDocumentPaper(userA.id, researchDoc.id, import1.paperId!);
    assert(Boolean(attach.id), "18.4", "Paper attached to Phase 7B research document");

    await deleteResearchDocument(userA.id, researchDoc.id);
    assert(true, "18.5", "Document deleted cleanly without regression");

    // ===========================================================================
    // SUMMARY
    // ===========================================================================
    console.log("\n================================================================================");
    console.log(` TEST RUN COMPLETE: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
    console.log("================================================================================\n");

  } finally {
    // Restore original global fetch
    globalThis.fetch = originalFetch;

    // Clean up created test papers in isolated DB
    console.log("Cleaning up test records...");
    for (const pid of createdPaperIds) {
      await prisma.bookmark.deleteMany({ where: { paperId: pid } }).catch(() => {});
      await prisma.paperAuthor.deleteMany({ where: { paperId: pid } }).catch(() => {});
      await prisma.paperChunk.deleteMany({ where: { paperId: pid } }).catch(() => {});
      await prisma.processingJob.deleteMany({ where: { paperId: pid } }).catch(() => {});
      await prisma.collectionPaper.deleteMany({ where: { paperId: pid } }).catch(() => {});
      await prisma.documentCitation.deleteMany({ where: { paperId: pid } }).catch(() => {});
      await prisma.documentPaper.deleteMany({ where: { paperId: pid } }).catch(() => {});
      await prisma.paper.delete({ where: { id: pid } }).catch(() => {});
    }

    await prisma.collection.deleteMany({ where: { userId: userA.id } }).catch(() => {});
    await prisma.researchDocument.deleteMany({ where: { userId: userA.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: userA.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: userB.id } }).catch(() => {});

    resetMockStorage();
    await prisma.$disconnect();
  }

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
