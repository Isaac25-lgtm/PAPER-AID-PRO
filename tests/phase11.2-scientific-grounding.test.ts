import "./test-setup";
import { prisma } from "../src/lib/prisma";
import {
  validateMultiPaperSynthesis,
  isDomainMismatched,
  isBackgroundLiteratureReview,
  isNonComparableOrPseudoDisagreement,
  isClaimSupportedByChunk,
  isThirdPartyLiteratureChunk,
  isAiAttributionToClinicalStudy,
  isTechnologySupportedByPaper,
  isAccuracyPropositionSupported,
  isHypotheticalBenefitTreatedAsEmpiricalResult,
  isLimitationSupportedByChunk,
  verifyEvidencePassage,
  isComparativeSuperioritySupported,
  hasUnqualifiedUniversalAssertion,
  splitOrPruneCompoundClaim,
  qualifyUniversalClaimIfNeeded,
} from "../src/lib/synthesis/validate-multipaper-citations";
import { isReferenceChunk, retrieveMultiPaperEvidence } from "../src/lib/synthesis/retrieve-multipaper-evidence";
import { discoverRelevantPapers } from "../src/lib/synthesis/discover-papers";
import { PaperEvidenceSet } from "../src/lib/synthesis/types";
import { MultiPaperSynthesisOutput } from "../src/lib/synthesis/schemas";

async function runPhase11_2Tests() {
  console.log("================================================================================");
  console.log("PHASE 11.2: PRODUCTION SCIENTIFIC-GROUNDING & CITATION CORRECTION TEST SUITE");
  console.log("================================================================================\n");

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

  try {
    // -----------------------------------------------------------------------------------------
    // Setup Mock & Real Evidence Sets
    // -----------------------------------------------------------------------------------------
    const bp1Found = await prisma.paper.findFirst({
      where: { title: { contains: "Ultrasound-Based Breast Cancer Classification", mode: "insensitive" } },
      include: { chunks: { take: 5, orderBy: { chunkIndex: "asc" } } },
    });

    const bp2Found = await prisma.paper.findFirst({
      where: { title: { contains: "BI-RADS category 4", mode: "insensitive" } },
      include: { chunks: { take: 5, orderBy: { chunkIndex: "asc" } } },
    });

    const skinFound = await prisma.paper.findFirst({
      where: { title: { contains: "Benign Skin Tumors", mode: "insensitive" } },
      include: { chunks: { take: 5, orderBy: { chunkIndex: "asc" } } },
    });

    assert(Boolean(bp1Found), "Breast cancer classification paper (bp1Found) must exist in database");
    assert(Boolean(bp2Found), "BI-RADS category 4 paper (bp2Found) must exist in database");
    assert(Boolean(skinFound), "Benign skin tumors paper (skinFound) must exist in database");

    const breastPaper1 = bp1Found!;
    const breastPaper2 = bp2Found!;
    const skinTumorPaper = skinFound!;

    const breastEvidenceSet1: PaperEvidenceSet = {
      paperId: breastPaper1.id,
      paperTitle: breastPaper1.title,
      authors: ["Magnuska et al."],
      publicationDate: "2022-06-01",
      doi: breastPaper1.doi,
      journal: breastPaper1.journal,
      citationCount: breastPaper1.citationCount,
      chunks: [
        {
          id: "chunk-breast-results-01",
          paperId: breastPaper1.id,
          chunkIndex: 14,
          section: "Methods",
          pageNumber: 14,
          text: "3.4. Breast Lesion Classification Using Image-Based Features. The three best-performing breast lesion classification models achieved an accuracy of 0.84 on ultrasound images.",
          similarity: 0.67,
          semanticRank: 1,
        },
      ],
    };

    const breastEvidenceSet2: PaperEvidenceSet = {
      paperId: breastPaper2.id,
      paperTitle: breastPaper2.title,
      authors: ["Li et al."],
      publicationDate: "2025-01-01",
      doi: breastPaper2.doi,
      journal: breastPaper2.journal,
      citationCount: breastPaper2.citationCount,
      chunks: [
        {
          id: "chunk-breast-discussion-02",
          paperId: breastPaper2.id,
          chunkIndex: 6,
          section: "Discussion",
          pageNumber: 6,
          text: "Multimodal ultrasound examination significantly improved diagnostic differentiation of benign and malignant BI-RADS category 4 breast lesions.",
          similarity: 0.62,
          semanticRank: 1,
        },
        {
          id: "chunk-breast-reference-03",
          paperId: breastPaper2.id,
          chunkIndex: 14,
          section: "References",
          pageNumber: 14,
          text: "10. Quantitative multiparametric breast ultrasound: application of contrast-enhanced ultrasound and Elastography leads to an improved differentiation of benign and malignant lesions. Investig Radiol. (2019) 54:257–64. doi:10.1097/RLI.0000000000000543",
          similarity: 0.65,
          semanticRank: 2,
        },
        {
          id: "chunk-breast-cost-limitation",
          paperId: breastPaper2.id,
          chunkIndex: 7,
          section: "Discussion",
          pageNumber: 6,
          text: "Additionally, combining CEUS and SWE technologies has limited effect on reducing the positive predictive value (PPV), and it will increase the examination costs for patients.",
          similarity: 0.58,
          semanticRank: 3,
        },
      ],
    };

    const skinTumorEvidenceSet: PaperEvidenceSet = {
      paperId: skinTumorPaper.id,
      paperTitle: skinTumorPaper.title, // "Deep Learning-Based Evaluation of Ultrasound Images for Benign Skin Tumors"
      authors: ["Kim et al."],
      publicationDate: "2023-09-01",
      doi: skinTumorPaper.doi,
      journal: skinTumorPaper.journal,
      citationCount: skinTumorPaper.citationCount,
      chunks: [
        {
          id: "chunk-skin-results-01",
          paperId: skinTumorPaper.id,
          chunkIndex: 9,
          section: "Results",
          pageNumber: 9,
          text: "Recently, studies on the diagnosis of skin disease by analyzing skin images using artificial intelligence such as CNN have been actively conducted [31–37]. In particular, when applied to dermoscopic images, accuracy increases...",
          similarity: 0.57,
          semanticRank: 1,
        },
        {
          id: "chunk-skin-results-02",
          paperId: skinTumorPaper.id,
          chunkIndex: 10,
          section: "Results",
          pageNumber: 10,
          text: "Sensors 2023, 23, 7374 10 of 13 of intervening subjective factors in the inspection, such as changes or artifacts in the image depending on the pressure, direction, and position of the inspector pressing the probe. Our diagnosis algorithm using combined CNN showed high performance for epidermal cysts, lipoma, and pilomatricoma.",
          similarity: 0.56,
          semanticRank: 2,
        },
      ],
    };

    const backgroundLiteratureEvidenceSet: PaperEvidenceSet = {
      paperId: "paper-background-test",
      paperTitle: "A New Deep-Learning-Based Model for Breast Cancer Diagnosis from Medical Images",
      authors: ["Author et al."],
      publicationDate: "2023-01-01",
      doi: "10.3390/diagnostics131944",
      journal: "Diagnostics",
      citationCount: 15,
      chunks: [
        {
          id: "chunk-background-survey-01",
          paperId: "paper-background-test",
          chunkIndex: 3,
          section: "Background",
          pageNumber: 3,
          text: "In the study presented in [17], various deep-learning models were employed to classify breast cancer ultrasound images based on their benign, malignant, or normal status. A dataset comprising a total of 780 images was utilized...",
          similarity: 0.58,
          semanticRank: 1,
        },
        {
          id: "chunk-results-actual-02",
          paperId: "paper-background-test",
          chunkIndex: 16,
          section: "Results",
          pageNumber: 16,
          text: "Our proposed architecture achieved an overall classification accuracy of 94.2% across the normal, benign, and malignant test partitions.",
          similarity: 0.54,
          semanticRank: 2,
        },
      ],
    };

    const allTestEvidenceSets = [
      breastEvidenceSet1,
      breastEvidenceSet2,
      skinTumorEvidenceSet,
      backgroundLiteratureEvidenceSet,
    ];

    // =========================================================================================
    // FAILURE 1 & 2 REGRESSION TESTS: Breast Ultrasound vs Skin Tumor Domain Confusion
    // =========================================================================================
    console.log("--- Test Group 1: Negative Control — Breast Ultrasound vs Skin Ultrasound ---");

    // Direct unit test of isDomainMismatched
    const isMismatchedDirect = isDomainMismatched(
      "AI-assisted breast ultrasound classification achieved high accuracy.",
      "Deep Learning-Based Evaluation of Ultrasound Images for Benign Skin Tumors",
      "Results",
      skinTumorEvidenceSet.chunks[0].text,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(isMismatchedDirect, "isDomainMismatched flags skin tumor paper for breast ultrasound claim");

    // Failure 1: A claim about breast ultrasound diagnostic accuracy cited skin tumor paper
    const modelOutputFailure1: MultiPaperSynthesisOutput = {
      claims: [
        {
          text: "AI-assisted breast ultrasound classification using deep learning techniques has shown high diagnostic accuracy in differentiating lesions.",
          evidence: [
            {
              paperId: skinTumorPaper.id,
              chunkIds: ["chunk-skin-results-01"],
            },
          ],
        },
      ],
      disagreements: [],
      limitations: [],
      insufficientEvidence: false,
    };

    const resultF1 = validateMultiPaperSynthesis(
      modelOutputFailure1,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(resultF1.claims.length === 0, "Failure 1: Skin-tumor claim dropped when asserted as breast evidence");
    assert(resultF1.rejectedCitationCount === 1, "Failure 1: Rejected citation count incremented for domain mismatch");
    assert(resultF1.rejectedClaimsCount === 1, "Failure 1: Rejected claims count incremented");
    assert(resultF1.insufficientEvidence === true, "Failure 1: Falls back to insufficient evidence when all claims rejected");

    // Failure 2: A claim about automating breast ultrasound classification cited same skin study
    const modelOutputFailure2: MultiPaperSynthesisOutput = {
      claims: [
        {
          text: "AI-assisted classification systems can automate the diagnosis process for breast ultrasound images, reducing radiologist workload.",
          evidence: [
            {
              paperId: skinTumorPaper.id,
              chunkIds: ["chunk-skin-results-02"],
            },
          ],
        },
      ],
      disagreements: [],
      limitations: [],
      insufficientEvidence: false,
    };

    const resultF2 = validateMultiPaperSynthesis(
      modelOutputFailure2,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(resultF2.claims.length === 0, "Failure 2: Automating breast ultrasound claim citing skin tumor dropped");
    assert(resultF2.rejectedCitationCount === 1, "Failure 2: Rejected citation recorded for automating claim");

    // Positive Control: Valid Breast Claim Citing Actual Breast Paper
    const modelOutputPositiveBreast: MultiPaperSynthesisOutput = {
      claims: [
        {
          text: "Computer-aided decision support systems using image-based features achieved an accuracy of 0.84 on breast ultrasound classification.",
          evidence: [
            {
              paperId: breastPaper1.id,
              chunkIds: ["chunk-breast-results-01"],
            },
          ],
        },
      ],
      disagreements: [],
      limitations: [],
      insufficientEvidence: false,
    };

    const resultPosBreast = validateMultiPaperSynthesis(
      modelOutputPositiveBreast,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(resultPosBreast.claims.length === 1, "Positive Control: Valid breast claim citing breast paper is accepted");
    assert(resultPosBreast.claims[0].supportingPaperCount === 1, "Positive Control: Supporting paper count is 1");
    assert(resultPosBreast.claims[0].citations[0].paperId === breastPaper1.id, "Positive Control: Grounded in breastPaper1");

    // =========================================================================================
    // FAILURE 3 REGRESSION TESTS: Empirical Results vs Introductory Background
    // =========================================================================================
    console.log("\n--- Test Group 2: Negative Control — Empirical Results vs Introductory Background ---");

    // Direct unit tests of isBackgroundLiteratureReview and isThirdPartyLiteratureChunk
    const isBackgroundReviewDirect = isBackgroundLiteratureReview(
      "Deep learning models effectively classify breast cancer ultrasound images into benign or malignant categories achieving high accuracy.",
      "Background",
      "In the study presented in [17], various deep-learning models were employed to classify breast cancer ultrasound images based on their benign, malignant, or normal status."
    );
    assert(isBackgroundReviewDirect, "isBackgroundLiteratureReview detects third-party literature citation [17] in Background");

    // Pattern 1: 'The study proposed by [30]'
    const isStudyProposedByDirect = isThirdPartyLiteratureChunk(
      "Background",
      "The study proposed by [30] implemented the multilevel transfer-learning (MSTL) algorithm using three pre-trained models."
    );
    assert(isStudyProposedByDirect, "isThirdPartyLiteratureChunk detects 'The study proposed by [30]' pattern");

    // Pattern 2: 'In [30], the authors...'
    const isInAuthorsDirect = isThirdPartyLiteratureChunk(
      "Introduction",
      "In [30], the authors explored transfer learning for ultrasound classification with ResNet50."
    );
    assert(isInAuthorsDirect, "isThirdPartyLiteratureChunk detects 'In [30], the authors...' pattern");

    // Pattern 3: Author-year reviews
    const isAuthorYearDirect1 = isThirdPartyLiteratureChunk(
      "Background",
      "Sun et al. (2021) conducted a study utilizing a convolutional neural network (CNN) trained and tested on ultrasound images of 169 patients."
    );
    assert(isAuthorYearDirect1, "isThirdPartyLiteratureChunk detects author-year 'Sun et al. (2021)' review in Background");

    const isAuthorYearDirect2 = isThirdPartyLiteratureChunk(
      "Background",
      "Lee et al. [27] conducted a study utilizing a deep-learning-based computer-aided prediction system for ultrasound (US) images."
    );
    assert(isAuthorYearDirect2, "isThirdPartyLiteratureChunk detects author-citation 'Lee et al. [27]' review in Background");

    // Preservation: Genuine findings in Results / Discussion citing benchmarks are NOT rejected
    const isResultsBenchmarkPreserved = !isThirdPartyLiteratureChunk(
      "Results",
      "The experimental results showed that the FC-CNN architecture using multiple time-domain feature maps achieved an accuracy of 94.2%, outperforming the standard benchmark [15]."
    );
    assert(isResultsBenchmarkPreserved, "isThirdPartyLiteratureChunk preserves genuine Results passage citing benchmark [15]");

    const isDiscussionComparisonPreserved = !isThirdPartyLiteratureChunk(
      "Discussion",
      "Our proposed model demonstrated superior sensitivity (92.5%) compared to conventional B-mode imaging. Similar trends were observed in previous clinical trials [8], confirming our empirical observations."
    );
    assert(isDiscussionComparisonPreserved, "isThirdPartyLiteratureChunk preserves genuine Discussion passage citing prior trial [8]");

    const isMethodsArchitecturePreserved = !isThirdPartyLiteratureChunk(
      "Methods",
      "We trained the ResNet-50 architecture as described in [12] on our proprietary dataset of 500 ultrasound scans."
    );
    assert(isMethodsArchitecturePreserved, "isThirdPartyLiteratureChunk preserves genuine Methods passage citing architecture [12]");

    // Failure 3: Citing introductory background literature survey as current paper's own improvement
    const modelOutputFailure3: MultiPaperSynthesisOutput = {
      claims: [
        {
          text: "Deep learning models have been shown to effectively classify breast cancer ultrasound images into normal, benign, or malignant categories.",
          evidence: [
            {
              paperId: "paper-background-test",
              chunkIds: ["chunk-background-survey-01"],
            },
          ],
        },
      ],
      disagreements: [],
      limitations: [],
      insufficientEvidence: false,
    };

    const resultF3 = validateMultiPaperSynthesis(
      modelOutputFailure3,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(resultF3.claims.length === 0, "Failure 3: Background literature survey citation rejected as empirical finding");
    assert(resultF3.rejectedCitationCount === 1, "Failure 3: Background survey citation counted as rejected");

    // Positive Control: Citing current paper's own Results chunk
    const modelOutputActualResults: MultiPaperSynthesisOutput = {
      claims: [
        {
          text: "The proposed deep architecture achieved an accuracy of 94.2% across normal, benign, and malignant breast ultrasound images.",
          evidence: [
            {
              paperId: "paper-background-test",
              chunkIds: ["chunk-results-actual-02"],
            },
          ],
        },
      ],
      disagreements: [],
      limitations: [],
      insufficientEvidence: false,
    };

    const resultActualResults = validateMultiPaperSynthesis(
      modelOutputActualResults,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(resultActualResults.claims.length === 1, "Positive Control: Actual empirical Results chunk accepted");
    assert(resultActualResults.claims[0].citations[0].section === "Results", "Positive Control: Citation section is Results");

    // =========================================================================================
    // FAILURE 4 REGRESSION TESTS: Original Findings vs References Section
    // =========================================================================================
    console.log("\n--- Test Group 3: Negative Control — Original Findings vs References Section ---");

    // Direct unit test of isReferenceChunk
    const isRefChunkDirect = isReferenceChunk(
      "References",
      "10. Quantitative multiparametric breast ultrasound: application of contrast-enhanced ultrasound. Investig Radiol. (2019) 54:257–64."
    );
    assert(isRefChunkDirect, "isReferenceChunk flags chunk with section 'References'");

    const isRefTextDirect = isReferenceChunk(
      null,
      "[1] Smith et al., Nature 2021. doi:10.1038/s41586-021\n[2] Jones et al., Science 2020. doi:10.1126/science\n[3] Wang et al., Cell 2022. doi:10.1016/j.cell"
    );
    assert(isRefTextDirect, "isReferenceChunk detects bibliography text pattern even when section is null");

    // Failure 4: Claim citing references section chunk
    const modelOutputFailure4: MultiPaperSynthesisOutput = {
      claims: [
        {
          text: "Multimodal ultrasound examination, including contrast-enhanced ultrasound and elastography, improves the differentiation of benign and malignant breast lesions.",
          evidence: [
            {
              paperId: breastPaper2.id,
              chunkIds: ["chunk-breast-reference-03"],
            },
          ],
        },
      ],
      disagreements: [],
      limitations: [],
      insufficientEvidence: false,
    };

    const resultF4 = validateMultiPaperSynthesis(
      modelOutputFailure4,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(resultF4.claims.length === 0, "Failure 4: Claim citing References section strictly dropped");
    assert(resultF4.rejectedCitationCount === 1, "Failure 4: Reference citation recorded as rejected");

    // Positive Control: Valid Discussion chunk from same paper accepted
    const modelOutputValidDiscussion: MultiPaperSynthesisOutput = {
      claims: [
        {
          text: "Multimodal ultrasound examination significantly improved diagnostic differentiation of BI-RADS 4 breast lesions.",
          evidence: [
            {
              paperId: breastPaper2.id,
              chunkIds: ["chunk-breast-discussion-02"],
            },
          ],
        },
      ],
      disagreements: [],
      limitations: [],
      insufficientEvidence: false,
    };

    const resultValidDiscussion = validateMultiPaperSynthesis(
      modelOutputValidDiscussion,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(resultValidDiscussion.claims.length === 1, "Positive Control: Valid Discussion passage accepted");
    assert(resultValidDiscussion.claims[0].citations[0].section === "Discussion", "Positive Control: Section is Discussion");

    // =========================================================================================
    // FAILURE 5 REGRESSION TESTS: Unsupported Comparative Claims & Inspectable Disagreements
    // =========================================================================================
    console.log("\n--- Test Group 4: Negative Control — Unsupported Comparative Claims (< 2 Papers) ---");

    // Failure 5A: Disagreement citing only 1 paper
    const modelOutputSinglePaperDisagreement: MultiPaperSynthesisOutput = {
      claims: [
        {
          text: "Image-based computer-aided decision systems show clinical utility for breast lesion diagnosis.",
          evidence: [
            {
              paperId: breastPaper1.id,
              chunkIds: ["chunk-breast-results-01"],
            },
          ],
        },
      ],
      disagreements: [
        {
          description: "Studies diverge on whether feature selection or end-to-end deep learning is more effective.",
          evidence: [
            {
              paperId: breastPaper1.id, // Only 1 paper!
              chunkIds: ["chunk-breast-results-01"],
            },
          ],
        },
      ],
      limitations: [],
      insufficientEvidence: false,
    };

    const resultF5A = validateMultiPaperSynthesis(
      modelOutputSinglePaperDisagreement,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(resultF5A.disagreements.length === 0, "Failure 5A: Single-paper disagreement rejected from disagreements array");
    assert(resultF5A.limitations.length === 0, "Failure 5A: Single-paper disagreement without independent limitation support discarded completely");

    // Positive Control 5B: Valid cross-study disagreement supported by 2 distinct papers
    const modelOutputValidDisagreement: MultiPaperSynthesisOutput = {
      claims: [
        {
          text: "Ultrasound modalities provide diagnostic value for breast cancer classification.",
          evidence: [
            {
              paperId: breastPaper1.id,
              chunkIds: ["chunk-breast-results-01"],
            },
          ],
        },
      ],
      disagreements: [
        {
          description: "Study A reported that ResNet architectures achieved superior classification accuracy over DenseNet on breast ultrasound, whereas Study B found that DenseNet significantly outperformed ResNet on breast lesion classification.",
          evidence: [
            {
              paperId: breastPaper1.id,
              chunkIds: ["chunk-breast-results-01"],
            },
            {
              paperId: breastPaper2.id,
              chunkIds: ["chunk-breast-discussion-02"],
            },
          ],
        },
      ],
      limitations: [],
      insufficientEvidence: false,
    };

    const resultF5B = validateMultiPaperSynthesis(
      modelOutputValidDisagreement,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(resultF5B.disagreements.length === 1, "Positive Control 5B: Genuine empirical disagreement on comparable methods accepted");
    assert(resultF5B.disagreements[0].supportingPaperIds.length === 2, "Positive Control 5B: supportingPaperIds length is 2");
    assert(resultF5B.disagreements[0].citations.length === 2, "Positive Control 5B: Disagreement carries 2 hydrated citations");
    assert(resultF5B.disagreements[0].citations[0].paperTitle === breastPaper1.title, "Positive Control 5B: First citation title hydrated");
    assert(resultF5B.disagreements[0].citations[1].paperTitle === breastPaper2.title, "Positive Control 5B: Second citation title hydrated");
    assert(resultF5B.disagreements[0].citations[0].pageNumber === 14, "Positive Control 5B: Page number hydrated");
    assert(resultF5B.disagreements[0].citations[0].section === "Methods", "Positive Control 5B: Section hydrated");
    assert(!!resultF5B.disagreements[0].citations[0].snippet, "Positive Control 5B: Verbatim snippet present");

    // =========================================================================================
    // TASK 3 REGRESSION TESTS: Complementary Findings Incorrectly Classified as Disagreements
    // =========================================================================================
    console.log("\n--- Test Group 4B: Negative Controls — Complementary Findings Incorrectly Classified as Disagreements ---");

    // 1. Direct unit test of isNonComparableOrPseudoDisagreement
    const pseudoCeusCad = isNonComparableOrPseudoDisagreement(
      "Li et al. reported that combining CEUS and SWE has limited effects on the positive predictive value, while Magnuska et al. found that their classification models achieved high accuracy, suggesting a discrepancy in the perceived effectiveness of different AI-assisted techniques."
    );
    assert(pseudoCeusCad.isPseudo, "isNonComparableOrPseudoDisagreement flags CEUS/SWE vs CAD/AI as pseudo-disagreement");
    assert(!!pseudoCeusCad.reason?.includes("clinical imaging"), "isNonComparableOrPseudoDisagreement identifies modality difference");

    const pseudoOperator = isNonComparableOrPseudoDisagreement(
      "The study by Li et al. suggests that the operator-dependent nature of breast cancer diagnosis can lead to misdetection, while Magnuska et al. focused on the performance of specific AI models, indicating a potential gap in addressing the challenges of operator dependency in AI-assisted classification."
    );
    assert(pseudoOperator.isPseudo, "isNonComparableOrPseudoDisagreement flags operator dependency vs AI accuracy as complementary context");

    const pseudoDataset = isNonComparableOrPseudoDisagreement(
      "While Magnuska et al. reported that their models achieved high sensitivity and specificity, Kim et al. noted that the performance of deep learning models is often limited by the size and quality of the training dataset, suggesting that not all AI-assisted methods may yield equally reliable results."
    );
    assert(pseudoDataset.isPseudo, "isNonComparableOrPseudoDisagreement flags dataset size constraint as complementary limitation");

    // 2. Integration test: CEUS/SWE clinical imaging vs CAD classification submitted as disagreement
    const modelOutputCeusVsCadDisagreement: MultiPaperSynthesisOutput = {
      claims: [],
      disagreements: [
        {
          description: "Li et al. reported that combining CEUS and SWE has limited effects on PPV, while Magnuska et al. found classification models achieved high accuracy, suggesting a discrepancy in the perceived effectiveness of different techniques.",
          evidence: [
            { paperId: breastPaper1.id, chunkIds: ["chunk-breast-results-01"] },
            { paperId: breastPaper2.id, chunkIds: ["chunk-breast-discussion-02"] },
          ],
        },
      ],
      limitations: [],
      insufficientEvidence: false,
    };

    const resultCeusCad = validateMultiPaperSynthesis(
      modelOutputCeusVsCadDisagreement,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(resultCeusCad.disagreements.length === 0, "Negative Control 4B.1: CEUS/SWE vs CAD classification rejected as disagreement");
    assert(resultCeusCad.limitations.length === 0, "Negative Control 4B.1: Pseudo-disagreement discarded completely rather than leaked into limitations");

    // 3. Integration test: Operator dependency vs CAD accuracy submitted as disagreement
    const modelOutputOperatorDisagreement: MultiPaperSynthesisOutput = {
      claims: [],
      disagreements: [
        {
          description: "The study by Li et al. suggests operator-dependent nature causes misdetection, while Magnuska et al. focused on specific AI models, indicating a potential gap in addressing operator dependency.",
          evidence: [
            { paperId: breastPaper1.id, chunkIds: ["chunk-breast-results-01"] },
            { paperId: breastPaper2.id, chunkIds: ["chunk-breast-discussion-02"] },
          ],
        },
      ],
      limitations: [],
      insufficientEvidence: false,
    };

    const resultOperator = validateMultiPaperSynthesis(
      modelOutputOperatorDisagreement,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(resultOperator.disagreements.length === 0, "Negative Control 4B.2: Operator dependency vs CAD rejected as disagreement");
    assert(resultOperator.limitations.length === 0, "Negative Control 4B.2: Pseudo-disagreement discarded completely rather than leaked into limitations");

    // =========================================================================================
    // TASK 4C REGRESSION TESTS: Prevention of Disagreement-to-Limitation Leakage & Fabricated Deskilling Claims
    // =========================================================================================
    console.log("\n--- Test Group 4C: Disagreement-to-Limitation Leakage & Radiologist Deskilling Fabrication ---");

    // 4C.1: Pseudo-disagreement containing fabricated claim about radiologists losing interpretative skills
    const modelOutputFabricatedSkillLossPseudo: MultiPaperSynthesisOutput = {
      claims: [],
      disagreements: [
        {
          description: "Zakareya et al. and Li et al. differ on whether CAD models replace or assist radiologists, with Zakareya et al. noting that excessive reliance on AI leads to lack of interpretative skills among radiologists, while Li et al. focuses on multimodal ultrasound.",
          evidence: [
            { paperId: breastPaper1.id, chunkIds: ["chunk-breast-results-01"] },
            { paperId: breastPaper2.id, chunkIds: ["chunk-breast-discussion-02"] },
          ],
        },
      ],
      limitations: [],
      insufficientEvidence: false,
    };
    const resultFab1 = validateMultiPaperSynthesis(
      modelOutputFabricatedSkillLossPseudo,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(resultFab1.disagreements.length === 0, "Negative Control 4C.1: Fabricated skill-loss disagreement rejected from disagreements");
    assert(resultFab1.limitations.length === 0, "Negative Control 4C.1: Fabricated skill-loss disagreement strictly discarded, NOT leaked into limitations");

    // 4C.2: Single-study disagreement containing fabricated claim about radiologists losing interpretative skills
    const modelOutputFabricatedSkillLossSingle: MultiPaperSynthesisOutput = {
      claims: [],
      disagreements: [
        {
          description: "Zakareya et al. argues that reliance on AI leads to lack of interpretative skills among radiologists.",
          evidence: [
            { paperId: breastPaper1.id, chunkIds: ["chunk-breast-results-01"] },
          ],
        },
      ],
      limitations: [],
      insufficientEvidence: false,
    };
    const resultFab2 = validateMultiPaperSynthesis(
      modelOutputFabricatedSkillLossSingle,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(resultFab2.disagreements.length === 0, "Negative Control 4C.2: Single-study deskilling claim rejected from disagreements");
    assert(resultFab2.limitations.length === 0, "Negative Control 4C.2: Single-study deskilling claim discarded, NOT converted to limitation");

    // 4C.3: Direct limitation asserting radiologist deskilling without chunk support
    const modelOutputFabricatedSkillLossLimitation: MultiPaperSynthesisOutput = {
      claims: [],
      disagreements: [],
      limitations: [
        {
          text: "Excessive reliance on AI causes radiologists to lose interpretative skills in breast ultrasound interpretation.",
          evidence: [
            { paperId: breastPaper1.id, chunkIds: ["chunk-breast-results-01"] },
          ],
        },
      ],
      insufficientEvidence: false,
    };
    const resultFab3 = validateMultiPaperSynthesis(
      modelOutputFabricatedSkillLossLimitation,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(resultFab3.limitations.length === 0, "Negative Control 4C.3: Fabricated skill-loss limitation strictly rejected and withheld");
    assert(resultFab3.rejectedCitationCount === 1, "Negative Control 4C.3: Rejected citation recorded for ungrounded deskilling limitation");

    // 4C.4: Positive Control: Legitimate limitation that IS retained when independently supported by cited passage
    const modelOutputLegitimateLimitation: MultiPaperSynthesisOutput = {
      claims: [],
      disagreements: [
        {
          description: "Combining CEUS and SWE technologies may increase examination costs for patients.",
          evidence: [
            { paperId: breastPaper2.id, chunkIds: ["chunk-breast-cost-limitation"] },
          ],
        },
      ],
      limitations: [],
      insufficientEvidence: false,
    };
    const resultLegit = validateMultiPaperSynthesis(
      modelOutputLegitimateLimitation,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(resultLegit.disagreements.length === 0, "Positive Control 4C.4: Single-study observation rejected as cross-study disagreement");
    assert(resultLegit.limitations.length === 1, "Positive Control 4C.4: Grounded single-study limitation retained when independently supported by cited passage");
    assert(resultLegit.limitations[0].citations[0].paperId === breastPaper2.id, "Positive Control 4C.4: Grounded in breastPaper2");

    // =========================================================================================
    // NEGATIVE CONTROL 5: Correct Citation Identifiers Attached to Semantically Irrelevant Passages
    // =========================================================================================
    console.log("\n--- Test Group 5: Negative Control — Correct Identifiers Attached to Irrelevant Passages ---");

    // Claim asserts surface code quantum threshold, but supplies valid chunk ID from a breast paper
    const modelOutputCrossDomainClaim: MultiPaperSynthesisOutput = {
      claims: [
        {
          text: "Surface codes provide fault-tolerant quantum error correction with a threshold of approximately 1%.",
          evidence: [
            {
              paperId: breastPaper1.id, // Valid ID, but breast paper!
              chunkIds: ["chunk-breast-results-01"],
            },
          ],
        },
      ],
      disagreements: [],
      limitations: [],
      insufficientEvidence: false,
    };

    // Quantum question with breast paper evidence:
    const resultCrossDomain = validateMultiPaperSynthesis(
      modelOutputCrossDomainClaim,
      allTestEvidenceSets,
      "What does the available literature say about fault-tolerant quantum computing?"
    );
    assert(resultCrossDomain.claims.length === 0, "Negative Control 5: Claim with valid chunk ID but irrelevant cross-domain paper dropped");
    assert(resultCrossDomain.rejectedCitationCount === 1, "Negative Control 5: Rejected citation recorded for irrelevant cross-domain paper");
    assert(
      isDomainMismatched(
        "Surface codes provide fault-tolerant quantum error correction",
        "Influence of the Computer-Aided Decision Support System Design on Ultrasound-Based Breast Cancer Classification",
        "Methods",
        "3.4. Breast Lesion Classification",
        "What does the available literature say about fault-tolerant quantum computing?"
      ),
      "Negative Control 5: isDomainMismatched correctly detects quantum query vs breast paper mismatch"
    );

    // Negative Control 5B: Semantic claim inversion check (isClaimSupportedByChunk)
    const isSupportedCheckFalse = isClaimSupportedByChunk(
      "Combining conventional ultrasound with CEUS and SWE significantly improves diagnostic accuracy and positive predictive value for breast lesions.",
      "Additionally, combining CEUS and SWE technologies has limited effect on reducing the positive predictive value (PPV), and it will increase the examination costs for patients."
    );
    assert(!isSupportedCheckFalse, "Negative Control 5B: isClaimSupportedByChunk rejects claim asserting improvement when passage states 'limited effect'");

    const isSupportedCheckTrue = isClaimSupportedByChunk(
      "The FC-CNN architecture outperformed traditional CNN with B-mode only for most models.",
      "The experimental results showed that the FC-CNN architecture using multiple time-domain feature maps outperformed the traditional CNN with B-mode only for most of the CNN models."
    );
    assert(isSupportedCheckTrue, "Positive Control 5B: isClaimSupportedByChunk accepts claim when passage directly supports improvement");

    // Negative Control 5C: Operator dependency text used to claim diagnostic accuracy improvement
    const isOperatorSupportedFalse = isClaimSupportedByChunk(
      "The proposed technique achieves superior diagnostic accuracy in breast cancer detection.",
      "In this article, we cite the relevant content from this literature: The breast cancer diagnosis technique is operator-dependent and demands the skills of a veteran diagnostician. Nevertheless, many influences such as fatigue and a lack of attentiveness can be a source of misdetection, leading to low accuracy."
    );
    assert(!isOperatorSupportedFalse, "Negative Control 5C: isClaimSupportedByChunk rejects operator fatigue passage used to claim superior accuracy");

    // =========================================================================================
    // RETRIEVAL PIPELINE TEST: Zero Reference Chunks & Empirical Prioritization
    // =========================================================================================
    console.log("\n--- Test Group 6: Retrieval Layer Pipeline Verification ---");

    const discovery = await discoverRelevantPapers(
      "What does the available literature say about AI-assisted breast ultrasound classification?",
      { maxSelected: 4 }
    );

    assert(discovery.selectedPapers.length >= 2, "Discovery returned top relevant papers");
    for (const p of discovery.selectedPapers) {
      assert(
        !/reference|bibliography/i.test(p.bestChunkSection || ""),
        `Selected paper ${p.paperId} bestChunkSection is NOT a reference (§${p.bestChunkSection})`
      );
    }

    const evidence = await retrieveMultiPaperEvidence(
      discovery.selectedPapers,
      "What does the available literature say about AI-assisted breast ultrasound classification?",
      {
        queryVector: discovery.queryVector,
        chunksPerPaper: 4,
        maxTotalChunks: 16,
      }
    );

    assert(evidence.totalChunks > 0, "Retrieved non-zero evidence chunks");
    let foundReferenceChunk = false;
    for (const chunk of evidence.allChunks) {
      if (isReferenceChunk(chunk.section, chunk.text)) {
        foundReferenceChunk = true;
        console.error(`Found reference chunk in retrieval: ${chunk.id} §${chunk.section}`);
      }
    }
    assert(!foundReferenceChunk, "Retrieved evidence sets contain ZERO reference or bibliography chunks");

    // Empirical chunks prioritized
    const empiricalCount = evidence.allChunks.filter((c) =>
      c.section && /result|discussion|method|conclusion|abstract/i.test(c.section)
    ).length;
    assert(empiricalCount >= Math.floor(evidence.totalChunks * 0.5), `Empirical chunks constitute majority of retrieved evidence (${empiricalCount}/${evidence.totalChunks})`);

    // =========================================================================================
    // TEST GROUP 7: PRODUCTION AUDIT 5-CASE GROUNDING TEST SUITE
    // =========================================================================================
    console.log("\n--- Test Group 7: Production Audit 5-Case Grounding Test Suite ---");

    // Case 1: Diagnostic accuracy claims supported by training time or general challenges
    console.log("  Testing Case 1: Diagnostic Accuracy Proposition Support...");
    const accClaim = "The proposed deep learning attention model achieved high diagnostic accuracy in classifying breast lesions.";
    const trainingChunkText = "The code was written in Python, and the experiments were performed on Kaggle, leveraging the power of their hardware, including GPUs. Batch size was 16 and models were trained for 50 epochs.";
    const operatorFatigueChunkText = "Breast cancer diagnosis technique is operator-dependent and causes physical fatigue and lack of attentiveness, which may lead to misdetection.";
    const validAccuracyChunkText = "The experimental results showed that the proposed architecture achieved an overall accuracy of 94.2% across normal, benign, and malignant classes.";

    assert(
      !isAccuracyPropositionSupported(accClaim, trainingChunkText),
      "Case 1A Negative: Rejects training hardware/epochs passage for diagnostic accuracy claim"
    );
    assert(
      !isAccuracyPropositionSupported(accClaim, operatorFatigueChunkText),
      "Case 1B Negative: Rejects operator fatigue passage for diagnostic accuracy claim"
    );
    assert(
      isAccuracyPropositionSupported(accClaim, validAccuracyChunkText),
      "Case 1C Positive: Accepts genuine classification performance metrics passage for accuracy claim"
    );

    // Case 2: Claims that AI reduces biopsies supported by clinical multimodal ultrasound (Li et al.)
    console.log("  Testing Case 2: AI Attribution to Clinical Studies...");
    const aiBiopsyClaim = "AI-assisted ultrasound systems reduce unnecessary biopsies in BI-RADS category 4 breast lesions.";
    const clinicalBiopsyClaim = "Multimodal ultrasound combining conventional US with SWE and CEUS improves diagnostic differentiation of BI-RADS 4 lesions.";
    const liTitle = breastPaper2.title;
    const liBiopsyChunk = "The use of US + CEUS + SWE is beneficial for further differentiating benign and malignant breast lesions according to the US BI-RADS 4, thereby reducing unnecessary biopsies or surgeries.";

    assert(
      isAiAttributionToClinicalStudy(aiBiopsyClaim, liTitle, liBiopsyChunk),
      "Case 2A Negative: Detects AI attribution error when AI claim cites clinical SWE/CEUS study"
    );
    assert(
      !isAiAttributionToClinicalStudy(clinicalBiopsyClaim, liTitle, liBiopsyChunk),
      "Case 2B Positive: Allows clinical multimodal claim to cite clinical SWE/CEUS study"
    );

    // Case 3: Cross-study corroboration with proposition-specific validation
    console.log("  Testing Case 3: Proposition-Specific Corroboration...");
    const cnnSpecificClaim = "Convolutional neural network architectures demonstrated high diagnostic accuracy in breast cancer classification.";
    const kimTitle = "Classification for Breast Ultrasound Using Convolutional Neural Network with Multiple Time-Domain Feature Maps";
    const kimCnnChunk = "The experimental results showed that the FC-CNN architecture using multiple time-domain feature maps outperformed the traditional CNN with B-mode only for most of the CNN models.";
    const magnuskaTitle = breastPaper1.title;
    const magnuskaKnnChunk = "In particular, the best model for the Manual Segmentation dataset was trained with the Weighted KNN classifier. This model provided the best sensitivity and specificity.";

    assert(
      isTechnologySupportedByPaper(cnnSpecificClaim, kimTitle, kimCnnChunk),
      "Case 3A: Kim et al. CNN paper genuinely supports CNN classification proposition"
    );
    assert(
      !isTechnologySupportedByPaper(cnnSpecificClaim, magnuskaTitle, magnuskaKnnChunk),
      "Case 3B: Magnuska et al. KNN paper rejected for CNN-specific proposition"
    );

    // Integration check: Multi-paper synthesis output with Kim + Magnuska for CNN claim
    const modelOutputCnnCorroboration: MultiPaperSynthesisOutput = {
      claims: [
        {
          text: cnnSpecificClaim,
          evidence: [
            { paperId: breastPaper1.id, chunkIds: ["chunk-breast-results-01"] }, // Magnuska (KNN)
            { paperId: "paper-background-test", chunkIds: ["chunk-results-actual-02"] }, // Deep Learning (CNN)
          ],
        },
      ],
      disagreements: [],
      limitations: [],
      insufficientEvidence: false,
    };

    const resultCnnCorroboration = validateMultiPaperSynthesis(
      modelOutputCnnCorroboration,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(
      resultCnnCorroboration.claims.length === 1,
      "Case 3C: Claim preserved with valid deep learning citation"
    );
    assert(
      resultCnnCorroboration.claims[0].supportingPaperCount === 1,
      "Case 3D: Supporting paper count is strictly 1 (Magnuska KNN citation dropped from CNN claim)"
    );
    assert(
      resultCnnCorroboration.claims[0].supportingPaperIds[0] === "paper-background-test",
      "Case 3E: Only genuine deep learning paper counted as supporting"
    );

    // Case 4: Symmetrical limitation verification: Breast ultrasound limitations citing benign skin study
    console.log("  Testing Case 4: Symmetrical Limitation Verification...");
    const modelOutputSkinLimitation: MultiPaperSynthesisOutput = {
      claims: [
        {
          text: "Computer-aided decision support systems achieve high accuracy in breast lesion classification.",
          evidence: [{ paperId: breastPaper1.id, chunkIds: ["chunk-breast-results-01"] }],
        },
      ],
      disagreements: [],
      limitations: [
        {
          text: "The study collective consisted exclusively of benign skin lesions such as epidermal cysts and pilomatricoma.",
          evidence: [{ paperId: skinTumorPaper.id, chunkIds: ["chunk-skin-results-02"] }],
        },
      ],
      insufficientEvidence: false,
    };

    const resultSkinLimitation = validateMultiPaperSynthesis(
      modelOutputSkinLimitation,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(
      resultSkinLimitation.limitations.length === 0,
      "Case 4A Negative: Skin-tumor limitation strictly rejected and withheld in breast ultrasound synthesis"
    );
    assert(
      resultSkinLimitation.rejectedCitationCount === 1,
      "Case 4B Negative: Skin-tumor citation recorded as rejected under limitations"
    );

    // Negative 4C: Limitation asserting unsupervised algorithm improvements cited against IRB ethics chunk
    const modelOutputEthicsLimitation: MultiPaperSynthesisOutput = {
      claims: [
        {
          text: "Computer-aided decision support systems achieve high accuracy in breast lesion classification.",
          evidence: [{ paperId: breastPaper1.id, chunkIds: ["chunk-breast-results-01"] }],
        },
      ],
      disagreements: [],
      limitations: [
        {
          text: "Magnuska et al. noted that the performance of their model could be improved by using unsupervised classification algorithms.",
          evidence: [{ paperId: breastPaper2.id, chunkIds: ["chunk-breast-discussion-02"] }],
        },
      ],
      insufficientEvidence: false,
    };

    const resultEthicsLimitation = validateMultiPaperSynthesis(
      modelOutputEthicsLimitation,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(
      resultEthicsLimitation.limitations.length === 0,
      "Case 4C Negative: Hallucinated unsupervised algorithm limitation withheld when not supported by chunk"
    );

    // Positive 4D: Valid limitation supported by chunk
    const modelOutputValidLimitation: MultiPaperSynthesisOutput = {
      claims: [
        {
          text: "Computer-aided decision support systems achieve high accuracy in breast lesion classification.",
          evidence: [{ paperId: breastPaper1.id, chunkIds: ["chunk-breast-results-01"] }],
        },
      ],
      disagreements: [],
      limitations: [
        {
          text: "Combining CEUS and SWE technologies may increase examination costs for patients.",
          evidence: [{ paperId: breastPaper2.id, chunkIds: ["chunk-breast-cost-limitation"] }],
        },
      ],
      insufficientEvidence: false,
    };

    const resultValidLimitation = validateMultiPaperSynthesis(
      modelOutputValidLimitation,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(
      resultValidLimitation.limitations.length === 1,
      "Case 4D Positive: Valid grounded cost limitation accepted and hydrated"
    );
    assert(
      resultValidLimitation.limitations[0].citations[0].paperId === breastPaper2.id,
      "Case 4D Positive: Grounded in Li et al. (breastPaper2)"
    );

    // Negative 4E: Clinical imaging limitation incorrectly attributed to AI-assisted classification
    const modelOutputClinicalLimitationAttributedToAi: MultiPaperSynthesisOutput = {
      claims: [
        {
          text: "Computer-aided decision support systems achieve high accuracy in breast lesion classification.",
          evidence: [{ paperId: breastPaper1.id, chunkIds: ["chunk-breast-results-01"] }],
        },
      ],
      disagreements: [],
      limitations: [
        {
          text: "AI-assisted classification systems increase examination costs for patients when combining CEUS and SWE imaging.",
          evidence: [{ paperId: breastPaper2.id, chunkIds: ["chunk-breast-cost-limitation"] }],
        },
      ],
      insufficientEvidence: false,
    };

    const resultAiLimitation = validateMultiPaperSynthesis(
      modelOutputClinicalLimitationAttributedToAi,
      allTestEvidenceSets,
      "What does the available literature say about AI-assisted breast ultrasound classification?"
    );
    assert(
      resultAiLimitation.limitations.length === 0,
      "Case 4E Negative: Clinical imaging cost limitation incorrectly attributed to AI classification is rejected"
    );
    assert(
      resultAiLimitation.rejectedCitationCount === 1,
      "Case 4E Negative: Rejected citation recorded for AI attribution error in limitations"
    );

    // Case 5: Hypothetical potential vs measured study outcome
    console.log("  Testing Case 5: Hypothetical Potential vs Measured Study Outcomes...");
    const measuredBiopsyOutcomeClaim = "AI models empirically reduced unnecessary biopsies by 30% in clinical practice.";
    const potentialBiopsyBenefitClaim = "Multimodal ultrasound has the potential to reduce unnecessary biopsies by improving diagnostic differentiation.";
    const prospectivePassage = "The use of US + CEUS + SWE is beneficial for further differentiating benign and malignant breast lesions according to the US BI-RADS 4, thereby reducing unnecessary biopsies or surgeries.";

    assert(
      isHypotheticalBenefitTreatedAsEmpiricalResult(measuredBiopsyOutcomeClaim, prospectivePassage),
      "Case 5A Negative: Rejects claim asserting measured empirical biopsy reduction without trial data"
    );
    assert(
      !isHypotheticalBenefitTreatedAsEmpiricalResult(potentialBiopsyBenefitClaim, prospectivePassage),
      "Case 5B Positive: Allows properly qualified claim expressing potential clinical benefit"
    );

    // =========================================================================================
    // TEST GROUP 8: TARGETED EVIDENCE CORRECTIONS ACCEPTANCE SUITE
    // =========================================================================================
    console.log("\n--- Test Group 8: Targeted Evidence Corrections Acceptance Suite ---");

    // Acceptance Case 8.1: Correct Accuracy Metric Paired with Unsupported Comparison
    console.log("  Testing Case 8.1: Comparative Claim Integrity (Metric vs Superiority)...");
    
    // Chunk p.16: internal DNN models only (R3_R3_R3 achieved 93% accuracy on Cairo University dataset)
    const zakareyaInternalChunk = "Table 3 shows the performance of the proposed architecture on Cairo University ultrasound dataset. The proposed deep neural network R3_R3_R3 achieved 93% accuracy, outperforming the R5_R5_R5 (89%) and R3_R5_R35 (91%) configurations.";
    // Chunk p.18: benchmark CNN architectures (AlexNet, GoogLeNet, ResNet50, VGG16) on Cairo University dataset
    const zakareyaCnnBenchmarkChunk = "Table 4 compares the proposed model with existing deep architectures on the Cairo University ultrasound dataset. The proposed model (93% accuracy) outperformed AlexNet (86.5%), GoogLeNet (88.2%), and ResNet50 (89.1%).";
    // Chunk p.19: Table 5 comparison with prior literature on breast histopathology (BreakHis dataset)
    const zakareyaHistopathologyChunk = "Table 5. Comparison with state-of-the-art methods on breast histopathology images (BreakHis dataset). The proposed method achieved 95% accuracy compared to Spanhol et al. (84%) and Bayramoglu et al. (87%).";

    // 8.1A: Single metric + unsupported comparative superiority in internal chunk (fails comparative superiority check)
    const unsupportedComparativeClaim = "The proposed deep learning architecture achieved 93% accuracy on the Cairo University ultrasound dataset, outperforming existing breast cancer methods.";
    assert(
      !isComparativeSuperioritySupported(unsupportedComparativeClaim, zakareyaInternalChunk),
      "Case 8.1A Negative: Rejects external comparative superiority claim when passage only compares internal configurations"
    );

    // 8.1B: Supported comparative claim when passage contains benchmark comparison architectures
    assert(
      isComparativeSuperioritySupported("The proposed model outperformed benchmark CNN architectures on the Cairo University dataset.", zakareyaCnnBenchmarkChunk),
      "Case 8.1B Positive: Accepts comparative claim when benchmark models are explicitly in the passage"
    );

    // 8.1C: Mismatched modality: ultrasound comparative claim citing histopathology benchmark chunk
    assert(
      !isComparativeSuperioritySupported("The proposed model outperformed existing methods on ultrasound images.", zakareyaHistopathologyChunk),
      "Case 8.1C Negative: Rejects ultrasound comparative claim citing histopathology image benchmark chunk"
    );

    // 8.1D: splitOrPruneCompoundClaim automatically prunes unsupported trailing comparative clause while preserving base metric
    const prunedClaim = splitOrPruneCompoundClaim(unsupportedComparativeClaim, zakareyaInternalChunk);
    assert(
      prunedClaim === "The proposed deep learning architecture achieved 93% accuracy on the Cairo University ultrasound dataset.",
      "Case 8.1D Positive: splitOrPruneCompoundClaim prunes unsupported comparative clause, preserving verified empirical metric"
    );

    // Acceptance Case 8.2: Unsupported Universal Superiority Where Only Some Models Improved
    console.log("  Testing Case 8.2: Preserve Important Empirical Qualifications (Universal vs Most)...");
    const kimPassage = "The experimental results showed that the FC-CNN architecture using multiple time-domain feature maps outperformed the traditional CNN with B-mode only for most of the CNN models.";
    const universalKimClaim = "The FC-CNN architecture using multiple time-domain feature maps outperformed traditional B-mode-only CNN models.";
    const qualifiedKimClaim = "The FC-CNN architecture using multiple time-domain feature maps outperformed traditional B-mode-only CNN models for most evaluated architectures.";

    assert(
      hasUnqualifiedUniversalAssertion(universalKimClaim, kimPassage),
      "Case 8.2A Negative: Detects unqualified universal superiority when empirical passage qualifies 'for most of the CNN models'"
    );
    assert(
      !hasUnqualifiedUniversalAssertion(qualifiedKimClaim, kimPassage),
      "Case 8.2B Positive: Passes when claim preserves 'for most' qualification"
    );

    const autoQualified = qualifyUniversalClaimIfNeeded(universalKimClaim, kimPassage);
    assert(
      autoQualified.includes("for most evaluated architectures"),
      "Case 8.2C Positive: qualifyUniversalClaimIfNeeded automatically inserts 'for most evaluated architectures'"
    );

    // Acceptance Case 8.3: Limitation Incorrectly Inferred from a Mitigation Strategy
    console.log("  Testing Case 8.3: Limitation vs Mitigation Strategy (Overfitting Augmentation)...");
    const augmentationMitigationPassage = "Data augmentation prevents overfitting by artificially generating diverse training samples through random rotations, horizontal flips, and scaling.";
    const overfittingLimitationClaim = "A major limitation of the study is overfitting during neural network training.";
    const validSampleLimitationPassage = "A key limitation of this study is the relatively small sample size of 150 ultrasound images and the single-center patient cohort.";
    const validSampleLimitationClaim = "The study is limited by a small sample size and single-center cohort.";

    assert(
      !isLimitationSupportedByChunk(overfittingLimitationClaim, augmentationMitigationPassage),
      "Case 8.3A Negative: Rejects data augmentation preventing overfitting from being inferred as an unresolved overfitting limitation"
    );
    assert(
      isLimitationSupportedByChunk(validSampleLimitationClaim, validSampleLimitationPassage),
      "Case 8.3B Positive: Accepts genuine study limitation on sample size and single-center cohort"
    );

    // Acceptance Case 8.4: Technology Misattribution in Limitations
    console.log("  Testing Case 8.4: Technology Misattribution in Limitations (Classical ML vs Deep Learning)...");
    const magnuskaLimitationPassage = "The use of classical machine learning and handcrafted features, such as weighted KNN classification, represents a limitation compared to end-to-end representation learning.";
    const deepLearningMisattributedLimitation = "A significant limitation of deep learning models in breast ultrasound is the reliance on handcrafted feature extraction.";
    const correctClassicalMlLimitation = "The classical machine learning approach was limited by its reliance on handcrafted feature extraction and KNN classification.";

    assert(
      !isTechnologySupportedByPaper(deepLearningMisattributedLimitation, "Influence of the Computer-Aided Decision Support System Design on Ultrasound-Based Breast Cancer Classification", magnuskaLimitationPassage),
      "Case 8.4A Negative: Rejects limitation framing classical ML / KNN handcrafted features as a limitation of deep learning"
    );
    assert(
      isTechnologySupportedByPaper(correctClassicalMlLimitation, "Influence of the Computer-Aided Decision Support System Design on Ultrasound-Based Breast Cancer Classification", magnuskaLimitationPassage),
      "Case 8.4B Positive: Accepts limitation correctly attributing handcrafted features to classical machine learning / KNN"
    );

    // Acceptance Case 8.5: Clinical Findings Generalized Beyond Their Studied Subgroup
    console.log("  Testing Case 8.5: Clinical Findings Generalized Beyond Studied Subgroup (BI-RADS 3 Context)...");
    const liCostPassage = "Additionally, combining CEUS and SWE technologies has limited effect on reducing the positive predictive value (PPV) in BI-RADS 3 lesions where malignancy rate is under 2%, and it will increase the examination costs for patients.";
    const generalizedCostLimitation = "Combining CEUS and SWE technologies increases costs and has limited effect on positive predictive value in breast lesion evaluation.";
    const subgroupSpecificCostLimitation = "Combining CEUS and SWE technologies increases examination costs while offering limited PPV improvement specifically for BI-RADS 3 lesions.";

    assert(
      !isLimitationSupportedByChunk(generalizedCostLimitation, liCostPassage),
      "Case 8.5A Negative: Rejects cost and PPV limitation generalized across all breast lesions without specifying BI-RADS 3"
    );
    assert(
      isLimitationSupportedByChunk(subgroupSpecificCostLimitation, liCostPassage),
      "Case 8.5B Positive: Accepts cost and PPV limitation explicitly restricted to BI-RADS 3 subgroup context"
    );

    // Case 8.5C: Negative result / category upgrade proposition
    const upgradeClaim = "Li et al. found that combining CEUS and SWE technologies can lead to an upgraded BI-RADS category for breast lesions, indicating a higher likelihood of malignancy.";
    assert(
      !isClaimSupportedByChunk(upgradeClaim, liCostPassage),
      "Case 8.5C Negative: Rejects claim asserting upgraded category when passage states limited effect on PPV"
    );

    console.log("\n================================================================================");
    console.log(`PHASE 11.2 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("================================================================================\n");

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error("Test execution error:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runPhase11_2Tests();
