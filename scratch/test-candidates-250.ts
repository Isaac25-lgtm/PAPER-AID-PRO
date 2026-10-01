import "./load-env";
import { prisma } from "../src/lib/prisma";
import { generateEmbedding } from "../src/lib/ai/embeddings";

async function main() {
  const question = "What does the available evidence in this library show about the performance and clinical value of artificial intelligence or computer-aided systems for classifying breast lesions on ultrasound?";
  const vector = await generateEmbedding(question);
  const vectorStr = `[${vector.join(",")}]`;

  const rows = await prisma.$queryRaw<Array<{
    chunkId: string;
    paperId: string;
    paperTitle: string;
    similarity: number;
  }>>`
    SELECT 
      c.id AS "chunkId",
      c."paperId",
      p.title AS "paperTitle",
      1 - (c.embedding <=> ${vectorStr}::vector) AS similarity
    FROM "paper_chunks" c
    JOIN "papers" p ON c."paperId" = p.id
    WHERE c.embedding IS NOT NULL AND p.status = 'COMPLETED'
    ORDER BY c.embedding <=> ${vectorStr}::vector ASC
    LIMIT 250;
  `;

  const map = new Map<string, { title: string; sims: number[] }>();
  for (const r of rows) {
    let item = map.get(r.paperId);
    if (!item) {
      item = { title: r.paperTitle, sims: [] };
      map.set(r.paperId, item);
    }
    item.sims.push(Number(r.similarity));
  }

  const scored = [];
  for (const [paperId, item] of Array.from(map.entries())) {
    item.sims.sort((a: number, b: number) => b - a);
    const top2 = item.sims.slice(0, 2);
    const avgTop2 = top2.reduce((a: number, b: number) => a + b, 0) / top2.length;
    scored.push({ paperId, title: item.title, score: avgTop2, best: top2[0], count: item.sims.length });
  }

  scored.sort((a, b) => b.score - a.score);

  console.log(`SCORED CANDIDATE PAPERS (${scored.length}):`);
  for (let i = 0; i < scored.length; i++) {
    const s = scored[i];
    console.log(`  Rank ${i+1}: [${s.paperId}] score=${s.score.toFixed(4)} best=${s.best.toFixed(4)} chunksInPool=${s.count} title="${s.title.slice(0, 60)}"`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
