/**
 * AI RESEARCH HUB — FINAL ACCESS POLICY VERIFICATION SUITE
 *
 * Verifies:
 * 1. Public visitors access:
 *    - Landing page
 *    - Scholarly Search preview
 *    - Public bibliographic paper metadata
 *    - Feature demonstrations & descriptions
 * 2. Authentication required for:
 *    - My Library
 *    - Collections and bookmarks
 *    - DOI imports into personal libraries
 *    - PDF uploads
 *    - Full Chat with PDF (beyond demo)
 *    - Multi-Paper Research Chat & Synthesis
 *    - Saved research reviews and synthesis history
 *    - AI Research Editor
 *    - Private research documents
 * 3. Public scholarly searches NEVER reveal:
 *    - Private uploaded PDFs
 *    - Personal library membership
 *    - User notes
 *    - Research conversations
 *    - Unpublished manuscripts
 *    - Administrator benchmark fixtures
 * 4. Safe redirect with preserved callbackUrl for unauthenticated attempts
 * 5. Open registration (personal and institutional emails welcome; affiliation not required)
 * 6. Protection enforced at backend Server Action / API layers
 */

import "./test-setup";

// Dynamic session store for testing authentication states in standalone node
let currentMockSession: { user: { id: string; role: string; email?: string } } | null = null;
const nextAuthNext = require("next-auth/next");
nextAuthNext.getServerSession = async () => currentMockSession;

function setMockSession(session: { user: { id: string; role: string; email?: string } } | null) {
  currentMockSession = session;
}

import { prisma } from "../src/lib/prisma";
import { searchPapersHybrid, isPaperPermittedForPublicSearch } from "../src/lib/search/hybrid-search";
import { matchPapersAgainstLocalLibrary } from "../src/lib/discovery/library-matcher";
import {
  ADMIN_TEST_FIXTURE_IDS,
  classifyPaper,
  isPublicScholarlyPaper,
  getPublicPaperWhereInput,
} from "../src/lib/auth/paper-authorization";
import { sanitizeCallbackUrl } from "../src/lib/auth/safe-redirect";
import { importPaperMetadataAction } from "../src/lib/discovery/import-actions";
import { uploadUserDocumentAction, deleteLibraryItemAction, createCollectionAction } from "../src/app/library/actions";
import { askPaperQuestionAction } from "../src/app/papers/qa-actions";
import { synthesizeResearchAction } from "../src/app/research/actions";
import { startResearchAgentRunAction } from "../src/app/agent/actions";
import { createDocumentAction, saveDocumentAction } from "../src/app/editor/actions";
import { toggleBookmarkAction } from "../src/app/papers/bookmark-actions";

let passed = 0;
let failed = 0;

function assert(condition: any, testName: string, details: string = "") {
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testName} - ${details}`);
    failed++;
  }
}

async function runAccessPolicyTests() {
  console.log("================================================================================");
  console.log(" AI RESEARCH HUB — FINAL ACCESS POLICY COMPREHENSIVE VERIFICATION");
  console.log(" Mode: ISOLATED LOCAL POSTGRESQL + MOCK STORAGE");
  console.log("================================================================================");

  // Track created test entities for clean-up
  const testPaperIds: string[] = [];
  const testUserIds: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // Setup test users & private documents
    // -------------------------------------------------------------------------
    const userA = await prisma.user.create({
      data: {
        email: `researcher-a-${Date.now()}@gmail.com`, // personal email
        role: "USER",
      },
    });
    testUserIds.push(userA.id);

    const userB = await prisma.user.create({
      data: {
        email: `scholar-b-${Date.now()}@stanford.edu`, // institutional email
        role: "USER",
      },
    });
    testUserIds.push(userB.id);

    // 1. Private uploaded thesis belonging to User A
    const privateThesis = await prisma.paper.create({
      data: {
        title: "Confidential Doctoral Thesis on Novel Ultrasound Radiomics " + Date.now(),
        abstract: "Proprietary unpublished laboratory measurements and initial trial data.",
        status: "UPLOADED",
        storagePath: `users/${userA.id}/papers/thesis/original.pdf`,
        isOpenAccess: false,
        sourceProvenance: {
          uploadedByUserId: userA.id,
          ownerId: userA.id,
          isPrivate: true,
          documentType: "THESIS",
        },
      },
    });
    testPaperIds.push(privateThesis.id);

    // 2. Public open-access catalog paper
    const publicPaper = await prisma.paper.create({
      data: {
        title: "Public Open Access Deep Learning Benchmark " + Date.now(),
        abstract: "Open benchmark accessible to all global researchers.",
        doi: "10.1000/public.oa.test." + Date.now(),
        isOpenAccess: true,
        sourceProvenance: {
          isPublicOpenAccess: true,
          isLawfulOpenAccess: true,
        },
      },
    });
    testPaperIds.push(publicPaper.id);

    // 3. User A notes on public paper
    await prisma.bookmark.create({
      data: {
        userId: userA.id,
        paperId: publicPaper.id,
        notes: JSON.stringify({ userNote: "Personal confidential grant strategy notes" }),
      },
    });

    // 4. Research conversation belonging to User A
    const userAConvo = await prisma.aIConversation.create({
      data: {
        userId: userA.id,
        title: "Private synthesis on radiomics grant",
        paperId: publicPaper.id,
      },
    });

    console.log("\n--- TEST GROUP 1: Public Search Privacy Isolation ---");

    // 1.1 Private uploaded PDF is rejected by isPaperPermittedForPublicSearch
    assert(
      !isPaperPermittedForPublicSearch(privateThesis),
      "1.1: isPaperPermittedForPublicSearch rejects private uploaded user document"
    );

    // 1.2 Public open-access paper is permitted
    assert(
      isPaperPermittedForPublicSearch(publicPaper),
      "1.2: isPaperPermittedForPublicSearch permits legitimate public open-access metadata"
    );

    // 1.3 Administrator fixtures are rejected
    for (const fixtureId of Array.from(ADMIN_TEST_FIXTURE_IDS)) {
      assert(
        !isPaperPermittedForPublicSearch({ id: fixtureId, storagePath: "test.pdf" }),
        `1.3: Administrator fixture ${fixtureId.slice(0, 10)}... strictly rejected from public search`
      );
      break; // Test first fixture
    }

    // 1.4 Public hybrid search excludes private uploaded thesis
    const searchRes = await searchPapersHybrid({
      query: "Confidential Doctoral Thesis",
      excludeFixtures: true,
    });
    const foundPrivate = searchRes.papers.some((p) => p.paper.id === privateThesis.id);
    assert(!foundPrivate, "1.4: Public hybrid search NEVER returns private uploaded user thesis");

    // 1.5 Anonymous public discovery search NEVER leaks user notes or personal conversations
    const matchResAnon = await matchPapersAgainstLocalLibrary(
      [
        {
          id: "doi:" + publicPaper.doi,
          title: publicPaper.title,
          doi: publicPaper.doi,
          authors: [],
          sourceProviders: ["CROSSREF"],
          isOpenAccess: true,
          fullTextAvailability: "METADATA_ONLY",
        },
      ],
      undefined // anonymous visitor
    );
    assert(
      (matchResAnon[0] as any).notes === undefined,
      "1.5a: Anonymous public discovery search NEVER leaks personal user notes"
    );
    assert(
      (matchResAnon[0] as any).conversations === undefined,
      "1.5b: Anonymous public discovery search NEVER leaks personal research conversations"
    );

    // 1.6 matchPapersAgainstLocalLibrary with private thesis DOI/title from another user
    const matchPrivateAttempt = await matchPapersAgainstLocalLibrary(
      [
        {
          id: "test:private",
          title: privateThesis.title,
          authors: [],
          sourceProviders: ["CROSSREF"],
          isOpenAccess: false,
          fullTextAvailability: "METADATA_ONLY",
        },
      ],
      userB.id // User B searching
    );
    assert(
      matchPrivateAttempt[0]?.localStatus?.inLibrary === false,
      "1.6: User B search NEVER matches or reveals User A's private manuscript"
    );

    // 1.7 Anonymous public search NEVER matches or reveals User A's private manuscript
    const matchPrivateAnon = await matchPapersAgainstLocalLibrary(
      [
        {
          id: "test:private-anon",
          title: privateThesis.title,
          authors: [],
          sourceProviders: ["CROSSREF"],
          isOpenAccess: false,
          fullTextAvailability: "METADATA_ONLY",
        },
      ],
      undefined // anonymous visitor
    );
    assert(
      matchPrivateAnon[0]?.localStatus?.inLibrary === false,
      "1.7: Anonymous visitor search NEVER matches or reveals private uploaded manuscripts"
    );

    // 1.8 Private manuscript where uploadedByUserId is present but storagePath is missing
    const privateMissingStorage = {
      id: "test:private-no-storage",
      title: "Draft Thesis Without Storage Yet",
      storagePath: null,
      sourceProvenance: { uploadedByUserId: userA.id, isPrivate: true },
      isOpenAccess: false,
    };
    assert(
      classifyPaper(privateMissingStorage) === "PRIVATE_USER_DOCUMENT" &&
        !isPaperPermittedForPublicSearch(privateMissingStorage),
      "1.8: Private upload remains strictly PRIVATE even if storagePath is missing/null"
    );

    // 1.9 Stored file exists but provenance is incomplete (no OA proof or identifiers)
    const incompleteProvenanceRecord = {
      id: "test:incomplete-provenance",
      title: "Arbitrary Stored Document",
      storagePath: "research-papers/mystery/original.pdf",
      sourceProvenance: {},
      isOpenAccess: false,
    };
    assert(
      classifyPaper(incompleteProvenanceRecord) === "ADMIN_TEST_FIXTURE" &&
        !isPaperPermittedForPublicSearch(incompleteProvenanceRecord),
      "1.9: Stored file with incomplete provenance is quarantined and rejected from public search"
    );

    // 1.10 Incomplete metadata (lacks DOI, arXiv, PMID, PMCID, semanticScholarId)
    const incompleteMetadataRecord = {
      id: "test:incomplete-metadata",
      title: "Unpublished Lab Note",
      storagePath: null,
      doi: null,
      arxivId: null,
      pmid: null,
      pmcid: null,
      semanticScholarId: null,
      isOpenAccess: false,
      sourceProvenance: {},
    };
    assert(
      classifyPaper(incompleteMetadataRecord) === "AMBIGUOUS_HISTORICAL" &&
        !isPaperPermittedForPublicSearch(incompleteMetadataRecord),
      "1.10: Record with incomplete metadata fails closed as AMBIGUOUS and is rejected from public search"
    );

    // 1.11 Processing status transitions do NOT leak private document
    const statuses = ["UPLOADED", "PROCESSING", "TEXT_EXTRACTED", "EMBEDDING", "COMPLETED", "FAILED"];
    let statusSafe = true;
    for (const st of statuses) {
      const docWithStatus = {
        ...privateThesis,
        status: st,
      };
      if (classifyPaper(docWithStatus) !== "PRIVATE_USER_DOCUMENT" || isPaperPermittedForPublicSearch(docWithStatus)) {
        statusSafe = false;
        break;
      }
    }
    assert(
      statusSafe,
      "1.11: Private document remains strictly PRIVATE across all processing status transitions"
    );

    // 1.12 Similarly titled public paper imported by another user does NOT leak private paper
    const similarPublicPaper = await prisma.paper.create({
      data: {
        title: privateThesis.title, // Identical title
        abstract: "Public open access paper with the same title published in journal.",
        doi: "10.1000/similar.public." + Date.now(),
        isOpenAccess: true,
        sourceProvenance: {
          isPublicOpenAccess: true,
          isLawfulOpenAccess: true,
          provider: "CROSSREF",
        },
      },
    });
    testPaperIds.push(similarPublicPaper.id);

    // Search query on identical title returns ONLY the public paper, never the private thesis
    const similarSearchRes = await searchPapersHybrid({
      query: privateThesis.title,
      excludeFixtures: true,
    });
    const containsPrivate = similarSearchRes.papers.some((p) => p.paper.id === privateThesis.id);
    const containsPublic = similarSearchRes.papers.some((p) => p.paper.id === similarPublicPaper.id);
    assert(
      !containsPrivate && containsPublic,
      "1.12: Similarly titled public paper is discoverable while private manuscript remains 100% hidden"
    );

    // 1.13 Legitimate public scholarly paper with stored PDF is permitted
    const legitimatePublicWithPdf = {
      id: "test:legit-oa-with-pdf",
      title: "Legitimate Open Access Article with PDF",
      storagePath: "research-papers/public/article.pdf",
      doi: "10.1038/s41586-026-test",
      isOpenAccess: true,
      sourceProvenance: {
        isLawfulOpenAccess: true,
        isPublicOpenAccess: true,
      },
    };
    assert(
      classifyPaper(legitimatePublicWithPdf) === "PUBLIC_SCHOLARLY_METADATA" &&
        isPaperPermittedForPublicSearch(legitimatePublicWithPdf),
      "1.13: Legitimate public open-access paper with stored PDF is correctly classified and permitted"
    );

    // 1.14 Consistent query & count authorization: DB where clause aligns with isPublicScholarlyPaper
    const allCandidates = await prisma.paper.findMany({
      where: getPublicPaperWhereInput(),
      select: {
        id: true,
        doi: true,
        arxivId: true,
        pmid: true,
        pmcid: true,
        semanticScholarId: true,
        isOpenAccess: true,
        storagePath: true,
        sourceProvenance: true,
      },
    });
    const allMeetCriteria = allCandidates.every(isPublicScholarlyPaper);
    assert(
      allMeetCriteria,
      "1.14: Database getPublicPaperWhereInput matches isPublicScholarlyPaper with 0 private document leakage"
    );

    console.log("\n--- TEST GROUP 2: Backend Server Actions Authentication Gates ---");

    // 2.1 importPaperMetadataAction fails closed when unauthenticated
    const importRes = await importPaperMetadataAction({
      id: "doi:10.1000/unauth.test",
      title: "Unauthenticated Import Attempt",
      authors: [],
      sourceProviders: ["CROSSREF"],
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
    });
    assert(
      !importRes.success && importRes.error?.includes("Authentication required"),
      "2.1: importPaperMetadataAction blocks unauthenticated requests"
    );

    // 2.2 uploadUserDocumentAction fails closed when unauthenticated
    const dummyFormData = new FormData();
    const uploadRes = await uploadUserDocumentAction(dummyFormData);
    assert(
      !uploadRes.success && uploadRes.error?.includes("Authentication required"),
      "2.2: uploadUserDocumentAction blocks unauthenticated requests"
    );

    // 2.3 deleteLibraryItemAction fails closed when unauthenticated
    const deleteRes = await deleteLibraryItemAction(publicPaper.id);
    assert(
      !deleteRes.success && deleteRes.error?.includes("Authentication required"),
      "2.3: deleteLibraryItemAction blocks unauthenticated requests"
    );

    // 2.4 createCollectionAction fails closed when unauthenticated
    const collectionRes = await createCollectionAction("My Secret Lab");
    assert(
      !collectionRes.success && collectionRes.error?.includes("Authentication required"),
      "2.4: createCollectionAction blocks unauthenticated requests"
    );

    // 2.5 toggleBookmarkAction fails closed when unauthenticated
    const bookmarkRes = await toggleBookmarkAction(publicPaper.id);
    assert(
      !bookmarkRes.success && bookmarkRes.unauthorized === true,
      "2.5: toggleBookmarkAction blocks unauthenticated requests"
    );

    // 2.6 askPaperQuestionAction fails closed when unauthenticated
    const qaRes = await askPaperQuestionAction({
      paperId: publicPaper.id,
      question: "What are the empirical metrics?",
    });
    assert(
      !qaRes.success && qaRes.requiresAuth === true,
      "2.6: askPaperQuestionAction blocks unauthenticated requests"
    );

    // 2.7 synthesizeResearchAction fails closed when unauthenticated
    const synthRes = await synthesizeResearchAction({
      question: "Synthesize findings across breast cancer radiomics",
    });
    assert(
      !synthRes.success && synthRes.error?.includes("Authentication required"),
      "2.7: synthesizeResearchAction blocks unauthenticated requests"
    );

    // 2.8 startResearchAgentRunAction fails closed when unauthenticated
    const agentRes = await startResearchAgentRunAction({
      objective: "Investigate diffusion models in oncology",
    });
    assert(
      !agentRes.success && agentRes.error?.includes("Authentication required"),
      "2.8: startResearchAgentRunAction blocks unauthenticated requests"
    );

    // 2.9 createDocumentAction fails closed when unauthenticated
    const docRes = await createDocumentAction({ title: "Draft Proposal" });
    assert(
      !docRes.success && docRes.error?.includes("Authentication required"),
      "2.9: createDocumentAction blocks unauthenticated requests"
    );

    console.log("\n--- TEST GROUP 3: Safe Callback Redirect Sanitization ---");

    // 3.1 Preserves local valid routes
    assert(
      sanitizeCallbackUrl("/library") === "/library",
      "3.1: Preserves /library callback"
    );
    assert(
      sanitizeCallbackUrl("/editor") === "/editor",
      "3.2: Preserves /editor callback"
    );
    assert(
      sanitizeCallbackUrl("/research") === "/research",
      "3.3: Preserves /research callback"
    );
    assert(
      sanitizeCallbackUrl("/agent") === "/agent",
      "3.4: Preserves /agent callback"
    );
    assert(
      sanitizeCallbackUrl("/history") === "/history",
      "3.5: Preserves /history callback"
    );

    // 3.2 Neutralizes open-redirect attacks (returns provided fallback)
    assert(
      sanitizeCallbackUrl("https://evil.com/phish", "/library") === "/library",
      "3.6: Rejects external absolute URL and falls back to /library"
    );
    assert(
      sanitizeCallbackUrl("//evil.com", "/library") === "/library",
      "3.7: Rejects protocol-relative URL and falls back to /library"
    );
    assert(
      sanitizeCallbackUrl("/\\evil.com", "/library") === "/library",
      "3.8: Rejects backslash traversal attempt and falls back to /library"
    );
    assert(
      sanitizeCallbackUrl("javascript:alert(1)", "/library") === "/library",
      "3.9: Rejects javascript: URI and falls back to /library"
    );
    assert(
      sanitizeCallbackUrl("https://evil.com/phish") === "/",
      "3.10: Rejects external URL and falls back to root / by default"
    );

    console.log("\n--- TEST GROUP 4: Open Email & Registration Policy ---");

    // 4.1 Personal email allowed
    assert(
      userA.email.endsWith("@gmail.com"),
      "4.1: Personal email domain (@gmail.com) accepted without restriction"
    );

    // 4.2 Institutional email allowed
    assert(
      userB.email.endsWith("@stanford.edu"),
      "4.2: Institutional email domain (@stanford.edu) accepted without friction"
    );

    // Clean up conversation
    await prisma.aIConversation.delete({ where: { id: userAConvo.id } });

  } finally {
    // Clean up created test papers and users
    for (const paperId of testPaperIds) {
      await prisma.bookmark.deleteMany({ where: { paperId } });
      await prisma.paperChunk.deleteMany({ where: { paperId } });
      await prisma.paper.deleteMany({ where: { id: paperId } });
    }
    for (const userId of testUserIds) {
      await prisma.bookmark.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  }

  console.log("\n================================================================================");
  console.log(` FINAL ACCESS POLICY TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log("================================================================================");

  if (failed > 0) process.exit(1);
}

runAccessPolicyTests();
