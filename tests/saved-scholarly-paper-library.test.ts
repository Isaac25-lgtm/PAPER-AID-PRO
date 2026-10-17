/**
 * AI RESEARCH HUB — SAVED SCHOLARLY PAPER LIBRARY REGRESSION TEST SUITE
 *
 * Verifies P0 Fix:
 * 1. Authenticated researcher saves paper from /discover -> creates Paper + Bookmark.
 * 2. Paper is immediately visible in My Library (All Papers / Saved References).
 * 3. Refreshing preserves the saved paper.
 * 4. Metadata-only DOI records and papers without PDFs appear properly.
 * 5. Duplicate saves are strictly idempotent (no duplicate papers, no duplicate bookmarks).
 * 6. Two different researcher accounts: multi-tenant isolation, shared canonical paper, independent bookmarks.
 * 7. Provider results with incomplete metadata (no DOI, no authors, no date) import safely.
 * 8. Unauthenticated saves fail closed.
 * 9. Failed database transactions roll back atomically.
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

// 1. ISOLATION PRE-FLIGHT
loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { NormalizedExternalPaper } from "../src/lib/discovery/types";
import { getUserLibraryItems, deleteUserLibraryItem } from "../src/lib/library/user-library-service";
import { matchPapersAgainstLocalLibrary } from "../src/lib/discovery/library-matcher";

// Mock getServerSession dynamically
let mockCurrentSession: { user: { id: string; role: string; email?: string } } | null = null;
const nextAuthNext = require("next-auth/next");
nextAuthNext.getServerSession = async () => mockCurrentSession;

// Import action after session mocking setup
import { importPaperMetadataAction } from "../src/lib/discovery/import-actions";

describe("Saved Scholarly Paper Missing From My Library (P0 Bug)", () => {
  let userA: { id: string; email: string };
  let userB: { id: string; email: string };

  const testDoi1 = "10.1016/j.cell.2026.reg.001";
  const testDoi2 = "10.1038/s41586-026-reg-002";
  const testTitle1 = "Single-Cell Spatial Genomic Benchmarks in Oncology";
  const testTitle2 = "Metabolic Regulation of Immune Cell Exhaustion (Metadata Only)";

  before(async () => {
    // Clean up test users and test papers from prior runs
    await prisma.bookmark.deleteMany({
      where: {
        paper: {
          doi: { in: [testDoi1, testDoi2] },
        },
      },
    });
    await prisma.paperAuthor.deleteMany({
      where: {
        paper: {
          doi: { in: [testDoi1, testDoi2] },
        },
      },
    });
    await prisma.paper.deleteMany({
      where: {
        doi: { in: [testDoi1, testDoi2] },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: { in: ["scholar_a_test@academic.local", "scholar_b_test@academic.local"] },
      },
    });

    userA = await prisma.user.create({
      data: {
        email: "scholar_a_test@academic.local",
        name: "Dr. Alpha Researcher",
        passwordHash: "fake_hash_alpha_123",
        role: "USER",
      },
    });

    userB = await prisma.user.create({
      data: {
        email: "scholar_b_test@academic.local",
        name: "Dr. Beta Researcher",
        passwordHash: "fake_hash_beta_456",
        role: "USER",
      },
    });
  });

  after(async () => {
    // Teardown test artifacts
    await prisma.bookmark.deleteMany({
      where: {
        paper: {
          doi: { in: [testDoi1, testDoi2] },
        },
      },
    });
    await prisma.paperAuthor.deleteMany({
      where: {
        paper: {
          doi: { in: [testDoi1, testDoi2] },
        },
      },
    });
    await prisma.paper.deleteMany({
      where: {
        doi: { in: [testDoi1, testDoi2] },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: { in: ["scholar_a_test@academic.local", "scholar_b_test@academic.local"] },
      },
    });
  });

  it("1. Complete workflow: Authenticated researcher searches, saves paper, verifies persistence and My Library visibility", async () => {
    mockCurrentSession = { user: { id: userA.id, role: "USER", email: userA.email } };

    const externalPaper1: NormalizedExternalPaper = {
      id: "ext-cell-2026-reg-001",
      doi: testDoi1,
      title: testTitle1,
      abstract: "A comprehensive benchmark on single-cell spatial transcriptomics.",
      authors: [{ name: "Sarah Connor" }, { name: "Kyle Reese" }],
      journal: "Cell",
      year: 2026,
      citationCount: 55,
      isOpenAccess: true,
      fullTextAvailability: "METADATA_ONLY",
      sourceProviders: ["SEMANTIC_SCHOLAR", "CROSSREF"],
    };

    // Step A: Click Save to My Library (importPaperMetadataAction)
    const importRes = await importPaperMetadataAction(externalPaper1, { attemptFullTextFetch: false });
    assert.equal(importRes.success, true, "Import action should return success: true");
    assert.ok(importRes.paperId, "Import action should return a valid paperId");
    assert.equal(importRes.isExisting, false, "First save should create a new paper");

    // Step B: Query persisted database Paper record
    const paperInDb = await prisma.paper.findUnique({
      where: { id: importRes.paperId },
      include: { authors: { include: { author: true } } },
    });
    assert.ok(paperInDb, "Canonical Paper record must exist in PostgreSQL");
    assert.equal(paperInDb.doi, testDoi1);
    assert.equal(paperInDb.title, testTitle1);
    assert.equal(paperInDb.status, "METADATA_ONLY");
    assert.equal(paperInDb.authors.length, 2);

    // Step C: Query persisted database Bookmark record
    const bookmarkInDb = await prisma.bookmark.findUnique({
      where: {
        userId_paperId: {
          userId: userA.id,
          paperId: importRes.paperId,
        },
      },
    });
    assert.ok(bookmarkInDb, "Bookmark record must exist linking authenticated user to the saved paper");

    // Step D: Open My Library (getUserLibraryItems)
    const libraryItems = await getUserLibraryItems(userA.id);
    const savedItem = libraryItems.find((i) => i.id === importRes.paperId);
    assert.ok(savedItem, "Saved paper must appear in user's library items");
    assert.equal(savedItem.title, testTitle1);
    assert.equal(savedItem.doi, testDoi1);
    assert.equal(savedItem.isPrivate, false, "Scholarly paper should not be flagged as private upload");
    assert.equal(savedItem.documentType, "PUBLISHED_PAPER");
    assert.equal(savedItem.hasPdf, false, "Metadata-only paper should have hasPdf: false");

    // Step E: Refresh (subsequent getUserLibraryItems call)
    const refreshedLibraryItems = await getUserLibraryItems(userA.id);
    const refreshedItem = refreshedLibraryItems.find((i) => i.id === importRes.paperId);
    assert.ok(refreshedItem, "Paper must remain in user's library after refresh");

    // Step F: /discover library-matcher verification
    const matched = await matchPapersAgainstLocalLibrary([externalPaper1], userA.id);
    assert.equal(matched[0].localStatus?.inLibrary, true, "Matcher must report inLibrary: true for user A");
    assert.equal(matched[0].localStatus?.paperId, importRes.paperId);
  });

  it("2. Metadata-only papers without PDFs are included in My Library (All Papers & Saved References)", async () => {
    mockCurrentSession = { user: { id: userA.id, role: "USER", email: userA.email } };

    const externalPaper2: NormalizedExternalPaper = {
      id: "ext-nature-2026-reg-002",
      doi: testDoi2,
      title: testTitle2,
      abstract: "Detailed study of T-cell metabolic changes under chronic antigen exposure.",
      authors: [{ name: "Ada Lovelace" }],
      journal: "Nature",
      year: 2026,
      citationCount: 12,
      isOpenAccess: false, // Paywalled / No PDF
      fullTextAvailability: "USER_UPLOAD_REQUIRED",
      sourceProviders: ["CROSSREF"],
    };

    const res = await importPaperMetadataAction(externalPaper2, { attemptFullTextFetch: false });
    assert.equal(res.success, true);
    assert.ok(res.paperId);

    const libraryItems = await getUserLibraryItems(userA.id);
    const paper2Item = libraryItems.find((i) => i.id === res.paperId);
    assert.ok(paper2Item, "Metadata-only paper without PDF must be present in My Library");
    assert.equal(paper2Item.hasPdf, false);
    assert.equal(paper2Item.status, "METADATA_ONLY");
    assert.equal(paper2Item.isPrivate, false);
  });

  it("3. Duplicate saves are idempotent and do not create duplicate library entries", async () => {
    mockCurrentSession = { user: { id: userA.id, role: "USER", email: userA.email } };

    const externalPaper1: NormalizedExternalPaper = {
      id: "ext-cell-2026-reg-001",
      doi: testDoi1,
      title: testTitle1,
      authors: [{ name: "Sarah Connor" }, { name: "Kyle Reese" }],
      journal: "Cell",
      year: 2026,
      isOpenAccess: true,
      fullTextAvailability: "METADATA_ONLY",
      sourceProviders: ["SEMANTIC_SCHOLAR"],
    };

    // Save the exact same paper a second time
    const secondImport = await importPaperMetadataAction(externalPaper1, { attemptFullTextFetch: false });
    assert.equal(secondImport.success, true);
    assert.equal(secondImport.isExisting, true, "Second import should flag isExisting: true");

    // Verify exactly 1 Paper record exists with testDoi1
    const paperCount = await prisma.paper.count({ where: { doi: testDoi1 } });
    assert.equal(paperCount, 1, "There must be exactly one canonical Paper in the database");

    // Verify exactly 1 Bookmark record exists for userA and this paper
    const bookmarkCount = await prisma.bookmark.count({
      where: {
        userId: userA.id,
        paperId: secondImport.paperId,
      },
    });
    assert.equal(bookmarkCount, 1, "User must have exactly one Bookmark record (no duplicates)");

    // Verify getUserLibraryItems does not duplicate the entry
    const libraryItems = await getUserLibraryItems(userA.id);
    const matchingEntries = libraryItems.filter((i) => i.doi === testDoi1);
    assert.equal(matchingEntries.length, 1, "My Library must display the paper exactly once");
  });

  it("4. Multi-tenant isolation: User B searches, sees inLibrary: false, saves, and both users retain independent associations", async () => {
    const externalPaper1: NormalizedExternalPaper = {
      id: "ext-cell-2026-reg-001",
      doi: testDoi1,
      title: testTitle1,
      authors: [{ name: "Sarah Connor" }],
      isOpenAccess: true,
      fullTextAvailability: "METADATA_ONLY",
      sourceProviders: ["SEMANTIC_SCHOLAR"],
    };

    // Step A: User B has not saved paper 1 yet
    const userBLibraryBefore = await getUserLibraryItems(userB.id);
    assert.equal(
      userBLibraryBefore.some((i) => i.doi === testDoi1),
      false,
      "User B's library must not contain User A's paper prior to saving"
    );

    // Step B: User B searches on /discover -> inLibrary must be FALSE
    const userBMatchBefore = await matchPapersAgainstLocalLibrary([externalPaper1], userB.id);
    assert.equal(
      userBMatchBefore[0].localStatus?.inLibrary,
      false,
      "Matcher must return inLibrary: false for User B before User B saves it"
    );
    assert.ok(
      userBMatchBefore[0].localStatus?.paperId,
      "Matcher should still provide the canonical paperId for local paper inspection"
    );

    // Step C: User B saves paper 1
    mockCurrentSession = { user: { id: userB.id, role: "USER", email: userB.email } };
    const userBSaveRes = await importPaperMetadataAction(externalPaper1, { attemptFullTextFetch: false });
    assert.equal(userBSaveRes.success, true);
    assert.equal(userBSaveRes.isExisting, true, "Paper record already existed and was reused");

    // Step D: Both users now have distinct bookmarks
    const userABookmark = await prisma.bookmark.findUnique({
      where: { userId_paperId: { userId: userA.id, paperId: userBSaveRes.paperId! } },
    });
    const userBBookmark = await prisma.bookmark.findUnique({
      where: { userId_paperId: { userId: userB.id, paperId: userBSaveRes.paperId! } },
    });
    assert.ok(userABookmark, "User A bookmark must still exist");
    assert.ok(userBBookmark, "User B bookmark must exist");
    assert.notEqual(userABookmark.id, userBBookmark.id, "Bookmarks must be distinct rows");

    // Step E: Both users now see the paper in their respective libraries
    const userALibrary = await getUserLibraryItems(userA.id);
    const userBLibrary = await getUserLibraryItems(userB.id);
    assert.ok(userALibrary.some((i) => i.id === userBSaveRes.paperId));
    assert.ok(userBLibrary.some((i) => i.id === userBSaveRes.paperId));

    // Step F: User B deletes their bookmark -> does NOT affect User A or canonical paper
    await deleteUserLibraryItem(userB.id, userBSaveRes.paperId!);
    const userBLibraryAfterDelete = await getUserLibraryItems(userB.id);
    const userALibraryAfterDelete = await getUserLibraryItems(userA.id);
    assert.equal(userBLibraryAfterDelete.some((i) => i.id === userBSaveRes.paperId), false);
    assert.equal(userALibraryAfterDelete.some((i) => i.id === userBSaveRes.paperId), true);

    const canonicalPaperStillExists = await prisma.paper.findUnique({
      where: { id: userBSaveRes.paperId },
    });
    assert.ok(canonicalPaperStillExists, "Canonical public paper must remain intact when user removes bookmark");
  });

  it("5. Provider results with incomplete metadata import safely without crashing", async () => {
    mockCurrentSession = { user: { id: userA.id, role: "USER", email: userA.email } };

    const incompletePaper: NormalizedExternalPaper = {
      id: "ext-incomplete-9999",
      title: "Extremely Novel Preliminary Observations In Theoretical Physics",
      authors: [], // No authors
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
      sourceProviders: ["CROSSREF"],
      // No DOI, no PMID, no journal, no abstract, no publicationDate
    };

    const res = await importPaperMetadataAction(incompletePaper, { attemptFullTextFetch: false });
    assert.equal(res.success, true, "Incomplete paper metadata should still import successfully");
    assert.ok(res.paperId);

    const libraryItems = await getUserLibraryItems(userA.id);
    const item = libraryItems.find((i) => i.id === res.paperId);
    assert.ok(item, "Incomplete paper must appear in user's library");
    assert.equal(item.authors.length, 0);
    assert.equal(item.abstract, "Abstract not provided in scholarly metadata.");

    // Clean up incomplete paper
    await prisma.bookmark.deleteMany({ where: { paperId: res.paperId } });
    await prisma.paper.delete({ where: { id: res.paperId } });
  });

  it("6. Unauthenticated saves fail closed", async () => {
    mockCurrentSession = null; // Unauthenticated guest

    const externalPaper: NormalizedExternalPaper = {
      id: "ext-guest-attempt",
      doi: "10.1016/j.cell.2026.guest.fail",
      title: "Unauthenticated Save Test",
      authors: [{ name: "Anon" }],
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
      sourceProviders: ["CROSSREF"],
    };

    const res = await importPaperMetadataAction(externalPaper);
    assert.equal(res.success, false);
    assert.match(res.error || "", /Authentication required/i);

    // Verify nothing was written to database
    const paper = await prisma.paper.findFirst({
      where: { doi: "10.1016/j.cell.2026.guest.fail" },
    });
    assert.equal(paper, null, "No paper record should be created when unauthenticated");
  });

  it("7. Database transaction failure handles rollback cleanly", async () => {
    mockCurrentSession = { user: { id: "non-existent-user-id-999999", role: "USER" } };

    const externalPaper: NormalizedExternalPaper = {
      id: "ext-tx-fail",
      doi: "10.1016/j.cell.2026.tx.fail",
      title: "Transaction Rollback Verification Paper",
      authors: [{ name: "Test Author" }],
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
      sourceProviders: ["CROSSREF"],
    };

    // User ID does not exist in User table -> Bookmark foreign key will fail, rolling back the Paper creation
    const res = await importPaperMetadataAction(externalPaper);
    assert.equal(res.success, false, "Save action must return false when foreign key fails");
    assert.ok(res.error, "Error message must be present");

    // Verify paper was rolled back and does not exist as an orphan
    const orphanPaper = await prisma.paper.findFirst({
      where: { doi: "10.1016/j.cell.2026.tx.fail" },
    });
    assert.equal(orphanPaper, null, "Paper creation must be rolled back atomically when bookmark fails");
  });
});
