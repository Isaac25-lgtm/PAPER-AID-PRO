import "./load-env";
import { prisma } from "../src/lib/prisma";
import { downloadPaperPdf } from "../src/lib/storage";
import { extractPdfText } from "../src/lib/pdf/extractor";

interface GroundTruthCheck {
  claim: string;
  paperId: string;
  paperTitle: string;
  chunkId: string;
  chunkIndex: number;
  expectedDbPage: number;
  expectedDbSection: string;
}

async function main() {
  console.log("==================================================");
  console.log("SECTION 14: ORIGINAL PDF GROUND-TRUTH AUDIT");
  console.log("==================================================");

  // Define 10 citation anchors across 4 different real papers
  const checks: GroundTruthCheck[] = [
    // Paper 1: Magnuska et al. (Cancers 2022)
    {
      claim: "CAD models achieve high accuracy, sensitivity, and specificity in breast lesion classification",
      paperId: "cmumgtiix0000vr445cn8ry7o",
      paperTitle: "Influence of the Computer-Aided Decision Support System Design",
      chunkId: "cmumgu5fb002pvr44qni8eswc",
      chunkIndex: 52,
      expectedDbPage: 14,
      expectedDbSection: "Methods",
    },
    {
      claim: "LE as a supporting score for IoU is beneficial for lesion analysis",
      paperId: "cmumgtiix0000vr445cn8ry7o",
      paperTitle: "Influence of the Computer-Aided Decision Support System Design",
      chunkId: "cmumgu5fb002xvr44gfqmub6e",
      chunkIndex: 60,
      expectedDbPage: 16,
      expectedDbSection: "Discussion",
    },
    {
      claim: "Small dataset may limit conclusions and some cases were missing in second data pool",
      paperId: "cmumgtiix0000vr445cn8ry7o",
      paperTitle: "Influence of the Computer-Aided Decision Support System Design",
      chunkId: "cmumgu5fb0035vr44i816sqko",
      chunkIndex: 68, // chunk in conclusion/limitations
      expectedDbPage: 18,
      expectedDbSection: "Conclusion",
    },

    // Paper 2: Kim et al. (Applied Sciences 2021)
    {
      claim: "CAD systems using machine learning classify breast lesions from US images",
      paperId: "cmunwm6m2004ivrusrlr89j95",
      paperTitle: "Classification for Breast Ultrasound Using Convolutional Neural Network",
      chunkId: "cmunwmok5005gvrus8xz5ognc",
      chunkIndex: 4,
      expectedDbPage: 1,
      expectedDbSection: "Introduction",
    },
    {
      claim: "Ultrasound is one of the most common medical imaging modalities for breast examination",
      paperId: "cmunwm6m2004ivrusrlr89j95",
      paperTitle: "Classification for Breast Ultrasound Using Convolutional Neural Network",
      chunkId: "cmunwmok5005fvrusd8s1eag8",
      chunkIndex: 3,
      expectedDbPage: 1,
      expectedDbSection: "Introduction",
    },

    // Paper 3: Li et al. (Frontiers in Medicine 2025)
    {
      claim: "Enhanced area of the lesion expands compared with two-dimensional ultrasound",
      paperId: "cmunxw9il00dnvrus7w9mqij9",
      paperTitle: "The application of multimodal ultrasound examination in BI-RADS 4",
      chunkId: "cmunxwl2z00f0vrus19fshq5z",
      chunkIndex: 14,
      expectedDbPage: 4,
      expectedDbSection: "Results",
    },
    {
      claim: "Breast cancer is the most common malignancy among women worldwide",
      paperId: "cmunxw9il00dnvrus7w9mqij9",
      paperTitle: "The application of multimodal ultrasound examination in BI-RADS 4",
      chunkId: "cmunxwl2z00f8vrussv3q6w2u",
      chunkIndex: 22,
      expectedDbPage: 6,
      expectedDbSection: "Discussion",
    },
    {
      claim: "Operator-dependent nature of breast cancer diagnosis can lead to misdetection due to fatigue",
      paperId: "cmunxw9il00dnvrus7w9mqij9",
      paperTitle: "The application of multimodal ultrasound examination in BI-RADS 4",
      chunkId: "cmunxwl2x00e9vrusxf4o59r6",
      chunkIndex: 3,
      expectedDbPage: 2,
      expectedDbSection: "Methods",
    },

    // Paper 4: Lee et al. (Sensors 2023)
    {
      claim: "Development of ultrasound imaging technology as a first-line screening modality for skin tumors",
      paperId: "cmunxiwf900blvruskrclq381",
      paperTitle: "Deep Learning-Based Evaluation of Ultrasound Images for Benign Skin Tumors",
      chunkId: "cmunxj7kt00d5vrusiho33fob",
      chunkIndex: 29,
      expectedDbPage: 9,
      expectedDbSection: "Results",
    },

    // Paper 5: Su et al. (BMC Medical Imaging 2026)
    {
      claim: "Study has several limitations: single-center, retrospective design, small sample size",
      paperId: "cmunotrr10000vrusnqyv61ut",
      paperTitle: "Application of multimodal ultrasound radiomics in superficial lymph node TB",
      chunkId: "cmunou2gs001mvrus0x7un1ic",
      chunkIndex: 36,
      expectedDbPage: 10,
      expectedDbSection: "Conclusion",
    }
  ];

  // Group checks by paperId to download each PDF once
  const paperIds = Array.from(new Set(checks.map(c => c.paperId)));
  const pdfCache = new Map<string, { totalPages: number; pages: Array<{ pageNumber: number; text: string }> }>();

  for (const pid of paperIds) {
    const paper = await prisma.paper.findUnique({
      where: { id: pid },
      select: { id: true, title: true, storagePath: true }
    });
    if (!paper || !paper.storagePath) {
      console.error(`Paper ${pid} missing storagePath!`);
      continue;
    }
    console.log(`Downloading original PDF for [${paper.id}] "${paper.title.slice(0, 50)}"...`);
    const pdfBuf = await downloadPaperPdf(paper.storagePath);
    console.log(`  Downloaded ${pdfBuf.length} bytes. Extracting text with unpdf...`);
    const extracted = await extractPdfText(pdfBuf);
    console.log(`  Extracted ${extracted.totalPages} pages.`);
    pdfCache.set(pid, extracted);
  }

  console.log(`\n====================================================================================================`);
  console.log(`VERIFYING CITATION ANCHORS AGAINST ORIGINAL PDF MANUSCRIPTS`);
  console.log(`====================================================================================================\n`);

  const resultsTable: Array<{
    claim: string;
    paper: string;
    chunkId: string;
    dbPage: number;
    dbSection: string;
    pdfPageVerified: number;
    snippetMatch: string;
    result: string;
  }> = [];

  for (const check of checks) {
    const chunk = await prisma.paperChunk.findUnique({
      where: { id: check.chunkId }
    });

    if (!chunk) {
      console.error(`Chunk ${check.chunkId} not found in DB!`);
      continue;
    }

    const pdfData = pdfCache.get(check.paperId);
    if (!pdfData) {
      console.error(`PDF data not loaded for paper ${check.paperId}!`);
      continue;
    }

    // PDF page numbers are 1-indexed in our extracted structure
    const targetPage = pdfData.pages.find(p => p.pageNumber === chunk.pageNumber);
    const pageText = targetPage?.text || "";

    // Test snippet matching: take first 60 chars of chunk text (ignoring whitespace differences)
    const normalizedChunkText = chunk.text.replace(/\s+/g, " ").trim();
    const testSnippet = normalizedChunkText.slice(0, 60);
    const normalizedPageText = pageText.replace(/\s+/g, " ");

    const isMatch = normalizedPageText.includes(testSnippet);

    resultsTable.push({
      claim: check.claim.slice(0, 45) + "...",
      paper: check.paperTitle.slice(0, 30) + "...",
      chunkId: chunk.id,
      dbPage: chunk.pageNumber || 0,
      dbSection: chunk.section || "N/A",
      pdfPageVerified: targetPage?.pageNumber || 0,
      snippetMatch: isMatch ? "YES" : "NO",
      result: isMatch ? "MATCH" : "MISMATCH"
    });

    console.log(`Anchor [${chunk.id}] (p.${chunk.pageNumber}, sec: ${chunk.section}):`);
    console.log(`  DB Snippet: "${testSnippet}..."`);
    console.log(`  Found on PDF page ${targetPage?.pageNumber}? ${isMatch ? "YES (MATCH)" : "NO (MISMATCH)"}`);
    if (!isMatch) {
      console.log(`  Page ${chunk.pageNumber} sample text: "${pageText.slice(0, 150).replace(/\s+/g, ' ')}..."`);
    }
  }

  console.log(`\n====================================================================================================`);
  console.log(`FINAL CITATION GROUND-TRUTH AUDIT TABLE:`);
  console.table(resultsTable);
}

main().catch(console.error).finally(() => prisma.$disconnect());
