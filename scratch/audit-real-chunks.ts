import "./load-env";
import { prisma } from "../src/lib/prisma";
import { downloadPaperPdf } from "../src/lib/storage";
import { extractPdfText } from "../src/lib/pdf/extractor";

async function main() {
  // Let's audit 3 real papers:
  // 1. Magnuska et al. (cmumgtiix0000vr445cn8ry7o)
  // 2. Kim et al. (cmunwm6m2004ivrusrlr89j95)
  // 3. Li et al. (cmunxw9il00dnvrus7w9mqij9)
  // 4. Su et al. (cmunotrr10000vrusnqyv61ut)
  // 5. Zakareya et al. (cmunwvfkr006uvrus0m3ky4wn)

  const papersToAudit = [
    "cmumgtiix0000vr445cn8ry7o",
    "cmunwm6m2004ivrusrlr89j95",
    "cmunxw9il00dnvrus7w9mqij9",
    "cmunotrr10000vrusnqyv61ut",
    "cmunwvfkr006uvrus0m3ky4wn"
  ];

  const results: Array<{
    claimContext: string;
    paperId: string;
    paperTitle: string;
    chunkId: string;
    chunkIndex: number;
    dbPage: number;
    dbSection: string;
    pdfPageVerified: number;
    snippetMatch: string;
    result: "MATCH" | "MISMATCH";
    dbSnippet: string;
  }> = [];

  for (const pid of papersToAudit) {
    const paper = await prisma.paper.findUnique({
      where: { id: pid },
      select: { id: true, title: true, storagePath: true }
    });

    if (!paper || !paper.storagePath) continue;

    console.log(`\nFetching PDF for paper [${paper.id}] "${paper.title.slice(0, 50)}"...`);
    const pdfBuf = await downloadPaperPdf(paper.storagePath);
    const pdfData = await extractPdfText(pdfBuf);

    // Pick 2-3 prominent chunks from Methods, Results, Discussion, Conclusion
    const chunks = await prisma.paperChunk.findMany({
      where: {
        paperId: pid,
        section: { in: ["Methods", "Results", "Discussion", "Conclusion", "Introduction"] },
        pageNumber: { not: null }
      },
      orderBy: { chunkIndex: "asc" },
      take: 2
    });

    for (const ch of chunks) {
      const dbPage = ch.pageNumber!;
      const targetPage = pdfData.pages.find(p => p.pageNumber === dbPage);
      const pageText = (targetPage?.text || "").replace(/\s+/g, " ");

      const normalizedChunk = ch.text.replace(/\s+/g, " ").trim();
      const snippet = normalizedChunk.slice(0, 60);

      const isMatch = pageText.includes(snippet);

      // If not on dbPage, search which page it's actually on
      let actualPage = targetPage?.pageNumber || 0;
      if (!isMatch) {
        for (const p of pdfData.pages) {
          if (p.text.replace(/\s+/g, " ").includes(snippet)) {
            actualPage = p.pageNumber;
            break;
          }
        }
      }

      results.push({
        claimContext: `${ch.section} excerpt on p.${dbPage}`,
        paperId: paper.id,
        paperTitle: paper.title.slice(0, 35) + "...",
        chunkId: ch.id,
        chunkIndex: ch.chunkIndex,
        dbPage,
        dbSection: ch.section || "N/A",
        pdfPageVerified: actualPage,
        snippetMatch: isMatch ? "YES" : "NO",
        result: isMatch ? "MATCH" : "MISMATCH",
        dbSnippet: snippet
      });

      console.log(`  Chunk [${ch.id}] idx=${ch.chunkIndex} DB page=${dbPage} section=${ch.section}:`);
      console.log(`    Snippet: "${snippet}..."`);
      console.log(`    Result: ${isMatch ? "MATCH (on PDF page " + dbPage + ")" : "MISMATCH (found on PDF page " + actualPage + ")"}`);
    }
  }

  console.log(`\n====================================================================================================`);
  console.log(`FINAL AUDIT RESULTS TABLE (${results.length} ANCHORS ACROSS ${papersToAudit.length} REAL PAPERS):`);
  console.table(results.map(r => ({
    paper: r.paperTitle,
    chunkId: r.chunkId,
    dbPage: r.dbPage,
    dbSection: r.dbSection,
    pdfPageVerified: r.pdfPageVerified,
    snippetMatch: r.snippetMatch,
    result: r.result
  })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
