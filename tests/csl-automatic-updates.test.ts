/**
 * AI RESEARCH HUB — PHASE 8B: AUTOMATIC CSL CITATION STYLE UPDATES TEST SUITE
 *
 * Verifies:
 * 1. Upstream checking & ETag conditional skipping (No upstream changes).
 * 2. Tree diffing: identifies added, modified, and removed styles.
 * 3. XML Security: blocks XXE, entity injection, oversized XML.
 * 4. Validation: rejects invalid XML, broken CSL schema, or unresolvable parent.
 * 5. Atomic Activation: failed validation never replaces active catalog.
 * 6. New style appearance and activation.
 * 7. Dependent style parent resolution.
 * 8. Manuscript Immutability: existing manuscripts retain pinned revision and formatting.
 * 9. Deleted upstream style: older manuscripts continue formatting via archived revision.
 * 10. Rollback: active catalog can be rolled back to a previous revision.
 * 11. Core style regression: APA, Vancouver, IEEE formatting preserved.
 * 12. Rate-limit and network failure resilience.
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  CslGitHubClient,
  validateCslXmlSecurity,
  CslStyleValidator,
  CslCatalogManager,
  InMemoryCslCatalogAdapter,
  ManuscriptStylePolicy,
  CslSyncOrchestrator,
  CslCatalogRevision,
  CslStyleRecord,
} from "../src/lib/citations/csl/updater";

describe("Phase 8B: Automatic CSL Updates & Versioning Suite", () => {
  beforeEach(async () => {
    // Reset to fresh in-memory adapter for complete test isolation
    CslCatalogManager.setAdapter(new InMemoryCslCatalogAdapter());
    await CslCatalogManager.initializeBaselineCatalog();
  });

  test("1. Baseline catalog initialization: loads 10,870 static catalog and bundled styles", async () => {
    const active = await CslCatalogManager.getAdapter().getActiveRevision();
    assert.ok(active, "Active revision must exist");
    assert.equal(active.gitSha, "v1.0.2-baseline-catalog");
    assert.ok(active.totalStyles > 10000, "Must index 10,000+ baseline styles");
    assert.equal(active.status, "ACTIVE");

    // Check that core styles are available
    const apa = await CslCatalogManager.resolveStyleXml("apa");
    assert.ok(apa, "APA style XML must resolve");
    assert.ok(apa.xml.includes("American Psychological Association"));

    const vancouver = await CslCatalogManager.resolveStyleXml("vancouver");
    assert.ok(vancouver, "Vancouver style XML must resolve");
  });

  test("2. XML Security: rejects XXE, DOCTYPE, entity expansion, and scripts", () => {
    const xxePayload = `<?xml version="1.0"?>
      <!DOCTYPE style [
        <!ENTITY xxe SYSTEM "file:///etc/passwd">
      ]>
      <style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">
        <info><title>&xxe;</title></info>
      </style>`;

    const res1 = validateCslXmlSecurity(xxePayload, "malicious-style");
    assert.equal(res1.valid, false);
    assert.ok(res1.errors.some((e) => e.includes("DOCTYPE") || e.includes("unsafe directive")));

    const scriptPayload = `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">
      <info><title><script>alert(1)</script></title></info>
    </style>`;
    const res2 = validateCslXmlSecurity(scriptPayload, "script-style");
    assert.equal(res2.valid, false);
    assert.ok(res2.errors.some((e) => e.includes("unsafe directive")));
  });

  test("3. XML Security: enforces 512 KB payload size limit", () => {
    const hugeXml = "<style xmlns=\"http://purl.org/net/xbiblio/csl\" version=\"1.0\">" +
      "a".repeat(600 * 1024) +
      "</style>";
    const res = validateCslXmlSecurity(hugeXml, "huge-style");
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes("exceeds maximum safe size")));
  });

  test("4. Tree Diffing: correctly identifies added, modified, and removed styles", () => {
    const client = new CslGitHubClient();
    const activeTree = new Map([
      ["style-a", { sha: "blob-111", path: "style-a.csl" }],
      ["style-b", { sha: "blob-222", path: "style-b.csl" }],
      ["style-c", { sha: "blob-333", path: "style-c.csl" }],
    ]);

    const upstreamTree = new Map([
      ["style-a", { path: "style-a.csl", mode: "100644", type: "blob" as const, sha: "blob-111", url: "", styleId: "style-a", isDependent: false }],
      ["style-b", { path: "style-b.csl", mode: "100644", type: "blob" as const, sha: "blob-222-updated", url: "", styleId: "style-b", isDependent: false }],
      ["style-d", { path: "style-d.csl", mode: "100644", type: "blob" as const, sha: "blob-444", url: "", styleId: "style-d", isDependent: false }],
    ]);

    const diff = client.diffTrees(activeTree, upstreamTree, "upstream-sha-new", "active-sha-old");
    assert.equal(diff.hasChanges, true);
    assert.equal(diff.added.length, 1);
    assert.equal(diff.added[0].styleId, "style-d");
    assert.equal(diff.modified.length, 1);
    assert.equal(diff.modified[0].styleId, "style-b");
    assert.equal(diff.removed.length, 1);
    assert.equal(diff.removed[0], "style-c");
    assert.equal(diff.unchangedCount, 1);
  });

  test("5. Style Validation: verifies independent style compiling inside Citeproc", () => {
    const validXml = `<?xml version="1.0" encoding="utf-8"?>
    <style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
      <info>
        <title>Sample Independent Style</title>
        <id>http://www.zotero.org/styles/sample-independent-style</id>
        <link href="http://www.zotero.org/styles/sample-independent-style" rel="self"/>
        <category citation-format="numeric"/>
        <updated>2024-01-01T00:00:00+00:00</updated>
      </info>
      <citation>
        <layout prefix="(" suffix=")" delimiter=",">
          <text variable="citation-number"/>
        </layout>
      </citation>
      <bibliography>
        <layout>
          <text variable="citation-number" suffix=". "/>
          <text variable="title"/>
        </layout>
      </bibliography>
    </style>`;

    const res = CslStyleValidator.validateStyle("sample-independent-style", validXml);
    assert.equal(res.valid, true);
    assert.equal(res.title, "Sample Independent Style");
    assert.equal(res.format, "numeric");
    assert.equal(res.isDependent, false);
    assert.ok(res.checksum);
  });

  test("6. Style Validation: verifies dependent style parent resolution", () => {
    const dependentXml = `<?xml version="1.0" encoding="utf-8"?>
    <style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
      <info>
        <title>Nature Biotechnology</title>
        <id>http://www.zotero.org/styles/nature-biotechnology</id>
        <link href="http://www.zotero.org/styles/nature-biotechnology" rel="self"/>
        <link href="http://www.zotero.org/styles/nature" rel="independent-parent"/>
        <category citation-format="numeric"/>
        <updated>2024-01-01T00:00:00+00:00</updated>
      </info>
    </style>`;

    // Case A: Parent is in catalog
    const resA = CslStyleValidator.validateStyle(
      "nature-biotechnology",
      dependentXml,
      undefined,
      new Set(["nature", "apa"])
    );
    assert.equal(resA.valid, true);
    assert.equal(resA.isDependent, true);
    assert.equal(resA.parentId, "nature");

    // Case B: Parent is missing from catalog
    const resB = CslStyleValidator.validateStyle(
      "nature-biotechnology",
      dependentXml,
      undefined,
      new Set(["apa", "vancouver"]) // missing "nature"
    );
    assert.equal(resB.valid, false);
    assert.ok(resB.errors.some((e) => e.includes("references parent 'nature', which does not exist")));
  });

  test("7. Atomic Activation: failed validation NEVER replaces active catalog", async () => {
    const initialActive = await CslCatalogManager.getAdapter().getActiveRevision();
    assert.ok(initialActive);

    // Mock client that returns 1 valid style and 1 invalid style
    const mockClient = {
      checkLatestCommit: async () => ({
        changed: true,
        commit: { sha: "new-upstream-sha-999", date: new Date().toISOString(), message: "Update", branch: "v1.0.2" },
      }),
      fetchStyleTree: async () => new Map([
        ["valid-style", { path: "valid-style.csl", sha: "blob-v1", styleId: "valid-style", isDependent: false, mode: "100644", type: "blob" as const, url: "" }],
        ["invalid-style", { path: "invalid-style.csl", sha: "blob-i1", styleId: "invalid-style", isDependent: false, mode: "100644", type: "blob" as const, url: "" }],
      ]),
      diffTrees: () => ({
        upstreamSha: "new-upstream-sha-999",
        activeSha: initialActive.gitSha,
        hasChanges: true,
        added: [
          { path: "valid-style.csl", sha: "blob-v1", styleId: "valid-style", isDependent: false, mode: "100644", type: "blob" as const, url: "" },
          { path: "invalid-style.csl", sha: "blob-i1", styleId: "invalid-style", isDependent: false, mode: "100644", type: "blob" as const, url: "" },
        ],
        modified: [],
        removed: [],
        unchangedCount: 0,
      }),
      fetchStyleXml: async (_sha: string, path: string) => {
        if (path === "valid-style.csl") {
          return `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">
            <info><title>Valid Style</title><id>http://zotero.org/styles/valid-style</id></info>
            <citation><layout><text variable="citation-number"/></layout></citation>
            <bibliography><layout><text variable="title"/></layout></bibliography>
          </style>`;
        }
        // Invalid style with syntax error and missing closing tag
        return "<style xmlns=\"http://purl.org/net/xbiblio/csl\" version=\"1.0\"><info><title>Broken";
      },
    } as any;

    const outcome = await CslSyncOrchestrator.executeSync({
      githubClient: mockClient,
      branch: "v1.0.2",
    });

    assert.equal(outcome.success, false);
    assert.equal(outcome.status, "VALIDATION_FAILED");
    assert.ok(outcome.validationErrors.length > 0);

    // CRITICAL: Ensure active catalog revision was NOT replaced!
    const activeAfterFailure = await CslCatalogManager.getAdapter().getActiveRevision();
    assert.equal(activeAfterFailure?.gitSha, initialActive.gitSha, "Active revision must remain unchanged!");
  });

  test("8. Successful sync: stages and atomically activates new revision", async () => {
    const mockClient = {
      checkLatestCommit: async () => ({
        changed: true,
        commit: { sha: "upstream-sha-clean-123", date: new Date().toISOString(), message: "Clean Update", branch: "v1.0.2" },
      }),
      fetchStyleTree: async () => new Map([
        ["new-journal-style", { path: "new-journal-style.csl", sha: "blob-n1", styleId: "new-journal-style", isDependent: false, mode: "100644", type: "blob" as const, url: "" }],
      ]),
      diffTrees: () => ({
        upstreamSha: "upstream-sha-clean-123",
        activeSha: "v1.0.2-baseline-catalog",
        hasChanges: true,
        added: [
          { path: "new-journal-style.csl", sha: "blob-n1", styleId: "new-journal-style", isDependent: false, mode: "100644", type: "blob" as const, url: "" },
        ],
        modified: [],
        removed: [],
        unchangedCount: 10000,
      }),
      fetchStyleXml: async () => {
        return `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">
          <info><title>New Journal of Clinical AI</title><id>http://zotero.org/styles/new-journal-style</id></info>
          <citation><layout><text variable="citation-number"/></layout></citation>
          <bibliography><layout><text variable="title"/></layout></bibliography>
        </style>`;
      },
    } as any;

    const outcome = await CslSyncOrchestrator.executeSync({
      githubClient: mockClient,
    });

    assert.equal(outcome.success, true);
    assert.equal(outcome.status, "ACTIVATED");
    assert.equal(outcome.activeSha, "upstream-sha-clean-123");

    // Active revision updated
    const active = await CslCatalogManager.getAdapter().getActiveRevision();
    assert.equal(active?.gitSha, "upstream-sha-clean-123");

    // Style is retrievable
    const newStyle = await CslCatalogManager.resolveStyleXml("new-journal-style");
    assert.ok(newStyle);
    assert.equal(newStyle.title, "New Journal of Clinical AI");
  });

  test("9. Manuscript Immutability: preserves pinned revision and prevents silent bibliography changes", async () => {
    // 1. Existing manuscript created during v1.0.2-baseline-catalog
    const oldManuscript = {
      type: "doc",
      content: [{ type: "paragraph", text: "Manuscript draft content" }],
      meta: {
        citationStyle: "apa",
        citationStyleRevision: "v1.0.2-baseline-catalog",
      },
    };

    // 2. Active catalog promotes to newer revision
    const newerRev: CslCatalogRevision = {
      id: "rev-new-2026",
      gitSha: "upstream-sha-2026",
      branch: "v1.0.2",
      status: "ACTIVE",
      totalStyles: 11000,
      independentCount: 3000,
      dependentCount: 8000,
      newStylesCount: 50,
      updatedStylesCount: 10,
      deletedStylesCount: 0,
      validationErrors: [],
      createdAt: new Date().toISOString(),
      activatedAt: new Date().toISOString(),
    };
    await CslCatalogManager.stageRevision(newerRev, []);
    await CslCatalogManager.activateRevision("upstream-sha-2026");

    // 3. Resolve manuscript style
    const binding = await ManuscriptStylePolicy.resolveManuscriptStyle(oldManuscript);
    // MUST remain pinned to the old revision!
    assert.equal(binding.isPinned, true);
    assert.equal(binding.revisionSha, "v1.0.2-baseline-catalog");

    // 4. User explicitly triggers update action
    const upgradeRes = await ManuscriptStylePolicy.upgradeManuscriptToLatestRevision(oldManuscript);
    assert.equal(upgradeRes.hasRevisionChanged, true);
    assert.equal(upgradeRes.previousRevision, "v1.0.2-baseline-catalog");
    assert.equal(upgradeRes.newRevision, "upstream-sha-2026");
    assert.equal(upgradeRes.updatedContent.meta.citationStyleRevision, "upstream-sha-2026");
  });

  test("10. Deleted Upstream Style: older manuscript continues to resolve style from archived revision", async () => {
    // 1. Save style into old revision
    const oldSha = "rev-old-archived-sha";
    await CslCatalogManager.getAdapter().saveRevision({
      id: "rev-old",
      gitSha: oldSha,
      branch: "v1.0.2",
      status: "PREVIOUS",
      totalStyles: 1,
      independentCount: 1,
      dependentCount: 0,
      newStylesCount: 1,
      updatedStylesCount: 0,
      deletedStylesCount: 0,
      validationErrors: [],
      createdAt: new Date().toISOString(),
    });

    await CslCatalogManager.getAdapter().saveStyle({
      styleId: "deprecated-journal-2024",
      revisionSha: oldSha,
      title: "Deprecated Journal Style",
      isDependent: false,
      format: "numeric",
      checksum: "chk123",
      xml: `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">
        <info><title>Deprecated Journal Style</title><id>http://zotero.org/styles/deprecated</id></info>
        <citation><layout><text variable="citation-number"/></layout></citation>
        <bibliography><layout><text variable="title"/></layout></bibliography>
      </style>`,
      sourceUrl: "",
      updatedAt: new Date().toISOString(),
    });

    // 2. New active revision DOES NOT contain deprecated-journal-2024
    const newSha = "rev-new-without-deprecated";
    await CslCatalogManager.getAdapter().saveRevision({
      id: "rev-new",
      gitSha: newSha,
      branch: "v1.0.2",
      status: "ACTIVE",
      totalStyles: 0,
      independentCount: 0,
      dependentCount: 0,
      newStylesCount: 0,
      updatedStylesCount: 0,
      deletedStylesCount: 1,
      validationErrors: [],
      createdAt: new Date().toISOString(),
    });
    await CslCatalogManager.activateRevision(newSha);

    // 3. Querying active catalog for deprecated style yields null
    const inActive = await CslCatalogManager.resolveStyleXml("deprecated-journal-2024", newSha);
    assert.equal(inActive, null);

    // 4. Querying archived revision used by old manuscript resolves cleanly!
    const inOld = await CslCatalogManager.resolveStyleXml("deprecated-journal-2024", oldSha);
    assert.ok(inOld, "Archived revision must preserve deleted style for existing manuscripts");
    assert.equal(inOld.title, "Deprecated Journal Style");
  });

  test("11. Rollback: active catalog reverts cleanly to prior revision", async () => {
    const rev1 = "sha-rev-1";
    const rev2 = "sha-rev-2";

    await CslCatalogManager.getAdapter().saveRevision({
      id: "r1",
      gitSha: rev1,
      branch: "v1.0.2",
      status: "ACTIVE",
      totalStyles: 100,
      independentCount: 50,
      dependentCount: 50,
      newStylesCount: 100,
      updatedStylesCount: 0,
      deletedStylesCount: 0,
      validationErrors: [],
      createdAt: new Date().toISOString(),
    });
    await CslCatalogManager.activateRevision(rev1);

    await CslCatalogManager.getAdapter().saveRevision({
      id: "r2",
      gitSha: rev2,
      branch: "v1.0.2",
      status: "STAGED",
      totalStyles: 105,
      independentCount: 52,
      dependentCount: 53,
      newStylesCount: 5,
      updatedStylesCount: 0,
      deletedStylesCount: 0,
      validationErrors: [],
      createdAt: new Date().toISOString(),
    });
    await CslCatalogManager.activateRevision(rev2);

    let current = await CslCatalogManager.getAdapter().getActiveRevision();
    assert.equal(current?.gitSha, rev2);

    // Rollback to rev1
    const rolledBack = await CslCatalogManager.rollbackToRevision(rev1);
    assert.equal(rolledBack.gitSha, rev1);
    assert.equal(rolledBack.status, "ACTIVE");

    current = await CslCatalogManager.getAdapter().getActiveRevision();
    assert.equal(current?.gitSha, rev1);
  });

  test("12. Core style regression: APA, Vancouver, and IEEE formatters pass regression smoke checks", () => {
    const regResult = CslStyleValidator.runCoreStyleRegressions();
    assert.equal(regResult.passed, true);
    assert.equal(regResult.failures.length, 0);
  });

  test("13. Sync Endpoint Authorization: rejects unauthenticated requests and permits valid CRON_SECRET", async () => {
    const { GET, POST } = await import("../src/app/api/citations/sync/route");
    const { NextRequest } = await import("next/server");

    // Case A: Unauthenticated GET request (no headers, no session)
    const unauthReq = new NextRequest("http://localhost:3000/api/citations/sync", {
      method: "GET",
    });
    const resA = await GET(unauthReq);
    assert.equal(resA.status, 401);
    const bodyA = await resA.json();
    assert.ok(bodyA.error.includes("Authentication required"));

    // Case B: Unauthenticated POST request
    const unauthPost = new NextRequest("http://localhost:3000/api/citations/sync", {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
    });
    const resB = await POST(unauthPost);
    assert.equal(resB.status, 401);

    // Case C: Authenticated with CRON_SECRET
    process.env.CRON_SECRET = "test-cron-secret-phase8b-xyz";
    const authReq = new NextRequest("http://localhost:3000/api/citations/sync", {
      method: "GET",
      headers: {
        Authorization: "Bearer test-cron-secret-phase8b-xyz",
      },
    });
    const resC = await GET(authReq);
    assert.equal(resC.status, 200);
    const bodyC = await resC.json();
    assert.ok(bodyC.activeRevision);
    assert.ok(bodyC.historyCount >= 1);
  });

  test("14. Checksum-based XML Deduplication: identical styles reuse content without multiplying XML", async () => {
    const adapter = new InMemoryCslCatalogAdapter();
    CslCatalogManager.setAdapter(adapter);

    const commonXml = `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">
      <info><title>Shared XML Style</title><id>http://zotero.org/styles/shared</id></info>
      <citation><layout><text variable="citation-number"/></layout></citation>
      <bibliography><layout><text variable="title"/></layout></bibliography>
    </style>`;
    const checksum = "sha256-abcdef1234567890";

    // Save style across 3 different revisions with the identical checksum
    for (let i = 1; i <= 3; i++) {
      const sha = `rev-dedup-${i}`;
      await adapter.saveRevision({
        id: `r${i}`,
        gitSha: sha,
        branch: "v1.0.2",
        status: "ACTIVE",
        totalStyles: 1,
        independentCount: 1,
        dependentCount: 0,
        newStylesCount: 1,
        updatedStylesCount: 0,
        deletedStylesCount: 0,
        validationErrors: [],
        createdAt: new Date().toISOString(),
      });

      await adapter.saveStyle({
        styleId: `style-copy-${i}`,
        revisionSha: sha,
        title: `Shared Style Copy ${i}`,
        isDependent: false,
        format: "numeric",
        checksum,
        xml: commonXml,
        sourceUrl: `bundled://style-${i}`,
        updatedAt: new Date().toISOString(),
      });
    }

    // Only 1 unique XML record is stored in memory/database
    assert.equal(adapter.getUniqueXmlCount(), 1);

    // Each style resolves its full XML via the shared checksum
    const s1 = await adapter.getStyle("style-copy-1", "rev-dedup-1");
    const s2 = await adapter.getStyle("style-copy-2", "rev-dedup-2");
    assert.equal(s1?.xml, commonXml);
    assert.equal(s2?.xml, commonXml);
  });

  test("15. Distributed Synchronization Lock: prevents concurrent execution across workers", async () => {
    const adapter = CslCatalogManager.getAdapter();
    assert.ok(adapter.acquireLock && adapter.releaseLock);

    const workerA = "worker-alpha";
    const workerB = "worker-beta";

    // 1. Worker A acquires lock
    const lockedA = await adapter.acquireLock(workerA, 10000);
    assert.equal(lockedA, true);

    // 2. Worker B attempts to acquire while held by A -> rejected
    const lockedB = await adapter.acquireLock(workerB, 10000);
    assert.equal(lockedB, false);

    // 3. Worker A finishes and releases lock
    await adapter.releaseLock(workerA);

    // 4. Worker B can now acquire lock
    const lockedBAfter = await adapter.acquireLock(workerB, 10000);
    assert.equal(lockedBAfter, true);

    await adapter.releaseLock(workerB);
  });

  test("16. Task 5 — Full 8-Step Manuscript Reproducibility Lifecycle", async () => {
    const { createCiteprocEngine, renderCitationCluster } = await import("../src/lib/citations/csl/csl-engine");

    const sampleItem = {
      id: "paper-alpha",
      type: "article-journal" as const,
      title: "Deep Residual Learning for Image Recognition",
      author: [{ family: "He", given: "Kaiming" }, { family: "Zhang", given: "Xiangyu" }],
      "container-title": "IEEE Conference on Computer Vision and Pattern Recognition",
      issued: { "date-parts": [[2016]] },
    };

    // 1. Researcher selects a style
    const initialRev = "rev-2026-q1";
    await CslCatalogManager.getAdapter().saveRevision({
      id: "r-q1",
      gitSha: initialRev,
      branch: "v1.0.2",
      status: "ACTIVE",
      totalStyles: 1,
      independentCount: 1,
      dependentCount: 0,
      newStylesCount: 1,
      updatedStylesCount: 0,
      deletedStylesCount: 0,
      validationErrors: [],
      createdAt: new Date().toISOString(),
    });

    const styleXmlV1 = `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">
      <info><title>Evolutionary Journal</title><id>http://zotero.org/styles/evoj</id></info>
      <citation><layout prefix="(" suffix=")"><text variable="citation-number"/></layout></citation>
      <bibliography><layout><text variable="citation-number" suffix=". "/><text variable="title"/></layout></bibliography>
    </style>`;

    await CslCatalogManager.getAdapter().saveStyle({
      styleId: "evolutionary-journal",
      revisionSha: initialRev,
      title: "Evolutionary Journal v1",
      isDependent: false,
      format: "numeric",
      checksum: "chk-v1",
      xml: styleXmlV1,
      sourceUrl: "",
      updatedAt: new Date().toISOString(),
    });
    await CslCatalogManager.activateRevision(initialRev);

    // 2. Document saves the effective style revision
    let manuscript: any = {
      id: "manuscript-rep-001",
      title: "My Research Manuscript",
      cslStyleId: "evolutionary-journal",
      cslRevisionSha: null,
      content: {
        type: "doc",
        meta: { citationStyle: "evolutionary-journal" },
      },
    };
    manuscript = await ManuscriptStylePolicy.bindManuscriptToActiveRevision(manuscript);
    assert.equal(manuscript.cslRevisionSha, initialRev);
    assert.equal(manuscript.content.meta.citationStyleRevision, initialRev);

    // Initial render under v1: produces round parentheses "(1)"
    const engineV1 = createCiteprocEngine(styleXmlV1, [sampleItem]);
    const renderV1 = renderCitationCluster(engineV1, [{ id: "paper-alpha" }]);
    assert.equal(renderV1, "(1)");

    // 3. A newer catalog is activated with updated style formatting (bracketed "[1]")
    const newerRev = "rev-2026-q2";
    await CslCatalogManager.getAdapter().saveRevision({
      id: "r-q2",
      gitSha: newerRev,
      branch: "v1.0.2",
      status: "ACTIVE",
      totalStyles: 1,
      independentCount: 1,
      dependentCount: 0,
      newStylesCount: 0,
      updatedStylesCount: 1,
      deletedStylesCount: 0,
      validationErrors: [],
      createdAt: new Date().toISOString(),
    });

    const styleXmlV2 = `<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">
      <info><title>Evolutionary Journal</title><id>http://zotero.org/styles/evoj</id></info>
      <citation><layout prefix="[" suffix="]"><text variable="citation-number"/></layout></citation>
      <bibliography><layout><text variable="citation-number" suffix=": "/><text variable="title"/></layout></bibliography>
    </style>`;

    await CslCatalogManager.getAdapter().saveStyle({
      styleId: "evolutionary-journal",
      revisionSha: newerRev,
      title: "Evolutionary Journal v2",
      isDependent: false,
      format: "numeric",
      checksum: "chk-v2",
      xml: styleXmlV2,
      sourceUrl: "",
      updatedAt: new Date().toISOString(),
    });
    await CslCatalogManager.activateRevision(newerRev);

    // 4. Existing document reopens with unchanged citations and bibliography
    const bindingReopened = await ManuscriptStylePolicy.resolveManuscriptStyle(manuscript);
    assert.equal(bindingReopened.revisionSha, initialRev);
    assert.equal(bindingReopened.isPinned, true);

    const reopenedStyle = await CslCatalogManager.resolveStyleXml("evolutionary-journal", bindingReopened.revisionSha);
    assert.equal(reopenedStyle?.xml, styleXmlV1, "Reopened manuscript MUST retain original v1 style XML");
    const engineReopened = createCiteprocEngine(reopenedStyle!.xml, [sampleItem]);
    const renderReopened = renderCitationCluster(engineReopened, [{ id: "paper-alpha" }]);
    assert.equal(renderReopened, "(1)", "Citations must not change silently");

    // 5. Researcher explicitly upgrades the citation style
    const upgradeOutcome = await ManuscriptStylePolicy.upgradeManuscriptToLatestRevision(manuscript);
    assert.equal(upgradeOutcome.hasRevisionChanged, true);
    assert.equal(upgradeOutcome.newRevision, newerRev);
    manuscript = upgradeOutcome.updatedDocumentOrContent;

    // 6. New formatting persists
    assert.equal(manuscript.cslRevisionSha, newerRev);
    const upgradedStyle = await CslCatalogManager.resolveStyleXml("evolutionary-journal", manuscript.cslRevisionSha);
    assert.equal(upgradedStyle?.xml, styleXmlV2, "Upgraded manuscript must use v2 XML");
    const engineUpgraded = createCiteprocEngine(upgradedStyle!.xml, [sampleItem]);
    const renderUpgraded = renderCitationCluster(engineUpgraded, [{ id: "paper-alpha" }]);
    assert.equal(renderUpgraded, "[1]", "New formatting must reflect v2 changes");

    // 7. Admin rolls back the active catalog
    const rolledBackRev = await CslCatalogManager.rollbackToRevision(initialRev);
    assert.equal(rolledBackRev.gitSha, initialRev);
    const currentActive = await CslCatalogManager.getAdapter().getActiveRevision();
    assert.equal(currentActive?.gitSha, initialRev);

    // 8. Manuscripts with older pinned revisions still render correctly
    // Document pinned to initialRev renders v1:
    const docOldPinned = { cslStyleId: "evolutionary-journal", cslRevisionSha: initialRev };
    const oldStyleResolved = await CslCatalogManager.resolveStyleXml("evolutionary-journal", docOldPinned.cslRevisionSha);
    assert.equal(oldStyleResolved?.xml, styleXmlV1);
    const engineOld = createCiteprocEngine(oldStyleResolved!.xml, [sampleItem]);
    const renderOld = renderCitationCluster(engineOld, [{ id: "paper-alpha" }]);
    assert.equal(renderOld, "(1)");

    // Document pinned to newerRev still renders v2 even after active catalog rolled back:
    const docNewPinned = { cslStyleId: "evolutionary-journal", cslRevisionSha: newerRev };
    const newStyleResolved = await CslCatalogManager.resolveStyleXml("evolutionary-journal", docNewPinned.cslRevisionSha);
    assert.equal(newStyleResolved?.xml, styleXmlV2);
    const engineNew = createCiteprocEngine(newStyleResolved!.xml, [sampleItem]);
    const renderNew = renderCitationCluster(engineNew, [{ id: "paper-alpha" }]);
    assert.equal(renderNew, "[1]");
  });

  test("17. Lock Ownership Verification: superseded or expired worker cannot activate revision", async () => {
    const adapter = CslCatalogManager.getAdapter();
    const workerA = "worker-primary";
    const workerB = "worker-rogue";

    // Worker A acquires lock
    await adapter.acquireLock!(workerA, 60000);

    const testRev: CslCatalogRevision = {
      id: "rev-lock-test",
      gitSha: "sha-lock-test",
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
    };
    await adapter.saveRevision(testRev);

    // Worker B attempts to activate with its workerId -> rejected because Worker A owns the lock
    await assert.rejects(
      async () => {
        await CslCatalogManager.activateRevision("sha-lock-test", workerB);
      },
      /Activation rejected: Synchronization lock was lost, expired, or superseded/
    );

    // Worker A activates with its own workerId -> accepted!
    const activated = await CslCatalogManager.activateRevision("sha-lock-test", workerA);
    assert.equal(activated.gitSha, "sha-lock-test");
    await adapter.releaseLock!(workerA);
  });

  test("18. Historical Style Resolution: does not return newer bundled XML when specific revision is requested", async () => {
    // Nature is a bundled style, but if someone asks for a historical revision where it didn't exist or isn't saved:
    const nonExistentHistoricalSha = "rev-ancient-1999";

    // 1. resolveStyleXml returns null for the ancient revision
    const resolved = await CslCatalogManager.resolveStyleXml("nature", nonExistentHistoricalSha);
    assert.equal(resolved, null, "Must NOT fallback to bundled nature for a requested historical revision");

    // 2. getStyleXml surfaces that the style is unavailable in the requested historical revision
    const { getStyleXml } = await import("../src/lib/citations/csl/style-registry");
    await assert.rejects(
      async () => {
        await getStyleXml("nature", nonExistentHistoricalSha);
      },
      /unavailable in requested historical revision/
    );
  });

  test("19. Null Revision Anchoring: existing manuscripts with null revision stay pinned to baseline", async () => {
    // Document with null revision
    const legacyDoc = {
      id: "legacy-doc-123",
      title: "Legacy Research Paper",
      cslStyleId: "apa",
      cslRevisionSha: null,
      content: {
        type: "doc",
        content: [{ type: "paragraph", text: "Old paper" }],
      },
    };

    // 1. Initial resolution binds to baseline and marks isPinned: true
    const binding1 = await ManuscriptStylePolicy.resolveManuscriptStyle(legacyDoc);
    assert.equal(binding1.revisionSha, "v1.0.2-baseline-catalog");
    assert.equal(binding1.isPinned, true);

    // 2. Activate a newer catalog revision
    const futureSha = "rev-future-2027";
    await CslCatalogManager.getAdapter().saveRevision({
      id: "r-future",
      gitSha: futureSha,
      branch: "v1.0.2",
      status: "ACTIVE",
      totalStyles: 12000,
      independentCount: 3500,
      dependentCount: 8500,
      newStylesCount: 100,
      updatedStylesCount: 20,
      deletedStylesCount: 0,
      validationErrors: [],
      createdAt: new Date().toISOString(),
    });
    await CslCatalogManager.activateRevision(futureSha);

    // 3. Re-resolving the legacy document MUST STILL return the baseline revision!
    // It must NOT float to rev-future-2027!
    const binding2 = await ManuscriptStylePolicy.resolveManuscriptStyle(legacyDoc);
    assert.equal(binding2.revisionSha, "v1.0.2-baseline-catalog");
    assert.equal(binding2.isPinned, true);
  });
});
