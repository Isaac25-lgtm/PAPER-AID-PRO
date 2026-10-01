import "./load-env";
import { prisma } from "../src/lib/prisma";
import { generateEmbedding } from "../src/lib/ai/embeddings";

async function main() {
  const question = "What does the available evidence in this library show about the performance and clinical value of artificial intelligence or computer-aided systems for classifying breast lesions on ultrasound?";
  const vector = await generateEmbedding(question);
  const vectorStr = `[${vector.join(",")}]`;

  const rows = await prisma.$queryRaw<Array<{
    paperId: string;
    title: string;
    max_sim: number;
    count: bigint;
  }>>`
    SELECT c."paperId", p.title, max(1 - (c.embedding <=> ${vectorStr}::vector)) as max_sim, count(*) as count
    FROM paper_chunks c
    JOIN papers p ON c."paperId" = p.id
    WHERE c.embedding IS NOT NULL
    GROUP BY c."paperId", p.title
    ORDER BY max_sim DESC;
  `;

  console.log("ALL PAPERS RANKED BY MAX CHUNK SIMILARITY:");
  for (const r of rows) {
    console.log(`[${r.paperId}] maxSim=${Number(r.max_sim).toFixed(4)} totalChunks=${Number(r.count)} "${r.title.slice(0, 60)}"`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
