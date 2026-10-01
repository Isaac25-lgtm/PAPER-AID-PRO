import "../scratch/load-env";
import { prisma } from "../src/lib/prisma";
import {
  normalizeDoi,
  normalizeArxivId,
  normalizeOptionalIdentifier,
  getFriendlyP2002ErrorMessage,
} from "../src/lib/identifiers";

async function runIdentifierTests() {
  console.log("==========================================================");
  console.log("TEST SUITE: OPTIONAL UNIQUE PAPER IDENTIFIERS & P2002 HANDLING");
  console.log("==========================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}${detail ? ` - ${detail}` : ""}`);
      failed++;
    }
  }

  // --- UNIT NORMALIZATION TESTS ---

  // Test A: arxivId = "" -> NULL
  const normArxivEmpty = normalizeArxivId("");
  assert(normArxivEmpty === null, "Test A: arxivId = '' -> NULL", `got ${JSON.stringify(normArxivEmpty)}`);

  // Test B: arxivId = "   " -> NULL
  const normArxivSpaces = normalizeArxivId("   ");
  assert(normArxivSpaces === null, "Test B: arxivId = '   ' -> NULL", `got ${JSON.stringify(normArxivSpaces)}`);

  // Test C: doi = "" -> NULL
  const normDoiEmpty = normalizeDoi("");
  const normDoiSpaces = normalizeDoi("   ");
  assert(normDoiEmpty === null && normDoiSpaces === null, "Test C: doi = '' or '   ' -> NULL");

  // Test D: doi URL https://doi.org/10.3390/cancers14020277 -> 10.3390/cancers14020277
  const normDoiUrlHttps = normalizeDoi("https://doi.org/10.3390/cancers14020277");
  const normDoiUrlHttp = normalizeDoi("http://doi.org/10.3390/cancers14020277");
  const normDoiUrlDx = normalizeDoi("https://dx.doi.org/10.3390/cancers14020277");
  assert(
    normDoiUrlHttps === "10.3390/cancers14020277" &&
      normDoiUrlHttp === "10.3390/cancers14020277" &&
      normDoiUrlDx === "10.3390/cancers14020277",
    "Test D: doi URL (https/http/dx) -> 10.3390/cancers14020277",
    `got https=${normDoiUrlHttps}, http=${normDoiUrlHttp}, dx=${normDoiUrlDx}`
  );

  // Test E: DOI prefix case-insensitivity: DOI: 10.3390/CANCERS14020277 -> canonical normalized DOI
  const normDoiPrefix = normalizeDoi("DOI: 10.3390/CANCERS14020277");
  const normDoiPrefix2 = normalizeDoi("doi:10.3390/cancers14020277");
  assert(
    normDoiPrefix === "10.3390/cancers14020277" && normDoiPrefix2 === "10.3390/cancers14020277",
    "Test E: DOI: 10.3390/CANCERS14020277 -> canonical normalized lowercase DOI",
    `got ${normDoiPrefix}`
  );

  // Unit tests for P2002 error mapping
  const p2002DoiErr = { code: "P2002", meta: { target: ["doi"] } };
  const p2002ArxivErr = { code: "P2002", meta: { target: ["arxivId"] } };
  const p2002AuthorErr = { code: "P2002", meta: { target: ["paperId", "authorId"] } };
  const p2002GenericErr = { code: "P2002", meta: {} };

  // Test J: P2002 DOI collision friendly message
  const msgDoi = getFriendlyP2002ErrorMessage(p2002DoiErr);
  assert(
    msgDoi === "A paper with this DOI already exists.",
    "Test J: P2002 DOI collision -> friendly DOI-specific error",
    `got "${msgDoi}"`
  );

  // Test K: P2002 arXiv collision friendly message
  const msgArxiv = getFriendlyP2002ErrorMessage(p2002ArxivErr);
  assert(
    msgArxiv === "A paper with this arXiv ID already exists.",
    "Test K: P2002 arXiv collision -> friendly arXiv-specific error",
    `got "${msgArxiv}"`
  );

  const msgAuthor = getFriendlyP2002ErrorMessage(p2002AuthorErr);
  assert(
    msgAuthor === "An author was listed multiple times for this paper.",
    "Author collision -> friendly author-specific error",
    `got "${msgAuthor}"`
  );

  const msgGeneric = getFriendlyP2002ErrorMessage(p2002GenericErr);
  assert(
    msgGeneric === "A paper with one of these unique identifiers already exists.",
    "Fallback collision -> friendly unique identifier error",
    `got "${msgGeneric}"`
  );

  // --- DATABASE INTEGRATION TESTS ---

  const testPaperIdsToClean: string[] = [];

  try {
    console.log("\n--- Database Integration & Constraint Tests ---");

    // Test F: Two papers with null arxivId -> both allowed
    const paperF1 = await prisma.paper.create({
      data: {
        title: "Test Paper F1 " + Date.now(),
        abstract: "Abstract F1",
        arxivId: normalizeArxivId(""),
        doi: normalizeDoi(""),
      },
    });
    testPaperIdsToClean.push(paperF1.id);

    const paperF2 = await prisma.paper.create({
      data: {
        title: "Test Paper F2 " + Date.now(),
        abstract: "Abstract F2",
        arxivId: normalizeArxivId("   "),
        doi: normalizeDoi("   "),
      },
    });
    testPaperIdsToClean.push(paperF2.id);

    assert(
      paperF1.arxivId === null && paperF2.arxivId === null,
      "Test F: Two papers with null arxivId -> both allowed without unique constraint violation"
    );

    // Test G: Two papers with same real arxivId -> second rejected
    const uniqueArxiv = "9999." + Math.floor(10000 + Math.random() * 90000);
    const paperG1 = await prisma.paper.create({
      data: {
        title: "Test Paper G1 " + Date.now(),
        abstract: "Abstract G1",
        arxivId: normalizeArxivId(`arXiv:${uniqueArxiv}`),
      },
    });
    testPaperIdsToClean.push(paperG1.id);

    let secondArxivFailed = false;
    let secondArxivError: any = null;
    try {
      await prisma.paper.create({
        data: {
          title: "Test Paper G2 " + Date.now(),
          abstract: "Abstract G2",
          arxivId: normalizeArxivId(`https://arxiv.org/abs/${uniqueArxiv}`),
        },
      });
    } catch (err: any) {
      secondArxivFailed = true;
      secondArxivError = err;
    }
    assert(
      secondArxivFailed && secondArxivError?.code === "P2002",
      "Test G: Two papers with same normalized arxivId -> second rejected with P2002"
    );

    // Test H: Canonical DOI followed by equivalent doi.org URL -> duplicate rejected
    const testDoi = "10.9999/test." + Math.floor(10000 + Math.random() * 90000);
    const paperH1 = await prisma.paper.create({
      data: {
        title: "Test Paper H1 " + Date.now(),
        abstract: "Abstract H1",
        doi: normalizeDoi(testDoi),
      },
    });
    testPaperIdsToClean.push(paperH1.id);

    let secondDoiFailed = false;
    let secondDoiError: any = null;
    try {
      await prisma.paper.create({
        data: {
          title: "Test Paper H2 " + Date.now(),
          abstract: "Abstract H2",
          doi: normalizeDoi(`https://doi.org/${testDoi.toUpperCase()}`),
        },
      });
    } catch (err: any) {
      secondDoiFailed = true;
      secondDoiError = err;
    }
    assert(
      secondDoiFailed && secondDoiError?.code === "P2002",
      "Test H: Canonical DOI followed by equivalent doi.org URL -> duplicate rejected with P2002"
    );

    // Test I: Editing paper and clearing arxivId -> NULL
    const paperI = await prisma.paper.create({
      data: {
        title: "Test Paper I " + Date.now(),
        abstract: "Abstract I",
        arxivId: "2401.99999",
      },
    });
    testPaperIdsToClean.push(paperI.id);

    // Now clear it
    const updatedI = await prisma.paper.update({
      where: { id: paperI.id },
      data: {
        arxivId: normalizeArxivId(""), // simulating admin clearing input field
      },
    });
    assert(
      updatedI.arxivId === null,
      "Test I: Editing paper and clearing arxivId -> stored as NULL (not empty string)"
    );

    // Section 10: Test the user's exact case
    console.log("\n--- Section 10: User's Exact Case Verification ---");
    const userSubmittedTitle = "Influence of Decision Support on Breast Cancer Classification " + Date.now();
    const userSubmittedDoi = "https://doi.org/10.3390/cancers14020277";
    const userSubmittedArxiv = ""; // blank optional field

    const normUserDoi = normalizeDoi(userSubmittedDoi);
    const normUserArxiv = normalizeArxivId(userSubmittedArxiv);

    assert(
      normUserDoi === "10.3390/cancers14020277",
      "User Case: DOI normalized to canonical 10.3390/cancers14020277"
    );
    assert(normUserArxiv === null, "User Case: Blank arXiv normalized to NULL");

    if (normUserDoi) {
      // Check if this DOI already exists in DB before creation
      const existingUserDoi = await prisma.paper.findUnique({
        where: { doi: normUserDoi },
      });

      if (!existingUserDoi) {
        const userPaper = await prisma.paper.create({
          data: {
            title: userSubmittedTitle,
            abstract: "Abstract of user paper",
            doi: normUserDoi,
            arxivId: normUserArxiv,
          },
        });
        testPaperIdsToClean.push(userPaper.id);

        assert(
          userPaper.doi === "10.3390/cancers14020277" && userPaper.arxivId === null,
          "User Case: Paper creation succeeded with canonical DOI and NULL arxivId"
        );
      } else {
        console.log(`User Case: DOI ${normUserDoi} already exists in DB (ID: ${existingUserDoi.id})`);
      }
    }
  } finally {
    // Clean up all synthetic test papers
    console.log("\nCleaning up synthetic test records...");
    for (const id of testPaperIdsToClean) {
      try {
        await prisma.paper.delete({ where: { id } });
      } catch (e) {
        // ignore if already deleted
      }
    }
    console.log(`Cleaned up ${testPaperIdsToClean.length} test paper(s).`);
  }

  console.log("\n==========================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==========================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runIdentifierTests()
  .catch((e) => {
    console.error("Test execution threw error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
