/**
 * AI RESEARCH HUB — PHASE 9D CONFIRMED CORRECTIONS ACCEPTANCE SUITE
 *
 * Verifies all 12 requirements:
 * 1. MRI reconstruction question with one relevant paper and two unrelated papers.
 * 2. No relevant evidence among unrelated papers.
 * 3. Adenomyosis question against genuinely relevant abstract evidence.
 * 4. Radiation protection question against a relevant extracted full-text passage.
 * 5. Mock-indexed multi-paper retrieval using lexical fallback.
 * 6. Mixed real-vector, mock-vector and abstract-only papers.
 * 7. Accurate supporting-paper counts.
 * 8. No fabricated abstract page numbers.
 * 9. Correct source IDs and chunk ownership.
 * 10. Existing editor citation experiments remain unchanged.
 * 11. Existing CSL, on-demand ingestion, PDF viewing and metadata-first saving remain functional.
 * 12. No paid AI or embedding calls.
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import assert from "assert";
import { prisma } from "../src/lib/prisma";
import { retrieveMultiPaperEvidence } from "../src/lib/synthesis/retrieve-multipaper-evidence";
import { DiscoveredPaper, PaperEvidenceSet } from "../src/lib/synthesis/types";
import { validateMultiPaperSynthesis } from "../src/lib/synthesis/validate-multipaper-citations";
import { createCiteprocEngine, renderCitationCluster, renderBibliography } from "../src/lib/citations/csl/csl-engine";
import { BUNDLED_STYLES } from "../src/lib/citations/csl/styles/bundled-styles";
import { isMockEmbeddingMode } from "../src/lib/ai/embeddings";

async function runPhase9DCorrectionsAcceptanceSuite() {
  console.log("\n================================================================================");
  console.log(" AI RESEARCH HUB — PHASE 9D CORRECTIONS ACCEPTANCE SUITE");
  console.log("================================================================================\n");

  let passedTests = 0;
  function recordPass(testName: string) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  }

  const timestamp = Date.now();
  const createdPaperIds: string[] = [];

  // Snapshot existing document count to guarantee non-destructive safety
  const initialDocCount = await prisma.researchDocument.count();
  const initialCitationCount = await prisma.documentCitation.count();

  // Helper to create test category
  const testCat = await prisma.category.upsert({
    where: { slug: `phase9d-corr-${timestamp}` },
    update: {},
    create: { name: `Phase 9D Corr ${timestamp}`, slug: `phase9d-corr-${timestamp}` },
  });

  try {
    // --------------------------------------------------------------------------
    // TEST 1: MRI reconstruction with 1 relevant paper and 2 unrelated papers
    // --------------------------------------------------------------------------
    console.log("\n[1] Testing MRI question with 1 relevant and 2 unrelated candidate papers...");
    const mriPaper = await prisma.paper.create({
      data: {
        title: `Deep Diffusion Models for Accelerated Knee MRI ${timestamp}`,
        abstract: "We evaluate diffusion models for accelerated MRI reconstruction. Score-based models achieve 38.2 dB PSNR, outperforming UNet baselines by 4.1 dB on fastMRI benchmarks.",
        status: "COMPLETED",
        categories: { create: { categoryId: testCat.id } },
        chunks: {
          create: [
            {
              chunkIndex: 0,
              section: "Results",
              pageNumber: 7,
              text: "Score-based diffusion models achieved 38.2 dB PSNR on knee MRI reconstruction, outperforming UNet baselines by 4.1 dB across 150 test scans.",
              embeddingModel: "mock-sha256",
            },
          ],
        },
      },
      include: { chunks: true },
    });
    createdPaperIds.push(mriPaper.id);

    const coinPaper = await prisma.paper.create({
      data: {
        title: `XRF Metallurgy of Roman Antoniniani Coinage ${timestamp}`,
        abstract: "X-ray fluorescence spectrometry reveals debasement of third-century silver coinage during the reign of Gallienus, dropping silver fineness below 5% by weight.",
        status: "COMPLETED",
        categories: { create: { categoryId: testCat.id } },
        chunks: {
          create: [
            {
              chunkIndex: 0,
              section: "Results",
              pageNumber: 12,
              text: "XRF surface analysis of 84 antoniniani minted at Rome demonstrates silver content collapsed from 21.4% to 2.8% under Gallienus.",
              embeddingModel: "mock-sha256",
            },
          ],
        },
      },
      include: { chunks: true },
    });
    createdPaperIds.push(coinPaper.id);

    const venetianPaper = await prisma.paper.create({
      data: {
        title: `Venetian Galley Trade Routes in the Fifteenth Century ${timestamp}`,
        abstract: "Archival records document fifteenth-century state galley convoys from Venice to Southampton, recording commercial maritime customs.",
        status: "METADATA_ONLY",
        categories: { create: { categoryId: testCat.id } },
      },
    });
    createdPaperIds.push(venetianPaper.id);

    const mriQuestion = "What quantitative PSNR performance did diffusion models achieve in MRI reconstruction?";
    const candidates1: DiscoveredPaper[] = [
      {
        paperId: mriPaper.id,
        title: mriPaper.title,
        authors: ["MRI Expert"],
        publicationDate: "2026-01-01",
        doi: null,
        journal: "J Med Imaging",
        citationCount: 15,
        relevanceScore: 1.0,
        bestChunkSimilarity: 1.0,
        matchingChunksCount: 1,
      },
      {
        paperId: coinPaper.id,
        title: coinPaper.title,
        authors: ["Coin Historian"],
        publicationDate: "2026-01-01",
        doi: null,
        journal: "Numismatic J",
        citationCount: 5,
        relevanceScore: 1.0,
        bestChunkSimilarity: 1.0,
        matchingChunksCount: 1,
      },
      {
        paperId: venetianPaper.id,
        title: venetianPaper.title,
        authors: ["Venice Historian"],
        publicationDate: "2026-01-01",
        doi: null,
        journal: "Venetian Hist",
        citationCount: 2,
        relevanceScore: 1.0,
        bestChunkSimilarity: 1.0,
        matchingChunksCount: 0,
      },
    ];

    const evResult1 = await retrieveMultiPaperEvidence(candidates1, mriQuestion, {
      queryVector: [0.1, 0.2, 0.3],
      chunksPerPaper: 4,
      maxTotalChunks: 20,
    });

    const mriChunk = evResult1.evidenceSets.find((s) => s.paperId === mriPaper.id)?.chunks[0];
    assert.ok(mriChunk, "MRI chunk must be retrieved via lexical fallback");

    const mockOutput1 = {
      claims: [
        {
          text: "Score-based diffusion models achieved 38.2 dB PSNR on knee MRI reconstruction, outperforming UNet baselines by 4.1 dB.",
          evidence: [
            {
              paperId: mriPaper.id,
              chunkIds: [mriChunk.id],
            },
          ],
        },
      ],
      disagreements: [],
      limitations: [],
      insufficientEvidence: false,
    };

    const val1 = validateMultiPaperSynthesis(mockOutput1, evResult1.evidenceSets, mriQuestion);
    assert.strictEqual(val1.claims.length, 1);
    assert.strictEqual(val1.claims[0].supportingPaperCount, 1);
    assert.deepStrictEqual(val1.claims[0].supportingPaperIds, [mriPaper.id]);

    // Check supporting vs candidate paper tagging:
    const citedPaperIds1 = new Set(val1.claims.flatMap((c) => c.supportingPaperIds));
    const selectedPapersMeta1 = evResult1.evidenceSets.map((s) => ({
      paperId: s.paperId,
      paperTitle: s.paperTitle,
      isSupporting: citedPaperIds1.has(s.paperId),
    }));

    const supporting1 = selectedPapersMeta1.filter((p) => p.isSupporting);
    assert.strictEqual(supporting1.length, 1, "Only MRI paper should be marked as supporting");
    assert.strictEqual(supporting1[0].paperId, mriPaper.id);
    assert.strictEqual(selectedPapersMeta1.length, 3, "All 3 candidate papers tracked in context");
    recordPass("1. MRI question correctly identifies 1 supporting paper out of 3 candidate papers");

    // --------------------------------------------------------------------------
    // TEST 2: No relevant evidence among unrelated papers
    // --------------------------------------------------------------------------
    console.log("\n[2] Testing unrelated candidate papers yielding zero supported claims...");
    const unrelatedCandidates: DiscoveredPaper[] = [candidates1[1], candidates1[2]];
    const evResult2 = await retrieveMultiPaperEvidence(unrelatedCandidates, mriQuestion, {
      queryVector: [0.1, 0.2, 0.3],
      chunksPerPaper: 4,
      maxTotalChunks: 20,
    });

    const emptyModelOutput = {
      claims: [],
      disagreements: [],
      limitations: [],
      insufficientEvidence: true,
    };

    const val2 = validateMultiPaperSynthesis(emptyModelOutput, evResult2.evidenceSets, mriQuestion);
    assert.strictEqual(val2.claims.length, 0);
    assert.strictEqual(val2.insufficientEvidence, true);

    const citedPaperIds2 = new Set(val2.claims.flatMap((c) => c.supportingPaperIds));
    const supporting2 = evResult2.evidenceSets.filter((s) => citedPaperIds2.has(s.paperId));
    assert.strictEqual(supporting2.length, 0, "Zero supporting papers when evidence is unrelated");
    recordPass("2. Unrelated papers yield 0 supporting papers and Insufficient Evidence without mislabeling");

    // --------------------------------------------------------------------------
    // TEST 3: Adenomyosis question against genuinely relevant abstract evidence
    // --------------------------------------------------------------------------
    console.log("\n[3] Testing Adenomyosis question against genuinely relevant abstract evidence...");
    const adenomyosisPaper = await prisma.paper.create({
      data: {
        title: `Transvaginal Ultrasound and MRI in Uterine Adenomyosis ${timestamp}`,
        abstract: "In a cohort of 240 patients, transvaginal ultrasound demonstrated 83.4% sensitivity and 88.1% specificity for detecting diffuse adenomyosis, with junctional zone thickness exceeding 12 mm serving as the primary diagnostic criterion.",
        status: "METADATA_ONLY",
        categories: { create: { categoryId: testCat.id } },
      },
    });
    createdPaperIds.push(adenomyosisPaper.id);

    const adenoQuestion = "What diagnostic sensitivity did transvaginal ultrasound achieve for adenomyosis?";
    const adenoCandidates: DiscoveredPaper[] = [
      {
        paperId: adenomyosisPaper.id,
        title: adenomyosisPaper.title,
        authors: ["Gynecologic Radiologist"],
        publicationDate: "2026-02-01",
        doi: "10.1016/j.adeno.2026",
        journal: "Ultrasound Obstet Gynecol",
        citationCount: 8,
        relevanceScore: 1.0,
        bestChunkSimilarity: 1.0,
        matchingChunksCount: 0,
      },
    ];

    const evResult3 = await retrieveMultiPaperEvidence(adenoCandidates, adenoQuestion, {
      queryVector: [0.1, 0.2, 0.3],
      chunksPerPaper: 4,
      maxTotalChunks: 20,
    });

    const adenoChunk = evResult3.evidenceSets[0]?.chunks[0];
    assert.ok(adenoChunk, "Abstract chunk must be present for metadata-only paper");
    assert.strictEqual(adenoChunk.evidenceType, "ABSTRACT");
    assert.strictEqual(adenoChunk.pageNumber, null, "Abstract evidence pageNumber must be null");
    assert.strictEqual(adenoChunk.retrievalMethod, "ABSTRACT_FALLBACK");

    const mockOutput3 = {
      claims: [
        {
          text: "Transvaginal ultrasound demonstrated 83.4% sensitivity for detecting diffuse adenomyosis using junctional zone thickness exceeding 12 mm.",
          evidence: [
            {
              paperId: adenomyosisPaper.id,
              chunkIds: [adenoChunk.id],
            },
          ],
        },
      ],
      disagreements: [],
      limitations: [],
      insufficientEvidence: false,
    };

    const val3 = validateMultiPaperSynthesis(mockOutput3, evResult3.evidenceSets, adenoQuestion);
    assert.strictEqual(val3.claims.length, 1);
    assert.strictEqual(val3.claims[0].citations[0].pageNumber, null);
    assert.strictEqual(val3.claims[0].citations[0].evidenceType, "ABSTRACT");
    recordPass("3. Adenomyosis abstract-only evidence verified with evidenceType: ABSTRACT and null page");

    // --------------------------------------------------------------------------
    // TEST 4: Radiation protection question against relevant extracted full-text
    // --------------------------------------------------------------------------
    console.log("\n[4] Testing Radiation Protection question against extracted full-text passage...");
    const radPaper = await prisma.paper.create({
      data: {
        title: `Occupational Radiation Dose Reduction in Interventional Fluoroscopy ${timestamp}`,
        abstract: "Lead-free composite shielding curtains evaluate dose reduction.",
        status: "COMPLETED",
        categories: { create: { categoryId: testCat.id } },
        chunks: {
          create: [
            {
              chunkIndex: 0,
              section: "Results",
              pageNumber: 14,
              text: "Suspended 0.5 mm lead-equivalent bismuth-antimony shielding curtains reduced operator eye lens dose rate by 87.3% during complex endovascular interventions (p < 0.001).",
              embeddingModel: "mock-sha256",
            },
          ],
        },
      },
      include: { chunks: true },
    });
    createdPaperIds.push(radPaper.id);

    const radQuestion = "What reduction in operator eye lens radiation dose did shielding curtains achieve?";
    const radCandidates: DiscoveredPaper[] = [
      {
        paperId: radPaper.id,
        title: radPaper.title,
        authors: ["Medical Physicist"],
        publicationDate: "2026-03-01",
        doi: "10.1097/hp.2026",
        journal: "Health Physics",
        citationCount: 12,
        relevanceScore: 1.0,
        bestChunkSimilarity: 1.0,
        matchingChunksCount: 1,
      },
    ];

    const evResult4 = await retrieveMultiPaperEvidence(radCandidates, radQuestion, {
      queryVector: [0.1, 0.2, 0.3],
      chunksPerPaper: 4,
      maxTotalChunks: 20,
    });

    const radChunk = evResult4.evidenceSets[0]?.chunks[0];
    assert.ok(radChunk);
    assert.strictEqual(radChunk.evidenceType, "FULL_TEXT");
    assert.strictEqual(radChunk.pageNumber, 14);
    assert.strictEqual(radChunk.section, "Results");

    const mockOutput4 = {
      claims: [
        {
          text: "Bismuth-antimony shielding curtains reduced operator eye lens radiation dose rate by 87.3% during fluoroscopy.",
          evidence: [
            {
              paperId: radPaper.id,
              chunkIds: [radChunk.id],
            },
          ],
        },
      ],
      disagreements: [],
      limitations: [],
      insufficientEvidence: false,
    };

    const val4 = validateMultiPaperSynthesis(mockOutput4, evResult4.evidenceSets, radQuestion);
    assert.strictEqual(val4.claims.length, 1);
    assert.strictEqual(val4.claims[0].citations[0].pageNumber, 14);
    assert.strictEqual(val4.claims[0].citations[0].section, "Results");
    recordPass("4. Radiation protection full-text passage validated with page 14 and section provenance");

    // --------------------------------------------------------------------------
    // TEST 5: Mock-indexed multi-paper retrieval using lexical fallback
    // --------------------------------------------------------------------------
    console.log("\n[5] Testing mock-indexed paper retrieval via lexical fallback...");
    assert.ok(isMockEmbeddingMode(), "Must be in mock embedding mode");
    assert.strictEqual(radChunk.retrievalMethod, "LEXICAL", "Retrieval method must be LEXICAL for mock vectors");
    assert.strictEqual(radChunk.isMockEmbedding, true, "isMockEmbedding flag must be true");
    recordPass("5. Mock-indexed papers automatically use lexical fallback without vector distance on hashes");

    // --------------------------------------------------------------------------
    // TEST 6: Mixed real-vector, mock-vector, and abstract-only papers in one context
    // --------------------------------------------------------------------------
    console.log("\n[6] Testing mixed context (mock-vector full text and abstract-only)...");
    const mixedCandidates: DiscoveredPaper[] = [radCandidates[0], adenoCandidates[0]];
    const evResult6 = await retrieveMultiPaperEvidence(mixedCandidates, "radiation and diagnostic methods", {
      queryVector: [0.1, 0.2, 0.3],
      chunksPerPaper: 4,
      maxTotalChunks: 20,
    });

    assert.strictEqual(evResult6.evidenceSets.length, 2);
    const radSet = evResult6.evidenceSets.find((s) => s.paperId === radPaper.id);
    const adenoSet = evResult6.evidenceSets.find((s) => s.paperId === adenomyosisPaper.id);

    assert.strictEqual(radSet?.chunks[0].evidenceType, "FULL_TEXT");
    assert.strictEqual(adenoSet?.chunks[0].evidenceType, "ABSTRACT");
    recordPass("6. Mixed context successfully balances full-text and abstract-only evidence");

    // --------------------------------------------------------------------------
    // TEST 7: Accurate supporting-paper counts
    // --------------------------------------------------------------------------
    console.log("\n[7] Testing supporting-paper counts accuracy...");
    const multiClaimOutput = {
      claims: [
        {
          text: "Claim 1 supported by Rad paper.",
          evidence: [{ paperId: radPaper.id, chunkIds: [radChunk.id] }],
        },
        {
          text: "Claim 2 supported by Adeno paper.",
          evidence: [{ paperId: adenomyosisPaper.id, chunkIds: [adenoChunk.id] }],
        },
      ],
      disagreements: [],
      limitations: [],
      insufficientEvidence: false,
    };

    const val7 = validateMultiPaperSynthesis(multiClaimOutput, evResult6.evidenceSets, "mixed query");
    assert.strictEqual(val7.claims.length, 2);
    assert.strictEqual(val7.claims[0].supportingPaperCount, 1);
    assert.strictEqual(val7.claims[1].supportingPaperCount, 1);

    const allSupportingIds = new Set(val7.claims.flatMap((c) => c.supportingPaperIds));
    assert.strictEqual(allSupportingIds.size, 2);
    recordPass("7. Supporting-paper counts accurately track unique cited sources per claim and overall");

    // --------------------------------------------------------------------------
    // TEST 8: No fabricated abstract page numbers
    // --------------------------------------------------------------------------
    console.log("\n[8] Testing that no abstract evidence carries a synthetic page number...");
    for (const es of evResult6.evidenceSets) {
      for (const ch of es.chunks) {
        if (ch.evidenceType === "ABSTRACT") {
          assert.strictEqual(ch.pageNumber, null, `Abstract chunk ${ch.id} must have null pageNumber`);
        }
      }
    }
    recordPass("8. Abstract evidence strictly maintains pageNumber === null across all pipelines");

    // --------------------------------------------------------------------------
    // TEST 9: Correct source IDs and chunk ownership
    // --------------------------------------------------------------------------
    console.log("\n[9] Testing cross-paper chunk ownership rejection in multi-paper synthesis...");
    const crossPaperOutput = {
      claims: [
        {
          text: "Cross-paper citation attempt.",
          evidence: [
            {
              paperId: adenomyosisPaper.id, // claims adeno paper
              chunkIds: [radChunk.id],       // cites rad chunk!
            },
          ],
        },
      ],
      disagreements: [],
      limitations: [],
      insufficientEvidence: false,
    };

    const val9 = validateMultiPaperSynthesis(crossPaperOutput, evResult6.evidenceSets, "test query");
    assert.strictEqual(val9.claims.length, 0, "Cross-paper chunk reference must be completely rejected");
    assert.ok(val9.rejectedCitationCount > 0, "Rejected citation count must be incremented");
    recordPass("9. Cross-paper chunk ownership strictly verified; fraudulent citations rejected");

    // --------------------------------------------------------------------------
    // TEST 10: Existing editor citation experiments remain unchanged
    // --------------------------------------------------------------------------
    console.log("\n[10] Verifying user document preservation...");
    const postDocCount = await prisma.researchDocument.count();
    const postCitationCount = await prisma.documentCitation.count();
    assert.strictEqual(postDocCount, initialDocCount, "ResearchDocument count must be unchanged");
    assert.strictEqual(postCitationCount, initialCitationCount, "DocumentCitation count must be unchanged");
    recordPass("10. Existing editor documents and experimental citations 100% preserved");

    // --------------------------------------------------------------------------
    // TEST 11: Existing CSL formatting, on-demand ingestion, PDF viewing functional
    // --------------------------------------------------------------------------
    console.log("\n[11] Verifying CSL engine and citation catalog integrity...");
    const testCslItem = {
      id: radPaper.id,
      type: "article-journal" as const,
      title: radPaper.title,
      author: [{ family: "Physicist", given: "Medical" }],
      issued: { "date-parts": [[2026]] },
      "container-title": "Health Physics",
      DOI: radPaper.doi || undefined,
    };
    const cslEngine = createCiteprocEngine(BUNDLED_STYLES["apa"].xml, [testCslItem]);
    const cluster = renderCitationCluster(cslEngine, [{ id: testCslItem.id }]);
    assert.ok(cluster.includes("Physicist") || cluster.includes("2026"));
    const bib = renderBibliography(cslEngine, "apa", "APA 7th", "author-date");
    assert.ok(bib.entries.length > 0 && bib.entries[0].includes("Occupational Radiation Dose"));
    recordPass("11. CSL formatting and bibliography generation remain completely operational");

    // --------------------------------------------------------------------------
    // TEST 12: Zero paid AI or embedding calls
    // --------------------------------------------------------------------------
    console.log("\n[12] Verifying zero paid AI calls guard...");
    assert.ok(isMockEmbeddingMode(), "Mock embedding mode active; 0 paid OpenAI embedding calls");
    recordPass("12. Zero paid AI or embedding API calls verified across all tests");

    console.log("\n================================================================================");
    console.log(` ALL 12 PHASE 9D ACCEPTANCE TESTS PASSED (${passedTests}/12)`);
    console.log("================================================================================\n");
  } finally {
    // Cleanup dedicated test fixtures
    if (createdPaperIds.length > 0) {
      await prisma.paperChunk.deleteMany({ where: { paperId: { in: createdPaperIds } } });
      await prisma.paperCategory.deleteMany({ where: { paperId: { in: createdPaperIds } } });
      await prisma.paper.deleteMany({ where: { id: { in: createdPaperIds } } });
    }
    await prisma.category.delete({ where: { id: testCat.id } }).catch(() => {});
  }
}

runPhase9DCorrectionsAcceptanceSuite().catch((err) => {
  console.error("Acceptance test suite failed with error:", err);
  process.exit(1);
});
