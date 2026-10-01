import "./load-env";
import { prisma } from "../src/lib/prisma";
import { downloadPaperPdf } from "../src/lib/storage";
import { extractPdfText } from "../src/lib/pdf/extractor";

async function main() {
  const ch = await prisma.paperChunk.findUnique({
    where: { id: "cmumgu5f9001cvr44pi5ocm32" },
    include: { paper: true }
  });

  const pdfBuf = await downloadPaperPdf(ch!.paper.storagePath!);
  const pdf = await extractPdfText(pdfBuf);
  const p2 = pdf.pages.find(p => p.pageNumber === 2)!;

  console.log("Chunk full text (first 200 chars):");
  console.log(JSON.stringify(ch!.text.slice(0, 200)));

  console.log("\nPDF Page 2 text (first 300 chars):");
  console.log(JSON.stringify(p2.text.slice(0, 300)));

  // Try different substrings
  const sub1 = "Breast cancer is the leading cause of cancer death";
  console.log("\nDoes PDF page 2 contain sub1?");
  console.log(p2.text.includes(sub1));
}

main().catch(console.error).finally(() => prisma.$disconnect());
