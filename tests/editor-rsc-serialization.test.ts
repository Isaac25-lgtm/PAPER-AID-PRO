/**
 * AI RESEARCH HUB — REGRESSION TEST SUITE: SERVER ACTION RSC SERIALIZATION
 *
 * Catches the exact Chrome P0 error:
 * "Autosave failed: Only plain objects, and a few built-ins, can be passed to Server Actions. Classes or null prototypes are not supported."
 *
 * Verifies:
 * 1. Root-cause replication: Objects with null prototypes (e.g. ProseMirror's attrs from Object.create(null))
 *    trigger the exact Next.js RSC Server Action serialization error.
 * 2. Sanitization: toPlainTipTapJson transforms the tree into plain Object.prototype objects.
 * 3. Structure & Attribute Preservation: Headings, levels, paragraphs, marks, tables, and metadata survive cleanly.
 * 4. End-to-end Server Action execution: saveDocumentAction successfully persists the sanitized payload to database.
 * 5. Failure recovery & draft retention: When an error occurs, pending updates remain intact in memory and
 *    subsequent retry successfully saves.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { prisma } from "../src/lib/prisma";
import { DocumentType } from "@prisma/client";
import { toPlainTipTapJson, isRscSerializable } from "../src/lib/editor/content-sanitizer";
import { saveDocumentAction, getDocumentAction } from "../src/app/editor/actions";

// The exact check performed by Next.js / React Flight (react-server-dom-webpack-client)
function assertNextJsServerActionSerializable(value: any, path = "root"): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, idx) => assertNextJsServerActionSerializable(item, `${path}[${idx}]`));
    return;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && (proto === null || Object.getPrototypeOf(proto) !== null)) {
    throw new Error(
      `Only plain objects, and a few built-ins, can be passed to Server Actions. Classes or null prototypes are not supported. (Failed at ${path})`
    );
  }

  for (const key of Object.keys(value)) {
    assertNextJsServerActionSerializable(value[key], `${path}.${key}`);
  }
}

describe("P0 Autosave Server Action RSC Serialization Regression Suite", () => {
  let testUserId: string;
  let testDocId: string;

  before(async () => {
    // Set mock NextAuth session for Server Action
    const nextAuthNext = require("next-auth/next");
    const user = await prisma.user.upsert({
      where: { email: "rsc-autosave-test@academic.local" },
      update: {},
      create: {
        email: "rsc-autosave-test@academic.local",
        name: "Dr. Serialization Test",
        passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz012345",
        role: "USER",
      },
    });
    testUserId = user.id;
    nextAuthNext.getServerSession = async () => ({
      user: { id: testUserId, email: user.email, role: user.role },
    });

    const doc = await prisma.researchDocument.create({
      data: {
        userId: testUserId,
        title: "RSC Serialization Test Manuscript",
        docType: DocumentType.DRAFT,
        version: 1,
        content: { type: "doc", content: [] },
        textContent: "",
      },
    });
    testDocId = doc.id;
  });

  after(async () => {
    if (testDocId) {
      await prisma.researchDocument.deleteMany({ where: { id: testDocId } });
    }
    if (testUserId) {
      await prisma.user.deleteMany({ where: { id: testUserId } });
    }
  });

  test("1. Exact Error Replication: TipTap node with Object.create(null) attrs fails Next.js Server Action check", () => {
    // Emulate ProseMirror computeAttrs() / defaultAttrs() behavior
    const nullAttrs = Object.create(null);
    nullAttrs.level = 1;

    const tipTapTreeWithNullProto = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: nullAttrs, // NULL PROTOTYPE
          content: [{ type: "text", text: "Introduction to Single-Cell Spatial Proteomics" }],
        },
      ],
    };

    assert.equal(Object.getPrototypeOf(nullAttrs), null);
    assert.equal(isRscSerializable(tipTapTreeWithNullProto), false);

    // Verify it throws the exact Chrome error string
    assert.throws(
      () => assertNextJsServerActionSerializable(tipTapTreeWithNullProto),
      /Only plain objects, and a few built-ins, can be passed to Server Actions\. Classes or null prototypes are not supported\./
    );
  });

  test("2. Sanitization: toPlainTipTapJson cures null prototypes into plain objects", () => {
    const nullAttrs = Object.create(null);
    nullAttrs.level = 2;

    const nullMarkAttrs = Object.create(null);
    nullMarkAttrs.href = "https://doi.org/10.1016/j.cell.2026.01.001";

    const complexTree = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: nullAttrs,
          content: [{ type: "text", text: "Methodology & Empirical Benchmark" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Grounded empirical citation: ",
            },
            {
              type: "text",
              marks: [{ type: "link", attrs: nullMarkAttrs }],
              text: "Vance et al., 2026",
            },
          ],
        },
      ],
      meta: {
        docType: "MANUSCRIPT",
        researchTopic: "Spatial Proteomics",
      },
    };

    // Before sanitization: fails
    assert.throws(() => assertNextJsServerActionSerializable(complexTree));

    // After sanitization: passes cleanly
    const sanitized = toPlainTipTapJson(complexTree);
    assert.doesNotThrow(() => assertNextJsServerActionSerializable(sanitized));
    assert.equal(isRscSerializable(sanitized), true);

    // Verify deep attribute preservation
    const sanitizedAny = sanitized as any;
    assert.equal(sanitizedAny.content[0].attrs.level, 2);
    assert.equal(sanitizedAny.content[1].content[1].marks[0].attrs.href, "https://doi.org/10.1016/j.cell.2026.01.001");
    assert.equal(sanitizedAny.meta.researchTopic, "Spatial Proteomics");
    assert.equal(Object.getPrototypeOf(sanitizedAny.content[0].attrs), Object.prototype);
  });

  test("3. End-to-End Server Action Persistence: saveDocumentAction successfully persists sanitized TipTap tree", async () => {
    const nullHeadingAttrs = Object.create(null);
    nullHeadingAttrs.level = 1;

    const rawPayload = {
      content: toPlainTipTapJson({
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: nullHeadingAttrs,
            content: [{ type: "text", text: "Deep Spatial Proteomic Profiling in Ovarian Cancer" }],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "We demonstrate sub-micron resolution profiling with validated empirical antibody panels.",
              },
            ],
          },
        ],
      }),
      textContent: "Deep Spatial Proteomic Profiling in Ovarian Cancer\nWe demonstrate sub-micron resolution profiling with validated empirical antibody panels.",
      expectedVersion: 1,
    };

    // Confirm payload passes RSC serialization validation before sending
    assert.doesNotThrow(() => assertNextJsServerActionSerializable(rawPayload));

    // Execute Server Action
    const result = await saveDocumentAction(testDocId, rawPayload);

    assert.equal(result.success, true);
    assert.equal(result.version, 2);
    assert.ok(result.document);
    assert.equal(result.document.id, testDocId);

    // Verify DB round-trip retrieval
    const retrieved = await getDocumentAction(testDocId);
    assert.equal(retrieved.success, true);
    assert.equal(retrieved.document?.version, 2);
    assert.match(retrieved.document?.textContent || "", /sub-micron resolution profiling/);
  });

  test("4. Failure Recovery & In-Memory Draft Protection", async () => {
    // Model the exact EditorClient state machine
    let inMemoryDraft: any = {
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Crucial unsaved researcher findings" }] }],
      },
      textContent: "Crucial unsaved researcher findings",
    };
    let saveStatus = "unsaved";
    let saveErrorMessage: string | null = null;

    let failNetwork = true;
    const executeSaveSimulation = async (contentToSend: any): Promise<boolean> => {
      try {
        // Enforce Next.js RSC serialization check
        assertNextJsServerActionSerializable(contentToSend);
        if (failNetwork) {
          throw new Error("HTTP 500 Connection Refused");
        }
        // Save succeeded!
        inMemoryDraft = null;
        saveStatus = "saved";
        saveErrorMessage = null;
        return true;
      } catch (err: any) {
        // Serialization or network failure: DRAFT MUST NOT BE CLEARED!
        saveStatus = "error";
        saveErrorMessage = err.message;
        return false;
      }
    };

    // Step A: Attempt save with null prototype (pre-fix condition)
    const brokenContent = {
      type: "doc",
      content: [{ type: "heading", attrs: Object.create(null), content: [] }],
    };
    const attempt1 = await executeSaveSimulation(brokenContent);

    assert.equal(attempt1, false);
    assert.equal(saveStatus, "error");
    assert.match(saveErrorMessage || "", /Classes or null prototypes are not supported/);
    assert.notEqual(inMemoryDraft, null, "In-memory draft was preserved during serialization failure");

    // Step B: User clicks 'Retry Saving Now' with sanitized payload
    failNetwork = false;
    const curedContent = toPlainTipTapJson(brokenContent);
    const retryAttempt = await executeSaveSimulation(curedContent);

    assert.equal(retryAttempt, true);
    assert.equal(saveStatus, "saved");
    assert.equal(saveErrorMessage, null);
    assert.equal(inMemoryDraft, null, "Draft cleanly cleared only after verified persistence");
  });
});
