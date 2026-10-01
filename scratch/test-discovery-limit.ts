import "./load-env";
import { prisma } from "../src/lib/prisma";
import { generateEmbedding } from "../src/lib/ai/embeddings";

async function main() {
  const question = "What does the available evidence in this library show about the performance and clinical value of artificial intelligence or computer-aided systems for classifying breast lesions on ultrasound?";
  const vector = await generateEmbedding(question);
  const vectorStr = `[${vector.join(",")}]`;

  for (const lim of [80, 250, 300]) {
    const rows = await prisma.$queryRaw<Array<{ paperId: string }>>`
      SELECT c."paperId"
      FROM paper_chunks c
      JOIN papers p ON c."paperId" = p.id
      WHERE c.embedding IS NOT NULL AND p.status = 'COMPLETED'
      ORDER BY c.embedding <=> ${vectorStr}::vector ASC
      LIMIT ${lim};
    `;
    const uniquePapers = new Set(rows.map(r => r.paperId));
    console.log(`With LIMIT ${lim}: found ${uniquePapers.size} unique papers in raw chunk results.`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
