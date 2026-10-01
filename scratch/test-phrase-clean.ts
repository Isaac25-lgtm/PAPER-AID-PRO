import "./load-env";
import { prisma } from "../src/lib/prisma";
import { downloadPaperPdf } from "../src/lib/storage";
import { extractPdfText } from "../src/lib/pdf/extractor";

async function main() {
  const ch = await prisma.paperChunk.findUnique({ where: { id: "cmumgu5fb0035vr44i816sqko" } });
  const paper = await prisma.paper.findUnique({ where: { id: ch!.paperId } });
  const pdfBuf = await downloadPaperPdf(paper!.storagePath!);
  const pdf = await extractPdfText(pdfBuf);
  const p18 = pdf.pages.find(p => p.pageNumber === 18)!;

  console.log("CH TEXT (first 250):", JSON.stringify(ch!.text.slice(0, 250)));
  console.log("P18 TEXT (first 350):", JSON.stringify(p18.text.slice(0, 350)));

  // Test match with normalized whitespace and removed soft hyphens
  const cleanCh = ch!.text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ");
  const cleanPdf = p18.text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ");

  const phrase = "The main limitation is the relatively small dataset";
  console.log("cleanPdf includes phrase?", cleanPdf.includes(phrase));
}

main().catch(console.error).finally(() => prisma.$disconnect());
