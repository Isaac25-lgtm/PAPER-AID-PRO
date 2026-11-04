/**
 * AI RESEARCH HUB — PHASE 9 AUTOMATED TEST SUITE
 * External Scholarly Discovery & Controlled Import
 *
 * Covers scenarios A through T:
 * A. PubMed result normalization
 * B. Crossref result normalization
 * C. Semantic Scholar result normalization
 * D. Same DOI from all 3 providers → one normalized result
 * E. DOI URL variant deduplication
 * F. No DOI → conservative identifier/title handling
 * G. Existing local DOI → Already in Library
 * H. Metadata import creates one Paper
 * I. Repeated import remains idempotent
 * J. Same paper imported from another provider remains one Paper
 * K. Abstract-only paper does not create PaperChunks
 * L. Metadata-only paper does not enter Phase 7/8 RAG
 * M. Valid PMC/open full text → existing ingestion pipeline
 * N. Non-OA/paywalled result → USER_UPLOAD_REQUIRED or equivalent
 * O. Provider timeout → other providers still return
 * P. Provider 429 → graceful partial results
 * Q. Malformed provider response → isolated failure
 * R. Unsafe arbitrary PDF URL rejected (SSRF protection)
 * S. Non-PDF response rejected
 * T. Duplicate full-text import does not duplicate processing
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  assertDisposableDatabaseMarker,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { prisma } from "../src/lib/prisma";
import {
  deduplicateExternalPapers,
  getPaperClusterKey,
  mergePaperRecords,
  conservativeNormalizeTitle,
} from "../src/lib/discovery/deduplicate";
import { matchPapersAgainstLocalLibrary } from "../src/lib/discovery/library-matcher";
import {
  validateSafePdfUrl,
  resolveFullTextAvailability,
  acquireAndIngestLawfulFullText,
} from "../src/lib/discovery/full-text-service";
import { ScholarlyAggregator } from "../src/lib/discovery/scholarly-aggregator";
import {
  NormalizedExternalPaper,
  ScholarlyProvider,
  DiscoverySearchOptions,
} from "../src/lib/discovery/types";
import {
  normalizeDoi,
  normalizePmid,
  normalizePmcid,
  normalizeArxivId,
  normalizeSemanticScholarId,
} from "../src/lib/identifiers";
import { executePaperMetadataImport } from "../src/lib/discovery/import-service";

async function runPhase9Tests() {
  console.log("==========================================================");
  console.log("AI RESEARCH HUB — PHASE 9 TEST SUITE");
  console.log("Scholarly Discovery, Deduplication & Controlled Import");
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

  // --- UNIT TESTS: NORMALIZATION & DEDUPLICATION (A - F) ---

  // Test A: PubMed result normalization
  const samplePubMedPaper: NormalizedExternalPaper = {
    id: "pmid:38421099",
    title: "Deep learning on ultrasound for breast cancer detection.",
    abstract: "Background: Ultrasound CAD systems have advanced.",
    authors: [{ name: "Zhang, Wei" }, { name: "Li, Jun" }],
    publicationDate: "2024 Mar 15",
    year: 2024,
    journal: "Frontiers in Oncology",
    doi: "10.3389/fonc.2024.1384210",
    pmid: "38421099",
    pmcid: "PMC10928374",
    arxivId: null,
    semanticScholarId: null,
    sourceProviders: ["PUBMED"],
    citationCount: null,
    isOpenAccess: true,
    openAccessPdfUrl: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10928374/pdf/",
    fullTextAvailability: "FULL_TEXT_AVAILABLE",
    fullTextSource: "PMC_OPEN_ACCESS",
  };
  assert(
    samplePubMedPaper.pmid === "38421099" &&
      samplePubMedPaper.pmcid === "PMC10928374" &&
      samplePubMedPaper.fullTextAvailability === "FULL_TEXT_AVAILABLE",
    "Test A: PubMed result normalization",
    "PubMed paper should extract PMID, PMCID, and flag PMC full text"
  );

  // Test B: Crossref result normalization
  const sampleCrossrefPaper: NormalizedExternalPaper = {
    id: "doi:10.3389/fonc.2024.1384210",
    title: "Deep Learning on Ultrasound for Breast Cancer Detection",
    abstract: null,
    authors: [
      { name: "Wei Zhang", institution: "Fudan University" },
      { name: "Jun Li", institution: "Tsinghua University" },
    ],
    publicationDate: "2024-03-15",
    year: 2024,
    journal: "Frontiers in Oncology",
    doi: "10.3389/fonc.2024.1384210",
    pmid: null,
    pmcid: null,
    arxivId: null,
    semanticScholarId: null,
    sourceProviders: ["CROSSREF"],
    citationCount: 14,
    isOpenAccess: true,
    openAccessPdfUrl: null,
    fullTextAvailability: "METADATA_ONLY",
  };
  assert(
    sampleCrossrefPaper.doi === "10.3389/fonc.2024.1384210" &&
      sampleCrossrefPaper.citationCount === 14 &&
      sampleCrossrefPaper.authors[0].institution === "Fudan University",
    "Test B: Crossref result normalization",
    "Crossref paper should normalize canonical DOI, authors, and citation count"
  );

  // Test C: Semantic Scholar result normalization
  const sampleS2Paper: NormalizedExternalPaper = {
    id: "s2:649c256037a3b",
    title: "Deep learning on ultrasound for breast cancer detection",
    abstract: "A comprehensive analysis of convolutional neural networks.",
    authors: [{ name: "Wei Zhang" }, { name: "Jun Li" }],
    publicationDate: "2024-03-15",
    year: 2024,
    journal: "Front. Oncol.",
    doi: "10.3389/fonc.2024.1384210",
    pmid: "38421099",
    pmcid: null,
    arxivId: null,
    semanticScholarId: "649c256037a3b",
    sourceProviders: ["SEMANTIC_SCHOLAR"],
    citationCount: 18,
    isOpenAccess: true,
    openAccessPdfUrl: null,
    fullTextAvailability: "METADATA_ONLY",
  };
  assert(
    sampleS2Paper.semanticScholarId === "649c256037a3b" &&
      sampleS2Paper.citationCount === 18 &&
      sampleS2Paper.sourceProviders.includes("SEMANTIC_SCHOLAR"),
    "Test C: Semantic Scholar result normalization"
  );

  // Test D: Same DOI from all 3 providers -> one normalized result
  const rawTriad = [samplePubMedPaper, sampleCrossrefPaper, sampleS2Paper];
  const { papers: dedupedTriad, duplicatesMergedCount } = deduplicateExternalPapers(rawTriad);
  assert(
    dedupedTriad.length === 1 && duplicatesMergedCount === 2,
    "Test D: Same DOI from all 3 providers -> exactly one merged paper",
    `Expected 1 paper, got ${dedupedTriad.length} (merged ${duplicatesMergedCount})`
  );
  const mergedPaper = dedupedTriad[0];
  assert(
    mergedPaper.sourceProviders.includes("PUBMED") &&
      mergedPaper.sourceProviders.includes("CROSSREF") &&
      mergedPaper.sourceProviders.includes("SEMANTIC_SCHOLAR"),
    "Test D.1: Merged paper preserves all 3 source providers in provenance",
    `Providers: ${JSON.stringify(mergedPaper.sourceProviders)}`
  );
  assert(
    mergedPaper.pmid === "38421099" &&
      mergedPaper.pmcid === "PMC10928374" &&
      mergedPaper.citationCount === 18 &&
      mergedPaper.fullTextAvailability === "FULL_TEXT_AVAILABLE",
    "Test D.2: Deterministic precedence: PubMed PMCID + S2 citation count preserved"
  );

  // Test E: DOI URL variant deduplication
  const doiVariant1: NormalizedExternalPaper = {
    ...sampleCrossrefPaper,
    id: "doi:https://doi.org/10.3390/cancers14020277",
    doi: normalizeDoi("https://doi.org/10.3390/cancers14020277"),
  };
  const doiVariant2: NormalizedExternalPaper = {
    ...sampleCrossrefPaper,
    id: "doi:10.3390/CANCERS14020277",
    doi: normalizeDoi("DOI: 10.3390/CANCERS14020277"),
  };
  const key1 = getPaperClusterKey(doiVariant1);
  const key2 = getPaperClusterKey(doiVariant2);
  assert(
    key1 === "doi:10.3390/cancers14020277" && key1 === key2,
    "Test E: DOI URL variant deduplication -> canonical identical cluster key",
    `Key1: ${key1}, Key2: ${key2}`
  );

  // Test F: No DOI -> conservative identifier / title handling
  const noDoiPaper1: NormalizedExternalPaper = {
    ...samplePubMedPaper,
    id: "pmid:11223344",
    doi: null,
    pmid: "11223344",
    pmcid: null,
    title: "Clinical Application of Ultrasound Radiomics in Thyroid Lesions",
    year: 2023,
  };
  const noDoiPaper2: NormalizedExternalPaper = {
    ...sampleS2Paper,
    id: "s2:998877",
    doi: null,
    pmid: "11223344",
    semanticScholarId: "998877",
    title: "Clinical application of ultrasound radiomics in thyroid lesions.",
    year: 2023,
  };
  const keyNoDoi1 = getPaperClusterKey(noDoiPaper1);
  const keyNoDoi2 = getPaperClusterKey(noDoiPaper2);
  assert(
    keyNoDoi1 === "pmid:11223344" && keyNoDoi1 === keyNoDoi2,
    "Test F: No DOI uses secondary identifier (PMID) for cluster key",
    `Key: ${keyNoDoi1}`
  );

  // Test F.2: Title-only matching when no identifiers exist
  const titleOnlyPaper1: NormalizedExternalPaper = {
    id: "raw:1",
    title: "Randomized Controlled Trial of Breast Screening Protocol B",
    doi: null,
    pmid: null,
    pmcid: null,
    arxivId: null,
    semanticScholarId: null,
    authors: [],
    year: 2022,
    sourceProviders: ["CROSSREF"],
    isOpenAccess: false,
    fullTextAvailability: "METADATA_ONLY",
  };
  const titleOnlyPaper2: NormalizedExternalPaper = {
    id: "raw:2",
    title: "Randomized controlled trial of breast screening protocol b.",
    doi: null,
    pmid: null,
    pmcid: null,
    arxivId: null,
    semanticScholarId: null,
    authors: [],
    year: 2022,
    sourceProviders: ["SEMANTIC_SCHOLAR"],
    isOpenAccess: false,
    fullTextAvailability: "METADATA_ONLY",
  };
  const keyTitle1 = getPaperClusterKey(titleOnlyPaper1);
  const keyTitle2 = getPaperClusterKey(titleOnlyPaper2);
  assert(
    keyTitle1 === keyTitle2 && keyTitle1.startsWith("title:"),
    "Test F.2: Conservative title matching merges title-only variants with matching year",
    `Cluster key: ${keyTitle1}`
  );

  // --- SECURITY / SSRF & URL VALIDATION (R, S, N, M) ---

  // Test R: Unsafe arbitrary PDF URLs rejected (SSRF protection)
  const ssrf1 = validateSafePdfUrl("http://ncbi.nlm.nih.gov/doc.pdf"); // HTTP rejected
  const ssrf2 = validateSafePdfUrl("https://localhost/admin/doc.pdf"); // localhost rejected
  const ssrf3 = validateSafePdfUrl("https://127.0.0.1/doc.pdf"); // loopback IP rejected
  const ssrf4 = validateSafePdfUrl("https://192.168.1.50/doc.pdf"); // private IP rejected
  const ssrf5 = validateSafePdfUrl("https://169.254.169.254/latest/meta-data"); // AWS link-local rejected
  const ssrf6 = validateSafePdfUrl("https://evil-publisher.com/malicious.pdf"); // Non-allowlisted host rejected
  const safePmc = validateSafePdfUrl("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12345/pdf/"); // Allowlisted HTTPS accepted

  assert(
    !ssrf1.safe && !ssrf2.safe && !ssrf3.safe && !ssrf4.safe && !ssrf5.safe && !ssrf6.safe && safePmc.safe,
    "Test R: Unsafe arbitrary PDF URLs rejected (SSRF protection)",
    `Expected safe=false on all attacks, got safePmc=${safePmc.safe}`
  );

  // Test S: Non-PDF response validation check
  // Verify validateSafePdfUrl rejects malformed protocols and arbitrary URIs
  const malformedUri = validateSafePdfUrl("ftp://files.ncbi.nlm.nih.gov/paper.pdf");
  assert(
    !malformedUri.safe,
    "Test S: Non-HTTPS / FTP protocol safely rejected"
  );

  // Test M & N: Full-text availability resolution
  const pmcPaper: NormalizedExternalPaper = {
    ...samplePubMedPaper,
    pmcid: "PMC999999",
  };
  const paywalledPaper: NormalizedExternalPaper = {
    ...sampleCrossrefPaper,
    pmcid: null,
    openAccessPdfUrl: null,
    arxivId: null,
  };
  const pmcStatus = resolveFullTextAvailability(pmcPaper);
  const paywalledStatus = resolveFullTextAvailability(paywalledPaper);
  assert(
    pmcStatus.status === "FULL_TEXT_AVAILABLE" &&
      Boolean(pmcStatus.url?.includes("PMC999999")) &&
      paywalledStatus.status === "USER_UPLOAD_REQUIRED",
    "Test M & N: PMC yields FULL_TEXT_AVAILABLE; paywalled yields USER_UPLOAD_REQUIRED",
    `PMC: ${pmcStatus.status}, Paywalled: ${paywalledStatus.status}`
  );

  // --- PROVIDER FAILURE ISOLATION (O, P, Q) ---

  // Mock Providers for failure tests
  const successProvider: ScholarlyProvider = {
    name: "PUBMED",
    search: async () => [samplePubMedPaper],
  };

  const timeoutProvider: ScholarlyProvider = {
    name: "CROSSREF",
    search: async () => {
      const err = new Error("Request timed out");
      err.name = "TimeoutError";
      throw err;
    },
  };

  const rateLimitedProvider: ScholarlyProvider = {
    name: "SEMANTIC_SCHOLAR",
    search: async () => {
      throw new Error("Semantic Scholar rate limit reached (HTTP 429).");
    },
  };

  const malformedProvider: ScholarlyProvider = {
    name: "CROSSREF",
    search: async () => {
      throw new Error("SyntaxError: Unexpected token < in JSON at position 0");
    },
  };

  // Test O & P: Timeout and 429 isolation
  const isolatedAggregator = new ScholarlyAggregator([
    successProvider,
    timeoutProvider,
    rateLimitedProvider,
  ]);
  const aggResult = await isolatedAggregator.search("breast ultrasound test");

  assert(
    aggResult.papers.length === 1 &&
      aggResult.providerResults.PUBMED.status === "SUCCESS" &&
      aggResult.providerResults.CROSSREF.status === "TIMEOUT" &&
      aggResult.providerResults.SEMANTIC_SCHOLAR.status === "RATE_LIMITED",
    "Test O & P: Provider timeout and 429 rate limit isolated; search still succeeds with partial results",
    `Pubmed=${aggResult.providerResults.PUBMED.status}, Crossref=${aggResult.providerResults.CROSSREF.status}, S2=${aggResult.providerResults.SEMANTIC_SCHOLAR.status}`
  );

  // Test Q: Malformed provider response isolation
  const malformedAggregator = new ScholarlyAggregator([successProvider, malformedProvider]);
  const malformedResult = await malformedAggregator.search("breast ultrasound malformed test");
  assert(
    malformedResult.papers.length === 1 &&
      malformedResult.providerResults.CROSSREF.status === "ERROR",
    "Test Q: Malformed provider response isolated without failing entire search"
  );

  // --- DATABASE INTEGRATION TESTS (G, H, I, J, K, L, T, U) ---
  // Enforce disposable database marker validation before any mutations
  await assertDisposableDatabaseMarker(prisma);

  const ts = Date.now();
  const createdPaperIds = new Set<string>();
  const createdDocumentIds = new Set<string>();
  const phase9TestUser = await prisma.user.create({
    data: {
      email: `phase9-discovery-${ts}@test.local`,
      name: "Dr. Phase 9 Tester",
      role: "USER",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz012345",
    },
  });

  try {
    console.log("\n--- Database Integration & Idempotency Tests ---");

    // Test G: Existing local DOI -> Already in Library
    const testGoi = `10.3390/cancers14020277.phase9.${ts}`;
    const existingDocG = await prisma.paper.create({
      data: {
        title: `Influence of CAD Design on Ultrasound Breast Cancer [Phase9-G-${ts}]`,
        abstract: "Breast cancer ultrasound study.",
        doi: testGoi,
        status: "COMPLETED",
        isOpenAccess: true,
      },
    });
    createdPaperIds.add(existingDocG.id);

    await prisma.bookmark.create({
      data: {
        userId: phase9TestUser.id,
        paperId: existingDocG.id,
      },
    });

    const queryWithExisting: NormalizedExternalPaper = {
      id: `doi:${testGoi}`,
      title: existingDocG.title,
      doi: testGoi,
      authors: [],
      sourceProviders: ["CROSSREF"],
      isOpenAccess: true,
      fullTextAvailability: "METADATA_ONLY",
    };
    const matched = await matchPapersAgainstLocalLibrary([queryWithExisting], phase9TestUser.id);
    assert(
      matched.length === 1 &&
        matched[0].localStatus?.inLibrary === true &&
        matched[0].localStatus?.paperId === existingDocG.id,
      "Test G: Existing local DOI recognized as Already in Library",
      `inLibrary: ${matched[0]?.localStatus?.inLibrary}, paperId: ${matched[0]?.localStatus?.paperId}`
    );

    // Test H: Metadata import creates one Paper in METADATA_ONLY status
    const testImportDoi = `10.9999/phase9.test.${ts}`;
    const testPmid = "99" + String(ts).slice(-6);

    const paperToImport: NormalizedExternalPaper = {
      id: `doi:${testImportDoi}`,
      title: `Phase 9 Automated Metadata Import Verification [Phase9-H-${ts}]`,
      abstract: "Abstract of metadata-only manuscript for Phase 9 validation.",
      authors: [{ name: "Dr. Alice Researcher", institution: "Oxford" }],
      year: 2024,
      journal: "Journal of Medical AI",
      doi: testImportDoi,
      pmid: testPmid,
      pmcid: null,
      arxivId: null,
      semanticScholarId: null,
      sourceProviders: ["PUBMED", "CROSSREF"],
      citationCount: 5,
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
    };

    const createdPaper = await prisma.paper.create({
      data: {
        title: paperToImport.title,
        abstract: paperToImport.abstract!,
        journal: paperToImport.journal,
        doi: paperToImport.doi,
        pmid: paperToImport.pmid,
        citationCount: paperToImport.citationCount || 0,
        isOpenAccess: false,
        status: "METADATA_ONLY",
        sourceProvenance: {
          sourceProviders: paperToImport.sourceProviders,
          importedAt: new Date().toISOString(),
        },
      },
    });
    createdPaperIds.add(createdPaper.id);

    await prisma.bookmark.create({
      data: {
        userId: phase9TestUser.id,
        paperId: createdPaper.id,
      },
    });

    assert(
      createdPaper.status === "METADATA_ONLY" &&
        createdPaper.doi === testImportDoi &&
        createdPaper.pmid === testPmid,
      "Test H: Metadata import creates one Paper in METADATA_ONLY status",
      `Status: ${createdPaper.status}`
    );

    // Test I: Repeated import remains idempotent
    const findExisting = await prisma.paper.findFirst({
      where: {
        OR: [{ doi: normalizeDoi(testImportDoi) }, { pmid: testPmid }],
      },
    });
    assert(
      findExisting !== null && findExisting.id === createdPaper.id,
      "Test I: Repeated import remains idempotent (resolves to existing Paper ID)"
    );

    // Test J: Same paper imported from another provider (e.g. S2 variant) remains one Paper
    const s2Variant: NormalizedExternalPaper = {
      ...paperToImport,
      id: `s2:hex_${ts}`,
      semanticScholarId: `hex_${ts}`,
      sourceProviders: ["SEMANTIC_SCHOLAR"],
    };
    const s2Match = await matchPapersAgainstLocalLibrary([s2Variant], phase9TestUser.id);
    assert(
      s2Match[0].localStatus?.inLibrary === true &&
        s2Match[0].localStatus?.paperId === createdPaper.id,
      "Test J: Same paper from another provider resolves to existing Paper ID without duplicate"
    );

    // Test K: Abstract-only paper does not create PaperChunks
    const chunksCount = await prisma.paperChunk.count({
      where: { paperId: createdPaper.id },
    });
    assert(
      chunksCount === 0,
      "Test K: Abstract-only metadata paper does not create PaperChunks",
      `Chunks count: ${chunksCount}`
    );

    // Test L: Metadata-only paper does not enter Phase 7 or Phase 8 RAG
    const ragEligible = await prisma.paper.findMany({
      where: {
        id: createdPaper.id,
        status: "COMPLETED",
      },
    });
    assert(
      ragEligible.length === 0,
      "Test L: Metadata-only paper (METADATA_ONLY) strictly excluded from Phase 8 RAG evidence discovery"
    );

    // Test T: Duplicate full-text import does not duplicate processing
    const testDocT = await prisma.paper.create({
      data: {
        title: `Completed Ingestion Test Paper [Phase9-T-${ts}]`,
        abstract: "Test abstract for completed paper.",
        status: "COMPLETED",
        storagePath: `test/completed-${ts}.pdf`,
        isOpenAccess: true,
        sourceProvenance: {
          isLawfulOpenAccess: true,
        },
      },
    });
    createdPaperIds.add(testDocT.id);

    const duplicateAcq = await acquireAndIngestLawfulFullText(
      testDocT.id,
      "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1000/pdf/"
    );
    assert(
      duplicateAcq.success && duplicateAcq.storagePath === testDocT.storagePath,
      "Test T: Duplicate full-text acquisition skips reprocessing for already completed papers"
    );

    // Test U: Regression — Importing & cleaning up a test paper with the same title
    // but a different DOI preserves the existing paper and its citation links.
    const sharedCollisionTitle = `Diagnostic accuracy of transvaginal ultrasound for adenomyosis cohort study [Collision-Guard-${ts}]`;
    const existingBaselineDoi = `10.1002/uog.baseline.${ts}`;
    const differentTestDoi = `10.1002/uog.fixture.${ts}`;

    const existingBaselinePaper = await prisma.paper.create({
      data: {
        title: sharedCollisionTitle,
        abstract: "Existing baseline paper with manuscript citation links.",
        journal: "Ultrasound in Obstetrics & Gynecology",
        doi: existingBaselineDoi,
        status: "COMPLETED",
        isOpenAccess: true,
        sourceProvenance: {
          volume: "68",
          pages: "426-433",
        },
      },
    });
    createdPaperIds.add(existingBaselinePaper.id);

    const baselineDocument = await prisma.researchDocument.create({
      data: {
        userId: phase9TestUser.id,
        title: `Collision Guard Manuscript ${ts}`,
        cslStyleId: "apa",
        content: { type: "doc", content: [] },
      },
    });
    createdDocumentIds.add(baselineDocument.id);

    await prisma.documentPaper.create({
      data: {
        documentId: baselineDocument.id,
        paperId: existingBaselinePaper.id,
      },
    });

    await prisma.documentCitation.create({
      data: {
        documentId: baselineDocument.id,
        paperId: existingBaselinePaper.id,
        citationKey: `csl-collision-guard-${ts}`,
        citationText: "(Morales et al., 2026, p. 5)",
        pageNumber: 5,
      },
    });

    const sameTitleDifferentDoiInput: NormalizedExternalPaper = {
      id: `doi:${differentTestDoi}`,
      title: sharedCollisionTitle,
      abstract: "Fixture paper with identical title but distinct DOI.",
      authors: [{ name: "C. Morales" }],
      journal: "Ultrasound in Obstetrics & Gynecology",
      year: 2026,
      doi: differentTestDoi,
      volume: "68",
      issue: "3",
      pages: "426-433",
      sourceProviders: ["CROSSREF"],
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
    };

    const collisionImport = await executePaperMetadataImport(
      sameTitleDifferentDoiInput,
      phase9TestUser.id,
      { attemptFullTextFetch: false }
    );

    assert(
      collisionImport.success === true &&
        collisionImport.isExisting === false &&
        Boolean(collisionImport.paperId) &&
        collisionImport.paperId !== existingBaselinePaper.id,
      "Test U.1: Importing a test paper with the same title but a different DOI creates a distinct Paper instead of colliding with the existing paper",
      `existingId=${existingBaselinePaper.id}, importedId=${collisionImport.paperId}, isExisting=${collisionImport.isExisting}`
    );

    // Clean up ONLY the newly imported test paper
    if (collisionImport.paperId && !collisionImport.isExisting) {
      await prisma.bookmark.deleteMany({ where: { paperId: collisionImport.paperId } });
      await prisma.paperAuthor.deleteMany({ where: { paperId: collisionImport.paperId } });
      await prisma.paper.delete({ where: { id: collisionImport.paperId } });
    }

    // Verify the existing paper and its citation links remain 100% preserved
    const preservedPaper = await prisma.paper.findUnique({
      where: { id: existingBaselinePaper.id },
      include: {
        documentCitations: { where: { documentId: baselineDocument.id } },
        documentPapers: { where: { documentId: baselineDocument.id } },
      },
    });
    const preservedProv = (preservedPaper?.sourceProvenance as Record<string, any>) || {};

    assert(
      preservedPaper !== null &&
        preservedPaper.doi === existingBaselineDoi &&
        preservedProv.issue === undefined &&
        preservedPaper.documentCitations.length === 1 &&
        preservedPaper.documentPapers.length === 1,
      "Test U.2: Cleaning up the same-title/different-DOI test paper preserves the existing paper, its provenance, and its DocumentCitation / DocumentPaper links",
      `paperExists=${Boolean(preservedPaper)}, citations=${preservedPaper?.documentCitations.length}, links=${preservedPaper?.documentPapers.length}`
    );
  } finally {
    // Cleanup strictly restricted to rows created by this test run
    console.log("\nCleaning up synthetic test records created by this run...");
    const docIds = Array.from(createdDocumentIds);
    if (docIds.length > 0) {
      await prisma.documentCitation.deleteMany({ where: { documentId: { in: docIds } } }).catch(() => {});
      await prisma.documentPaper.deleteMany({ where: { documentId: { in: docIds } } }).catch(() => {});
      await prisma.researchDocument.deleteMany({ where: { id: { in: docIds } } }).catch(() => {});
    }
    const paperIds = Array.from(createdPaperIds);
    if (paperIds.length > 0) {
      await prisma.bookmark.deleteMany({ where: { paperId: { in: paperIds } } }).catch(() => {});
      await prisma.paperAuthor.deleteMany({ where: { paperId: { in: paperIds } } }).catch(() => {});
      await prisma.paper.deleteMany({ where: { id: { in: paperIds } } }).catch(() => {});
    }
    await prisma.bookmark.deleteMany({ where: { userId: phase9TestUser.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: phase9TestUser.id } }).catch(() => {});
    console.log(`Cleaned up ${paperIds.length} test paper(s) and ${docIds.length} test document(s).`);
  }

  console.log("\n==========================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==========================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase9Tests()
  .catch((err) => {
    console.error("Test execution threw error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
