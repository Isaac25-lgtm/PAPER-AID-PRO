/**
 * AI RESEARCH HUB — PHASE 7B: AI RESEARCH EDITOR CORE TEST SUITE
 *
 * Validates:
 * 1. Document Lifecycle (Create, List, Rename, Autosave, Versioning)
 * 2. Strict Per-User Ownership and Authorization Isolation (User B cannot touch User A's docs)
 * 3. Optimistic Concurrency Control (Version mismatch detection prevents destructive overwrites)
 * 4. Research Sources Attachment & Benchmark Quarantine Protection
 * 5. Verified Citation Insertion (Bibliographic vs Passage-Verified with chunk provenance)
 * 6. AI Writing Assistance (Jenni-style inline ghost autocomplete, 4 rewrite modes, evidence summary)
 * 7. Privacy Guard Enforcement (Private classification on all editor content, fail-closed)
 * 8. Missing Credentials Graceful Handling
 * 9. Cascading Deletion & Clean-up
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

// 1. ISOLATION PRE-FLIGHT
console.log("=== STEP 1: INITIALIZING ISOLATED TEST ENVIRONMENT ===");
loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { prisma } from "../src/lib/prisma";
import { DocumentType, CitationType } from "@prisma/client";
import {
  createResearchDocument,
  getResearchDocument,
  listResearchDocuments,
  updateResearchDocument,
  renameResearchDocument,
  deleteResearchDocument,
  attachDocumentPaper,
  detachDocumentPaper,
  insertDocumentCitation,
  deleteDocumentCitation,
} from "../src/lib/editor/document-service";
import {
  generateInlineAutocomplete,
  rewriteSelectedText,
  summarizeEvidenceForEditor,
} from "../src/lib/editor/ai-editor-service";
import {
  ModelRouter,
  ProviderAdapter,
  ModelRequest,
  ModelResponse,
} from "../src/lib/ai/router";

// Mock Provider Adapter for testing AI editor capabilities deterministically
class MockEditorAdapter implements ProviderAdapter {
  public readonly provider: any;
  constructor(providerName: any = "anthropic") {
    this.provider = providerName;
  }
  isConfigured(): boolean {
    return true;
  }
  async generate(request: ModelRequest): Promise<ModelResponse> {
    const providerName = this.provider;
    const modelName = providerName === "google" ? "gemini-3.5-flash-lite" : "claude-sonnet-5";

    const usage = { promptTokens: 40, completionTokens: 12, totalTokens: 52 };
    const cost = { estimatedCostUsd: 0.0002, isEstimate: true as const, pricingTier: "standard" };

    if (request.prompt.includes("Continue drafting the next") || request.prompt.includes("academic continuation")) {
      return {
        text: "which significantly optimizes multi-head self-attention throughput.",
        provider: providerName,
        model: modelName,
        usage,
        cost,
        metrics: { ttftMs: 50, durationMs: 95 },
      };
    }
    if (request.prompt.includes("scholarly rigor") || request.prompt.includes("Academic Tone")) {
      return {
        text: "The empirical findings demonstrate statistically significant advantages across distributed clusters.",
        provider: providerName,
        model: modelName,
        usage,
        cost,
        metrics: { ttftMs: 60, durationMs: 110 },
      };
    }
    if (request.prompt.includes("Paraphrase the selected") || request.prompt.includes("Paraphrase")) {
      return {
        text: "Our evaluations indicate notable efficiency gains in distributed execution.",
        provider: providerName,
        model: modelName,
        usage,
        cost,
        metrics: { ttftMs: 55, durationMs: 100 },
      };
    }
    if (request.prompt.includes("Tighten the selected") || request.prompt.includes("Make Concise")) {
      return {
        text: "Performance improved by 35% across clusters.",
        provider: providerName,
        model: modelName,
        usage,
        cost,
        metrics: { ttftMs: 40, durationMs: 80 },
      };
    }
    if (request.prompt.includes("Elaborate on the conceptual") || request.prompt.includes("Expand with Detail")) {
      return {
        text: "The systematic benchmark results reveal a 35% reduction in latency across heterogeneous GPU configurations under varying sequence lengths.",
        provider: providerName,
        model: modelName,
        usage,
        cost,
        metrics: { ttftMs: 70, durationMs: 140 },
      };
    }
    // Default summary
    return {
      text: "Vaswani et al. (2017) introduce the Transformer architecture, replacing recurrent layers entirely with self-attention mechanisms to achieve superior translation quality and parallelizability.",
      provider: providerName,
      model: modelName,
      usage,
      cost,
      metrics: { ttftMs: 65, durationMs: 120 },
    };
  }
  async *generateStream(): AsyncIterable<any> {
    yield { textDelta: "mock stream" };
  }
  async validateModel(): Promise<boolean> {
    return true;
  }
}

async function runPhase7BTestSuite() {
  console.log("\n==================================================================");
  console.log("AI RESEARCH HUB — PHASE 7B: AI RESEARCH EDITOR ACCEPTANCE SUITE");
  console.log("==================================================================");

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, details?: string) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  ✓ [PASS] ${testName}`);
    } else {
      console.error(`  ✗ [FAIL] ${testName}`);
      if (details) console.error(`    ↳ Details: ${details}`);
    }
  }

  // Set up test users
  const userA = await prisma.user.upsert({
    where: { email: "editor_user_a@test.local" },
    update: {},
    create: {
      email: "editor_user_a@test.local",
      name: "Researcher Alice",
      passwordHash: "hashed_test_password",
      role: "USER",
    },
  });

  const userB = await prisma.user.upsert({
    where: { email: "editor_user_b@test.local" },
    update: {},
    create: {
      email: "editor_user_b@test.local",
      name: "Researcher Bob",
      passwordHash: "hashed_test_password",
      role: "USER",
    },
  });

  // Fetch or create a test paper (Attention Is All You Need)
  let testPaper = await prisma.paper.findFirst({
    where: {
      doi: "10.48550/arXiv.1706.03762",
      status: "COMPLETED",
      chunks: { some: { pageNumber: 1 } },
    },
    include: { chunks: true },
  });

  if (!testPaper) {
    testPaper = await prisma.paper.create({
      data: {
        title: "Attention Is All You Need",
        abstract: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
        doi: "10.48550/arXiv.1706.03762",
        status: "COMPLETED",
        chunks: {
          create: [
            {
              chunkIndex: 0,
              text: "We propose the Transformer, a model architecture eschewing recurrence and relying entirely on an attention mechanism.",
              pageNumber: 1,
              section: "Abstract",
              tokenCount: 25,
            },
            {
              chunkIndex: 1,
              text: "On the WMT 2014 English-to-German translation task, the big transformer model achieves 28.4 BLEU.",
              pageNumber: 8,
              section: "Results",
              tokenCount: 22,
            },
          ],
        },
      },
      include: { chunks: true },
    });
  }

  // Create a quarantined benchmark fixture paper
  const fixturePaper = await prisma.paper.upsert({
    where: { id: "benchmark_fixture_test_paper" },
    update: {},
    create: {
      id: "benchmark_fixture_test_paper",
      title: "Quarantined Benchmark Fixture Paper",
      abstract: "This paper is reserved strictly for automated ground-truth benchmarks.",
      status: "COMPLETED",
      sourceProvenance: { isBenchmarkFixture: true },
      rawMetadata: { adminOnly: true },
    },
  });

  // Create a private paper belonging to user B
  const privatePaperB = await prisma.paper.upsert({
    where: { id: "private_paper_user_b" },
    update: {},
    create: {
      id: "private_paper_user_b",
      title: "User B Confidential Dissertation Draft",
      abstract: "Confidential research by User B.",
      status: "COMPLETED",
      sourceProvenance: { isPrivate: true, ownerUserId: userB.id },
    },
  });

  let docA: any = null;

  try {
    // --------------------------------------------------------------------------
    // TEST SECTION 1: DOCUMENT CREATION & LISTING
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION 1: Document Creation & Listing ---");

    docA = await createResearchDocument(userA.id, {
      title: "Quantum Transformer Networks: A Systematic Survey",
      docType: DocumentType.LITERATURE_REVIEW,
    });

    assert(Boolean(docA.id), "Creates research document with unique ID", `ID: ${docA.id}`);
    assert(docA.userId === userA.id, "Document belongs strictly to User A");
    assert(docA.title === "Quantum Transformer Networks: A Systematic Survey", "Preserves exact title");
    assert(docA.docType === DocumentType.LITERATURE_REVIEW, "Preserves DocumentType enum");
    assert(docA.version === 1, "Initial document version is 1");
    assert(Boolean(docA.content), "Initial TipTap JSON content structure is present");
    assert(Boolean(docA.textContent), "Initial text content is present");

    const userADocs = await listResearchDocuments(userA.id);
    assert(
      userADocs.some((d) => d.id === docA.id),
      "User A documents list includes the newly created document"
    );

    const userBDocs = await listResearchDocuments(userB.id);
    assert(
      !userBDocs.some((d) => d.id === docA.id),
      "User B documents list NEVER includes User A's document"
    );

    // --------------------------------------------------------------------------
    // TEST SECTION 2: EDITING, AUTOSAVE & OPTIMISTIC CONCURRENCY CONTROL
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION 2: Editing, Autosave & Concurrency Protection ---");

    const newTipTapContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Quantum Transformer Networks" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Recent developments in parameterized quantum circuits suggest potential quantum speedups.",
            },
          ],
        },
      ],
    };

    const updatedDoc1 = await updateResearchDocument(userA.id, docA.id, {
      content: newTipTapContent,
      textContent: "Quantum Transformer Networks\nRecent developments in parameterized quantum circuits suggest potential quantum speedups.",
      expectedVersion: 1,
    });

    assert(updatedDoc1.version === 2, "Successful autosave increments version to 2");
    assert(Boolean(updatedDoc1.textContent?.includes("parameterized quantum circuits")), "Text content safely persisted");

    // Concurrency conflict test: passing stale version 1 when DB version is 2
    let conflictCaught = false;
    try {
      await updateResearchDocument(userA.id, docA.id, {
        textContent: "Concurrent modification that should fail",
        expectedVersion: 1, // Stale!
      });
    } catch (err: any) {
      if (err.message?.includes("CONCURRENT_SAVE_CONFLICT")) {
        conflictCaught = true;
      }
    }
    assert(conflictCaught, "Throws CONCURRENT_SAVE_CONFLICT when expectedVersion does not match current version");

    // Successful update with current version 2
    const updatedDoc2 = await updateResearchDocument(userA.id, docA.id, {
      textContent: "Quantum Transformer Networks\nUpdated second revision.",
      expectedVersion: 2,
    });
    assert(updatedDoc2.version === 3, "Version correctly bumped to 3 on successful resolve");

    // Rename document test
    const renamed = await renameResearchDocument(userA.id, docA.id, "Renamed Survey Title");
    assert(renamed.title === "Renamed Survey Title", "Rename succeeds and updates document title");

    // --------------------------------------------------------------------------
    // TEST SECTION 3: CROSS-USER ACCESS REJECTION
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION 3: Cross-User Access Isolation ---");

    let readBlocked = false;
    try {
      await getResearchDocument(userB.id, docA.id);
    } catch (err: any) {
      readBlocked = true;
    }
    assert(readBlocked, "User B cannot read User A's document");

    let updateBlocked = false;
    try {
      await updateResearchDocument(userB.id, docA.id, { title: "Malicious Overwrite" });
    } catch (err: any) {
      updateBlocked = true;
    }
    assert(updateBlocked, "User B cannot update User A's document");

    let renameBlocked = false;
    try {
      await renameResearchDocument(userB.id, docA.id, "Hacked Title");
    } catch (err: any) {
      renameBlocked = true;
    }
    assert(renameBlocked, "User B cannot rename User A's document");

    let deleteBlocked = false;
    try {
      await deleteResearchDocument(userB.id, docA.id);
    } catch (err: any) {
      deleteBlocked = true;
    }
    assert(deleteBlocked, "User B cannot delete User A's document");

    // --------------------------------------------------------------------------
    // TEST SECTION 4: RESEARCH SOURCE ATTACHMENT & QUARANTINE SECURITY
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION 4: Research Sources & Quarantine Protection ---");

    // Attach accessible public paper
    const attachedSource = await attachDocumentPaper(userA.id, docA.id, testPaper.id);
    assert(attachedSource.paperId === testPaper.id, "Successfully attaches accessible library paper");

    // Re-attaching same paper is idempotent
    const reattached = await attachDocumentPaper(userA.id, docA.id, testPaper.id);
    assert(reattached.id === attachedSource.id, "Attaching same paper is idempotent");

    // Attempt to attach quarantined benchmark fixture
    let fixtureBlocked = false;
    try {
      await attachDocumentPaper(userA.id, docA.id, fixturePaper.id);
    } catch (err: any) {
      if (err.message?.includes("benchmark fixture")) {
        fixtureBlocked = true;
      }
    }
    assert(fixtureBlocked, "Quarantined benchmark fixture is rejected from researcher document");

    // Attempt to attach User B's private manuscript
    let privatePaperBlocked = false;
    try {
      await attachDocumentPaper(userA.id, docA.id, privatePaperB.id);
    } catch (err: any) {
      if (err.message?.includes("private manuscript")) {
        privatePaperBlocked = true;
      }
    }
    assert(privatePaperBlocked, "User B's private manuscript cannot be attached by User A");

    // --------------------------------------------------------------------------
    // TEST SECTION 5: VERIFIED CITATION INSERTION
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION 5: Verified Citation Insertion ---");

    // Insert bibliographic citation
    const bibCitation = await insertDocumentCitation(userA.id, docA.id, {
      paperId: testPaper.id,
      citationType: CitationType.BIBLIOGRAPHIC,
      citationText: "(Vaswani et al., 2017)",
    });

    assert(bibCitation.citationType === CitationType.BIBLIOGRAPHIC, "Inserts BIBLIOGRAPHIC citation");
    assert(bibCitation.citationText === "(Vaswani et al., 2017)", "Stores formatted citation text");
    assert(bibCitation.documentId === docA.id, "Links citation to document");

    // Insert passage-verified citation anchored to chunk
    const chunk = testPaper.chunks.find((c: any) => c.pageNumber === 1) || testPaper.chunks[0];
    const passageCitation = await insertDocumentCitation(userA.id, docA.id, {
      paperId: testPaper.id,
      chunkId: chunk?.id,
      citationType: CitationType.PASSAGE_VERIFIED,
      citationText: "(Vaswani et al., 2017, p. 1)",
      pageNumber: chunk?.pageNumber ?? undefined,
      section: chunk?.section ?? undefined,
    });

    assert(passageCitation.citationType === CitationType.PASSAGE_VERIFIED, "Inserts PASSAGE_VERIFIED citation");
    assert(passageCitation.chunkId === chunk?.id, "Links citation to verified chunk ID");
    assert(passageCitation.pageNumber === 1, "Anchors citation to page 1");

    // Verify document citations list via getResearchDocument
    const docWithCitations = await getResearchDocument(userA.id, docA.id);
    assert(docWithCitations.citations.length === 2, "Document includes both citations");
    assert(docWithCitations.linkedPapers.length === 1, "Document includes attached paper");

    // Delete single citation
    await deleteDocumentCitation(userA.id, docA.id, bibCitation.id);
    const docAfterCiteDelete = await getResearchDocument(userA.id, docA.id);
    assert(docAfterCiteDelete.citations.length === 1, "Single citation deleted successfully");

    // Detach paper
    await detachDocumentPaper(userA.id, docA.id, testPaper.id);
    const docAfterDetach = await getResearchDocument(userA.id, docA.id);
    assert(docAfterDetach.linkedPapers.length === 0, "Source paper detached successfully");

    // Re-attach paper for AI testing
    await attachDocumentPaper(userA.id, docA.id, testPaper.id);

    // --------------------------------------------------------------------------
    // TEST SECTION 6: AI WRITING ASSISTANCE (MOCKED MODEL ROUTER)
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION 6: AI Writing Assistance ---");

    const mockRouter = new ModelRouter({
      google: new MockEditorAdapter("google"),
      anthropic: new MockEditorAdapter("anthropic"),
      openai: new MockEditorAdapter("openai"),
    });

    // Test 6.1: Inline Ghost Autocomplete
    const autocompleteResult = await generateInlineAutocomplete(
      userA.id,
      {
        documentId: docA.id,
        prefixText: "We propose a novel attention variant which significantly optimizes",
        selectedSourceIds: [testPaper.id],
      },
      mockRouter
    );

    assert(
      Boolean(autocompleteResult.suggestion),
      "Generates inline autocomplete suggestion",
      `Suggestion: "${autocompleteResult.suggestion}"`
    );
    assert(autocompleteResult.provider === "google", "Routes to FAST_MODEL provider (google)");

    // Test 6.2: Scholarly Rewrites (All 4 modes)
    const rewriteAcademic = await rewriteSelectedText(
      userA.id,
      {
        documentId: docA.id,
        selectedText: "Our results show good improvements.",
        mode: "academic_tone",
      },
      mockRouter
    );
    assert(
      rewriteAcademic.mode === "academic_tone" && Boolean(rewriteAcademic.replacementText),
      "Academic tone rewrite generates formal prose"
    );

    const rewriteParaphrase = await rewriteSelectedText(
      userA.id,
      {
        documentId: docA.id,
        selectedText: "Our evaluations indicate notable efficiency gains.",
        mode: "rewrite",
      },
      mockRouter
    );
    assert(
      rewriteParaphrase.mode === "rewrite" && Boolean(rewriteParaphrase.replacementText),
      "Paraphrase rewrite generates alternate phrasing"
    );

    const rewriteConcise = await rewriteSelectedText(
      userA.id,
      {
        documentId: docA.id,
        selectedText: "We performed extensive tests which showed that our method improved performance by 35%.",
        mode: "concise",
      },
      mockRouter
    );
    assert(
      rewriteConcise.mode === "concise" && Boolean(rewriteConcise.replacementText),
      "Make concise rewrite generates succinct prose"
    );

    const rewriteExpand = await rewriteSelectedText(
      userA.id,
      {
        documentId: docA.id,
        selectedText: "The benchmark shows lower latency.",
        mode: "expand",
      },
      mockRouter
    );
    assert(
      rewriteExpand.mode === "expand" && Boolean(rewriteExpand.replacementText),
      "Expand rewrite provides elaborated scholarly analysis"
    );

    // Test 6.3: Evidence Summarizer
    const evidenceSummary = await summarizeEvidenceForEditor(
      userA.id,
      {
        documentId: docA.id,
        paperId: testPaper.id,
        userPrompt: "Summarize core findings",
      },
      mockRouter
    );
    assert(
      Boolean(evidenceSummary.synthesizedText),
      "Evidence summarizer produces grounded synthesis",
      `Text: "${evidenceSummary.synthesizedText.slice(0, 80)}..."`
    );
    assert(
      Boolean(evidenceSummary.citationText),
      "Evidence summarizer provides formatted in-text citation",
      `Citation: "${evidenceSummary.citationText}"`
    );

    // --------------------------------------------------------------------------
    // TEST SECTION 7: PRIVACY GUARD ENFORCEMENT
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION 7: Privacy Guard Enforcement ---");

    // Verify privacy guard blocks cross-provider fallback on private document text
    class FailingPrivateAdapter implements ProviderAdapter {
      readonly provider: any = "google";
      isConfigured() {
        return true;
      }
      async generate(): Promise<any> {
        throw new Error("Provider primary down");
      }
      async *generateStream(): any {
        throw new Error("Stream failed");
      }
      async validateModel() {
        return true;
      }
    }

    class SecondaryLeakAdapter implements ProviderAdapter {
      readonly provider: any = "openai";
      isConfigured() {
        return true;
      }
      async generate(): Promise<any> {
        return {
          text: "leaked response",
          provider: "openai",
          model: "gpt-4o",
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          cost: { inputCostUSD: 0.0001, outputCostUSD: 0.0001, totalCostUSD: 0.0002 },
          metrics: { ttftMs: 50, durationMs: 100 },
        };
      }
      async *generateStream(): any {
        yield { textDelta: "leak" };
      }
      async validateModel() {
        return true;
      }
    }

    const privacyRouter = new ModelRouter({
      google: new FailingPrivateAdapter(),
      openai: new SecondaryLeakAdapter(),
    });

    let privacyFallbackBlocked = false;
    try {
      await generateInlineAutocomplete(
        userA.id,
        {
          documentId: docA.id,
          prefixText: "Confidential unpublished findings...",
        },
        privacyRouter
      );
    } catch (err: any) {
      // The router must fail closed rather than leaking private text to openai
      if (
        err.message?.includes("Cross-provider fallback is blocked") ||
        err.message?.includes("fail-closed") ||
        err.message?.includes("Provider primary down") ||
        err.code === "PRIVATE_CONTEXT_CROSS_PROVIDER_BLOCKED"
      ) {
        privacyFallbackBlocked = true;
      }
    }
    assert(privacyFallbackBlocked, "Privacy Guard blocks silent cross-provider leaks for private editor content");

    // --------------------------------------------------------------------------
    // TEST SECTION 8: MISSING CREDENTIALS GRACEFUL HANDLING
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION 8: Missing Credentials Handling ---");

    class EmptyAdapter implements ProviderAdapter {
      constructor(public readonly provider: any) {}
      isConfigured() {
        return false;
      }
      async generate(): Promise<any> {
        throw new Error("API key not configured");
      }
      async *generateStream(): any {
        throw new Error("API key not configured");
      }
      async validateModel() {
        return false;
      }
    }

    const emptyRouter = new ModelRouter({
      google: new EmptyAdapter("google"),
      anthropic: new EmptyAdapter("anthropic"),
      openai: new EmptyAdapter("openai"),
    });

    let missingCredentialsHandled = false;
    try {
      await generateInlineAutocomplete(
        userA.id,
        {
          documentId: docA.id,
          prefixText: "Drafting continues smoothly...",
        },
        emptyRouter
      );
    } catch (err: any) {
      if (
        err.code === "MISSING_API_KEY" ||
        err.code === "PRIVATE_CONTEXT_CROSS_PROVIDER_BLOCKED" ||
        (err.cause as any)?.code === "MISSING_API_KEY" ||
        err.message?.includes("credentials") ||
        err.message?.includes("configured")
      ) {
        missingCredentialsHandled = true;
      }
    }
    assert(missingCredentialsHandled, "Gracefully handles missing provider credentials without system crash");

    // --------------------------------------------------------------------------
    // TEST SECTION 9: CASCADING DELETION & CLEAN-UP
    // --------------------------------------------------------------------------
    console.log("\n--- SECTION 9: Cascading Deletion & Clean-up ---");

    // Delete document A
    await deleteResearchDocument(userA.id, docA.id);

    // Verify document is removed
    const listAfterDelete = await listResearchDocuments(userA.id);
    assert(
      !listAfterDelete.some((d) => d.id === docA.id),
      "Document is removed from user's document list"
    );

    // Verify citations cascaded
    const remainingCitations = await prisma.documentCitation.findMany({
      where: { documentId: docA.id },
    });
    assert(remainingCitations.length === 0, "Document citations deleted via cascade");

    // Verify linked papers cascaded
    const remainingLinkedPapers = await prisma.documentPaper.findMany({
      where: { documentId: docA.id },
    });
    assert(remainingLinkedPapers.length === 0, "Document paper links deleted via cascade");

    // Verify underlying paper is intact
    const intactPaper = await prisma.paper.findUnique({
      where: { id: testPaper.id },
    });
    assert(Boolean(intactPaper), "Underlying library research paper is preserved unharmed");
  } finally {
    // Clean up test data
    console.log("\n--- Clean-up of Test Users ---");
    if (docA?.id) {
      await prisma.researchDocument.deleteMany({ where: { id: docA.id } });
    }
    await prisma.researchDocument.deleteMany({
      where: { userId: { in: [userA.id, userB.id] } },
    });
    await prisma.paper.deleteMany({
      where: { id: { in: ["benchmark_fixture_test_paper", "private_paper_user_b"] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userA.id, userB.id] } },
    });
    console.log("Clean-up completed.");
  }

  console.log("\n==================================================================");
  console.log(`PHASE 7B TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log("==================================================================");

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runPhase7BTestSuite()
  .catch((err) => {
    console.error("Test Suite Fatal Error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
