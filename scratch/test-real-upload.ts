import "dotenv/config";
import { uploadPaperPdf, downloadPaperPdf, getPaperPdfUrl } from "../src/lib/storage";
import { processPaperDocument } from "../src/lib/pdf/pipeline";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("=== TESTING REAL PDF UPLOAD & INGESTION ===");
  // Create a minimal valid PDF with actual text content
  // A simple 1-page PDF structure with stream
  const minimalPdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 720 >> stream
BT
/F1 12 Tf
72 712 Td
(Abstract) Tj
0 -20 Td
(This clinical study evaluates the diagnostic efficacy of non-invasive biomarkers in endometriosis.) Tj
0 -20 Td
(Introduction) Tj
0 -20 Td
(Endometriosis affects approximately 10 percent of reproductive-aged women globally, causing severe chronic pain.) Tj
0 -20 Td
(Methods) Tj
0 -20 Td
(A prospective cohort of 250 patients underwent laparoscopic confirmation alongside serum microRNA profiling.) Tj
0 -20 Td
(Results) Tj
0 -20 Td
(Serum miR-451 and miR-125b exhibited 91.5 percent sensitivity and 88.0 percent specificity in detecting stage III-IV lesions.) Tj
0 -20 Td
(Limitations) Tj
0 -20 Td
(The cohort was limited to a single medical center and requires validation across diverse ethnic demographics.) Tj
0 -20 Td
(Conclusion) Tj
0 -20 Td
(Circulating microRNAs offer significant promise for non-invasive early diagnosis of deep infiltrating endometriosis.) Tj
ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000001038 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
1119
%%EOF`;

  const buffer = Buffer.from(minimalPdf);
  console.log("PDF buffer size:", buffer.length);

  const testPaperId = "cmugxsj280000vrpontgz0vlf"; // ENDOMETRIOSIS
  console.log("Uploading PDF for paper:", testPaperId);
  const uploadResult = await uploadPaperPdf(testPaperId, buffer);
  console.log("Upload result:", uploadResult);

  console.log("Updating paper in DB with storagePath & pdfUrl...");
  await prisma.paper.update({
    where: { id: testPaperId },
    data: {
      storagePath: uploadResult.storagePath,
      pdfUrl: uploadResult.publicUrl,
      status: "PROCESSING",
    },
  });

  console.log("Running processPaperDocument pipeline...");
  const pipelineResult = await processPaperDocument(testPaperId);
  console.log("Pipeline result:", pipelineResult);

  const updated = await prisma.paper.findUnique({
    where: { id: testPaperId },
    include: { chunks: true, processingJobs: true },
  });
  console.log(`Updated Paper status: ${updated?.status}`);
  console.log(`Chunks count: ${updated?.chunks.length}`);
  console.log(`Jobs count: ${updated?.processingJobs.length}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
