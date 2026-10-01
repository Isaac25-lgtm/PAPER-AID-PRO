import "./load-env";
import { prisma } from "../src/lib/prisma";

async function main() {
  const papers = await prisma.paper.findMany({
    include: {
      authors: {
        include: { author: true },
        orderBy: { orderIndex: "asc" },
      },
      chunks: {
        select: {
          id: true,
          chunkIndex: true,
          text: true,
          pageNumber: true,
          section: true,
          embeddingModel: true,
          embeddingDimensions: true,
          embeddingInputHash: true,
          embeddedAt: true,
        },
      },
      processingJobs: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`TOTAL PAPERS IN DB: ${papers.length}`);
  
  for (const p of papers) {
    const totalChars = p.chunks.reduce((sum, c) => sum + c.text.length, 0);
    const pages = new Set(p.chunks.map(c => c.pageNumber).filter(Boolean));
    const sampleChunk = p.chunks[0];

    // Check embeddings with queryRaw
    const rawVectorCount = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT count(*) as count FROM paper_chunks 
      WHERE "paperId" = ${p.id} AND embedding IS NOT NULL
    `;
    const embeddedCount = Number(rawVectorCount[0]?.count || 0);

    console.log("--------------------------------------------------");
    console.log(`Paper ID: ${p.id}`);
    console.log(`Title: ${p.title}`);
    console.log(`Authors: ${p.authors.map(a => a.author.name).join(", ") || "None"}`);
    console.log(`Year/Date: ${p.publicationDate ? p.publicationDate.toISOString().slice(0, 10) : "N/A"}`);
    console.log(`DOI: ${p.doi || "N/A"}`);
    console.log(`Storage/PDF Path: ${p.storagePath || p.pdfUrl || "N/A"}`);
    console.log(`Page count from chunks: ${pages.size} (pages: ${Array.from(pages).sort((a,b)=>(a||0)-(b||0)).join(", ")})`);
    console.log(`Extracted character count: ${totalChars}`);
    console.log(`Number of PaperChunks: ${p.chunks.length}`);
    console.log(`Number of embedded chunks: ${embeddedCount}`);
    console.log(`Latest Processing Jobs: ${p.processingJobs.map(j => `${j.stage}:${j.status}`).join(", ") || "None"}`);
    if (sampleChunk) {
      console.log(`Sample Chunk embeddingModel: ${sampleChunk.embeddingModel}`);
      console.log(`Sample Chunk embeddingDimensions: ${sampleChunk.embeddingDimensions}`);
      console.log(`Sample Chunk embeddingInputHash present: ${!!sampleChunk.embeddingInputHash}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
