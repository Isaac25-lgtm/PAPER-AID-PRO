/**
 * AI Research Hub — Scholarly Search Relevance Ranking Acceptance Benchmark
 *
 * Verifies that multi-provider search results are ranked by genuine query-topic
 * and research-method alignment rather than arbitrary provider insertion order.
 *
 * Benchmarks:
 * 1. "Artificial Intelligence in Diagnostic Ultrasound" (Ultrasound vs Incidental MRI Distractor)
 * 2. Symmetric Invariant: "Multiparametric MRI in Papillary Thyroid Carcinoma" (Ultrasound not demoting MRI)
 * 3. "Deep Learning in Mammography" (Mammography vs Chest X-Ray / CT Distractors)
 * 4. "Transformer Architectures in Protein Folding" (Bio Transformers vs NLP/Vision Transformers)
 * 5. Non-medical: "Surface Codes for Quantum Error Correction" (Quantum vs Classical codes)
 * 6. Incomplete Metadata Resilience (Missing abstracts, null citations, partial records)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  rankScholarlySearchResults,
  scoreScholarlyPaperRelevance,
  detectQueryModalities,
  getSubstantiveQueryTokens,
} from "../src/lib/discovery/ranking";
import { NormalizedExternalPaper } from "../src/lib/discovery/types";

// Metric Helpers
function calculatePrecisionAtK(papers: NormalizedExternalPaper[], groundTruth: Map<string, number>, k: number = 5): number {
  const topK = papers.slice(0, k);
  if (topK.length === 0) return 0;
  const relevantCount = topK.filter((p) => (groundTruth.get(p.id) || 0) >= 1).length;
  return relevantCount / topK.length;
}

function calculateMRR(papers: NormalizedExternalPaper[], groundTruth: Map<string, number>): number {
  for (let i = 0; i < papers.length; i++) {
    const rel = groundTruth.get(papers[i].id) || 0;
    if (rel >= 2) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

function calculateNDCGAtK(papers: NormalizedExternalPaper[], groundTruth: Map<string, number>, k: number = 5): number {
  const topK = papers.slice(0, k);
  if (topK.length === 0) return 0;

  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const rel = groundTruth.get(topK[i].id) || 0;
    dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2);
  }

  // Ideal ranking
  const allRelevances = Array.from(groundTruth.values()).sort((a, b) => b - a).slice(0, k);
  let idcg = 0;
  for (let i = 0; i < allRelevances.length; i++) {
    idcg += (Math.pow(2, allRelevances[i]) - 1) / Math.log2(i + 2);
  }

  return idcg > 0 ? dcg / idcg : 0;
}

describe("Scholarly Relevance Ranking Engine", () => {
  it("Tokenization and modality detection extract clean domain concepts", () => {
    const tokens = getSubstantiveQueryTokens("ARTIFICIAL INTELLIGENCE IN DIAGNOSTIC ULTRASOUND");
    assert.deepEqual(tokens, ["artificial", "intelligence", "diagnostic", "ultrasound"]);

    const detections = detectQueryModalities("ARTIFICIAL INTELLIGENCE IN DIAGNOSTIC ULTRASOUND");
    assert.equal(detections.length >= 1, true);
    assert.equal(detections[0].matchedModality, "ultrasound");
    assert.equal(detections[0].competingModalities.some((m) => m.name === "mri"), true);
  });

  // BENCHMARK 1: Ultrasound AI vs Incidental MRI Radiomics Paper
  it("Benchmark 1: 'Artificial Intelligence in Diagnostic Ultrasound' prioritizes ultrasound over incidental MRI distractor", () => {
    const query = "ARTIFICIAL INTELLIGENCE IN DIAGNOSTIC ULTRASOUND";

    // Candidate A was the actual paper returned at #1 in the unranked pipeline
    const incidentalMriDistractor: NormalizedExternalPaper = {
      id: "doi:10.1007/s00330-022-09148-5",
      title: "Multiparametric MRI-based radiomics nomogram for predicting central lymph node metastasis in papillary thyroid carcinoma",
      abstract: "Preoperative identification of central lymph node metastasis (CLNM) in papillary thyroid carcinoma is critical. While conventional diagnostic ultrasound is widely used as the primary modality, it suffers from low sensitivity. Here, we developed an artificial intelligence machine learning model based on multiparametric MRI radiomics...",
      authors: [{ name: "Li, X." }],
      year: 2022,
      doi: "10.1007/s00330-022-09148-5",
      sourceProviders: ["PUBMED"],
      citationCount: 42,
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
    };

    const trueUltrasoundPaper1: NormalizedExternalPaper = {
      id: "doi:10.1016/j.ultrasmedbio.2023.01.004",
      title: "Artificial Intelligence in Diagnostic Ultrasound: A Systematic Review and Machine Learning Framework",
      abstract: "Diagnostic ultrasound imaging is heavily operator-dependent. Artificial intelligence and deep learning frameworks have revolutionized ultrasound interpretation, automated lesion segmentation, and multi-organ diagnostic classification...",
      authors: [{ name: "Zhang, Y." }, { name: "Smith, J." }],
      year: 2023,
      doi: "10.1016/j.ultrasmedbio.2023.01.004",
      sourceProviders: ["PUBMED", "CROSSREF"],
      citationCount: 78,
      isOpenAccess: true,
      fullTextAvailability: "FULL_TEXT_AVAILABLE",
    };

    const trueUltrasoundPaper2: NormalizedExternalPaper = {
      id: "doi:10.1109/tmi.2023.3245678",
      title: "Deep Neural Networks for Real-Time Diagnostic Ultrasound Lesion Classification",
      abstract: "We introduce a convolutional artificial intelligence pipeline for automated feature extraction in diagnostic ultrasound sequences...",
      authors: [{ name: "Chen, H." }],
      year: 2023,
      doi: "10.1109/tmi.2023.3245678",
      sourceProviders: ["CROSSREF", "SEMANTIC_SCHOLAR"],
      citationCount: 29,
      isOpenAccess: true,
      fullTextAvailability: "FULL_TEXT_AVAILABLE",
    };

    const ctDistractor: NormalizedExternalPaper = {
      id: "doi:10.1148/radiol.2021204567",
      title: "Computed Tomography Evaluation of Acute Abdomen Compared to Emergency Ultrasonography",
      abstract: "A retrospective cohort study comparing multi-slice computed tomography with point-of-care ultrasound...",
      authors: [{ name: "Brown, M." }],
      year: 2021,
      doi: "10.1148/radiol.2021204567",
      sourceProviders: ["PUBMED"],
      citationCount: 15,
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
    };

    const broadSurvey: NormalizedExternalPaper = {
      id: "doi:10.1038/s41746-022-00567-9",
      title: "Artificial Intelligence in Medical Imaging: A Comprehensive Survey Across Modalities",
      abstract: "Review of machine learning applications in medical imaging including radiology, MRI, CT, and ultrasound...",
      authors: [{ name: "Williams, K." }],
      year: 2022,
      doi: "10.1038/s41746-022-00567-9",
      sourceProviders: ["PUBMED", "CROSSREF", "SEMANTIC_SCHOLAR"],
      citationCount: 150,
      isOpenAccess: true,
      fullTextAvailability: "FULL_TEXT_AVAILABLE",
    };

    // Ground Truth labels: 2 = Highly Relevant, 1 = Partially Relevant, 0 = Irrelevant Distractor
    const groundTruth = new Map<string, number>([
      [trueUltrasoundPaper1.id, 2],
      [trueUltrasoundPaper2.id, 2],
      [broadSurvey.id, 1],
      [incidentalMriDistractor.id, 0], // Distractor: primary subject is MRI
      [ctDistractor.id, 0],           // Distractor: primary subject is CT
    ]);

    // BEFORE: In the old pipeline, the MRI paper arrived first and stayed at Rank #1
    const unrankedResults = [
      incidentalMriDistractor, // At index 0!
      ctDistractor,
      broadSurvey,
      trueUltrasoundPaper1,
      trueUltrasoundPaper2,
    ];

    const mrrBefore = calculateMRR(unrankedResults, groundTruth);
    const ndcgBefore = calculateNDCGAtK(unrankedResults, groundTruth, 5);

    // AFTER: Apply new generalized ranking
    const rankedResults = rankScholarlySearchResults(unrankedResults, query);

    const mrrAfter = calculateMRR(rankedResults, groundTruth);
    const ndcgAfter = calculateNDCGAtK(rankedResults, groundTruth, 5);
    const precisionAfter = calculatePrecisionAtK(rankedResults, groundTruth, 5);

    // Verification Requirements:
    // 1. Result #1 must be a true ultrasound AI paper
    assert.equal(rankedResults[0].id, trueUltrasoundPaper1.id);
    // 2. Result #2 must also be an ultrasound paper
    assert.equal(rankedResults[1].id, trueUltrasoundPaper2.id);
    // 3. The incidental MRI paper must be demoted below the ultrasound papers
    const mriIndex = rankedResults.findIndex((p) => p.id === incidentalMriDistractor.id);
    assert.equal(mriIndex >= 3, true, `Incidental MRI distractor was not demoted (rank: ${mriIndex + 1})`);

    // 4. Metric improvements
    assert.equal(mrrAfter > mrrBefore, true, `MRR did not improve: before=${mrrBefore}, after=${mrrAfter}`);
    assert.equal(ndcgAfter > ndcgBefore, true, `nDCG did not improve: before=${ndcgBefore}, after=${ndcgAfter}`);
    assert.equal(mrrAfter, 1.0, "MRR after ranking must be 1.0 (first item is highly relevant)");
  });

  // BENCHMARK 2: Symmetric Invariant (MRI Query)
  it("Benchmark 2: 'Multiparametric MRI in Papillary Thyroid Carcinoma' prioritizes MRI without ultrasound bias", () => {
    const query = "Multiparametric MRI in Papillary Thyroid Carcinoma";

    const mriPaper: NormalizedExternalPaper = {
      id: "doi:10.1007/s00330-022-09148-5",
      title: "Multiparametric MRI-based radiomics nomogram for predicting central lymph node metastasis in papillary thyroid carcinoma",
      abstract: "Evaluation of multiparametric MRI in papillary thyroid carcinoma...",
      authors: [{ name: "Li, X." }],
      year: 2022,
      doi: "10.1007/s00330-022-09148-5",
      sourceProviders: ["PUBMED"],
      citationCount: 42,
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
    };

    const ultrasoundPaper: NormalizedExternalPaper = {
      id: "doi:10.1016/j.ultrasmedbio.2023.01.004",
      title: "Artificial Intelligence in Diagnostic Ultrasound: A Systematic Review and Machine Learning Framework",
      abstract: "Diagnostic ultrasound imaging is operator-dependent...",
      authors: [{ name: "Zhang, Y." }],
      year: 2023,
      doi: "10.1016/j.ultrasmedbio.2023.01.004",
      sourceProviders: ["PUBMED"],
      citationCount: 78,
      isOpenAccess: true,
      fullTextAvailability: "FULL_TEXT_AVAILABLE",
    };

    const ranked = rankScholarlySearchResults([ultrasoundPaper, mriPaper], query);
    // When searching for MRI, the MRI paper must rank #1!
    assert.equal(ranked[0].id, mriPaper.id, "MRI paper was incorrectly demoted for an MRI query");
  });

  // BENCHMARK 3: Mammography vs Chest X-Ray
  it("Benchmark 3: 'Deep Learning in Mammography' ranks mammography papers above chest X-ray distractors", () => {
    const query = "Deep Learning in Mammography";

    const mammographyPaper: NormalizedExternalPaper = {
      id: "doi:10.1148/ryai.2021200056",
      title: "Deep Learning in Mammography: Computer-Aided Diagnosis for Breast Cancer Detection",
      abstract: "We evaluate deep learning convolutional models on screening mammography...",
      authors: [{ name: "Evans, A." }],
      year: 2021,
      doi: "10.1148/ryai.2021200056",
      sourceProviders: ["PUBMED", "CROSSREF"],
      citationCount: 112,
      isOpenAccess: true,
      fullTextAvailability: "FULL_TEXT_AVAILABLE",
    };

    const chestXrayDistractor: NormalizedExternalPaper = {
      id: "doi:10.1016/s2589-7500(20)30086-8",
      title: "Deep Learning for Pulmonary Infiltrate Detection in Chest Radiography",
      abstract: "Chest radiography is common. In contrast to screening mammography, thoracic imaging...",
      authors: [{ name: "Rajpurkar, P." }],
      year: 2020,
      doi: "10.1016/s2589-7500(20)30086-8",
      sourceProviders: ["PUBMED"],
      citationCount: 450, // Higher citations but WRONG modality
      isOpenAccess: true,
      fullTextAvailability: "FULL_TEXT_AVAILABLE",
    };

    const ranked = rankScholarlySearchResults([chestXrayDistractor, mammographyPaper], query);
    assert.equal(ranked[0].id, mammographyPaper.id, "Mammography paper was not ranked #1 despite high citation count of X-ray paper");
  });

  // BENCHMARK 4: Protein Folding Transformers vs NLP Transformers
  it("Benchmark 4: 'Transformer Architectures in Protein Folding' ranks bio-transformers ahead of generic NLP transformers", () => {
    const query = "Transformer Architectures in Protein Folding";

    const proteinFoldingTransformer: NormalizedExternalPaper = {
      id: "doi:10.1038/s41586-021-03819-2",
      title: "Highly accurate protein structure prediction with AlphaFold transformer architectures",
      abstract: "We introduce a novel transformer architecture for predicting protein folding and 3D macromolecular structures...",
      authors: [{ name: "Jumper, J." }],
      year: 2021,
      doi: "10.1038/s41586-021-03819-2",
      sourceProviders: ["CROSSREF", "SEMANTIC_SCHOLAR"],
      citationCount: 8500,
      isOpenAccess: true,
      fullTextAvailability: "FULL_TEXT_AVAILABLE",
    };

    const nlpTransformerLandmark: NormalizedExternalPaper = {
      id: "doi:10.48550/arxiv.1706.03762",
      title: "Attention Is All You Need: Scaled Dot-Product Self-Attention Transformer Architecture",
      abstract: "The dominant sequence transduction models are based on complex recurrent networks. We propose the Transformer...",
      authors: [{ name: "Vaswani, A." }],
      year: 2017,
      doi: "10.48550/arxiv.1706.03762",
      sourceProviders: ["CROSSREF", "SEMANTIC_SCHOLAR"],
      citationCount: 95000, // Enormous citations, but zero protein folding!
      isOpenAccess: true,
      fullTextAvailability: "FULL_TEXT_AVAILABLE",
    };

    const ranked = rankScholarlySearchResults([nlpTransformerLandmark, proteinFoldingTransformer], query);
    assert.equal(ranked[0].id, proteinFoldingTransformer.id, "Protein folding transformer must rank #1 over NLP attention paper for a protein folding query");
  });

  // BENCHMARK 5: Quantum Surface Codes vs Classical Error Correction
  it("Benchmark 5: 'Surface Codes for Quantum Error Correction' ranks quantum papers above classical coding distractors", () => {
    const query = "Surface Codes for Quantum Error Correction";

    const quantumSurfaceCode: NormalizedExternalPaper = {
      id: "doi:10.1103/physreva.86.032324",
      title: "Surface Codes: Towards Practical Large-Scale Quantum Error Correction",
      abstract: "Surface code quantum error correction requires only nearest-neighbor interactions on a 2D lattice...",
      authors: [{ name: "Fowler, A." }],
      year: 2012,
      doi: "10.1103/physreva.86.032324",
      sourceProviders: ["CROSSREF", "SEMANTIC_SCHOLAR"],
      citationCount: 1200,
      isOpenAccess: true,
      fullTextAvailability: "FULL_TEXT_AVAILABLE",
    };

    const classicalLdpcDistractor: NormalizedExternalPaper = {
      id: "doi:10.1109/tit.2001.932115",
      title: "Design of Capacity-Approaching Irregular Low-Density Parity-Check (LDPC) Codes",
      abstract: "Analysis of classical error correction in communication channels...",
      authors: [{ name: "Richardson, T." }],
      year: 2001,
      doi: "10.1109/tit.2001.932115",
      sourceProviders: ["CROSSREF"],
      citationCount: 3500,
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
    };

    const ranked = rankScholarlySearchResults([classicalLdpcDistractor, quantumSurfaceCode], query);
    assert.equal(ranked[0].id, quantumSurfaceCode.id, "Quantum surface code paper was not ranked #1");
  });

  // BENCHMARK 6: Incomplete Metadata & Robustness
  it("Benchmark 6: Incomplete metadata (missing abstract, null citation count) is handled gracefully", () => {
    const query = "Artificial Intelligence in Diagnostic Ultrasound";

    const minimalCrossrefRecord: NormalizedExternalPaper = {
      id: "doi:10.1000/minimal-record-1",
      title: "Artificial Intelligence in Diagnostic Ultrasound",
      abstract: null, // No abstract available from Crossref
      authors: [],    // Empty authors
      year: null,     // Missing year
      citationCount: null, // Null citations
      sourceProviders: ["CROSSREF"],
      isOpenAccess: false,
      fullTextAvailability: "METADATA_ONLY",
    };

    const score = scoreScholarlyPaperRelevance(minimalCrossrefRecord, query);
    assert.equal(Number.isNaN(score.totalScore), false, "Score should not be NaN");
    assert.equal(score.totalScore > 30, true, "Title match should still provide strong score without abstract");

    const ranked = rankScholarlySearchResults([minimalCrossrefRecord], query);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].id, minimalCrossrefRecord.id);
  });
});
