import "./load-env";
import { prisma } from "../src/lib/prisma";
import { embedPaperChunks } from "../src/lib/ai/embedding-pipeline";

const TARGET_PAPERS = [
  "cmunxw9il00dnvrus7w9mqij9",
  "cmunxiwf900blvruskrclq381",
  "cmunx4c1b009pvrusz5785bw3",
  "cmunwvfkr006uvrus0m3ky4wn",
  "cmunwm6m2004ivrusrlr89j95",
  "cmunwc3ev001xvrusq53yvo9b",
  "cmunotrr10000vrusnqyv61ut"
];

async function main() {
  console.log(`Starting embedding generation for ${TARGET_PAPERS.length} papers...`);

  for (const paperId of TARGET_PAPERS) {
    const paper = await prisma.paper.findUnique({
      where: { id: paperId },
      select: { id: true, title: true, _count: { select: { chunks: true } } }
    });

    if (!paper) {
      console.error(`Paper ${paperId} not found!`);
      continue;
    }

    console.log(`\nEmbedding paper [${paper.id}] "${paper.title}" (${paper._count.chunks} chunks)...`);
    const start = Date.now();
    try {
      const res = await embedPaperChunks(paper.id);
      console.log(`  Done in ${((Date.now() - start) / 1000).toFixed(1)}s: embedded=${res.embeddedCount}, skipped=${res.skippedCount}`);
    } catch (err: any) {
      console.error(`  Failed to embed paper ${paper.id}:`, err.message);
    }
  }

  console.log("\nFinished embedding pipeline run for all target papers.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
