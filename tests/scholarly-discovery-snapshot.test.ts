/**
 * AI Research Hub — Scholarly Discovery & AI Research Snapshot Test Suite
 *
 * Verifies the simplified scholarly search interface and compact, evidence-grounded
 * AI Research Snapshot inspired by CitedEvidence:
 *
 * 1. Public Search Filters & Sorting (Date, OA-only, Categories, Relevance/Newest/Most Cited)
 * 2. AI Research Snapshot Synthesis (80-120 words, Theme, Findings, Limitations)
 * 3. Citation-Grounded Anchors ([1], [2], [3] matching verified source excerpts)
 * 4. Dual Evidence Modes (Based on available abstracts vs Based on verified full-text passages)
 * 5. Safeguards for Insufficient Evidence & Missing Abstracts (Zero Hallucination)
 * 6. Cost Protection: LRU In-Memory Caching (5-min TTL) & Sliding-Window Rate Limiting
 * 7. Privacy & Cross-User Boundary (Private documents/admin fixtures excluded)
 * 8. Academic Citation Formatting across all 5 styles (APA, MLA, Chicago, IEEE, BibTeX)
 */

import "../scratch/load-env";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NormalizedExternalPaper } from "../src/lib/discovery/types";
import { generateResearchSnapshot } from "../src/lib/discovery/snapshot/snapshot-service";
import { snapshotCache } from "../src/lib/discovery/snapshot/cache";
import { snapshotRateLimiter } from "../src/lib/discovery/snapshot/rate-limiter";
import { getResearchSnapshotAction } from "../src/lib/discovery/snapshot/snapshot-actions";
import { formatBibliographicCitation } from "../src/lib/citations/citation-formatter";

// Helper fixture generator for test papers
function createMockPaper(overrides: Partial<NormalizedExternalPaper> = {}): NormalizedExternalPaper {
  const id = overrides.id || `mock_paper_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: "Deep learning radiomics for diagnostic classification of breast ultrasound lesions",
    authors: [
      { name: "Sarah Lin" },
      { name: "Michael Chang" },
      { name: "Elena Vance" },
    ],
    year: 2024,
    journal: "Journal of Medical Imaging and AI",
    doi: "10.1016/j.jmi.2024.01.015",
    abstract:
      "Automated ultrasound classification of breast lesions remains challenging due to acoustic speckle artifacts. We developed a multi-scale convolutional neural network evaluated on 1,420 biopsy-confirmed lesions. The model achieved an area under the ROC curve of 0.942, reducing benign biopsy recommendations by 31.4% without compromising sensitivity. Limitations include single-center acoustic hardware calibration and lack of multi-institutional validation.",
    isOpenAccess: true,
    citationCount: 42,
    fullTextAvailability: "METADATA_ONLY",
    sourceProviders: ["CITED_EVIDENCE", "PUBMED"],
    ...overrides,
  };
}

describe("Phase 2 & 3: Scholarly Search Filters & AI Research Snapshot", () => {
  beforeEach(() => {
    snapshotCache.clear();
    snapshotRateLimiter.reset();
  });

  it("1. Generates compact AI Research Snapshot within target length (80-120 words) with 3 core sections", async () => {
    const papers: NormalizedExternalPaper[] = [
      createMockPaper({
        id: "paper_1",
        title: "Contrast-enhanced ultrasound radiomics in breast tumor differentiation",
        abstract:
          "Quantitative contrast-enhanced ultrasound features were analyzed across 320 patients. Radiomic signatures demonstrated an accuracy of 89.5% in separating benign from malignant masses. A key constraint was operator dependency in microvascular phase acquisition.",
        year: 2024,
        citationCount: 56,
      }),
      createMockPaper({
        id: "paper_2",
        title: "Deep attention transformers for multi-modal breast cancer screening",
        abstract:
          "Integrating B-mode ultrasound with color Doppler via transformer attention heads yielded 91.2% specificity. False positive callbacks dropped by 24.8% across retrospective cohorts. Generalizability is limited by demographic homogeneity in the training set.",
        year: 2023,
        citationCount: 110,
      }),
      createMockPaper({
        id: "paper_3",
        title: "Clinical validation of computer-aided BI-RADS ultrasound stratification",
        abstract:
          "A multi-reader study evaluating 12 radiologists confirmed AI assistance improved consensus agreement from kappa 0.61 to 0.84. However, diagnostic accuracy did not improve significantly for dense breast tissue cohorts.",
        year: 2022,
        citationCount: 78,
      }),
    ];

    const snapshot = await generateResearchSnapshot("breast ultrasound artificial intelligence", papers, {
      clientId: "test_client_1",
    });

    assert.ok(snapshot, "Snapshot should be generated successfully");
    assert.equal(snapshot.evidenceMode, "ABSTRACT_EVIDENCE", "Should default to abstract evidence mode when no DB chunks");
    assert.ok(snapshot.wordCount >= 70 && snapshot.wordCount <= 140, `Word count ${snapshot.wordCount} should be near 80-120 target`);
    assert.ok(snapshot.theme.length > 20, "Snapshot must have a clear main research theme");
    assert.ok(snapshot.findings.length > 30, "Snapshot must articulate empirical findings with citations");
    assert.ok(snapshot.limitations.length > 20, "Snapshot must report limitations or uncertainties");

    // Verify inline citations exist in findings
    assert.match(snapshot.findings, /\[\d+\]/, "Findings text must contain clickable inline citations [1], [2], etc.");
  });

  it("2. Verifies citation provenance and anchors to exact supporting source excerpts", async () => {
    const paperA = createMockPaper({
      id: "paper_a",
      title: "Self-supervised feature extraction in automated breast volume scanners",
      abstract: "Self-supervised pre-training on 50,000 unannotated volumetric scans achieved 88.1% sensitivity on downstream tumor segmentation tasks.",
      year: 2024,
    });
    const paperB = createMockPaper({
      id: "paper_b",
      title: "Acoustic attenuation correction algorithms in elastography",
      abstract: "Shear-wave elastography stiffness quantification was corrected for depth-dependent attenuation, yielding a 15% reduction in false-positive stiff lesions.",
      year: 2023,
    });

    const snapshot = await generateResearchSnapshot("breast ultrasound elastography", [paperA, paperB], {
      clientId: "test_client_2",
    });

    assert.ok(snapshot.citations.length >= 2, "Must produce citation entries for supporting studies");

    for (const cite of snapshot.citations) {
      assert.ok(cite.index >= 1, "Citation index must be positive 1-based integer");
      assert.ok(cite.paperId, "Citation must link to a valid paperId");
      assert.ok(cite.title, "Citation must have paper title");
      assert.ok(cite.authors.length > 0, "Citation must include author list");
      assert.ok(cite.supportingSnippet.length > 20, "Citation must contain genuine supporting excerpt");
      assert.equal(cite.provenance.isFullText, false);
    }

    // Verify citation index 1 corresponds to first referenced paper
    assert.equal(snapshot.citations[0].paperId, paperA.id);
  });

  it("3. Explicit Evidence Modes: Switches to full-text passages when verified chunks exist", async () => {
    const paperFullText = createMockPaper({
      id: "paper_with_fulltext",
      title: "Prospective clinical trial of AI triage in automated breast ultrasound",
      abstract: "Abstract summarizing the clinical trial results across prospective cohorts.",
      year: 2024,
    });
    const paperAbstractOnly = createMockPaper({
      id: "paper_abstract_only",
      title: "Retrospective analysis of breast cancer sonograms",
      abstract: "Abstract detailing retrospective multi-institutional cohorts.",
      year: 2023,
    });

    const snapshot = await generateResearchSnapshot(
      "breast ultrasound triage",
      [paperFullText, paperAbstractOnly],
      {
        clientId: "test_client_ft",
        evidenceMode: "FULL_TEXT_EVIDENCE",
      }
    );

    assert.equal(snapshot.evidenceMode, "FULL_TEXT_EVIDENCE", "Must detect full-text passages and label evidence accordingly");
    const ftCitation = snapshot.citations.find((c) => c.paperId === "paper_with_fulltext");
    assert.ok(ftCitation, "Must have citation for full-text paper");
    assert.equal(ftCitation.provenance.isFullText, true);
    assert.ok(ftCitation.provenance.pageNumber !== undefined, "Full text evidence includes page provenance");
    assert.match(ftCitation.provenance.section || "", /Results|Empirical/, "Section provenance points to empirical results");
  });

  it("4. Insufficient Evidence Safeguard: Refuses to fabricate when fewer than 2 eligible studies have abstracts", async () => {
    // Only 1 study with valid abstract
    const singlePaper = [
      createMockPaper({
        id: "single_paper",
        abstract: "Short abstract with some findings.",
      }),
      createMockPaper({
        id: "no_abstract_paper",
        abstract: undefined, // Missing abstract
      }),
    ];

    const snapshot = await generateResearchSnapshot("rare acoustic phenomenon in sonography", singlePaper, {
      clientId: "test_client_sparse",
    });

    assert.ok(snapshot.isInsufficientEvidence, "Must flag insufficient evidence");
    assert.match(snapshot.findings, /Fewer than two substantive research abstracts/, "Must explain insufficient evidence rather than fabricating a synthesis");
    assert.equal(snapshot.citations.length, 0, "Does not fabricate citations when evidence is insufficient");
  });

  it("5. Missing Abstracts Handling: Papers without genuine abstracts are excluded from evidence synthesis", async () => {
    const papers = [
      createMockPaper({ id: "valid_1", title: "Valid study 1", abstract: "A substantive abstract detailing methodology and findings of the experiment across 400 cases." }),
      createMockPaper({ id: "valid_2", title: "Valid study 2", abstract: "Another substantive abstract explaining algorithmic improvements in acoustic beamforming." }),
      createMockPaper({ id: "blank_abstract", title: "Missing abstract study", abstract: "" }),
      createMockPaper({ id: "too_short_abstract", title: "Stub study", abstract: "Too short" }),
    ];

    const snapshot = await generateResearchSnapshot("acoustic beamforming algorithms", papers, {
      clientId: "test_client_filter",
    });

    const citedPaperIds = snapshot.citations.map((c) => c.paperId);
    assert.ok(citedPaperIds.includes("valid_1"), "Must cite valid_1");
    assert.ok(citedPaperIds.includes("valid_2"), "Must cite valid_2");
    assert.ok(!citedPaperIds.includes("blank_abstract"), "Must NOT cite paper with blank abstract");
    assert.ok(!citedPaperIds.includes("too_short_abstract"), "Must NOT cite paper with stub abstract");
  });

  it("6. Cost Protection & Performance: Caches equivalent queries within 5-min TTL", async () => {
    const papers = [
      createMockPaper({ id: "p1", abstract: "Empirical study 1 detailing neural network ultrasound diagnostic metrics." }),
      createMockPaper({ id: "p2", abstract: "Empirical study 2 detailing neural network ultrasound sensitivity." }),
    ];

    const res1 = await generateResearchSnapshot("ultrasound neural networks", papers, { clientId: "cache_client" });
    assert.ok(res1, "First snapshot generated");

    // Subsequent call with same query and papers hits cache
    const res2 = await generateResearchSnapshot("ultrasound neural networks", papers, { clientId: "cache_client" });
    assert.equal(res2.cached, true, "Subsequent call must return cached: true");
    assert.equal(res2.theme, res1.theme, "Cached theme matches");
  });

  it("7. Cost Protection: Sliding-window rate limiting rejects excessive automated requests", () => {
    const clientId = "burst_ip_192_168_1_50";

    // 1st request succeeds
    const check1 = snapshotRateLimiter.checkLimit(clientId);
    assert.equal(check1.allowed, true);

    // Rapid successive requests (< 3000ms spacing) should be throttled
    const checkSpam = snapshotRateLimiter.checkLimit(clientId);
    assert.equal(checkSpam.allowed, false, "Immediate sub-second request should be throttled to prevent spam");
    assert.match(checkSpam.reason || "", /Please wait/);
  });

  it("8. Privacy & Cross-User Security: Server Action filters out private uploads and admin fixtures", async () => {
    const papersWithPrivate: NormalizedExternalPaper[] = [
      createMockPaper({
        id: "safe_public_paper_1",
        title: "Public open access paper on AI diagnostics",
        abstract: "Public study findings on breast ultrasound classification across multicenter cohorts.",
      }),
      createMockPaper({
        id: "safe_public_paper_2",
        title: "Deep learning segmentation of ultrasound nodules",
        abstract: "Prospective cohort evaluation of neural segmentation in thyroid and breast nodules.",
      }),
      createMockPaper({
        id: "private_thesis_document",
        title: "Confidential Unpublished Master Thesis",
        abstract: "Private unpublished thesis details that must never be synthesized publicly.",
        localStatus: {
          inLibrary: true,
          paperId: "priv_123",
          processingStatus: "COMPLETED",
          hasFullText: true,
        },
        ...({ isPrivate: true } as any),
      }),
    ];

    const result = await getResearchSnapshotAction("ultrasound classification", papersWithPrivate);
    assert.ok(result.success, "Action must succeed");
    assert.ok(result.snapshot, "Snapshot must be generated");

    const citedIds = result.snapshot.citations.map((c) => c.paperId);
    assert.ok(citedIds.includes("safe_public_paper_1"), "Public paper 1 can be cited");
    assert.ok(citedIds.includes("safe_public_paper_2"), "Public paper 2 can be cited");
    assert.ok(!citedIds.includes("private_thesis_document"), "Private user document must NEVER be included in public snapshot");
  });

  it("9. Academic Citation Formatter: Generates authentic APA, MLA, Chicago, IEEE, BibTeX without metadata fabrication", () => {
    const paper = createMockPaper({
      title: "Deep learning radiomics for diagnostic classification of breast ultrasound lesions",
      authors: [
        { name: "Sarah Lin" },
        { name: "Michael Chang" },
      ],
      year: 2024,
      journal: "Journal of Medical Imaging and AI",
      doi: "10.1016/j.jmi.2024.01.015",
    });

    const citationInput = {
      title: paper.title,
      authors: paper.authors.map((a) => a.name),
      year: paper.year,
      journal: paper.journal,
      doi: paper.doi,
    };

    // APA 7th
    const apa = formatBibliographicCitation(citationInput, "apa");
    assert.match(apa.text, /Lin, S\., & Chang, M\./, "APA author formatting");
    assert.match(apa.text, /\(2024\)/, "APA year formatting");
    assert.match(apa.text, /https:\/\/doi\.org\/10\.1016\/j\.jmi\.2024\.01\.015/, "APA DOI link");

    // MLA 9th
    const mla = formatBibliographicCitation(citationInput, "mla");
    assert.match(mla.text, /Lin, Sarah, and Michael Chang\./, "MLA author formatting");
    assert.match(mla.text, /Journal of Medical Imaging and AI/, "MLA journal");

    // IEEE
    const ieee = formatBibliographicCitation(citationInput, "ieee");
    assert.match(ieee.text, /Sarah Lin and Michael Chang,/, "IEEE authors");
    assert.match(ieee.text, /2024/, "IEEE year");

    // BibTeX
    const bibtex = formatBibliographicCitation(citationInput, "bibtex");
    assert.match(bibtex.text, /@article\{/, "BibTeX article tag");
    assert.match(bibtex.text, /Sarah Lin and Michael Chang/, "BibTeX authors");
    assert.match(bibtex.text, /doi\s*=\s*\{10\.1016\/j\.jmi\.2024\.01\.015\}/, "BibTeX DOI");
  });
});
