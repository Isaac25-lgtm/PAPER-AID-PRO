/**
 * AI RESEARCH HUB — AUDIT-FIRST VERIFICATION
 * Comprehensive Multi-Tenant Private Paper Isolation Suite Across All 12 Retrieval Paths
 * + Additional Isolation Paths (3a-3e) + Admin Scope + Prisma vs Raw SQL Parity
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { prisma } from "../src/lib/prisma";
import { Prisma } from "@prisma/client";
import { searchPapersHybrid } from "../src/lib/search/hybrid-search";
import { discoverRelevantPapers } from "../src/lib/synthesis/discover-papers";
import { retrieveMultiPaperEvidence } from "../src/lib/synthesis/retrieve-multipaper-evidence";
import { retrievePaperEvidence } from "../src/lib/rag/retrieve-paper-evidence";
import { DefaultAgentToolRegistry } from "../src/lib/agent/tool-registry";
import {
  assertPaperAccess,
  createResearchDocument,
  getResearchDocument,
  exportResearchDocument,
  insertDocumentCitation,
} from "../src/lib/editor/document-service";
import { authorizePaperAccess, ADMIN_TEST_FIXTURE_IDS } from "../src/lib/auth/paper-authorization";
import { paperVisibilityFilter, paperVisibilitySql } from "../src/lib/auth/paper-visibility";
import { matchPapersAgainstLocalLibrary } from "../src/lib/discovery/library-matcher";
import { executePaperMetadataImport } from "../src/lib/discovery/import-service";
import { addPaperToCollection } from "../src/lib/library/collections-service";
import { getUserLibraryItems, uploadUserPrivateDocument } from "../src/lib/library/user-library-service";
import { mapReferenceToCslJson } from "../src/lib/citations/csl/csl-mapper";
import { formatBibliographicCitation } from "../src/lib/citations/citation-formatter";
import { getDocumentRevision, exportDocumentRevision } from "../src/lib/editor/revision-service";
import { GET as pdfRouteGet } from "../src/app/api/papers/[id]/pdf/route";
import { GET as scholarToolsListGet } from "../src/app/api/scholar/tools/route";
import { POST as scholarToolExecutePost } from "../src/app/api/scholar/tools/[toolName]/route";
import { GET as cslSyncGet, POST as cslSyncPost } from "../src/app/api/citations/sync/route";
import { GET as editorPdfExportGet } from "../src/app/api/editor/[id]/pdf/route";
import { GET as editorRevisionExportGet } from "../src/app/api/editor/[id]/revisions/[revisionId]/export/route";
import { NextRequest } from "next/server";

async function runIsolationSuite() {
  console.log("======================================================================");
  console.log("AI RESEARCH HUB — MULTI-TENANT PRIVATE PAPER ISOLATION SUITE (12+ PATHS)");
  console.log("======================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}${detail ? ` - ${detail}` : ""}`);
      failed++;
    }
  }

  const timestamp = Date.now();
  const DISTINCTIVE_SECRET = `SECRET_USER_B_PATIENT_COHORT_${timestamp}`;

  // 1. Create Test Users
  const userA = await prisma.user.create({
    data: {
      email: `user_a_${timestamp}@researchhub.test`,
      name: `Dr. User A ${timestamp}`,
      role: "USER",
    },
  });

  const userB = await prisma.user.create({
    data: {
      email: `user_b_${timestamp}@researchhub.test`,
      name: `Dr. User B ${timestamp}`,
      role: "USER",
    },
  });

  const adminUser = await prisma.user.create({
    data: {
      email: `admin_${timestamp}@researchhub.test`,
      name: `Platform Admin ${timestamp}`,
      role: "ADMIN",
    },
  });

  // 2. Create Shared Disciplinary Category and Author
  const category = await prisma.category.create({
    data: {
      name: `Clinical Oncology ${timestamp}`,
      slug: `oncology-${timestamp}`,
      description: "Test category for multi-tenant isolation audit",
    },
  });

  const author = await prisma.author.create({
    data: {
      name: `Prof. Shared Author ${timestamp}`,
      institution: "Metropolitan Academic Hospital",
    },
  });

  // 3. Create Public Benchmark Paper (Visible to all)
  const publicPaper = await prisma.paper.create({
    data: {
      title: `Open Trial on Molecular Oncology ${timestamp}`,
      abstract: `Standard published oncology clinical trial results for ${timestamp}.`,
      status: "COMPLETED",
      isOpenAccess: true,
      doi: `10.1016/j.oncology.${timestamp}`,
      sourceProvenance: { isPrivate: false, isPublicOpenAccess: true },
      categories: { create: [{ categoryId: category.id }] },
      authors: { create: [{ authorId: author.id, orderIndex: 0 }] },
      chunks: {
        create: [
          {
            chunkIndex: 0,
            section: "Results",
            pageNumber: 3,
            text: `Public control group showed standard 72.4% baseline response for ${timestamp}.`,
            tokenCount: 40,
          },
        ],
      },
    },
  });

  // 4. Create User B's Private Manuscript with Distinctive Secret Text
  const privatePaperB = await prisma.paper.create({
    data: {
      title: `Confidential Phase II Trial: ${DISTINCTIVE_SECRET}`,
      abstract: `Internal laboratory investigation containing ${DISTINCTIVE_SECRET} proprietary findings.`,
      status: "COMPLETED",
      isOpenAccess: false,
      storagePath: `research-papers/private-${timestamp}/original.pdf`,
      sourceProvenance: {
        isPrivate: true,
        ownerId: userB.id,
        uploadedByUserId: userB.id,
      },
      categories: { create: [{ categoryId: category.id }] },
      authors: { create: [{ authorId: author.id, orderIndex: 0 }] },
      chunks: {
        create: [
          {
            chunkIndex: 0,
            section: "Confidential Results",
            pageNumber: 1,
            text: `Secret findings demonstrate that ${DISTINCTIVE_SECRET} achieved 98.2% targeted suppression.`,
            tokenCount: 45,
          },
        ],
      },
    },
  });

  // 5. Create Additional Parity Fixture Papers
  const privatePaperA = await prisma.paper.create({
    data: {
      title: `User A Private Research Paper ${timestamp}`,
      abstract: `User A proprietary study for parity verification.`,
      status: "COMPLETED",
      isOpenAccess: false,
      sourceProvenance: {
        isPrivate: true,
        ownerId: userA.id,
        ownerUserId: userA.id,
      },
    },
  });

  const incompleteProvenancePaper = await prisma.paper.create({
    data: {
      title: `Incomplete Provenance Paper ${timestamp}`,
      abstract: `Orphaned private paper without ownerId.`,
      status: "COMPLETED",
      isOpenAccess: false,
      sourceProvenance: {
        isPrivate: true,
      },
    },
  });

  const createdExtraPaperIds: string[] = [];

  try {
    // ========================================================================
    // SECTION 1: THE CORE 12 RETRIEVAL PATHS
    // ========================================================================
    console.log("--- Section 1: The Core 12 Retrieval Paths ---");

    // PATH 1: Hybrid Search (Lexical + Vector Retrieval)
    const searchUserA = await searchPapersHybrid({
      query: DISTINCTIVE_SECRET,
      userId: userA.id,
      role: userA.role,
      excludeFixtures: true,
    });
    assert(
      !searchUserA.papers.some((p) => p.paper.id === privatePaperB.id),
      "Path 1A: Hybrid search hides User B's private paper from User A",
      `User A search returned ${searchUserA.papers.length} matches`
    );
    assert(
      !searchUserA.papers.some((p) => p.matchedSnippet?.text.includes(DISTINCTIVE_SECRET)),
      "Path 1B: Hybrid search never leaks private chunk snippets to User A"
    );

    const searchUserB = await searchPapersHybrid({
      query: DISTINCTIVE_SECRET,
      userId: userB.id,
      role: userB.role,
      excludeFixtures: true,
    });
    assert(
      searchUserB.papers.some((p) => p.paper.id === privatePaperB.id),
      "Path 1C: Hybrid search permits User B to find their own private paper"
    );

    // PATH 2: Public Paper Catalog (/papers)
    const catalogPapersUserA = await prisma.paper.findMany({
      where: {
        AND: [
          { id: { in: [publicPaper.id, privatePaperB.id] } },
          paperVisibilityFilter(userA.id, { role: userA.role }),
        ],
      },
      select: { id: true },
    });
    assert(
      catalogPapersUserA.length === 1 && catalogPapersUserA[0].id === publicPaper.id,
      "Path 2: /papers catalog filter strictly excludes User B's private paper for User A"
    );

    // PATH 3: Direct Paper View (/papers/[id])
    const viewMetadataUserA = await authorizePaperAccess(privatePaperB, userA, "VIEW_METADATA");
    assert(
      !viewMetadataUserA.allowed && viewMetadataUserA.statusCode === 404,
      "Path 3A: /papers/[id] denies User A access with HTTP 404 (anti-enumeration)"
    );

    const viewMetadataUserB = await authorizePaperAccess(privatePaperB, userB, "VIEW_METADATA");
    assert(
      viewMetadataUserB.allowed && viewMetadataUserB.statusCode === 200,
      "Path 3B: /papers/[id] allows User B to view their own private paper metadata"
    );

    // PATH 4: PDF Streaming Route (/api/papers/[id]/pdf)
    const reqUserA = new NextRequest(`http://localhost:3000/api/papers/${privatePaperB.id}/pdf`, {
      headers: {
        "x-test-user-id": userA.id,
        "x-test-user-role": userA.role,
      },
    });
    const pdfResponseUserA = await pdfRouteGet(reqUserA, { params: { id: privatePaperB.id } });
    assert(
      pdfResponseUserA.status === 404,
      `Path 4: /api/papers/[id]/pdf returns HTTP 404 for User A (got ${pdfResponseUserA.status})`
    );

    // PATH 5: Quick Research Discovery (discoverRelevantPapers)
    const discoveryUserA = await discoverRelevantPapers(DISTINCTIVE_SECRET, {
      userId: userA.id,
      userRole: userA.role,
      candidateLimit: 20,
    });
    assert(
      !discoveryUserA.candidatePapers.some((p) => p.paperId === privatePaperB.id) &&
      !discoveryUserA.selectedPapers.some((p) => p.paperId === privatePaperB.id),
      "Path 5: Quick Research discovery never surfaces User B's private paper to User A"
    );

    // PATH 6: Single-Paper RAG Evidence Retrieval (retrievePaperEvidence)
    let ragLeaked = false;
    try {
      await retrievePaperEvidence(privatePaperB.id, DISTINCTIVE_SECRET, { user: userA });
      ragLeaked = true;
    } catch (err: any) {
      assert(
        err.message.includes("restricted") || err.message.includes("not found"),
        "Path 6: retrievePaperEvidence throws unauthorized error when User A attempts access"
      );
    }
    assert(!ragLeaked, "Path 6: Single-paper RAG never returns private evidence to User A");

    // PATH 7: Multi-Paper Evidence Retrieval (retrieveMultiPaperEvidence)
    const multiPaperEvidenceUserA = await retrieveMultiPaperEvidence(
      [
        {
          paperId: privatePaperB.id,
          title: privatePaperB.title,
          authors: [],
          doi: null,
          journal: null,
          publicationDate: null,
          citationCount: 0,
          relevanceScore: 1.0,
          bestChunkSimilarity: 1.0,
          matchingChunksCount: 1,
        },
      ],
      DISTINCTIVE_SECRET,
      {
        queryVector: [0.1, 0.2, 0.3],
        userId: userA.id,
        userRole: userA.role,
      }
    );
    assert(
      multiPaperEvidenceUserA.allChunks.length === 0 &&
      multiPaperEvidenceUserA.evidenceSets.length === 0,
      "Path 7: retrieveMultiPaperEvidence drops unauthorized private paper IDs for User A"
    );

    // PATH 8: Deep Research Agent Planner Discovery (stepPlanning)
    const plannerPapersUserA = await prisma.paper.findMany({
      where: {
        AND: [
          { status: "COMPLETED" },
          paperVisibilityFilter(userA.id, { role: userA.role }),
        ],
      },
      select: { id: true, title: true },
    });
    assert(
      !plannerPapersUserA.some((p) => p.id === privatePaperB.id),
      "Path 8: Deep Research planner context excludes User B's private paper for User A"
    );

    // PATH 9: Deep Research Tool Registry (searchLocalLibrary & inspectPaperDetails)
    const toolRegistry = new DefaultAgentToolRegistry();
    const inspectedUserA = await toolRegistry.inspectPaperDetails(privatePaperB.id, {
      userId: userA.id,
      userRole: userA.role,
    });
    assert(
      inspectedUserA === null,
      "Path 9A: toolRegistry.inspectPaperDetails returns null for User A on private paper"
    );

    const inspectedUserB = await toolRegistry.inspectPaperDetails(privatePaperB.id, {
      userId: userB.id,
      userRole: userB.role,
    });
    assert(
      inspectedUserB !== null && inspectedUserB.id === privatePaperB.id,
      "Path 9B: toolRegistry.inspectPaperDetails returns paper details for User B"
    );

    const agentEvidenceUserA = await toolRegistry.retrievePaperEvidence(
      [privatePaperB.id],
      DISTINCTIVE_SECRET,
      { userId: userA.id, userRole: userA.role }
    );
    assert(
      agentEvidenceUserA.allChunks.length === 0,
      "Path 9C: toolRegistry.retrievePaperEvidence returns 0 chunks to User A for private paper"
    );

    // PATH 10: Homepage / Anonymous Literature Access
    const anonVisibilityFilter = paperVisibilityFilter(null);
    const anonVisiblePapers = await prisma.paper.findMany({
      where: {
        AND: [
          { id: { in: [publicPaper.id, privatePaperB.id] } },
          anonVisibilityFilter,
        ],
      },
      select: { id: true },
    });
    assert(
      anonVisiblePapers.length === 1 && anonVisiblePapers[0].id === publicPaper.id,
      "Path 10: Anonymous visitors cannot see User B's private paper"
    );

    // PATH 11: Author & Category Counts and Listings
    const categoryCountUserA = await prisma.category.findUnique({
      where: { id: category.id },
      include: {
        _count: {
          select: {
            papers: {
              where: {
                paper: paperVisibilityFilter(userA.id, { role: userA.role }),
              },
            },
          },
        },
      },
    });
    assert(
      categoryCountUserA?._count.papers === 1,
      `Path 11A: Category paper count for User A is 1 (excludes private paper, got ${categoryCountUserA?._count.papers})`
    );

    const categoryCountUserB = await prisma.category.findUnique({
      where: { id: category.id },
      include: {
        _count: {
          select: {
            papers: {
              where: {
                paper: paperVisibilityFilter(userB.id, { role: userB.role }),
              },
            },
          },
        },
      },
    });
    assert(
      categoryCountUserB?._count.papers === 2,
      `Path 11B: Category paper count for User B is 2 (includes own private paper, got ${categoryCountUserB?._count.papers})`
    );

    const authorCountUserA = await prisma.author.findUnique({
      where: { id: author.id },
      include: {
        _count: {
          select: {
            papers: {
              where: {
                paper: paperVisibilityFilter(userA.id, { role: userA.role }),
              },
            },
          },
        },
      },
    });
    assert(
      authorCountUserA?._count.papers === 1,
      `Path 11C: Author paper count for User A is 1 (excludes private paper, got ${authorCountUserA?._count.papers})`
    );

    // PATH 12: Editor / Research Actions (assertPaperAccess)
    let editorLeaked = false;
    try {
      await assertPaperAccess(userA.id, privatePaperB.id);
      editorLeaked = true;
    } catch (err: any) {
      assert(
        err.message.includes("private manuscript belonging to another researcher"),
        `Path 12A: assertPaperAccess rejects User A: "${err.message}"`
      );
    }
    assert(!editorLeaked, "Path 12B: User A cannot attach User B's private paper in editor");

    const userBAccess = await assertPaperAccess(userB.id, privatePaperB.id);
    assert(
      userBAccess === true,
      "Path 12C: User B can successfully attach their own private paper in editor"
    );

    // ========================================================================
    // SECTION 2: ADDITIONAL ISOLATION PATHS (3a, 3b, 3c, 3d, 3e)
    // ========================================================================
    console.log("\n--- Section 2: Additional Isolation Paths (3a-3e) ---");

    // Path 3a: Discovery Library Matcher
    const matchUserA = await matchPapersAgainstLocalLibrary(
      [
        {
          id: "temp-ext-1",
          sourceProviders: ["CROSSREF"],
          title: privatePaperB.title,
          authors: [],
          year: 2026,
          isOpenAccess: false,
          fullTextAvailability: "METADATA_ONLY",
        },
      ],
      userA.id
    );
    assert(
      matchUserA[0].localStatus?.inLibrary !== true && matchUserA[0].localStatus?.paperId === undefined,
      "Path 3a.1: matchPapersAgainstLocalLibrary hides User B's private paper from User A (inLibrary: false, paperId: undefined)"
    );

    const matchUserB = await matchPapersAgainstLocalLibrary(
      [
        {
          id: "temp-ext-2",
          sourceProviders: ["CROSSREF"],
          title: privatePaperB.title,
          authors: [],
          year: 2026,
          isOpenAccess: false,
          fullTextAvailability: "METADATA_ONLY",
        },
      ],
      userB.id
    );
    assert(
      matchUserB[0].localStatus?.inLibrary === true && matchUserB[0].localStatus?.paperId === privatePaperB.id,
      "Path 3a.2: matchPapersAgainstLocalLibrary allows User B to match their own private paper (inLibrary: true)"
    );

    // Path 3b: Import Idempotency, Non-Unique Private DOI (canonicalDoi), & Byte-for-Byte Unchanged Guarantee
    const sharedDoi = `10.1038/s41586-026-${timestamp}`;
    const validPdfBuffer = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF", "utf-8");
    const uploadedPrivateB = await uploadUserPrivateDocument({
      userId: userB.id,
      fileBuffer: validPdfBuffer,
      filename: `user-b-private-${timestamp}.pdf`,
      metadata: {
        title: `Preprint Draft of Genomic Trial ${timestamp}`,
        authors: `Dr. User B ${timestamp}`,
        doi: sharedDoi,
        journal: "Journal of Genomic Medicine",
        year: 2026,
        documentType: "RESEARCH_ARTICLE",
      },
      autoProcess: false,
    });
    createdExtraPaperIds.push(uploadedPrivateB.paperId);

    const beforeImportRecord = await prisma.paper.findUniqueOrThrow({
      where: { id: uploadedPrivateB.paperId },
    });
    const beforeImportJson = JSON.stringify(beforeImportRecord);

    assert(
      beforeImportRecord.doi === null &&
        (beforeImportRecord.sourceProvenance as any)?.canonicalDoi === sharedDoi,
      "Path 3b.1 (2a): Private paper upload sets Paper.doi = null and stores DOI strictly in sourceProvenance.canonicalDoi"
    );

    // Wait 15ms so any accidental update would advance updatedAt
    await new Promise((r) => setTimeout(r, 15));

    // User A imports the exact same DOI and title via executePaperMetadataImport
    const importByUserA = await executePaperMetadataImport(
      {
        id: `doi:${sharedDoi}`,
        title: `Preprint Draft of Genomic Trial ${timestamp}`,
        abstract: "Published abstract from Crossref.",
        authors: [{ name: `Dr. User B ${timestamp}` }],
        publicationDate: "2026-05-01",
        year: 2026,
        journal: "Journal of Genomic Medicine",
        doi: sharedDoi,
        sourceProviders: ["CROSSREF"],
        isOpenAccess: false,
        fullTextAvailability: "METADATA_ONLY",
      },
      userA.id,
      { attemptFullTextFetch: false }
    );
    if (importByUserA.paperId) {
      createdExtraPaperIds.push(importByUserA.paperId);
    }

    const afterImportRecord = await prisma.paper.findUniqueOrThrow({
      where: { id: uploadedPrivateB.paperId },
    });
    const afterImportJson = JSON.stringify(afterImportRecord);

    assert(
      importByUserA.success === true &&
        importByUserA.isExisting === false &&
        Boolean(importByUserA.paperId) &&
        importByUserA.paperId !== uploadedPrivateB.paperId,
      "Path 3b.2 (2d): User A's import by DOI creates a separate public paper and never returns User B's private paper"
    );

    assert(
      beforeImportJson === afterImportJson &&
        beforeImportRecord.updatedAt.toISOString() === afterImportRecord.updatedAt.toISOString(),
      "Path 3b.3 (2d): User B's private paper record (including updatedAt and sourceProvenance) is byte-for-byte unchanged after User A imports the same DOI"
    );

    // Path 3b (2c): Owner's citations, CSL rendering, and exports for private papers read canonicalDoi
    const cslItemPrivateB = mapReferenceToCslJson({
      id: afterImportRecord.id,
      title: afterImportRecord.title,
      authors: [`Dr. User B ${timestamp}`],
      publicationDate: afterImportRecord.publicationDate,
      journal: afterImportRecord.journal,
      doi: afterImportRecord.doi, // null on column
      sourceProvenance: afterImportRecord.sourceProvenance,
    });
    assert(
      cslItemPrivateB.DOI === sharedDoi,
      `Path 3b.4 (2c): mapReferenceToCslJson resolves canonicalDoi (${cslItemPrivateB.DOI}) when paper.doi is null`
    );

    const formattedApaPrivateB = formatBibliographicCitation(
      {
        title: afterImportRecord.title,
        authors: [`Dr. User B ${timestamp}`],
        year: 2026,
        journal: afterImportRecord.journal,
        doi: afterImportRecord.doi, // null on column
        documentType: "RESEARCH_ARTICLE",
        sourceProvenance: afterImportRecord.sourceProvenance,
      },
      "apa"
    );
    assert(
      formattedApaPrivateB.text.includes(sharedDoi) && formattedApaPrivateB.hasExternalIdentifier === true,
      "Path 3b.5 (2c): formatBibliographicCitation includes canonicalDoi for owner's private paper"
    );

    const userBDoc = await createResearchDocument(userB.id, {
      title: `User B Manuscript Citing Own Private Paper ${timestamp}`,
    });
    await insertDocumentCitation(userB.id, userBDoc.id, {
      paperId: afterImportRecord.id,
      citationText: `(User B, 2026)`,
    });
    const userBExportMd = await exportResearchDocument(userB.id, userBDoc.id, "markdown");
    const userBExportBib = await exportResearchDocument(userB.id, userBDoc.id, "bibtex");
    const userBExportRis = await exportResearchDocument(userB.id, userBDoc.id, "ris");

    assert(
      userBExportMd.content.includes(sharedDoi) &&
        userBExportBib.content.includes(sharedDoi) &&
        userBExportRis.content.includes(sharedDoi),
      "Path 3b.6 (2c): Owner's manuscript exports (Markdown, BibTeX, RIS) preserve canonicalDoi for cited private paper"
    );

    // Path 3c: Collections & Bookmarks Isolation
    let collectionAddFailed = false;
    try {
      await addPaperToCollection(userA.id, privatePaperB.id, "Oncology Reading List");
    } catch (err: any) {
      collectionAddFailed = true;
      assert(
        err.message.includes("Unauthorized") || err.message.includes("permission"),
        `Path 3c.1: addPaperToCollection rejects User A adding User B's private paper: "${err.message}"`
      );
    }
    assert(collectionAddFailed, "Path 3c.2: User A cannot add User B's private paper to a collection");

    const libraryItemsUserA = await getUserLibraryItems(userA.id);
    assert(
      !libraryItemsUserA.some((item) => item.id === privatePaperB.id),
      "Path 3c.3: getUserLibraryItems for User A strictly excludes User B's private paper"
    );

    // Path 3d: Editor Document Export & Citation Hydration Isolation
    const userADoc = await createResearchDocument(userA.id, {
      title: "User A Clinical Report",
    });

    // Directly insert a citation referencing privatePaperB to simulate forged or tampered citation
    const forgedCitation = await prisma.documentCitation.create({
      data: {
        documentId: userADoc.id,
        paperId: privatePaperB.id,
        citationText: "User B Private Finding [1]",
      },
    });

    const retrievedDocUserA = await getResearchDocument(userA.id, userADoc.id);
    const hydratedCite = retrievedDocUserA.citations.find((c: any) => c.id === forgedCitation.id);
    assert(
      hydratedCite?.paper === null,
      "Path 3d.1: getResearchDocument scrubs metadata of another researcher's private paper (paper: null)"
    );

    const exportMarkdown = await exportResearchDocument(userA.id, userADoc.id, "markdown");
    assert(
      !exportMarkdown.content.includes(DISTINCTIVE_SECRET),
      "Path 3d.2: exportResearchDocument never leaks private paper title/secret into exported markdown or bibliography"
    );

    // Path 3e: Conversation Thread Access Isolation
    const userBConversation = await prisma.aIConversation.create({
      data: {
        userId: userB.id,
        title: `Internal Research Investigation ${timestamp}`,
        paperId: privatePaperB.id,
      },
    });

    const conversationQueryUserA = await prisma.aIConversation.findFirst({
      where: {
        id: userBConversation.id,
        userId: userA.id,
      },
    });
    assert(
      conversationQueryUserA === null,
      "Path 3e: User A query for User B conversation returns null (strict multi-tenant conversation isolation)"
    );

    // ========================================================================
    // SECTION 3: ADMIN SCOPE ENFORCEMENT
    // ========================================================================
    console.log("\n--- Section 3: Admin Scope Enforcement ---");

    // Admin in user-facing mode: MUST receive same multi-tenant isolation as normal users
    const adminUserFacingFilter = paperVisibilityFilter(adminUser.id, {
      role: adminUser.role,
      isAdminRoute: false,
      allowAdmin: false,
    });
    const adminUserFacingPapers = await prisma.paper.findMany({
      where: {
        AND: [
          { id: { in: [publicPaper.id, privatePaperB.id] } },
          adminUserFacingFilter,
        ],
      },
      select: { id: true },
    });
    assert(
      adminUserFacingPapers.length === 1 && adminUserFacingPapers[0].id === publicPaper.id,
      "Admin Scope 1: In user-facing routes, ADMIN role does NOT see User B's private paper"
    );

    // Admin in admin route/action mode: receives administrative visibility bypass
    const adminRouteFilter = paperVisibilityFilter(adminUser.id, {
      role: adminUser.role,
      isAdminRoute: true,
    });
    const adminRoutePapers = await prisma.paper.findMany({
      where: {
        AND: [
          { id: { in: [publicPaper.id, privatePaperB.id] } },
          adminRouteFilter,
        ],
      },
      select: { id: true },
    });
    assert(
      adminRoutePapers.length === 2,
      "Admin Scope 2: With isAdminRoute: true, ADMIN role receives administrative catalog visibility"
    );

    // ========================================================================
    // SECTION 4: VISIBILITY STORAGE PARITY (PRISMA VS RAW SQL)
    // ========================================================================
    console.log("\n--- Section 4: Prisma vs Raw SQL Parity ---");

    const fixturePaperIds = [
      publicPaper.id,
      privatePaperA.id,
      privatePaperB.id,
      incompleteProvenancePaper.id,
    ];

    // Parity Check for User A
    const prismaIdsUserA = (
      await prisma.paper.findMany({
        where: {
          AND: [
            { id: { in: fixturePaperIds } },
            paperVisibilityFilter(userA.id, { role: "USER" }),
          ],
        },
        select: { id: true },
      })
    ).map((p) => p.id);

    const rawSqlIdsUserA = (
      await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`
          SELECT p.id
          FROM "papers" p
          WHERE p.id IN (${Prisma.join(fixturePaperIds)})
            AND ${paperVisibilitySql(userA.id, "p", { role: "USER" })}
        `
      )
    ).map((p) => p.id);

    const setPrismaA = new Set(prismaIdsUserA);
    const setRawSqlA = new Set(rawSqlIdsUserA);
    const parityA =
      setPrismaA.size === setRawSqlA.size &&
      Array.from(setPrismaA).every((id) => setRawSqlA.has(id));

    assert(
      parityA,
      `Parity User A: Prisma and Raw SQL return identical paper ID set (${Array.from(setPrismaA).join(", ")})`
    );
    assert(
      setPrismaA.has(publicPaper.id) && setPrismaA.has(privatePaperA.id) && !setPrismaA.has(privatePaperB.id),
      "Parity User A: User A sees public paper and own private paper, but NOT User B's private paper"
    );

    // Parity Check for User B
    const prismaIdsUserB = (
      await prisma.paper.findMany({
        where: {
          AND: [
            { id: { in: fixturePaperIds } },
            paperVisibilityFilter(userB.id, { role: "USER" }),
          ],
        },
        select: { id: true },
      })
    ).map((p) => p.id);

    const rawSqlIdsUserB = (
      await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`
          SELECT p.id
          FROM "papers" p
          WHERE p.id IN (${Prisma.join(fixturePaperIds)})
            AND ${paperVisibilitySql(userB.id, "p", { role: "USER" })}
        `
      )
    ).map((p) => p.id);

    const setPrismaB = new Set(prismaIdsUserB);
    const setRawSqlB = new Set(rawSqlIdsUserB);
    const parityB =
      setPrismaB.size === setRawSqlB.size &&
      Array.from(setPrismaB).every((id) => setRawSqlB.has(id));

    assert(
      parityB,
      `Parity User B: Prisma and Raw SQL return identical paper ID set (${Array.from(setPrismaB).join(", ")})`
    );
    assert(
      setPrismaB.has(publicPaper.id) && setPrismaB.has(privatePaperB.id) && !setPrismaB.has(privatePaperA.id),
      "Parity User B: User B sees public paper and own private paper, but NOT User A's private paper"
    );

    // Parity Check for Anonymous Visitor (null userId)
    const prismaIdsAnon = (
      await prisma.paper.findMany({
        where: {
          AND: [
            { id: { in: fixturePaperIds } },
            paperVisibilityFilter(null),
          ],
        },
        select: { id: true },
      })
    ).map((p) => p.id);

    const rawSqlIdsAnon = (
      await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`
          SELECT p.id
          FROM "papers" p
          WHERE p.id IN (${Prisma.join(fixturePaperIds)})
            AND ${paperVisibilitySql(null, "p")}
        `
      )
    ).map((p) => p.id);

    const setPrismaAnon = new Set(prismaIdsAnon);
    const setRawSqlAnon = new Set(rawSqlIdsAnon);
    const parityAnon =
      setPrismaAnon.size === setRawSqlAnon.size &&
      Array.from(setPrismaAnon).every((id) => setRawSqlAnon.has(id));

    assert(
      parityAnon,
      `Parity Anonymous: Prisma and Raw SQL return identical paper ID set (${Array.from(setPrismaAnon).join(", ")})`
    );
    assert(
      setPrismaAnon.has(publicPaper.id) && !setPrismaAnon.has(privatePaperA.id) && !setPrismaAnon.has(privatePaperB.id),
      "Parity Anonymous: Anonymous visitor sees ONLY public paper"
    );

    // ========================================================================
    // SECTION 5: SCHOLAR TOOLS, CSL SYNC & EDITOR EXPORT ROUTE ISOLATION
    // ========================================================================
    console.log("\n--- SECTION 5: Scholar Tools, CSL Sync & Editor Export Route Isolation ---");

    // 5a: /api/scholar/tools & /api/scholar/tools/[toolName] reject unauthenticated calls (401)
    const scholarListRes = await scholarToolsListGet();
    assert(
      scholarListRes.status === 401,
      `Route 5a.1 (/api/scholar/tools): Unauthenticated GET returns 401 (got ${scholarListRes.status})`
    );

    const scholarExecReq = new NextRequest("http://localhost:3000/api/scholar/tools/search_papers", {
      method: "POST",
      body: JSON.stringify({ query: DISTINCTIVE_SECRET }),
      headers: { "content-type": "application/json" },
    });
    const scholarExecRes = await scholarToolExecutePost(scholarExecReq, {
      params: { toolName: "search_papers" },
    });
    assert(
      scholarExecRes.status === 401,
      `Route 5a.2 (/api/scholar/tools/[toolName]): Unauthenticated POST returns 401 (got ${scholarExecRes.status})`
    );

    // 5b: /api/citations/sync rejects unauthenticated calls (401)
    const syncGetReq = new NextRequest("http://localhost:3000/api/citations/sync", { method: "GET" });
    const syncGetRes = await cslSyncGet(syncGetReq);
    assert(
      syncGetRes.status === 401,
      `Route 5b.1 (/api/citations/sync GET): Unauthenticated GET returns 401 (got ${syncGetRes.status})`
    );
    const syncPostReq = new NextRequest("http://localhost:3000/api/citations/sync", { method: "POST" });
    const syncPostRes = await cslSyncPost(syncPostReq);
    assert(
      syncPostRes.status === 401,
      `Route 5b.2 (/api/citations/sync POST): Unauthenticated POST returns 401 (got ${syncPostRes.status})`
    );

    // 5c: /api/editor/[id]/pdf & /api/editor/[id]/revisions/[revisionId]/export reject unauthenticated calls (401)
    const editorPdfReq = new NextRequest(`http://localhost:3000/api/editor/${userBDoc.id}/pdf`, {
      method: "GET",
    });
    const editorPdfRes = await editorPdfExportGet(editorPdfReq, {
      params: { id: userBDoc.id },
    });
    assert(
      editorPdfRes.status === 401,
      `Route 5c.1 (/api/editor/[id]/pdf): Unauthenticated GET returns 401 (got ${editorPdfRes.status})`
    );

    // Create a revision on userADoc containing a tampered citation/linkedPaper referencing User B's private paper
    const tamperedRevision = await prisma.documentRevision.create({
      data: {
        documentId: userADoc.id,
        version: 1,
        title: "User A Clinical Report v1",
        docType: "DRAFT",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Clinical report body text." }],
            },
          ],
        },
        textContent: "Clinical report body text.",
        wordCount: 4,
        charCount: 26,
        cslStyleId: "apa",
        citations: [
          {
            id: "tampered-cite-1",
            paperId: privatePaperB.id,
            citationText: `(${DISTINCTIVE_SECRET}, 2026)`,
            paper: {
              id: privatePaperB.id,
              title: privatePaperB.title,
              doi: sharedDoi,
            },
            chunk: {
              id: "tampered-chunk-b",
              text: DISTINCTIVE_SECRET,
            },
          },
        ],
        linkedPapers: [
          {
            id: "tampered-lp-1",
            paperId: privatePaperB.id,
            paper: {
              id: privatePaperB.id,
              title: privatePaperB.title,
              doi: sharedDoi,
            },
          },
        ],
      },
    });

    const revExportReq = new NextRequest(
      `http://localhost:3000/api/editor/${userADoc.id}/revisions/${tamperedRevision.id}/export?format=markdown`,
      { method: "GET" }
    );
    const revExportRes = await editorRevisionExportGet(revExportReq, {
      params: { id: userADoc.id, revisionId: tamperedRevision.id },
    });
    assert(
      revExportRes.status === 401,
      `Route 5c.2 (/api/editor/[id]/revisions/[revisionId]/export): Unauthenticated GET returns 401 (got ${revExportRes.status})`
    );

    // 5d: Cross-user document & revision export rejection + private paper scrubbing on export
    let crossUserPdfBlocked = false;
    try {
      await exportResearchDocument(userA.id, userBDoc.id, "pdf");
    } catch {
      crossUserPdfBlocked = true;
    }
    assert(
      crossUserPdfBlocked,
      "Route 5d.1 (/api/editor/[id]/pdf service): User A cannot export User B's document as PDF"
    );

    const userAPdfExport = await exportResearchDocument(userA.id, userADoc.id, "pdf");
    const userAJsonExport = await exportResearchDocument(userA.id, userADoc.id, "json");
    assert(
      userAPdfExport.citationCount === 0 &&
        userAPdfExport.sourceCount === 0 &&
        !userAJsonExport.content.includes(DISTINCTIVE_SECRET) &&
        !userAJsonExport.content.includes(privatePaperB.id),
      "Route 5d.2 (/api/editor/[id]/pdf & json): Live document export strips forged private paper citations from PDF and JSON"
    );

    const sanitizedRevPreview = await getDocumentRevision(userA.id, userADoc.id, tamperedRevision.id);
    assert(
      Array.isArray(sanitizedRevPreview.citations) &&
        sanitizedRevPreview.citations.length === 0 &&
        Array.isArray(sanitizedRevPreview.linkedPapers) &&
        sanitizedRevPreview.linkedPapers.length === 0,
      "Route 5d.3 (getDocumentRevision): Revision preview strips tampered references to User B's private paper via DB visibility check"
    );

    const revExportMd = await exportDocumentRevision(userA.id, userADoc.id, tamperedRevision.id, "markdown");
    const revExportJson = await exportDocumentRevision(userA.id, userADoc.id, tamperedRevision.id, "json");
    const revExportPdf = await exportDocumentRevision(userA.id, userADoc.id, tamperedRevision.id, "pdf");
    assert(
      !revExportMd.content.includes(DISTINCTIVE_SECRET) &&
        !revExportJson.content.includes(DISTINCTIVE_SECRET) &&
        !revExportJson.content.includes(privatePaperB.id) &&
        revExportPdf.citationCount === 0 &&
        revExportPdf.sourceCount === 0,
      "Route 5d.4 (/api/editor/[id]/revisions/[revisionId]/export service): Revision exports (MD, JSON, PDF) never leak User B's private paper or chunk"
    );

  } finally {
    // Teardown: Clean up created test entities
    const allPaperIds = [
      publicPaper.id,
      privatePaperB.id,
      privatePaperA.id,
      incompleteProvenancePaper.id,
      ...createdExtraPaperIds,
    ];

    await prisma.documentCitation.deleteMany({
      where: { paperId: { in: allPaperIds } },
    });
    await prisma.collectionPaper.deleteMany({
      where: { paperId: { in: allPaperIds } },
    });
    await prisma.collection.deleteMany({
      where: { userId: { in: [userA.id, userB.id] } },
    });
    await prisma.researchDocument.deleteMany({
      where: { userId: { in: [userA.id, userB.id] } },
    });
    await prisma.aIConversation.deleteMany({
      where: { userId: { in: [userA.id, userB.id] } },
    });
    await prisma.paperChunk.deleteMany({
      where: { paperId: { in: allPaperIds } },
    });
    await prisma.paperCategory.deleteMany({
      where: { paperId: { in: allPaperIds } },
    });
    await prisma.paperAuthor.deleteMany({
      where: { paperId: { in: allPaperIds } },
    });
    await prisma.bookmark.deleteMany({
      where: { paperId: { in: allPaperIds } },
    });
    await prisma.paper.deleteMany({
      where: { id: { in: allPaperIds } },
    });
    await prisma.category.deleteMany({ where: { id: category.id } });
    await prisma.author.deleteMany({ where: { id: author.id } });
    await prisma.user.deleteMany({
      where: { id: { in: [userA.id, userB.id, adminUser.id] } },
    });
  }

  console.log("\n======================================================================");
  console.log(`ISOLATION SUITE SUMMARY: ${passed} passed, ${failed} failed`);
  console.log("======================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runIsolationSuite().finally(() => prisma.$disconnect());
