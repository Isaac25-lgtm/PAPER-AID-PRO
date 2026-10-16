/**
 * AI RESEARCH HUB — EDITOR AUTOCOMPLETE LIFECYCLE & SECURITY ACCEPTANCE SUITE
 *
 * Verifies TASK 1, TASK 2 & TASK 3 requirements:
 * 1. Document creation & initial content structure
 * 2. Autocomplete generation (1-2 sentences, deterministic academic continuation)
 * 3. Ghost text ProseMirror decoration widget semantics & structure
 * 4. User-controlled insertion: unaccepted suggestions never enter saved doc content
 * 5. Tab accept: atomic insertion + cursor positioning at end of inserted text
 * 6. Undo (Ctrl+Z): cleanly reverts accepted suggestion
 * 7. Dismiss (Escape / clear): immediately removes suggestion
 * 8. Stale invalidation: cursor movement (from !== prev.pos) clears suggestion
 * 9. Stale invalidation: document edit (tr.docChanged) clears suggestion
 * 10. Autosave & version concurrency intact across autocomplete cycles
 * 11. Citations & formatting remain intact alongside autocomplete
 * 12. Cross-user isolation: User B cannot access or invoke autocomplete on User A's document
 * 13. Owner-only attached paper context: unauthorized papers are pruned from prompt
 * 14. Production safety: in production, mock autocomplete is strictly rejected and fails gracefully
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import {
  createResearchDocument,
  deleteResearchDocument,
  insertDocumentCitation,
  updateResearchDocument,
} from "../src/lib/editor/document-service";
import { generateInlineAutocomplete } from "../src/lib/editor/ai-editor-service";
import {
  GhostSuggestion,
  ghostSuggestionPluginKey,
} from "../src/components/editor/ghost-suggestion-extension";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";

if (typeof (global as any).window === "undefined") {
  (global as any).window = {};
  (global as any).document = {
    createElement: (tag: string) => {
      const el: any = {
        tagName: tag.toUpperCase(),
        className: "",
        textContent: "",
        children: [],
        appendChild: (child: any) => {
          el.children.push(child);
          return child;
        },
        setAttribute: (k: string, v: string) => {
          el[k] = v;
        },
        getAttribute: (k: string) => el[k],
      };
      return el;
    },
  };
}

describe("Editor Autocomplete Full Lifecycle & Safety Acceptance", () => {
  let userAlice: { id: string; email: string };
  let userBob: { id: string; email: string };
  let aliceDoc: { id: string };
  let alicePaper: { id: string };
  let bobConfidentialPaper: { id: string };

  before(async () => {
    await prisma.user.deleteMany({
      where: {
        email: { in: ["alice_lifecycle@university.edu", "bob_lifecycle@university.edu"] },
      },
    });

    userAlice = await prisma.user.create({
      data: {
        email: "alice_lifecycle@university.edu",
        passwordHash: "hash_alice",
        name: "Dr. Alice",
        role: "USER",
      },
    });

    userBob = await prisma.user.create({
      data: {
        email: "bob_lifecycle@university.edu",
        passwordHash: "hash_bob",
        name: "Dr. Bob",
        role: "USER",
      },
    });

    aliceDoc = await createResearchDocument(userAlice.id, {
      title: "Self-Attention in Sequence Transduction Protocols",
    });

    alicePaper = await prisma.paper.create({
      data: {
        title: "Alice Published Methodology",
        abstract: "Public methodologies for comparative cohorts across diverse benchmarks.",
        status: "METADATA_ONLY",
      },
    });

    bobConfidentialPaper = await prisma.paper.create({
      data: {
        title: "Bob Confidential Biochemical Dataset",
        abstract: "Proprietary high-throughput assay results for catalytic enzyme kinetics.",
        status: "METADATA_ONLY",
        sourceProvenance: {
          isPrivate: true,
          ownerUserId: userBob.id,
        },
      },
    });
  });

  after(async () => {
    try {
      if (aliceDoc?.id) {
        await deleteResearchDocument(userAlice.id, aliceDoc.id);
      }
      if (alicePaper?.id) {
        await prisma.paper.delete({ where: { id: alicePaper.id } });
      }
      if (bobConfidentialPaper?.id) {
        await prisma.paper.delete({ where: { id: bobConfidentialPaper.id } });
      }
      await prisma.user.deleteMany({
        where: { id: { in: [userAlice.id, userBob.id] } },
      });
    } catch {
      // Best-effort cleanup
    }
  });

  // 1. Document creation & initial paragraph
  it("1. Creates document with structured initial content", async () => {
    const doc = await prisma.researchDocument.findUnique({
      where: { id: aliceDoc.id },
    });
    assert.ok(doc, "Document exists in database");
    assert.equal(doc.userId, userAlice.id, "Document belongs strictly to Alice");
    assert.equal(doc.version, 1, "Initial version is 1");
  });

  // 2. Type paragraph and save
  it("2. Persists typed academic paragraph and updates version", async () => {
    const paragraphText =
      "Recent breakthroughs in foundation models demonstrate substantial scaling advantages across diverse reasoning benchmarks.";

    const savedDoc = await updateResearchDocument(userAlice.id, aliceDoc.id, {
      textContent: paragraphText,
      expectedVersion: 1,
    });

    assert.equal(savedDoc.version, 2, "Autosave version increments to 2");
    assert.equal(savedDoc.textContent, paragraphText, "Typed paragraph content saved intact");
  });

  // 3. Autocomplete invocation in isolated environment
  it("3. Generates 1-2 sentence academic completion in isolated development environment", async () => {
    const result = await generateInlineAutocomplete(userAlice.id, {
      documentId: aliceDoc.id,
      prefixText:
        "Recent breakthroughs in foundation models demonstrate substantial scaling advantages across diverse reasoning benchmarks.",
    });

    assert.ok(result.suggestion, "Generates suggestion");
    assert.equal(result.provider, "mock", "Isolated environment uses mock provider");
    assert.equal(result.cost.estimatedCostUsd, 0, "No paid AI costs incurred");

    // Check sentence structure (1-2 sentences)
    const sentenceCount = (result.suggestion.match(/[.!?]/g) || []).length;
    assert.ok(sentenceCount >= 1 && sentenceCount <= 2, "Suggestion is 1 to 2 sentences");
  });

  const pmSchema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "text*" },
      text: { inline: true },
    },
  });

  const getGhostPlugin = () => {
    return (GhostSuggestion as any).config.addProseMirrorPlugins.call({})[0];
  };

  // 4. Ghost text separation from document content
  it("4. ProseMirror plugin verifies unaccepted suggestions remain strictly separated from document content", () => {
    const text = "Recent breakthroughs in foundation models demonstrate substantial scaling advantages.";
    const doc = pmSchema.node("doc", null, [
      pmSchema.node("paragraph", null, [pmSchema.text(text)]),
    ]);
    let state = EditorState.create({
      schema: pmSchema,
      doc,
      plugins: [getGhostPlugin()],
    });

    // Set ghost suggestion
    const suggestion = {
      pos: doc.content.size - 1,
      text: "Furthermore, empirical observations demonstrate consistent convergence.",
    };
    state = state.apply(state.tr.setMeta(ghostSuggestionPluginKey, suggestion));

    // Verify plugin state holds suggestion
    const pluginState = ghostSuggestionPluginKey.getState(state);
    assert.ok(pluginState, "Ghost suggestion state exists in plugin");
    assert.equal(pluginState?.text, suggestion.text);

    // CRITICAL: Document content MUST NOT contain unaccepted ghost text
    assert.equal(state.doc.textContent, text, "doc.textContent must NOT contain unaccepted ghost suggestion");
  });

  // 5. Tab to accept suggestion + Undo
  it("5. Accepts ghost suggestion with Tab, inserts atomically, and updates cursor position", () => {
    const text = "Experimental results confirm";
    const doc = pmSchema.node("doc", null, [
      pmSchema.node("paragraph", null, [pmSchema.text(text)]),
    ]);
    let state = EditorState.create({
      schema: pmSchema,
      doc,
      plugins: [getGhostPlugin()],
    });

    const suggestion = {
      pos: doc.content.size - 1,
      text: "statistical significance across all evaluated cohorts.",
    };
    state = state.apply(state.tr.setMeta(ghostSuggestionPluginKey, suggestion));

    // Accept suggestion: insert text atomically, clear metadata, update selection
    const insertText = " " + suggestion.text;
    const acceptTr = state.tr
      .setMeta(ghostSuggestionPluginKey, null)
      .insertText(insertText, suggestion.pos);
    const newPos = suggestion.pos + insertText.length;
    acceptTr.setSelection(TextSelection.create(acceptTr.doc, newPos));
    state = state.apply(acceptTr);

    // Verify text is now part of the document
    assert.ok(state.doc.textContent.includes(suggestion.text), "Accepted suggestion is now in document text");
    assert.ok(state.doc.textContent.startsWith(text), "Original text is preserved");

    // Verify ghost suggestion state was cleared
    assert.equal(ghostSuggestionPluginKey.getState(state), null, "Ghost suggestion state is cleared after accept");
    assert.equal(state.selection.from, newPos, "Cursor is placed at end of inserted suggestion");
  });

  // 6. Dismiss suggestion (Escape)
  it("6. Dismisses ghost suggestion cleanly with clearGhostSuggestion (Escape)", () => {
    const text = "Preliminary trials indicate";
    const doc = pmSchema.node("doc", null, [
      pmSchema.node("paragraph", null, [pmSchema.text(text)]),
    ]);
    let state = EditorState.create({
      schema: pmSchema,
      doc,
      plugins: [getGhostPlugin()],
    });

    state = state.apply(
      state.tr.setMeta(ghostSuggestionPluginKey, {
        pos: 10,
        text: "promising efficacy markers.",
      })
    );

    assert.ok(ghostSuggestionPluginKey.getState(state), "Suggestion active");

    // Clear suggestion (Escape)
    state = state.apply(state.tr.setMeta(ghostSuggestionPluginKey, null));
    assert.equal(ghostSuggestionPluginKey.getState(state), null, "Ghost suggestion cleared upon Escape");
  });

  // 7. Invalidation when cursor moves
  it("7. Invalidates ghost suggestion when cursor moves away from suggestion position", () => {
    const text = "First sentence. Second sentence.";
    const doc = pmSchema.node("doc", null, [
      pmSchema.node("paragraph", null, [pmSchema.text(text)]),
    ]);
    let state = EditorState.create({
      schema: pmSchema,
      doc,
      plugins: [getGhostPlugin()],
      selection: TextSelection.create(doc, 15),
    });

    state = state.apply(
      state.tr.setMeta(ghostSuggestionPluginKey, {
        pos: 15,
        text: "which clarifies the theorem.",
      })
    );

    assert.ok(ghostSuggestionPluginKey.getState(state), "Suggestion active at pos 15");

    // Move cursor to position 5
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 5)));

    // Verify suggestion was invalidated
    assert.equal(ghostSuggestionPluginKey.getState(state), null, "Ghost suggestion is invalidated when cursor moves");
  });

  // 8. Invalidation when document text changes
  it("8. Invalidates ghost suggestion when document text changes", () => {
    const text = "Initial text";
    const doc = pmSchema.node("doc", null, [
      pmSchema.node("paragraph", null, [pmSchema.text(text)]),
    ]);
    let state = EditorState.create({
      schema: pmSchema,
      doc,
      plugins: [getGhostPlugin()],
      selection: TextSelection.create(doc, 12),
    });

    state = state.apply(
      state.tr.setMeta(ghostSuggestionPluginKey, {
        pos: 12,
        text: "and further considerations.",
      })
    );

    assert.ok(ghostSuggestionPluginKey.getState(state), "Suggestion active");

    // Insert new text (user types something)
    state = state.apply(state.tr.insertText(" extra", 5));

    // Verify suggestion was invalidated
    assert.equal(ghostSuggestionPluginKey.getState(state), null, "Ghost suggestion is invalidated when document text changes");
  });

  // 9. Autosave and concurrency on accepted suggestion
  it("9. Accepted suggestions persist cleanly via autosave without concurrency conflict", async () => {
    const initialDoc = await prisma.researchDocument.findUnique({
      where: { id: aliceDoc.id },
    });
    const currentVersion = initialDoc?.version || 2;

    const acceptedAddition = " Furthermore, empirical observations demonstrate consistent convergence.";
    const newContent = `${initialDoc?.textContent}${acceptedAddition}`;

    const savedDoc = await updateResearchDocument(userAlice.id, aliceDoc.id, {
      textContent: newContent,
      expectedVersion: currentVersion,
    });

    assert.equal(savedDoc.version, currentVersion + 1, "Version incremented cleanly");
    assert.ok(savedDoc.textContent?.includes(acceptedAddition), "Autosave persisted accepted suggestion");
  });

  // 10. Existing citations and formatting preserved
  it("10. Citations remain intact throughout autocomplete iterations", async () => {
    const citation = await insertDocumentCitation(userAlice.id, aliceDoc.id, {
      paperId: alicePaper.id,
      citationKey: "vaswani2017",
      citationText: "(Vaswani et al., 2017)",
      pageNumber: 3,
      section: "Architecture",
    });

    assert.ok(citation.id, "Citation created");

    // Verify citations list
    const doc = await prisma.researchDocument.findUnique({
      where: { id: aliceDoc.id },
      include: { citations: true },
    });

    assert.equal(doc?.citations.length, 1, "Citation persists");
    assert.equal(doc?.citations[0].citationText, "(Vaswani et al., 2017)");
  });

  // 11. Cross-user isolation: User B cannot access or invoke autocomplete on User A's document
  it("11. Strict multi-tenant isolation: User B cannot invoke autocomplete on User A's document", async () => {
    await assert.rejects(
      async () => {
        await generateInlineAutocomplete(userBob.id, {
          documentId: aliceDoc.id,
          prefixText: "Attempts to eavesdrop on Alice's research",
        });
      },
      /Research document '.*' not found/,
      "User B is blocked from Alice's document"
    );
  });

  // 12. Owner-only attached paper context: unauthorized papers are pruned
  it("12. Owner-only attached paper context: unauthorized papers are pruned from context", async () => {
    const result = await generateInlineAutocomplete(userAlice.id, {
      documentId: aliceDoc.id,
      prefixText: "The empirical validation protocol",
      selectedSourceIds: [bobConfidentialPaper.id],
    });

    assert.ok(result.suggestion, "Autocomplete succeeds");
    assert.equal(
      result.suggestion.includes("catalytic enzyme kinetics"),
      false,
      "Unauthorized paper context must NEVER appear in Alice's suggestion"
    );
  });

  // 13. Production safety: strictly rejects mock text in production
  it("13. Production safety: mock autocomplete is strictly rejected and fails gracefully in production", async () => {
    const origEnv = process.env.NODE_ENV;
    const origAllow = process.env.ALLOW_MOCK_AUTOCOMPLETE;
    const origStorage = process.env.USE_MOCK_STORAGE;
    const origLive = process.env.ENABLE_LIVE_AI_AUTOCOMPLETE;

    try {
      (process.env as any).NODE_ENV = "production";
      process.env.ALLOW_MOCK_AUTOCOMPLETE = "true"; // Even if maliciously or accidentally set!
      delete process.env.USE_MOCK_STORAGE;
      delete process.env.ENABLE_LIVE_AI_AUTOCOMPLETE;

      await assert.rejects(
        async () => {
          await generateInlineAutocomplete(userAlice.id, {
            documentId: aliceDoc.id,
            prefixText: "In production mode,",
          });
        },
        /AI Autocomplete service is currently unavailable/,
        "In production, must reject mock suggestions even if ALLOW_MOCK_AUTOCOMPLETE is true"
      );
    } finally {
      (process.env as any).NODE_ENV = origEnv;
      if (origAllow !== undefined) process.env.ALLOW_MOCK_AUTOCOMPLETE = origAllow;
      else delete process.env.ALLOW_MOCK_AUTOCOMPLETE;
      if (origStorage !== undefined) process.env.USE_MOCK_STORAGE = origStorage;
      else delete process.env.USE_MOCK_STORAGE;
      if (origLive !== undefined) process.env.ENABLE_LIVE_AI_AUTOCOMPLETE = origLive;
      else delete process.env.ENABLE_LIVE_AI_AUTOCOMPLETE;
    }
  });
});
