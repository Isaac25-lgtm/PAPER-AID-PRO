/**
 * AI RESEARCH HUB — PHASE 4B: ACCESS-CONTROL HARDENING TEST SUITE
 * 
 * Verifies and proves complete access isolation and defense-in-depth:
 * 1. Anonymous PDF download attempts are strictly rejected with HTTP 401 & private cache headers.
 * 2. Cross-tenant isolation: User A cannot access User B's private paper (HTTP 404 / denied).
 * 3. Administrator test fixtures (Kim, Su, Zakareya, PointPillars, etc.) are hidden from non-admins (HTTP 404).
 * 4. Administrator role retains full operational and benchmarking access to fixtures (HTTP 200).
 * 5. Guessed paper IDs fail safely with resource not found.
 * 6. RAG evidence retrieval and QA orchestrator enforce paper-level authorization before querying chunks or calling OpenAI.
 * 7. Scientific table evidence queries enforce authorization before returning measurements.
 * 8. Bookmarking cannot be used to save or bookmark admin test fixtures.
 * 9. Discovery and hybrid search exclude admin test fixtures from non-admin visibility.
 * 10. Direct storage URLs are never exposed through PDF utilities or redirects.
 * 11. Public scholarly metadata remains accessible for open-access discovery and authorized AI reasoning.
 */

import "../scratch/load-env";

// Dynamic session store for testing authentication states
let currentMockSession: { user: { id: string; role: string; email?: string } } | null = null;
const nextAuthNext = require("next-auth/next");
nextAuthNext.getServerSession = async () => currentMockSession;

function setMockSession(session: { user: { id: string; role: string; email?: string } } | null) {
  currentMockSession = session;
}

import { prisma } from "../src/lib/prisma";
import {
  classifyPaper,
  authorizePaperAccess,
  ADMIN_TEST_FIXTURE_IDS,
  MinimalPaperRecord,
  UserContext,
} from "../src/lib/auth/paper-authorization";
import { GET as pdfRouteHandler } from "../src/app/api/papers/[id]/pdf/route";
import { retrievePaperEvidence } from "../src/lib/rag/retrieve-paper-evidence";
import { askPaperQuestion } from "../src/lib/rag/qa-orchestrator";
import { PrismaTableRepository } from "../src/lib/tables/prisma-table-repository";
import { TableEvidenceOrchestrator } from "../src/lib/tables/table-orchestrator";
import { toggleBookmarkAction } from "../src/app/papers/bookmark-actions";
import { searchPapersHybrid } from "../src/lib/search/hybrid-search";
import { getPaperPdfUrl, setStorageClientOverride } from "../src/lib/storage";

async function runSecurityTestSuite() {
  console.log("================================================================================");
  console.log(" AI RESEARCH HUB — PHASE 4B ACCESS-CONTROL HARDENING VERIFICATION");
  console.log("================================================================================\n");

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testId: string, description: string) {
    total++;
    if (condition) {
      console.log(`[PASS] ${testId}: ${description}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testId}: ${description}`);
      throw new Error(`Assertion failed for ${testId}: ${description}`);
    }
  }

  // Known test fixture and canonical public papers from database
  const FIXTURE_ID = "cmumgtiix0000vr445cn8ry7o"; // Kim et al. (BUSI) - Administrator fixture
  const POINTPILLARS_ID = "cmuwcfyqc006ovrss8qyhxa1u"; // PointPillars - Administrator fixture
  const PUBLIC_PAPER_ID = "cmuwoj877000cvr288df6z92u"; // Attention Is All You Need - Public scholarly paper
  const GUESSED_PAPER_ID = "non-existent-paper-id-99999xyz";
  const PRIV_TEST_ID = "test-phase4b-userb-priv-doc";

  // Test identities
  const userA: UserContext = { id: "user-a-uuid-111", role: "USER" };
  const userB: UserContext = { id: "user-b-uuid-222", role: "USER" };
  const adminUser: UserContext = { id: "admin-uuid-000", role: "ADMIN" };

  try {
    // Setup isolated test private document belonging to User B
    await prisma.paper.upsert({
      where: { id: PRIV_TEST_ID },
      create: {
        id: PRIV_TEST_ID,
        title: "User B Confidential Laboratory Notes",
        abstract: "Proprietary research findings.",
        storagePath: `users/${userB.id}/lab_notes.pdf`,
        sourceProvenance: {
          uploadedByUserId: userB.id,
          isPrivate: true,
        },
      },
      update: {
        sourceProvenance: {
          uploadedByUserId: userB.id,
          isPrivate: true,
        },
      },
    });

    await prisma.user.upsert({
      where: { id: userA.id },
      create: {
        id: userA.id,
        email: "test-user-a-phase4b@university.test",
        passwordHash: "test_hash",
        role: "USER",
      },
      update: {},
    });

    await prisma.paper.upsert({
      where: { id: FIXTURE_ID },
      create: {
        id: FIXTURE_ID,
        title: "Kim et al. (BUSI) - Administrator Fixture",
        abstract: "Breast ultrasound benchmark dataset.",
        storagePath: `${FIXTURE_ID}/original.pdf`,
        sourceProvenance: {
          isSystemFixture: true,
        },
      },
      update: {
        storagePath: `${FIXTURE_ID}/original.pdf`,
        sourceProvenance: {
          isSystemFixture: true,
        },
      },
    });

    await prisma.paper.upsert({
      where: { id: POINTPILLARS_ID },
      create: {
        id: POINTPILLARS_ID,
        title: "PointPillars - Administrator Fixture",
        abstract: "PointPillars fast 3D object detection.",
        storagePath: `${POINTPILLARS_ID}/original.pdf`,
        sourceProvenance: {
          isSystemFixture: true,
        },
      },
      update: {
        storagePath: `${POINTPILLARS_ID}/original.pdf`,
        sourceProvenance: {
          isSystemFixture: true,
        },
      },
    });

    await prisma.paper.upsert({
      where: { id: PUBLIC_PAPER_ID },
      create: {
        id: PUBLIC_PAPER_ID,
        title: "Attention Is All You Need (Public Test)",
        abstract: "Self-attention mechanisms alone suffice for sequence transduction.",
        doi: "10.48550/arxiv.phase4b.test",
        arxivId: "1706.03762",
        isOpenAccess: true,
        pdfUrl: "https://arxiv.org/pdf/1706.03762.pdf",
        sourceProvenance: {
          isLawfulOpenAccess: true,
        },
      },
      update: {
        doi: "10.48550/arxiv.phase4b.test",
        arxivId: "1706.03762",
        isOpenAccess: true,
        pdfUrl: "https://arxiv.org/pdf/1706.03762.pdf",
        sourceProvenance: {
          isLawfulOpenAccess: true,
        },
      },
    });

    // ========================================================================
    // 1. ANONYMOUS PDF DOWNLOAD HARDENING
    // ========================================================================
    console.log("--- TEST GROUP 1: Anonymous PDF Download Hardening ---");

    setMockSession(null);
    const anonReq = new Request(`http://localhost:3000/api/papers/${FIXTURE_ID}/pdf`);
    const anonRes = await pdfRouteHandler(anonReq as any, { params: { id: FIXTURE_ID } });
    
    assert(
      anonRes.status === 401,
      "SEC_01_ANON_PDF_STATUS_401",
      `Anonymous download attempt on fixture returns HTTP 401 Unauthorized (got ${anonRes.status})`
    );

    const cacheHeader = anonRes.headers.get("cache-control") || "";
    assert(
      cacheHeader.includes("no-store") && cacheHeader.includes("private"),
      "SEC_02_ANON_PDF_PRIVATE_CACHE_HEADERS",
      `PDF endpoint response sets strict private no-store cache headers: "${cacheHeader}"`
    );

    const anonBody = await anonRes.json();
    assert(
      anonBody.error?.toLowerCase().includes("authentication required"),
      "SEC_03_ANON_PDF_REASON",
      `Response clearly indicates authentication requirement: "${anonBody.error}"`
    );

    // ========================================================================
    // 2. CROSS-TENANT ISOLATION (USER A vs USER B)
    // ========================================================================
    console.log("\n--- TEST GROUP 2: Cross-Tenant Private Document Isolation ---");

    const userBPaper: MinimalPaperRecord = {
      id: "paper-user-b-priv-001",
      title: "User B Private Research Manuscript",
      storagePath: "users/user-b-uuid-222/manuscript.pdf",
      sourceProvenance: {
        uploadedByUserId: userB.id,
        isPrivate: true,
      },
    };

    const classB = classifyPaper(userBPaper);
    assert(
      classB === "PRIVATE_USER_DOCUMENT",
      "SEC_04_CLASSIFY_PRIVATE_DOC",
      `Paper with uploadedByUserId is classified as PRIVATE_USER_DOCUMENT (got ${classB})`
    );

    // User A attempts to view User B's paper
    const userAAuth = await authorizePaperAccess(userBPaper, userA, "VIEW_METADATA");
    assert(
      !userAAuth.allowed && userAAuth.statusCode === 404,
      "SEC_05_USER_A_CANNOT_VIEW_USER_B",
      `User A access to User B's private paper returns 404 Not Found to prevent enumeration`
    );

    // Anonymous attempts to view User B's paper
    const anonAuthB = await authorizePaperAccess(userBPaper, null, "VIEW_METADATA");
    assert(
      !anonAuthB.allowed && anonAuthB.statusCode === 401,
      "SEC_06_ANON_CANNOT_VIEW_USER_B",
      `Anonymous access to private document returns 401 Unauthorized`
    );

    // User B accesses their own paper
    const userBAuth = await authorizePaperAccess(userBPaper, userB, "DOWNLOAD_PDF");
    assert(
      userBAuth.allowed && userBAuth.statusCode === 200,
      "SEC_07_USER_B_CAN_ACCESS_OWN_DOC",
      `User B successfully accesses their own private document with HTTP 200`
    );

    // Admin accesses user document for system operations
    const adminUserBAuth = await authorizePaperAccess(userBPaper, adminUser, "VIEW_METADATA");
    assert(
      adminUserBAuth.allowed && adminUserBAuth.statusCode === 200,
      "SEC_08_ADMIN_MAINTENANCE_ACCESS",
      `Administrator retains operational maintenance access to records`
    );

    // ========================================================================
    // 3. ADMINISTRATOR TEST FIXTURE ISOLATION
    // ========================================================================
    console.log("\n--- TEST GROUP 3: Administrator Fixture Access Isolation ---");

    const fixtureRecord = await prisma.paper.findUnique({
      where: { id: FIXTURE_ID },
      select: {
        id: true,
        title: true,
        storagePath: true,
        pdfUrl: true,
        sourceProvenance: true,
        doi: true,
      },
    });

    assert(
      fixtureRecord !== null,
      "SEC_09_FIXTURE_EXISTS_IN_DB",
      `Target fixture "${FIXTURE_ID}" loaded from database`
    );

    const fixtureClassification = classifyPaper(fixtureRecord!);
    assert(
      fixtureClassification === "ADMIN_TEST_FIXTURE",
      "SEC_10_FIXTURE_CLASSIFICATION",
      `Database fixture correctly classified as ADMIN_TEST_FIXTURE (got ${fixtureClassification})`
    );

    // Non-admin researcher attempts to access fixture via authorization engine
    const nonAdminFixtureAuth = await authorizePaperAccess(fixtureRecord!, userA, "DOWNLOAD_PDF");
    assert(
      !nonAdminFixtureAuth.allowed && nonAdminFixtureAuth.statusCode === 404,
      "SEC_11_NON_ADMIN_FIXTURE_DENIED_404",
      `Non-admin access to fixture is denied with HTTP 404 (hiding resource existence)`
    );

    // Non-admin researcher calls PDF endpoint on fixture
    setMockSession({ user: { id: userA.id, role: userA.role } });
    const userAPdfReq = new Request(`http://localhost:3000/api/papers/${FIXTURE_ID}/pdf`);
    const userAPdfRes = await pdfRouteHandler(userAPdfReq as any, { params: { id: FIXTURE_ID } });
    assert(
      userAPdfRes.status === 404,
      "SEC_12_ENDPOINT_NON_ADMIN_FIXTURE_404",
      `PDF endpoint returns 404 for non-admin requesting administrator fixture`
    );

    // Admin user calls PDF endpoint on fixture (uses storage override for deterministic test isolation)
    setMockSession({ user: { id: adminUser.id, role: adminUser.role } });
    setStorageClientOverride({
      storage: {
        from: () => ({
          download: async () => ({
            data: { arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer },
            error: null,
          }),
        }),
      },
    });
    const adminPdfReq = new Request(`http://localhost:3000/api/papers/${FIXTURE_ID}/pdf`);
    const adminPdfRes = await pdfRouteHandler(adminPdfReq as any, { params: { id: FIXTURE_ID } });
    setStorageClientOverride(null);
    // Admin request proceeds past authorization (either 200 streaming or 307 redirect)
    assert(
      adminPdfRes.status === 200 || adminPdfRes.status === 307,
      "SEC_13_ADMIN_FIXTURE_DOWNLOAD_ALLOWED",
      `Admin request to fixture is permitted (status: ${adminPdfRes.status})`
    );

    // ========================================================================
    // 4. RAG AND EVIDENCE RETRIEVAL DEFENSE-IN-DEPTH
    // ========================================================================
    console.log("\n--- TEST GROUP 4: RAG & Scientific Evidence Retrieval Hardening ---");

    // 4A: Guessed paper ID retrieval fails safely
    let guessedIdThrew = false;
    try {
      await retrievePaperEvidence(GUESSED_PAPER_ID, "What are the numerical findings?", {
        user: userA,
      });
    } catch (err: any) {
      guessedIdThrew = true;
      assert(
        err.message.includes("not found"),
        "SEC_14_RAG_GUESSED_ID_NOT_FOUND",
        `RAG evidence query on guessed ID safely throws: "${err.message}"`
      );
    }
    assert(guessedIdThrew, "SEC_14B_RAG_GUESSED_THROWS", "Guessed ID query threw as expected");

    // 4B: Non-admin querying chunks on admin fixture throws Unauthorized
    let nonAdminEvidenceThrew = false;
    try {
      await retrievePaperEvidence(FIXTURE_ID, "Explain the tumor segmentation results", {
        user: userA,
      });
    } catch (err: any) {
      nonAdminEvidenceThrew = true;
      assert(
        err.message.includes("Unauthorized") || err.message.includes("restricted"),
        "SEC_15_RAG_FIXTURE_UNAUTHORIZED",
        `RAG evidence query on fixture by non-admin throws Unauthorized: "${err.message}"`
      );
    }
    assert(nonAdminEvidenceThrew, "SEC_15B_RAG_FIXTURE_THROWS", "Non-admin chunk query on fixture threw");

    // 4C: Anonymous querying chunks on admin fixture throws Unauthorized
    let anonEvidenceThrew = false;
    try {
      await retrievePaperEvidence(FIXTURE_ID, "Explain the results", {
        user: null,
      });
    } catch (err: any) {
      anonEvidenceThrew = true;
      assert(
        err.message.includes("Unauthorized"),
        "SEC_16_ANON_EVIDENCE_UNAUTHORIZED",
        `Anonymous RAG chunk query on fixture throws Unauthorized`
      );
    }
    assert(anonEvidenceThrew, "SEC_16B_ANON_THROWS", "Anonymous chunk query threw");

    // 4D: QA Orchestrator blocks unauthorized paper query before calling OpenAI
    let qaNonAdminThrew = false;
    try {
      await askPaperQuestion({
        paperId: FIXTURE_ID,
        question: "What is the primary contribution?",
        userId: userA.id, // Real DB user with role USER
      });
    } catch (err: any) {
      qaNonAdminThrew = true;
      assert(
        err.message.includes("Unauthorized") || err.message.includes("permission"),
        "SEC_17_QA_ORCHESTRATOR_BLOCKED",
        `QA Orchestrator blocks non-admin query on fixture before LLM inference: "${err.message}"`
      );
    }
    assert(qaNonAdminThrew, "SEC_17B_QA_THROWS", "QA Orchestrator rejected non-admin query");

    // 4E: Absent user context on administrator fixture fails closed (throws Unauthorized)
    let absentUserFixtureThrew = false;
    try {
      await retrievePaperEvidence(FIXTURE_ID, "Explain the results", {});
    } catch (err: any) {
      absentUserFixtureThrew = true;
      assert(
        err.message.includes("Unauthorized"),
        "SEC_17C_RAG_ABSENT_USER_ON_FIXTURE_BLOCKED",
        `RAG evidence query with absent user on fixture fails closed: "${err.message}"`
      );
    }
    assert(absentUserFixtureThrew, "SEC_17C_ABSENT_USER_THROWS", "Absent user query on fixture threw");

    // 4F: Absent user context on private document fails closed (throws Unauthorized)
    let absentUserPrivateThrew = false;
    try {
      await retrievePaperEvidence(PRIV_TEST_ID, "Explain findings", {});
    } catch (err: any) {
      absentUserPrivateThrew = true;
      assert(
        err.message.includes("Unauthorized"),
        "SEC_17D_RAG_ABSENT_USER_ON_PRIVATE_BLOCKED",
        `RAG evidence query with absent user on private document fails closed: "${err.message}"`
      );
    }
    assert(absentUserPrivateThrew, "SEC_17D_ABSENT_USER_PRIVATE_THROWS", "Absent user query on private doc threw");

    // 4G: Cross-user retrieval on private document fails closed (User A on User B doc)
    let crossUserPrivateThrew = false;
    try {
      await retrievePaperEvidence(PRIV_TEST_ID, "Explain findings", { user: userA });
    } catch (err: any) {
      crossUserPrivateThrew = true;
      assert(
        err.message.includes("Unauthorized"),
        "SEC_17E_RAG_CROSS_USER_ON_PRIVATE_BLOCKED",
        `Cross-user RAG chunk query (User A on User B) throws Unauthorized: "${err.message}"`
      );
    }
    assert(crossUserPrivateThrew, "SEC_17E_CROSS_USER_THROWS", "Cross-user query threw");

    // ========================================================================
    // 5. SCIENTIFIC TABLE EVIDENCE HARDENING
    // ========================================================================
    console.log("\n--- TEST GROUP 5: Scientific Table Evidence Authorization ---");

    const tableRepo = new PrismaTableRepository(prisma);
    const tableOrch = new TableEvidenceOrchestrator(tableRepo);

    // Non-admin querying PointPillars table measurements is rejected
    let nonAdminTableThrew = false;
    try {
      await tableOrch.getActiveVerifiedNumericalMeasurements(POINTPILLARS_ID, userA);
    } catch (err: any) {
      nonAdminTableThrew = true;
      assert(
        err.message.includes("Unauthorized") || err.message.includes("restricted"),
        "SEC_18_TABLE_EVIDENCE_NON_ADMIN_BLOCKED",
        `Table evidence retrieval on fixture by non-admin is rejected: "${err.message}"`
      );
    }
    assert(nonAdminTableThrew, "SEC_18B_TABLE_THROWS", "Table evidence query threw for non-admin");

    // Admin querying PointPillars table measurements passes authorization
    let adminTablePassed = false;
    try {
      const results = await tableOrch.getActiveVerifiedNumericalMeasurements(POINTPILLARS_ID, adminUser);
      adminTablePassed = true;
      assert(
        Array.isArray(results),
        "SEC_19_TABLE_EVIDENCE_ADMIN_PERMITTED",
        `Admin access to table measurements succeeds (returned ${results.length} cells)`
      );
    } catch (err: any) {
      console.error("Admin table error:", err);
    }
    assert(adminTablePassed, "SEC_19B_ADMIN_TABLE_PASSED", "Admin table query succeeded");

    // 5C: Absent user context on table measurements fails closed (throws Unauthorized)
    let absentUserTableThrew = false;
    try {
      await tableOrch.getActiveVerifiedNumericalMeasurements(POINTPILLARS_ID);
    } catch (err: any) {
      absentUserTableThrew = true;
      assert(
        err.message.includes("Unauthorized") || err.message.includes("restricted"),
        "SEC_19C_TABLE_ABSENT_USER_BLOCKED",
        `Table measurements query with absent user context fails closed: "${err.message}"`
      );
    }
    assert(absentUserTableThrew, "SEC_19C_ABSENT_USER_TABLE_THROWS", "Absent user table query threw");

    // 5D: Absent user context on private paper table measurements fails closed (throws Unauthorized)
    let absentUserPrivateTableThrew = false;
    try {
      await tableOrch.getActiveVerifiedNumericalMeasurements(PRIV_TEST_ID);
    } catch (err: any) {
      absentUserPrivateTableThrew = true;
      assert(
        err.message.includes("Unauthorized") || err.message.includes("restricted"),
        "SEC_19D_TABLE_ABSENT_USER_PRIVATE_BLOCKED",
        `Table measurements query on private doc with absent user fails closed: "${err.message}"`
      );
    }
    assert(absentUserPrivateTableThrew, "SEC_19D_ABSENT_PRIVATE_TABLE_THROWS", "Absent user private table query threw");

    // 5E: Cross-user table measurements query on private paper fails closed (User A on User B)
    let crossUserPrivateTableThrew = false;
    try {
      await tableOrch.getActiveVerifiedNumericalMeasurements(PRIV_TEST_ID, userA);
    } catch (err: any) {
      crossUserPrivateTableThrew = true;
      assert(
        err.message.includes("Unauthorized") || err.message.includes("restricted"),
        "SEC_19E_TABLE_CROSS_USER_PRIVATE_BLOCKED",
        `Cross-user table measurements query (User A on User B) fails closed: "${err.message}"`
      );
    }
    assert(crossUserPrivateTableThrew, "SEC_19E_CROSS_PRIVATE_TABLE_THROWS", "Cross-user private table query threw");

    // 5F: tableRepo.getActiveVerifiedEvidence fails closed with absent user
    let repoAbsentThrew = false;
    try {
      await tableRepo.getActiveVerifiedEvidence({ paperId: PRIV_TEST_ID });
    } catch (err: any) {
      repoAbsentThrew = true;
      assert(
        err.message.includes("Unauthorized") || err.message.includes("restricted"),
        "SEC_19F_TABLE_REPO_ABSENT_USER_BLOCKED",
        `Repository getActiveVerifiedEvidence with absent user fails closed: "${err.message}"`
      );
    }
    assert(repoAbsentThrew, "SEC_19F_REPO_ABSENT_THROWS", "Repository query without user threw");

    // 5G: tableRepo.getActiveVerifiedEvidence fails closed with cross-user attempt
    let repoCrossThrew = false;
    try {
      await tableRepo.getActiveVerifiedEvidence({ paperId: PRIV_TEST_ID, user: userA });
    } catch (err: any) {
      repoCrossThrew = true;
      assert(
        err.message.includes("Unauthorized") || err.message.includes("restricted"),
        "SEC_19G_TABLE_REPO_CROSS_USER_BLOCKED",
        `Repository getActiveVerifiedEvidence with cross-user attempt fails closed: "${err.message}"`
      );
    }
    assert(repoCrossThrew, "SEC_19G_REPO_CROSS_THROWS", "Repository cross-user query threw");

    // 5H: Chat with PDF - Signed-in user chatting with their own uploaded PDF (User B on User B doc)
    const privDoc = await prisma.paper.findUnique({ where: { id: PRIV_TEST_ID } });
    const userBOwnAuth = await authorizePaperAccess(privDoc!, userB, "INTERACT_AI");
    assert(
      userBOwnAuth.allowed && userBOwnAuth.statusCode === 200,
      "SEC_19H_CHAT_PDF_OWNER_PERMITTED",
      `Signed-in user can automatically chat with their own uploaded PDF without admin approval`
    );

    // Fetch canonical public paper for testing
    const publicPaperRecord = await prisma.paper.findUnique({
      where: { id: PUBLIC_PAPER_ID },
      select: {
        id: true,
        title: true,
        storagePath: true,
        pdfUrl: true,
        sourceProvenance: true,
        doi: true,
        arxivId: true,
      },
    });

    // 5I: Chat with PDF - Signed-in user chatting with open-access public scholarly paper
    const publicResearcherAuth = await authorizePaperAccess(publicPaperRecord!, userA, "INTERACT_AI");
    assert(
      publicResearcherAuth.allowed && publicResearcherAuth.statusCode === 200,
      "SEC_19I_CHAT_PDF_PUBLIC_RESEARCHER_PERMITTED",
      `Signed-in user can automatically chat with accessible open-access scholarly paper without admin approval`
    );

    // 5J: Chat with PDF - Anonymous visitor chatting with public paper must sign in
    const anonChatAuth = await authorizePaperAccess(publicPaperRecord!, null, "INTERACT_AI");
    assert(
      !anonChatAuth.allowed && anonChatAuth.statusCode === 401,
      "SEC_19J_CHAT_PDF_ANONYMOUS_MUST_SIGN_IN",
      `Anonymous visitor must sign in before using Chat with PDF (returns HTTP 401)`
    );

    // 5K: Chat with PDF - Cross-user attempt to chat with another user's private paper is rejected
    const crossChatAuth = await authorizePaperAccess(privDoc!, userA, "INTERACT_AI");
    assert(
      !crossChatAuth.allowed && crossChatAuth.statusCode === 404,
      "SEC_19K_CHAT_PDF_CROSS_USER_DENIED",
      `Cross-user attempt to chat with another researcher's private paper returns HTTP 404`
    );

    // ========================================================================
    // 6. BOOKMARKING & DIRECT STORAGE BYPASS MITIGATION
    // ========================================================================
    console.log("\n--- TEST GROUP 6: Bookmarking & Storage Bypass Mitigation ---");

    // Non-admin user attempting to bookmark an admin fixture
    setMockSession({ user: { id: userA.id, role: "USER" } });
    const bookmarkRes = await toggleBookmarkAction(FIXTURE_ID);
    assert(
      bookmarkRes.success === false &&
        Boolean(
          bookmarkRes.error?.includes("Paper not found") ||
            bookmarkRes.error?.includes("Unauthorized")
        ),
      "SEC_20_BOOKMARK_FIXTURE_BLOCKED",
      `Bookmarking admin test fixture is blocked: "${bookmarkRes.error}"`
    );

    // Storage PDF URL helper returns protected internal route, NOT public CDN
    const proxyUrl = getPaperPdfUrl(FIXTURE_ID);
    assert(
      proxyUrl === `/api/papers/${FIXTURE_ID}/pdf`,
      "SEC_21_STORAGE_URL_PROTECTED_PROXY",
      `getPaperPdfUrl returns protected endpoint "${proxyUrl}", never raw Supabase CDN`
    );
    assert(
      !proxyUrl.includes("supabase.co") && !proxyUrl.includes("/storage/v1/object/public/"),
      "SEC_22_NO_CDN_LEAK",
      `Public Supabase Storage CDN URL is never exposed by client helper`
    );

    // ========================================================================
    // 7. HYBRID DISCOVERY SEARCH EXCLUSION
    // ========================================================================
    console.log("\n--- TEST GROUP 7: Discovery Search Fixture Quarantine ---");

    const searchResults = await searchPapersHybrid({
      query: "cancer ultrasound segmentation",
      limit: 10,
      excludeFixtures: true,
    });

    const leakedFixtures = searchResults.papers.filter((p) =>
      ADMIN_TEST_FIXTURE_IDS.has(p.paper.id)
    );
    assert(
      leakedFixtures.length === 0,
      "SEC_23_SEARCH_EXCLUDES_FIXTURES",
      `Discovery search excludes all administrator fixtures (${searchResults.papers.length} public papers returned)`
    );

    // ========================================================================
    // 8. PRESERVATION OF PUBLIC SCHOLARLY METADATA ACCESS
    // ========================================================================
    console.log("\n--- TEST GROUP 8: Preservation of Public Scholarly Metadata ---");

    // Re-verify loaded public paper record
    assert(
      publicPaperRecord !== null,
      "SEC_24_PUBLIC_PAPER_EXISTS",
      `Canonical public paper "${PUBLIC_PAPER_ID}" loaded from database`
    );

    const publicClass = classifyPaper(publicPaperRecord!);
    assert(
      publicClass === "PUBLIC_SCHOLARLY_METADATA",
      "SEC_25_PUBLIC_PAPER_CLASSIFICATION",
      `Paper classified as PUBLIC_SCHOLARLY_METADATA (got ${publicClass})`
    );

    // Anonymous visitor can view metadata
    const anonMetaAuth = await authorizePaperAccess(publicPaperRecord!, null, "VIEW_METADATA");
    assert(
      anonMetaAuth.allowed && anonMetaAuth.statusCode === 200,
      "SEC_26_ANON_VIEW_PUBLIC_METADATA",
      `Anonymous visitor is permitted to view public scholarly metadata`
    );

    // Public paper PDF redirect works for legitimate open-access external URL
    setMockSession(null);
    const publicPdfReq = new Request(`http://localhost:3000/api/papers/${PUBLIC_PAPER_ID}/pdf`);
    const publicPdfRes = await pdfRouteHandler(publicPdfReq as any, { params: { id: PUBLIC_PAPER_ID } });
    assert(
      publicPdfRes.status === 307,
      "SEC_27_PUBLIC_PDF_OPEN_ACCESS_REDIRECT",
      `Public paper with external pdfUrl returns HTTP 307 temporary redirect to open-access manuscript`
    );

    const location = publicPdfRes.headers.get("location");
    assert(
      location !== null && location.includes("arxiv.org"),
      "SEC_28_REDIRECT_LOCATION_IS_EXTERNAL",
      `Redirect target is the verified open-access archive: "${location}"`
    );

    // Non-admin attempting to manage/delete public scholarly record is blocked
    const manageAuth = await authorizePaperAccess(publicPaperRecord!, userA, "MANAGE_PAPER");
    assert(
      !manageAuth.allowed && manageAuth.statusCode === 403,
      "SEC_29_NON_ADMIN_CANNOT_MANAGE_PUBLIC_PAPER",
      `Non-admin is forbidden (HTTP 403) from managing or deleting public scholarly literature`
    );

    console.log("\n================================================================================");
    console.log(` SUMMARY: ${passed}/${total} Access-Control Hardening Tests Passed (100.0%)`);
    console.log("================================================================================");
  } catch (err) {
    console.error("Test suite encountered fatal error:", err);
    process.exit(1);
  } finally {
    try {
      await prisma.paper.deleteMany({
        where: { id: PRIV_TEST_ID },
      });
    } catch {
      // ignore cleanup errors
    }
  }
}

runSecurityTestSuite().catch((err) => {
  console.error("Unhandled test suite rejection:", err);
  process.exit(1);
});
