import "./load-env";
import { prisma } from "../src/lib/prisma";

async function inspectCorpus() {
  const papers = await prisma.paper.findMany({
    where: { status: "COMPLETED" },
    select: {
      id: true,
      title: true,
      doi: true,
      storagePath: true,
      _count: { select: { chunks: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Total COMPLETED papers in library: ${papers.length}`);
  for (const p of papers) {
    console.log(`- [${p.id}] "${p.title}" (DOI: ${p.doi || "none"}, Chunks: ${p._count.chunks}, Stored PDF: ${p.storagePath || "none"})`);
  }
}

inspectCorpus().finally(() => prisma.$disconnect());
