import { prisma } from "../src/lib/prisma";
import {
  validateAndResolveEvidence,
  FALLBACK_UNSUPPORTED_TEXT,
} from "../src/lib/ai/validator";
import { generatePaperSummary } from "../src/lib/ai/generator";
import { PaperAnalysisOutput } from "../src/lib/ai/schemas";
import { AI_CONFIG } from "../src/lib/ai/config";

async function runPhase51Tests() {
  console.log("=================================================");
  console.log("     AI RESEARCH HUB — PHASE 5.1 TEST SUITE      ");
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

  const paper1Id = "paper-target-1";
  const paper2Id = "paper-other-2";

  // Simulated chunk library containing chunks from target paper and another paper
  const mockChunks = [
    {
      id: "chunk-p1-valid-1",
      chunkIndex: 0,
      text: "The Transformer model achieves 28.4 BLEU on English-to-German translation benchmark.",
      section: "Results",
      pageNumber: 8,
      paperId: paper1Id,
    },
    {
      id: "chunk-p1-valid-2",
      chunkIndex: 1,
      text: "Training was conducted on 8 NVIDIA P100 GPUs using the Adam optimizer with beta1=0.9.",
      section: "Methods",
      pageNumber: 7,
      paperId: paper1Id,
    },
    {
      id: "chunk-p2-cross-paper",
      chunkIndex: 0,
      text: "AlphaFold 3 predicts structures with template-free atomic accuracy across the biomolecular space.",
      section: "Results",
      pageNumber: 3,
      paperId: paper2Id, // Belonging to Paper 2!
    },
  ];

  // -------------------------------------------------------------------------
  // TEST A: Fully Valid Evidence
  // -------------------------------------------------------------------------
  console.log("--- TEST A: Fully Valid Evidence ---");
  const testAAnalysis: PaperAnalysisOutput = {
    summary: "Transformer architecture based on self-attention.",
    keyFindings: [
      {
        finding: "Achieves 28.4 BLEU on English-to-German translation benchmark.",
        evidenceChunkIds: ["chunk-p1-valid-1"],
      },
    ],
    methodologySummary: {
      text: "Trained on 8 NVIDIA GPUs.",
      evidenceChunkIds: ["chunk-p1-valid-2"],
    },
    limitations: {
      text: "Quadratic memory complexity with sequence length.",
      evidenceChunkIds: ["chunk-p1-valid-1"],
    },
    conclusion: {
      text: "Self-attention can replace recurrence entirely.",
      evidenceChunkIds: ["chunk-p1-valid-1"],
    },
  };

  const resA = validateAndResolveEvidence(testAAnalysis, mockChunks, paper1Id);
  assert(
    resA.validatedKeyFindings.length === 1 &&
      resA.validatedKeyFindings[0].finding === testAAnalysis.keyFindings[0].finding &&
      resA.validatedKeyFindings[0].citations.length === 1 &&
      resA.validatedKeyFindings[0].citations[0].chunkId === "chunk-p1-valid-1",
    "Fully valid key finding preserved with resolved citation anchor"
  );
  assert(
    resA.methodologyText === testAAnalysis.methodologySummary.text,
    "Methodology with valid evidence retained verbatim"
  );

  // -------------------------------------------------------------------------
  // TEST B: Mixed Evidence (Valid ID + Fake ID)
  // -------------------------------------------------------------------------
  console.log("\n--- TEST B: Mixed Evidence (Valid + Hallucinated ID) ---");
  const testBAnalysis: PaperAnalysisOutput = {
    summary: "Transformer summary.",
    keyFindings: [
      {
        finding: "Training completed in 3.5 days using Adam.",
        evidenceChunkIds: ["chunk-p1-valid-2", "fake-hallucinated-chunk-999"],
      },
    ],
    methodologySummary: {
      text: "Setup details.",
      evidenceChunkIds: ["chunk-p1-valid-2"],
    },
    limitations: {
      text: "Memory limits.",
      evidenceChunkIds: ["chunk-p1-valid-1"],
    },
    conclusion: {
      text: "Conclusion.",
      evidenceChunkIds: ["chunk-p1-valid-1"],
    },
  };

  const resB = validateAndResolveEvidence(testBAnalysis, mockChunks, paper1Id);
  assert(
    resB.validatedKeyFindings.length === 1,
    "Finding with mixed evidence retained because it has at least 1 valid chunk"
  );
  assert(
    resB.validatedKeyFindings[0].citations.length === 1 &&
      resB.validatedKeyFindings[0].citations[0].chunkId === "chunk-p1-valid-2",
    "Fake chunk ID removed from citations; only genuine chunk retained"
  );
  assert(
    resB.stats.rejectedIds.includes("fake-hallucinated-chunk-999"),
    "Hallucinated chunk ID isolated in validation stats"
  );

  // -------------------------------------------------------------------------
  // TEST C: Fully Hallucinated Evidence (Only Fake IDs)
  // -------------------------------------------------------------------------
  console.log("\n--- TEST C: Fully Hallucinated Evidence (Only Fake IDs) ---");
  const testCAnalysis: PaperAnalysisOutput = {
    summary: "Transformer summary.",
    keyFindings: [
      {
        finding: "Fabricated claim: Reduced training loss by 95% on non-existent dataset.",
        evidenceChunkIds: ["fake-chunk-111", "fake-chunk-222"],
      },
    ],
    methodologySummary: {
      text: "Invented methodology.",
      evidenceChunkIds: ["fake-chunk-333"],
    },
    limitations: {
      text: "Invented limitations.",
      evidenceChunkIds: ["fake-chunk-444"],
    },
    conclusion: {
      text: "Invented conclusion.",
      evidenceChunkIds: ["fake-chunk-555"],
    },
  };

  const resC = validateAndResolveEvidence(testCAnalysis, mockChunks, paper1Id);
  assert(
    resC.validatedKeyFindings.length === 0,
    "Fully hallucinated finding REJECTED and omitted from persistence"
  );
  assert(
    resC.stats.rejectedFindingsCount === 1,
    "Rejected findings counter accurately tracks unsupported claims"
  );
  assert(
    resC.methodologyText === FALLBACK_UNSUPPORTED_TEXT,
    "Methodology without valid evidence replaced with safe fallback text"
  );
  assert(
    resC.limitationsText === FALLBACK_UNSUPPORTED_TEXT,
    "Limitations without valid evidence replaced with safe fallback text"
  );
  assert(
    resC.conclusionText === FALLBACK_UNSUPPORTED_TEXT,
    "Conclusion without valid evidence replaced with safe fallback text"
  );

  // -------------------------------------------------------------------------
  // TEST D: Cross-Paper Chunk Attack Protection
  // -------------------------------------------------------------------------
  console.log("\n--- TEST D: Cross-Paper Provenance Attack Protection ---");
  const testDAnalysis: PaperAnalysisOutput = {
    summary: "Transformer summary.",
    keyFindings: [
      {
        finding: "AlphaFold prediction capability falsely attributed to Transformer paper.",
        evidenceChunkIds: ["chunk-p2-cross-paper"], // REAL chunk ID, but belongs to paper2Id!
      },
    ],
    methodologySummary: {
      text: "Cross-paper methodology.",
      evidenceChunkIds: ["chunk-p2-cross-paper"],
    },
    limitations: {
      text: "Limitations.",
      evidenceChunkIds: ["chunk-p1-valid-1"],
    },
    conclusion: {
      text: "Conclusion.",
      evidenceChunkIds: ["chunk-p1-valid-1"],
    },
  };

  const resD = validateAndResolveEvidence(testDAnalysis, mockChunks, paper1Id);
  assert(
    resD.validatedKeyFindings.length === 0,
    "Cross-paper chunk reference strictly rejected (finding not persisted)"
  );
  assert(
    resD.stats.crossPaperRejectedIds.includes("chunk-p2-cross-paper"),
    "Cross-paper chunk detected and isolated in security telemetry"
  );
  assert(
    resD.methodologyText === FALLBACK_UNSUPPORTED_TEXT,
    "Methodology citing cross-paper chunk rejected and replaced with fallback"
  );

  // -------------------------------------------------------------------------
  // TEST E: Empty Evidence Rule
  // -------------------------------------------------------------------------
  console.log("\n--- TEST E: Empty Evidence Rule ---");
  const testEAnalysis: PaperAnalysisOutput = {
    summary: "Transformer summary.",
    keyFindings: [
      {
        finding: "Claim with explicitly empty evidenceChunkIds.",
        evidenceChunkIds: [],
      },
    ],
    methodologySummary: {
      text: "No citations provided.",
      evidenceChunkIds: [],
    },
    limitations: {
      text: "No citations provided.",
      evidenceChunkIds: [],
    },
    conclusion: {
      text: "No citations provided.",
      evidenceChunkIds: [],
    },
  };

  const resE = validateAndResolveEvidence(testEAnalysis, mockChunks, paper1Id);
  assert(
    resE.validatedKeyFindings.length === 0,
    "Finding with empty evidenceChunkIds rejected (never displayed as grounded)"
  );
  assert(
    resE.citations.keyFindings.length === 0,
    "Citations payload contains 0 key findings when evidence is empty"
  );

  // -------------------------------------------------------------------------
  // TEST F: Regeneration Failure Preserves Previous Valid Summary (Live DB)
  // -------------------------------------------------------------------------
  console.log("\n--- TEST F: Atomic Regeneration & Prior Summary Preservation ---");
  // Create test paper in DB with 2 chunks
  const testPaper = await prisma.paper.create({
    data: {
      title: "Phase 5.1 Regeneration Test Manuscript",
      abstract: "Testing atomic summary preservation during simulated failures.",
      status: "COMPLETED",
      chunks: {
        create: [
          {
            chunkIndex: 0,
            text: "Empirical chunk 1 verifying model accuracy at 99.2%.",
            section: "Results",
            pageNumber: 2,
          },
        ],
      },
    },
    include: { chunks: true },
  });

  // Seed baseline valid summary
  await prisma.aISummary.create({
    data: {
      paperId: testPaper.id,
      summary: "Baseline verified summary that must survive regeneration failure.",
      keyFindings: ["Baseline empirical finding 1"],
      methodologySummary: "Baseline methodology",
      limitations: "Baseline limitations",
      conclusion: "Baseline conclusion",
      modelUsed: "gpt-4o-mini",
      promptVersion: "paper-summary-v1",
      citations: { verified: true },
    },
  });

  // Trigger a regeneration failure by simulating missing API key
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "";
  const regenRes = await generatePaperSummary(testPaper.id, { forceRegenerate: true });
  process.env.OPENAI_API_KEY = originalKey;

  assert(
    regenRes.success === false,
    "Regeneration fails cleanly when API call fails"
  );

  // Verify previous valid summary in DB was NOT deleted or corrupted
  const preservedSummary = await prisma.aISummary.findUnique({
    where: { paperId: testPaper.id },
  });
  assert(
    preservedSummary !== null &&
      preservedSummary.summary === "Baseline verified summary that must survive regeneration failure.",
    "Previous valid AISummary preserved intact after regeneration failure"
  );

  // Clean up test paper
  await prisma.paper.delete({ where: { id: testPaper.id } });

  // -------------------------------------------------------------------------
  // TEST G: Existing Authorization Guard (Server Action)
  // -------------------------------------------------------------------------
  console.log("\n--- TEST G: Server Action Authorization Enforcement ---");
  const { generatePaperSummaryAction } = await import("../src/app/admin/papers/actions");
  const unauthActionRes = await generatePaperSummaryAction("some-paper-id");
  assert(
    unauthActionRes.success === false,
    "generatePaperSummaryAction denies unauthenticated / regular user calls"
  );
  assert(
    unauthActionRes.error?.includes("Unauthorized") === true,
    "Strict 'Unauthorized. Admin privileges required.' error returned"
  );

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log("\n=================================================");
  console.log(`PHASE 5.1 TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log("=================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase51Tests()
  .catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
