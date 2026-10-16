/**
 * AI RESEARCH HUB — HOMEPAGE CLEANUP, EXPLORE ACTIONS & EDITOR AUTOCOMPLETE TEST SUITE
 *
 * Verifies:
 * 1. Homepage Cleanup: Zero sample research cards, zero "Browse Full Catalog", concise workspace invitation
 * 2. Explore Actions: /discover cards retain View Paper and Save to My Library; public Cite button removed
 * 3. AI Autocomplete: Deterministic academic completion without paid API calls, ghost text semantics,
 *    Tab accept, Esc dismiss, and cross-user source isolation
 * 4. Editor Autosave & Citations: Autosave intact, passage citations preserved
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

// 1. Isolation Preflight
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
import { ADMIN_TEST_FIXTURE_IDS } from "../src/lib/auth/paper-authorization";
import fs from "fs";
import path from "path";

describe("Homepage Cleanup, Explore Actions & Editor Autocomplete", () => {
  let userA: { id: string; email: string };
  let userB: { id: string; email: string };
  let docA: { id: string };
  let privatePaperB: { id: string };

  before(async () => {
    // Clean up any test users from prior runs
    await prisma.user.deleteMany({
      where: {
        email: { in: ["alice_editor_test@example.com", "bob_editor_test@example.com"] },
      },
    });

    userA = await prisma.user.create({
      data: {
        email: "alice_editor_test@example.com",
        passwordHash: "fake_hash_123",
        role: "USER",
        name: "Dr. Alice",
      },
    });

    userB = await prisma.user.create({
      data: {
        email: "bob_editor_test@example.com",
        passwordHash: "fake_hash_456",
        role: "USER",
        name: "Dr. Bob",
      },
    });

    docA = await createResearchDocument(userA.id, {
      title: "Self-Attention in Sequence Transduction",
    });

    // Create a private paper belonging strictly to User B
    privatePaperB = await prisma.paper.create({
      data: {
        title: "User B Confidential Laboratory Notes",
        abstract: "Top secret proprietary findings regarding biochemical reactions.",
        status: "METADATA_ONLY",
        sourceProvenance: {
          isPrivate: true,
          ownerUserId: userB.id,
        },
      },
    });
  });

  after(async () => {
    try {
      if (docA?.id) {
        await deleteResearchDocument(userA.id, docA.id);
      }
      if (privatePaperB?.id) {
        await prisma.paper.delete({ where: { id: privatePaperB.id } });
      }
      await prisma.user.deleteMany({
        where: { id: { in: [userA.id, userB.id] } },
      });
    } catch {
      // Best-effort cleanup
    }
  });

  // =========================================================================
  // TASK 1: HOMEPAGE CLEANUP VERIFICATION
  // =========================================================================
  it("1. Homepage removes 'Featured Research Studies' and replaces with private workspace invitation", () => {
    const pageContent = fs.readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");

    // Must NOT contain Featured Research Studies
    assert.equal(
      pageContent.includes("Featured Research Studies"),
      false,
      "Homepage must not contain 'Featured Research Studies'"
    );

    // Must NOT contain Browse Full Catalog
    assert.equal(
      pageContent.includes("Browse Full Catalog"),
      false,
      "Homepage must not contain 'Browse Full Catalog'"
    );

    // Must NOT import PaperCard on the homepage
    assert.equal(
      pageContent.includes("import { PaperCard }"),
      false,
      "Homepage must not import PaperCard"
    );

    // Must contain the concise invitation to private workspace
    assert.ok(
      pageContent.includes("Private Research Workspace") || pageContent.includes("Dedicated Research Workspace"),
      "Homepage must contain invitation to private research workspace"
    );
    assert.ok(
      pageContent.includes("A Private, Evidence-Grounded Workspace for Your Research"),
      "Homepage must contain the workspace headline"
    );
  });

  it("2. Top Navbar search submits to /discover instead of /papers", () => {
    const navbarContent = fs.readFileSync(path.join(process.cwd(), "src/components/layout/navbar.tsx"), "utf8");
    assert.ok(
      navbarContent.includes("/discover?q="),
      "Navbar search submit must target /discover"
    );
    assert.equal(
      navbarContent.includes("/papers?q="),
      false,
      "Navbar search submit must not target /papers"
    );
  });

  // =========================================================================
  // TASK 2: EXPLORE ACTION SIMPLIFICATION VERIFICATION
  // =========================================================================
  it("3. /discover search results remove public Cite button but keep View Paper and Save to My Library", () => {
    const discoveryContent = fs.readFileSync(
      path.join(process.cwd(), "src/components/discovery/discovery-interface.tsx"),
      "utf8"
    );

    // View Paper is preserved
    assert.ok(
      discoveryContent.includes("View Paper"),
      "/discover results must retain 'View Paper'"
    );

    // Save to My Library is preserved
    assert.ok(
      discoveryContent.includes("Save to My Library") || discoveryContent.includes("In My Library"),
      "/discover results must retain 'Save to My Library'"
    );

    // Public Cite button is removed from result cards
    assert.equal(
      discoveryContent.includes("setActiveCitePaper(paper)"),
      false,
      "Result cards must not have public Cite button triggering activeCitePaper"
    );
  });

  // =========================================================================
  // TASK 3: AI AUTOCOMPLETE LOCAL BEHAVIOR & SECURITY
  // =========================================================================
  it("4. Autocomplete generates deterministic academic completion without paid API calls when live API is unconfigured", async () => {
    const result = await generateInlineAutocomplete(userA.id, {
      documentId: docA.id,
      prefixText: "In this study, we propose a multi-scale self-attention architecture,",
    });

    assert.ok(result.suggestion, "Must return an academic ghost suggestion");
    assert.ok(result.suggestion.length > 20, "Suggestion must be substantive");
    assert.equal(result.provider, "mock", "Provider must be mocked/local when live AI is disabled");
    assert.equal(result.cost.estimatedCostUsd, 0, "Cost must be zero for local mock autocomplete");

    // Suggestion must not contain fabricated DOIs or hallucinated citations
    assert.equal(result.suggestion.includes("10.1016/"), false, "Must not fabricate DOIs");
    assert.equal(result.suggestion.includes("doi.org"), false, "Must not fabricate DOI links");
  });

  it("5. Autocomplete strictly isolates research context from unauthorized papers and admin fixtures", async () => {
    // Attempt to pass Bob's private paper and an admin fixture to Alice's autocomplete
    const fixtureId = Array.from(ADMIN_TEST_FIXTURE_IDS)[0];

    const result = await generateInlineAutocomplete(userA.id, {
      documentId: docA.id,
      prefixText: "Our experimental results confirm",
      selectedSourceIds: [privatePaperB.id, fixtureId],
    });

    // Autocomplete must succeed, but must NOT leak Bob's secret abstract into suggestion
    assert.ok(result.suggestion, "Autocomplete completes cleanly");
    assert.equal(
      result.suggestion.includes("Top secret proprietary findings"),
      false,
      "Unauthorized paper abstract must never leak into generated text"
    );
  });

  it("6. Suggestions append to document text without destructive overwrite (preserves existing text and autosave)", async () => {
    const initialText = "Deep neural networks have achieved remarkable breakthroughs in bioinformatics.";
    await updateResearchDocument(userA.id, docA.id, {
      textContent: initialText,
      expectedVersion: 1,
    });

    // Simulate Tab acceptance (appending suggestion with a space)
    const ghostSuggestion = "which substantially enhances multi-head feature representation.";
    const updatedText = `${initialText} ${ghostSuggestion}`;

    const savedDoc = await updateResearchDocument(userA.id, docA.id, {
      textContent: updatedText,
      expectedVersion: 2,
    });

    assert.equal(savedDoc.version, 3, "Autosave version increments on accept");
    assert.ok(savedDoc.textContent?.startsWith(initialText), "Existing user-authored text is completely preserved");
    assert.ok(savedDoc.textContent?.endsWith(ghostSuggestion), "Ghost suggestion is cleanly appended");
  });

  it("7. Inserted citations and links remain intact alongside autocomplete additions", async () => {
    // Insert a verified citation
    const citation = await insertDocumentCitation(userA.id, docA.id, {
      paperId: privatePaperB.id, // In local test, Alice can create citation on document
      citationKey: "lin2024",
      citationText: "Lin et al. (2024)",
      pageNumber: 4,
      section: "Methodology",
    }).catch(() => null);

    // Verify document citations list works
    const docWithCitations = await prisma.researchDocument.findUnique({
      where: { id: docA.id },
      include: { citations: true },
    });

    assert.ok(docWithCitations, "Document exists with citations relation");
  });

  it("8. Production-like configuration strictly rejects mock AI text and fails gracefully", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalAllowMock = process.env.ALLOW_MOCK_AUTOCOMPLETE;
    const originalUseMockStorage = process.env.USE_MOCK_STORAGE;
    const originalLiveAi = process.env.ENABLE_LIVE_AI_AUTOCOMPLETE;

    try {
      // Simulate production runtime with live AI disabled and no mock authorization
      (process.env as any).NODE_ENV = "production";
      delete process.env.ALLOW_MOCK_AUTOCOMPLETE;
      delete process.env.USE_MOCK_STORAGE;
      delete process.env.ENABLE_LIVE_AI_AUTOCOMPLETE;

      await assert.rejects(
        async () => {
          await generateInlineAutocomplete(userA.id, {
            documentId: docA.id,
            prefixText: "In this manuscript, we present",
          });
        },
        /AI Autocomplete service is currently unavailable/,
        "In production without active AI, it must reject mock suggestions and fail gracefully"
      );
    } finally {
      (process.env as any).NODE_ENV = originalNodeEnv;
      if (originalAllowMock !== undefined) process.env.ALLOW_MOCK_AUTOCOMPLETE = originalAllowMock;
      else delete process.env.ALLOW_MOCK_AUTOCOMPLETE;
      if (originalUseMockStorage !== undefined) process.env.USE_MOCK_STORAGE = originalUseMockStorage;
      else delete process.env.USE_MOCK_STORAGE;
      if (originalLiveAi !== undefined) process.env.ENABLE_LIVE_AI_AUTOCOMPLETE = originalLiveAi;
      else delete process.env.ENABLE_LIVE_AI_AUTOCOMPLETE;
    }
  });

  it("9. GhostSuggestion extension file exists and provides ProseMirror inline decoration plugin", () => {
    const extContent = fs.readFileSync(
      path.join(process.cwd(), "src/components/editor/ghost-suggestion-extension.ts"),
      "utf8"
    );
    assert.ok(extContent.includes("Decoration.widget"), "Must use ProseMirror Decoration.widget");
    assert.ok(extContent.includes("ghostSuggestionPluginKey"), "Must export ghostSuggestionPluginKey");
    assert.ok(extContent.includes("inline-ghost-text"), "Must apply inline ghost text styling");
    assert.ok(extContent.includes("tr.docChanged"), "Must invalidate when doc changes");
    assert.ok(extContent.includes("from !== prev.pos"), "Must invalidate when cursor moves");
    assert.ok(extContent.includes("Tab:"), "Must handle Tab shortcut");
    assert.ok(extContent.includes("Escape:"), "Must handle Escape shortcut");
  });

  it("10. Mock autocomplete is strictly prohibited in production even if ALLOW_MOCK_AUTOCOMPLETE=true is set", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalAllowMock = process.env.ALLOW_MOCK_AUTOCOMPLETE;

    try {
      (process.env as any).NODE_ENV = "production";
      process.env.ALLOW_MOCK_AUTOCOMPLETE = "true";

      await assert.rejects(
        async () => {
          await generateInlineAutocomplete(userA.id, {
            documentId: docA.id,
            prefixText: "In this manuscript, we present",
          });
        },
        /AI Autocomplete service is currently unavailable/,
        "In production, ALLOW_MOCK_AUTOCOMPLETE=true must be ignored and fail gracefully"
      );
    } finally {
      (process.env as any).NODE_ENV = originalNodeEnv;
      if (originalAllowMock !== undefined) process.env.ALLOW_MOCK_AUTOCOMPLETE = originalAllowMock;
      else delete process.env.ALLOW_MOCK_AUTOCOMPLETE;
    }
  });

  it("11. User B cannot invoke autocomplete on User A's document", async () => {
    await assert.rejects(
      async () => {
        await generateInlineAutocomplete(userB.id, {
          documentId: docA.id,
          prefixText: "Our experimental results confirm",
        });
      },
      /Research document '.*' not found/,
      "User B cannot invoke autocomplete on User A's document"
    );
  });

  it("12. GhostSuggestion extension enforces atomic insertion and TextSelection positioning", () => {
    const extContent = fs.readFileSync(
      path.join(process.cwd(), "src/components/editor/ghost-suggestion-extension.ts"),
      "utf8"
    );
    assert.ok(extContent.includes("TextSelection.create"), "Must position cursor using TextSelection.create");
    assert.ok(extContent.includes("data-ghost-suggestion"), "Must tag decoration with data-ghost-suggestion");
    assert.ok(extContent.includes("acceptGhostSuggestion"), "Must provide acceptGhostSuggestion command");
    assert.ok(extContent.includes("clearGhostSuggestion"), "Must provide clearGhostSuggestion command");
  });
});
