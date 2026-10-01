import "./load-env";
import { prisma } from "../src/lib/prisma";
import { getPaperEmbeddingStats, isChunkEmbeddingCurrent } from "../src/lib/ai/embedding-pipeline";
import * as fs from "fs";

async function main() {
  const papers = await prisma.paper.findMany({
    where: {
      storagePath: { not: null }
    },
    include: {
      authors: {
        include: { author: true },
        orderBy: { orderIndex: "asc" }
      },
      chunks: {
        select: {
          id: true,
          chunkIndex: true,
          text: true,
          section: true,
          pageNumber: true,
          tokenCount: true,
          embeddingModel: true,
          embeddingDimensions: true,
          embeddingInputHash: true,
          embeddedAt: true,
        },
        orderBy: { chunkIndex: "asc" }
      },
      processingJobs: {
        orderBy: { createdAt: "desc" },
        take: 3
      }
    },
    orderBy: { createdAt: "desc" }
  });

  console.log(`Found ${papers.length} papers with storagePath in DB.`);

  const results = [];

  for (const p of papers) {
    const totalChars = p.chunks.reduce((sum, c) => sum + c.text.length, 0);
    const pages = new Set(p.chunks.map(c => c.pageNumber).filter(Boolean));
    
    // Check vector status
    const rawVectorCount = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT count(*) as count FROM paper_chunks 
      WHERE "paperId" = ${p.id} AND embedding IS NOT NULL
    `;
    const embeddedVectorCount = Number(rawVectorCount[0]?.count || 0);

    // Staleness check on chunks
    let currentCount = 0;
    let staleCount = 0;
    for (const c of p.chunks) {
      const res = isChunkEmbeddingCurrent({
        hasVector: embeddedVectorCount > 0, // checked per-chunk below if needed
        embeddingModel: c.embeddingModel,
        embeddingDimensions: c.embeddingDimensions,
        embeddingInputHash: c.embeddingInputHash,
        currentTitle: p.title,
        currentSection: c.section,
        currentText: c.text,
      });
      if (res.isCurrent) {
        currentCount++;
      } else {
        staleCount++;
      }
    }

    const sampleChunk = p.chunks[0];

    results.push({
      paperId: p.id,
      title: p.title,
      authors: p.authors.map(a => a.author.name).join(", "),
      publicationDate: p.publicationDate ? p.publicationDate.toISOString().slice(0, 10) : "N/A",
      doi: p.doi || "N/A",
      storagePath: p.storagePath,
      pdfPageCount: pages.size,
      pagesList: Array.from(pages).sort((a,b)=>(a||0)-(b||0)),
      extractedCharCount: totalChars,
      chunkCount: p.chunks.length,
      embeddedVectorCount,
      currentChunks: currentCount,
      staleChunks: staleCount,
      sampleEmbeddingModel: sampleChunk?.embeddingModel || null,
      sampleEmbeddingDimensions: sampleChunk?.embeddingDimensions || null,
      sampleEmbeddingInputHash: sampleChunk?.embeddingInputHash || null,
      latestJobs: p.processingJobs.map(j => `${j.stage}:${j.status}`).join(", ")
    });
  }

  fs.writeFileSync("scratch/audit-corpus-summary.json", JSON.stringify(results, null, 2));
  console.log("Summary saved to scratch/audit-corpus-summary.json");
}

main().catch(console.error).finally(() => prisma.$disconnect());
