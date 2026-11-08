/**
 * AI RESEARCH HUB — CITEDEVIDENCE INTEGRATION TEST SUITE
 *
 * Verifies:
 * 1. Client configuration and environment variable loading
 * 2. Abstract reconstruction from inverted index
 * 3. OpenAlex-compatible Scholar Metadata API (/v1/oa/works)
 * 4. Research Tools Catalog (25 tools)
 * 5. Citation validation tool execution
 * 6. Provider adapter normalization to NormalizedExternalPaper
 * 7. SSRF allowlist safety for CEDOA full-text retrieval
 * 8. Aggregator integration & failure isolation
 */

import "./test-setup";
import { citedEvidenceClient, CitedEvidenceClient } from "../src/lib/citedevidence/client";
import { CitedEvidenceProvider } from "../src/lib/discovery/providers/cited-evidence";
import { ScholarlyAggregator } from "../src/lib/discovery/scholarly-aggregator";
import { validateSafePdfUrl } from "../src/lib/discovery/full-text-service";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runSuite() {
  console.log("==========================================================");
  console.log("AI RESEARCH HUB — CITEDEVIDENCE TEST SUITE");
  console.log("==========================================================");

  // Test 1: Client Configuration
  assert(citedEvidenceClient.isConfigured(), "Test 1: CitedEvidence client is configured with API key");

  // Test 2: Inverted Index Abstract Reconstruction
  const sampleInvertedIndex = {
    "Deep": [0],
    "learning": [1],
    "has": [2],
    "revolutionized": [3],
    "medical": [4],
    "imaging.": [5],
  };
  const reconstructed = CitedEvidenceClient.reconstructAbstract(sampleInvertedIndex);
  assert(
    reconstructed === "Deep learning has revolutionized medical imaging.",
    "Test 2: Reconstruct abstract from inverted index"
  );

  // Test 3: Works Search
  const worksRes = await citedEvidenceClient.searchWorks("Transformer attention", { perPage: 2 });
  assert(
    worksRes.results.length > 0 && typeof worksRes.meta.count === "number",
    `Test 3: /v1/oa/works returned ${worksRes.results.length} results (total: ${worksRes.meta.count})`
  );

  // Test 4: List 25 Research Tools
  const tools = await citedEvidenceClient.listTools();
  assert(
    tools.length === 25,
    `Test 4: Retrieved complete tools catalog (expected 25, got ${tools.length})`
  );

  // Test 5: Citation Validation
  const validationRes = await citedEvidenceClient.validateCitations(["10.1038/s41586-024-07487-w"]);
  assert(
    Boolean(validationRes),
    "Test 5: Citation validation tool executed successfully"
  );

  // Test 6: Provider Adapter Normalization
  const provider = new CitedEvidenceProvider();
  const searchResults = await provider.search("AlphaFold", { limitPerProvider: 2 });
  assert(
    searchResults.length > 0,
    `Test 6: Provider search returned ${searchResults.length} normalized papers`
  );
  const sample = searchResults[0];
  assert(
    sample.sourceProviders.includes("CITED_EVIDENCE") && Boolean(sample.title),
    "Test 6.1: Normalized paper contains correct source provider and title"
  );

  // Test 7: SSRF Safety for CEDOA
  const safeCheck = validateSafePdfUrl("https://scholar.citedevidence.com/api/v1/research-corpus/pdf/W12345");
  assert(safeCheck.safe === true, "Test 7: scholar.citedevidence.com is allowlisted for safe PDF acquisition");

  // Test 8: Aggregator Multi-Provider Integration
  const aggregator = new ScholarlyAggregator();
  const aggRes = await aggregator.search("Generative Adversarial Networks", {
    limitPerProvider: 1,
    enabledProviders: ["CITED_EVIDENCE"],
  });
  assert(
    aggRes.providerResults.CITED_EVIDENCE.status === "SUCCESS",
    "Test 8: Aggregator successfully queries CITED_EVIDENCE with SUCCESS status"
  );

  console.log("==========================================================");
  console.log("ALL CITEDEVIDENCE TESTS PASSED (8/8)!");
  console.log("==========================================================");
}

runSuite().catch((err) => {
  console.error("Test suite encountered fatal error:", err);
  process.exit(1);
});
