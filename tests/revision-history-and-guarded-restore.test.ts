/**
 * AI RESEARCH HUB — REVISION HISTORY & GUARDED RESTORE ACCEPTANCE TEST SUITE
 *
 * Verifies all requirements for Revision History & Guarded Restore:
 * 1. Isolated test environment guard verification (strictly runs against ai_research_hub_test).
 * 2. Atomic pre-change snapshot creation with distinct preservation of:
 *    - TipTap content AST & textContent
 *    - Citation style (cslStyleId)
 *    - Structured citation records & bibliographic metadata
 *    - Attached-source linked papers
 * 3. No-op save deduplication (zero version bump, zero duplicate snapshots).
 * 4. Stale restore requests & autosave-race concurrency conflict handling (CONCURRENT_SAVE_CONFLICT).
 * 5. Cross-document revision injection rejection (revisions belonging to other documents, even by same owner).
 * 6. Ownership scoping: non-owners cannot list, preview, or restore revisions.
 * 7. Ownership-checked guarded restore: restores target revision, creates pre-restore snapshot, bumps version.
 * 8. Missing-reference refusal & zero-mutation preservation (missing paper/chunk refuses restore; zero writes).
 * 9. Rollback guarantee after injected write failure (zero orphaned pre-restore snapshots or partial writes).
 * 10. Configurable retention limit pruning (prunes oldest snapshots when exceeding limit).
 * 11. Read-only behavior across ALL advertised historical export formats (markdown, text, html, bibtex, ris, json, docx, pdf).
 * 12. Clean teardown of disposable test records.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  assertDisposableDatabaseMarker,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { prisma } from "../src/lib/prisma";
import { DocumentType, CitationType, UserRole } from "@prisma/client";
import {
  createResearchDocument,
  getResearchDocument,
  updateResearchDocument,
  insertDocumentCitation,
  attachDocumentPaper,
  acquireDocumentTransactionGuard,
  ManuscriptExportFormat,
} from "../src/lib/editor/document-service";
import {
  listDocumentRevisions,
  getDocumentRevision,
  restoreDocumentRevision,
  exportDocumentRevision,
  createDocumentRevisionSnapshot,
  getRevisionRetentionLimit,
  isDocumentRevisionSchemaReady,
  resetSchemaReadyCache,
  setSchemaReadyOverrideForTesting,
  setRestoreFaultHookForTesting,
  setSnapshotFaultHookForTesting,
} from "../src/lib/editor/revision-service";

describe("Revision History & Guarded Restore Acceptance Suite", () => {
  let ownerUserId: string;
  let otherUserId: string;
  let testPaperId: string;
  let chunkIdForTestPaper: string;
  let deletedPaperId: string;
  let testDocId: string;
  let secondDocId: string;

  before(async () => {
    // 1. Verify fail-closed test environment and disposable marker before ANY writes
    const testIsolation = assertIsolatedTestEnvironment();
    assert.equal(testIsolation.isIsolated, true);
    await assertDisposableDatabaseMarker(prisma);

    // 2. Setup owner test user
    const owner = await prisma.user.create({
      data: {
        email: `revision-owner-${Date.now()}@example.com`,
        name: "Revision Test Owner",
        passwordHash: "disposable-test-hash",
        role: UserRole.USER,
      },
    });
    ownerUserId = owner.id;

    // 3. Setup other test user (for ownership enforcement tests)
    const other = await prisma.user.create({
      data: {
        email: `revision-other-${Date.now()}@example.com`,
        name: "Revision Other User",
        passwordHash: "disposable-test-hash",
        role: UserRole.USER,
      },
    });
    otherUserId = other.id;

    // 4. Create primary test paper with chunk
    const paper = await prisma.paper.create({
      data: {
        title: "Foundation Models for Evidence Grounding",
        abstract: "A comprehensive study on eliminating hallucinations in academic writing.",
        doi: `10.1016/j.test.${Date.now()}`,
        journal: "Journal of Medical Evidence",
        publicationDate: new Date("2025-05-10"),
        sourceProvenance: "OPEN_ACCESS_BENCHMARK",
      },
    });
    testPaperId = paper.id;

    const chunk = await prisma.paperChunk.create({
      data: {
        paperId: testPaperId,
        chunkIndex: 0,
        text: "Exact methodology excerpt for grounded verification.",
        section: "Methodology",
        pageNumber: 12,
      },
    });
    chunkIdForTestPaper = chunk.id;

    // 5. Create paper intended to be deleted later (to test missing-reference refusal)
    const delPaper = await prisma.paper.create({
      data: {
        title: "Ephemeral Manuscript To Be Deleted",
        abstract: "Ephemeral abstract text for testing reference resilience.",
        doi: `10.1016/j.ephemeral.${Date.now()}`,
        journal: "Archival Test Journal",
        publicationDate: new Date("2024-01-01"),
        sourceProvenance: "OPEN_ACCESS_BENCHMARK",
      },
    });
    deletedPaperId = delPaper.id;

    // 6. Ensure baseline catalog exists in test db
    await prisma.cslCatalogRevision.upsert({
      where: { id: "rev-baseline" },
      create: {
        id: "rev-baseline",
        revisionSha: "v1.0.2-baseline-catalog",
        sourceBranch: "v1.0.2",
        status: "ACTIVE",
        isActive: true,
        stylesCount: 10870,
        addedCount: 10870,
        modifiedCount: 0,
        removedCount: 0,
        lastCheckedAt: new Date(),
        activatedAt: new Date(),
      },
      update: {
        isActive: true,
        status: "ACTIVE",
      },
    });
  });

  after(async () => {
    // Teardown disposable records
    if (testDocId) {
      await prisma.documentRevision.deleteMany({ where: { documentId: testDocId } });
      await prisma.documentCitation.deleteMany({ where: { documentId: testDocId } });
      await prisma.documentPaper.deleteMany({ where: { documentId: testDocId } });
      await prisma.researchDocument.deleteMany({ where: { id: testDocId } });
    }
    if (secondDocId) {
      await prisma.documentRevision.deleteMany({ where: { documentId: secondDocId } });
      await prisma.documentCitation.deleteMany({ where: { documentId: secondDocId } });
      await prisma.documentPaper.deleteMany({ where: { documentId: secondDocId } });
      await prisma.researchDocument.deleteMany({ where: { id: secondDocId } });
    }
    if (testPaperId) {
      await prisma.paperChunk.deleteMany({ where: { paperId: testPaperId } });
      await prisma.paper.deleteMany({ where: { id: testPaperId } });
    }
    if (deletedPaperId) {
      await prisma.paperChunk.deleteMany({ where: { paperId: deletedPaperId } });
      await prisma.paper.deleteMany({ where: { id: deletedPaperId } });
    }
    if (ownerUserId) {
      await prisma.user.deleteMany({ where: { id: ownerUserId } });
    }
    if (otherUserId) {
      await prisma.user.deleteMany({ where: { id: otherUserId } });
    }
  });

  test("0. Fail-closed test safety: unmarked database target is refused with zero writes", async () => {
    const mockUnmarkedPrisma = {
      $queryRawUnsafe: async (sql: string) => {
        if (sql.includes("current_database")) {
          return [{ db_name: "unmarked_fake_db", server_addr: "127.0.0.1", server_port: 5432 }];
        }
        if (sql.includes("to_regclass")) {
          return [{ exists: false }];
        }
        return [];
      },
    };

    await assert.rejects(
      async () => {
        await assertDisposableDatabaseMarker(mockUnmarkedPrisma);
      },
      (err: any) => {
        assert.ok(err.message.includes("CRITICAL TEST SAFETY VIOLATION"));
        assert.ok(err.message.includes("marker table missing"));
        return true;
      }
    );
  });

  test("1. Document creation starts at v1 with zero initial revisions", async () => {
    const doc = await createResearchDocument(ownerUserId, {
      title: "Initial Manuscript Draft",
      docType: DocumentType.MANUSCRIPT,
    });
    testDocId = doc.id;

    assert.equal(doc.version, 1);
    assert.equal(doc.title, "Initial Manuscript Draft");

    const revisions = await listDocumentRevisions(ownerUserId, testDocId);
    assert.equal(revisions.length, 0);
  });

  test("2. Attaching source and citation preserves relational and bibliographic context", async () => {
    // Attach source paper
    await attachDocumentPaper(ownerUserId, testDocId, testPaperId);

    // Insert structured citation with passage chunk
    const cit = await insertDocumentCitation(ownerUserId, testDocId, {
      paperId: testPaperId,
      chunkId: chunkIdForTestPaper,
      citationText: "(Grounding Study, 2025)",
      citationKey: "Grounding2025",
      citationType: CitationType.BIBLIOGRAPHIC,
      pageNumber: 12,
      section: "Methodology",
    });

    assert.ok(cit.id);
    assert.equal(cit.pageNumber, 12);
    assert.equal(cit.chunkId, chunkIdForTestPaper);

    const doc = await getResearchDocument(ownerUserId, testDocId);
    assert.equal(doc.citations.length, 1);
    assert.equal(doc.linkedPapers.length, 1);
  });

  test("3. Substantive update triggers atomic pre-change snapshot and version increment", async () => {
    const updated = await updateResearchDocument(ownerUserId, testDocId, {
      title: "Updated Title for Draft",
      textContent: "This is substantive new draft text regarding evidence grounding.",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "This is substantive new draft text regarding evidence grounding.",
              },
            ],
          },
        ],
        meta: {
          citationStyle: "vancouver",
          citationStyleRevision: "v1.0.2-baseline-catalog",
        },
      },
      expectedVersion: 1,
      description: "First major edit: added introduction text and switched to Vancouver",
    });

    assert.equal(updated.version, 2);
    assert.equal(updated.title, "Updated Title for Draft");
    assert.equal(updated.cslStyleId, "vancouver");

    // Verify snapshot v1 was created
    const revisions = await listDocumentRevisions(ownerUserId, testDocId);
    assert.equal(revisions.length, 1);

    const snapV1 = revisions[0];
    assert.equal(snapV1.version, 1);
    assert.equal(snapV1.title, "Initial Manuscript Draft");
    assert.equal(snapV1.citationCount, 1);
    assert.equal(snapV1.sourceCount, 1);

    // Fetch full snapshot detail
    const detailV1 = await getDocumentRevision(ownerUserId, testDocId, snapV1.id);
    assert.equal(detailV1.version, 1);
    assert.equal(detailV1.cslStyleId, "apa"); // original was apa
    const citationsSnapshot = detailV1.citations as any[];
    assert.equal(citationsSnapshot.length, 1);
    assert.equal(citationsSnapshot[0].pageNumber, 12);
    assert.equal(citationsSnapshot[0].chunkId, chunkIdForTestPaper);
    assert.equal(citationsSnapshot[0].paper?.title, "Foundation Models for Evidence Grounding");
  });

  test("4. No-op save deduplication: identical and reordered TipTap JSON object keys create zero revisions and leave version/timestamp intact", async () => {
    const docBefore = await getResearchDocument(ownerUserId, testDocId);
    const revsBefore = await listDocumentRevisions(ownerUserId, testDocId);

    // Call update with reordered object keys in TipTap JSON AST
    const reorderedContent = {
      meta: {
        citationStyleRevision: "v1.0.2-baseline-catalog",
        citationStyle: "vancouver",
      },
      content: [
        {
          content: [
            {
              text: "This is substantive new draft text regarding evidence grounding.",
              type: "text",
            },
          ],
          type: "paragraph",
        },
      ],
      type: "doc",
    };

    const noOpResult = await updateResearchDocument(ownerUserId, testDocId, {
      title: docBefore.title,
      textContent: docBefore.textContent || undefined,
      content: reorderedContent,
      expectedVersion: docBefore.version,
    });

    assert.equal(noOpResult.version, docBefore.version);
    assert.equal(noOpResult.updatedAt.getTime(), docBefore.updatedAt.getTime());

    const revsAfter = await listDocumentRevisions(ownerUserId, testDocId);
    assert.equal(revsAfter.length, revsBefore.length);
  });

  test("5. Controlled overlapping save/save concurrency race: loser returns CONCURRENT_SAVE_CONFLICT with zero changes", async () => {
    const doc = await getResearchDocument(ownerUserId, testDocId);
    const baseVersion = doc.version;
    const revsBefore = await listDocumentRevisions(ownerUserId, testDocId);

    // Launch two simultaneous overlapping save operations with the same expectedVersion
    const savePromise1 = updateResearchDocument(ownerUserId, testDocId, {
      title: "Concurrent Save Race 1",
      textContent: "Update from race 1",
      expectedVersion: baseVersion,
    });
    const savePromise2 = updateResearchDocument(ownerUserId, testDocId, {
      title: "Concurrent Save Race 2",
      textContent: "Update from race 2",
      expectedVersion: baseVersion,
    });

    const results = await Promise.allSettled([savePromise1, savePromise2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1, "Exactly one overlapping save must win the race");
    assert.equal(rejected.length, 1, "Exactly one overlapping save must lose the race");

    const rejectionReason: any = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(
      rejectionReason.message.includes("CONCURRENT_SAVE_CONFLICT"),
      `Expected CONCURRENT_SAVE_CONFLICT error, got: ${rejectionReason.message}`
    );

    // Verify document was updated to exactly baseVersion + 1, not corrupted
    const docAfter = await getResearchDocument(ownerUserId, testDocId);
    assert.equal(docAfter.version, baseVersion + 1);

    // Verify draft content matches winning save
    const winningTitle = (fulfilled[0] as PromiseFulfilledResult<any>).value.title;
    assert.equal(docAfter.title, winningTitle);
    assert.ok(
      docAfter.textContent === "Update from race 1" || docAfter.textContent === "Update from race 2"
    );

    // Verify relation rows remain intact
    assert.equal(docAfter.citations.length, doc.citations.length);
    assert.equal(docAfter.linkedPapers.length, doc.linkedPapers.length);

    // Verify history recorded exactly one new revision representing the pre-change snapshot
    const revsAfter = await listDocumentRevisions(ownerUserId, testDocId);
    assert.equal(revsAfter.length, revsBefore.length + 1);
    const latestSnapshot = revsAfter.find((r) => r.version === baseVersion);
    assert.ok(latestSnapshot, `Snapshot for base version ${baseVersion} must be present`);
  });

  test("5b. Controlled overlapping save/restore concurrency race: loser returns CONCURRENT_SAVE_CONFLICT with zero changes", async () => {
    const doc = await getResearchDocument(ownerUserId, testDocId);
    const baseVersion = doc.version;
    const revisions = await listDocumentRevisions(ownerUserId, testDocId);
    const targetRev = revisions.find((r) => r.version === 1);
    assert.ok(targetRev);

    // Launch simultaneous overlapping save and restore with the same baseVersion
    const savePromise = updateResearchDocument(ownerUserId, testDocId, {
      title: "Concurrent Save During Restore",
      textContent: "Save racing against restore",
      expectedVersion: baseVersion,
    });
    const restorePromise = restoreDocumentRevision(ownerUserId, testDocId, {
      targetRevisionId: targetRev.id,
      expectedCurrentVersion: baseVersion,
    });

    const results = await Promise.allSettled([savePromise, restorePromise]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1, "Exactly one overlapping operation must win");
    assert.equal(rejected.length, 1, "Exactly one overlapping operation must lose");

    const rejectionReason: any = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(
      rejectionReason.message.includes("CONCURRENT_SAVE_CONFLICT"),
      `Expected CONCURRENT_SAVE_CONFLICT error, got: ${rejectionReason.message}`
    );

    // Document must be at baseVersion + 1
    const docAfter = await getResearchDocument(ownerUserId, testDocId);
    assert.equal(docAfter.version, baseVersion + 1);

    // Verify relation rows, draft content, and history are valid and consistent with the winning operation
    const revsAfter = await listDocumentRevisions(ownerUserId, testDocId);
    assert.equal(revsAfter.length, revisions.length + 1);
    assert.ok(docAfter.citations.length >= 1);
    assert.ok(docAfter.linkedPapers.length >= 1);
  });

  test("5c. Ordinary saves on pre-migration schema succeed; unexpected snapshot failures trigger transaction rollback", async () => {
    // Part 1: Real pre-migration schema readiness query and ordinary save on marked disposable database
    resetSchemaReadyCache();
    await prisma.$executeRawUnsafe('ALTER TABLE "document_revisions" RENAME TO "document_revisions_temp_unmigrated"');

    try {
      // Run the REAL readiness query on the disposable database
      const readyOnOldSchema = await isDocumentRevisionSchemaReady();
      assert.equal(readyOnOldSchema, false, "Schema readiness check must return false when document_revisions table is absent");

      const oldSchemaDoc = await createResearchDocument(ownerUserId, {
        title: "Pre-Migration Schema Document",
        docType: DocumentType.DRAFT,
      });

      const saved = await updateResearchDocument(ownerUserId, oldSchemaDoc.id, {
        title: "Pre-Migration Document Updated Title",
        textContent: "Body text on pre-migration schema",
        expectedVersion: 1,
      });

      assert.equal(saved.version, 2);
      assert.equal(saved.title, "Pre-Migration Document Updated Title");
      assert.equal(saved.textContent, "Body text on pre-migration schema");

      // Verify zero revisions were created
      const revCountResult: any = await prisma.$queryRawUnsafe(
        'SELECT count(*)::int as count FROM "document_revisions_temp_unmigrated" WHERE "documentId" = $1',
        oldSchemaDoc.id
      );
      assert.equal(revCountResult[0].count, 0);

      await prisma.researchDocument.deleteMany({ where: { id: oldSchemaDoc.id } });
    } finally {
      // Restore the document_revisions table
      await prisma.$executeRawUnsafe('ALTER TABLE "document_revisions_temp_unmigrated" RENAME TO "document_revisions"');
      resetSchemaReadyCache();
    }

    const readyOnMigratedSchema = await isDocumentRevisionSchemaReady();
    assert.equal(readyOnMigratedSchema, true, "Schema readiness check must return true when document_revisions table is restored");

    // Part 2: Unexpected snapshot failure rolls back the entire save transaction on migrated disposable database
    const docBefore = await getResearchDocument(ownerUserId, testDocId);
    const revsBefore = await listDocumentRevisions(ownerUserId, testDocId);

    setSnapshotFaultHookForTesting((stage) => {
      if (stage === "before_insert") {
        throw new Error("INJECTED_UNEXPECTED_SNAPSHOT_FAILURE");
      }
    });

    await assert.rejects(
      async () => {
        await updateResearchDocument(ownerUserId, testDocId, {
          title: "Title That Must Roll Back",
          textContent: "Text that must roll back",
          expectedVersion: docBefore.version,
        });
      },
      (err: any) => {
        assert.ok(err.message.includes("INJECTED_UNEXPECTED_SNAPSHOT_FAILURE"));
        return true;
      }
    );

    setSnapshotFaultHookForTesting(null);

    // Verify complete transaction rollback: full draft, citation, source, and history state are identical
    const docAfter = await getResearchDocument(ownerUserId, testDocId);
    assert.equal(docAfter.version, docBefore.version);
    assert.equal(docAfter.title, docBefore.title);
    assert.equal(docAfter.textContent, docBefore.textContent);
    assert.deepEqual(docAfter.content, docBefore.content);
    assert.equal(docAfter.updatedAt.getTime(), docBefore.updatedAt.getTime());
    assert.equal(docAfter.citations.length, docBefore.citations.length);
    assert.equal(docAfter.linkedPapers.length, docBefore.linkedPapers.length);

    const revsAfter = await listDocumentRevisions(ownerUserId, testDocId);
    assert.equal(revsAfter.length, revsBefore.length);
  });

  test("5d. Deterministic race between citation or source write and restore: forcing both lock orders", async () => {
    const WAIT_TIMEOUT_MS = 5000;

    interface TrackedTx<T> {
      promise: Promise<T>;
      failSignal: Promise<never>;
      getError: () => Error | null;
    }

    // Observe rejections immediately as soon as each transaction starts
    function trackTransaction<T>(rawPromise: Promise<T>, label: string): TrackedTx<T> {
      let capturedError: Error | null = null;
      let rejectSignal: (err: Error) => void = () => {};
      const failSignal = new Promise<never>((_, reject) => {
        rejectSignal = reject;
      });
      failSignal.catch(() => {});

      const wrapped = rawPromise.catch((err: unknown) => {
        const normalized =
          err instanceof Error ? err : new Error(`${label} failed: ${String(err)}`);
        capturedError = normalized;
        rejectSignal(normalized);
        throw normalized;
      });
      wrapped.catch(() => {});

      return {
        promise: wrapped,
        failSignal,
        getError: () => capturedError,
      };
    }

    async function waitForLockAcquisition(
      isAcquired: () => boolean,
      abortSignals: Promise<never>[],
      label: string,
      timeoutMs = WAIT_TIMEOUT_MS
    ): Promise<void> {
      let stopped = false;
      const poll = async (): Promise<void> => {
        const start = Date.now();
        while (!stopped && Date.now() - start < timeoutMs) {
          if (isAcquired()) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (!stopped) {
          throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
        }
      };
      try {
        await Promise.race([poll(), ...abortSignals]);
      } finally {
        stopped = true;
      }
    }

    // Helper: poll pg_locks until a specific transaction is actively waiting (NOT granted) blocked by holderPid,
    // while immediately surfacing any rejection from either the holder or competing transaction.
    async function waitForSpecificBlocker(
      holderPid: number,
      abortSignals: Promise<never>[],
      timeoutMs = WAIT_TIMEOUT_MS
    ): Promise<number> {
      let stopped = false;
      const poll = async (): Promise<number> => {
        const start = Date.now();
        while (!stopped && Date.now() - start < timeoutMs) {
          const res: any = await prisma.$queryRawUnsafe(
            'SELECT pid FROM pg_locks WHERE NOT granted AND $1 = ANY(pg_blocking_pids(pid))',
            holderPid
          );
          if (res.length > 0 && res[0].pid) {
            return Number(res[0].pid);
          }
          await new Promise((r) => setTimeout(r, 10));
        }
        throw new Error(
          `Timed out waiting for competing transaction to block on holder PID ${holderPid} in pg_locks after ${timeoutMs}ms`
        );
      };
      try {
        return await Promise.race([poll(), ...abortSignals]);
      } finally {
        stopped = true;
      }
    }

    // Dedicated test paper that starts unattached to both documents
    const unattachedPaper = await prisma.paper.create({
      data: {
        title: "Unattached Manuscript for Lock Race",
        abstract: "A manuscript created strictly unattached to test citation and source link coordination under lock contention.",
        doi: `10.1016/j.unattached.${Date.now()}`,
        journal: "Journal of Concurrency & Preservation",
        publicationDate: new Date("2025-06-01"),
        sourceProvenance: "OPEN_ACCESS_BENCHMARK",
      },
    });

    try {
      // =========================================================================
      // FAILURE PATH VERIFICATION: IMMEDIATE REJECTION & BARRIER/HOOK CLEANUP
      // =========================================================================
      const docFailPath = await createResearchDocument(ownerUserId, {
        title: "Lock Failure Path Document",
        docType: DocumentType.MANUSCRIPT,
      });
      const docIdFail = docFailPath.id;
      let failHolderPid: number | null = null;
      let failHolderAcquired = false;
      let releaseFailBarrier: () => void = () => {};
      let failBarrierReleased = false;
      const failBarrier = new Promise<void>((resolve) => {
        releaseFailBarrier = () => {
          if (!failBarrierReleased) {
            failBarrierReleased = true;
            resolve();
          }
        };
      });
      const startedFailTxs: Promise<unknown>[] = [];

      try {
        // 1. Verify immediate rejection during lock acquisition wait when hook/tx throws
        setRestoreFaultHookForTesting(async () => {
          throw new Error("INJECTED_GUARD_ACQUISITION_FAILURE");
        });
        const failingRestoreTx = trackTransaction(
          restoreDocumentRevision(ownerUserId, docIdFail, {
            targetRevisionId: "non-existent-rev",
            expectedCurrentVersion: 1,
          }),
          "Failing restore acquisition"
        );
        startedFailTxs.push(failingRestoreTx.promise);

        const failStart1 = Date.now();
        await assert.rejects(
          async () => {
            await waitForLockAcquisition(
              () => false,
              [failingRestoreTx.failSignal],
              "failing restore guard acquisition"
            );
          },
          /INJECTED_GUARD_ACQUISITION_FAILURE/
        );
        const failElapsed1 = Date.now() - failStart1;
        assert.ok(
          failElapsed1 < 1000,
          `Lock-acquisition failure must surface immediately (took ${failElapsed1}ms)`
        );
        setRestoreFaultHookForTesting(null);

        // 2. Verify immediate rejection of competing transaction while holder holds row lock
        const holderTx = trackTransaction(
          prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id, version FROM "research_documents" WHERE id = ${docIdFail} FOR UPDATE`;
            const pidRes: any = await tx.$queryRaw`SELECT pg_backend_pid() as pid`;
            failHolderPid = Number(pidRes[0].pid);
            failHolderAcquired = true;
            await failBarrier;
          }),
          "Failure-path lock holder"
        );
        startedFailTxs.push(holderTx.promise);

        await waitForLockAcquisition(
          () => failHolderAcquired && failHolderPid !== null,
          [holderTx.failSignal],
          "failure-path holder lock"
        );

        const competingFailTx = trackTransaction(
          prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT 1`;
            throw new Error("INJECTED_COMPETING_TX_FAILURE");
          }),
          "Competing failing transaction"
        );
        startedFailTxs.push(competingFailTx.promise);

        const failStart2 = Date.now();
        await assert.rejects(
          async () => {
            await waitForSpecificBlocker(failHolderPid!, [
              holderTx.failSignal,
              competingFailTx.failSignal,
            ]);
          },
          /INJECTED_COMPETING_TX_FAILURE/
        );
        const failElapsed2 = Date.now() - failStart2;
        assert.ok(
          failElapsed2 < 1000,
          `Competing transaction failure must surface immediately (took ${failElapsed2}ms)`
        );
        console.log(
          `[Test 5d Failure Paths] Verified immediate rejection surfacing (${failElapsed1}ms, ${failElapsed2}ms) and barrier/hook cleanup`
        );
      } finally {
        releaseFailBarrier();
        setRestoreFaultHookForTesting(null);
        await Promise.allSettled(startedFailTxs);
        await prisma.documentCitation.deleteMany({ where: { documentId: docIdFail } });
        await prisma.documentPaper.deleteMany({ where: { documentId: docIdFail } });
        await prisma.documentRevision.deleteMany({ where: { documentId: docIdFail } });
        await prisma.researchDocument.deleteMany({ where: { id: docIdFail } });
      }

      // =========================================================================
      // CASE 1: FORCED LOCK ORDER 1 — WRITER GOES FIRST, RESTORE WAITS FOR LOCK
      // =========================================================================
      const docCase1 = await createResearchDocument(ownerUserId, {
        title: "Lock Order 1 Document",
        docType: DocumentType.MANUSCRIPT,
      });
      const docId1 = docCase1.id;

      // Coordinate lock: Writer acquires row lock, writes new rows, then commits
      let writerPid: number | null = null;
      let writerHoldingLock = false;
      let releaseWriterLock: () => void = () => {};
      let writerReleased = false;
      const writerLockBarrier = new Promise<void>((resolve) => {
        releaseWriterLock = () => {
          if (!writerReleased) {
            writerReleased = true;
            resolve();
          }
        };
      });
      const startedCase1Txs: Promise<unknown>[] = [];

      try {
        // v1: attach baseline paper (unattachedPaper is strictly NOT attached)
        await attachDocumentPaper(ownerUserId, docId1, testPaperId);

        // v2: substantive update, creating Revision 1 snapshot
        await updateResearchDocument(ownerUserId, docId1, {
          title: "Lock Order 1 Document v2",
          textContent: "Content before forced lock race 1",
          expectedVersion: 1,
        });

        const revs1 = await listDocumentRevisions(ownerUserId, docId1);
        const targetRev1 = revs1.find((r) => r.version === 1);
        assert.ok(targetRev1);

        const writerTx1 = trackTransaction(
          prisma.$transaction(async (tx) => {
            // 1. Writer acquires exclusive row lock
            await tx.$queryRaw`SELECT id, version FROM "research_documents" WHERE id = ${docId1} FOR UPDATE`;
            const pidRes: any = await tx.$queryRaw`SELECT pg_backend_pid() as pid`;
            writerPid = Number(pidRes[0].pid);
            writerHoldingLock = true;

            // 2. Insert new source link and new citation for unattached paper while holding lock
            await tx.documentPaper.create({
              data: {
                documentId: docId1,
                paperId: unattachedPaper.id,
              },
            });
            await tx.documentCitation.create({
              data: {
                documentId: docId1,
                paperId: unattachedPaper.id,
                citationText: "(Writer-First Citation, 2026)",
                citationType: CitationType.BIBLIOGRAPHIC,
                pageNumber: 42,
                section: "Discussion",
              },
            });

            // 3. Wait for restore request to launch and contest the lock
            await writerLockBarrier;
          }),
          "Case 1 writer"
        );
        startedCase1Txs.push(writerTx1.promise);

        // Wait until writer confirms it holds the lock and recorded its PID (with timeout and immediate failure detection)
        await waitForLockAcquisition(
          () => writerHoldingLock && writerPid !== null,
          [writerTx1.failSignal],
          "writer to acquire lock and record PID"
        );

        // Launch restore while writer is holding the lock (restore will block waiting on lock)
        const restoreTx1 = trackTransaction(
          restoreDocumentRevision(ownerUserId, docId1, {
            targetRevisionId: targetRev1.id,
            expectedCurrentVersion: 2,
          }),
          "Case 1 restore"
        );
        startedCase1Txs.push(restoreTx1.promise);

        // Observe restore blocked waiting specifically on writerPid in PostgreSQL kernel
        const blockedRestorePid = await waitForSpecificBlocker(writerPid!, [
          writerTx1.failSignal,
          restoreTx1.failSignal,
        ]);
        console.log(
          `[Test 5d Case 1] Writer PID: ${writerPid}, Blocked Restore PID: ${blockedRestorePid} (verified waiting on writer PID via pg_blocking_pids)`
        );
        assert.ok(
          blockedRestorePid > 0,
          `Competing restore transaction (PID ${blockedRestorePid}) must be observed waiting specifically on writer PID ${writerPid}`
        );

        // Release writer lock, allowing writer transaction to commit and restore to acquire lock next
        releaseWriterLock();
        await writerTx1.promise;
        const restoreResult1 = await restoreTx1.promise;
        assert.equal(restoreResult1.success, true);

        // VERIFY FORCED ORDER 1:
        // Both the new citation AND the source link MUST appear in the pre-restore snapshot because writer went first
        const revsAfter1 = await listDocumentRevisions(ownerUserId, docId1);
        const preRestoreSnap1 = revsAfter1.find((r) => r.version === 2);
        assert.ok(preRestoreSnap1, "Pre-restore snapshot of v2 must exist in history");

        const preRestoreDetail1 = await getDocumentRevision(ownerUserId, docId1, preRestoreSnap1.id);
        const preRestoreCitations1 = preRestoreDetail1.citations as any[];
        const hasWriterFirstCitationInSnapshot = preRestoreCitations1.some(
          (c: any) => c.citationText === "(Writer-First Citation, 2026)" && c.paperId === unattachedPaper.id
        );
        assert.equal(
          hasWriterFirstCitationInSnapshot,
          true,
          "When writer goes first, new citation MUST be captured in the recovery snapshot"
        );

        const preRestoreLinked1 = preRestoreDetail1.linkedPapers as any[];
        const hasWriterFirstLinkedPaperInSnapshot = preRestoreLinked1.some(
          (lp: any) => lp.paperId === unattachedPaper.id
        );
        assert.equal(
          hasWriterFirstLinkedPaperInSnapshot,
          true,
          "When writer goes first, new source link MUST be captured in the recovery snapshot"
        );
      } finally {
        // Release barrier, clear hook, and await all started transactions before deleting fixtures
        releaseWriterLock();
        setRestoreFaultHookForTesting(null);
        await Promise.allSettled(startedCase1Txs);
        await prisma.documentCitation.deleteMany({ where: { documentId: docId1 } });
        await prisma.documentPaper.deleteMany({ where: { documentId: docId1 } });
        await prisma.documentRevision.deleteMany({ where: { documentId: docId1 } });
        await prisma.researchDocument.deleteMany({ where: { id: docId1 } });
      }

      // =========================================================================
      // CASE 2: FORCED LOCK ORDER 2 — RESTORE GOES FIRST, WRITER WAITS FOR LOCK
      // =========================================================================
      const docCase2 = await createResearchDocument(ownerUserId, {
        title: "Lock Order 2 Document",
        docType: DocumentType.MANUSCRIPT,
      });
      const docId2 = docCase2.id;

      let restorePid: number | null = null;
      let restoreHoldingLock = false;
      let releaseRestoreLock: () => void = () => {};
      let restoreReleased = false;
      const restoreLockBarrier = new Promise<void>((resolve) => {
        releaseRestoreLock = () => {
          if (!restoreReleased) {
            restoreReleased = true;
            resolve();
          }
        };
      });
      const startedCase2Txs: Promise<unknown>[] = [];

      try {
        // v1: attach baseline paper (unattachedPaper is strictly NOT attached)
        await attachDocumentPaper(ownerUserId, docId2, testPaperId);

        // v2: substantive update, creating Revision 1 snapshot
        await updateResearchDocument(ownerUserId, docId2, {
          title: "Lock Order 2 Document v2",
          textContent: "Content before forced lock race 2",
          expectedVersion: 1,
        });

        const revs2 = await listDocumentRevisions(ownerUserId, docId2);
        const targetRev2 = revs2.find((r) => r.version === 1);
        assert.ok(targetRev2);

        // Install hook so restore pauses while holding the exclusive lock
        setRestoreFaultHookForTesting(async (stage, tx) => {
          if (stage === "after_guard_acquired") {
            const pidRes: any = await tx.$queryRaw`SELECT pg_backend_pid() as pid`;
            restorePid = Number(pidRes[0].pid);
            restoreHoldingLock = true;
            await restoreLockBarrier;
          }
        });

        // Launch restore and observe rejections immediately
        const restoreTx2 = trackTransaction(
          restoreDocumentRevision(ownerUserId, docId2, {
            targetRevisionId: targetRev2.id,
            expectedCurrentVersion: 2,
          }),
          "Case 2 restore"
        );
        startedCase2Txs.push(restoreTx2.promise);

        // Wait until restore has acquired the row lock and recorded its PID (with timeout and immediate failure detection)
        await waitForLockAcquisition(
          () => restoreHoldingLock && restorePid !== null,
          [restoreTx2.failSignal],
          "restore to acquire guard and record PID"
        );

        // While restore is holding the lock, launch writer operation (will block waiting for restore lock)
        // Writer writes BOTH a source link and citation using unattachedPaper
        const writerTx2 = trackTransaction(
          prisma.$transaction(
            async (tx) => {
              await acquireDocumentTransactionGuard(tx, docId2);
              await tx.documentPaper.create({
                data: {
                  documentId: docId2,
                  paperId: unattachedPaper.id,
                },
              });
              await tx.documentCitation.create({
                data: {
                  documentId: docId2,
                  paperId: unattachedPaper.id,
                  citationText: "(Restore-First Citation, 2026)",
                  citationType: CitationType.BIBLIOGRAPHIC,
                  pageNumber: 88,
                  section: "Conclusion",
                },
              });
            },
            { maxWait: 15000, timeout: 30000 }
          ),
          "Case 2 writer"
        );
        startedCase2Txs.push(writerTx2.promise);

        // Observe writer blocked waiting specifically on restorePid in PostgreSQL kernel
        const blockedWriterPid = await waitForSpecificBlocker(restorePid!, [
          restoreTx2.failSignal,
          writerTx2.failSignal,
        ]);
        console.log(
          `[Test 5d Case 2] Restore PID: ${restorePid}, Blocked Writer PID: ${blockedWriterPid} (verified waiting on restore PID via pg_blocking_pids)`
        );
        assert.ok(
          blockedWriterPid > 0,
          `Competing writer transaction (PID ${blockedWriterPid}) must be observed waiting specifically on restore PID ${restorePid}`
        );

        // Release restore lock: restore finishes, snapshots v2 (without writer rows), restores v1, commits
        releaseRestoreLock();
        const restoreResult2 = await restoreTx2.promise;
        assert.equal(restoreResult2.success, true);

        setRestoreFaultHookForTesting(null);

        // Now writer unblocks, acquires lock, and inserts citation & source link on the restored document
        await writerTx2.promise;

        // VERIFY FORCED ORDER 2:
        // 1. Pre-restore snapshot v2 does NOT contain the new citation or the source link (captured before writer ran)
        const revsAfter2 = await listDocumentRevisions(ownerUserId, docId2);
        const preRestoreSnap2 = revsAfter2.find((r) => r.version === 2);
        assert.ok(preRestoreSnap2, "Pre-restore snapshot of v2 must exist in history");

        const preRestoreDetail2 = await getDocumentRevision(ownerUserId, docId2, preRestoreSnap2.id);
        const preRestoreCitations2 = preRestoreDetail2.citations as any[];
        const hasRestoreFirstCitationInSnapshot = preRestoreCitations2.some(
          (c: any) => c.citationText === "(Restore-First Citation, 2026)" || c.paperId === unattachedPaper.id
        );
        assert.equal(
          hasRestoreFirstCitationInSnapshot,
          false,
          "When restore goes first, recovery snapshot was taken before writer ran and must NOT contain the new citation"
        );

        const preRestoreLinked2 = preRestoreDetail2.linkedPapers as any[];
        const hasRestoreFirstLinkedPaperInSnapshot = preRestoreLinked2.some(
          (lp: any) => lp.paperId === unattachedPaper.id
        );
        assert.equal(
          hasRestoreFirstLinkedPaperInSnapshot,
          false,
          "When restore goes first, recovery snapshot was taken before writer ran and must NOT contain the new source link"
        );

        // 2. The restored draft (now at v3) DOES contain BOTH the new citation AND the source link applied on top of the restored draft!
        const docAfter2 = await getResearchDocument(ownerUserId, docId2);
        assert.equal(docAfter2.version, 3);

        const hasRestoreFirstInActiveCitations = docAfter2.citations.some(
          (c: any) => c.citationText === "(Restore-First Citation, 2026)" && c.paperId === unattachedPaper.id
        );
        assert.equal(
          hasRestoreFirstInActiveCitations,
          true,
          "When restore goes first, the new citation MUST appear on the restored draft"
        );

        const hasRestoreFirstInActiveLinked = docAfter2.linkedPapers.some(
          (lp: any) => lp.paperId === unattachedPaper.id
        );
        assert.equal(
          hasRestoreFirstInActiveLinked,
          true,
          "When restore goes first, the new source link MUST appear on the restored draft"
        );
      } finally {
        // Release barrier, clear restore hook, and await all started transactions before deleting fixtures
        releaseRestoreLock();
        setRestoreFaultHookForTesting(null);
        await Promise.allSettled(startedCase2Txs);
        await prisma.documentCitation.deleteMany({ where: { documentId: docId2 } });
        await prisma.documentPaper.deleteMany({ where: { documentId: docId2 } });
        await prisma.documentRevision.deleteMany({ where: { documentId: docId2 } });
        await prisma.researchDocument.deleteMany({ where: { id: docId2 } });
      }
    } finally {
      // Shared paper cleanup around both cases
      setRestoreFaultHookForTesting(null);
      await prisma.paper.deleteMany({ where: { id: unattachedPaper.id } });
    }
  });

  test("6. Cross-document revision rejection: cannot restore revision belonging to another document (even same owner)", async () => {
    const docA = await getResearchDocument(ownerUserId, testDocId);

    // Create Document B owned by the same user
    const docB = await createResearchDocument(ownerUserId, {
      title: "Second Document B",
      docType: DocumentType.DRAFT,
    });
    secondDocId = docB.id;

    // Mutate Document B to produce Revision B1
    await updateResearchDocument(ownerUserId, secondDocId, {
      title: "Updated Document B Title",
      textContent: "Document B body content",
      expectedVersion: 1,
    });

    const revsB = await listDocumentRevisions(ownerUserId, secondDocId);
    assert.equal(revsB.length, 1);
    const revB1 = revsB[0];

    // Attempt to restore Revision B1 into Document A (testDocId)
    await assert.rejects(
      async () => {
        await restoreDocumentRevision(ownerUserId, testDocId, {
          targetRevisionId: revB1.id,
          expectedCurrentVersion: docA.version,
        });
      },
      (err: any) => {
        assert.ok(err.message.includes("does not belong to document"));
        return true;
      }
    );

    // Verify both documents remain completely unchanged
    const docAAfter = await getResearchDocument(ownerUserId, testDocId);
    assert.equal(docAAfter.version, docA.version);
    const docBAfter = await getResearchDocument(ownerUserId, secondDocId);
    assert.equal(docBAfter.version, 2);
  });

  test("7. Ownership scoping: non-owners cannot list, preview, or restore revisions", async () => {
    const doc = await getResearchDocument(ownerUserId, testDocId);

    // Non-owner list attempt
    await assert.rejects(
      async () => {
        await listDocumentRevisions(otherUserId, testDocId);
      },
      (err: any) => {
        assert.ok(err.message.includes("not found"));
        return true;
      }
    );

    // Get snapshot ID
    const revisions = await listDocumentRevisions(ownerUserId, testDocId);
    const snapId = revisions[0].id;

    // Non-owner preview attempt
    await assert.rejects(
      async () => {
        await getDocumentRevision(otherUserId, testDocId, snapId);
      },
      (err: any) => {
        assert.ok(err.message.includes("not found"));
        return true;
      }
    );

    // Non-owner restore attempt
    await assert.rejects(
      async () => {
        await restoreDocumentRevision(otherUserId, testDocId, {
          targetRevisionId: snapId,
          expectedCurrentVersion: doc.version,
        });
      },
      (err: any) => {
        assert.ok(err.message.includes("not found"));
        return true;
      }
    );
  });

  test("8. Missing-reference refusal: missing paper or chunk refuses restore with zero mutations", async () => {
    const docBeforePrep = await getResearchDocument(ownerUserId, testDocId);

    // 1. Create a citation to the ephemeral paper
    await insertDocumentCitation(ownerUserId, testDocId, {
      paperId: deletedPaperId,
      citationText: "(Ephemeral Study, 2024)",
      citationKey: "Ephemeral2024",
      citationType: CitationType.BIBLIOGRAPHIC,
      pageNumber: 5,
    });

    // 2. Perform substantive edit to snapshot this state
    await updateResearchDocument(ownerUserId, testDocId, {
      title: "Manuscript Citing Ephemeral Paper",
      textContent: "Discussing ephemeral findings.",
      expectedVersion: docBeforePrep.version,
    });

    const revisions = await listDocumentRevisions(ownerUserId, testDocId);
    const snapWithEphemeral = revisions.find((r) => r.version === docBeforePrep.version);
    assert.ok(snapWithEphemeral);

    // 3. Now delete the ephemeral paper from the catalog
    await prisma.documentCitation.deleteMany({ where: { paperId: deletedPaperId } });
    await prisma.paper.deleteMany({ where: { id: deletedPaperId } });

    // Record exact state immediately prior to attempted restore
    const docBefore = await getResearchDocument(ownerUserId, testDocId);
    const revsBeforeCount = (await listDocumentRevisions(ownerUserId, testDocId)).length;

    // 4. Attempt to restore the revision that cited the now-missing paper
    await assert.rejects(
      async () => {
        await restoreDocumentRevision(ownerUserId, testDocId, {
          targetRevisionId: snapWithEphemeral.id,
          expectedCurrentVersion: docBefore.version,
        });
      },
      (err: any) => {
        assert.ok(err.message.includes("RESTORE_MISSING_REFERENCE"));
        assert.ok(err.message.includes("missing or inaccessible"));
        return true;
      }
    );

    // 5. Verify 100% zero-mutation preservation of the document and revision history
    const docAfter = await getResearchDocument(ownerUserId, testDocId);
    assert.equal(docAfter.version, docBefore.version);
    assert.equal(docAfter.updatedAt.getTime(), docBefore.updatedAt.getTime());
    assert.equal(docAfter.title, docBefore.title);
    assert.equal(docAfter.cslStyleId, docBefore.cslStyleId);
    assert.deepEqual(docAfter.content, docBefore.content);
    assert.equal(docAfter.citations.length, docBefore.citations.length);
    assert.equal(docAfter.linkedPapers.length, docBefore.linkedPapers.length);

    const revsAfter = await listDocumentRevisions(ownerUserId, testDocId);
    assert.equal(revsAfter.length, revsBeforeCount); // Zero new pre-restore snapshots created!

    // 6. Verify historical preview and export remain fully accessible for the revision
    const preview = await getDocumentRevision(ownerUserId, testDocId, snapWithEphemeral.id);
    assert.ok(preview);
    assert.ok(Array.isArray(preview.citations));

    const exportRes = await exportDocumentRevision(
      ownerUserId,
      testDocId,
      snapWithEphemeral.id,
      "markdown"
    );
    assert.ok(exportRes.content.length > 0);
  });

  test("9. Ownership-checked guarded restore: restores target revision, creates pre-restore snapshot, bumps version", async () => {
    const docBefore = await getResearchDocument(ownerUserId, testDocId);
    const revisionsBefore = await listDocumentRevisions(ownerUserId, testDocId);
    const targetV1 = revisionsBefore.find((r) => r.version === 1);
    assert.ok(targetV1);

    // Execute restore
    const restoreResult = await restoreDocumentRevision(ownerUserId, testDocId, {
      targetRevisionId: targetV1.id,
      expectedCurrentVersion: docBefore.version,
    });

    assert.equal(restoreResult.success, true);
    assert.equal(restoreResult.previousVersion, docBefore.version);
    assert.equal(restoreResult.newVersion, docBefore.version + 1);
    assert.ok(restoreResult.preRestoreSnapshotId);

    // Verify document was restored to v1 properties but with bumped sequence
    const docAfter = await getResearchDocument(ownerUserId, testDocId);
    assert.equal(docAfter.version, docBefore.version + 1);
    assert.equal(docAfter.title, "Initial Manuscript Draft"); // Title from v1 restored!
    assert.equal(docAfter.cslStyleId, "apa"); // Style from v1 restored!
    assert.equal(docAfter.citations.length, 1); // Citation restored!
    assert.equal(docAfter.linkedPapers.length, 1); // Linked paper restored!

    // Verify pre-restore snapshot was captured in history
    const revisionsAfter = await listDocumentRevisions(ownerUserId, testDocId);
    const preRestoreSnap = revisionsAfter.find((r) => r.version === docBefore.version);
    assert.ok(preRestoreSnap);
  });

  test("10. Injected failure through actual restore service after relationship writes start verifies full rollback", async () => {
    const docBefore = await getResearchDocument(ownerUserId, testDocId);
    const revsBefore = await listDocumentRevisions(ownerUserId, testDocId);
    const targetRev = revsBefore.find((r) => r.version === 1);
    assert.ok(targetRev);

    // Set fault injection hook outside the client restore request
    setRestoreFaultHookForTesting((stage) => {
      if (stage === "after_relation_writes") {
        throw new Error("INJECTED_FAILURE_AFTER_RELATION_WRITES");
      }
    });

    await assert.rejects(
      async () => {
        await restoreDocumentRevision(ownerUserId, testDocId, {
          targetRevisionId: targetRev.id,
          expectedCurrentVersion: docBefore.version,
        });
      },
      (err: any) => {
        assert.ok(err.message.includes("INJECTED_FAILURE_AFTER_RELATION_WRITES"));
        return true;
      }
    );

    // Clear fault injection hook immediately
    setRestoreFaultHookForTesting(null);

    // Confirm complete transaction rollback:
    // 1. Zero orphaned revisions created
    const revsAfter = await listDocumentRevisions(ownerUserId, testDocId);
    assert.equal(revsAfter.length, revsBefore.length);

    // 2. Document draft, title, content, version, and updatedAt remain identical
    const docAfter = await getResearchDocument(ownerUserId, testDocId);
    assert.equal(docAfter.version, docBefore.version);
    assert.equal(docAfter.title, docBefore.title);
    assert.equal(docAfter.textContent, docBefore.textContent);
    assert.deepEqual(docAfter.content, docBefore.content);
    assert.equal(docAfter.updatedAt.getTime(), docBefore.updatedAt.getTime());

    // 3. Document relations (citations and linked papers) were completely rolled back
    assert.equal(docAfter.citations.length, docBefore.citations.length);
    assert.deepEqual(
      docAfter.citations.map((c) => c.id).sort(),
      docBefore.citations.map((c) => c.id).sort()
    );
    assert.equal(docAfter.linkedPapers.length, docBefore.linkedPapers.length);
    assert.deepEqual(
      docAfter.linkedPapers.map((lp) => lp.id).sort(),
      docBefore.linkedPapers.map((lp) => lp.id).sort()
    );
  });

  test("11. Configurable retention limit: prunes oldest snapshots when exceeding limit", async () => {
    const testRetentionLimit = 3;

    // Trigger several updates to exceed the limit of 3
    for (let i = 0; i < 4; i++) {
      const current = await getResearchDocument(ownerUserId, testDocId);
      await updateResearchDocument(ownerUserId, testDocId, {
        title: `Retention Test Iteration ${i + 1}`,
        textContent: `Content for iteration ${i + 1}`,
        expectedVersion: current.version,
      });
    }

    // Call createDocumentRevisionSnapshot with retentionLimit: 3
    const currentDoc = await getResearchDocument(ownerUserId, testDocId);
    await prisma.$transaction(async (tx) => {
      await createDocumentRevisionSnapshot(tx, currentDoc, {
        userId: ownerUserId,
        description: "Retention boundary test",
        retentionLimit: testRetentionLimit,
      });
    });

    const activeRevisions = await listDocumentRevisions(ownerUserId, testDocId);
    assert.ok(
      activeRevisions.length <= testRetentionLimit,
      `Expected revisions count <= ${testRetentionLimit}, got ${activeRevisions.length}`
    );
  });

  test("12. Read-only behavior across ALL advertised historical export formats", async () => {
    const docBefore = await getResearchDocument(ownerUserId, testDocId);
    const revisions = await listDocumentRevisions(ownerUserId, testDocId);
    assert.ok(revisions.length > 0);
    const targetRev = revisions[0];

    const formats: ManuscriptExportFormat[] = [
      "markdown",
      "text",
      "html",
      "bibtex",
      "ris",
      "json",
      "docx",
      "pdf",
    ];

    for (const format of formats) {
      const result = await exportDocumentRevision(ownerUserId, testDocId, targetRev.id, format);
      assert.equal(result.format, format);
      assert.ok(result.content.length > 0);
      assert.ok(result.filename.includes(`-v${targetRev.version}`));

      if (format === "pdf") {
        assert.equal(result.isBinary, true);
        const buf = Buffer.from(result.content, "base64");
        assert.equal(buf.subarray(0, 4).toString(), "%PDF");
      } else if (format === "docx") {
        assert.equal(result.isBinary, true);
        const buf = Buffer.from(result.content, "base64");
        assert.equal(buf.subarray(0, 2).toString(), "PK"); // ZIP/DOCX header
      } else if (format === "json") {
        const parsed = JSON.parse(result.content);
        assert.equal(parsed.version, targetRev.version);
      }
    }

    // Verify document was strictly unmodified across all 8 export operations
    const docAfter = await getResearchDocument(ownerUserId, testDocId);
    assert.equal(docAfter.version, docBefore.version);
    assert.equal(docAfter.updatedAt.getTime(), docBefore.updatedAt.getTime());
  });
});
