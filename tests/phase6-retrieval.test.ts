import "./test-setup";
import { prisma } from "../src/lib/prisma";
import { generateEmbedding, generateEmbeddingsBatch, prepareChunkEmbeddingInput } from "../src/lib/ai/embeddings";
import { embedPaperChunks, getPaperEmbeddingStats } from "../src/lib/ai/embedding-pipeline";
import { searchPapersHybrid } from "../src/lib/search/hybrid-search";
import { AI_CONFIG } from "../src/lib/ai/config";

async function runTests() {
  console.log("=================================================");
  console.log("PHASE 6: RETRIEVAL & VECTOR TEST SUITE");
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
    // Test A: Embedding Contract & Dimensions
    // -------------------------------------------------------------
    console.log("\n--- Test A: Embedding Contract & Dimensions ---");
    const testVec = await generateEmbedding("Test scientific chunk embedding text");
    assert(Array.isArray(testVec), "Embedding is an array");
    assert(testVec.length === 1536, "Embedding dimensions equal contract (1536)", `Got ${testVec.length}`);
    assert(
      testVec.every((n) => typeof n === "number" && !isNaN(n)),
      "All vector components are valid finite numbers"
    );

    // -------------------------------------------------------------
    // Test B: Database Vector Storage & pgvector Functions
    // -------------------------------------------------------------
    console.log("\n--- Test B: Database Vector Storage & pgvector ---");
    const sampleChunk: any[] = await prisma.$queryRaw`
      SELECT 
        id, 
        "paperId", 
        "embeddingModel", 
        "embeddedAt", 
        (embedding IS NOT NULL) as has_embedding, 
        vector_dims(embedding) as dims 
      FROM "paper_chunks" 
      WHERE "embedding" IS NOT NULL 
      LIMIT 1;
    `;
    assert(sampleChunk.length > 0, "At least one chunk with vector exists in DB");
    assert(sampleChunk[0].has_embedding === true, "Chunk has non-null embedding");
    assert(sampleChunk[0].dims === 1536, "pgvector vector_dims returns 1536", `Got ${sampleChunk[0]?.dims}`);
    assert(sampleChunk[0].embeddingModel === AI_CONFIG.embeddingModel, "embeddingModel matches AI_CONFIG");

    // -------------------------------------------------------------
    // Test C: Idempotency
    // -------------------------------------------------------------
    console.log("\n--- Test C: Idempotency ---");
    const paper = await prisma.paper.findFirst({
      where: { chunks: { some: { embeddingModel: AI_CONFIG.embeddingModel } } },
      select: { id: true, title: true },
    });
    if (paper) {
      const rerunRes = await embedPaperChunks(paper.id);
      assert(rerunRes.success === true, "Idempotent embedding run succeeds");
      assert(rerunRes.embeddedCount === 0, "Idempotent run embeds 0 chunks (all skipped)", `Embedded ${rerunRes.embeddedCount}`);
      assert(rerunRes.skippedCount > 0, "Idempotent run skipped > 0 chunks", `Skipped ${rerunRes.skippedCount}`);
    }

    // -------------------------------------------------------------
    // Test D: Cross-Paper Correctness & Deduplication
    // -------------------------------------------------------------
    console.log("\n--- Test D: Deduplication & Cross-Paper Correctness ---");
    const dedupSearch = await searchPapersHybrid({
      query: "neural networks sequence learning transformer attention",
      limit: 10,
    });
    const paperIds = dedupSearch.papers.map((p) => p.paper.id);
    const uniquePaperIds = new Set(paperIds);
    assert(paperIds.length === uniquePaperIds.size, "Search results contain zero duplicate papers");

    // Check chunk mapping
    for (const p of dedupSearch.papers) {
      if (p.matchedSnippet) {
        const chunkCheck: any[] = await prisma.$queryRaw`
          SELECT "paperId" FROM "paper_chunks" WHERE id = ${p.matchedSnippet.chunkId};
        `;
        assert(
          chunkCheck.length > 0 && chunkCheck[0].paperId === p.paper.id,
          `Matched snippet belongs to correct paper (${p.paper.title.slice(0, 20)}...)`
        );
      }
    }

    // -------------------------------------------------------------
    // Test E: Exact Match Priority (DOI & Title)
    // -------------------------------------------------------------
    console.log("\n--- Test E: Exact Match Priority ---");
    // AlphaFold DOI exact match
    const doiSearch = await searchPapersHybrid({
      query: "10.1038/s41586-024-07487-w",
      limit: 3,
    });
    assert(doiSearch.papers.length > 0, "DOI query returns results");
    assert(
      doiSearch.papers[0]?.paper.title.includes("AlphaFold 3"),
      "Exact DOI search places target paper at Rank 1",
      doiSearch.papers[0]?.paper.title
    );
    assert(doiSearch.papers[0]?.rrfScore > 100.0, "Exact DOI match receives +100.0 boost", `Score: ${doiSearch.papers[0]?.rrfScore}`);

    // Exact Title match
    const titleSearch = await searchPapersHybrid({
      query: "Attention Is All You Need",
      limit: 3,
    });
    assert(
      titleSearch.papers[0]?.paper.title === "Attention Is All You Need",
      "Exact title search places target paper at Rank 1"
    );
    assert(titleSearch.papers[0]?.rrfScore > 10.0, "Exact title match receives +10.0 boost");

    // -------------------------------------------------------------
    // Test F: Conceptual Semantic Discovery
    // -------------------------------------------------------------
    console.log("\n--- Test F: Conceptual Semantic Discovery ---");
    const conceptSearch = await searchPapersHybrid({
      query: "multimodal radiomics decision tree diagnosis for superficial lymph node tuberculosis",
      limit: 3,
      excludeFixtures: false,
      role: "ADMIN",
    });
    assert(conceptSearch.papers.length > 0, "Conceptual search returns results");
    assert(
      conceptSearch.papers[0]?.paper.title.toLowerCase().includes("tuberculosis"),
      "Conceptual medical query surfaces tuberculosis paper at Rank 1",
      conceptSearch.papers[0]?.paper.title
    );
    assert(
      conceptSearch.papers[0]?.matchedSnippet !== undefined,
      "Top conceptual result carries an evidence chunk snippet"
    );

    // -------------------------------------------------------------
    // Test G: Keyword Fallback
    // -------------------------------------------------------------
    console.log("\n--- Test G: Keyword Fallback Resilience ---");
    const origKey = process.env.OPENAI_API_KEY;
    try {
      process.env.OPENAI_API_KEY = "sk-invalid-key-for-test-fallback";
      // Clear client to trigger failure
      const fallbackSearch = await searchPapersHybrid({
        query: "Attention",
        limit: 3,
      });
      assert(fallbackSearch.papers.length > 0, "Fallback search returns candidates");
      assert(
        fallbackSearch.papers.some((p) => p.paper.title.includes("Attention")),
        "Fallback search correctly finds paper via lexical text matching"
      );
    } finally {
      process.env.OPENAI_API_KEY = origKey;
    }

    // -------------------------------------------------------------
    // Test H: SQL Safety / Parameterization
    // -------------------------------------------------------------
    console.log("\n--- Test H: SQL Safety & Input Validation ---");
    const injectionQueries = [
      "'; DROP TABLE paper_chunks; --",
      "' OR 1=1 --",
      "\" UNION SELECT id, title, abstract FROM papers --",
      "<script>alert(1)</script>",
    ];

    const chunkCountBefore = await prisma.paperChunk.count();
    for (const q of injectionQueries) {
      const safeSearch = await searchPapersHybrid({ query: q, limit: 3 });
      assert(Array.isArray(safeSearch.papers), `SQL injection attack safely handled: ${q.slice(0, 20)}`);
    }

    // Verify paper_chunks table still intact
    const chunkCountAfter = await prisma.paperChunk.count();
    assert(chunkCountAfter === chunkCountBefore && chunkCountAfter > 0, "Database intact after injection tests", `Chunks: ${chunkCountAfter}`);

    // -------------------------------------------------------------
    // Test I: Embedding Input Preparation
    // -------------------------------------------------------------
    console.log("\n--- Test I: Embedding Input Preparation ---");
    const prepared = prepareChunkEmbeddingInput("Paper Title", "Results", "Chunk content text here.");
    assert(prepared.includes("Title: Paper Title"), "Prepared input includes title header");
    assert(prepared.includes("Section: Results"), "Prepared input includes section header");
    assert(prepared.includes("Content:\nChunk content text here."), "Prepared input includes unaltered content");

    console.log("\n=================================================");
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("=================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

runTests().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
