import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("=== DATABASE AUDIT ===");
  const papers = await prisma.paper.findMany({
    include: {
      authors: { include: { author: true } },
      categories: { include: { category: true } },
      chunks: { select: { id: true, chunkIndex: true, pageNumber: true, section: true } },
      aiSummary: true,
      processingJobs: { orderBy: { createdAt: "desc" } },
      bookmarks: true,
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Total papers: ${papers.length}`);
  for (const p of papers) {
    console.log(`\n--- Paper: ${p.title} (ID: ${p.id}) ---`);
    console.log(`Status: ${p.status}`);
    console.log(`storagePath: ${p.storagePath || "(null)"}`);
    console.log(`pdfUrl: ${p.pdfUrl || "(null)"}`);
    console.log(`Chunks count: ${p.chunks.length}`);
    console.log(`AISummary exists: ${!!p.aiSummary}`);
    if (p.aiSummary) {
      console.log(`  Model: ${p.aiSummary.modelUsed}, PromptVer: ${p.aiSummary.promptVersion}`);
      console.log(`  KeyFindings: ${(p.aiSummary.keyFindings as any[])?.length || 0}`);
    }
    console.log(`Processing Jobs (${p.processingJobs.length}):`);
    for (const j of p.processingJobs.slice(0, 3)) {
      console.log(`  - Stage: ${j.stage}, Status: ${j.status}, Attempt: ${j.attempt}, Error: ${j.errorMessage || "none"}`);
    }
    console.log(`Bookmarks count: ${p.bookmarks.length}`);
  }

  const allBookmarks = await prisma.bookmark.findMany({
    include: { user: { select: { id: true, email: true } }, paper: { select: { id: true, title: true } } },
  });
  console.log(`\nTotal Bookmarks across DB: ${allBookmarks.length}`);
  for (const b of allBookmarks) {
    console.log(`  User: ${b.user.email} -> Paper: ${b.paper.title}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
