import "./load-env";
import { prisma } from "../src/lib/prisma";

async function main() {
  const papers = await prisma.paper.findMany({
    where: {
      storagePath: { not: null }
    },
    include: {
      chunks: true,
      processingJobs: true
    }
  });

  console.log(`Uploaded papers in DB: ${papers.length}`);
  for (const p of papers) {
    console.log(`\nPaper: ${p.title} (ID: ${p.id})`);
    console.log(`  Storage path: ${p.storagePath}`);
    console.log(`  PDF URL: ${p.pdfUrl}`);
    console.log(`  Chunks: ${p.chunks.length}`);
    for (const c of p.chunks) {
      console.log(`    Chunk: id=${c.id}, page=${c.pageNumber}, section=${c.section}, textLen=${c.text.length}`);
    }
    console.log(`  Processing Jobs: ${p.processingJobs.length}`);
    for (const j of p.processingJobs) {
      console.log(`    Job: stage=${j.stage}, status=${j.status}, error=${j.errorMessage}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
