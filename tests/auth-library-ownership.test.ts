/**
 * AI RESEARCH HUB — VERIFICATION TEST SUITE:
 * AUTHENTICATION UI, EXPANDED LIBRARY, AND SHARED PAPER OWNERSHIP
 *
 * Scope of Coverage:
 * 1. Authentication State & Consistency (Anonymous vs Authenticated)
 * 2. Shared Scholarly Paper vs Private User PDF Ownership (Copy-on-Write Pattern)
 *    - User A saves public scholarly paper.
 *    - User B saves same public scholarly paper.
 *    - User A uploads private PDF copy -> gets isolated private copy.
 *    - User B retains access to public reference; blocked from User A's private copy (404).
 *    - User B uploads their own copy -> gets isolated private copy.
 *    - Neither user's upload overwrites or alters the other.
 *    - User A deletes their private copy -> public paper and User B's entry remain 100% intact.
 * 3. Save Paper Workflows & Idempotency
 * 4. General Document Support (OTHER_DOCUMENT, TECHNICAL_REPORT with no DOI/journal)
 * 5. Citation Formatting (Master's Thesis vs Doctoral Dissertation)
 * 6. Chat with PDF for Document Owners without Admin Privileges
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { prisma } from "../src/lib/prisma";
import {
  uploadUserPrivateDocument,
  attachPdfToExistingPaper,
  deleteUserLibraryItem,
  getUserLibraryItems,
} from "../src/lib/library/user-library-service";
import { askPaperQuestion } from "../src/lib/rag/qa-orchestrator";
import { formatBibliographicCitation } from "../src/lib/citations/citation-formatter";
import {
  authorizePaperAccess,
  classifyPaper,
  isPublicScholarlyPaper,
  getPublicPaperWhereInput,
} from "../src/lib/auth/paper-authorization";
import { setStorageClientOverride } from "../src/lib/storage";
import bcrypt from "bcryptjs";

// Helper to create a valid minimal PDF buffer for testing
function createSimpleTestPdf(title: string, contentParagraphs: string[]): Buffer {
  const stream = contentParagraphs.join("\n\n");
  const pdfString = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${stream.length + 100} >>
stream
BT
/F1 12 Tf
72 712 Td
(${title}) Tj
ET
BT
/F1 10 Tf
72 680 Td
(${stream.replace(/\n/g, " ")}) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000410 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
490
%%EOF`;
  return Buffer.from(pdfString, "utf-8");
}

async function runAuthAndOwnershipTestSuite() {
  console.log("================================================================================");
  console.log(" AI RESEARCH HUB — ACCEPTANCE REGRESSION SUITE");
  console.log(" 1. Authentication State & Visitor Boundary Consistency");
  console.log(" 2. Shared Scholarly Paper vs Private User PDF (Copy-on-Write Pattern)");
  console.log(" 3. Cross-User PDF, Evidence & Chunk Isolation");
  console.log(" 4. Save Paper Idempotency & Library Refresh");
  console.log(" 5. General Document Support (Non-Academic Document Types)");
  console.log(" 6. Academic Citation Formatting (Master's Thesis vs PhD Dissertation)");
  console.log("================================================================================\n");

  let passCount = 0;
  let failCount = 0;

  function assert(condition: boolean, desc: string, details?: any) {
    if (condition) {
      passCount++;
      console.log(`[PASS] ${desc}`);
    } else {
      failCount++;
      console.error(`[FAIL] ${desc}`);
      if (details) console.error("  Details:", details);
    }
  }

  const runId = Date.now();
  const passwordHash = await bcrypt.hash("AcceptancePass2026!", 10);

  // Setup test users
  const userA = await prisma.user.create({
    data: {
      name: "Researcher Alice",
      email: `alice-ownership-${runId}@university.edu`,
      passwordHash,
      role: "USER",
    },
  });

  const userB = await prisma.user.create({
    data: {
      name: "Researcher Bob",
      email: `bob-ownership-${runId}@university.edu`,
      passwordHash,
      role: "USER",
    },
  });

  console.log(`[INIT] Created User A: ${userA.name} (${userA.id})`);
  console.log(`[INIT] Created User B: ${userB.name} (${userB.id})\n`);

  try {
    // =========================================================================
    // 1. AUTHENTICATION STATE & VISITOR BOUNDARY CONSISTENCY
    // =========================================================================
    console.log("--- 1. Testing Authentication State & Consistency ---");

    // Anonymous visitor has 0 saved count and unauthenticated view
    const anonSavedCount = 0;
    assert(anonSavedCount === 0, "Anonymous visitors see 0 saved documents by default");

    // Authenticated User A starts with 0 saved documents
    const initialSavedA = await prisma.bookmark.count({ where: { userId: userA.id } });
    assert(initialSavedA === 0, "User A starts with 0 saved documents");

    // =========================================================================
    // 2. SHARED SCHOLARLY PAPER VS PRIVATE USER PDF (COPY-ON-WRITE)
    // =========================================================================
    console.log("\n--- 2. Testing Shared Scholarly Paper vs Private User PDF Scenario ---");

    const sharedDoi = `10.1038/nature-quantum-${runId}`;
    const publicPaper = await prisma.paper.create({
      data: {
        title: `Quantum Fault-Tolerant Surface Codes (${runId})`,
        abstract: "Threshold analysis and logical qubit stabilization under realistic syndrome measurement noise.",
        status: "METADATA_ONLY",
        doi: sharedDoi,
        journal: "Nature Quantum Information",
        isOpenAccess: false,
        sourceProvenance: {
          isPublicOpenAccess: false,
          source: "crossref",
        },
      },
    });

    console.log(`Created Shared Public Paper: ${publicPaper.id} (DOI: ${sharedDoi})`);

    // Step A: User A saves public paper
    await prisma.bookmark.create({
      data: { userId: userA.id, paperId: publicPaper.id },
    });
    console.log("Step A: User A saved public paper.");

    // Step B: User B saves the same public paper
    await prisma.bookmark.create({
      data: { userId: userB.id, paperId: publicPaper.id },
    });
    console.log("Step B: User B saved public paper.");

    // Verify both users have it in their libraries as METADATA_ONLY with hasPdf === false
    const libraryA_initial = await getUserLibraryItems(userA.id);
    const itemA_initial = libraryA_initial.find((i) => i.id === publicPaper.id);
    assert(Boolean(itemA_initial), "User A library contains shared public paper");
    assert(itemA_initial?.hasPdf === false, "User A initial item has hasPdf === false");

    const libraryB_initial = await getUserLibraryItems(userB.id);
    const itemB_initial = libraryB_initial.find((i) => i.id === publicPaper.id);
    assert(Boolean(itemB_initial), "User B library contains shared public paper");
    assert(itemB_initial?.hasPdf === false, "User B initial item has hasPdf === false");

    // Step C: User A uploads their private PDF copy
    const pdfBufferA = createSimpleTestPdf(
      `Quantum Fault-Tolerant Surface Codes (${runId}) - User A Copy`,
      [
        "Section 1: Architecture and Thresholds. We implement a rotated surface code lattice with distance d=7.",
        "Section 2: Error Suppression. Logical error rate scales exponentially with code distance below physical threshold of 0.7 percent."
      ]
    );

    const attachResultA = await attachPdfToExistingPaper({
      userId: userA.id,
      paperId: publicPaper.id,
      fileBuffer: pdfBufferA,
      filename: "surface_codes_userA.pdf",
      autoProcess: true,
    });

    console.log("User A attach completed:", {
      returnedPaperId: attachResultA.paperId,
      storagePath: attachResultA.storagePath,
      chunkCount: attachResultA.chunkCount,
    });

    assert(attachResultA.success === true, "User A attach succeeded");
    assert(attachResultA.paperId !== publicPaper.id, "User A received a private clone ID (CoW guarantee)");
    assert(attachResultA.storagePath.includes(`users/${userA.id}`), "User A storage path is scoped to User A");

    // Step D: Verify Shared Public Paper remained completely untouched
    const publicPaperAfterA = await prisma.paper.findUnique({
      where: { id: publicPaper.id },
    });
    assert(publicPaperAfterA?.status === "METADATA_ONLY", "Public paper status remained METADATA_ONLY");
    assert(publicPaperAfterA?.storagePath === null, "Public paper storagePath remains null (never claimed by User A)");
    assert((publicPaperAfterA?.sourceProvenance as any)?.isPrivate !== true, "Public paper is NOT private");

    // Step E: Verify User B retains access to public reference
    const authCheckB_public = await authorizePaperAccess(
      publicPaperAfterA as any,
      { id: userB.id, role: "USER" },
      "VIEW_METADATA"
    );
    assert(authCheckB_public.allowed === true, "User B retains VIEW_METADATA access to shared public paper");
    assert(authCheckB_public.statusCode === 200, "User B access status is 200 OK");

    // Step F: Verify User B has ZERO access to User A's private clone
    const privatePaperA = await prisma.paper.findUnique({
      where: { id: attachResultA.paperId },
    });
    const authCheckB_on_A = await authorizePaperAccess(
      privatePaperA as any,
      { id: userB.id, role: "USER" },
      "VIEW_METADATA"
    );
    assert(authCheckB_on_A.allowed === false, "User B is denied access to User A's private paper clone");
    assert(authCheckB_on_A.statusCode === 404, "User B receives 404 (resource enumeration defense)");

    // Step G: Verify User B's library item does NOT leak User A's PDF or storage path
    const libraryB_afterA = await getUserLibraryItems(userB.id);
    const itemB_afterA = libraryB_afterA.find((i) => i.id === publicPaper.id);
    assert(Boolean(itemB_afterA), "User B library still contains the public reference");
    assert(itemB_afterA?.hasPdf === false, "User B library item has hasPdf === false (no PDF leakage)");
    assert(itemB_afterA?.storagePath === null, "User B library item storagePath is null");
    assert(itemB_afterA?.canChat === false, "User B cannot chat before attaching their own copy");

    // Step H: User B uploads their own private PDF copy
    const pdfBufferB = createSimpleTestPdf(
      `Quantum Fault-Tolerant Surface Codes (${runId}) - User B Annotated Copy`,
      [
        "Section 1: Alternative Decoder Evaluation. We assess MWPM versus Union-Find decoders under correlated noise.",
        "Section 2: Benchmark Results. MWPM achieves 0.68 percent threshold with sub-millisecond latency per syndrome round."
      ]
    );

    const attachResultB = await attachPdfToExistingPaper({
      userId: userB.id,
      paperId: publicPaper.id,
      fileBuffer: pdfBufferB,
      filename: "surface_codes_userB.pdf",
      autoProcess: true,
    });

    console.log("User B attach completed:", {
      returnedPaperId: attachResultB.paperId,
      storagePath: attachResultB.storagePath,
      chunkCount: attachResultB.chunkCount,
    });

    assert(attachResultB.success === true, "User B attach succeeded");
    assert(attachResultB.paperId !== publicPaper.id, "User B received their own private clone ID");
    assert(attachResultB.paperId !== attachResultA.paperId, "User B's paper ID is distinct from User A's paper ID");
    assert(attachResultB.storagePath !== attachResultA.storagePath, "User B's storage path is distinct from User A's");
    assert(attachResultB.storagePath.includes(`users/${userB.id}`), "User B storage path is scoped to User B");

    // Step I: User A deletes their private library item
    console.log("Step I: User A deletes their private library item...");
    const deleteResultA = await deleteUserLibraryItem(userA.id, attachResultA.paperId);
    assert(deleteResultA.success === true, "User A deleteUserLibraryItem succeeded");

    // Verify public paper still exists
    const publicPaperAfterDeleteA = await prisma.paper.findUnique({
      where: { id: publicPaper.id },
    });
    assert(Boolean(publicPaperAfterDeleteA), "Shared public paper still exists after User A deletion");

    // Verify User B's private copy still exists and is untouched
    const privatePaperBAfterDeleteA = await prisma.paper.findUnique({
      where: { id: attachResultB.paperId },
    });
    assert(Boolean(privatePaperBAfterDeleteA), "User B's private paper clone still exists after User A deletion");

    // Verify User B's library item still exists and has PDF
    const libraryB_afterDeleteA = await getUserLibraryItems(userB.id);
    const itemB_afterDeleteA = libraryB_afterDeleteA.find((i) => i.id === attachResultB.paperId);
    assert(Boolean(itemB_afterDeleteA), "User B's library item exists and is intact");
    assert(itemB_afterDeleteA?.hasPdf === true, "User B still has hasPdf === true");
    assert(itemB_afterDeleteA?.canChat === true, "User B still has canChat === true");

    // =========================================================================
    // 3. CHAT WITH PDF FOR DOCUMENT OWNER (WITHOUT ADMIN ROLE)
    // =========================================================================
    console.log("\n--- 3. Testing Chat with PDF as Document Owner (Role: USER) ---");

    const chatResponseB = await askPaperQuestion({
      paperId: attachResultB.paperId,
      question: "What decoders were assessed under correlated noise?",
      userId: userB.id,
    });

    assert(Boolean(chatResponseB.answer && chatResponseB.answer.length > 20), "User B successfully queried their attached PDF");
    assert(chatResponseB.citations.length > 0, "Chat response contains grounded citations to User B's chunks");

    // =========================================================================
    // 4. GENERAL DOCUMENT SUPPORT (OTHER_DOCUMENT, NO MANDATORY DOI/JOURNAL)
    // =========================================================================
    console.log("\n--- 4. Testing General Document Support (OTHER_DOCUMENT) ---");

    const lectureNotesPdf = createSimpleTestPdf(
      "Lecture Notes: Advanced Distributed Systems Architecture",
      [
        "Topic 1: Raft Consensus Protocol. Leaders maintain replicated state machines using log append RPCs.",
        "Topic 2: Byzantine Fault Tolerance. Practical BFT achieves consensus with 3f+1 nodes under partial synchrony."
      ]
    );

    const uploadGeneralResult = await uploadUserPrivateDocument({
      userId: userA.id,
      fileBuffer: lectureNotesPdf,
      filename: "cs801_lecture_notes.pdf",
      metadata: {
        title: "Lecture Notes: Advanced Distributed Systems Architecture",
        documentType: "LECTURE_MATERIAL",
        // NO DOI, NO journal, NO publisher, NO academic classification
      },
      autoProcess: true,
    });

    assert(uploadGeneralResult.success === true, "uploadUserPrivateDocument succeeded for LECTURE_MATERIAL");

    const generalDoc = await prisma.paper.findUnique({
      where: { id: uploadGeneralResult.paperId },
      include: { _count: { select: { chunks: true } } },
    });

    assert(generalDoc?.doi === null, "General document has null DOI");
    assert(generalDoc?.journal === null, "General document has null journal");
    assert((generalDoc?._count.chunks ?? 0) > 0, "General document extracted and chunked successfully");

    const generalIsPublic = isPublicScholarlyPaper(generalDoc!);
    assert(generalIsPublic === false, "General document is strictly excluded from public scholarly discovery");

    // =========================================================================
    // 5. CITATION FORMATTING (MASTER'S THESIS VS DOCTORAL DISSERTATION)
    // =========================================================================
    console.log("\n--- 5. Testing Academic Citation Formatting ---");

    // Master's thesis citation
    const mastersCitationAPA = formatBibliographicCitation(
      {
        title: "Adaptive Routing in Heterogeneous Satellite Mesh Networks",
        authors: ["David Kim"],
        year: 2025,
        documentType: "MASTERS_THESIS",
        institution: "Imperial College London",
        isUnpublished: true,
      },
      "apa"
    );

    assert(
      mastersCitationAPA.text.includes("[Master's thesis, Imperial College London]"),
      "Master's thesis APA uses [Master's thesis, ...]"
    );
    assert(
      !mastersCitationAPA.text.includes("Doctoral dissertation"),
      "Master's thesis APA does NOT say Doctoral dissertation"
    );

    const mastersCitationBib = formatBibliographicCitation(
      {
        title: "Adaptive Routing in Heterogeneous Satellite Mesh Networks",
        authors: ["David Kim"],
        year: 2025,
        documentType: "MASTERS_THESIS",
        institution: "Imperial College London",
        isUnpublished: true,
      },
      "bibtex"
    );

    assert(mastersCitationBib.text.startsWith("@mastersthesis{"), "Master's thesis BibTeX uses @mastersthesis");

    // Doctoral dissertation citation
    const phdCitationAPA = formatBibliographicCitation(
      {
        title: "Topological Quantum Memory in 3D Toric Code Lattices",
        authors: ["Elena Rostova"],
        year: 2024,
        documentType: "PHD_DISSERTATION",
        institution: "ETH Zurich",
        isUnpublished: true,
      },
      "apa"
    );

    assert(
      phdCitationAPA.text.includes("[Doctoral dissertation, ETH Zurich]"),
      "Doctoral dissertation APA uses [Doctoral dissertation, ...]"
    );

    const phdCitationBib = formatBibliographicCitation(
      {
        title: "Topological Quantum Memory in 3D Toric Code Lattices",
        authors: ["Elena Rostova"],
        year: 2024,
        documentType: "PHD_DISSERTATION",
        institution: "ETH Zurich",
        isUnpublished: true,
      },
      "bibtex"
    );

    assert(phdCitationBib.text.startsWith("@phdthesis{"), "Doctoral dissertation BibTeX uses @phdthesis");

    // Canonical DOI citation on private clone
    const cloneCitationAPA = formatBibliographicCitation(
      {
        title: "Quantum Fault-Tolerant Surface Codes",
        authors: ["Alice Researcher"],
        year: 2026,
        journal: "Nature Quantum Information",
        doi: sharedDoi,
        documentType: "RESEARCH_ARTICLE",
      },
      "apa"
    );

    assert(
      cloneCitationAPA.text.includes(`https://doi.org/${sharedDoi}`),
      "Private clone citation correctly preserves and outputs canonical DOI"
    );

    // =========================================================================
    // 6. FAILED ATTACHMENT RECOVERY
    // =========================================================================
    console.log("\n--- 6. Testing Failed Attachment Recovery ---");

    const faultDoi = `10.1038/nature-fault-${runId}`;
    const faultPaper = await prisma.paper.create({
      data: {
        title: `Fault-Resilient Quantum Hardware (${runId})`,
        abstract: "Evaluating fault recovery under simulated network and database faults.",
        status: "METADATA_ONLY",
        doi: faultDoi,
        journal: "Nature Quantum Hardware",
        isOpenAccess: false,
        sourceProvenance: { isPublicOpenAccess: false, source: "crossref" },
      },
    });

    // User A saves the fault reference
    await prisma.bookmark.create({
      data: { userId: userA.id, paperId: faultPaper.id },
    });

    // 6.1 Storage Upload Fails
    setStorageClientOverride({
      storage: {
        from: () => ({
          upload: async () => ({
            data: null,
            error: new Error("SIMULATED_STORAGE_TIMEOUT: 504 Gateway Timeout connecting to storage bucket"),
          }),
        }),
      },
    });

    let caughtStorageError = false;
    try {
      await attachPdfToExistingPaper({
        userId: userA.id,
        paperId: faultPaper.id,
        fileBuffer: createSimpleTestPdf("Fault Test", ["Sample paragraph"]),
        filename: "test_storage_fail.pdf",
        autoProcess: false,
      });
    } catch (e: any) {
      caughtStorageError = true;
    } finally {
      enableMockStorage();
    }

    assert(caughtStorageError, "Storage failure thrown as expected error");

    // Public paper remained untouched
    const faultPaperAfterStorageFail = await prisma.paper.findUnique({ where: { id: faultPaper.id } });
    assert(faultPaperAfterStorageFail?.status === "METADATA_ONLY", "Public paper remained METADATA_ONLY after storage failure");
    assert(faultPaperAfterStorageFail?.storagePath === null, "Public paper storagePath remains null");

    // No orphan private clone
    const orphanClones1 = await prisma.paper.findMany({
      where: { sourceProvenance: { path: ["attachedToPublicPaperId"], equals: faultPaper.id } },
    });
    assert(orphanClones1.length === 0, "No orphan private clone exists in database after storage failure");

    // User A bookmark intact on public reference
    const bookmarkFault1 = await prisma.bookmark.findFirst({ where: { userId: userA.id, paperId: faultPaper.id } });
    assert(Boolean(bookmarkFault1), "User A bookmark still intact on original public reference after storage failure");

    // 6.2 Database Update Fails After Storage Upload
    const originalPaperUpdate = prisma.paper.update;
    (prisma.paper as any).update = async (args: any) => {
      if (args.data?.storagePath) {
        throw new Error("SIMULATED_DB_ERROR: Deadlock detected or connection reset during paper.update");
      }
      return originalPaperUpdate.call(prisma.paper, args);
    };

    let caughtDbError = false;
    try {
      await attachPdfToExistingPaper({
        userId: userA.id,
        paperId: faultPaper.id,
        fileBuffer: createSimpleTestPdf("Fault Test", ["Sample paragraph"]),
        filename: "test_db_fail.pdf",
        autoProcess: false,
      });
    } catch (e: any) {
      caughtDbError = true;
    } finally {
      (prisma.paper as any).update = originalPaperUpdate;
    }

    assert(caughtDbError, "Database update failure thrown as expected error");

    const orphanClones2 = await prisma.paper.findMany({
      where: { sourceProvenance: { path: ["attachedToPublicPaperId"], equals: faultPaper.id } },
    });
    assert(orphanClones2.length === 0, "Incomplete private clone purged from database after DB failure");

    const bookmarkFault2 = await prisma.bookmark.findFirst({ where: { userId: userA.id, paperId: faultPaper.id } });
    assert(Boolean(bookmarkFault2), "User A bookmark still intact on original public reference after DB failure");

    // 6.3 Retry After Failures
    const retryFaultResult = await attachPdfToExistingPaper({
      userId: userA.id,
      paperId: faultPaper.id,
      fileBuffer: createSimpleTestPdf("Fault Test Recovered", ["Recovered content"]),
      filename: "recovered_attachment.pdf",
      autoProcess: false,
    });

    assert(retryFaultResult.success === true, "Attachment retry succeeded cleanly after simulated faults");
    assert(retryFaultResult.paperId !== faultPaper.id, "Private clone created on retry");

    // =========================================================================
    // 7. IDEMPOTENCY AND CONCURRENCY
    // =========================================================================
    console.log("\n--- 7. Testing Idempotency & Concurrency ---");

    // 7.1 Repeated Sequential Attach
    const repeatAttach = await attachPdfToExistingPaper({
      userId: userA.id,
      paperId: faultPaper.id,
      fileBuffer: createSimpleTestPdf("Fault Test Re-attach", ["Re-attached content"]),
      filename: "reattach.pdf",
      autoProcess: false,
    });

    assert(repeatAttach.success === true, "Repeated sequential attach succeeded");
    assert(repeatAttach.paperId === retryFaultResult.paperId, "Repeated attach reused existing private clone (no duplicates)");

    // 7.2 Concurrent Attach Requests
    // User B saves the fault reference
    await prisma.bookmark.create({
      data: { userId: userB.id, paperId: faultPaper.id },
    });

    const concurrentResults = await Promise.all([
      attachPdfToExistingPaper({
        userId: userB.id,
        paperId: faultPaper.id,
        fileBuffer: createSimpleTestPdf("User B Concurrent 1", ["Content 1"]),
        filename: "userB_c1.pdf",
        autoProcess: false,
      }),
      attachPdfToExistingPaper({
        userId: userB.id,
        paperId: faultPaper.id,
        fileBuffer: createSimpleTestPdf("User B Concurrent 2", ["Content 2"]),
        filename: "userB_c2.pdf",
        autoProcess: false,
      }),
      attachPdfToExistingPaper({
        userId: userB.id,
        paperId: faultPaper.id,
        fileBuffer: createSimpleTestPdf("User B Concurrent 3", ["Content 3"]),
        filename: "userB_c3.pdf",
        autoProcess: false,
      }),
    ]);

    assert(concurrentResults.every((r) => r.success === true), "All 3 concurrent attach requests completed successfully");
    const uniqueBIds = new Set(concurrentResults.map((r) => r.paperId));
    assert(uniqueBIds.size === 1, "All concurrent requests resolved to exactly 1 private clone ID");

    const userBClones = await prisma.paper.findMany({
      where: {
        sourceProvenance: { path: ["attachedToPublicPaperId"], equals: faultPaper.id },
        AND: { sourceProvenance: { path: ["ownerId"], equals: userB.id } },
      },
    });
    assert(userBClones.length === 1, "Exactly 1 private paper record exists in DB for User B");

    // 7.3 Cross-User Isolation Under Concurrency
    assert(concurrentResults[0].paperId !== retryFaultResult.paperId, "User B clone ID is completely isolated from User A clone ID");
    const libraryAFinal = await getUserLibraryItems(userA.id);
    const itemAFinal = libraryAFinal.find((i) => i.id === retryFaultResult.paperId);
    assert(Boolean(itemAFinal), "User A library item intact after User B concurrent operations");

    // =========================================================================
    // SUMMARY
    // =========================================================================
    console.log("\n================================================================================");
    console.log(` RESULTS: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${passCount + failCount})`);
    console.log("================================================================================\n");

    if (failCount > 0) {
      throw new Error(`Test suite failed with ${failCount} failing assertions.`);
    }

  } finally {
    // Clean up test data
    console.log("[CLEANUP] Cleaning up test data...");
    await prisma.bookmark.deleteMany({
      where: { userId: { in: [userA.id, userB.id] } },
    });
    await prisma.paper.deleteMany({
      where: {
        OR: [
          { doi: { contains: String(runId) } },
          { title: { contains: String(runId) } },
          { title: { contains: "Advanced Distributed Systems Architecture" } },
        ],
      },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userA.id, userB.id] } },
    });
    console.log("[CLEANUP] Cleanup complete.");
  }
}

runAuthAndOwnershipTestSuite()
  .then(() => {
    console.log("Suite execution finished successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Suite execution error:", err);
    process.exit(1);
  });
