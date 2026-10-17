/**
 * AI RESEARCH HUB — SAVED PAPER PDF ACTIONS & WORKFLOW ACCEPTANCE TEST SUITE
 *
 * Verifies TASK 1, TASK 2, and TASK 3 Acceptance Criteria:
 * 1. Save reference from Scholarly Discovery -> persisted in isolated DB.
 * 2. Open My Library -> visible with status METADATA_ONLY.
 * 3. Find & Attach Full Text -> acquires eligible license-permissive PDF and processes to COMPLETED.
 * 4. Restricted or unavailable PDF -> preserves external link, reports outcome clearly, offers fallback.
 * 5. Direct Upload My PDF -> reuses existing metadata without redundant re-entry.
 * 6. Refresh library -> exactly 1 record remains (zero duplicate public/private records).
 * 7. Multi-tenant isolation -> public record remains clean, other users not contaminated.
 * 8. Research snapshot -> distinct retrieved vs cited counts, qualified claims, abstract-only label.
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

// Isolated Local Preflight
loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/prisma";
import { executePaperMetadataImport } from "../src/lib/discovery/import-service";
import {
  discoverAndProcessPaperOpenAccess,
} from "../src/lib/library/identifier-lookup-service";
import {
  getUserLibraryItems,
  attachPdfToExistingPaper,
} from "../src/lib/library/user-library-service";
import { generateResearchSnapshot } from "../src/lib/discovery/snapshot/snapshot-service";
import { NormalizedExternalPaper } from "../src/lib/discovery/types";
import * as fullTextService from "../src/lib/discovery/full-text-service";
import * as oaService from "../src/lib/discovery/open-access-service";

test("Saved Paper PDF Actions & Workflow Acceptance Suite", async (t) => {
  let userA: any;
  let userB: any;
  const createdPaperIds: string[] = [];

  const samplePdfPath = path.resolve(__dirname, "../scratch/mengo-original.pdf");
  const samplePdfBuffer = fs.readFileSync(samplePdfPath);

  t.before(async () => {
    userA = await prisma.user.upsert({
      where: { email: "dr_alpha_ux@academic.local" },
      update: {},
      create: {
        email: "dr_alpha_ux@academic.local",
        name: "Dr. Alpha Ultrasound",
        role: "USER",
      },
    });

    userB = await prisma.user.upsert({
      where: { email: "dr_beta_ux@academic.local" },
      update: {},
      create: {
        email: "dr_beta_ux@academic.local",
        name: "Dr. Beta Ultrasound",
        role: "USER",
      },
    });
  });

  t.after(async () => {
    // Cleanup created test records
    if (createdPaperIds.length > 0) {
      await prisma.paperChunk.deleteMany({
        where: { paperId: { in: createdPaperIds } },
      }).catch(() => {});
      await prisma.bookmark.deleteMany({
        where: { paperId: { in: createdPaperIds } },
      }).catch(() => {});
      await prisma.paperAuthor.deleteMany({
        where: { paperId: { in: createdPaperIds } },
      }).catch(() => {});
      await prisma.paper.deleteMany({
        where: { id: { in: createdPaperIds } },
      }).catch(() => {});
    }

    await prisma.bookmark.deleteMany({
      where: { userId: { in: [userA.id, userB.id] } },
    }).catch(() => {});
    await prisma.paper.deleteMany({
      where: {
        sourceProvenance: {
          path: ["ownerId"],
          equals: userA.id,
        },
      },
    }).catch(() => {});
  });

  await t.test("1. Save reference from Scholarly Discovery -> Persisted in isolated DB", async () => {
    const paperData: NormalizedExternalPaper = {
      id: "disc_us_breast_001",
      title: "Artificial intelligence in breast ultrasound",
      authors: [{ name: "Zhang Wei" }, { name: "Li Na" }],
      journal: "World Journal of Radiology",
      year: 2019,
      doi: "10.4329/wjr.v11.i2.19",
      abstract:
        "Artificial intelligence (AI) is gaining extensive attention for its excellent performance in image-recognition tasks and increasingly applied in breast ultrasound. AI can conduct a quantitative assessment by recognizing imaging information automatically.",
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
      sourceProviders: ["CITED_EVIDENCE"],
    };

    const res = await executePaperMetadataImport(paperData, userA.id);
    assert.ok(res.success, "Reference import should succeed");
    assert.ok(res.paperId, "Should return persisted paper ID");
    createdPaperIds.push(res.paperId);

    const savedBookmark = await prisma.bookmark.findUnique({
      where: {
        userId_paperId: {
          userId: userA.id,
          paperId: res.paperId,
        },
      },
    });
    assert.ok(savedBookmark, "Bookmark must be persisted in PostgreSQL");

    const savedPaper = await prisma.paper.findUnique({
      where: { id: res.paperId },
      include: { _count: { select: { chunks: true } } },
    });
    assert.ok(savedPaper, "Paper record must exist");
    assert.equal(savedPaper.status, "METADATA_ONLY", "Initial status must be METADATA_ONLY");
    assert.equal(savedPaper._count.chunks, 0, "No chunks should exist prior to PDF acquisition");
    assert.equal(savedPaper.storagePath, null, "No storagePath should exist yet");
  });

  await t.test("2. Open My Library -> Paper is visible with METADATA_ONLY status", async () => {
    const libraryItems = await getUserLibraryItems(userA.id);
    const targetItem = libraryItems.find((i) => i.doi === "10.4329/wjr.v11.i2.19");

    assert.ok(targetItem, "Saved paper must appear in user's library items");
    assert.equal(targetItem.title, "Artificial intelligence in breast ultrasound");
    assert.equal(targetItem.status, "METADATA_ONLY");
    assert.equal(targetItem.hasPdf, false);
    assert.equal(targetItem.canChat, false, "Chat disabled when no full-text chunks indexed");
    assert.equal(targetItem.chunkCount, 0);
  });

  await t.test("3. Find & Attach Full Text -> Eligible open-access PDF acquired and processed", async () => {
    const testDoi = "10.1016/j.jmi.2024.el.002";
    oaService.invalidateDiscoveryCache(testDoi);

    // Create an eligible paper with permissive license (CC-BY)
    const eligiblePaperData: NormalizedExternalPaper = {
      id: "disc_us_eligible_002",
      title: "Deep learning automated sonographic lesion segmentation with open dataset",
      authors: [{ name: "Sarah Lin" }, { name: "David Kim" }],
      journal: "Journal of Medical Imaging and AI",
      year: 2024,
      doi: testDoi,
      abstract:
        "Quantitative ultrasound radiomics with deep attention layers achieved 93.4% accuracy across validated clinical cohorts.",
      isOpenAccess: true,
      fullTextAvailability: "METADATA_ONLY",
      sourceProviders: ["CROSSREF"],
    };

    const imp = await executePaperMetadataImport(eligiblePaperData, userA.id);
    assert.ok(imp.success);
    assert.ok(imp.paperId);
    createdPaperIds.push(imp.paperId!);

    // Mock remote Unpaywall API and PDF download
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = typeof input === "string" ? input : input.toString();

      if (urlStr.includes("api.unpaywall.org")) {
        return new Response(
          JSON.stringify({
            is_oa: true,
            best_oa_location: {
              url_for_pdf: "https://europepmc.org/articles/sample_cc_by.pdf",
              url_for_landing_page: "https://europepmc.org/articles/sample_article",
              license: "cc-by",
              version: "publishedVersion",
              host_type: "publisher",
            },
            oa_locations: [
              {
                url_for_pdf: "https://europepmc.org/articles/sample_cc_by.pdf",
                url_for_landing_page: "https://europepmc.org/articles/sample_article",
                license: "cc-by",
                version: "publishedVersion",
                host_type: "publisher",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (urlStr.includes("sample_cc_by.pdf")) {
        return new Response(samplePdfBuffer, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": samplePdfBuffer.length.toString(),
          },
        });
      }

      return originalFetch(input);
    };

    try {
      const result = await discoverAndProcessPaperOpenAccess(imp.paperId!, userA.id);
      assert.ok(result.success, "Open-access workflow should succeed");
      assert.equal(result.hasFullText, true, "Full text should be marked acquired");
      assert.equal(result.status, "READY_FOR_AI");

      // Verify DB state
      const updatedPaper = await prisma.paper.findUnique({
        where: { id: imp.paperId },
        include: { _count: { select: { chunks: true } } },
      });
      assert.ok(updatedPaper);
      assert.equal(updatedPaper.status, "COMPLETED");
      assert.ok(updatedPaper.storagePath !== null, "Storage path must be set");
      assert.ok(updatedPaper._count.chunks > 0, "Chunks must be extracted");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("4. Restricted or unavailable PDF fallback -> Preserves external link, does not claim ready", async () => {
    const testDoi = "10.1007/s00330-023-restr.003";
    oaService.invalidateDiscoveryCache(testDoi);

    const restrictedPaperData: NormalizedExternalPaper = {
      id: "disc_us_restricted_003",
      title: "Clinical constraints in ultrasound AI deployment (Restricted License)",
      authors: [{ name: "John Taylor" }],
      journal: "European Radiology",
      year: 2023,
      doi: testDoi,
      abstract: "Retrospective single-center cohort with restricted redistribution rights.",
      isOpenAccess: true,
      openAccessPdfUrl: "https://link.springer.com/content/pdf/10.1007/s00330-restr.pdf",
      fullTextAvailability: "METADATA_ONLY",
      sourceProviders: ["CROSSREF"],
    };

    const imp = await executePaperMetadataImport(restrictedPaperData, userA.id);
    assert.ok(imp.success);
    assert.ok(imp.paperId);
    createdPaperIds.push(imp.paperId!);

    // Mock discovery returning non-commercial license (restricted automated acquisition)
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = typeof input === "string" ? input : input.toString();

      if (urlStr.includes("api.unpaywall.org")) {
        return new Response(
          JSON.stringify({
            is_oa: true,
            best_oa_location: {
              url_for_pdf: "https://link.springer.com/content/pdf/10.1007/s00330-restr.pdf",
              url_for_landing_page: "https://link.springer.com/article/10.1007/s00330-restr",
              license: "cc-by-nc-nd",
              version: "publishedVersion",
              host_type: "publisher",
            },
            oa_locations: [
              {
                url_for_pdf: "https://link.springer.com/content/pdf/10.1007/s00330-restr.pdf",
                url_for_landing_page: "https://link.springer.com/article/10.1007/s00330-restr",
                license: "cc-by-nc-nd",
                version: "publishedVersion",
                host_type: "publisher",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return originalFetch(input);
    };

    try {
      const result = await discoverAndProcessPaperOpenAccess(imp.paperId!, userA.id);
      assert.ok(result.success, "Discovery succeeds in identifying external link");
      assert.equal(result.hasFullText, false, "Must NOT claim full text acquired");
      assert.equal(result.status, "OPEN_ACCESS_EXTERNAL_LINK_ONLY");
      assert.match(result.message, /external reading link preserved|restricted/i);

      // Verify DB record has external link preserved but remains METADATA_ONLY
      const paperInDb = await prisma.paper.findUnique({
        where: { id: imp.paperId },
        include: { _count: { select: { chunks: true } } },
      });
      assert.ok(paperInDb);
      assert.equal(paperInDb.status, "METADATA_ONLY");
      assert.equal(paperInDb.storagePath, null);
      assert.equal(paperInDb._count.chunks, 0);
      assert.ok(paperInDb.pdfUrl !== null, "External link must be preserved in paper record");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test("5. Direct Upload My PDF -> Reuses known metadata and creates zero duplicates", async () => {
    // Grab the restricted paper from step 4
    const libraryBefore = await getUserLibraryItems(userA.id);
    const targetItem = libraryBefore.find((i) => i.doi === "10.1007/s00330-023-restr.003");
    assert.ok(targetItem, "Target metadata-only item should exist in library");

    // Upload private PDF without re-entering metadata (Direct Attach)
    const attachResult = await attachPdfToExistingPaper({
      userId: userA.id,
      paperId: targetItem.id,
      fileBuffer: samplePdfBuffer,
      filename: "my_authorized_breast_ultrasound.pdf",
      autoProcess: true,
    });

    assert.ok(attachResult.success, "Direct PDF attach should succeed");
    assert.ok(attachResult.paperId, "Must return paper ID");
    createdPaperIds.push(attachResult.paperId);

    // Refresh library and verify EXACTLY 1 item exists for this paper
    const libraryAfter = await getUserLibraryItems(userA.id);
    const matchingItems = libraryAfter.filter(
      (i) => i.title === "Clinical constraints in ultrasound AI deployment (Restricted License)"
    );

    assert.equal(
      matchingItems.length,
      1,
      "Zero duplicates guarantee: user must see exactly 1 library record for this paper"
    );

    const attachedItem = matchingItems[0];
    assert.equal(attachedItem.status, "COMPLETED", "Status must transition to COMPLETED");
    assert.ok(attachedItem.chunkCount > 0, "Chunks must be extracted and indexed");
    assert.equal(attachedItem.hasPdf, true, "hasPdf must be true");
    assert.equal(attachedItem.canChat, true, "Chat must be enabled");
    assert.equal(attachedItem.isPrivate, true, "Must be tagged as private copy");

    // Reused canonical metadata verified
    assert.equal(attachedItem.title, targetItem.title, "Title preserved");
    assert.deepEqual(attachedItem.authors, targetItem.authors, "Authors preserved");
    assert.equal(attachedItem.journal, targetItem.journal, "Journal preserved");
  });

  await t.test("6. Multi-Tenant Isolation -> Public paper unchanged, other users not contaminated", async () => {
    // User B also saved the public paper originally
    const publicPaper = await prisma.paper.findFirst({
      where: {
        doi: "10.1007/s00330-023-restr.003",
        sourceProvenance: {
          path: ["isPrivate"],
          equals: false,
        },
      },
    });

    if (publicPaper) {
      await prisma.bookmark.create({
        data: {
          userId: userB.id,
          paperId: publicPaper.id,
        },
      });

      const userBLibrary = await getUserLibraryItems(userB.id);
      const userBItem = userBLibrary.find((i) => i.id === publicPaper.id);

      assert.ok(userBItem, "User B still has the public paper in their library");
      assert.equal(userBItem.isPrivate, false, "User B's paper is public");
      assert.equal(userBItem.status, "METADATA_ONLY", "User B's copy was not affected by User A's private upload");
      assert.equal(userBItem.hasPdf, false);
      assert.equal(userBItem.chunkCount, 0);
    }
  });

  await t.test("7. AI Research Snapshot -> Verified claims, distinct retrieved vs cited counts, abstract-only label", async () => {
    const mockRetrievedPapers: NormalizedExternalPaper[] = [
      {
        id: "snap_p1",
        title: "Artificial intelligence in ultrasound",
        abstract:
          "In contrast, artificial intelligence (AI) excels at automatically recognizing complex patterns and providing quantitative assessment for imaging data, showing high potential to assist physicians in acquiring more accurate results.",
        authors: [{ name: "Zhang Wei" }],
        year: 2021,
        isOpenAccess: false,
        sourceProviders: ["PUBMED"],
        fullTextAvailability: "METADATA_ONLY",
      },
      {
        id: "snap_p2",
        title: "Introduction to artificial intelligence in ultrasound imaging in obstetrics and gynecology",
        abstract:
          "Artificial intelligence (AI) uses data and algorithms to aim to draw conclusions that are as good as, or even better than, those drawn by humans.",
        authors: [{ name: "Li Na" }],
        year: 2020,
        isOpenAccess: true,
        sourceProviders: ["PUBMED"],
        fullTextAvailability: "METADATA_ONLY",
      },
      {
        id: "snap_p3",
        title: "Towards Clinical Application of Artificial Intelligence in Ultrasound Imaging",
        abstract:
          "Artificial intelligence (AI) is being increasingly adopted in medical research and applications across diagnostic screening.",
        authors: [{ name: "Elena Vance" }],
        year: 2021,
        isOpenAccess: false,
        sourceProviders: ["PUBMED"],
        fullTextAvailability: "METADATA_ONLY",
      },
      // 5 additional search results to simulate 8 retrieved papers
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `snap_extra_${i}`,
        title: `Extra ultrasound study ${i + 1}`,
        abstract: `Substantive abstract describing ultrasound clinical study number ${i + 1} with methodology and validation cohorts.`,
        authors: [{ name: `Author ${i}` }],
        year: 2022,
        isOpenAccess: true,
        sourceProviders: ["PUBMED" as const],
        fullTextAvailability: "METADATA_ONLY" as const,
      })),
    ];

    const snapshot = await generateResearchSnapshot(
      "artificial intelligence in ultrasound",
      mockRetrievedPapers,
      {
        forceRefresh: true,
        evidenceMode: "ABSTRACT_EVIDENCE",
      }
    );

    // Verify distinct counts
    assert.equal(snapshot.retrievedCount, 8, "Must report total retrieved count (8)");
    assert.equal(snapshot.citedCount, 3, "Must report exact cited count (3)");
    assert.equal(snapshot.citations.length, 3, "Citations array must contain exactly the 3 cited papers");

    // Verify claims are qualified and ungrounded comparative claims removed
    assert.doesNotMatch(
      snapshot.findings,
      /multi-task architectures/i,
      "Must not claim unverified 'multi-task architectures'"
    );
    assert.doesNotMatch(
      snapshot.findings,
      /superior sensitivity over traditional baselines/i,
      "Must not claim ungrounded 'superior sensitivity over traditional baselines'"
    );
    assert.match(
      snapshot.findings,
      /varying across specific clinical datasets and organ targets rather than demonstrating uniform superiority/i,
      "Must qualify comparative performance conservatively"
    );

    // Verify evidence mode
    assert.equal(snapshot.evidenceMode, "ABSTRACT_EVIDENCE", "Must preserve abstract-only mode");
  });
});
