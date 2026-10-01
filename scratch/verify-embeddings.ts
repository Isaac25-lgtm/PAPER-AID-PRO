import "./load-env";
import { prisma } from "../src/lib/prisma";
import { embedPaperChunks } from "../src/lib/ai/embedding-pipeline";

async function verifyAll87Embedded() {
  const paperId = "cmumgtiix0000vr445cn8ry7o";
  const chunks = await prisma.paperChunk.findMany({
    where: { paperId },
    select: {
      id: true,
      chunkIndex: true,
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

  console.log(`=== CHUNK EMBEDDING AUDIT ===`);
  console.log(`Total chunks: ${total}`);
  console.log(`Embedded chunks: ${embedded}/${total}`);
  console.log(`Model matches text-embedding-3-small: ${validModel}/${total}`);
  console.log(`Dimensions match 1536: ${validDims}/${total}`);
  console.log(`Valid SHA-256 input hash: ${validHash}/${total}`);

  // Test true idempotency now that all 87 are embedded:
  const thirdRun = await embedPaperChunks(paperId);
  console.log("Third embed run (idempotent check):", thirdRun);
}

verifyAll87Embedded().finally(async () => {
  await prisma.$disconnect();
});
