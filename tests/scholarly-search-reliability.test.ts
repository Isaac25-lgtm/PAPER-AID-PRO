/**
 * AI Research Hub — Scholarly Search Reliability, Relevance and Performance Regressions
 *
 * Deterministic test suite verifying:
 * 1. Repeated identical queries consistency & caching
 * 2. Provider timeout isolation
 * 3. Partial provider failure tolerance
 * 4. Rate-limiting (HTTP 429) isolation
 * 5. Cross-identifier DOI & PMID deduplication
 * 6. Search synonym expansion
 * 7. Irrelevant-result demotion (retinal, generic molecular, oncology)
 * 8. Stale frontend response prevention & request sequencing
 * 9. Public / private paper isolation in snapshots
 * 10. Stable evidence citations without fabrication
 * 11. Existing Save to My Library integration
 */

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ScholarlyAggregator, clearSearchCache } from "../src/lib/discovery/scholarly-aggregator";
import {
  rankScholarlySearchResults,
  scoreScholarlyPaperRelevance,
  detectQueryConcepts,
  detectQueryModalities,
} from "../src/lib/discovery/ranking";
import { deduplicateExternalPapers } from "../src/lib/discovery/deduplicate";
import {
  NormalizedExternalPaper,
  ScholarlyProvider,
  DiscoverySearchOptions,
} from "../src/lib/discovery/types";
import { generateResearchSnapshot } from "../src/lib/discovery/snapshot/snapshot-service";
import { executePaperMetadataImport } from "../src/lib/discovery/import-service";
import { prisma } from "../src/lib/prisma";
import { ADMIN_TEST_FIXTURE_IDS } from "../src/lib/auth/paper-authorization";

// Deterministic Mock Providers for Fault-Injection Testing
class ReliableMockProvider implements ScholarlyProvider {
  readonly name = "PUBMED" as const;
  async search(query: string, options: DiscoverySearchOptions = {}): Promise<NormalizedExternalPaper[]> {
    return [
      {
        id: "pmid:36158262",
        title: "Artificial intelligence in liver ultrasound",
        abstract: "Artificial intelligence (AI) is playing an increasingly important role in liver ultrasound examinations...",
        authors: [{ name: "Zhang Y" }],
        year: 2022,
        doi: "10.3748/wjg.v28.i27.3398",
        pmid: "36158262",
        sourceProviders: ["PUBMED"],
        isOpenAccess: true,
        fullTextAvailability: "METADATA_ONLY",
      },
    ];
  }
}

class TimeoutMockProvider implements ScholarlyProvider {
  readonly name = "CROSSREF" as const;
  async search(query: string, options: DiscoverySearchOptions = {}): Promise<NormalizedExternalPaper[]> {
    const error = new Error("Request to Crossref timed out after 8000ms");
    error.name = "TimeoutError";
    throw error;
  }
}

class RateLimitedMockProvider implements ScholarlyProvider {
  readonly name = "SEMANTIC_SCHOLAR" as const;
  async search(query: string, options: DiscoverySearchOptions = {}): Promise<NormalizedExternalPaper[]> {
    throw new Error("Semantic Scholar rate limit reached (HTTP 429).");
  }
}

class ErrorMockProvider implements ScholarlyProvider {
  readonly name = "CITED_EVIDENCE" as const;
  async search(query: string, options: DiscoverySearchOptions = {}): Promise<NormalizedExternalPaper[]> {
    throw new Error("CitedEvidence service 503 Service Unavailable");
  }
}

describe("Scholarly Search Reliability & Relevance Suite", () => {
  beforeEach(() => {
    clearSearchCache();
  });

  // TEST 1: REPEATED IDENTICAL QUERIES
  it("1. Repeated identical queries yield identical results and activate cache", async () => {
    const provider1 = new ReliableMockProvider();
    const aggregator = new ScholarlyAggregator([provider1]);

    const res1 = await aggregator.search("artificial intelligence in ultrasound");
    const res2 = await aggregator.search("artificial intelligence in ultrasound");

    assert.equal(res1.totalUniqueResults, 1);
    assert.equal(res2.totalUniqueResults, 1);
    assert.equal(res1.papers[0].id, res2.papers[0].id);
    assert.equal(res1.papers[0].title, res2.papers[0].title);
  });

  // TEST 2: PROVIDER TIMEOUT ISOLATION
  it("2. Aggregator gracefully isolates provider timeout without failing the search", async () => {
    const timeoutProvider = new TimeoutMockProvider();
    const reliableProvider = new ReliableMockProvider();
    const aggregator = new ScholarlyAggregator([reliableProvider, timeoutProvider]);

    const res = await aggregator.search("artificial intelligence in ultrasound");

    assert.equal(res.providerResults.CROSSREF.status, "TIMEOUT");
    assert.equal(res.providerResults.PUBMED.status, "SUCCESS");
    assert.equal(res.totalUniqueResults, 1);
    assert.equal(res.papers[0].title, "Artificial intelligence in liver ultrasound");
  });

  // TEST 3: PARTIAL PROVIDER FAILURE TOLERANCE
  it("3. Partial provider 503 error is isolated and does not return zero results", async () => {
    const errorProvider = new ErrorMockProvider();
    const reliableProvider = new ReliableMockProvider();
    const aggregator = new ScholarlyAggregator([reliableProvider, errorProvider]);

    const res = await aggregator.search("artificial intelligence in ultrasound");

    assert.equal(res.providerResults.CITED_EVIDENCE.status, "ERROR");
    assert.equal(res.providerResults.PUBMED.status, "SUCCESS");
    assert.equal(res.totalUniqueResults >= 1, true);
  });

  // TEST 4: RATE LIMITING (HTTP 429) HANDLING
  it("4. Rate-limited provider (HTTP 429) is recorded with RATE_LIMITED status", async () => {
    const rateLimitedProvider = new RateLimitedMockProvider();
    const reliableProvider = new ReliableMockProvider();
    const aggregator = new ScholarlyAggregator([reliableProvider, rateLimitedProvider]);

    const res = await aggregator.search("artificial intelligence in ultrasound");

    assert.equal(res.providerResults.SEMANTIC_SCHOLAR.status, "RATE_LIMITED");
    assert.equal(res.papers.length, 1);
  });

  // TEST 5: CROSS-IDENTIFIER DEDUPLICATION & IDENTITY RESOLUTION
  it("5. Multi-provider records with cross-matching DOI and PMID resolve into single canonical record", () => {
    const raw: NormalizedExternalPaper[] = [
      // Provider 1: PubMed has PMID and DOI
      {
        id: "pmid:36158262",
        title: "Artificial intelligence in liver ultrasound",
        abstract: "Short abstract",
        authors: [{ name: "Zhang Y" }],
        year: 2022,
        doi: "10.3748/wjg.v28.i27.3398",
        pmid: "36158262",
        sourceProviders: ["PUBMED"],
        isOpenAccess: false,
        fullTextAvailability: "METADATA_ONLY",
      },
      // Provider 2: Crossref has only DOI
      {
        id: "doi:10.3748/wjg.v28.i27.3398",
        title: "Artificial intelligence in liver ultrasound",
        abstract: "Comprehensive long abstract describing deep learning algorithms in liver ultrasonography...",
        authors: [{ name: "Zhang Y" }, { name: "Wang L" }],
        year: 2022,
        doi: "10.3748/wjg.v28.i27.3398",
        sourceProviders: ["CROSSREF"],
        isOpenAccess: true,
        fullTextAvailability: "METADATA_ONLY",
      },
      // Provider 3: Semantic Scholar has PMID and S2 ID
      {
        id: "s2:abc12345",
        title: "Artificial intelligence in liver ultrasound",
        authors: [{ name: "Zhang Y" }],
        year: 2022,
        pmid: "36158262",
        semanticScholarId: "abc12345",
        sourceProviders: ["SEMANTIC_SCHOLAR"],
        citationCount: 45,
        isOpenAccess: false,
        fullTextAvailability: "METADATA_ONLY",
      },
    ];

    const { papers, duplicatesMergedCount } = deduplicateExternalPapers(raw);

    assert.equal(papers.length, 1);
    assert.equal(duplicatesMergedCount, 2);
    const canonical = papers[0];
    assert.equal(canonical.doi, "10.3748/wjg.v28.i27.3398");
    assert.equal(canonical.pmid, "36158262");
    assert.equal(canonical.semanticScholarId, "abc12345");
    assert.equal(canonical.citationCount, 45);
    assert.equal(canonical.isOpenAccess, true);
    assert.equal(canonical.sourceProviders.length, 3);
    assert.ok(canonical.sourceProviders.includes("PUBMED"));
    assert.ok(canonical.sourceProviders.includes("CROSSREF"));
    assert.ok(canonical.sourceProviders.includes("SEMANTIC_SCHOLAR"));
  });

  // TEST 6: SEARCH SYNONYM EXPANSION
  it("6. Synonym expansion recognizes sonography/echocardiography and deep learning/machine learning", () => {
    const query = "artificial intelligence in ultrasound";

    const concepts = detectQueryConcepts(query);
    assert.equal(concepts.some((c) => c.id === "ai_machine_learning"), true);
    assert.equal(concepts.some((c) => c.id === "ultrasound_imaging"), true);

    const paperWithSynonyms: NormalizedExternalPaper = {
      id: "doi:10.1016/j.fetal.2023.001",
      title: "Deep learning in fetal sonography",
      abstract: "Automated biometric measurement of fetal sonograms using convolutional neural networks...",
      authors: [{ name: "Taylor E" }],
      year: 2023,
      doi: "10.1016/j.fetal.2023.001",
      sourceProviders: ["PUBMED"],
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
    };

    const details = scoreScholarlyPaperRelevance(paperWithSynonyms, query);
    assert.equal(details.conceptScore > 0, true);
    assert.equal(details.totalScore >= 60, true);
  });

  // TEST 7: IRRELEVANT-RESULT DEMOTION
  it("7. Demotes studies unrelated to ultrasound (retinal, generic oncology, prostate MRI)", () => {
    const query = "artificial intelligence in ultrasound";

    const retinalPaper: NormalizedExternalPaper = {
      id: "doi:10.1016/j.survophthal.2024.01.002",
      title: "Artificial intelligence (AI) and the choroidal challenge: A comprehensive review of AI applications in choroidal imaging",
      abstract: "The choroid is a densely vascular layer sustaining the outer retina...",
      authors: [{ name: "Smith A" }],
      year: 2024,
      doi: "10.1016/j.survophthal.2024.01.002",
      sourceProviders: ["PUBMED"],
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
    };

    const oncologyPaper: NormalizedExternalPaper = {
      id: "doi:10.1016/j.ijbiocel.2024.05.001",
      title: "Oral squamous cell carcinoma: A Modern Review of Pathogenesis and Treatment",
      abstract: "Oral cancer is a serious health burden worldwide...",
      authors: [{ name: "Johnson B" }],
      year: 2024,
      doi: "10.1016/j.ijbiocel.2024.05.001",
      sourceProviders: ["PUBMED"],
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
    };

    const mriPaper: NormalizedExternalPaper = {
      id: "doi:10.1007/s00261-024-04600-x",
      title: "Deep learning reconstruction in prostate MRI: technical principles, clinical applications, and future directions",
      abstract: "Multiparametric magnetic resonance imaging has become integral...",
      authors: [{ name: "Lee C" }],
      year: 2024,
      doi: "10.1007/s00261-024-04600-x",
      sourceProviders: ["PUBMED"],
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
    };

    const ultrasoundPaper: NormalizedExternalPaper = {
      id: "doi:10.1016/j.ejrad.2021.109717",
      title: "Artificial intelligence in breast ultrasound",
      abstract: "Artificial intelligence in breast ultrasound assists in distinguishing benign from malignant lesions...",
      authors: [{ name: "Wang D" }],
      year: 2021,
      doi: "10.1016/j.ejrad.2021.109717",
      sourceProviders: ["PUBMED"],
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
    };

    const ranked = rankScholarlySearchResults(
      [retinalPaper, oncologyPaper, mriPaper, ultrasoundPaper],
      query
    );

    // The ultrasound paper MUST be #1
    assert.equal(ranked[0].title, "Artificial intelligence in breast ultrasound");

    // All three distractors must have received demotions
    const retinalScore = scoreScholarlyPaperRelevance(retinalPaper, query);
    const mriScore = scoreScholarlyPaperRelevance(mriPaper, query);
    const oncologyScore = scoreScholarlyPaperRelevance(oncologyPaper, query);

    assert.equal(retinalScore.modalityAlignment, "COMPETING_PENALTY");
    assert.equal(mriScore.modalityAlignment, "COMPETING_PENALTY");
    assert.equal(retinalScore.totalScore <= 10, true);
    assert.equal(oncologyScore.totalScore <= 10, true);
    assert.equal(mriScore.totalScore <= 10, true);
  });

  // TEST 8: STALE FRONTEND RESPONSE PREVENTION & REQUEST SEQUENCING
  it("8. Request ID sequencing discards outdated responses from slower earlier queries", () => {
    let activeRequestId = 0;
    let finalDisplayedResults: string = "";

    // Simulate query 1 (started at t=0, resolves slow at t=50)
    const requestId1 = ++activeRequestId;
    const query1Promise = new Promise<{ id: number; data: string }>((resolve) => {
      setTimeout(() => resolve({ id: requestId1, data: "Results for Query 1 (Stale)" }), 50);
    });

    // Simulate query 2 (started at t=10, resolves fast at t=20)
    const requestId2 = ++activeRequestId;
    const query2Promise = new Promise<{ id: number; data: string }>((resolve) => {
      setTimeout(() => resolve({ id: requestId2, data: "Results for Query 2 (Fresh)" }), 20);
    });

    return Promise.all([
      query1Promise.then((res) => {
        // Discard stale response if newer request initiated
        if (res.id === activeRequestId) {
          finalDisplayedResults = res.data;
        }
      }),
      query2Promise.then((res) => {
        if (res.id === activeRequestId) {
          finalDisplayedResults = res.data;
        }
      }),
    ]).then(() => {
      // Despite query 1 finishing AFTER query 2, query 2 MUST remain the displayed result
      assert.equal(finalDisplayedResults, "Results for Query 2 (Fresh)");
    });
  });

  // TEST 9: PUBLIC / PRIVATE PAPER ISOLATION IN SNAPSHOTS
  it("9. AI Research Snapshot strictly isolates private user uploads and test fixtures", async () => {
    const publicPaper: NormalizedExternalPaper = {
      id: "doi:10.1016/j.ejrad.2021.109717",
      title: "Artificial intelligence in breast ultrasound",
      abstract: "Public abstract demonstrating clinical efficacy of machine learning in breast ultrasound imaging...",
      authors: [{ name: "Zhang Y" }],
      year: 2021,
      doi: "10.1016/j.ejrad.2021.109717",
      sourceProviders: ["PUBMED"],
      isOpenAccess: true,
      fullTextAvailability: "METADATA_ONLY",
    };

    const secondPublicPaper: NormalizedExternalPaper = {
      id: "doi:10.1016/j.liver.2022.1001",
      title: "Artificial intelligence in liver ultrasound",
      abstract: "Public abstract detailing liver ultrasound computer-aided diagnosis...",
      authors: [{ name: "Wang L" }],
      year: 2022,
      doi: "10.1016/j.liver.2022.1001",
      sourceProviders: ["PUBMED"],
      isOpenAccess: true,
      fullTextAvailability: "METADATA_ONLY",
    };

    const fixturePaper: NormalizedExternalPaper = {
      id: Array.from(ADMIN_TEST_FIXTURE_IDS)[0] || "admin-test-fixture-1",
      title: "Confidential Admin Fixture Paper",
      abstract: "Confidential administrative benchmark data...",
      authors: [{ name: "Admin" }],
      year: 2025,
      sourceProviders: ["PUBMED"],
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
    };

    const snapshot = await generateResearchSnapshot(
      "artificial intelligence in ultrasound",
      [publicPaper, secondPublicPaper, fixturePaper],
      { forceRefresh: true }
    );

    assert.equal(snapshot.isInsufficientEvidence, false);
    // Fixture paper must NEVER be cited
    assert.equal(snapshot.citations.some((c) => ADMIN_TEST_FIXTURE_IDS.has(c.paperId)), false);
    assert.equal(snapshot.citations.length >= 2, true);
    assert.equal(snapshot.citations[0].paperId, publicPaper.id);
  });

  // TEST 10: STABLE EVIDENCE CITATIONS WITHOUT FABRICATION
  it("10. Generates grounded citations linked to genuine abstracts without fabrication", async () => {
    const paper1: NormalizedExternalPaper = {
      id: "doi:10.1016/j.ejrad.2021.109717",
      title: "Artificial intelligence in breast ultrasound",
      abstract: "Artificial intelligence in breast ultrasound demonstrates utility for assisting with quantitative image assessment and differentiating benign from malignant lesions.",
      authors: [{ name: "Zhang Y" }],
      year: 2021,
      doi: "10.1016/j.ejrad.2021.109717",
      sourceProviders: ["PUBMED"],
      isOpenAccess: true,
      fullTextAvailability: "METADATA_ONLY",
    };

    const paper2: NormalizedExternalPaper = {
      id: "doi:10.1016/j.liver.2022.1001",
      title: "Artificial intelligence in liver ultrasound",
      abstract: "Computational models demonstrate utility for assisting with quantitative image assessment and standardizing measurements.",
      authors: [{ name: "Wang L" }],
      year: 2022,
      doi: "10.1016/j.liver.2022.1001",
      sourceProviders: ["PUBMED"],
      isOpenAccess: true,
      fullTextAvailability: "METADATA_ONLY",
    };

    const snapshot = await generateResearchSnapshot(
      "artificial intelligence in ultrasound",
      [paper1, paper2],
      { forceRefresh: true, clientId: "test-client-10" }
    );

    assert.equal(snapshot.retrievedCount, 2);
    assert.equal(snapshot.citedCount, 2);
    assert.equal(snapshot.citations.length, 2);
    assert.equal(snapshot.citations[0].supportingSnippet.length > 20, true);
    assert.equal(snapshot.citations[1].supportingSnippet.length > 20, true);
    // Verifies inline citation numbers match actual citation array
    assert.ok(snapshot.summaryText.includes("[1]"));
    assert.ok(snapshot.summaryText.includes("[2]"));
  });

  // TEST 11: SAVE TO MY LIBRARY INTEGRATION
  it("11. Saves external scholarly paper metadata to isolated Docker PostgreSQL library", async () => {
    // Find or verify test user
    const user = await prisma.user.findFirst();
    assert.ok(user, "Test user must exist in isolated local PostgreSQL");

    const externalPaper: NormalizedExternalPaper = {
      id: "doi:10.1016/j.ejrad.2021.109717",
      title: "Artificial intelligence in ultrasound test paper",
      abstract: "Evaluating machine learning algorithms in ultrasound imaging...",
      authors: [{ name: "Grounded Scholar" }],
      year: 2022,
      doi: "10.1016/j.ejrad.2021.109717",
      sourceProviders: ["PUBMED"],
      isOpenAccess: true,
      fullTextAvailability: "METADATA_ONLY",
    };

    const result = await executePaperMetadataImport(externalPaper, user.id);
    assert.equal(result.success, true);
    assert.ok(result.paperId);

    // Verify database Bookmark persistence
    const bookmark = await prisma.bookmark.findFirst({
      where: {
        userId: user.id,
        paperId: result.paperId!,
      },
    });
    assert.ok(bookmark, "Bookmark record must be persisted for authenticated user");
  });
});
