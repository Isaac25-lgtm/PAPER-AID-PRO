import "../scratch/load-env";
import { prisma } from "../src/lib/prisma";
import {
  prepareChunkEmbeddingInput,
  computeEmbeddingInputHash,
} from "../src/lib/ai/embeddings";
import {
  isChunkEmbeddingCurrent,
  embedPaperChunks,
  getPaperEmbeddingStats,
} from "../src/lib/ai/embedding-pipeline";
import { AI_CONFIG } from "../src/lib/ai/config";

async function runInvalidationTests() {
  console.log("=================================================");
  console.log("PHASE 6.1: EMBEDDING INVALIDATION & STALENESS TESTS");
  console.log("=================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}${detail ? ` - ${detail}` : ""}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Baseline fixtures for deterministic testing
    // -------------------------------------------------------------
    const baseTitle = "Attention Is All You Need";
    const baseSection = "Architecture";
    const baseText = "The Transformer is the first transduction model relying entirely on self-attention.";
    const baseModel = AI_CONFIG.embeddingModel; // "text-embedding-3-small"
    const baseDimensions = AI_CONFIG.embeddingDimensions; // 1536

    const baseInput = prepareChunkEmbeddingInput(baseTitle, baseSection, baseText);
    const baseHash = computeEmbeddingInputHash(baseInput);

    // -------------------------------------------------------------
    // Test A: SAME INPUT (Idempotency - No Staleness)
    // -------------------------------------------------------------
    console.log("\n--- Test A: Same Input (Idempotent Skip) ---");
    const testA = isChunkEmbeddingCurrent({
      hasVector: true,
      embeddingModel: baseModel,
      embeddingDimensions: baseDimensions,
      embeddingInputHash: baseHash,
      currentTitle: baseTitle,
      currentSection: baseSection,
      currentText: baseText,
    });
    assert(testA.isCurrent === true, "Chunk is recognized as up-to-date");
    assert(testA.reason === undefined, "No staleness reason provided for valid chunk");
    assert(testA.expectedHash === baseHash, "Calculated input hash matches stored hash");

    // -------------------------------------------------------------
    // Test B: CHUNK TEXT CHANGES (Content Staleness)
    // -------------------------------------------------------------
    console.log("\n--- Test B: Chunk Text Changes ---");
    const modifiedText = baseText + " We introduce multi-head attention mechanisms.";
    const modifiedInputB = prepareChunkEmbeddingInput(baseTitle, baseSection, modifiedText);
    const modifiedHashB = computeEmbeddingInputHash(modifiedInputB);

    assert(modifiedHashB !== baseHash, "Input hash changes when chunk text changes");

    const testB = isChunkEmbeddingCurrent({
      hasVector: true,
      embeddingModel: baseModel,
      embeddingDimensions: baseDimensions,
      embeddingInputHash: baseHash, // Stored hash is old
      currentTitle: baseTitle,
      currentSection: baseSection,
      currentText: modifiedText, // New text
    });
    assert(testB.isCurrent === false, "Modified chunk text detected as stale");
    assert(testB.reason === "hash_mismatch", "Staleness reason is hash_mismatch");
    assert(testB.expectedHash === modifiedHashB, "Expected hash reflects the modified text");

    // -------------------------------------------------------------
    // Test C: SECTION CHANGES (Contextual Section Staleness)
    // -------------------------------------------------------------
    console.log("\n--- Test C: Section Changes ---");
    const modifiedSection = "Model Architecture & Attention";
    const modifiedInputC = prepareChunkEmbeddingInput(baseTitle, modifiedSection, baseText);
    const modifiedHashC = computeEmbeddingInputHash(modifiedInputC);

    assert(modifiedHashC !== baseHash, "Input hash changes when section header changes");

    const testC = isChunkEmbeddingCurrent({
      hasVector: true,
      embeddingModel: baseModel,
      embeddingDimensions: baseDimensions,
      embeddingInputHash: baseHash, // Stored hash is old
      currentTitle: baseTitle,
      currentSection: modifiedSection, // New section
      currentText: baseText,
    });
    assert(testC.isCurrent === false, "Modified section detected as stale");
    assert(testC.reason === "hash_mismatch", "Staleness reason is hash_mismatch");
    assert(testC.expectedHash === modifiedHashC, "Expected hash reflects the modified section");

    // -------------------------------------------------------------
    // Test D: PAPER TITLE CHANGES (Contextual Title Staleness)
    // -------------------------------------------------------------
    console.log("\n--- Test D: Paper Title Changes ---");
    const modifiedTitle = "Attention Is All You Need (Revised Pre-Print)";
    const modifiedInputD = prepareChunkEmbeddingInput(modifiedTitle, baseSection, baseText);
    const modifiedHashD = computeEmbeddingInputHash(modifiedInputD);

    assert(modifiedHashD !== baseHash, "Input hash changes when manuscript title changes");

    const testD = isChunkEmbeddingCurrent({
      hasVector: true,
      embeddingModel: baseModel,
      embeddingDimensions: baseDimensions,
      embeddingInputHash: baseHash, // Stored hash is old
      currentTitle: modifiedTitle, // New title
      currentSection: baseSection,
      currentText: baseText,
    });
    assert(testD.isCurrent === false, "Modified paper title detected as stale");
    assert(testD.reason === "hash_mismatch", "Staleness reason is hash_mismatch");
    assert(testD.expectedHash === modifiedHashD, "Expected hash reflects the modified title");

    // -------------------------------------------------------------
    // Test E: MODEL CHANGES (Model Invalidation)
    // -------------------------------------------------------------
    console.log("\n--- Test E: Model Changes ---");
    const testE = isChunkEmbeddingCurrent({
      hasVector: true,
      embeddingModel: "text-embedding-ada-002", // Legacy model in DB
      embeddingDimensions: baseDimensions,
      embeddingInputHash: baseHash,
      currentTitle: baseTitle,
      currentSection: baseSection,
      currentText: baseText,
      configuredModel: baseModel, // Current model text-embedding-3-small
    });
    assert(testE.isCurrent === false, "Mismatched embedding model detected as stale");
    assert(testE.reason === "model_mismatch", "Staleness reason is model_mismatch");

    // -------------------------------------------------------------
    // Test F: DIMENSION CONTRACT CHANGES (Dimension Invalidation)
    // -------------------------------------------------------------
    console.log("\n--- Test F: Dimension Contract Changes ---");
    const testF1 = isChunkEmbeddingCurrent({
      hasVector: true,
      embeddingModel: baseModel,
      embeddingDimensions: 768, // Mismatched dimension in DB
      embeddingInputHash: baseHash,
      currentTitle: baseTitle,
      currentSection: baseSection,
      currentText: baseText,
      configuredDimensions: baseDimensions, // 1536
    });
    assert(testF1.isCurrent === false, "Mismatched embedding dimension detected as stale");
    assert(testF1.reason === "dimensions_mismatch", "Staleness reason is dimensions_mismatch");

    const testF2 = isChunkEmbeddingCurrent({
      hasVector: true,
      embeddingModel: baseModel,
      embeddingDimensions: null, // Missing dimension metadata
      embeddingInputHash: baseHash,
      currentTitle: baseTitle,
      currentSection: baseSection,
      currentText: baseText,
      configuredDimensions: baseDimensions,
    });
    assert(testF2.isCurrent === false, "Null embedding dimension detected as stale");
    assert(testF2.reason === "dimensions_mismatch", "Staleness reason is dimensions_mismatch for null dimensions");

    // Missing vector check
    const testF3 = isChunkEmbeddingCurrent({
      hasVector: false,
      embeddingModel: baseModel,
      embeddingDimensions: baseDimensions,
      embeddingInputHash: baseHash,
      currentTitle: baseTitle,
      currentSection: baseSection,
      currentText: baseText,
    });
    assert(testF3.isCurrent === false, "Missing vector detected as not current");
    assert(testF3.reason === "missing_vector", "Staleness reason is missing_vector");

    // -------------------------------------------------------------
    // Test G: Database Integration & Idempotent Pipeline Skip
    // -------------------------------------------------------------
    console.log("\n--- Test G: Database Integration & Idempotent Skip ---");
    const samplePaper = await prisma.paper.findFirst({
      where: {
        chunks: { some: {} },
      },
      select: { id: true, title: true, chunks: { select: { id: true } } },
    });

    if (samplePaper) {
      const stats = await getPaperEmbeddingStats(samplePaper.id);
      assert(stats.totalChunks > 0, "Paper has text chunks in database");
      assert(stats.outdatedChunks === 0, `All chunks are current with input hash & model (outdated: ${stats.outdatedChunks})`);
      assert(stats.status === "EMBEDDED", "Paper embedding status is EMBEDDED");
      assert(stats.isCurrentModel === true, "isCurrentModel is true");
      assert(stats.embeddingDimensions === 1536, "Stored embedding dimension metadata equals 1536");

      // Running embedPaperChunks without force should skip 100% of chunks
      const embedResult = await embedPaperChunks(samplePaper.id, { force: false });
      assert(embedResult.success === true, "embedPaperChunks succeeded");
      assert(embedResult.embeddedCount === 0, "Zero chunks re-embedded (idempotent skip)", `Embedded: ${embedResult.embeddedCount}`);
      assert(embedResult.skippedCount === samplePaper.chunks.length, "All chunks skipped because input hashes match");
    }

    console.log("\n=================================================");
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("=================================================\n");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error: any) {
    console.error("Test execution fatal error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runInvalidationTests();
