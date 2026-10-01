import "./load-env";
import { prisma } from "../src/lib/prisma";

async function findNewPaper() {
  const papers = await prisma.paper.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      chunks: {
        select: {
          id: true,
          chunkIndex: true,
          pageNumber: true,
          section: true,
          embeddingModel: true,
          embeddingDimensions: true,
          embeddingInputHash: true,
          embeddedAt: true,
        },
        orderBy: { chunkIndex: "asc" },
      },
      processingJobs: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  console.log(`Total papers in DB: ${papers.length}`);
  for (const p of papers) {
    console.log(`\n==================================================`);
    console.log(`ID: ${p.id}`);
    console.log(`Title: ${p.title}`);
    console.log(`DOI: ${p.doi}`);
    console.log(`arXiv: ${p.arxivId}`);
    console.log(`StoragePath: ${p.storagePath}`);
    console.log(`Status: ${p.status}`);
    console.log(`Created: ${p.createdAt.toISOString()}`);
    console.log(`Chunks count: ${p.chunks.length}`);
    if (p.chunks.length > 0) {
      const maxPage = Math.max(...p.chunks.map((c) => c.pageNumber || 0));
      const minPage = Math.min(...p.chunks.map((c) => c.pageNumber || 0));
      const sections = Array.from(new Set(p.chunks.map((c) => c.section).filter(Boolean)));
      const embeddedCount = p.chunks.filter((c) => c.embeddedAt !== null).length;
      console.log(`Page range: ${minPage} to ${maxPage}`);
      console.log(`Embedded chunks: ${embeddedCount}/${p.chunks.length}`);
      console.log(`Sections detected:`, sections);
    }
    console.log(`Processing Jobs: ${p.processingJobs.length}`);
    for (const job of p.processingJobs) {
      console.log(`  - Stage: ${job.stage}, Status: ${job.status}, Error: ${job.errorMessage || "none"}`);
    }
  }
}

findNewPaper().finally(async () => {
  await prisma.$disconnect();
});
