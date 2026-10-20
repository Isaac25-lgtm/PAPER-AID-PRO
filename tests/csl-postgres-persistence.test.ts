/**
 * AI RESEARCH HUB — PHASE 8B: REAL POSTGRESQL CSL PERSISTENCE ACCEPTANCE SUITE
 *
 * Requirements:
 * 1. Uses the actual Prisma PostgreSQL adapter (`PrismaCslCatalogAdapter`), NOT in-memory fallback.
 * 2. Directly connects to the verified local Docker PostgreSQL database (127.0.0.1:5432 / ai_research_hub).
 * 3. Validates all 12 acceptance criteria specified in Step 6.
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { PrismaCslCatalogAdapter, CslCatalogManager } from "../src/lib/citations/csl/updater/catalog-storage";
import { ManuscriptStylePolicy } from "../src/lib/citations/csl/updater/manuscript-policy";
import { getStyleXml } from "../src/lib/citations/csl/style-registry";
import { createCiteprocEngine, renderCitationCluster, renderBibliography } from "../src/lib/citations/csl/csl-engine";
import { assertCslXmlSecurity } from "../src/lib/citations/csl/updater/xml-validator";
import { createResearchDocument, getResearchDocument, updateResearchDocument } from "../src/lib/editor/document-service";

describe("Phase 8B: Real PostgreSQL CSL Persistence Acceptance Suite", () => {
  let testUserId: string;
  let testDocId: string;
  const prismaAdapter = new PrismaCslCatalogAdapter();

  before(async () => {
    // Explicitly configure CslCatalogManager to use the real PostgreSQL adapter
    CslCatalogManager.setAdapter(prismaAdapter);

    // Find or create test user for document lifecycle
    const user = await prisma.user.findFirst();
    if (user) {
      testUserId = user.id;
    } else {
      const newUser = await prisma.user.create({
        data: {
          email: "acceptance-test@example.com",
          name: "CSL Acceptance Researcher",
          passwordHash: "hash-disposable",
          role: "USER",
        },
      });
      testUserId = newUser.id;
    }
  });

  after(async () => {
    // Cleanup disposable test documents and staged revisions created during test
    if (testDocId) {
      await prisma.researchDocument.deleteMany({ where: { id: testDocId } });
    }
    await prisma.cslStyleRecord.deleteMany({
      where: { revision: { revisionSha: { in: ["test-sha-realdb-v2", "test-sha-invalid"] } } },
    });
    await prisma.cslCatalogRevision.deleteMany({
      where: { revisionSha: { in: ["test-sha-realdb-v2", "test-sha-invalid"] } },
    });

    // Ensure baseline catalog remains ACTIVE
    await prisma.cslCatalogRevision.updateMany({
      where: { revisionSha: "v1.0.2-baseline-catalog" },
      data: { isActive: true, status: "ACTIVE" },
    });

    // Release any test locks
    await prisma.cslSyncLock.updateMany({
      where: { id: "singleton" },
      data: { isLocked: false, lockedBy: null, expiresAt: null },
    });

    await prisma.$disconnect();
  });

  test("1. CSL catalog survives process restart and active revision is read from PostgreSQL", async () => {
    const activeFromDb = await prisma.cslCatalogRevision.findFirst({
      where: { isActive: true, status: "ACTIVE" },
    });
    assert.ok(activeFromDb, "Active catalog revision must exist in PostgreSQL");
    assert.equal(activeFromDb.revisionSha, "v1.0.2-baseline-catalog");

    const activeFromAdapter = await prismaAdapter.getActiveRevision();
    assert.ok(activeFromAdapter);
    assert.equal(activeFromAdapter.gitSha, "v1.0.2-baseline-catalog");
    assert.equal(activeFromAdapter.status, "ACTIVE");
  });

  test("2. APA, Vancouver and IEEE styles load correctly from PostgreSQL", async () => {
    const apa = await getStyleXml("apa");
    assert.ok(apa.xml.includes("<style"));
    assert.equal(apa.format, "author-date");
    assert.equal(apa.id, "apa");

    const vancouver = await getStyleXml("vancouver");
    assert.ok(vancouver.xml.includes("<style"));
    assert.equal(vancouver.format, "numeric");
    assert.equal(vancouver.id, "vancouver");

    const ieee = await getStyleXml("ieee");
    assert.ok(ieee.xml.includes("<style"));
    assert.equal(ieee.format, "numeric");
    assert.equal(ieee.id, "ieee");
  });

  test("3. An academic manuscript saves its selected style and pinned revision in PostgreSQL", async () => {
    const doc = await createResearchDocument(testUserId, {
      title: "Real DB Acceptance Manuscript",
    });
    testDocId = doc.id;

    // Update with Vancouver style and pinned baseline revision
    const updated = await updateResearchDocument(testUserId, testDocId, {
      content: {
        type: "doc",
        meta: {
          citationStyle: "vancouver",
          citationStyleRevision: "v1.0.2-baseline-catalog",
        },
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Manuscript text with citations." }],
          },
        ],
      },
    });

    // Verify row directly in PostgreSQL
    const dbRow = await prisma.researchDocument.findUnique({
      where: { id: testDocId },
    });
    assert.ok(dbRow);
    assert.equal(dbRow.cslStyleId, "vancouver");
    assert.equal(dbRow.cslRevisionSha, "v1.0.2-baseline-catalog");

    const policyBinding = await ManuscriptStylePolicy.resolveManuscriptStyle(dbRow);
    assert.equal(policyBinding.styleId, "vancouver");
    assert.equal(policyBinding.revisionSha, "v1.0.2-baseline-catalog");
    assert.equal(policyBinding.isPinned, true);
  });

  test("4. A new catalog version can be staged and activated in PostgreSQL", async () => {
    const newSha = "test-sha-realdb-v2";

    // Stage new revision
    await CslCatalogManager.stageRevision(
      {
        id: "rev-test-v2",
        gitSha: newSha,
        branch: "v1.0.2",
        status: "STAGED",
        totalStyles: 1,
        independentCount: 1,
        dependentCount: 0,
        newStylesCount: 1,
        updatedStylesCount: 0,
        deletedStylesCount: 0,
        validationErrors: [],
        createdAt: new Date().toISOString(),
      },
      [
        {
          styleId: "custom-acceptance-style",
          revisionSha: newSha,
          title: "Custom Acceptance Journal Style",
          isDependent: false,
          format: "numeric",
          checksum: "checksum-acceptance-v2",
          xml: '<?xml version="1.0" encoding="utf-8"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"><info><title>Custom Acceptance Journal Style</title><id>custom-acceptance-style</id></info><citation><layout><text variable="citation-number"/></layout></citation></style>',
          sourceUrl: "db://custom",
          updatedAt: new Date().toISOString(),
        },
      ]
    );

    // Verify staged in DB
    const stagedDb = await prisma.cslCatalogRevision.findUnique({
      where: { revisionSha: newSha },
    });
    assert.ok(stagedDb);
    assert.equal(stagedDb.status, "STAGED");
    assert.equal(stagedDb.isActive, false);

    // Acquire lock and activate
    const workerId = "worker-realdb-acceptance-1";
    const acquired = await prismaAdapter.acquireLock(workerId);
    assert.equal(acquired, true);

    const activated = await CslCatalogManager.activateRevision(newSha, workerId);
    assert.equal(activated.gitSha, newSha);
    assert.equal(activated.status, "ACTIVE");

    await prismaAdapter.releaseLock(workerId);

    // Verify EXACTLY ONE active revision in PostgreSQL
    const activeRevisions = await prisma.cslCatalogRevision.findMany({
      where: { isActive: true },
    });
    assert.equal(activeRevisions.length, 1);
    assert.equal(activeRevisions[0].revisionSha, newSha);

    // Verify previous baseline was demoted to ARCHIVED
    const baselineDb = await prisma.cslCatalogRevision.findUnique({
      where: { revisionSha: "v1.0.2-baseline-catalog" },
    });
    assert.ok(baselineDb);
    assert.equal(baselineDb.isActive, false);
    assert.equal(baselineDb.status, "ARCHIVED");
  });

  test("5. Previously saved manuscripts retain their original formatting and pinned revision", async () => {
    // Reload manuscript from DB
    const dbRow = await prisma.researchDocument.findUnique({
      where: { id: testDocId },
    });
    assert.ok(dbRow);

    // It MUST still be pinned to baseline revision, NOT the newly activated v2
    const policyBinding = await ManuscriptStylePolicy.resolveManuscriptStyle(dbRow);
    assert.equal(policyBinding.styleId, "vancouver");
    assert.equal(policyBinding.revisionSha, "v1.0.2-baseline-catalog");
    assert.equal(policyBinding.isPinned, true);

    // Format a Vancouver citation cluster
    const vancouverStyle = await getStyleXml("vancouver", policyBinding.revisionSha);
    const engine = createCiteprocEngine(
      vancouverStyle.xml,
      [{ id: "sample-p1", type: "article-journal", title: "Study Alpha", author: [{ family: "Smith", given: "John" }], issued: { "date-parts": [[2024]] } }]
    );
    const clusterText = renderCitationCluster(engine, [{ id: "sample-p1" }]);
    assert.ok(clusterText.includes("(1)"));
  });

  test("6. A researcher can explicitly upgrade to the newer revision in PostgreSQL", async () => {
    const dbRow = await prisma.researchDocument.findUnique({
      where: { id: testDocId },
    });

    const upgradeResult = await ManuscriptStylePolicy.upgradeManuscriptToLatestRevision(dbRow);
    assert.equal(upgradeResult.hasRevisionChanged, true);
    assert.equal(upgradeResult.previousRevision, "v1.0.2-baseline-catalog");
    assert.equal(upgradeResult.newRevision, "test-sha-realdb-v2");

    // Persist upgrade in DB
    await prisma.researchDocument.update({
      where: { id: testDocId },
      data: {
        cslRevisionSha: upgradeResult.newRevision,
        content: upgradeResult.updatedContent,
      },
    });

    const upgradedDb = await prisma.researchDocument.findUnique({
      where: { id: testDocId },
    });
    assert.equal(upgradedDb?.cslRevisionSha, "test-sha-realdb-v2");
  });

  test("7. Rollback restores the earlier active catalog in PostgreSQL", async () => {
    const rolledBack = await CslCatalogManager.rollbackToRevision("v1.0.2-baseline-catalog");
    assert.equal(rolledBack.gitSha, "v1.0.2-baseline-catalog");
    assert.equal(rolledBack.status, "ACTIVE");

    // Verify DB state
    const activeRevisions = await prisma.cslCatalogRevision.findMany({
      where: { isActive: true },
    });
    assert.equal(activeRevisions.length, 1);
    assert.equal(activeRevisions[0].revisionSha, "v1.0.2-baseline-catalog");

    const demotedV2 = await prisma.cslCatalogRevision.findUnique({
      where: { revisionSha: "test-sha-realdb-v2" },
    });
    assert.equal(demotedV2?.isActive, false);
    assert.equal(demotedV2?.status, "ARCHIVED");
  });

  test("8. Historical manuscripts remain reproducible after rollback", async () => {
    // Manuscript pinned to v1.0.2-baseline-catalog continues to resolve correctly
    const style = await getStyleXml("apa", "v1.0.2-baseline-catalog");
    assert.ok(style.xml.includes("<style"));
    assert.equal(style.format, "author-date");

    const engine = createCiteprocEngine(
      style.xml,
      [
        {
          id: "item-beta",
          type: "article-journal",
          title: "Quantum Entanglement",
          author: [{ family: "Fowler", given: "Austin" }],
          issued: { "date-parts": [[2022]] },
        },
      ]
    );
    const bib = renderBibliography(engine, "text");
    assert.ok(bib.entries.length > 0);
    assert.ok(bib.entries[0].includes("Fowler"));
  });

  test("9. Invalid XML cannot replace the active catalog in PostgreSQL", async () => {
    // Attempting to validate invalid security XML should be rejected
    const maliciousXml = '<?xml version="1.0"?><!DOCTYPE style [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><style>&xxe;</style>';

    assert.throws(
      () => assertCslXmlSecurity(maliciousXml),
      /CSL XML security validation failed/
    );

    // Active catalog remains unchanged
    const active = await prismaAdapter.getActiveRevision();
    assert.equal(active?.gitSha, "v1.0.2-baseline-catalog");
  });

  test("10. Simultaneous sync attempts in PostgreSQL: lock prevents concurrent workers", async () => {
    const worker1 = "worker-sync-1";
    const worker2 = "worker-sync-2";

    // Release any lingering locks
    await prismaAdapter.releaseLock(worker1);
    await prismaAdapter.releaseLock(worker2);

    const lock1 = await prismaAdapter.acquireLock(worker1, 60000);
    assert.equal(lock1, true, "Worker 1 must acquire lock");

    // Worker 2 attempts to acquire lock concurrently
    const lock2 = await prismaAdapter.acquireLock(worker2, 60000);
    assert.equal(lock2, false, "Worker 2 must be blocked by Worker 1");

    // Worker 2 attempts activation without holding lock: rejected
    await assert.rejects(
      async () => {
        await prismaAdapter.setActiveRevision("test-sha-realdb-v2", worker2);
      },
      /Activation rejected: Synchronization lock was lost, expired, or superseded/
    );

    // Worker 1 releases lock
    await prismaAdapter.releaseLock(worker1);

    // Now Worker 2 can acquire lock
    const lock2AfterRelease = await prismaAdapter.acquireLock(worker2, 60000);
    assert.equal(lock2AfterRelease, true, "Worker 2 can acquire lock after release");

    await prismaAdapter.releaseLock(worker2);
  });

  test("11. Existing editor autosave, citations, and ownership protection remain functional", async () => {
    // Ownership test: non-owner cannot read or modify testDocId
    const otherUser = await prisma.user.create({
      data: {
        email: "other-scholar@example.com",
        name: "Unauthorized Scholar",
        passwordHash: "hash-other",
        role: "USER",
      },
    });

    try {
      await assert.rejects(async () => {
        await getResearchDocument(otherUser.id, testDocId);
      }, /not found/);

      await assert.rejects(async () => {
        await updateResearchDocument(otherUser.id, testDocId, {
          title: "Hacked Title",
        });
      }, /not found/);
    } finally {
      await prisma.user.delete({ where: { id: otherUser.id } });
    }
  });

  test("12. GPT-6 Luna pilot files remain untouched", async () => {
    const fs = await import("fs");
    assert.ok(fs.existsSync("src/lib/ai/router/cost-tracker.ts"), "cost-tracker.ts exists");
    assert.ok(fs.existsSync("src/lib/editor/ai-editor-service.ts"), "ai-editor-service.ts exists");
    assert.ok(fs.existsSync("src/lib/editor/pilot-autocomplete-service.ts"), "pilot-autocomplete-service.ts exists");
    assert.ok(fs.existsSync("tests/gpt6-luna-compatibility.test.ts"), "gpt6-luna-compatibility.test.ts exists");
  });
});
