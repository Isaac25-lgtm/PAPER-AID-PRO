// Mock server-only for standalone script execution
(require.cache as any)[require.resolve("server-only")] = {
  id: require.resolve("server-only"),
  filename: require.resolve("server-only"),
  loaded: true,
  exports: {},
};

import { prisma } from "../src/lib/prisma";
import { downloadPaperPdf } from "../src/lib/storage";
import { extractPdfText } from "../src/lib/pdf/extractor";

async function main() {
  console.log("=== PRE-FLIGHT AUDIT OF UPLOADED PAPERS & CHUNKS ===");

  const papers = await prisma.paper.findMany({
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" },
      },
      processingJobs: {
        orderBy: { createdAt: "desc" },
        take: 3,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Total papers in DB: ${papers.length}\n`);

  for (const paper of papers) {
    console.log(`--------------------------------------------------`);
    console.log(`ID: ${paper.id}`);
    console.log(`Title: ${paper.title}`);
    console.log(`Status: ${paper.status}`);
    console.log(`StoragePath: ${paper.storagePath || "NONE"}`);
    console.log(`Chunk count in DB: ${paper.chunks.length}`);

    for (const chunk of paper.chunks) {
      console.log(`  Chunk #${chunk.chunkIndex}:`);
      console.log(`    Section: ${chunk.section || "N/A"}`);
      console.log(`    Page: ${chunk.pageNumber ?? "N/A"}`);
      console.log(`    Char length: ${chunk.text.length}`);
      console.log(`    Token count: ${chunk.tokenCount}`);
      console.log(`    Metadata:`, JSON.stringify(chunk.metadata));
      console.log(`    Snippet: "${chunk.text.substring(0, 100).replace(/\n/g, ' ')}..."`);
    }

    if (paper.storagePath) {
      try {
        console.log(`  Downloading PDF from storage to verify page count & extraction...`);
        const pdfBuffer = await downloadPaperPdf(paper.storagePath);
        console.log(`  Downloaded PDF size: ${pdfBuffer.byteLength} bytes`);
        const extraction = await extractPdfText(pdfBuffer);
        console.log(`  Extracted Page count: ${extraction.totalPages}`);
        console.log(`  Total extracted characters: ${extraction.totalCharacters}`);
        console.log(`  Pages details:`);
        for (const p of extraction.pages) {
          console.log(`    - Page ${p.pageNumber}: ${p.text.length} chars`);
        }
      } catch (err: any) {
        console.error(`  Error inspecting PDF in storage:`, err.message);
      }
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
