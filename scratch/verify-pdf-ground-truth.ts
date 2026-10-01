import "./load-env";
import { prisma } from "../src/lib/prisma";
import { downloadPaperPdf } from "../src/lib/storage";
import { extractPdfText } from "../src/lib/pdf/extractor";

interface VerificationItem {
  claim: string;
  paperId: string;
  paperTitle: string;
  chunkId: string;
  expectedDbPage: number;
  expectedDbSection: string;
  keyPhrase: string; // Verbatim phrase from chunk to locate on PDF page
}

async function main() {
  console.log("====================================================================================================");
  console.log("PHASE 8.1 — SECTION 14: ORIGINAL PDF GROUND-TRUTH AUDIT");
  console.log("====================================================================================================\n");

  const items: VerificationItem[] = [
    // 1. Paper 1: Magnuska et al. (Methods, p. 14)
    {
      claim: "Three best-performing breast lesion classification models evaluated by accuracy, sensitivity, specificity and AUROC",
      paperId: "cmumgtiix0000vr445cn8ry7o",
      paperTitle: "Influence of CAD System Design on Breast Cancer Classification",
      chunkId: "cmumgu5fb002pvr44qni8eswc",
      expectedDbPage: 14,
      expectedDbSection: "Methods",
      keyPhrase: "Breast Lesion Classification Using Image-Based Features The three best-performing breast lesion classification models"
    },
    // 2. Paper 1: Magnuska et al. (Discussion, p. 16)
    {
      claim: "LE as a supporting score for IoU is beneficial for lesion analysis",
      paperId: "cmumgtiix0000vr445cn8ry7o",
      paperTitle: "Influence of CAD System Design on Breast Cancer Classification",
      chunkId: "cmumgu5fa0024vr44j7b0849l",
      expectedDbPage: 16,
      expectedDbSection: "Discussion",
      keyPhrase: "Our findings suggest that using LE as a supporting score for IoU is beneficial"
    },
    // 3. Paper 1: Magnuska et al. (Conclusion / Limitations, p. 18)
    {
      claim: "Small dataset may limit conclusions and some cases were missing in second data pool",
      paperId: "cmumgtiix0000vr445cn8ry7o",
      paperTitle: "Influence of CAD System Design on Breast Cancer Classification",
      chunkId: "cmumgu5fb0035vr44i816sqko",
      expectedDbPage: 18,
      expectedDbSection: "Conclusion",
      keyPhrase: "Finally, we would like to mention the limitations of our study. The main limitation is the relatively small dataset"
    },
    // 4. Paper 2: Kim et al. (Introduction, p. 1)
    {
      claim: "CAD systems using machine learning classify breast lesions based on extracted ultrasound features",
      paperId: "cmunwm6m2004ivrusrlr89j95",
      paperTitle: "Classification for Breast Ultrasound Using CNN with Multiple Feature Maps",
      chunkId: "cmunwmok5005gvrus8xz5ognc",
      expectedDbPage: 1,
      expectedDbSection: "Introduction",
      keyPhrase: "computer-aided diagnosis (CAD) systems using machine learning (ML) algorithms have been actively developed to classify breast lesions"
    },
    // 5. Paper 2: Kim et al. (Introduction, p. 1)
    {
      claim: "Ultrasound is one of the most common medical imaging modalities for breast examination",
      paperId: "cmunwm6m2004ivrusrlr89j95",
      paperTitle: "Classification for Breast Ultrasound Using CNN with Multiple Feature Maps",
      chunkId: "cmunwmok5005dvrussg0gt6vb",
      expectedDbPage: 1,
      expectedDbSection: "Introduction",
      keyPhrase: "convolutional neural network (CNN) using multiple time-domain feature maps was proposed to classify breast lesions"
    },
    // 6. Paper 3: Li et al. (Methods, p. 2)
    {
      claim: "Operator-dependent nature of breast cancer ultrasound can lead to misdetection due to fatigue and lack of attentiveness",
      paperId: "cmunxw9il00dnvrus7w9mqij9",
      paperTitle: "Application of Multimodal Ultrasound in BI-RADS Category 4",
      chunkId: "cmunxwl2x00e9vrusxf4o59r6",
      expectedDbPage: 2,
      expectedDbSection: "Methods",
      keyPhrase: "operator-dependent nature of the method, in addition to subjective elements such as fatigue and a lack of attentiveness, might lead to misdetection"
    },
    // 7. Paper 3: Li et al. (Results, p. 4)
    {
      claim: "Enhanced area of the lesion expands compared with two-dimensional ultrasound",
      paperId: "cmunxw9il00dnvrus7w9mqij9",
      paperTitle: "Application of Multimodal Ultrasound in BI-RADS Category 4",
      chunkId: "cmunxwl2z00ewvrus5w4v5y6k",
      expectedDbPage: 4,
      expectedDbSection: "Results",
      keyPhrase: "enhanced area of the lesion expands compared with that of two-dimensional ultrasound"
    },
    // 8. Paper 4: Su et al. (Conclusion / Limitations, p. 10)
    {
      claim: "Study has several limitations: single-center, retrospective design, and small sample size",
      paperId: "cmunotrr10000vrusnqyv61ut",
      paperTitle: "Multimodal Ultrasound Radiomics in Superficial Lymph Node TB",
      chunkId: "cmunou2gs001mvrus0x7un1ic",
      expectedDbPage: 10,
      expectedDbSection: "Conclusion",
      keyPhrase: "This study has several limitations: (1) it was a single- center, retrospective study, and the sample size was relatively small"
    },
    // 9. Paper 5: Zakareya et al. (Introduction, p. 1)
    {
      claim: "Medical image data related to diseases is scarce and deep learning models require balanced representations",
      paperId: "cmunwvfkr006uvrus0m3ky4wn",
      paperTitle: "Deep-Learning-Based Model for Breast Cancer Diagnosis from Medical Images",
      chunkId: "cmunwvp49007gvrushyp4ptwu",
      expectedDbPage: 1,
      expectedDbSection: "Introduction",
      keyPhrase: "Most of the data related to diseases is scarce. On the other hand, the deep learning model requires more data"
    }
  ];

  // Group by paper to cache PDF downloads
  const uniquePaperIds = Array.from(new Set(items.map(i => i.paperId)));
  const pdfMap = new Map<string, any>();

  for (const pid of uniquePaperIds) {
    const paper = await prisma.paper.findUnique({
      where: { id: pid },
      select: { id: true, title: true, storagePath: true }
    });
    if (!paper || !paper.storagePath) throw new Error(`Paper ${pid} missing storagePath`);
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
    result: string;
  }> = [];

  for (const item of items) {
    const chunk = await prisma.paperChunk.findUnique({
      where: { id: item.chunkId }
    });
    if (!chunk) {
      console.error(`Chunk ${item.chunkId} not found!`);
      continue;
    }

    const pdf = pdfMap.get(item.paperId);
    const targetPage = pdf.pages.find((p: any) => p.pageNumber === chunk.pageNumber);
    const normalizedPageText = (targetPage?.text || "").replace(/\s+/g, " ");
    const normalizedKeyPhrase = item.keyPhrase.replace(/\s+/g, " ");

    const matchesOnDbPage = normalizedPageText.includes(normalizedKeyPhrase);

    // Also check if found on another page
    let foundPage = targetPage?.pageNumber || 0;
    if (!matchesOnDbPage) {
      for (const p of pdf.pages) {
        if (p.text.replace(/\s+/g, " ").includes(normalizedKeyPhrase)) {
          foundPage = p.pageNumber;
          break;
        }
      }
    }

    const result = matchesOnDbPage ? "MATCH" : "MISMATCH";

    tableData.push({
      claim: item.claim.slice(0, 40) + "...",
      paper: item.paperTitle.slice(0, 25) + "...",
      chunkId: chunk.id,
      dbPage: chunk.pageNumber || 0,
      dbSection: chunk.section || "N/A",
      pdfPageVerified: matchesOnDbPage ? chunk.pageNumber! : foundPage,
      snippetMatch: matchesOnDbPage ? "MATCH" : "MISMATCH",
      result
    });

    console.log(`\nAudit Anchor [${chunk.id}] (${item.paperTitle}):`);
    console.log(`  DB Page: ${chunk.pageNumber}, DB Section: ${chunk.section}`);
    console.log(`  Key Phrase: "${item.keyPhrase.slice(0, 70)}..."`);
    console.log(`  Found on PDF Page ${chunk.pageNumber}: ${matchesOnDbPage ? "YES (MATCH)" : "NO (MISMATCH, found on p." + foundPage + ")"}`);
  }

  console.log("\n====================================================================================================");
  console.log("FINAL CITATION GROUND-TRUTH AUDIT TABLE (8+ ANCHORS ACROSS >=3 REAL PDFs):");
  console.log("====================================================================================================");
  console.table(tableData);
}

main().catch(console.error).finally(() => prisma.$disconnect());
