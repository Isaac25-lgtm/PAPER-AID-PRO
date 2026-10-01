import { prisma } from "../src/lib/prisma";

async function main() {
  const papers = await prisma.paper.findMany({
    include: {
      chunks: true,
    },
  });

  for (const paper of papers) {
    if (paper.chunks.length === 0) {
      console.log(`Seeding chunks for paper: "${paper.title}" (${paper.id})`);
      const sections = [
        { section: "Abstract", text: paper.abstract, page: 1 },
        { section: "Research Question", text: paper.researchQuestion, page: 1 },
        { section: "Methodology", text: paper.methodology, page: 3 },
        { section: "Results", text: paper.results, page: 5 },
        { section: "Limitations", text: paper.limitations, page: 7 },
        { section: "Conclusion", text: paper.conclusion, page: 8 },
      ].filter(s => !!s.text && s.text.trim().length > 0);

      const chunkData = sections.map((s, idx) => ({
        paperId: paper.id,
        chunkIndex: idx,
        text: s.text!.trim(),
        section: s.section,
        pageNumber: s.page,
        tokenCount: Math.ceil(s.text!.length / 4),
        metadata: {
          section: s.section,
          pageNumber: s.page,
          charLength: s.text!.length,
          wordCount: s.text!.split(/\s+/).length,
          chunkIndex: idx,
          source: "manuscript_structured_evidence",
        },
      }));

      await prisma.paperChunk.createMany({
        data: chunkData,
      });

      console.log(`  -> Created ${chunkData.length} chunks for ${paper.title}`);
    } else {
      console.log(`Paper "${paper.title}" already has ${paper.chunks.length} chunks.`);
    }
  }

  const totalChunks = await prisma.paperChunk.count();
  console.log(`\nTotal PaperChunks now in database: ${totalChunks}`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Error seeding chunks for papers:", err);
  process.exit(1);
});
