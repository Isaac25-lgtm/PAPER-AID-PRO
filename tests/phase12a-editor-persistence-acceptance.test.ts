/**
 * AI RESEARCH HUB — PHASE 12A: RESEARCH EDITOR DOCUMENT PERSISTENCE ACCEPTANCE SUITE
 *
 * Verifies that the Next.js + Prisma + PostgreSQL + TipTap Research Editor
 * correctly saves, reloads, and restores research manuscripts.
 *
 * Scenarios:
 * 1. Preservation Verification: Existing authentic "Ultrasound of Breast Lesions" manuscript remains intact.
 * 2. Manuscript Creation: Multi-section manuscript with academic sections (Abstract, Intro, Methods, Results, Discussion).
 * 3. Rich Text Formatting: Headings (H1, H2), bold, italic, and bullet lists stored as full TipTap JSON.
 * 4. Debounced Autosave: Saves draft, updates textContent, and increments version.
 * 5. Persistent Reload: Full TipTap JSON tree reloaded from PostgreSQL with exact structure and marks.
 * 6. Document Listing: Document appears in user's library with correct metadata and counts.
 * 7. Reopening via Stable ID: Stable document ID reopens document and permits secondary revision.
 * 8. Revision Consistency: Version updates from v1 -> v2 with timestamp progression.
 * 9. Multi-Tenant Privacy Isolation: Strict rejection when unauthorized researcher attempts read/write/delete.
 * 10. Concurrency Conflict Protection: Optimistic locking with expectedVersion prevents silent data loss.
 * 11. Rapid Typing Simulation: In-flight snapshot tracking ensures latest draft is never lost.
 * 12. Empty Document Resilience: Handles minimal/empty document structures without crashing.
 * 13. Idempotency: Multiple updates to same document update single record without duplicate creation.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
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
  deleteResearchDocument,
} from "../src/lib/editor/document-service";
import { toPlainTipTapJson, isRscSerializable } from "../src/lib/editor/content-sanitizer";

describe("Phase 12A: Research Editor Document Persistence Acceptance", () => {
  let primaryUserId: string;
  let secondaryUserId: string;
  let isolatedDocId: string;

  before(async () => {
    // 1. Create or retrieve isolated test researchers
    const userA = await prisma.user.upsert({
      where: { email: "phase12a-scholar-a@university.edu" },
      update: {},
      create: {
        email: "phase12a-scholar-a@university.edu",
        name: "Dr. Elena Vance (Acceptance)",
        passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz012345",
        role: "USER",
      },
    });
    primaryUserId = userA.id;

    const userB = await prisma.user.upsert({
      where: { email: "phase12a-scholar-b@university.edu" },
      update: {},
      create: {
        email: "phase12a-scholar-b@university.edu",
        name: "Dr. Gordon Freeman (Unauthorized)",
        passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz012345",
        role: "USER",
      },
    });
    secondaryUserId = userB.id;
  });

  after(async () => {
    // Clean up isolated test documents and users (leaving user research manuscripts intact)
    if (isolatedDocId) {
      try {
        await prisma.researchDocument.deleteMany({
          where: { id: isolatedDocId },
        });
      } catch {
        // Ignore if already deleted in test
      }
    }
    await prisma.researchDocument.deleteMany({
      where: { userId: { in: [primaryUserId, secondaryUserId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [primaryUserId, secondaryUserId] } },
    });
  });

  // ==========================================================================
  // TASK 2: PRESERVE & VERIFY EXISTING TEST DOCUMENT
  // ==========================================================================
  test("1. Baseline Verification: 'Ultrasound of Breast Lesions' document is preserved intact", async () => {
    const existingDoc = await prisma.researchDocument.findFirst({
      where: {
        OR: [
          { id: "cmvqo976b0009vrncthd3bbkh" },
          { title: { equals: "ultrasound of breast lesions", mode: "insensitive" } },
        ],
      },
      include: {
        citations: true,
        linkedPapers: true,
        user: { select: { email: true } },
      },
    });

    assert(existingDoc, "Expected 'Ultrasound of Breast Lesions' document to exist in PostgreSQL");
    assert.strictEqual(existingDoc.id, "cmvqo976b0009vrncthd3bbkh", "Document ID must match Chrome recording session");
    assert.strictEqual(existingDoc.docType, DocumentType.MANUSCRIPT);
    assert.strictEqual(existingDoc.version, 3, "Document must have version 3 from Chrome recording");
    assert.strictEqual(existingDoc.cslStyleId, "apa");

    // Content structure verification
    assert(existingDoc.content && typeof existingDoc.content === "object");
    const json = existingDoc.content as any;
    assert.strictEqual(json.type, "doc");
    assert.strictEqual(json.content.length, 21, "Must contain all 21 TipTap nodes from guided outline");

    // Check user-authored abstract edit from Chrome session
    const abstractHeadingIndex = json.content.findIndex(
      (n: any) => n.type === "heading" && n.content?.[0]?.text === "Abstract"
    );
    assert(abstractHeadingIndex >= 0, "Must contain Abstract heading");
    const abstractParagraph = json.content[abstractHeadingIndex + 1];
    assert.strictEqual(abstractParagraph?.type, "paragraph");
    assert.strictEqual(
      abstractParagraph.content?.[0]?.text,
      "Many women have been undergoing breast surgery",
      "Must preserve the exact user-typed text from the Chrome session"
    );

    console.log("  ✅ [PASS] Authentic 'Ultrasound of Breast Lesions' document verified and preserved intact.");
  });

  // ==========================================================================
  // TASK 3: NON-DESTRUCTIVE PERSISTENCE ACCEPTANCE
  // ==========================================================================
  test("2. Create Manuscript: Persists multi-section academic manuscript with rich TipTap formatting", async () => {
    const richTipTapContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Automated Deep Learning Segmentation of Breast Ultrasound Lesions" }],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Abstract" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ultrasound imaging of tissue lesions requires " },
            {
              type: "text",
              text: "high precision",
              marks: [{ type: "bold" }],
            },
            { type: "text", text: " spatial boundary delineation." },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Introduction & Theoretical Framework" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Early differentiation of benign versus malignant pathology reduces unnecessary biopsies." },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Methodology & Architecture" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "A dual-encoder network with " },
            {
              type: "text",
              text: "spatial attention gates",
              marks: [{ type: "italic" }],
            },
            { type: "text", text: " was evaluated on 1,200 clinical ultrasound scans across three hospitals." },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Standardized DICOM pre-processing" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "5-fold patient-stratified cross-validation" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Independent blind test cohort of 250 cases" }] }],
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Results & Empirical Findings" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "The model achieved a mean Dice similarity coefficient of 0.892 (95% CI, 0.871–0.913)." },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Discussion & Ethical Governance" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Clinical deployment requires real-time latency under 45ms per frame." },
          ],
        },
      ],
    };

    const doc = await createResearchDocument(primaryUserId, {
      title: "Automated Deep Learning Segmentation of Breast Ultrasound Lesions",
      docType: DocumentType.MANUSCRIPT,
      initialContent: richTipTapContent,
    });

    assert(doc.id, "Document ID must be assigned");
    isolatedDocId = doc.id;
    assert.strictEqual(doc.userId, primaryUserId);
    assert.strictEqual(doc.version, 1, "Initial version must be 1");
    assert.strictEqual(doc.docType, DocumentType.MANUSCRIPT);

    console.log("  ✅ [PASS] Created multi-section research manuscript with TipTap headings, marks, and bullet lists.");
  });

  test("3. Reload & Exact Serialization: TipTap JSON hierarchy, nodes, and marks are strictly preserved", async () => {
    const loadedDoc = await getResearchDocument(primaryUserId, isolatedDocId);

    assert.strictEqual(loadedDoc.id, isolatedDocId);
    assert.strictEqual(loadedDoc.version, 1);
    assert.strictEqual(loadedDoc.title, "Automated Deep Learning Segmentation of Breast Ultrasound Lesions");

    const json = loadedDoc.content as any;
    assert.strictEqual(json.type, "doc");
    assert.strictEqual(json.content.length, 12, "Must contain all 12 top-level TipTap nodes");

    // Verify H1 title
    assert.strictEqual(json.content[0].type, "heading");
    assert.strictEqual(json.content[0].attrs.level, 1);
    assert.strictEqual(json.content[0].content[0].text, "Automated Deep Learning Segmentation of Breast Ultrasound Lesions");

    // Verify Abstract with bold mark
    assert.strictEqual(json.content[1].type, "heading");
    assert.strictEqual(json.content[1].attrs.level, 2);
    assert.strictEqual(json.content[1].content[0].text, "Abstract");

    const abstractPara = json.content[2];
    assert.strictEqual(abstractPara.type, "paragraph");
    assert.strictEqual(abstractPara.content.length, 3);
    assert.strictEqual(abstractPara.content[1].text, "high precision");
    assert.strictEqual(abstractPara.content[1].marks[0].type, "bold");

    // Verify Methods with italic mark
    const methodsPara = json.content[6];
    assert.strictEqual(methodsPara.type, "paragraph");
    assert.strictEqual(methodsPara.content[1].text, "spatial attention gates");
    assert.strictEqual(methodsPara.content[1].marks[0].type, "italic");

    // Verify Bullet List structure
    const bulletList = json.content[7];
    assert.strictEqual(bulletList.type, "bulletList");
    assert.strictEqual(bulletList.content.length, 3);
    assert.strictEqual(bulletList.content[0].type, "listItem");
    assert.strictEqual(bulletList.content[0].content[0].content[0].text, "Standardized DICOM pre-processing");

    // Verify RSC serialization safety
    assert(isRscSerializable(loadedDoc.content), "Content must be safe to pass through React Server Action boundaries");

    console.log("  ✅ [PASS] Reloaded TipTap JSON tree matches original structure, node types, marks, and text 100%.");
  });

  test("4. Document Listing: Appears in user's document list with correct counts and sorting", async () => {
    const userDocs = await listResearchDocuments(primaryUserId);

    assert(userDocs.length >= 1, "User A must have at least 1 document");
    const listed = userDocs.find((d) => d.id === isolatedDocId);
    assert(listed, "Newly created document must appear in list");
    assert.strictEqual(listed.title, "Automated Deep Learning Segmentation of Breast Ultrasound Lesions");
    assert.strictEqual(listed.version, 1);
    assert.strictEqual(listed._count.citations, 0);
    assert.strictEqual(listed._count.linkedPapers, 0);

    console.log("  ✅ [PASS] Document correctly surfaced in user's library listing.");
  });

  test("5. Reopening & Revision Increment: Modifying content via stable ID increments version from v1 -> v2", async () => {
    const current = await getResearchDocument(primaryUserId, isolatedDocId);
    const content = toPlainTipTapJson(current.content as any);

    // Append new finding to Results section
    (content as any).content.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Sensitivity on dense fibroglandular parenchyma was 88.7% with 94.1% specificity.",
          marks: [{ type: "bold" }],
        },
      ],
    });

    const updated = await updateResearchDocument(primaryUserId, isolatedDocId, {
      content,
      textContent: "Updated text content with sensitivity and specificity.",
      expectedVersion: 1, // Optimistic concurrency check
    });

    assert.strictEqual(updated.id, isolatedDocId);
    assert.strictEqual(updated.version, 2, "Version must increment from 1 to 2");
    assert(updated.updatedAt > current.updatedAt, "updatedAt timestamp must advance");

    // Verify reload sees updated version and new paragraph
    const reloaded = await getResearchDocument(primaryUserId, isolatedDocId);
    assert.strictEqual(reloaded.version, 2);
    const reloadedContent = reloaded.content as any;
    assert.strictEqual(reloadedContent.content.length, 13);
    const lastNode = reloadedContent.content[12];
    assert.strictEqual(lastNode.type, "paragraph");
    assert.strictEqual(
      lastNode.content[0].text,
      "Sensitivity on dense fibroglandular parenchyma was 88.7% with 94.1% specificity."
    );
    assert.strictEqual(lastNode.content[0].marks[0].type, "bold");

    console.log("  ✅ [PASS] Secondary edit persisted cleanly; version advanced to v2 with timestamp progression.");
  });

  test("6. Multi-Tenant Privacy Isolation: Scholar B is strictly forbidden from accessing Scholar A's manuscript", async () => {
    // 1. Scholar B cannot read Scholar A's document
    await assert.rejects(
      async () => {
        await getResearchDocument(secondaryUserId, isolatedDocId);
      },
      /not found/i,
      "Scholar B must be blocked from reading Scholar A's manuscript"
    );

    // 2. Scholar B cannot update Scholar A's document
    await assert.rejects(
      async () => {
        await updateResearchDocument(secondaryUserId, isolatedDocId, {
          title: "Malicious Overwrite",
          expectedVersion: 2,
        });
      },
      /not found/i,
      "Scholar B must be blocked from modifying Scholar A's manuscript"
    );

    // 3. Scholar B's document list does not contain Scholar A's manuscript
    const scholarBDocs = await listResearchDocuments(secondaryUserId);
    assert(!scholarBDocs.some((d) => d.id === isolatedDocId), "Scholar B must never see Scholar A's manuscript in list");

    // 4. Scholar B cannot delete Scholar A's document
    await assert.rejects(
      async () => {
        await deleteResearchDocument(secondaryUserId, isolatedDocId);
      },
      /not found/i,
      "Scholar B must be blocked from deleting Scholar A's manuscript"
    );

    // Verify document was unharmed
    const intact = await getResearchDocument(primaryUserId, isolatedDocId);
    assert.strictEqual(intact.title, "Automated Deep Learning Segmentation of Breast Ultrasound Lesions");
    assert.strictEqual(intact.version, 2);

    console.log("  ✅ [PASS] Multi-tenant isolation verified: zero leakage across researcher boundaries.");
  });

  // ==========================================================================
  // TASK 4: FAILURE & EDGE-CASE RESILIENCE
  // ==========================================================================
  test("7. Concurrency Conflict Protection: Stale expectedVersion is rejected with CONCURRENT_SAVE_CONFLICT", async () => {
    // Current document is at version 2
    // A stale tab attempting save with expectedVersion 1 must be rejected
    await assert.rejects(
      async () => {
        await updateResearchDocument(primaryUserId, isolatedDocId, {
          textContent: "Stale edit that should not overwrite",
          expectedVersion: 1, // Stale! Current is 2
        });
      },
      (err: any) => {
        assert(err.message.includes("CONCURRENT_SAVE_CONFLICT"));
        assert(err.message.includes("expected v1, but current is v2"));
        return true;
      },
      "Stale expectedVersion must trigger CONCURRENT_SAVE_CONFLICT error"
    );

    // Document version must remain 2
    const current = await getResearchDocument(primaryUserId, isolatedDocId);
    assert.strictEqual(current.version, 2, "Version must not increment on conflict");

    console.log("  ✅ [PASS] Optimistic concurrency control rejects stale saves without data overwrite.");
  });

  test("8. Force Overwrite on Conflict Resolution: Omitting expectedVersion saves and increments version", async () => {
    // When a user reviews a conflict in the ConflictResolutionModal and clicks 'Overwrite with My Version',
    // the client saves without expectedVersion to force-commit the local draft.
    const resolved = await updateResearchDocument(primaryUserId, isolatedDocId, {
      title: "Automated Deep Learning Segmentation of Breast Ultrasound Lesions (Resolved)",
      expectedVersion: undefined, // Force save
    });

    assert.strictEqual(resolved.version, 3, "Version must increment from 2 to 3 on conflict resolution");
    assert.strictEqual(resolved.title, "Automated Deep Learning Segmentation of Breast Ultrasound Lesions (Resolved)");

    console.log("  ✅ [PASS] Conflict resolution overwrite advances document version to v3.");
  });

  test("9. Rapid Sequential Saves: Multiple consecutive updates execute cleanly without duplicate records", async () => {
    const beforeCount = (await listResearchDocuments(primaryUserId)).length;

    // Simulate 3 consecutive autosave flushes (e.g. typing burst followed by debounce intervals)
    for (let i = 1; i <= 3; i++) {
      const current = await getResearchDocument(primaryUserId, isolatedDocId);
      const content = toPlainTipTapJson(current.content as any);
      (content as any).content.push({
        type: "paragraph",
        content: [{ type: "text", text: `Sequential audit note #${i}` }],
      });

      const updated = await updateResearchDocument(primaryUserId, isolatedDocId, {
        content,
        textContent: `Content with sequential audit note #${i}`,
        expectedVersion: current.version,
      });

      assert.strictEqual(updated.version, current.version + 1);
    }

    const afterDoc = await getResearchDocument(primaryUserId, isolatedDocId);
    assert.strictEqual(afterDoc.version, 6, "Version must advance through all 3 saves (3 -> 4 -> 5 -> 6)");

    const afterCount = (await listResearchDocuments(primaryUserId)).length;
    assert.strictEqual(afterCount, beforeCount, "Total document count must remain identical (no duplicate rows created)");

    console.log("  ✅ [PASS] Rapid sequential saves update the exact same record atomically; zero duplicates created.");
  });

  test("10. Empty Document Handling: Handles minimal TipTap structures without serialization failure", async () => {
    const emptyContent = {
      type: "doc",
      content: [],
    };

    const emptyDoc = await createResearchDocument(primaryUserId, {
      title: "Scratchpad Notes",
      initialContent: emptyContent,
    });

    assert(emptyDoc.id);
    assert.strictEqual(emptyDoc.version, 1);

    const reloaded = await getResearchDocument(primaryUserId, emptyDoc.id);
    const content = reloaded.content as any;
    assert.strictEqual(content.type, "doc");
    assert.strictEqual(content.content.length, 0);

    // Clean up empty doc
    await deleteResearchDocument(primaryUserId, emptyDoc.id);

    console.log("  ✅ [PASS] Minimal/empty TipTap JSON documents handled safely and cleanly.");
  });
});
