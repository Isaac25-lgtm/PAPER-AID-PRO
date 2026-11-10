/**
 * AI RESEARCH HUB — REGRESSION TEST SUITE:
 * MORALES QA ACCURACY, TABLE ATTRIBUTION & EXTERNAL PDF LINK AUDIT
 *
 * Verifies:
 * 1. Sensitivity/specificity question for echogenic subendometrial lines retrieves 53.5% and 94.7%.
 * 2. Answer correctly cites Table 2, page 5 (and chunk #31).
 * 3. 95% Confidence intervals are preserved exactly (45.4–61.6% and 90.5–97.4%).
 * 4. Table 3 models (page 6) are distinct and not confused with Table 2 individual signs (page 5).
 * 5. Different table rows retrieve different correct measurements (Myometrial cysts: 41.3% sensitivity, 98.4% specificity).
 * 6. Completely unsupported questions safely abstain with zero fabricated citations.
 * 7. Multi-tenant access controls remain strictly enforced.
 * 8. Zero paid model or embedding calls are made.
 * 9. Smith & Bolton unverified-ingestion restriction is retained and Article Page fallback remains accessible.
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import assert from "node:assert";
import { prisma } from "../src/lib/prisma";
import { askPaperQuestion } from "../src/lib/rag/qa-orchestrator";
import { composeDeterministicLexicalAnswer } from "../src/lib/rag/deterministic-qa-synthesizer";
import { retrievePaperEvidence } from "../src/lib/rag/retrieve-paper-evidence";
import { authorizePaperAccess } from "../src/lib/auth/paper-authorization";

async function runTests() {
  console.log("\n========================================================");
  console.log("  REGRESSION: MORALES QA ACCURACY & EXTERNAL LINKS");
  console.log("========================================================\n");

  const ownerUserId = "cmvb1cabk0001vrgo46umk5zp";
  const intruderUserId = "intruder-unauthorized-user-id";

  // 1. Locate authentic Morales paper
  const moralesPaper = await prisma.paper.findFirst({
    where: {
      OR: [
        { id: "cmvkznrpr001fvrggnajkkq4b" },
        { title: { contains: "Diagnostic accuracy of transvaginal ultrasound for adenomyosis", mode: "insensitive" } },
      ],
    },
    include: {
      _count: { select: { chunks: true } },
    },
  });

  assert(moralesPaper, "Morales paper must exist in the database");
  console.log(`[Target Paper] ${moralesPaper.title}`);
  console.log(`  Paper ID: ${moralesPaper.id} | Total Chunks: ${moralesPaper._count.chunks}`);

  // TEST 1: Question for sensitivity and specificity of echogenic subendometrial lines
  console.log("\n[1] Testing 'What is the sensitivity and specificity of echogenic subendometrial lines?'...");
  const q1 = "What is the sensitivity and specificity of echogenic subendometrial lines?";
  const response1 = await askPaperQuestion({
    paperId: moralesPaper.id,
    question: q1,
    userId: ownerUserId,
    isNewThread: true,
  });

  assert.strictEqual(response1.success, true, "Q&A must succeed");
  assert.strictEqual(response1.insufficientEvidence, false, "Must not report insufficient evidence");
  assert(response1.claims && response1.claims.length > 0, "Must return at least one substantive claim");
  const claim1 = response1.claims[0];
  console.log("  Answer Text:", claim1.text);

  // Numerical accuracy checks
  assert(claim1.text.includes("53.5%"), "Answer must contain sensitivity of 53.5%");
  assert(claim1.text.includes("94.7%"), "Answer must contain specificity of 94.7%");

  // Confidence interval preservation checks
  assert(
    claim1.text.includes("45.4–61.6%") || claim1.text.includes("45.4-61.6%"),
    "Answer must preserve sensitivity 95% CI (45.4–61.6%)"
  );
  assert(
    claim1.text.includes("90.5–97.4%") || claim1.text.includes("90.5-97.4%"),
    "Answer must preserve specificity 95% CI (90.5–97.4%)"
  );

  // Table attribution checks
  assert(claim1.text.includes("Table 2"), "Answer must correctly attribute finding to Table 2 (NOT Table 3)");
  assert(!claim1.text.includes("Table 3: table"), "Answer must not contain broken 'Table 3: table' header");
  assert(!claim1.text.startsWith("Based on the manuscript evidence in Results, Table 3: table"), "Must not repeat raw table header slice");

  // Citation checks
  assert(claim1.citations && claim1.citations.length > 0, "Must provide citation anchors");
  const topCite1 = claim1.citations[0];
  console.log(`  Citation Anchor: Page ${topCite1.pageNumber}, Section '${topCite1.section}', Chunk #${topCite1.chunkIndex}`);
  assert.strictEqual(topCite1.pageNumber, 5, "Citation anchor must point to Page 5");
  assert.strictEqual(topCite1.section, "Results", "Citation anchor must be in Results section");
  assert.strictEqual(topCite1.chunkIndex, 31, "Citation anchor must point to Chunk #31");
  console.log("  ✅ [PASS] Sensitivity 53.5%, Specificity 94.7%, Table 2, Page 5, 95% CIs verified.");

  // TEST 2: Different table row retrieves different correct values (Myometrial cysts)
  console.log("\n[2] Testing different table row: 'What is the sensitivity and specificity of myometrial cysts?'...");
  const q2 = "What is the sensitivity and specificity of myometrial cysts?";
  const response2 = await askPaperQuestion({
    paperId: moralesPaper.id,
    question: q2,
    userId: ownerUserId,
    isNewThread: true,
  });

  assert.strictEqual(response2.success, true);
  assert.strictEqual(response2.insufficientEvidence, false);
  assert(response2.claims && response2.claims.length > 0);
  const claim2 = response2.claims[0];
  console.log("  Answer Text:", claim2.text);

  // Table 2 values for Myometrial cysts: Sensitivity 41.3 (33.5-49.5), Specificity 98.4 (95.5-99.7)
  assert(claim2.text.includes("41.3%"), "Must retrieve 41.3% sensitivity for myometrial cysts");
  assert(claim2.text.includes("98.4%"), "Must retrieve 98.4% specificity for myometrial cysts");
  assert(claim2.text.includes("Table 2"), "Must cite Table 2");
  assert.strictEqual(claim2.citations[0].pageNumber, 5, "Must cite Page 5");
  console.log("  ✅ [PASS] Myometrial cysts retrieved 41.3% and 98.4% without confusion.");

  // TEST 3: Multivariable models in Table 3 (Page 6) are correctly identified and cited as Table 3
  console.log("\n[3] Testing multivariable models in Table 3: 'What is the sensitivity of direct ultrasound signs model?'...");
  const q3 = "What is the sensitivity and specificity of direct ultrasound signs model?";
  const response3 = await askPaperQuestion({
    paperId: moralesPaper.id,
    question: q3,
    userId: ownerUserId,
    isNewThread: true,
  });

  assert.strictEqual(response3.success, true);
  assert.strictEqual(response3.insufficientEvidence, false);
  assert(response3.claims && response3.claims.length > 0);
  const claim3 = response3.claims[0];
  console.log("  Answer Text:", claim3.text);

  // Table 3 values for Direct ultrasound signs model: Sensitivity 60.0 (51.8-67.8), Specificity 93.7 (89.2-96.7)
  assert(claim3.text.includes("60.0%"), "Must retrieve 60.0% sensitivity for Direct ultrasound signs model");
  assert(claim3.text.includes("93.7%"), "Must retrieve 93.7% specificity for Direct ultrasound signs model");
  assert(claim3.text.includes("Table 3"), "Must cite Table 3 (NOT Table 2 or Table 4)");
  assert.strictEqual(claim3.citations[0].pageNumber, 6, "Must cite Page 6");
  console.log("  ✅ [PASS] Direct ultrasound signs model correctly cites Table 3, Page 6.");

  // TEST 4: Safe Abstention on completely unsupported question
  console.log("\n[4] Testing unsupported question: 'What was the cardiac troponin I level?'...");
  const q4 = "What was the cardiac troponin I level?";
  const response4 = await askPaperQuestion({
    paperId: moralesPaper.id,
    question: q4,
    userId: ownerUserId,
    isNewThread: true,
  });

  assert.strictEqual(response4.success, true);
  assert.strictEqual(response4.insufficientEvidence, true, "Must flag insufficient evidence");
  assert.strictEqual(response4.claims?.length || 0, 0, "Must not return fabricated claims");
  assert.strictEqual(response4.citations?.length || 0, 0, "Must not return fabricated citation anchors");
  console.log("  Answer Text:", response4.answer);
  console.log("  ✅ [PASS] Safely abstains without hallucinating numbers or citations.");

  // TEST 5: Access Control Enforcement
  console.log("\n[5] Testing access control enforcement...");
  const existingIntruder = await prisma.user.findFirst({
    where: { role: "USER", id: { not: ownerUserId } }
  });
  const intruderId = existingIntruder?.id || "cmvdfh4j70001vrtc8sk5o4ws";

  await assert.rejects(
    async () => {
      await askPaperQuestion({
        paperId: moralesPaper.id,
        question: q1,
        userId: intruderId,
        isNewThread: true,
      });
    },
    /Document not found|Unauthorized|permission/i,
    "Unauthorized user must be strictly blocked from querying private paper"
  );
  console.log("  ✅ [PASS] Unauthorized user strictly blocked from querying private paper.");

  // TEST 6: Verify Smith and Bolton Article
  console.log("\n[6] Testing Smith & Bolton article status and fallback link accessibility...");
  const smithPaper = await prisma.paper.findFirst({
    where: {
      OR: [
        { doi: { contains: "1742271" } },
        { title: { contains: "Diagnosing adenomyosis using transvaginal ultrasound in current practice" } },
      ],
    },
  });

  assert(smithPaper, "Smith & Bolton paper must exist");
  const prov = smithPaper.sourceProvenance as any;
  console.log(`  Paper: ${smithPaper.title.slice(0, 50)}...`);
  console.log(`  Classification: ${prov?.scholarlyClassification}`);
  console.log(`  Can Ingest: ${prov?.sourceResolution?.permissions?.canPlatformIngest}`);
  console.log(`  External PDF URL: ${prov?.externalPdfUrl}`);
  console.log(`  External Landing Page URL: ${prov?.externalLandingPageUrl}`);

  assert.strictEqual(
    prov?.sourceResolution?.permissions?.canPlatformIngest,
    false,
    "Smith & Bolton MUST retain unverified-ingestion restriction"
  );
  assert(
    prov?.externalLandingPageUrl &&
      (prov.externalLandingPageUrl.includes("europepmc.org") ||
        prov.externalLandingPageUrl.includes("ncbi.nlm.nih.gov")),
    "Article Page fallback link must be recorded and accessible"
  );
  console.log("  ✅ [PASS] Smith & Bolton unverified-ingestion restriction and fallback article link verified.");

  console.log("\n========================================================");
  console.log("  ALL MORALES QA ACCURACY & EXTERNAL LINK TESTS PASSED (6/6)!");
  console.log("========================================================\n");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
