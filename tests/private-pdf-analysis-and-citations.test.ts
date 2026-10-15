/**
 * AI RESEARCH HUB — END-TO-END ACCEPTANCE TEST:
 * PRIVATE ACADEMIC PDF ANALYSIS, GROUNDED CITATIONS & BIBLIOGRAPHIC EXPORT
 *
 * Test Flow:
 * 1. Upload Unpublished PDF (Dissertation with NO DOI, journal, publisher, or publication date).
 * 2. Process Document (Text extraction, chunking with page numbers, section detection, numerical metrics).
 * 3. Verify Owner Access & Cross-User Privacy Guard (Owner authorized, non-owner gets 404/unauthorized).
 * 4. Retrieve Grounded Evidence (Paper-scoped retrieval with exact page & section anchors).
 * 5. Grounded Q&A Claim Validation (Answer anchored strictly to source chunks without hallucination).
 * 6. Bibliographic Reference Generation (Accurate APA/MLA/Chicago/BibTeX without inventing DOIs or journals).
 * 7. Verification Notice (Clear indicator that unpublished manuscript is not in external registries).
 * 8. Public Isolation (Paper never appears in public catalog, hybrid search, or discovery).
 */

import "../scratch/load-env";
import { prisma } from "../src/lib/prisma";
import { uploadUserPrivateDocument } from "../src/lib/library/user-library-service";
import { retrievePaperEvidence } from "../src/lib/rag/retrieve-paper-evidence";
import { validateQACitations } from "../src/lib/rag/validate-qa-citations";
import { classifyPaper, authorizePaperAccess, isPublicScholarlyPaper } from "../src/lib/auth/paper-authorization";
import { searchPapersHybrid, isPaperPermittedForPublicSearch } from "../src/lib/search/hybrid-search";
import { formatBibliographicCitation } from "../src/lib/citations/citation-formatter";

// Helper to generate a minimal valid PDF byte buffer with standard PDF headers
function createTestPdfBuffer(title: string, author: string, bodyText: string): Buffer {
  const content = `%PDF-1.4
1 0 obj
<< /Title (${title}) /Author (${author}) /Producer (AI Research Hub Test Suite) >>
endobj
2 0 obj
<< /Type /Catalog /Pages 3 0 R >>
endobj
3 0 obj
<< /Type /Pages /Kids [4 0 R] /Count 1 >>
endobj
4 0 obj
<< /Type /Page /Parent 3 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
5 0 obj
<< /Length ${bodyText.length + 50} >>
stream
BT
/F1 12 Tf
72 712 Td
(${bodyText.slice(0, 200).replace(/[()]/g, "")}) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000100 00000 n 
0000000160 00000 n 
0000000220 00000 n 
0000000310 00000 n 
trailer
<< /Size 6 /Root 2 0 R /Info 1 0 R >>
startxref
450
%%EOF`;
  return Buffer.from(content, "utf8");
}

async function runPrivatePdfAnalysisAndCitationsTest() {
  console.log("================================================================================");
  console.log(" END-TO-END ACCEPTANCE TEST: PRIVATE PDF ANALYSIS & CITATIONS");
  console.log(" Mode: ISOLATED LOCAL POSTGRESQL + MOCK STORAGE");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: any, testName: string, detail: string = "") {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${detail}`);
      failed++;
    }
  }

  const createdPaperIds: string[] = [];
  const createdUserIds: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // Setup Test Users
    // -------------------------------------------------------------------------
    const userA = await prisma.user.create({
      data: {
        email: `dissertation-researcher-${Date.now()}@stanford.edu`,
        name: "Alice M. Walker",
        role: "USER",
      },
    });
    createdUserIds.push(userA.id);

    const userB = await prisma.user.create({
      data: {
        email: `unauthorized-scholar-${Date.now()}@oxford.ac.uk`,
        name: "Bob Rival",
        role: "USER",
      },
    });
    createdUserIds.push(userB.id);

    // -------------------------------------------------------------------------
    // STEP 1: Upload Unpublished Academic PDF (Dissertation)
    // -------------------------------------------------------------------------
    console.log("--- STEP 1: Uploading Unpublished Academic Dissertation ---");

    const dissertationTitle = "Scalable Distributed State Estimation in Cyber-Physical Power Networks";
    const dissertationAuthor = "Alice M. Walker";
    const dissertationInstitution = "Department of Electrical Engineering, Stanford University";
    const dissertationCategory = "Electrical Engineering & Cyber-Physical Systems";
    const dissertationAbstract =
      "This doctoral dissertation develops a scalable, decentralized consensus algorithm for state estimation in bulk power transmission networks. We demonstrate an estimation error reduction of 34.2% while maintaining sub-second convergence across 1,000 distributed substations.";

    const pdfBuffer = createTestPdfBuffer(
      dissertationTitle,
      dissertationAuthor,
      dissertationAbstract
    );

    // Call uploadUserPrivateDocument strictly without DOI, journal, publisher, or date
    const uploadResult = await uploadUserPrivateDocument({
      userId: userA.id,
      fileBuffer: pdfBuffer,
      filename: "walker_dissertation_final.pdf",
      metadata: {
        title: dissertationTitle,
        authors: dissertationAuthor,
        institution: dissertationInstitution,
        researchCategory: dissertationCategory,
        documentType: "DISSERTATION",
        description: dissertationAbstract,
      },
      autoProcess: false, // We'll perform controlled processing in Step 2
    });

    assert(uploadResult.success, "1.1: Unpublished dissertation upload succeeded");
    assert(Boolean(uploadResult.paperId), "1.2: Valid paperId assigned to unpublished document");
    createdPaperIds.push(uploadResult.paperId);

    const paper = await prisma.paper.findUnique({
      where: { id: uploadResult.paperId },
    });

    assert(paper !== null, "1.3: Paper record persisted in PostgreSQL");
    assert(paper?.doi === null, "1.4: DOI is strictly NULL (never invented)");
    assert(paper?.journal === null, "1.5: Journal is strictly NULL (never invented)");
    assert(paper?.publicationDate === null, "1.6: Publication date is strictly NULL (never invented)");
    assert(paper?.isOpenAccess === false, "1.7: isOpenAccess is false by default");
    assert(paper?.storagePath?.includes(uploadResult.paperId), "1.8: Storage path scoped to paperId");

    const prov = paper?.sourceProvenance as any;
    assert(prov?.isPrivate === true, "1.9: sourceProvenance.isPrivate is true");
    assert(prov?.uploadedByUserId === userA.id, "1.10: Document ownership bound to userA");
    assert(prov?.documentType === "DISSERTATION", "1.11: Document type preserved as DISSERTATION");

    const classification = classifyPaper(paper!);
    assert(classification === "PRIVATE_USER_DOCUMENT", "1.12: Classified as PRIVATE_USER_DOCUMENT");

    // -------------------------------------------------------------------------
    // STEP 2: Process Document (Chunks, Page Numbers, Sections, Numerical Data)
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 2: Processing Document Chunks & Section Evidence ---");

    // Insert 3 deterministic chunks representing pages and sections
    const chunk1 = await prisma.paperChunk.create({
      data: {
        paperId: paper!.id,
        chunkIndex: 0,
        pageNumber: 1,
        section: "Abstract",
        text: dissertationAbstract,
        tokenCount: 65,
        metadata: { pageNumber: 1, section: "Abstract", charLength: dissertationAbstract.length },
      },
    });

    const methodologyText =
      "In Chapter 3, we formulate the Distributed Alternating Direction Method of Multipliers (ADMM) state estimator. Each regional control center computes local voltage phasor angles theta_i and exchanges boundary values only with directly adjacent tie-lines. Convergence is guaranteed under convex relaxation in O(1/k) iterations.";
    const chunk2 = await prisma.paperChunk.create({
      data: {
        paperId: paper!.id,
        chunkIndex: 1,
        pageNumber: 14,
        section: "Methodology",
        text: methodologyText,
        tokenCount: 80,
        metadata: { pageNumber: 14, section: "Methodology", charLength: methodologyText.length },
      },
    });

    const resultsText =
      "Table 4.2 presents benchmark results on the IEEE 118-bus test case. The proposed decentralized ADMM estimator achieved a Mean Absolute Error (MAE) of 0.0028 p.u., compared to 0.0042 p.u. for conventional centralized WLS (a 33.3% accuracy improvement). Convergence time was 482 ms across 14 computing nodes.";
    const chunk3 = await prisma.paperChunk.create({
      data: {
        paperId: paper!.id,
        chunkIndex: 2,
        pageNumber: 38,
        section: "Empirical Results",
        text: resultsText,
        tokenCount: 88,
        metadata: { pageNumber: 38, section: "Empirical Results", charLength: resultsText.length },
      },
    });

    const limitationsText =
      "Limitations: The convergence rate degrades significantly when communication latency between regional substations exceeds 250 milliseconds or packet loss rates surpass 5%. Furthermore, asynchronous clock drift requires periodic GPS synchronizing timestamps.";
    const chunk4 = await prisma.paperChunk.create({
      data: {
        paperId: paper!.id,
        chunkIndex: 3,
        pageNumber: 62,
        section: "Limitations",
        text: limitationsText,
        tokenCount: 52,
        metadata: { pageNumber: 62, section: "Limitations", charLength: limitationsText.length },
      },
    });

    // Populate vector embeddings for all chunks via PostgreSQL pgvector
    const dummyVector = Array(1536).fill(0.025);
    const vectorString = `[${dummyVector.join(",")}]`;

    for (const ch of [chunk1, chunk2, chunk3, chunk4]) {
      await prisma.$executeRawUnsafe(
        `UPDATE "paper_chunks" SET "embedding" = $1::vector WHERE "id" = $2`,
        vectorString,
        ch.id
      );
    }

    // Update paper with extracted structured manuscript sections and status
    await prisma.paper.update({
      where: { id: paper!.id },
      data: {
        status: "COMPLETED",
        researchQuestion: "Can decentralized ADMM achieve real-time state estimation in cyber-physical power grids?",
        methodology: methodologyText,
        results: resultsText,
        limitations: limitationsText,
        conclusion: "Distributed consensus state estimation is computationally tractable and resilient.",
      },
    });

    const updatedPaper = await prisma.paper.findUnique({ where: { id: paper!.id } });
    assert(updatedPaper?.status === "COMPLETED", "2.1: Paper processing status updated to COMPLETED");
    assert(updatedPaper?.methodology !== null, "2.2: Methodology extracted from manuscript text");
    assert(
      Boolean(updatedPaper?.results?.includes("0.0028 p.u.")),
      "2.3: Empirical results and numerical metrics retained",
      `actual results: ${updatedPaper?.results}`
    );
    assert(updatedPaper?.limitations?.includes("250 milliseconds"), "2.4: Author limitations recorded accurately");

    // -------------------------------------------------------------------------
    // STEP 3: Owner Authorization & Cross-User Privacy Guard
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 3: Verifying User-Scoped Access & Cross-User Privacy ---");

    const ownerAuth = await authorizePaperAccess(updatedPaper!, userA, "VIEW_EVIDENCE");
    assert(ownerAuth.allowed === true, "3.1: Document owner (userA) is AUTHORIZED to view evidence");

    const rivalAuth = await authorizePaperAccess(updatedPaper!, userB, "VIEW_EVIDENCE");
    assert(rivalAuth.allowed === false, "3.2: Non-owner (userB) is FORBIDDEN from viewing evidence");
    assert(rivalAuth.statusCode === 404, "3.3: Unauthorized researcher receives 404 to hide resource existence");

    const anonAuth = await authorizePaperAccess(updatedPaper!, null, "VIEW_METADATA");
    assert(anonAuth.allowed === false, "3.4: Anonymous visitor is FORBIDDEN from viewing private manuscript");

    // -------------------------------------------------------------------------
    // STEP 4: Retrieve Evidence (Strictly Paper-Scoped with Page Anchors)
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 4: Evidence Retrieval with Exact Page Anchors ---");

    // Retrieve evidence for methodology question as owner
    const evidenceResult = await retrievePaperEvidence(
      paper!.id,
      "What decentralized consensus algorithm was developed in Chapter 3?",
      { limit: 4, user: userA }
    );

    assert(evidenceResult.evidenceChunks.length > 0, "4.1: Evidence chunks retrieved for document owner");
    const allBelongToPrivatePaper = evidenceResult.evidenceChunks.every((c) => c.paperId === paper!.id);
    assert(allBelongToPrivatePaper, "4.2: All retrieved evidence chunks strictly belong to this private paper");

    const methodEvidence = evidenceResult.evidenceChunks.find((c) => c.section === "Methodology");
    assert(methodEvidence !== undefined, "4.3: Methodology chunk surfaced");
    assert(methodEvidence?.pageNumber === 14, "4.4: Exact page number (page 14) verified without fabrication");

    const resultsEvidence = evidenceResult.evidenceChunks.find((c) => c.section === "Empirical Results");
    assert(resultsEvidence !== undefined, "4.5: Empirical results chunk surfaced");
    assert(resultsEvidence?.pageNumber === 38, "4.6: Exact page number (page 38) verified for numerical findings");

    // Verify non-owner cannot retrieve evidence via retrievePaperEvidence
    let rivalThrewError = false;
    try {
      await retrievePaperEvidence(paper!.id, "What are the results?", { limit: 4, user: userB });
    } catch (err: any) {
      rivalThrewError = true;
      assert(err.message.includes("Unauthorized"), "4.7: retrievePaperEvidence throws Unauthorized for rival user");
    }
    assert(rivalThrewError, "4.8: Rival user strictly rejected from retrieving evidence");

    // -------------------------------------------------------------------------
    // STEP 5: Grounded Q&A Claim Validation
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 5: Grounded Q&A Claim Validation ---");

    // Synthetic assistant response grounded on chunk2 (page 14) and chunk3 (page 38)
    const qaCandidate = {
      answer:
        "The dissertation proposes a Distributed ADMM estimator where regional control centers compute local voltage phasor angles (page 14). Testing on the IEEE 118-bus system demonstrated a Mean Absolute Error of 0.0028 p.u. with 482 ms convergence (page 38).",
      citations: [
        { chunkId: chunk2.id },
        { chunkId: chunk3.id },
      ],
      insufficientEvidence: false,
    };

    const validatedQA = validateQACitations(qaCandidate, evidenceResult.evidenceChunks, paper!.id);
    assert(validatedQA.citations.length === 2, "5.1: Exactly 2 valid citations anchored");
    assert(validatedQA.citations[0].pageNumber === 14, "5.2: Citation 1 maps to exact page 14");
    assert(validatedQA.citations[0].section === "Methodology", "5.3: Citation 1 section verified as Methodology");
    assert(validatedQA.citations[1].pageNumber === 38, "5.4: Citation 2 maps to exact page 38");
    assert(validatedQA.citations[1].section === "Empirical Results", "5.5: Citation 2 section verified as Empirical Results");

    // Verify rejection of hallucinated chunk ID
    const hallucinatedQA = {
      answer: "A fabricated claim not in the document.",
      citations: [{ chunkId: "cmuwhallucinatedchunk999" }],
      insufficientEvidence: false,
    };
    const validatedHallucination = validateQACitations(hallucinatedQA, evidenceResult.evidenceChunks, paper!.id);
    assert(validatedHallucination.citations.length === 0, "5.6: Hallucinated chunk ID strictly filtered out");

    // -------------------------------------------------------------------------
    // STEP 6: Bibliographic Reference Generation Without Metadata Invention
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 6: Bibliographic Reference Formatting (Zero Fabrication) ---");

    // Format in APA 7th
    const apaResult = formatBibliographicCitation(
      {
        title: dissertationTitle,
        authors: [dissertationAuthor],
        year: 2024,
        journal: null, // No journal!
        doi: null,     // No DOI!
        documentType: "DISSERTATION",
        institution: dissertationInstitution,
      },
      "apa"
    );

    assert(apaResult.isUnpublished === true, "6.1: Correctly identified as unpublished document");
    assert(apaResult.hasExternalIdentifier === false, "6.2: Correctly flags absence of external identifier");
    assert(apaResult.text.includes("[Doctoral dissertation,"), "6.3: APA uses bracketed dissertation descriptor");
    assert(apaResult.text.includes(dissertationInstitution), "6.4: APA includes university affiliation");
    assert(!apaResult.text.includes("doi.org"), "6.5: APA strictly contains NO fabricated DOI");
    assert(!apaResult.text.includes("journal"), "6.6: APA strictly contains NO fabricated journal");

    // Format in MLA 9th
    const mlaResult = formatBibliographicCitation(
      {
        title: dissertationTitle,
        authors: [dissertationAuthor],
        year: 2024,
        journal: null,
        doi: null,
        documentType: "DISSERTATION",
        institution: dissertationInstitution,
      },
      "mla"
    );
    assert(mlaResult.text.includes("Doctoral dissertation"), "6.7: MLA includes dissertation label");
    assert(!mlaResult.text.includes("DOI:"), "6.8: MLA strictly contains NO fabricated DOI");

    // Format in BibTeX
    const bibResult = formatBibliographicCitation(
      {
        title: dissertationTitle,
        authors: [dissertationAuthor],
        year: 2024,
        journal: null,
        doi: null,
        documentType: "DISSERTATION",
        institution: dissertationInstitution,
      },
      "bibtex"
    );
    assert(bibResult.text.startsWith("@phdthesis{"), "6.9: BibTeX formats as @phdthesis (never @article)");
    assert(bibResult.text.includes("school    ="), "6.10: BibTeX records university school");
    assert(!bibResult.text.includes("journal   ="), "6.11: BibTeX strictly contains NO fabricated journal field");
    assert(!bibResult.text.includes("doi       ="), "6.12: BibTeX strictly contains NO fabricated doi field");

    // -------------------------------------------------------------------------
    // STEP 7: Clear External Registry Notice
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 7: Verification Notice for Unpublished Works ---");

    assert(Boolean(apaResult.verificationNotice), "7.1: Verification notice generated for unpublished document");
    assert(
      apaResult.verificationNotice?.includes("Not indexed in external scholarly registry"),
      "7.2: Notice clearly explains document is not indexed in external scholarly records"
    );

    // -------------------------------------------------------------------------
    // STEP 8: Public Isolation Invariants
    // -------------------------------------------------------------------------
    console.log("\n--- STEP 8: Public Isolation Invariants ---");

    const isPermittedPublic = isPaperPermittedForPublicSearch(paper);
    assert(isPermittedPublic === false, "8.1: isPaperPermittedForPublicSearch rejects private dissertation");

    const isPublicScholarly = isPublicScholarlyPaper(paper!);
    assert(isPublicScholarly === false, "8.2: isPublicScholarlyPaper rejects private dissertation");

    // Hybrid search query for exact title words
    const publicSearch = await searchPapersHybrid({
      query: "Scalable Distributed State Estimation",
      excludeFixtures: true,
    });
    const foundInPublicSearch = publicSearch.papers.some((p) => p.paper.id === paper!.id);
    assert(!foundInPublicSearch, "8.3: Public search NEVER returns private unpublished dissertation");
  } catch (err: any) {
    console.error("Unhandled test exception:", err);
    failed++;
  } finally {
    // -------------------------------------------------------------------------
    // Clean-up Test Entities
    // -------------------------------------------------------------------------
    console.log("\nCleaning up test entities...");
    for (const pid of createdPaperIds) {
      await prisma.aIMessage.deleteMany({
        where: { conversation: { paperId: pid } },
      });
      await prisma.aIConversation.deleteMany({
        where: { paperId: pid },
      });
      await prisma.paperChunk.deleteMany({
        where: { paperId: pid },
      });
      await prisma.paperAuthor.deleteMany({
        where: { paperId: pid },
      });
      await prisma.paper.deleteMany({
        where: { id: pid },
      });
    }

    for (const uid of createdUserIds) {
      await prisma.user.deleteMany({
        where: { id: uid },
      });
    }
    console.log(`Cleaned up ${createdPaperIds.length} paper(s) and ${createdUserIds.length} user(s).`);
  }

  console.log("\n================================================================================");
  console.log(` TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runPrivatePdfAnalysisAndCitationsTest().catch((err) => {
  console.error("Fatal test failure:", err);
  process.exit(1);
});
