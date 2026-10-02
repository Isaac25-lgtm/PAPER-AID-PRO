import "../scratch/load-env";
import { prisma } from "../src/lib/prisma";
import {
  validateMultiPaperSynthesis,
  isDomainMismatched,
  isBackgroundLiteratureReview,
  isNonComparableOrPseudoDisagreement,
  isClaimSupportedByChunk,
  isThirdPartyLiteratureChunk,
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
    const breastPaper1 = await prisma.paper.findFirst({
      where: { title: { contains: "Ultrasound-Based Breast Cancer Classification", mode: "insensitive" } },
      include: { chunks: { take: 5, orderBy: { chunkIndex: "asc" } } },
    });

    const breastPaper2 = await prisma.paper.findFirst({
      where: { title: { contains: "BI-RADS category 4", mode: "insensitive" } },
      include: { chunks: { take: 5, orderBy: { chunkIndex: "asc" } } },
    });

    const skinTumorPaper = await prisma.paper.findFirst({
      where: { title: { contains: "Benign Skin Tumors", mode: "insensitive" } },
      include: { chunks: { take: 5, orderBy: { chunkIndex: "asc" } } },
    });

    if (!breastPaper1 || !breastPaper2 || !skinTumorPaper) {
      throw new Error("Required test papers (Breast Paper 1, Breast Paper 2, Skin Tumor Paper) not found in DB.");
    }

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

    // Direct unit test of isBackgroundLiteratureReview
    const isBackgroundReviewDirect = isBackgroundLiteratureReview(
      "Deep learning models effectively classify breast cancer ultrasound images into benign or malignant categories achieving high accuracy.",
      "Background",
      "In the study presented in [17], various deep-learning models were employed to classify breast cancer ultrasound images based on their benign, malignant, or normal status."
    );
    assert(isBackgroundReviewDirect, "isBackgroundLiteratureReview detects third-party literature citation [17] in Background");

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
    assert(resultF5A.limitations.length === 1, "Failure 5A: Single-paper variation downgraded to limitations observation");
    assert(resultF5A.limitations[0].text.startsWith("Single-study observation:"), "Failure 5A: Limitation tagged as single-study observation");

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
    assert(resultCeusCad.limitations.length === 1, "Negative Control 4B.1: Preserved as methodological/modality distinction in limitations");
    assert(resultCeusCad.limitations[0].text.includes("Methodological & modality distinction"), "Negative Control 4B.1: Tagged with modality distinction prefix");

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
    assert(resultOperator.limitations.length === 1, "Negative Control 4B.2: Preserved as study constraint & context in limitations");

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
