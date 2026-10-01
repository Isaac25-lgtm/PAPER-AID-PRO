import "./load-env";
import { prisma } from "../src/lib/prisma";
import { downloadPaperPdf } from "../src/lib/storage";
import { extractPdfText } from "../src/lib/pdf/extractor";

interface AnchorCheck {
  paperId: string;
  chunkId: string;
  claim: string;
}

async function main() {
  console.log("====================================================================================================");
  console.log("PHASE 8.1 — SECTION 14: ORIGINAL PDF GROUND-TRUTH AUDIT (EXACT VERBATIM COMPARISON)");
  console.log("====================================================================================================\n");

  // 10 distinct anchors across 5 different real papers
  const anchors: AnchorCheck[] = [
    // Paper 1: Magnuska et al. (Cancers 2022)
    {
      paperId: "cmumgtiix0000vr445cn8ry7o",
      chunkId: "cmumgu5fb002pvr44qni8eswc",
      claim: "CAD models achieve high accuracy, sensitivity, and specificity in breast lesion classification",
    },
    {
      paperId: "cmumgtiix0000vr445cn8ry7o",
      chunkId: "cmumgu5fb002xvr44gfqmub6e",
      claim: "LE as a supporting score for IoU is beneficial for lesion analysis",
    },
    {
      paperId: "cmumgtiix0000vr445cn8ry7o",
      chunkId: "cmumgu5fb0035vr44i816sqko",
      claim: "Small dataset may limit conclusions and some cases were missing in second data pool",
    },

    // Paper 2: Kim et al. (Applied Sciences 2021)
    {
      paperId: "cmunwm6m2004ivrusrlr89j95",
      chunkId: "cmunwmok5005gvrus8xz5ognc",
      claim: "CAD systems using machine learning classify breast lesions based on extracted ultrasound features",
    },
    {
      paperId: "cmunwm6m2004ivrusrlr89j95",
      chunkId: "cmunwmok5005dvrussg0gt6vb",
      claim: "CNN using multiple time-domain feature maps was proposed to classify breast lesions",
    },

    // Paper 3: Li et al. (Frontiers in Medicine 2025)
    {
      paperId: "cmunxw9il00dnvrus7w9mqij9",
      chunkId: "cmunxwl2x00e9vrusxf4o59r6",
      claim: "Operator-dependent nature of breast cancer ultrasound can lead to misdetection due to fatigue",
    },
    {
      paperId: "cmunxw9il00dnvrus7w9mqij9",
      chunkId: "cmunxwl3000fcvrusi1ysxg3a",
      claim: "Multiparametric ultrasound leads to improved differentiation of benign and malignant lesions",
    },

    // Paper 4: Su et al. (BMC Medical Imaging 2026)
    {
      paperId: "cmunotrr10000vrusnqyv61ut",
      chunkId: "cmunou2gs001mvrus0x7un1ic",
      claim: "Study has several limitations: single-center, retrospective design, and small sample size",
    },

    // Paper 5: Zakareya et al. (Diagnostics 2023)
    {
      paperId: "cmunwvfkr006uvrus0m3ky4wn",
      chunkId: "cmunwvp49007fvrusqe93hf3n",
      claim: "Deep-learning-based model for breast cancer diagnosis from medical images",
    },
    {
      paperId: "cmunwvfkr006uvrus0m3ky4wn",
      chunkId: "cmunwvp49007gvrushyp4ptwu",
      claim: "Medical image data related to diseases is scarce and deep learning models require more data",
    }
  ];

  // Group by paper to cache PDF downloads
  const uniquePaperIds = Array.from(new Set(anchors.map(a => a.paperId)));
  const pdfMap = new Map<string, any>();

  for (const pid of uniquePaperIds) {
    const paper = await prisma.paper.findUnique({
      where: { id: pid },
      select: { id: true, title: true, storagePath: true }
    });
    if (!paper || !paper.storagePath) continue;
    console.log(`Downloading original PDF: ${paper.storagePath}...`);
    const buf = await downloadPaperPdf(paper.storagePath);
    const extracted = await extractPdfText(buf);
    pdfMap.set(pid, extracted);
  }

  const tableData: Array<{
    claim: string;
    paper: string;
    chunkId: string;
    dbPage: number;
    dbSection: string;
    pdfPageVerified: number;
    snippetMatch: string;
    result: "MATCH" | "MISMATCH";
  }> = [];

  for (const a of anchors) {
    const chunk = await prisma.paperChunk.findUnique({
      where: { id: a.chunkId },
      include: { paper: true }
    });

    if (!chunk) {
      console.error(`Chunk ${a.chunkId} not found!`);
      continue;
    }

    const pdf = pdfMap.get(a.paperId);
    const targetPage = pdf?.pages.find((p: any) => p.pageNumber === chunk.pageNumber);
    const normalizedPdfPage = (targetPage?.text || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ");

    // Extract a 40-character verbatim sequence from the chunk (skipping any leading page/cancers header if present)
    const normalizedChunk = chunk.text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ");
    // Take words 5 to 15 from chunk to avoid headers
    const words = normalizedChunk.split(" ").filter(Boolean);
    const sampleWords = words.slice(Math.min(5, words.length - 8), Math.min(18, words.length)).join(" ");

    const matchesOnDbPage = normalizedPdfPage.includes(sampleWords);

    let actualPage = targetPage?.pageNumber || 0;
    if (!matchesOnDbPage) {
      for (const p of pdf.pages) {
        const normP = p.text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ");
        if (normP.includes(sampleWords)) {
          actualPage = p.pageNumber;
          break;
        }
      }
    }

    const result = matchesOnDbPage ? "MATCH" : "MISMATCH";

    tableData.push({
      claim: a.claim.slice(0, 38) + "...",
      paper: chunk.paper.title.slice(0, 24) + "...",
      chunkId: chunk.id,
      dbPage: chunk.pageNumber || 0,
      dbSection: chunk.section || "N/A",
      pdfPageVerified: matchesOnDbPage ? chunk.pageNumber! : actualPage,
      snippetMatch: sampleWords.slice(0, 35) + "...",
      result
    });

    console.log(`\nAudit Anchor [${chunk.id}] (${chunk.paper.title.slice(0, 40)}):`);
    console.log(`  DB Page: ${chunk.pageNumber}, DB Section: ${chunk.section}`);
    console.log(`  Verbatim Sample: "${sampleWords}"`);
    console.log(`  PDF Page ${chunk.pageNumber} Verified: ${matchesOnDbPage ? "YES (MATCH)" : "NO (MISMATCH, found on p." + actualPage + ")"}`);
  }

  console.log("\n====================================================================================================");
  console.log("FINAL CITATION GROUND-TRUTH AUDIT TABLE (10 ANCHORS ACROSS 5 REAL PDFs):");
  console.log("====================================================================================================");
  console.table(tableData);
}

main().catch(console.error).finally(() => prisma.$disconnect());
