const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspect() {
  const chunks = await prisma.paperChunk.findMany({
    select: {
      id: true,
      paperId: true,
      chunkIndex: true,
      section: true,
      embeddingModel: true,
      embeddingDimensions: true,
      embeddingInputHash: true,
      embeddedAt: true,
      paper: {
        select: { title: true }
      }
    }
  });

  const vectorCount = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "paper_chunks" WHERE "embedding" IS NOT NULL;
  `;

  console.log('Total chunks in DB:', chunks.length);
  console.log('Chunks with vector:', vectorCount[0].count.toString());
  console.log('Chunks with embeddingDimensions:', chunks.filter(c => c.embeddingDimensions !== null).length);
  console.log('Chunks with embeddingInputHash:', chunks.filter(c => c.embeddingInputHash !== null).length);
  
  await prisma.$disconnect();
}

inspect();
