import "./load-env";
import { prisma } from "../src/lib/prisma";

async function main() {
  const paperId = "cmumgtiix0000vr445cn8ry7o";
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      authors: { include: { author: true } },
      categories: { include: { category: true } },
      chunks: {
        select: {
          id: true,
          chunkIndex: true,
          pageNumber: true,
          section: true,
          text: true,
        },
        orderBy: { chunkIndex: "asc" },
      },
      aiSummary: true,
      processingJobs: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!paper) {
    console.log("Paper not found:", paperId);
    return;
  }

  console.log("=== PAPER METADATA ===");
  console.log("ID:", paper.id);
  console.log("Title:", paper.title);
  console.log("DOI:", paper.doi);
  console.log("Status:", paper.status);
  console.log("Storage Path:", paper.storagePath);
  console.log("PDF URL:", paper.pdfUrl);
  console.log("Total Chunks:", paper.chunks.length);

  // Check how many chunks have embeddings in DB
  const chunksWithEmbeddings = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count FROM "paper_chunks" WHERE "paperId" = ${paperId} AND embedding IS NOT NULL;
  `;
  console.log("Chunks with embedding populated:", chunksWithEmbeddings[0].count.toString());

  // Check conversations and messages for this paper
  const conversations = await prisma.aIConversation.findMany({
    where: { paperId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n=== CONVERSATIONS (${conversations.length}) ===`);
  for (const conv of conversations) {
    console.log(`Conversation ID: ${conv.id}, Title: "${conv.title}", Created: ${conv.createdAt.toISOString()}`);
    console.log(`Messages Count: ${conv.messages.length}`);
    for (const m of conv.messages) {
      console.log(`  [${m.role.toUpperCase()}] ${m.id} (${m.createdAt.toISOString()})`);
      console.log(`  Content: ${m.content.slice(0, 120)}...`);
      const cit = m.citations ? (Array.isArray(m.citations) ? m.citations : [m.citations]) : [];
      console.log(`  Citations Count: ${cit.length}`);
      if (cit.length > 0) {
        console.log(`  Sample Citation:`, JSON.stringify(cit[0]).slice(0, 120));
      }
    }
  }

  // Processing jobs
  console.log(`\n=== PROCESSING JOBS (${paper.processingJobs.length}) ===`);
  for (const job of paper.processingJobs) {
    console.log(`Job ${job.id}: Stage=${job.stage}, Status=${job.status}, Started=${job.startedAt?.toISOString()}, Completed=${job.completedAt?.toISOString()}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
