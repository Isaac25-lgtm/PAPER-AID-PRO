import "./load-env";
import { prisma } from "../src/lib/prisma";
import { downloadPaperPdf } from "../src/lib/storage";

async function inspectNewPaperDetails() {
  const paperId = "cmumgtiix0000vr445cn8ry7o";
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" },
      },
    },
  });

  if (!paper) {
    console.error("Paper not found!");
    return;
  }

  console.log("=== NEW PAPER INSPECTION ===");
  console.log(`ID: ${paper.id}`);
  console.log(`Title: ${paper.title}`);
  console.log(`DOI: ${paper.doi}`);
  console.log(`Storage Path: ${paper.storagePath}`);

  // Download PDF from storage to check size
  if (paper.storagePath) {
    const pdfBuffer = await downloadPaperPdf(paper.storagePath);
    console.log(`PDF file size: ${pdfBuffer.length} bytes (${(pdfBuffer.length / (1024 * 1024)).toFixed(2)} MB)`);
  }

  const totalChars = paper.chunks.reduce((acc, c) => acc + c.text.length, 0);
  console.log(`Total chunks: ${paper.chunks.length}`);
  console.log(`Total text character count across chunks: ${totalChars}`);

  const pages = Array.from(new Set(paper.chunks.map((c) => c.pageNumber).filter(Boolean))) as number[];
  pages.sort((a, b) => a - b);
  console.log(`Total distinct pages with chunks: ${pages.length} (Pages: ${pages[0]} to ${pages[pages.length - 1]})`);

  // Sections
  const sectionCounts: Record<string, number> = {};
  for (const c of paper.chunks) {
    const s = c.section || "Uncategorized";
    sectionCounts[s] = (sectionCounts[s] || 0) + 1;
  }
  console.log("Section chunk breakdown:", sectionCounts);

  // Check chunk size stats
  const chunkLengths = paper.chunks.map((c) => c.text.length);
  const minLen = Math.min(...chunkLengths);
  const maxLen = Math.max(...chunkLengths);
  const avgLen = Math.round(totalChars / chunkLengths.length);
  console.log(`Chunk lengths: min=${minLen}, max=${maxLen}, avg=${avgLen}`);

  // Print representative early, middle, late chunks
  console.log("\n--- Representative Early Chunk (Chunk 0, Page " + paper.chunks[0].pageNumber + ") ---");
  console.log(`Section: ${paper.chunks[0].section}`);
  console.log(`Snippet: ${paper.chunks[0].text.slice(0, 300)}...`);

  const midIdx = Math.floor(paper.chunks.length / 2);
  console.log("\n--- Representative Middle Chunk (Chunk " + midIdx + ", Page " + paper.chunks[midIdx].pageNumber + ") ---");
  console.log(`Section: ${paper.chunks[midIdx].section}`);
  console.log(`Snippet: ${paper.chunks[midIdx].text.slice(0, 300)}...`);

  const lateIdx = paper.chunks.length - 1;
  console.log("\n--- Representative Late Chunk (Chunk " + lateIdx + ", Page " + paper.chunks[lateIdx].pageNumber + ") ---");
  console.log(`Section: ${paper.chunks[lateIdx].section}`);
  console.log(`Snippet: ${paper.chunks[lateIdx].text.slice(0, 300)}...`);
}

inspectNewPaperDetails().finally(async () => {
  await prisma.$disconnect();
});
