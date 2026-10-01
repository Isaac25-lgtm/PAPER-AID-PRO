import "./load-env";
import { prisma } from "../src/lib/prisma";
import { downloadPaperPdf } from "../src/lib/storage";
import { extractPdfText } from "../src/lib/pdf/extractor";

async function verifyGroundTruth() {
  const paperId = "cmumgtiix0000vr445cn8ry7o";
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
  });

  if (!paper || !paper.storagePath) {
    console.error("Paper or storage path missing!");
    return;
  }

  console.log("Downloading PDF from storage:", paper.storagePath);
  const pdfBuffer = await downloadPaperPdf(paper.storagePath);
  console.log(`Downloaded ${pdfBuffer.length} bytes.`);

  // Extract raw pages
  const extracted = await extractPdfText(pdfBuffer);
  console.log(`Extracted ${extracted.totalPages} pages, total chars: ${extracted.totalCharacters}`);

  // Chunks to verify: 14, 15, 22, 35, 63, 68
  const targetChunkIndices = [14, 15, 22, 35, 63, 68];
  const chunks = await prisma.paperChunk.findMany({
    where: {
      paperId,
      chunkIndex: { in: targetChunkIndices },
    },
    orderBy: { chunkIndex: "asc" },
  });

  console.log("\n=== COMPARING DATABASE CHUNKS AGAINST RAW PDF PAGES ===");

  for (const c of chunks) {
    const pageNum = c.pageNumber!;
    const pdfPage = extracted.pages.find((p) => p.pageNumber === pageNum);

    console.log(`\n--------------------------------------------------`);
    console.log(`CHUNK ${c.chunkIndex}:`);
    console.log(`DB PageNumber: ${c.pageNumber}`);
    console.log(`DB Section: ${c.section}`);
    console.log(`DB Text snippet: "${c.text.slice(0, 160)}..."`);

    if (!pdfPage) {
      console.log(`❌ MISMATCH: Page ${pageNum} not found in PDF!`);
      continue;
    }

    // Check if the snippet appears in pdfPage.text
    // Take a distinctive 40-character sub-phrase from c.text
    const sampleSearch = c.text.slice(30, 90).replace(/\s+/g, " ").trim();
    const cleanPdfText = pdfPage.text.replace(/\s+/g, " ");
    const matches = cleanPdfText.includes(sampleSearch);

    console.log(`Sample search text from chunk: "${sampleSearch}"`);
    console.log(`Present on PDF Page ${pageNum}?: ${matches ? "YES (MATCH)" : "NO (SEARCHING OTHER PAGES)"}`);

    if (!matches) {
      // Find which page it actually appears on
      const actualPage = extracted.pages.find((p) => p.text.replace(/\s+/g, " ").includes(sampleSearch));
      if (actualPage) {
        console.log(`Found on actual PDF Page: ${actualPage.pageNumber}`);
      } else {
        console.log(`Not found on any page with exact phrase.`);
      }
    } else {
      console.log(`First 200 chars of PDF Page ${pageNum}: "${pdfPage.text.slice(0, 200).replace(/\s+/g, " ")}"`);
    }
  }
}

verifyGroundTruth().finally(async () => {
  await prisma.$disconnect();
});
