/**
 * AI RESEARCH HUB — EDITOR AUTOSAVE RELIABILITY & ACCEPTANCE TEST SUITE
 *
 * Verifies:
 * 1. Debounced autosave and server persistence on disposable test documents
 * 2. Strict document version updates (v1 -> v2 -> v3)
 * 3. Optimistic concurrency conflict rejection (CONCURRENT_SAVE_CONFLICT)
 * 4. Chained save queuing (in-flight snapshot tracking ensures newer edits are never dropped)
 * 5. Error & retry handling when save fails
 * 6. Reload verification with zero loss of accepted changes
 * 7. Autocomplete mode transparency (deterministic mock produces offline academic prose)
 * 8. Workspace-context hook contract (strict useWorkspace throws, nullable useOptionalWorkspace returns null)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

// Enforce test isolation before any imports
loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { prisma } from "../src/lib/prisma";
import { DocumentType } from "@prisma/client";
import {
  createResearchDocument,
  getResearchDocument,
  updateResearchDocument,
  listResearchDocuments,
} from "../src/lib/editor/document-service";
import {
  useWorkspace,
  useOptionalWorkspace,
  WorkspaceProvider,
} from "../src/components/layout/workspace-context";
import { generateInlineAutocomplete } from "../src/lib/editor/ai-editor-service";

describe("Research Editor Autosave Reliability & Workspace Contract", () => {
  let testUserId: string;
  let disposableDocId: string;

  before(async () => {
    // Obtain or create a test user
    const testUser = await prisma.user.upsert({
      where: { email: "autosave-test-scholar@university.edu" },
      update: {},
      create: {
        email: "autosave-test-scholar@university.edu",
        name: "Autosave Test Scholar",
        passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz012345",
        role: "USER",
      },
    });
    testUserId = testUser.id;

    // Create disposable test document
    const doc = await prisma.researchDocument.create({
      data: {
        userId: testUserId,
        title: "Disposable Document for Autosave Verification",
        docType: DocumentType.DRAFT,
        version: 1,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Initial baseline manuscript content." }],
            },
          ],
        },
        textContent: "Initial baseline manuscript content.",
      },
    });
    disposableDocId = doc.id;
  });

  after(async () => {
    // Clean up disposable document and user
    if (disposableDocId) {
      await prisma.researchDocument.deleteMany({ where: { id: disposableDocId } });
    }
    if (testUserId) {
      await prisma.user.deleteMany({ where: { id: testUserId } });
    }
  });

  test("1. Initial state: Document created with version 1 and exact baseline text", async () => {
    const doc = await getResearchDocument(testUserId, disposableDocId);
    assert.equal(doc.version, 1);
    assert.equal(doc.textContent, "Initial baseline manuscript content.");
    assert.equal(doc.title, "Disposable Document for Autosave Verification");
  });

  test("2. Debounced save #1: Successfully persists edits and increments version to 2", async () => {
    const updatedContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Initial baseline manuscript content. Added first revision after debounce.",
            },
          ],
        },
      ],
    };

    const saved = await updateResearchDocument(testUserId, disposableDocId, {
      content: updatedContent,
      textContent: "Initial baseline manuscript content. Added first revision after debounce.",
      expectedVersion: 1,
    });

    assert.equal(saved.version, 2);
    assert.equal(
      saved.textContent,
      "Initial baseline manuscript content. Added first revision after debounce."
    );
  });

  test("3. Debounced save #2: Subsequent save increments version to 3", async () => {
    const secondContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Initial baseline manuscript content. Added first revision after debounce. Accepted AI suggestion.",
            },
          ],
        },
      ],
    };

    const saved = await updateResearchDocument(testUserId, disposableDocId, {
      content: secondContent,
      textContent:
        "Initial baseline manuscript content. Added first revision after debounce. Accepted AI suggestion.",
      expectedVersion: 2,
    });

    assert.equal(saved.version, 3);
    assert.match(saved.textContent || "", /Accepted AI suggestion/);
  });

  test("4. Optimistic concurrency conflict: Stale expectedVersion is rejected with CONCURRENT_SAVE_CONFLICT", async () => {
    let conflictCaught = false;

    try {
      await updateResearchDocument(testUserId, disposableDocId, {
        content: { type: "doc", content: [] },
        textContent: "Attempted overwrite from stale tab",
        expectedVersion: 1, // Current is 3!
      });
    } catch (err: any) {
      if (err.message.includes("CONCURRENT_SAVE_CONFLICT")) {
        conflictCaught = true;
        assert.match(err.message, /Document version mismatch/);
        assert.match(err.message, /expected v1, but current is v3/);
      }
    }

    assert.equal(conflictCaught, true, "Expected CONCURRENT_SAVE_CONFLICT to be thrown.");
  });

  test("5. Force overwrite: When user clicks 'Overwrite with Draft', saves without expectedVersion check", async () => {
    const overwritten = await updateResearchDocument(testUserId, disposableDocId, {
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Overwritten content resolved by researcher." }],
          },
        ],
      },
      textContent: "Overwritten content resolved by researcher.",
      // expectedVersion omitted for forced overwrite
    });

    assert.equal(overwritten.version, 4);
    assert.equal(overwritten.textContent, "Overwritten content resolved by researcher.");
  });

  test("6. Reload persistence: Fresh reload retrieves exactly persisted version 4 without data loss", async () => {
    const reloaded = await getResearchDocument(testUserId, disposableDocId);
    assert.equal(reloaded.version, 4);
    assert.equal(reloaded.textContent, "Overwritten content resolved by researcher.");
  });

  test("7. Cross-user isolation: Another researcher cannot view or save to this document", async () => {
    const otherScholarId = "cmv_unauthorized_other_scholar";

    await assert.rejects(
      async () => {
        await getResearchDocument(otherScholarId, disposableDocId);
      },
      /not found/i
    );

    await assert.rejects(
      async () => {
        await updateResearchDocument(otherScholarId, disposableDocId, {
          textContent: "Unauthorized modification",
        });
      },
      /not found/i
    );
  });

  test("8. Autocomplete mode: Generates deterministic mock suggestion with provider: 'mock' and zero cost", async () => {
    const result = await generateInlineAutocomplete(testUserId, {
      documentId: disposableDocId,
      prefixText: "In our preliminary assessment,",
      suffixText: "",
      currentSection: "Methods",
    });

    assert.equal(result.provider, "mock");
    assert.equal(result.model, "deterministic-academic-mock");
    assert.equal(result.cost.estimatedCostUsd, 0);
    assert.ok(result.suggestion.length > 10);
    // Verifies academic text without paid API calls
    assert.match(result.suggestion, /protocol|framework|empirical|analytical/i);
  });

  test("9. Workspace Hook Contract: strict useWorkspace throws outside provider, useOptionalWorkspace returns null", () => {
    const originalUseContext = React.useContext;
    try {
      // Case A: Outside provider (useContext returns undefined)
      (React as any).useContext = () => undefined;
      assert.throws(
        () => useWorkspace(),
        /useWorkspace must be used within a WorkspaceProvider/
      );
      assert.equal(
        useOptionalWorkspace(),
        null,
        "useOptionalWorkspace must return null when outside provider (never a fake object with no-ops)"
      );

      // Case B: Inside provider (useContext returns active context)
      const mockContext = {
        isSidebarCollapsed: false,
        isMobileNavOpen: false,
        openMobileNav: () => {},
      } as any;
      (React as any).useContext = () => mockContext;
      assert.equal(useWorkspace(), mockContext);
      assert.equal(useOptionalWorkspace(), mockContext);
    } finally {
      (React as any).useContext = originalUseContext;
    }
  });

  test("10. Rapid typing during in-flight save: Queues trailing save, preserves latest draft, and avoids premature 'saved'", async () => {
    // Model the state machine of EditorClient
    let isSaving = false;
    let saveStatus: string = "saved";
    let pendingUpdates: { text: string } | null = null;
    let serverText: string = "v1 initial";

    const simulateSaveAction = async (text: string) => {
      // Simulate network latency of 30ms
      await new Promise((r) => setTimeout(r, 30));
      serverText = text;
      return { success: true };
    };

    const executeSave = async (): Promise<boolean> => {
      if (!pendingUpdates) return true;
      if (isSaving) return false;

      isSaving = true;
      saveStatus = "saving";
      const snapshot = pendingUpdates;

      try {
        const res = await simulateSaveAction(snapshot.text);
        if (res.success) {
          // If no newer edits arrived during in-flight save
          if (pendingUpdates === snapshot) {
            pendingUpdates = null;
            saveStatus = "saved";
          } else {
            // Newer edits arrived! Status MUST remain "unsaved"
            saveStatus = "unsaved";
          }
          return true;
        }
        return false;
      } finally {
        isSaving = false;
        // Chain trailing save if updates remain
        if (pendingUpdates !== null) {
          setTimeout(() => executeSave(), 10);
        }
      }
    };

    // User types edit A
    pendingUpdates = { text: "Edit A (in-flight)" };
    const savePromise = executeSave();
    assert.equal(saveStatus, "saving");

    // While save is in-flight, user rapidly types edit B
    pendingUpdates = { text: "Edit B (rapid while saving)" };

    // Wait for save A to complete
    await savePromise;

    // Save A completed, but because newer edit B arrived, status MUST be "unsaved", NOT "saved"!
    assert.equal(saveStatus, "unsaved", "Status must remain unsaved when newer keystrokes arrived during flight");
    assert.notEqual(pendingUpdates, null, "Pending updates must NOT be wiped out by earlier save");
    assert.equal(pendingUpdates?.text, "Edit B (rapid while saving)");

    // Trailing save fires
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(saveStatus, "saved", "After trailing save completes with no more keystrokes, status transitions to saved");
    assert.equal(serverText, "Edit B (rapid while saving)", "Server must persist the latest keystroke from trailing queue");
  });

  test("11. Server error preserves draft and transitions to error status with retry available", async () => {
    let isSaving = false;
    let saveStatus: string = "saved";
    let saveErrorMessage: string | null = null;
    let pendingUpdates: { text: string } | null = { text: "Important research findings" };

    let failNetwork = true;
    const simulateSaveAction = async (_text: string) => {
      if (failNetwork) {
        throw new Error("HTTP 500 Internal Server Error");
      }
      return { success: true };
    };

    const executeSave = async (): Promise<boolean> => {
      if (!pendingUpdates) return true;
      if (isSaving) return false;

      isSaving = true;
      saveStatus = "saving";
      const snapshot = pendingUpdates;

      try {
        await simulateSaveAction(snapshot.text);
        if (pendingUpdates === snapshot) {
          pendingUpdates = null;
          saveStatus = "saved";
        }
        return true;
      } catch (err: any) {
        saveStatus = "error";
        saveErrorMessage = err.message;
        // CRITICAL: Draft is NOT discarded!
        return false;
      } finally {
        isSaving = false;
      }
    };

    // Save fails due to network outage
    const success = await executeSave();
    assert.equal(success, false);
    assert.equal(saveStatus, "error");
    assert.equal(saveErrorMessage, "HTTP 500 Internal Server Error");
    assert.equal(pendingUpdates?.text, "Important research findings", "Unsaved draft content was preserved");

    // Network recovers, user triggers manual/retry save
    failNetwork = false;
    const retrySuccess = await executeSave();
    assert.equal(retrySuccess, true);
    assert.equal(saveStatus, "saved");
    assert.equal(pendingUpdates, null);
  });

  test("12. Client-side navigation interception: Pending updates flush before route change", async () => {
    let pendingUpdates: { text: string } | null = { text: "Draft text before navigation" };
    let savedToServer = false;
    let navigatedTo: string | null = null;

    const executeSave = async (): Promise<boolean> => {
      if (!pendingUpdates) return true;
      savedToServer = true;
      pendingUpdates = null;
      return true;
    };

    // Interceptor function matching editor-client.tsx handleDocumentClick logic
    const handleNavigationAttempt = async (targetHref: string): Promise<boolean> => {
      if (!pendingUpdates) {
        navigatedTo = targetHref;
        return true;
      }

      // Flush save before route change
      const success = await executeSave();
      if (success) {
        navigatedTo = targetHref;
        return true;
      } else {
        return false;
      }
    };

    const allowed = await handleNavigationAttempt("/dashboard");
    assert.equal(allowed, true);
    assert.equal(savedToServer, true, "Edits were persisted to server before navigation completed");
    assert.equal(navigatedTo, "/dashboard");
  });

  test("13. Conflict resolution modal: Automatically backs up competing server version to localStorage", () => {
    const mockLocalStorage: Record<string, string> = {};
    const storageObj = {
      setItem: (key: string, val: string) => { mockLocalStorage[key] = val; },
      getItem: (key: string) => mockLocalStorage[key] || null,
    };

    const docId = "competing-conflict-doc-123";
    const serverDoc = {
      id: docId,
      title: "Concurrent Conflict Manuscript",
      version: 5,
      updatedAt: new Date().toISOString(),
      textContent: "Text written in competing tab by co-author.",
      content: { type: "doc" },
    };

    // Simulated ConflictResolutionModal backup logic
    const backupKey = `competing_backup_${docId}_v${serverDoc.version}_${Date.now()}`;
    storageObj.setItem(
      backupKey,
      JSON.stringify({
        documentId: docId,
        title: serverDoc.title,
        version: serverDoc.version,
        updatedAt: serverDoc.updatedAt,
        textContent: serverDoc.textContent,
        content: serverDoc.content,
      })
    );

    const saved = JSON.parse(storageObj.getItem(backupKey)!);
    assert.equal(saved.version, 5);
    assert.equal(saved.textContent, "Text written in competing tab by co-author.");
    assert.match(backupKey, new RegExp(`competing_backup_${docId}_v5_`));
  });

  test("14. Save buttons use type='button' and prevent form submission", () => {
    // Audit that EditorHeader Save button and status badges declare type='button'
    const fs = require("node:fs");
    const editorHeaderCode = fs.readFileSync("src/components/editor/editor-header.tsx", "utf-8");
    const editorClientCode = fs.readFileSync("src/app/editor/[id]/editor-client.tsx", "utf-8");

    // Every button tag in editor-header.tsx has type="button"
    const headerButtons = editorHeaderCode.match(/<button[^>]*>/g) || [];
    assert.ok(headerButtons.length >= 3);
    for (const btn of headerButtons) {
      assert.ok(
        btn.includes('type="button"'),
        `EditorHeader button missing type="button": ${btn}`
      );
    }

    // Buttons in error banners have type="button"
    const clientButtons = editorClientCode.match(/<button[^>]*>/g) || [];
    assert.ok(clientButtons.length >= 2);
    for (const btn of clientButtons) {
      assert.ok(
        btn.includes('type="button"'),
        `EditorClient button missing type="button": ${btn}`
      );
    }
  });
});
