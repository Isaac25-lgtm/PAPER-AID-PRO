/**
 * AI RESEARCH HUB — VERIFICATION TEST SUITE:
 * USER-UPLOADED PDF STORAGE, DURABILITY, RETRIEVAL & AUTHORIZATION
 *
 * Scope of Coverage:
 * 1. Upload private PDF -> verify storagePath in DB -> download -> verify exact bytes match.
 * 2. Disk Persistence: stored file remains retrievable after in-memory cache/RAM clear.
 * 3. Authorization: owner can download (200), non-owner gets 404 (enumeration defense), anonymous gets 401.
 * 4. Missing file handling: clean error response without unhandled exceptions.
 * 5. Document Deletion: removing private document cascades to disk and purges storage bytes.
 */

import "./test-setup";
import { prisma } from "../src/lib/prisma";
import {
  uploadUserPrivateDocument,
  deleteUserLibraryItem,
} from "../src/lib/library/user-library-service";
import {
  downloadPaperPdf,
  clearMockStorageMemoryCache,
} from "../src/lib/storage";
import {
  authorizePaperAccess,
  classifyPaper,
} from "../src/lib/auth/paper-authorization";
import bcrypt from "bcryptjs";

// Helper to create a valid minimal PDF buffer for testing
function createValidTestPdf(title: string, bodyText: string): Buffer {
  const stream = `BT /F1 12 Tf 72 712 Td (${title}) Tj ET\nBT /F1 10 Tf 72 680 Td (${bodyText}) Tj ET`;
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
<< /Length ${stream.length} >>
stream
${stream}
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
0000000350 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
450
%%EOF`;
  return Buffer.from(pdfString, "utf-8");
}

async function runPdfUploadViewVerificationSuite() {
  console.log("================================================================================");
  console.log(" AI RESEARCH HUB — VERIFICATION: USER-UPLOADED PDF STORAGE & RETRIEVAL");
  console.log(" 1. Private PDF Upload & Database storagePath Verification");
  console.log(" 2. Storage Download & Exact Byte-for-Byte Fidelity");
  console.log(" 3. Cold-Start Disk Persistence (Retrieval After Memory Cache Purge)");
  console.log(" 4. Authorization & Enumeration Defense (200 Owner, 404 Non-Owner, 401 Anon)");
  console.log(" 5. Missing File Handling (Safe 404 Without Server Crash)");
  console.log(" 6. Deletion Cascading & Disk File Removal");
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
  const passwordHash = await bcrypt.hash("TestPass2026!", 10);

  // Setup test users
  const alice = await prisma.user.create({
    data: {
      name: `Alice Researcher ${runId}`,
      email: `alice-${runId}@lab.ac.uk`,
      passwordHash,
      role: "USER",
    },
  });

  const bob = await prisma.user.create({
    data: {
      name: `Bob Researcher ${runId}`,
      email: `bob-${runId}@lab.ac.uk`,
      passwordHash,
      role: "USER",
    },
  });

  const admin = await prisma.user.create({
    data: {
      name: `Admin Reviewer ${runId}`,
      email: `admin-${runId}@lab.ac.uk`,
      passwordHash,
      role: "ADMIN",
    },
  });

  console.log(`[INIT] Created Alice (Owner): ${alice.id}`);
  console.log(`[INIT] Created Bob (Non-Owner): ${bob.id}`);
  console.log(`[INIT] Created Admin: ${admin.id}\n`);

  try {
    // -------------------------------------------------------------------------
    // 1. Private PDF Upload & Database storagePath Verification
    // -------------------------------------------------------------------------
    console.log("--- 1. Testing Private PDF Upload & Storage Path ---");
    const testTitle = `Novel Quantum Lattice Architecture (${runId})`;
    const testBody = `Empirical results for d=9 surface code lattice with 99.92 percent gate fidelity. Run timestamp: ${runId}`;
    const originalPdfBuffer = createValidTestPdf(testTitle, testBody);

    const uploadRes = await uploadUserPrivateDocument({
      userId: alice.id,
      fileBuffer: originalPdfBuffer,
      filename: "quantum_lattice_final.pdf",
      metadata: {
        title: testTitle,
        documentType: "RESEARCH_ARTICLE",
        authors: "Alice Researcher, Quantum Computing Lab",
        description: "Pre-submission manuscript for Nature Quantum Information",
      },
      autoProcess: false, // focus on storage fidelity
    });

    assert(uploadRes.success === true, "uploadUserPrivateDocument returned success: true");
    assert(Boolean(uploadRes.paperId), "Received valid paperId from upload");
    assert(Boolean(uploadRes.storagePath), "Received valid storagePath from upload");

    const expectedPath = `research-papers/users/${alice.id}/papers/${uploadRes.paperId}/original.pdf`;
    assert(
      uploadRes.storagePath === expectedPath,
      `storagePath strictly matches canonical user pattern: ${expectedPath}`,
      { actual: uploadRes.storagePath, expected: expectedPath }
    );

    const paperInDb = await prisma.paper.findUnique({
      where: { id: uploadRes.paperId },
    });
    assert(Boolean(paperInDb), "Paper record exists in PostgreSQL database");
    assert(paperInDb?.storagePath === expectedPath, "DB paper.storagePath matches uploadResult.storagePath");
    assert(
      (paperInDb?.sourceProvenance as any)?.ownerId === alice.id,
      "DB paper.sourceProvenance.ownerId matches Alice"
    );
    assert(
      (paperInDb?.sourceProvenance as any)?.isPrivate === true,
      "DB paper.sourceProvenance.isPrivate is true"
    );

    // -------------------------------------------------------------------------
    // 2. Storage Download & Exact Byte-for-Byte Fidelity
    // -------------------------------------------------------------------------
    console.log("\n--- 2. Testing Storage Download & Byte-for-Byte Fidelity ---");
    const downloadedBuffer = await downloadPaperPdf(uploadRes.storagePath);

    assert(downloadedBuffer.length === originalPdfBuffer.length, "Downloaded buffer byte length matches original exactly", {
      originalLen: originalPdfBuffer.length,
      downloadedLen: downloadedBuffer.length,
    });

    const byteComparison = Buffer.compare(originalPdfBuffer, downloadedBuffer);
    assert(byteComparison === 0, "Downloaded buffer matches original byte-for-byte (Buffer.compare === 0)");

    // -------------------------------------------------------------------------
    // 3. Cold-Start Disk Persistence (Retrieval After Memory Cache Purge)
    // -------------------------------------------------------------------------
    console.log("\n--- 3. Testing Cold-Start Disk Persistence (Cache Clear) ---");
    // Purge in-memory map to simulate dev server restart or different worker thread
    clearMockStorageMemoryCache();
    console.log("[CACHE] In-memory mock storage cache cleared.");

    // Retrieve again: must read from .mock-storage disk files
    const persistedBuffer = await downloadPaperPdf(uploadRes.storagePath);
    assert(
      persistedBuffer.length === originalPdfBuffer.length,
      "Buffer retrieved from disk after memory clear matches original length"
    );
    assert(
      Buffer.compare(originalPdfBuffer, persistedBuffer) === 0,
      "Buffer retrieved from disk matches original byte-for-byte"
    );

    // -------------------------------------------------------------------------
    // 4. Authorization & Enumeration Defense (200 Owner, 404 Non-Owner, 401 Anon)
    // -------------------------------------------------------------------------
    console.log("\n--- 4. Testing Authorization & Enumeration Defense ---");
    const classification = classifyPaper(paperInDb!);
    assert(
      classification === "PRIVATE_USER_DOCUMENT",
      "Paper correctly classified as PRIVATE_USER_DOCUMENT"
    );

    // 4A: Alice (Owner) -> 200 Allowed
    const authAlice = await authorizePaperAccess(paperInDb!, { id: alice.id, role: "USER" }, "DOWNLOAD_PDF");
    assert(authAlice.allowed === true, "Alice (Owner) is allowed to download PDF");
    assert(authAlice.statusCode === 200, "Alice receives HTTP 200");

    // 4B: Bob (Non-Owner) -> 404 Not Found (Enumeration Defense)
    const authBob = await authorizePaperAccess(paperInDb!, { id: bob.id, role: "USER" }, "DOWNLOAD_PDF");
    assert(authBob.allowed === false, "Bob (Non-Owner) is denied download access");
    assert(
      authBob.statusCode === 404,
      "Bob receives HTTP 404 (Not 403, preventing resource enumeration)"
    );

    // 4C: Anonymous Visitor -> 401 Unauthorized
    const authAnon = await authorizePaperAccess(paperInDb!, null, "DOWNLOAD_PDF");
    assert(authAnon.allowed === false, "Anonymous visitor is denied download access");
    assert(authAnon.statusCode === 401, "Anonymous visitor receives HTTP 401");

    // 4D: Admin -> 200 Allowed
    const authAdmin = await authorizePaperAccess(paperInDb!, { id: admin.id, role: "ADMIN" }, "DOWNLOAD_PDF");
    assert(authAdmin.allowed === true, "System Admin is allowed privileged maintenance access");
    assert(authAdmin.statusCode === 200, "Admin receives HTTP 200");

    // -------------------------------------------------------------------------
    // 5. Missing File Handling (Safe 404 Without Server Crash)
    // -------------------------------------------------------------------------
    console.log("\n--- 5. Testing Missing File Handling ---");
    const fakeStoragePath = `research-papers/users/${alice.id}/papers/cm_fake_nonexistent/original.pdf`;
    let missingFileErrorCaught = false;
    let missingErrorMessage = "";
    try {
      await downloadPaperPdf(fakeStoragePath);
    } catch (err: any) {
      missingFileErrorCaught = true;
      missingErrorMessage = err.message;
    }
    assert(missingFileErrorCaught === true, "downloadPaperPdf throws on missing object");
    assert(
      missingErrorMessage.includes("Object not found in mock storage"),
      "Error message explicitly identifies missing object",
      { message: missingErrorMessage }
    );

    // -------------------------------------------------------------------------
    // 6. Deletion Cascading & Disk File Removal
    // -------------------------------------------------------------------------
    console.log("\n--- 6. Testing Deletion Cascading & Disk File Removal ---");
    const deleteRes = await deleteUserLibraryItem(alice.id, uploadRes.paperId);
    assert(deleteRes.success === true, "deleteUserLibraryItem returned success: true");
    assert(
      deleteRes.action === "DELETED_PRIVATE_DOCUMENT",
      "Correct action returned: DELETED_PRIVATE_DOCUMENT"
    );

    // Verify DB record is gone
    const paperAfterDelete = await prisma.paper.findUnique({
      where: { id: uploadRes.paperId },
    });
    assert(paperAfterDelete === null, "Paper record deleted from database");

    // Verify storage file is removed from disk/mock storage
    let fileNotFoundAfterDelete = false;
    try {
      await downloadPaperPdf(uploadRes.storagePath);
    } catch (err: any) {
      fileNotFoundAfterDelete = true;
    }
    assert(fileNotFoundAfterDelete === true, "Storage file successfully purged from disk and mock storage");

  } finally {
    // Cleanup test users
    await prisma.bookmark.deleteMany({ where: { userId: { in: [alice.id, bob.id, admin.id] } } });
    await prisma.paper.deleteMany({
      where: {
        OR: [
          { sourceProvenance: { path: ["uploadedByUserId"], equals: alice.id } },
          { sourceProvenance: { path: ["uploadedByUserId"], equals: bob.id } },
          { sourceProvenance: { path: ["uploadedByUserId"], equals: admin.id } },
        ],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id, admin.id] } } });
  }

  console.log("\n================================================================================");
  console.log(` RESULTS: ${passCount} PASSED, ${failCount} FAILED (TOTAL: ${passCount + failCount})`);
  console.log("================================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runPdfUploadViewVerificationSuite().catch((err) => {
  console.error("FATAL in test suite:", err);
  process.exit(1);
});
