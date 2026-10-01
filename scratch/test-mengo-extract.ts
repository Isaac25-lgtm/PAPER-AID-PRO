import "./load-env";
import { downloadPaperPdf } from "../src/lib/storage";
import { extractPdfText } from "../src/lib/pdf/extractor";

async function main() {
  console.log("Checking Mengo Hospital PDF...");
  const buf = await downloadPaperPdf("research-papers/cmugydswv0003vrpoassf36yi/original.pdf");
  console.log("PDF buffer size:", buf.length);
  const extraction = await extractPdfText(buf);
  console.log("Extracted total pages:", extraction.totalPages);
  console.log("Extracted pages array length:", extraction.pages.length);
  for (const p of extraction.pages) {
    console.log(`Page ${p.pageNumber}: ${p.text.length} chars. Sample: "${p.text.slice(0, 100).replace(/\n/g, ' ')}"`);
  }
}

main().catch(console.error);
