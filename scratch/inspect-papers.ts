import "./load-env";
import { prisma } from "../src/lib/prisma";

async function main() {
  const papers = await prisma.paper.findMany({
    select: {
      id: true,
      title: true,
      journal: true,
      storagePath: true,
      pdfUrl: true,
      _count: {
        select: { chunks: true }
      }
    }
  });

  console.log("Found " + papers.length + " papers:");
  for (const p of papers) {
    const embedded: any[] = await prisma.$queryRaw`
      SELECT COUNT(*)::int as count 
      FROM paper_chunks 
      WHERE "paperId" = ${p.id} AND embedding IS NOT NULL
    `;
    console.log(`Paper ID: ${p.id}`);
    console.log(`  Title: ${p.title}`);
    console.log(`  Chunks: ${p._count.chunks}, Embedded: ${embedded[0]?.count ?? 0}`);
    console.log(`  Storage/PDF: ${p.storagePath || p.pdfUrl}`);

    if (p._count.chunks > 0) {
      const sections: any[] = await prisma.$queryRaw`
        SELECT DISTINCT section, COUNT(*)::int as cnt
        FROM paper_chunks
        WHERE "paperId" = ${p.id}
        GROUP BY section
      `;
      console.log(`  Sections:`, sections.map(s => `${s.section} (${s.cnt})`).join(", "));
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
