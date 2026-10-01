import "./load-env";
import { prisma } from "../src/lib/prisma";
import * as fs from "fs";

async function run() {
  const papers = await prisma.paper.findMany({
    select: {
      id: true,
      title: true,
      createdAt: true,
      storagePath: true,
      doi: true,
      publicationDate: true,
      authors: {
        include: { author: true },
        orderBy: { orderIndex: "asc" }
      },
      _count: {
        select: { chunks: true }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  const detailed = [];
  for (const p of papers) {
    const rawVectorCount = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT count(*) as count FROM paper_chunks 
      WHERE "paperId" = ${p.id} AND embedding IS NOT NULL
    `;
    const embeddedCount = Number(rawVectorCount[0]?.count || 0);

    const chunkStats = await prisma.paperChunk.aggregate({
      where: { paperId: p.id },
      _sum: { tokenCount: true },
      _min: { pageNumber: true },
      _max: { pageNumber: true },
    });

    const sample = await prisma.paperChunk.findFirst({
      where: { paperId: p.id },
      select: {
        embeddingModel: true,
        embeddingDimensions: true,
        embeddingInputHash: true,
        embeddedAt: true,
      }
    });

    const jobs = await prisma.processingJob.findMany({
      where: { paperId: p.id },
      orderBy: { createdAt: "desc" },
      take: 3
    });

    detailed.push({
      id: p.id,
      title: p.title,
      authors: p.authors.map(a => a.author.name).join(", "),
      createdAt: p.createdAt,
      publicationDate: p.publicationDate,
      doi: p.doi,
      storagePath: p.storagePath,
      chunkCount: p._count.chunks,
      embeddedCount,
      minPage: chunkStats._min.pageNumber,
      maxPage: chunkStats._max.pageNumber,
      sampleEmbedding: sample,
      latestJobs: jobs.map(j => ({ stage: j.stage, status: j.status, error: j.errorMessage }))
    });
  }

  fs.writeFileSync("scratch/corpus-details.json", JSON.stringify(detailed, null, 2));
  console.log(`Wrote details for ${detailed.length} papers to scratch/corpus-details.json`);
}

run().catch(console.error).finally(() => prisma.$disconnect());
