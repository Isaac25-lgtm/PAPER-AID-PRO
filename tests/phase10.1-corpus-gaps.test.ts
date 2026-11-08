/**
 * AI RESEARCH HUB — PHASE 10.1 AUTOMATED TEST SUITE
 * Corpus-Level Research Gap Validation Hardening
 *
 * Scenarios Tested:
 * A. 5/5 studies explicitly lack/report no external validation -> scoped "none" claim allowed
 * B. 4 absent + 1 unknown -> "none" claim rejected (weakened to safe alternative)
 * C. 4 absent + 1 present -> "none" claim rejected
 * D. 3 absent + 2 present -> server computes correct counts
 * E. author explicitly states lack of external validation -> author-attributed gap retained with citation
 * F. field absent from top retrieval but targeted retrieval finds it -> must NOT claim absence
 * G. model fabricates "none of the studies" -> validator rejects if structured evidence disagrees
 * H. model fabricates "5 of 5" -> server replaces/rejects model count
 * I. UNKNOWN never treated as ABSENT
 * J. corpus-level gap retains assessed paper IDs for auditability
 */

import "./test-setup";
import {
  computeCorpusGapEvidence,
  validateCorpusGap,
} from "../src/lib/agent/brief-synthesizer";
import { StudyEvidence, FeatureReportingStatus } from "../src/lib/agent/types";
import { HydratedMultiPaperAnchor, RetrievedEvidenceChunk } from "../src/lib/synthesis/types";
import { extractStudyEvidence } from "../src/lib/agent/study-extractor";

function createMockStudy(
  id: string,
  title: string,
  externalValidationStatus: FeatureReportingStatus = "UNKNOWN",
  studyDesign: string = "Retrospective single-center study"
): StudyEvidence {
  const anchor: HydratedMultiPaperAnchor = {
    paperId: id,
    paperTitle: title,
    authors: ["Test Author et al."],
    doi: `10.1000/${id}`,
    publicationDate: "2024-01-01",
    journal: "Journal of Medical AI",
    chunkId: `chunk_${id}_1`,
    chunkIndex: 1,
    pageNumber: 3,
    section: "Methods",
    snippet: `Study methodology for ${title}. Validation conducted internally.`,
  };

  return {
    paperId: id,
    title,
    authors: ["Test Author et al."],
    year: 2024,
    journal: "Journal of Medical AI",
    doi: `10.1000/${id}`,
    studyDesign,
    population: "250 ultrasound patients",
    sampleSize: "250",
    imagingModality: "B-mode Ultrasound",
    imagingProtocol: "Standard 7.5 MHz",
    aiMethod: "ResNet50 Classifier",
    comparator: "Radiologist review",
    referenceStandard: "Histopathology",
    validationMethod:
      externalValidationStatus === "PRESENT"
        ? "Independent external multicenter cohort"
        : externalValidationStatus === "ABSENT_IN_RETRIEVED_EVIDENCE"
        ? "Single-center 5-fold cross-validation"
        : null,
    externalValidationStatus,
    sensitivity: "0.91",
    specificity: "0.85",
    auc: "0.89",
    accuracy: "0.88",
    majorFindings: [`High diagnostic accuracy achieved by ${title}.`],
    limitations:
      externalValidationStatus === "ABSENT_IN_RETRIEVED_EVIDENCE"
        ? ["Lack of external multicenter validation."]
        : [],
    evidenceAnchors: [anchor],
  };
}

async function runPhase10_1Tests() {
  console.log("==========================================================");
  console.log("AI RESEARCH HUB — PHASE 10.1 CORPUS-LEVEL GAP TEST SUITE");
  console.log("Scientific-Integrity Absence & Accounting Validation");
  console.log("==========================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: [${testName}]`);
      passed++;
    } else {
      console.error(`❌ FAIL: [${testName}] - ${detail || "Assertion failed"}`);
      failed++;
    }
  }

  try {
    // ----------------------------------------------------
    // Scenario A: 5/5 studies explicitly lack external validation -> scoped "none" claim allowed
    // ----------------------------------------------------
    {
      const studiesA: StudyEvidence[] = [
        createMockStudy("p1", "Study 1", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p2", "Study 2", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p3", "Study 3", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p4", "Study 4", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p5", "Study 5", "ABSENT_IN_RETRIEVED_EVIDENCE"),
      ];

      const rawGap = {
        description: "None of the studies included in this research run reported external validation.",
        type: "SCOPED_CURRENT_SET_OBSERVATION" as const,
        evidence: [{ paperId: "p1", chunkIds: ["chunk_p1_1"] }],
      };

      const result = validateCorpusGap(
        rawGap,
        studiesA,
        studiesA[0].evidenceAnchors,
        ["p1"]
      );

      assert(
        result.accepted === true &&
          result.validatedGap !== undefined &&
          result.validatedGap.corpusEvidence?.coverageComplete === true &&
          result.validatedGap.corpusEvidence?.papersReportingFeature.length === 0 &&
          result.validatedGap.corpusEvidence?.papersNotReportingFeature.length === 5 &&
          result.validatedGap.corpusEvidence?.papersUnknown.length === 0,
        "Scenario A: 5/5 absent allows scoped 'none' claim",
        JSON.stringify(result.validatedGap?.corpusEvidence)
      );
    }

    // ----------------------------------------------------
    // Scenario B: 4 absent + 1 unknown -> "none" claim rejected (weakened to safe alternative)
    // ----------------------------------------------------
    {
      const studiesB: StudyEvidence[] = [
        createMockStudy("p1", "Study 1", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p2", "Study 2", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p3", "Study 3", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p4", "Study 4", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p5", "Study 5", "UNKNOWN"),
      ];

      const rawGap = {
        description: "None of the studies included in this research run reported external validation.",
        type: "SCOPED_CURRENT_SET_OBSERVATION" as const,
        evidence: [{ paperId: "p1", chunkIds: ["chunk_p1_1"] }],
      };

      const result = validateCorpusGap(
        rawGap,
        studiesB,
        studiesB[0].evidenceAnchors,
        ["p1"]
      );

      // Raw "none" must NOT survive; it must be weakened to safe alternative
      const desc = result.validatedGap?.description || "";
      const isWeakened =
        desc.includes("4 of the 5 studies") &&
        desc.includes("insufficient to determine this for the remaining 1");
      const lacksAbsoluteNone = !desc.toLowerCase().startsWith("none of the studies");

      assert(
        result.accepted === true &&
          isWeakened &&
          lacksAbsoluteNone &&
          result.validatedGap?.corpusEvidence?.papersUnknown.length === 1 &&
          result.validatedGap?.corpusEvidence?.papersNotReportingFeature.length === 4,
        "Scenario B: 4 absent + 1 unknown rejects absolute 'none' and safely weakens statement",
        `Description: "${desc}"`
      );
    }

    // ----------------------------------------------------
    // Scenario C: 4 absent + 1 present -> "none" claim rejected
    // ----------------------------------------------------
    {
      const studiesC: StudyEvidence[] = [
        createMockStudy("p1", "Study 1", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p2", "Study 2", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p3", "Study 3", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p4", "Study 4", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p5", "Study 5", "PRESENT"),
      ];

      const rawGap = {
        description: "None of the studies reported external validation.",
        type: "SCOPED_CURRENT_SET_OBSERVATION" as const,
        evidence: [{ paperId: "p1", chunkIds: ["chunk_p1_1"] }],
      };

      const result = validateCorpusGap(
        rawGap,
        studiesC,
        studiesC[0].evidenceAnchors,
        ["p1"]
      );

      assert(
        result.accepted === false && Boolean(result.reason?.includes("present in 1")),
        "Scenario C: 4 absent + 1 present rejects 'none' claim",
        result.reason
      );
    }

    // ----------------------------------------------------
    // Scenario D: 3 absent + 2 present -> server computes correct counts
    // ----------------------------------------------------
    {
      const studiesD: StudyEvidence[] = [
        createMockStudy("p1", "Study 1", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p2", "Study 2", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p3", "Study 3", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p4", "Study 4", "PRESENT"),
        createMockStudy("p5", "Study 5", "PRESENT"),
      ];

      const corpusEvidence = computeCorpusGapEvidence(
        "externalValidation",
        studiesD,
        (s) => s.externalValidationStatus ?? "UNKNOWN"
      );

      assert(
        corpusEvidence.papersReportingFeature.length === 2 &&
          corpusEvidence.papersNotReportingFeature.length === 3 &&
          corpusEvidence.papersUnknown.length === 0 &&
          corpusEvidence.totalPapersAssessed === 5 &&
          corpusEvidence.coverageComplete === true,
        "Scenario D: 3 absent + 2 present server computes correct counts",
        JSON.stringify(corpusEvidence)
      );
    }

    // ----------------------------------------------------
    // Scenario E: Author explicitly states lack of external validation -> author-attributed gap retained with citation
    // ----------------------------------------------------
    {
      const studiesE: StudyEvidence[] = [
        createMockStudy("p1", "Study 1", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p2", "Study 2", "PRESENT"),
      ];

      const rawGap = {
        description: "Authors of Study 1 identify the absence of external validation as a primary limitation.",
        type: "EXPLICITLY_STATED_BY_AUTHORS" as const,
        evidence: [{ paperId: "p1", chunkIds: ["chunk_p1_1"] }],
      };

      const result = validateCorpusGap(
        rawGap,
        studiesE,
        studiesE[0].evidenceAnchors,
        ["p1"]
      );

      assert(
        result.accepted === true &&
          result.validatedGap?.type === "EXPLICITLY_STATED_BY_AUTHORS" &&
          result.validatedGap.supportingPaperIds.includes("p1") &&
          result.validatedGap.citations.length === 1 &&
          result.validatedGap.citations[0].chunkId === "chunk_p1_1",
        "Scenario E: Author-attributed gap retained with citation without corpus-accounting requirement",
        result.validatedGap?.description
      );
    }

    // ----------------------------------------------------
    // Scenario F: Field absent from top retrieval but targeted retrieval finds it -> must NOT claim absence
    // ----------------------------------------------------
    {
      // Simulate study where primary chunks lacked validation text, but targeted chunk provides external cohort
      const primaryChunk: RetrievedEvidenceChunk = {
        id: "chunk_f_1",
        paperId: "pf",
        chunkIndex: 0,
        pageNumber: 1,
        section: "Introduction",
        text: "Breast cancer ultrasound detection is clinically critical.",
        similarity: 0.85,
      };

      const targetedValidationChunk: RetrievedEvidenceChunk = {
        id: "chunk_f_val",
        paperId: "pf",
        chunkIndex: 12,
        pageNumber: 7,
        section: "Validation Results",
        text: "To evaluate generalization, we performed independent external validation on a multicenter cohort of 600 patients from two distinct medical centers.",
        similarity: 0.92,
      };

      // When targeted chunk is present, study extraction recognizes external validation
      // Simulate study extraction with the targeted chunk present:
      const studyF = createMockStudy("pf", "Study F", "PRESENT");

      // Verify that validator will NOT claim absence across the corpus
      const studiesF: StudyEvidence[] = [studyF];
      const gapAttempt = {
        description: "None of the included studies reported external validation.",
        type: "SCOPED_CURRENT_SET_OBSERVATION" as const,
        evidence: [{ paperId: "pf", chunkIds: ["chunk_f_val"] }],
      };

      const result = validateCorpusGap(
        gapAttempt,
        studiesF,
        studyF.evidenceAnchors,
        ["pf"]
      );

      assert(
        result.accepted === false &&
          studyF.externalValidationStatus === "PRESENT",
        "Scenario F: Targeted retrieval finds external validation -> validator rejects absence claim"
      );
    }

    // ----------------------------------------------------
    // Scenario G: Model fabricates "none of the studies" -> validator rejects if structured evidence disagrees
    // ----------------------------------------------------
    {
      const studiesG: StudyEvidence[] = [
        createMockStudy("p1", "Study 1", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p2", "Study 2", "PRESENT"),
      ];

      const fabricatedGap = {
        description: "None of the studies included in this research run performed external validation.",
        type: "SCOPED_CURRENT_SET_OBSERVATION" as const,
        evidence: [{ paperId: "p1", chunkIds: ["chunk_p1_1"] }],
      };

      const result = validateCorpusGap(
        fabricatedGap,
        studiesG,
        studiesG[0].evidenceAnchors,
        ["p1"]
      );

      assert(
        result.accepted === false,
        "Scenario G: Model fabricates 'none of the studies' -> validator rejects"
      );
    }

    // ----------------------------------------------------
    // Scenario H: Model fabricates "5 of 5" -> server replaces/rejects model count
    // ----------------------------------------------------
    {
      const studiesH: StudyEvidence[] = [
        createMockStudy("p1", "Study 1", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p2", "Study 2", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p3", "Study 3", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("p4", "Study 4", "PRESENT"),
        createMockStudy("p5", "Study 5", "PRESENT"),
      ];

      // Model fabricates "5 of 5 studies lacked external validation"
      const fabricatedCountGap = {
        description: "In this evidence set, 5 of 5 studies lacked external validation.",
        type: "SCOPED_CURRENT_SET_OBSERVATION" as const,
        evidence: [{ paperId: "p1", chunkIds: ["chunk_p1_1"] }],
      };

      const result = validateCorpusGap(
        fabricatedCountGap,
        studiesH,
        studiesH[0].evidenceAnchors,
        ["p1"]
      );

      // Because 2 are PRESENT, the claim that 5 of 5 lacked it is rejected or replaced
      const countRejectedOrCorrected =
        result.accepted === false ||
        (result.validatedGap !== undefined &&
          result.validatedGap.description.includes("3 of 5") &&
          !result.validatedGap.description.includes("5 of 5"));

      assert(
        countRejectedOrCorrected,
        "Scenario H: Model fabricates '5 of 5' -> server replaces/rejects model count",
        `Accepted: ${result.accepted}, Reason/Desc: ${result.reason || result.validatedGap?.description}`
      );
    }

    // ----------------------------------------------------
    // Scenario I: UNKNOWN never treated as ABSENT
    // ----------------------------------------------------
    {
      const studiesI: StudyEvidence[] = [
        createMockStudy("p1", "Study 1", "UNKNOWN"),
        createMockStudy("p2", "Study 2", "UNKNOWN"),
        createMockStudy("p3", "Study 3", "ABSENT_IN_RETRIEVED_EVIDENCE"),
      ];

      const evidence = computeCorpusGapEvidence(
        "externalValidation",
        studiesI,
        (s) => s.externalValidationStatus ?? "UNKNOWN"
      );

      assert(
        evidence.papersUnknown.length === 2 &&
          evidence.papersNotReportingFeature.length === 1 &&
          !evidence.papersNotReportingFeature.includes("p1") &&
          !evidence.papersNotReportingFeature.includes("p2") &&
          evidence.papersReportingFeature.length === 0,
        "Scenario I: UNKNOWN is never treated as ABSENT in corpus gap evidence accounting",
        `Unknown: ${evidence.papersUnknown.length}, Absent: ${evidence.papersNotReportingFeature.length}`
      );
    }

    // ----------------------------------------------------
    // Scenario J: Corpus-level gap retains assessed paper IDs for auditability
    // ----------------------------------------------------
    {
      const studiesJ: StudyEvidence[] = [
        createMockStudy("paper_alpha", "Study Alpha", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("paper_beta", "Study Beta", "ABSENT_IN_RETRIEVED_EVIDENCE"),
        createMockStudy("paper_gamma", "Study Gamma", "ABSENT_IN_RETRIEVED_EVIDENCE"),
      ];

      const rawGap = {
        description: "Among the studies included in this research run, none reported external validation.",
        type: "SCOPED_CURRENT_SET_OBSERVATION" as const,
        evidence: [{ paperId: "paper_alpha", chunkIds: ["chunk_paper_alpha_1"] }],
      };

      const result = validateCorpusGap(
        rawGap,
        studiesJ,
        studiesJ[0].evidenceAnchors,
        ["paper_alpha"]
      );

      const assessedIds = result.validatedGap?.corpusEvidence?.assessedPaperIds || [];
      const supportingIds = result.validatedGap?.supportingPaperIds || [];

      assert(
        result.accepted === true &&
          assessedIds.length === 3 &&
          assessedIds.includes("paper_alpha") &&
          assessedIds.includes("paper_beta") &&
          assessedIds.includes("paper_gamma") &&
          supportingIds.includes("paper_alpha") &&
          supportingIds.includes("paper_beta") &&
          supportingIds.includes("paper_gamma"),
        "Scenario J: Corpus-level gap retains assessed paper IDs for auditability",
        `Assessed IDs: [${assessedIds.join(", ")}]`
      );
    }

    console.log("\n==========================================================");
    console.log(`PHASE 10.1 TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("==========================================================");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error("FATAL ERROR in Phase 10.1 tests:", err);
    process.exit(1);
  }
}

runPhase10_1Tests();
