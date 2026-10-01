import "./load-env";
import { prisma } from "../src/lib/prisma";
import { prepareChunkEmbeddingInput, computeEmbeddingInputHash } from "../src/lib/ai/embeddings";
import { AI_CONFIG } from "../src/lib/ai/config";

async function backfill() {
  console.log("Backfilling existing embedded chunks with input hashes and dimensions...");

  const papers = await prisma.paper.findMany({
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" },
      },
    },
  });

  let updated = 0;
  for (const paper of papers) {
    for (const chunk of paper.chunks) {
      const prepared = prepareChunkEmbeddingInput(paper.title, chunk.section, chunk.text);
      const hash = computeEmbeddingInputHash(prepared);

      await prisma.$executeRaw`
        UPDATE "paper_chunks"
        SET 
          "embeddingDimensions" = ${AI_CONFIG.embeddingDimensions},
          "embeddingInputHash" = ${hash}
        WHERE "id" = ${chunk.id};
      `;
      updated++;
    }
  }

  console.log(`Successfully backfilled ${updated} chunks.`);
  await prisma.$disconnect();
}

backfill();
