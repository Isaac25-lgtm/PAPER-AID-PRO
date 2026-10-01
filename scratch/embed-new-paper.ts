import "./load-env";
import { prisma } from "../src/lib/prisma";
import { embedPaperChunks } from "../src/lib/ai/embedding-pipeline";

async function runEmbeddingsForNewPaper() {
  const paperId = "cmumgtiix0000vr445cn8ry7o";
  console.log(`=== RUNNING EMBEDDINGS FOR PAPER ${paperId} ===`);

  let result;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Attempt ${attempt} calling embedPaperChunks...`);
      result = await embedPaperChunks(paperId);
      break;
    } catch (e: any) {
      console.warn(`Attempt ${attempt} failed: ${e.message}. Retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.log("Embed result:", result);

  // Now audit the chunks in the database
  const chunks = await prisma.paperChunk.findMany({
    where: { paperId },
    select: {
      id: true,
      chunkIndex: true,
      section: true,
      pageNumber: true,
      embeddingModel: true,
      embeddingDimensions: true,
      embeddingInputHash: true,
      embeddedAt: true,
    },
    orderBy: { chunkIndex: "asc" },
  });

  const total = chunks.length;
  const embedded = chunks.filter((c) => c.embeddedAt !== null).length;
  const validModel = chunks.filter((c) => c.embeddingModel === "text-embedding-3-small").length;
  const validDims = chunks.filter((c) => c.embeddingDimensions === 1536).length;
  const validHash = chunks.filter((c) => c.embeddingInputHash && c.embeddingInputHash.length === 64).length;

  console.log(`\nAudit Results:`);
  console.log(`Total chunks: ${total}`);
  console.log(`Embedded chunks: ${embedded}/${total}`);
  console.log(`Model = text-embedding-3-small: ${validModel}/${total}`);
  console.log(`Dimensions = 1536: ${validDims}/${total}`);
  console.log(`Input hash present (64 chars SHA-256): ${validHash}/${total}`);

  // Test idempotency: running again should embed 0 and skip all 87
  console.log("\nTesting Idempotency Skip...");
  const secondResult = await embedPaperChunks(paperId);
  console.log("Second embed result (should skip all):", secondResult);
}

runEmbeddingsForNewPaper().finally(async () => {
  await prisma.$disconnect();
});
