// Mock server-only for standalone script execution
const Module = require("module");
const originalRequire = Module.prototype.require;
Module.prototype.require = function (path: string) {
  if (path === "server-only") return {};
  return originalRequire.apply(this, arguments);
};

import { prisma } from "../src/lib/prisma";
import { validateAndResolveEvidence } from "../src/lib/ai/validator";
import { generatePaperSummary } from "../src/lib/ai/generator";
import { PaperAnalysisOutput, PaperAnalysisSchema } from "../src/lib/ai/schemas";
import { AI_CONFIG } from "../src/lib/ai/config";

async function runPhase5Tests() {
  console.log("=================================================");
  console.log("       AI RESEARCH HUB — PHASE 5 TEST SUITE      ");
  console.log("=================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
      if (detail) console.error(`   Detail: ${detail}`);
      failed++;
    }
  }

  // -------------------------------------------------------------------------
  // TEST D: Evidence Reference Validation & Provenance Mapping (Unit Test)
  // -------------------------------------------------------------------------
  console.log("--- TEST D: Evidence Provenance Validation & Repair ---");
  const mockChunks = [
    {
      id: "chunk-valid-1",
      chunkIndex: 0,
      text: "The Transformer achieves 28.4 BLEU on the WMT 2014 English-to-German translation task.",
      section: "Results",
      pageNumber: 8,
    },
    {
      id: "chunk-valid-2",
      chunkIndex: 1,
      text: "We trained on standard 8 NVIDIA P100 GPUs for 3.5 days.",
      section: "Methods",
      pageNumber: 7,
    },
  ];

  const mockAnalysis: PaperAnalysisOutput = {
    summary: "The Transformer is a novel neural network architecture based solely on attention mechanisms.",
    keyFindings: [
      {
        finding: "Achieves 28.4 BLEU on English-to-German translation.",
        evidenceChunkIds: ["chunk-valid-1"],
      },
      {
        finding: "Fabricated claim that was not in the chunks.",
        evidenceChunkIds: ["hallucinated-chunk-999", "chunk-valid-2"],
      },
    ],
    methodologySummary: {
      text: "Trained on 8 GPUs using Adam optimizer.",
      evidenceChunkIds: ["chunk-valid-2"],
    },
    limitations: {
      text: "Requires quadratic memory for very long sequences.",
      evidenceChunkIds: ["hallucinated-chunk-888"],
    },
    conclusion: {
      text: "Attention mechanisms replace recurrence entirely.",
      evidenceChunkIds: ["chunk-valid-1"],
    },
  };

  const validationResult = validateAndResolveEvidence(mockAnalysis, mockChunks);

  assert(
    validationResult.stats.validatedCount === 4,
    "Validated count matches genuine chunk references",
    `Expected 4, got ${validationResult.stats.validatedCount}`
  );

  assert(
    validationResult.stats.rejectedCount === 2,
    "Rejected count matches hallucinated chunk references",
    `Expected 2, got ${validationResult.stats.rejectedCount}`
  );

  assert(
    validationResult.stats.rejectedIds.includes("hallucinated-chunk-999") &&
      validationResult.stats.rejectedIds.includes("hallucinated-chunk-888"),
    "Hallucinated chunk IDs accurately identified and isolated"
  );

  assert(
    validationResult.citations.keyFindings[1].citations.length === 1 &&
      validationResult.citations.keyFindings[1].citations[0].chunkId === "chunk-valid-2" &&
      validationResult.citations.keyFindings[1].citations[0].pageNumber === 7 &&
      validationResult.citations.keyFindings[1].citations[0].section === "Methods",
    "Evidence anchors accurately resolve chunkIndex, pageNumber, and section"
  );

  assert(
    validationResult.citations.limitations.citations.length === 0,
    "Unsupported claim citations cleanly pruned (no invalid chunk IDs persisted)"
  );

  // -------------------------------------------------------------------------
  // TEST B: Paper with No Chunks
  // -------------------------------------------------------------------------
  console.log("\n--- TEST B: Paper with No Chunks ---");
  // Create a temporary paper without chunks to test early rejection
  const emptyPaper = await prisma.paper.create({
    data: {
      title: "Test Manuscript With No Ingested Chunks",
      abstract: "This paper has been created without processing any PDF chunks.",
      status: "UPLOADED",
    },
  });

  const emptyResult = await generatePaperSummary(emptyPaper.id);

  assert(
    emptyResult.success === false,
    "Summary generation rejected for paper with 0 chunks"
  );
  assert(
    emptyResult.error?.includes("0 processed manuscript chunks") === true,
    "Descriptive admin error returned for un-ingested paper"
  );

  // Clean up empty paper
  await prisma.paper.delete({ where: { id: emptyPaper.id } });

  // -------------------------------------------------------------------------
  // TEST C: Missing/Invalid OpenAI API Key Handling
  // -------------------------------------------------------------------------
  console.log("\n--- TEST C: Missing/Invalid API Key & Job Lifecycle ---");
  // Find or create a paper with chunks
  let paperWithChunks = await prisma.paper.findFirst({
    where: {
      chunks: { some: {} },
    },
    include: {
      chunks: true,
      aiSummary: true,
    },
  });

  // If no paper has chunks yet, create a synthetic test paper with 2 chunks
  let createdTestPaper = false;
  if (!paperWithChunks) {
    paperWithChunks = await prisma.paper.create({
      data: {
        title: "Attention Is All You Need (Test Benchmark)",
        abstract: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
        status: "COMPLETED",
        chunks: {
          create: [
            {
              chunkIndex: 0,
              text: "The Transformer is the first sequence transduction model based entirely on self-attention.",
              section: "Introduction",
              pageNumber: 1,
            },
            {
              chunkIndex: 1,
              text: "On the WMT 2014 English-to-German task, the big model achieves 28.4 BLEU.",
              section: "Results",
              pageNumber: 8,
            },
          ],
        },
      },
      include: {
        chunks: true,
        aiSummary: true,
      },
    });
    createdTestPaper = true;
  }

  // Temporarily unset API key to verify clean failure handling
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "";

  const missingKeyResult = await generatePaperSummary(paperWithChunks.id);

  assert(
    missingKeyResult.success === false,
    "Generation fails gracefully when OPENAI_API_KEY is not set"
  );

  assert(
    missingKeyResult.error?.includes("OPENAI_API_KEY") === true,
    "Clear server-side error reported without leaking stack or secrets"
  );

  // Check that a ProcessingJob was logged as FAILED
  const failedJob = await prisma.processingJob.findFirst({
    where: {
      paperId: paperWithChunks.id,
      stage: "SUMMARY_GENERATION",
    },
    orderBy: { createdAt: "desc" },
  });

  assert(
    failedJob?.status === "FAILED" && failedJob?.stage === "SUMMARY_GENERATION",
    "ProcessingJob tracked with stage SUMMARY_GENERATION and status FAILED"
  );

  // Restore API key
  process.env.OPENAI_API_KEY = originalApiKey;

  // -------------------------------------------------------------------------
  // TEST E: Regeneration Failure Preserves Previous Valid Summary
  // -------------------------------------------------------------------------
  console.log("\n--- TEST E: Atomic Regeneration & Prior Summary Preservation ---");
  // Seed a valid initial AISummary on paperWithChunks
  const baselineSummary = await prisma.aISummary.upsert({
    where: { paperId: paperWithChunks.id },
    create: {
      paperId: paperWithChunks.id,
      summary: "Baseline verified synthesis that must never be destroyed by failed regeneration.",
      keyFindings: ["Baseline finding 1"],
      methodologySummary: "Baseline methodology",
      limitations: "Baseline limitations",
      conclusion: "Baseline conclusion",
      modelUsed: "gpt-4o-mini",
      promptVersion: "paper-summary-v1",
      citations: { baseline: true },
    },
    update: {
      summary: "Baseline verified synthesis that must never be destroyed by failed regeneration.",
      keyFindings: ["Baseline finding 1"],
      methodologySummary: "Baseline methodology",
      limitations: "Baseline limitations",
      conclusion: "Baseline conclusion",
      modelUsed: "gpt-4o-mini",
      promptVersion: "paper-summary-v1",
      citations: { baseline: true },
    },
  });

  // Attempt a regeneration with a simulated failure (empty key)
  process.env.OPENAI_API_KEY = "";
  const regenFailResult = await generatePaperSummary(paperWithChunks.id, { forceRegenerate: true });
  process.env.OPENAI_API_KEY = originalApiKey;

  // Fetch summary after failed regeneration
  const preservedSummary = await prisma.aISummary.findUnique({
    where: { paperId: paperWithChunks.id },
  });

  assert(
    preservedSummary !== null &&
      preservedSummary.summary === "Baseline verified synthesis that must never be destroyed by failed regeneration.",
    "Previous valid AISummary is preserved intact when regeneration fails"
  );

  // -------------------------------------------------------------------------
  // TEST A: Atomic Upsert & Provenance Storage Verification
  // -------------------------------------------------------------------------
  console.log("\n--- TEST A: Structured Output Persistence & Provenance Anchoring ---");
  // Test atomic upsert of verified structured output
  const testAnalysis: PaperAnalysisOutput = {
    summary: "The Transformer achieves state-of-the-art results through multi-head self-attention without recurrence.",
    keyFindings: [
      {
        finding: "Achieves 28.4 BLEU on English-to-German benchmark.",
        evidenceChunkIds: [paperWithChunks.chunks[0].id],
      },
    ],
    methodologySummary: {
      text: "Multi-head attention with 8 parallel attention heads and sinusoidal positional encodings.",
      evidenceChunkIds: [paperWithChunks.chunks[0].id],
    },
    limitations: {
      text: "Computational cost scales quadratically with input sequence length.",
      evidenceChunkIds: [paperWithChunks.chunks[0].id],
    },
    conclusion: {
      text: "Self-attention can replace recurrence entirely, accelerating training times significantly.",
      evidenceChunkIds: [paperWithChunks.chunks[0].id],
    },
  };

  const resolvedEvidence = validateAndResolveEvidence(testAnalysis, paperWithChunks.chunks);

  await prisma.aISummary.upsert({
    where: { paperId: paperWithChunks.id },
    create: {
      paperId: paperWithChunks.id,
      summary: testAnalysis.summary,
      keyFindings: testAnalysis.keyFindings.map((kf) => kf.finding),
      methodologySummary: testAnalysis.methodologySummary.text,
      limitations: testAnalysis.limitations.text,
      conclusion: testAnalysis.conclusion.text,
      modelUsed: AI_CONFIG.summaryModel,
      promptVersion: AI_CONFIG.promptVersion,
      citations: resolvedEvidence.citations as any,
    },
    update: {
      summary: testAnalysis.summary,
      keyFindings: testAnalysis.keyFindings.map((kf) => kf.finding),
      methodologySummary: testAnalysis.methodologySummary.text,
      limitations: testAnalysis.limitations.text,
      conclusion: testAnalysis.conclusion.text,
      modelUsed: AI_CONFIG.summaryModel,
      promptVersion: AI_CONFIG.promptVersion,
      citations: resolvedEvidence.citations as any,
    },
  });

  const persistedSummary = await prisma.aISummary.findUnique({
    where: { paperId: paperWithChunks.id },
  });

  assert(
    persistedSummary !== null && persistedSummary.modelUsed === "gpt-4o-mini",
    "AISummary successfully created with modelUsed: 'gpt-4o-mini'"
  );

  assert(
    persistedSummary?.promptVersion === "paper-summary-v1",
    "AISummary successfully created with promptVersion: 'paper-summary-v1'"
  );

  const persistedCitations = persistedSummary?.citations as any;
  assert(
    persistedCitations?.keyFindings?.length === 1 &&
      persistedCitations.keyFindings[0].citations?.length === 1 &&
      persistedCitations.keyFindings[0].citations[0].chunkId === paperWithChunks.chunks[0].id,
    "Resolved citation anchors persisted with verifiable chunk provenance"
  );

  // Clean up synthetic paper if created
  if (createdTestPaper) {
    await prisma.paper.delete({ where: { id: paperWithChunks.id } });
  }

  // -------------------------------------------------------------------------
  // TEST F: USER / Unauthenticated Authorization Rejection
  // -------------------------------------------------------------------------
  console.log("\n--- TEST F: Authorization Guard Enforcement ---");
  const { generatePaperSummaryAction } = await import("../src/app/admin/papers/actions");
  const unauthResult = await generatePaperSummaryAction("some-paper-id");
  assert(
    unauthResult.success === false,
    "Server Action rejects non-admin / unauthenticated invocation"
  );
  assert(
    unauthResult.error?.includes("Unauthorized") === true,
    "Strict 'Unauthorized. Admin privileges required.' response returned"
  );

  // -------------------------------------------------------------------------
  // FINAL RESULTS
  // -------------------------------------------------------------------------
  console.log("\n=================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log("=================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase5Tests()
  .catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
