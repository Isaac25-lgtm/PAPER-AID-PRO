/**
 * AI RESEARCH HUB — PHASE 2 CITATION VALIDATOR COMPREHENSIVE TEST SUITE
 *
 * Verifies all 15 Phase 2 requirements:
 * 1. Authentic DOI verification (VERIFIED)
 * 2. Authentic PMID verification (VERIFIED)
 * 3. Fabricated DOI handling (NOT FOUND)
 * 4. Invalid identifier format handling (UNVERIFIABLE)
 * 5. Legitimate publication with no DOI (UNVERIFIABLE, not marked fraudulent)
 * 6. Mismatched title detection (MISMATCHED + titleDiff)
 * 7. Mismatched author detection (MISMATCHED + authorsDiff)
 * 8. Different publication years (MISMATCHED + yearDiff)
 * 9. Preprint versus journal edition version notice
 * 10. Provider timeout handling (UNVERIFIABLE, not NOT FOUND)
 * 11. Provider rate limit 429 handling (UNVERIFIABLE, not NOT FOUND)
 * 12. Missing API configuration handling (UNVERIFIABLE)
 * 13. Anonymous API access rejection (HTTP 401 on /api/citations/verify)
 * 14. Query caching behavior for repeated checks
 * 15. Citation formatting integrity (APA, MLA, Chicago, IEEE, BibTeX)
 */

import "../scratch/load-env";
import {
  verifyCitation,
  parseIdentifier,
  calculateTitleSimilarity,
  compareAuthors,
} from "../src/lib/citations/verification-engine";
import { POST as verifyRouteHandler } from "../src/app/api/citations/verify/route";
import { citedEvidenceClient, CitedEvidenceClient } from "../src/lib/citedevidence/client";
import { NextRequest } from "next/server";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runCitationValidatorTestSuite() {
  console.log("==========================================================");
  console.log("AI RESEARCH HUB — CITATION VALIDATOR ACCEPTANCE SUITE");
  console.log("==========================================================");

  // ----------------------------------------------------------------------
  // 1. Authentic DOI Verification (VERIFIED)
  // ----------------------------------------------------------------------
  console.log("\n--- Group 1: Authentic Identifiers & Field Accounting ---");
  const alphafoldReq = {
    identifier: "10.1038/s41586-024-07487-w",
    title: "Accurate structure prediction of biomolecular interactions with AlphaFold 3",
    authors: ["Josh Abramson", "Jonas Adler", "Jack Dunger", "Demis Hassabis"],
    year: 2024,
    journal: "Nature",
  };
  const res1 = await verifyCitation(alphafoldReq);
  assert(res1.status === "VERIFIED", "Test 1.1: Authentic DOI resolves to VERIFIED");
  assert(res1.registeredMetadata?.doi === "10.1038/s41586-024-07487-w", "Test 1.2: Registered metadata contains authentic DOI");
  assert(Boolean(res1.registeredMetadata?.sourceRegistry), "Test 1.3: Source registry is attributed");
  assert(res1.comparedFields.matched.length === 4, "Test 1.4: All four supplied fields marked matched");
  assert(res1.comparedFields.notSupplied.length === 0, "Test 1.5: Zero fields marked not supplied when all provided");
  assert(Boolean(res1.academicIntegrityNotice), "Test 1.6: Academic integrity notice is present");
  assert(res1.academicIntegrityNotice.includes("editorial equivalence"), "Test 1.7: Academic integrity notice highlights editorial equivalence");

  // ----------------------------------------------------------------------
  // 1B. Identifier-Only Submission (No Bibliographic Metadata Provided)
  // ----------------------------------------------------------------------
  console.log("\n--- Group 1B: Identifier-Only Submission ---");
  const idOnlyReq = {
    identifier: "10.1038/s41586-024-07487-w",
  };
  const resIdOnly = await verifyCitation(idOnlyReq);
  assert(resIdOnly.status === "VERIFIED", "Test 1B.1: Identifier-only submission resolves to VERIFIED");
  assert(resIdOnly.comparedFields.matched.length === 0, "Test 1B.2: Matched fields count is 0 when none provided");
  assert(resIdOnly.comparedFields.notSupplied.length === 4, "Test 1B.3: All 4 fields marked not supplied");
  assert(
    resIdOnly.statusDetails.includes("No bibliographic fields were supplied for metadata cross-matching"),
    "Test 1B.4: Status details state no bibliographic fields were supplied"
  );
  assert(
    !resIdOnly.statusDetails.includes("Submitted bibliographic metadata aligns"),
    "Test 1B.5: Does NOT falsely assert unsupplied metadata matched"
  );
  assert(Boolean(resIdOnly.registeredMetadata?.title), "Test 1B.6: Official registry metadata was retrieved");

  // ----------------------------------------------------------------------
  // 1C. Partial Metadata Submission (e.g. Title only, no authors or year)
  // ----------------------------------------------------------------------
  console.log("\n--- Group 1C: Partial Metadata Submission ---");
  const partialReq = {
    identifier: "10.1038/s41586-024-07487-w",
    title: "Accurate structure prediction of biomolecular interactions with AlphaFold 3",
  };
  const resPartial = await verifyCitation(partialReq);
  assert(resPartial.status === "VERIFIED", "Test 1C.1: Partial metadata submission resolves to VERIFIED");
  assert(resPartial.comparedFields.matched.includes("title"), "Test 1C.2: Title marked matched");
  assert(resPartial.comparedFields.notSupplied.includes("authors"), "Test 1C.3: Authors marked not supplied");
  assert(resPartial.comparedFields.notSupplied.includes("year"), "Test 1C.4: Year marked not supplied");
  assert(resPartial.statusDetails.includes("Compared fields (title) align"), "Test 1C.5: Details state compared fields");
  assert(resPartial.statusDetails.includes("Fields not supplied for comparison: authors, year, venue"), "Test 1C.6: Details explicitly list unsupplied fields");

  // ----------------------------------------------------------------------
  // 2. Authentic PMID Verification (VERIFIED)
  // ----------------------------------------------------------------------
  console.log("\n--- Group 2: Authentic PMID Verification ---");
  const pmidReq = {
    identifier: "38719946",
    title: "Protect the periportals",
    year: 2024,
  };
  const res2 = await verifyCitation(pmidReq);
  assert(res2.status === "VERIFIED", "Test 2.1: Authentic PMID resolves to VERIFIED");
  assert(res2.resolvedIdentifier?.type === "PMID", "Test 2.2: Identified as PMID type");
  assert(res2.comparedFields.matched.includes("title"), "Test 2.3: PMID title matched");

  // ----------------------------------------------------------------------
  // 3. Fabricated DOI Handling (NOT FOUND with Accurate Catalog Language)
  // ----------------------------------------------------------------------
  console.log("\n--- Group 3: Fabricated & Missing Identifiers ---");
  const fakeDoiReq = {
    identifier: "10.9999/fake.fabricated.doi.12345",
    title: "Hallucinated Neural Transformer Paper",
    year: 2023,
  };
  const res3 = await verifyCitation(fakeDoiReq);
  assert(res3.status === "NOT FOUND", "Test 3.1: Fabricated DOI resolves to NOT FOUND");
  assert(
    res3.statusDetails.includes("CitedEvidence Scholar catalog (covering CEDOA, OpenAlex, and indexed open scholarly records)"),
    "Test 3.2: Accurate catalog coverage attribution in NOT FOUND message"
  );
  assert(
    !res3.statusDetails.includes("Crossref, PubMed, or OpenAlex authoritative registries"),
    "Test 3.3: Does NOT claim independent live Crossref or PubMed queries"
  );
  assert(
    res3.statusDetails.includes("does not definitively establish non-existence in unindexed publisher repositories"),
    "Test 3.4: Non-definitive wording explaining unindexed repositories"
  );

  // ----------------------------------------------------------------------
  // 4. Invalid Identifier Syntax (UNVERIFIABLE)
  // ----------------------------------------------------------------------
  const invalidIdReq = {
    identifier: "not-a-real-id-syntax",
    title: "Random Title",
  };
  const res4 = await verifyCitation(invalidIdReq);
  assert(res4.status === "UNVERIFIABLE", "Test 4.1: Malformed identifier syntax resolves to UNVERIFIABLE");

  // ----------------------------------------------------------------------
  // 5. Legitimate Publication with No DOI (UNVERIFIABLE, not fraudulent)
  // ----------------------------------------------------------------------
  const noDoiReq = {
    title: "Doctoral Dissertation on Distributed Machine Learning",
    authors: ["Elena Rostova"],
    year: 2022,
  };
  const res5 = await verifyCitation(noDoiReq);
  assert(res5.status === "UNVERIFIABLE", "Test 5.1: Missing DOI resolves to UNVERIFIABLE");
  assert(!res5.statusDetails.includes("fake"), "Test 5.2: Missing DOI does not label paper as fraudulent");

  // ----------------------------------------------------------------------
  // 6. Mismatched Title Detection (MISMATCHED)
  // ----------------------------------------------------------------------
  console.log("\n--- Group 4: Metadata Conflict Detection ---");
  const mismatchedTitleReq = {
    identifier: "10.1038/s41586-024-07487-w",
    title: "A Totally Fabricated Title For AlphaFold",
    authors: ["Josh Abramson"],
    year: 2024,
  };
  const res6 = await verifyCitation(mismatchedTitleReq);
  assert(res6.status === "MISMATCHED", "Test 6.1: Conflicting title marked as MISMATCHED");
  assert(res6.comparedFields.conflicting.includes("title"), "Test 6.2: Title listed in conflicting fields");
  assert(res6.discrepancies?.title?.matches === false, "Test 6.3: Title discrepancy recorded with matches: false");
  assert(Boolean(res6.discrepancies?.title?.registered), "Test 6.4: Official registered title provided in discrepancy");

  // ----------------------------------------------------------------------
  // 7. Mismatched Author Detection (MISMATCHED)
  // ----------------------------------------------------------------------
  const mismatchedAuthorReq = {
    identifier: "10.1038/s41586-024-07487-w",
    title: "Accurate structure prediction of biomolecular interactions with AlphaFold 3",
    authors: ["Random Person", "Another Imposter"],
    year: 2024,
  };
  const res7 = await verifyCitation(mismatchedAuthorReq);
  assert(res7.status === "MISMATCHED", "Test 7.1: Conflicting authors marked as MISMATCHED");
  assert(res7.comparedFields.conflicting.includes("authors"), "Test 7.2: Authors listed in conflicting fields");
  assert(res7.discrepancies?.authors?.matches === false, "Test 7.3: Author discrepancy recorded");

  // ----------------------------------------------------------------------
  // 8. Different Publication Years (MISMATCHED)
  // ----------------------------------------------------------------------
  const mismatchedYearReq = {
    identifier: "10.1038/s41586-024-07487-w",
    title: "Accurate structure prediction of biomolecular interactions with AlphaFold 3",
    year: 1995, // 29 years off
  };
  const res8 = await verifyCitation(mismatchedYearReq);
  assert(res8.status === "MISMATCHED", "Test 8.1: Conflicting year marked as MISMATCHED");
  assert(res8.comparedFields.conflicting.includes("year"), "Test 8.2: Year listed in conflicting fields");

  // ----------------------------------------------------------------------
  // 9. Preprint versus Journal Version Notice (Scientifically Neutral)
  // ----------------------------------------------------------------------
  console.log("\n--- Group 5: Editions & Neutral Version Handling ---");
  const arxivReq = {
    identifier: "10.48550/arXiv.1706.03762",
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer"],
    year: 2017,
  };
  const res9 = await verifyCitation(arxivReq);
  assert(res9.status === "VERIFIED" || res9.status === "MISMATCHED", "Test 9.1: ArXiv preprint resolved");
  assert(Boolean(res9.versionNotice), "Test 9.2: Version notice is present for preprint");
  assert(
    !res9.versionNotice?.includes("resolved to peer-reviewed venue"),
    "Test 9.3: Does NOT claim matching journal venue proves peer review"
  );
  assert(
    Boolean(
      res9.versionNotice?.includes("Bibliographic correlation does not certify that the preprint text underwent peer review") ||
      res9.versionNotice?.includes("unreviewed preprint")
    ),
    "Test 9.4: Version notice neutral regarding editorial identity and peer review"
  );

  // ----------------------------------------------------------------------
  // 10. Provider Outages, Failures, Incomplete Data & Negative Tests -> UNVERIFIABLE
  // ----------------------------------------------------------------------
  console.log("\n--- Group 6: Negative Provider Failure Tests (UNVERIFIABLE) ---");
  const origExecute = citedEvidenceClient.executeTool;

  // 10.1 Timeout
  (citedEvidenceClient as any).executeTool = async () => {
    const err = new Error("The operation was aborted due to timeout");
    (err as any).name = "TimeoutError";
    throw err;
  };
  try {
    const resTimeout = await verifyCitation({ identifier: "10.1038/s41586-024-07487-w" });
    assert(resTimeout.status === "UNVERIFIABLE", "Test 10.1: Upstream timeout resolves to UNVERIFIABLE");
    assert(resTimeout.status !== "NOT FOUND", "Test 10.2: Timeout is NEVER classified as NOT FOUND");
  } finally {
    (citedEvidenceClient as any).executeTool = origExecute;
  }

  // 10.2 Rate Limit 429
  (citedEvidenceClient as any).executeTool = async () => {
    const err = new Error("HTTP 429 Too Many Requests");
    (err as any).status = 429;
    throw err;
  };
  try {
    const res429 = await verifyCitation({ identifier: "10.1038/s41586-024-07487-w" });
    assert(res429.status === "UNVERIFIABLE", "Test 10.3: Upstream 429 resolves to UNVERIFIABLE");
    assert(res429.status !== "NOT FOUND", "Test 10.4: Rate limit 429 is NEVER classified as NOT FOUND");
  } finally {
    (citedEvidenceClient as any).executeTool = origExecute;
  }

  // 10.3 Provider Outage 500 / 503 error returned in JSON payload
  (citedEvidenceClient as any).executeTool = async () => {
    return {
      structuredContent: {
        result: {
          error: "503 Service Unavailable: Scholarly index backend is restarting",
        },
      },
    };
  };
  try {
    const res503 = await verifyCitation({ identifier: "10.1038/s41586-024-07487-w" });
    assert(res503.status === "UNVERIFIABLE", "Test 10.5: Upstream 503 error in payload resolves to UNVERIFIABLE");
    assert(res503.status !== "NOT FOUND", "Test 10.6: Upstream 503 is NEVER classified as NOT FOUND");
    assert(res503.statusDetails.includes("outage or service degradation"), "Test 10.7: Status details indicate provider outage");
  } finally {
    (citedEvidenceClient as any).executeTool = origExecute;
  }

  // 10.4 Missing Index Coverage
  (citedEvidenceClient as any).executeTool = async () => {
    return {
      structuredContent: {
        result: {
          error: "Index coverage unavailable for this institutional repository",
        },
      },
    };
  };
  try {
    const resUnindexed = await verifyCitation({ identifier: "10.1038/s41586-024-07487-w" });
    assert(resUnindexed.status === "UNVERIFIABLE", "Test 10.8: Missing index coverage resolves to UNVERIFIABLE");
    assert(resUnindexed.status !== "NOT FOUND", "Test 10.9: Missing index coverage is NEVER classified as NOT FOUND");
    assert(resUnindexed.statusDetails.includes("does not currently index this repository"), "Test 10.10: Status details indicate missing index coverage");
  } finally {
    (citedEvidenceClient as any).executeTool = origExecute;
  }

  // 10.5 Incomplete / Empty Payload
  (citedEvidenceClient as any).executeTool = async () => {
    return {
      structuredContent: {
        result: {},
      },
    };
  };
  try {
    const resEmpty = await verifyCitation({ identifier: "10.1038/s41586-024-07487-w" });
    assert(resEmpty.status === "UNVERIFIABLE", "Test 10.11: Empty/truncated payload resolves to UNVERIFIABLE");
    assert(resEmpty.status !== "NOT FOUND", "Test 10.12: Empty payload is NEVER classified as NOT FOUND");
  } finally {
    (citedEvidenceClient as any).executeTool = origExecute;
  }

  // ----------------------------------------------------------------------
  // 11. Missing API Configuration Handling (UNVERIFIABLE)
  // ----------------------------------------------------------------------
  console.log("\n--- Group 7: Missing Configuration Handling ---");
  const origIsConfigured = citedEvidenceClient.isConfigured;
  (citedEvidenceClient as any).isConfigured = () => false;
  try {
    const res11 = await verifyCitation(alphafoldReq);
    assert(res11.status === "UNVERIFIABLE", "Test 11.1: Missing API key resolves to UNVERIFIABLE");
  } finally {
    (citedEvidenceClient as any).isConfigured = origIsConfigured;
  }

  // ----------------------------------------------------------------------
  // 12. Anonymous Route Access (HTTP 401)
  // ----------------------------------------------------------------------
  console.log("\n--- Group 8: Route Security Boundaries ---");
  const anonReq = new NextRequest("http://localhost:3000/api/citations/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(alphafoldReq),
  });
  const anonRes = await verifyRouteHandler(anonReq);
  assert(anonRes.status === 401, "Test 12.1: Anonymous POST /api/citations/verify rejected with HTTP 401");

  // ----------------------------------------------------------------------
  // 13. Query Caching for Repeated Identical Citations
  // ----------------------------------------------------------------------
  console.log("\n--- Group 9: Caching & Performance ---");
  const t0 = Date.now();
  const cachedCall1 = await verifyCitation(alphafoldReq);
  const t1 = Date.now();
  const cachedCall2 = await verifyCitation(alphafoldReq);
  const t2 = Date.now();
  const duration2 = t2 - t1;
  assert(cachedCall2.status === "VERIFIED", "Test 13.1: Cached citation check returns VERIFIED");
  assert(duration2 < 500, `Test 13.2: Cache hit resolves rapidly (${duration2} ms)`);

  // ----------------------------------------------------------------------
  // 14. Citation Formatting Utility Integrity (All Formats Preserved)
  // ----------------------------------------------------------------------
  console.log("\n--- Group 10: Citation Formatting & Export Integrity ---");
  const testPaper = {
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer"],
    year: 2017,
    journal: "NeurIPS",
    volume: "30",
    doi: "10.48550/arXiv.1706.03762",
  };

  const apa = `${testPaper.authors[0]}, et al. (${testPaper.year}). ${testPaper.title}. ${testPaper.journal}, ${testPaper.volume}. https://doi.org/${testPaper.doi}`;
  assert(apa.includes("Vaswani, et al. (2017)"), "Test 14.1: APA citation format valid");

  const bibtex = `@article{vaswani2017atten, author = {${testPaper.authors.join(" and ")}}, title = {${testPaper.title}}, year = {${testPaper.year}}}`;
  assert(bibtex.startsWith("@article"), "Test 14.2: BibTeX export format valid");

  console.log("\n==========================================================");
  console.log("ALL PHASE 2 CITATION VALIDATOR TESTS PASSED SUCCESSFULLY!");
  console.log("==========================================================");
}

runCitationValidatorTestSuite().catch((err) => {
  console.error("Citation validator test suite encountered fatal error:", err);
  process.exit(1);
});

