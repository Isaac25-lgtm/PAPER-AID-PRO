import * as fs from "fs";
import * as path from "path";

// Load .env
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

import { prisma } from "../src/lib/prisma";
import { embedPaperChunks, getPaperEmbeddingStats } from "../src/lib/ai/embedding-pipeline";
import { generateEmbedding } from "../src/lib/ai/embeddings";

async function main() {
  console.log("=== Testing Embedding Pipeline ===");

  // Find a paper with chunks
  const paper = await prisma.paper.findFirst({
    where: {
      chunks: { some: {} },
    },
    include: { chunks: true },
  });

  if (!paper) {
    throw new Error("No paper with chunks found.");
  }

  console.log(`Selected paper: "${paper.title}" (${paper.id}) with ${paper.chunks.length} chunks.`);

  // 1. Initial stats
  const initialStats = await getPaperEmbeddingStats(paper.id);
  console.log("Initial stats:", initialStats);

  // 2. Embed paper chunks
  console.log("\nGenerating embeddings for paper...");
  const embedResult = await embedPaperChunks(paper.id);
  console.log("Embedding result:", embedResult);

  if (!embedResult.success) {
    throw new Error(`Embedding failed: ${embedResult.error}`);
  }

  // 3. Verify in database with vector_dims
  const dbChunks: any[] = await prisma.$queryRaw`
    SELECT 
      id, 
      "chunkIndex", 
      "embeddingModel", 
      "embeddedAt", 
      (embedding IS NOT NULL) as has_embedding, 
      vector_dims(embedding) as dims 
    FROM "paper_chunks" 
    WHERE "paperId" = ${paper.id}
    ORDER BY "chunkIndex" ASC;
  `;
  console.log("\nDatabase verification of embeddings:");
  console.table(dbChunks);

  // 4. Test Idempotency: run again without force
  console.log("\nTesting idempotency (rerun without force)...");
  const rerunResult = await embedPaperChunks(paper.id);
  console.log("Rerun result:", rerunResult);
  if (rerunResult.embeddedCount !== 0) {
    throw new Error(`Idempotency failed: expected 0 embedded, got ${rerunResult.embeddedCount}`);
  }
  console.log("Idempotency verified: 0 chunks re-embedded, all skipped.");

  // 5. Test vector similarity query with a query vector
  console.log("\nTesting cosine similarity query with a real query vector...");
  const queryVector = await generateEmbedding("quantum computing surface codes and fault tolerance");
  const queryVectorString = `[${queryVector.join(",")}]`;

  const searchResults: any[] = await prisma.$queryRaw`
    SELECT 
      c.id, 
      c."paperId", 
      c."chunkIndex", 
      c.section, 
      c."pageNumber",
      SUBSTRING(c.text, 1, 100) as snippet,
      1 - (c.embedding <=> ${queryVectorString}::vector) as similarity
    FROM "paper_chunks" c
    WHERE c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${queryVectorString}::vector ASC
    LIMIT 3;
  `;

  console.log("\nCosine search results:");
  console.table(searchResults);

  await prisma.$disconnect();
  console.log("\n=== Embedding Pipeline Test Succeeded ===");
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
