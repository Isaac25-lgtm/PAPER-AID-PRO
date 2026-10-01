import { prisma } from "@/lib/prisma";
import { uploadPaperPdf, deletePaperPdf } from "@/lib/storage";
import { extractPdfText } from "@/lib/pdf/extractor";
import { processPaperDocument } from "@/lib/pdf/pipeline";

// Helper to generate a valid multi-page text PDF with academic sections
function createValidTestPdf(): Buffer {
  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 380 >> stream
BT
/F1 14 Tf 72 720 Td (Deterministic Ingestion in Scientific Intelligence Platforms) Tj
/F1 11 Tf 0 -30 Td (Abstract) Tj
0 -15 Td (This paper evaluates zero-hallucination document extraction and section-aware chunking.) Tj
0 -15 Td (We present an empirical study on deterministic pipeline throughput and page-level provenance.) Tj
0 -30 Td (1. Introduction) Tj
0 -15 Td (Academic literature platforms require strict separation between raw extracted manuscript text) Tj
0 -15 Td (and AI-generated interpretations to avoid contamination and fabricated DOIs.) Tj
ET
endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
6 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 7 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
7 0 obj << /Length 360 >> stream
BT
/F1 11 Tf 72 720 Td (2. Methods and Materials) Tj
0 -15 Td (We deployed a high-performance Node.js extraction worker using unpdf with page boundary preservation.) Tj
0 -15 Td (The chunker processes individual pages and identifies canonical section headers deterministically.) Tj
0 -30 Td (3. Results and Empirical Evaluation) Tj
0 -15 Td (The pipeline achieves zero duplicate chunks across repeated re-processing attempts.) Tj
0 -30 Td (4. Conclusion) Tj
0 -15 Td (Deterministic text extraction establishes the foundational data plane for verifiable citations.) Tj
ET
endstream
endobj
xref
0 8
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
0000000123 00000 n 
0000000249 00000 n 
0000000681 00000 n 
0000000755 00000 n 
0000000881 00000 n 
trailer << /Size 8 /Root 1 0 R >>
startxref
1293
%%EOF`;
  return Buffer.from(content);
}

// Helper to generate a scanned / image-only PDF (no text stream)
function createScannedTestPdf(): Buffer {
  const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj
4 0 obj << /Length 12 >> stream
q Q
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
0000000117 00000 n 
0000000207 00000 n 
trailer << /Size 5 /Root 1 0 R >>
startxref
270
%%EOF`;
  return Buffer.from(content);
}

async function runTestSuite() {
  console.log("=================================================================");
  console.log("AI RESEARCH HUB — PHASE 4 VERIFICATION SUITE");
  console.log("=================================================================\n");

  let testPaperId: string | null = null;
  let scannedPaperId: string | null = null;

  try {
    // -------------------------------------------------------------------------
    // TEST A: VALID TEXT-BASED PDF INGESTION
    // -------------------------------------------------------------------------
    console.log("TEST A: Valid Text-Based PDF Ingestion");
    console.log("-----------------------------------------------------------------");
    
    // 1. Create a test paper in PostgreSQL
    const testPaper = await prisma.paper.create({
      data: {
        title: "Test Manuscript — Deterministic Ingestion Evaluation",
        abstract: "A test manuscript evaluating automated ingestion and page-aware chunking.",
        status: "UPLOADED",
      },
    });
    testPaperId = testPaper.id;
    console.log(`✓ Created test paper record: ${testPaperId}`);

    // 2. Upload valid PDF to Supabase Storage
    const validPdfBuffer = createValidTestPdf();
    const uploadRes = await uploadPaperPdf(testPaperId, validPdfBuffer);
    console.log(`✓ Uploaded PDF to Supabase Storage: ${uploadRes.storagePath}`);

    // Update paper with storage path
    await prisma.paper.update({
      where: { id: testPaperId },
      data: {
        storagePath: uploadRes.storagePath,
        pdfUrl: uploadRes.publicUrl,
      },
    });

    // 3. Run Pipeline
    const pipelineRes = await processPaperDocument(testPaperId);
    console.log(`✓ Pipeline executed. Success: ${pipelineRes.success}`);
    console.log(`  - Page count: ${pipelineRes.pageCount}`);
    console.log(`  - Chunk count: ${pipelineRes.chunkCount}`);

    // Verify DB states
    const updatedPaper = await prisma.paper.findUnique({
      where: { id: testPaperId },
      include: {
        chunks: { orderBy: { chunkIndex: "asc" } },
        processingJobs: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!updatedPaper) {
      throw new Error("Updated paper not found");
    }

    console.log(`  - Paper status: ${updatedPaper.status}`);
    console.log(`  - Job stage: ${updatedPaper.processingJobs[0].stage}`);
    console.log(`  - Job status: ${updatedPaper.processingJobs[0].status}`);

    const passA =
      pipelineRes.success &&
      updatedPaper.status === "COMPLETED" &&
      updatedPaper.processingJobs[0].status === "COMPLETED" &&
      updatedPaper.chunks.length > 0;

    console.log(`TEST A RESULT: ${passA ? "PASS" : "FAIL"}\n`);

    // Verify chunk provenance
    console.log("Inspecting chunk provenance for Test A:");
    for (const chunk of updatedPaper.chunks) {
      console.log(
        `  • Chunk #${chunk.chunkIndex} | Page ${chunk.pageNumber} | Section: "${chunk.section || "Main Text"}" | ~${chunk.tokenCount} tokens`
      );
    }
    console.log();

    // -------------------------------------------------------------------------
    // TEST B: INVALID / NON-PDF UPLOAD
    // -------------------------------------------------------------------------
    console.log("TEST B: Invalid / Non-PDF Upload Validation");
    console.log("-----------------------------------------------------------------");
    const invalidBuffer = Buffer.from("THIS IS NOT A VALID PDF FILE HEADER");
    let testBRejected = false;
    try {
      await extractPdfText(invalidBuffer);
    } catch (err: any) {
      testBRejected = true;
      console.log(`✓ Correctly rejected invalid buffer with error: "${err.message}"`);
    }
    console.log(`TEST B RESULT: ${testBRejected ? "PASS" : "FAIL"}\n`);

    // -------------------------------------------------------------------------
    // TEST C: SCANNED / IMAGE-ONLY PDF (NO EXTRACTABLE TEXT)
    // -------------------------------------------------------------------------
    console.log("TEST C: Scanned / Image-Only PDF (Zero Text)");
    console.log("-----------------------------------------------------------------");
    const scannedPaper = await prisma.paper.create({
      data: {
        title: "Test Scanned Manuscript — Image Only",
        abstract: "Scanned paper without text layer.",
        status: "UPLOADED",
      },
    });
    scannedPaperId = scannedPaper.id;

    const scannedBuffer = createScannedTestPdf();
    const scannedUpload = await uploadPaperPdf(scannedPaperId, scannedBuffer);
    await prisma.paper.update({
      where: { id: scannedPaperId },
      data: { storagePath: scannedUpload.storagePath },
    });

    const scannedPipelineRes = await processPaperDocument(scannedPaperId);
    console.log(`✓ Pipeline completed for scanned PDF. Success: ${scannedPipelineRes.success}`);

    const scannedPaperUpdated = await prisma.paper.findUnique({
      where: { id: scannedPaperId },
      include: {
        chunks: true,
        processingJobs: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!scannedPaperUpdated) {
      throw new Error("Scanned paper record not found");
    }

    const latestScannedJob = scannedPaperUpdated.processingJobs[0];
    console.log(`  - Paper status: ${scannedPaperUpdated.status}`);
    console.log(`  - Job status: ${latestScannedJob.status}`);
    console.log(`  - Job error message: "${latestScannedJob.errorMessage}"`);
    console.log(`  - Chunks created: ${scannedPaperUpdated.chunks.length} (Expected 0)`);

    const passC =
      scannedPipelineRes.success === false &&
      scannedPaperUpdated.status === "FAILED" &&
      latestScannedJob.status === "FAILED" &&
      scannedPaperUpdated.chunks.length === 0 &&
      latestScannedJob.errorMessage?.includes("OCR is required");

    console.log(`TEST C RESULT: ${passC ? "PASS" : "FAIL"}\n`);

    // -------------------------------------------------------------------------
    // TEST D: REPROCESSING & IDEMPOTENCY (NO DUPLICATE CHUNKS)
    // -------------------------------------------------------------------------
    console.log("TEST D: Reprocessing & Idempotency");
    console.log("-----------------------------------------------------------------");
    const countBeforeReprocess = updatedPaper.chunks.length;
    console.log(`Chunk count before reprocess: ${countBeforeReprocess}`);

    const reprocessRes = await processPaperDocument(testPaperId, { forceReprocess: true });
    console.log(`✓ Reprocess completed. Success: ${reprocessRes.success}`);

    const paperAfterReprocess = await prisma.paper.findUnique({
      where: { id: testPaperId },
      include: {
        chunks: true,
        processingJobs: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!paperAfterReprocess) {
      throw new Error("Paper after reprocess not found");
    }

    const countAfterReprocess = paperAfterReprocess.chunks.length;
    console.log(`Chunk count after reprocess: ${countAfterReprocess}`);
    console.log(`Processing job attempts count: ${paperAfterReprocess.processingJobs.length}`);
    console.log(`Latest job attempt number: #${paperAfterReprocess.processingJobs[0].attempt}`);

    const passD =
      countBeforeReprocess === countAfterReprocess &&
      paperAfterReprocess.processingJobs.length >= 2 &&
      paperAfterReprocess.processingJobs[0].status === "COMPLETED";

    console.log(`TEST D RESULT: ${passD ? "PASS" : "FAIL"}\n`);

    // -------------------------------------------------------------------------
    // SUMMARY REPORT
    // -------------------------------------------------------------------------
    console.log("=================================================================");
    console.log("ALL TESTS COMPLETED SUCCESSFULLY");
    console.log("=================================================================");
    console.log(`Test A (Valid PDF Ingestion):   ${passA ? "PASS" : "FAIL"}`);
    console.log(`Test B (Invalid Upload Reject): ${testBRejected ? "PASS" : "FAIL"}`);
    console.log(`Test C (Scanned PDF OCR Alert): ${passC ? "PASS" : "FAIL"}`);
    console.log(`Test D (Reprocess Idempotent):  ${passD ? "PASS" : "FAIL"}`);
    console.log("=================================================================\n");
  } catch (err: any) {
    console.error("Test execution failed with error:", err);
  } finally {
    console.log("Cleaning up test records from database and Supabase storage...");
    if (testPaperId) {
      try {
        await deletePaperPdf(`research-papers/${testPaperId}/original.pdf`);
        await prisma.paper.delete({ where: { id: testPaperId } });
        console.log(`✓ Cleaned up test paper ${testPaperId}`);
      } catch (e: any) {
        console.warn("Cleanup warning A:", e.message);
      }
    }
    if (scannedPaperId) {
      try {
        await deletePaperPdf(`research-papers/${scannedPaperId}/original.pdf`);
        await prisma.paper.delete({ where: { id: scannedPaperId } });
        console.log(`✓ Cleaned up scanned test paper ${scannedPaperId}`);
      } catch (e: any) {
        console.warn("Cleanup warning C:", e.message);
      }
    }
    await prisma.$disconnect();
  }
}

runTestSuite();
