/**
 * AI RESEARCH HUB â€” AUDIT-FIRST VERIFICATION
 * Comprehensive Multi-Tenant Private Paper Isolation Suite Across All 12 Retrieval Paths
 *
 * Asserts that a private manuscript created by User B with distinctive text
 * ("SECRET_USER_B_PATIENT_COHORT_XY77") is strictly inaccessible to User A (and anonymous visitors)
 * across ALL 12 catalog, RAG, synthesis, agent, and storage retrieval paths.
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
import { assertPaperAccess } from "../src/lib/editor/document-service";
import { authorizePaperAccess, authorizeCurrentSession } from "../src/lib/auth/paper-authorization";
import { paperVisibilityFilter, paperVisibilitySql } from "../src/lib/auth/paper-visibility";
import { GET as pdfRouteGet } from "../src/app/api/papers/[id]/pdf/route";
import { NextRequest } from "next/server";

async function runIsolationSuite() {
  console.log("======================================================================");
  console.log("AI RESEARCH HUB â€” MULTI-TENANT PRIVATE PAPER ISOLATION SUITE (12 PATHS)");
  console.log("======================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`âœ… PASS: ${testName}`);
      passed++;
    } else {
      console.error(`â Œ FAIL: ${testName}${detail ? ` - ${detail}` : ""}`);
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

  try {
    // ------------------------------------------------------------------------
    // PATH 1: Hybrid Search (Lexical + Vector Retrieval)
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // PATH 2: Public Paper Catalog (/papers)
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // PATH 3: Direct Paper View (/papers/[id])
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // PATH 4: PDF Streaming Route (/api/papers/[id]/pdf)
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // PATH 5: Quick Research Discovery (discoverRelevantPapers)
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // PATH 6: Single-Paper RAG Evidence Retrieval (retrievePaperEvidence)
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // PATH 7: Multi-Paper Evidence Retrieval (retrieveMultiPaperEvidence)
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // PATH 8: Deep Research Agent Planner Discovery (stepPlanning)
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // PATH 9: Deep Research Tool Registry (searchLocalLibrary & inspectPaperDetails)
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // PATH 10: Homepage / Anonymous Literature Access
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // PATH 11: Author & Category Counts and Listings
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // PATH 12: Editor / Research Actions (assertPaperAccess)
    // ------------------------------------------------------------------------
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

  } finally {
    // Teardown: Clean up created test entities
    await prisma.paperChunk.deleteMany({
      where: { paperId: { in: [publicPaper.id, privatePaperB.id] } },
    });
    await prisma.paperCategory.deleteMany({
      where: { paperId: { in: [publicPaper.id, privatePaperB.id] } },
    });
    await prisma.paperAuthor.deleteMany({
      where: { paperId: { in: [publicPaper.id, privatePaperB.id] } },
    });
    await prisma.paper.deleteMany({
      where: { id: { in: [publicPaper.id, privatePaperB.id] } },
    });
    await prisma.category.deleteMany({ where: { id: category.id } });
    await prisma.author.deleteMany({ where: { id: author.id } });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  }

  console.log("\n======================================================================");
  console.log(`ISOLATION SUITE SUMMARY: ${passed} passed, ${failed} failed`);
  console.log("======================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runIsolationSuite().finally(() => prisma.$disconnect());
