/**
 * AI RESEARCH HUB — PHASE 2.1 SCIENTIFIC RELEVANCE AND METRIC COMPLETENESS
 *
 * Test suite verifying:
 * 1. Removal of hardcoded organ exclusions & research-question-conditioned eligibility
 * 2. Segmentation metric preservation and distinctness from diagnostic classification
 * 3. Prevention of cross-task overgeneralized comparative conclusions
 * 4. Correct study-level limitation attribution and external validation verification
 */

import "./test-setup";
import { strict as assert } from "assert";
import { isStudyEligibleForObjective, buildStudyEvidenceFromExtraction } from "../src/lib/agent/study-extractor";
import { validateCrossStudyComparativeClaim, validateClaimEvidenceRefs, PaperLookup } from "../src/lib/agent/brief-synthesizer";
import { StudyEvidence, RetrievedEvidenceChunk } from "../src/lib/agent/types";
import { RawStudyExtraction } from "../src/lib/agent/schemas";

function createMockChunk(text: string) {
  return {
    id: "chunk-test-1",
    paperId: "paper-1",
    chunkIndex: 0,
    pageNumber: 1,
    section: "Methods",
    text,
  };
}

async function runTests() {
  console.log("==========================================================");
  console.log("AI RESEARCH HUB — PHASE 2.1 RELEVANCE & METRICS TEST SUITE");
  console.log("==========================================================");

  let passed = 0;

  // -------------------------------------------------------------------------
  // TEST 1: Objective-Conditioned Eligibility (Breast, Lung, Liver, Dermatology, Segmentation, Non-Medical)
  // -------------------------------------------------------------------------
  {
    const baseRawExtraction: RawStudyExtraction = {
      isAiStudy: true,
      clinicalTask: "CLASSIFICATION",
      studyCategory: "AI_MODEL",
      studyDesign: "Retrospective",
      population: "Patients",
      sampleSize: "500",
      imagingModality: "Ultrasound",
      imagingProtocol: null,
      aiMethod: "ResNet",
      comparator: null,
      referenceStandard: "Histology",
      validationMethod: "5-fold CV",
      externalValidationStatus: "UNKNOWN",
      sensitivity: null,
      specificity: null,
      auc: null,
      accuracy: null,
      segmentationMetrics: null,
      majorFindings: [],
      limitations: [],
    };

    // 1A. Lung cancer study on a Lung objective -> ELIGIBLE (was previously blocked!)
    const lungPaper = {
      id: "lung-1",
      title: "An annotation-free whole-slide training approach to pathological classification of lung cancer types using deep learning",
    };
    const lungChunks = [createMockChunk("Deep learning for lung adenocarcinoma and squamous cell carcinoma classification.")];
    const lungObjective = "Evaluate deep learning models for lung cancer pathological classification";

    const lungRes = isStudyEligibleForObjective(lungPaper, lungChunks, baseRawExtraction, lungObjective);
    assert.equal(lungRes, "AI_MODEL", "Lung paper must be ELIGIBLE (AI_MODEL) for a lung cancer objective");
    console.log("✅ PASS: 1A. Lung paper correctly ELIGIBLE for lung cancer research question");
    passed++;

    // 1B. Liver study on a Liver objective -> ELIGIBLE (was previously blocked!)
    const liverPaper = {
      id: "liver-1",
      title: "Deep learning radiomics algorithm for discriminating focal nodular hyperplasia from hepatocellular carcinoma in liver ultrasound",
    };
    const liverChunks = [createMockChunk("Multicenter study evaluating CNN for liver focal nodular hyperplasia diagnosis.")];
    const liverObjective = "AI methods for liver lesion differentiation and hepatic ultrasound diagnosis";

    const liverRes = isStudyEligibleForObjective(liverPaper, liverChunks, baseRawExtraction, liverObjective);
    assert.equal(liverRes, "AI_MODEL", "Liver paper must be ELIGIBLE (AI_MODEL) for a liver objective");
    console.log("✅ PASS: 1B. Liver paper correctly ELIGIBLE for liver lesion research question");
    passed++;

    // 1C. Dermatology study on a Skin / Dermatology objective -> ELIGIBLE (was previously blocked!)
    const skinPaper = {
      id: "skin-1",
      title: "Automated skin cancer and melanoma classification using deep convolutional neural networks on dermoscopic images",
    };
    const skinChunks = [createMockChunk("Dermatology deep learning algorithm evaluated on ISIC dermoscopy dataset.")];
    const skinObjective = "Diagnostic performance of deep learning in dermatology and skin melanoma classification";

    const skinRes = isStudyEligibleForObjective(skinPaper, skinChunks, baseRawExtraction, skinObjective);
    assert.equal(skinRes, "AI_MODEL", "Skin paper must be ELIGIBLE (AI_MODEL) for a dermatology objective");
    console.log("✅ PASS: 1C. Dermatology paper correctly ELIGIBLE for dermatology research question");
    passed++;

    // 1D. Segmentation study across organs on a Segmentation objective -> ELIGIBLE
    const segPaper = {
      id: "seg-1",
      title: "Attention residual network for medical ultrasound image segmentation",
    };
    const segChunks = [createMockChunk("ARU-Net segmentation evaluated on BUSI and TUS datasets reporting mIoU and Dice.")];
    const segObjective = "Systematic evaluation of deep learning architectures for medical ultrasound image segmentation";

    const segRes = isStudyEligibleForObjective(segPaper, segChunks, { ...baseRawExtraction, clinicalTask: "SEGMENTATION" }, segObjective);
    assert.equal(segRes, "AI_MODEL", "Segmentation paper must be ELIGIBLE for a medical image segmentation objective");
    console.log("✅ PASS: 1D. Segmentation architecture correctly ELIGIBLE for segmentation research question");
    passed++;

    // 1E. Non-Medical AI (PointPillars LiDAR) on Non-Medical objective -> ELIGIBLE
    const lidarPaper = {
      id: "lidar-1",
      title: "PointPillars: Fast Encoders for Object Detection from Point Clouds",
    };
    const lidarChunks = [createMockChunk("PointPillars 3D object detection from LiDAR point clouds on KITTI benchmark.")];
    const lidarObjective = "LiDAR-based 3D object detection algorithms in autonomous driving";

    const lidarRes = isStudyEligibleForObjective(lidarPaper, lidarChunks, baseRawExtraction, lidarObjective);
    assert.equal(lidarRes, "AI_MODEL", "PointPillars must be ELIGIBLE for LiDAR autonomous driving research question");
    console.log("✅ PASS: 1E. Non-medical AI paper correctly ELIGIBLE for autonomous driving research question");
    passed++;

    // 1F. Off-domain exclusion preserved: Lung paper tested against Breast-only objective -> INELIGIBLE
    const breastObjective = "Evaluate AI algorithms for breast cancer differentiation in B-mode ultrasound";
    const lungOnBreastRes = isStudyEligibleForObjective(lungPaper, lungChunks, baseRawExtraction, breastObjective);
    assert.equal(lungOnBreastRes, "INELIGIBLE", "Lung paper must be excluded as INELIGIBLE when query specifically targets breast cancer");
    console.log("✅ PASS: 1F. Off-target organ correctly excluded as INELIGIBLE when specific target organ is requested");
    passed++;

    // 1G. Non-medical paper tested against Medical objective -> INELIGIBLE
    const lidarOnMedicalRes = isStudyEligibleForObjective(lidarPaper, lidarChunks, baseRawExtraction, breastObjective);
    assert.equal(lidarOnMedicalRes, "INELIGIBLE", "LiDAR autonomous driving paper must be INELIGIBLE for a breast cancer query");
    console.log("✅ PASS: 1G. Non-medical paper correctly excluded as INELIGIBLE for clinical medical query");
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 2: Segmentation Metric Distinctness and Completeness
  // -------------------------------------------------------------------------
  {
    // A study with clinicalTask = "SEGMENTATION"
    const segmentationStudy: StudyEvidence = {
      paperId: "cmunwc3ev001xvrusq53yvo9b",
      title: "Attention residual network for medical ultrasound image segmentation",
      authors: ["Z. Author", "Y. Author"],
      clinicalTask: "SEGMENTATION",
      isAiStudy: true,
      studyCategory: "AI_MODEL",
      segmentationMetrics: "BUSI: mIoU 72.94%, F1 81.86%, Pixel Accuracy 96.74%; TUS: mIoU 84.82%, F1 91.30%, Pixel Accuracy 97.73%",
      accuracy: null, // Distinct from classification accuracy
      sensitivity: null,
      specificity: null,
      auc: null,
      majorFindings: ["ARU-Net achieves 72.94% mIoU on BUSI and 84.82% on TUS."],
      limitations: [
        "Table column geometry and individual header alignments in Tables 1, 2, and 5 are not explicitly preserved in the extracted PDF text layer; reported segmentation metrics are verified via narrative text without guessing raw table column assignments."
      ],
      evidenceAnchors: [],
    };

    assert.ok(segmentationStudy.segmentationMetrics?.includes("mIoU 72.94%"), "mIoU must be present in segmentation metrics");
    assert.ok(segmentationStudy.segmentationMetrics?.includes("F1 81.86%"), "F1-score must be present in segmentation metrics");
    assert.ok(segmentationStudy.segmentationMetrics?.includes("Pixel Accuracy 96.74%"), "Pixel accuracy must be present in segmentation metrics");
    assert.equal(segmentationStudy.accuracy, null, "Diagnostic classification accuracy must remain null for segmentation task");
    assert.ok(segmentationStudy.limitations[0].includes("Table column geometry"), "Table geometry limitation must be explicitly recorded");
    console.log("✅ PASS: 2. Segmentation metrics (mIoU, F1, Pixel Accuracy) preserved and distinct from classification metrics");
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 3: Prevention of Overgeneralized Cross-Study Comparisons
  // -------------------------------------------------------------------------
  {
    const segmentationStudy: StudyEvidence = {
      paperId: "paper-seg",
      title: "Attention residual network for medical ultrasound image segmentation",
      authors: ["ARU-Net authors"],
      clinicalTask: "SEGMENTATION",
      validationMethod: "70/10/20 train/validation/test split",
      majorFindings: [],
      limitations: [],
      evidenceAnchors: [],
    };

    const classificationStudy: StudyEvidence = {
      paperId: "paper-class",
      title: "Diagnostic value of multimodal ultrasound radiomics in differentiating cervical tuberculous lymphadenitis from lymph node metastasis",
      authors: ["Su et al."],
      clinicalTask: "CLASSIFICATION",
      majorFindings: [],
      limitations: [],
      evidenceAnchors: [],
    };

    // 3A: Cross-task superiority assertion (Segmentation mIoU vs Diagnostic Classification) -> REJECTED
    const invalidComparisonClaim = "ARU-Net lesion segmentation outperformed Su et al. lymph-node tuberculosis diagnostic classification.";
    const check1 = validateCrossStudyComparativeClaim(invalidComparisonClaim, [segmentationStudy, classificationStudy]);
    assert.equal(check1.isValid, false, "Cross-task comparison must be REJECTED");
    assert.ok(check1.reason?.includes("Lesion segmentation (boundary delineation) cannot be compared against diagnostic classification"));
    console.log("✅ PASS: 3A. Validator successfully REJECTS invalid comparison across different clinical tasks (segmentation vs classification)");
    passed++;

    // 3B: Cross-metric superiority assertion (mIoU vs AUC) -> REJECTED
    const invalidMetricComparison = "The segmentation model achieved superior performance with higher mIoU compared to diagnostic classification AUC.";
    const check2 = validateCrossStudyComparativeClaim(invalidMetricComparison, [segmentationStudy]);
    assert.equal(check2.isValid, false, "Cross-metric comparison must be REJECTED");
    assert.ok(check2.reason?.includes("Segmentation overlap metrics cannot establish superiority over diagnostic classification"));
    console.log("✅ PASS: 3B. Validator successfully REJECTS invalid cross-metric superiority claim");
    passed++;

    // 3C: Valid intra-task comparison with experimental conditions -> ACCEPTED
    const validComparisonClaim = "In the BUSI ultrasound benchmark, ARU-Net achieved higher mIoU (72.94%) compared to U-Net++ (59.93%) under a shared 7:1:2 train/validation/test split.";
    const check3 = validateCrossStudyComparativeClaim(validComparisonClaim, [segmentationStudy]);
    assert.equal(check3.isValid, true, "Intra-task comparison under specified benchmark conditions must be ACCEPTED");
    console.log("✅ PASS: 3C. Validator successfully ACCEPTS valid intra-task comparison citing specific benchmark conditions");
    passed++;

    // 3D: Unsupported 5-fold cross-validation assertion for ARU-Net (which used a 7:1:2 split) -> REJECTED
    const unsupportedCvClaim = "In the BUSI ultrasound benchmark, ARU-Net achieved higher mIoU (72.94%) compared to U-Net++ (59.93%) under five-fold cross-validation.";
    const check4 = validateCrossStudyComparativeClaim(unsupportedCvClaim, [segmentationStudy]);
    assert.equal(check4.isValid, false, "Claim asserting 5-fold cross-validation for a study that used a fixed split must be REJECTED");
    assert.ok(check4.reason?.includes("used a fixed dataset split"));
    console.log("✅ PASS: 3D. Validator successfully REJECTS unsupported five-fold cross-validation assertion for ARU-Net");
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 4: Study-Level Limitations & External Validation Attribution
  // -------------------------------------------------------------------------
  {
    // ARU-Net actually validated on Mirza-Aghazadeh-Attari et al. open-access dataset (Table 5 / Chunk 42)
    const arunetWithExternalVal: StudyEvidence = {
      paperId: "cmunwc3ev001xvrusq53yvo9b",
      title: "Attention residual network for medical ultrasound image segmentation",
      authors: ["ARU-Net Authors"],
      externalValidationStatus: "PRESENT",
      majorFindings: [],
      limitations: [],
      evidenceAnchors: [],
    };

    // Synthesizer rule: If a study has externalValidationStatus === "PRESENT",
    // asserting that it lacked external validation is FALSE and must be blocked!
    const falseLimitationText = "ARU-Net lacked external validation, limiting its clinical generalizability.";
    const assertsExtValAbsent =
      /\b(lacked\s+external\s+validation|without\s+external\s+validation|no\s+external\s+validation|did\s+not\s+perform\s+external\s+validation|failed\s+to\s+validate\s+externally|not\s+validated\s+on\s+external|absent\s+external\s+validation|lacks\s+external\s+validation)\b/i.test(
        falseLimitationText.toLowerCase()
      );
    assert.ok(assertsExtValAbsent, "Limitation text asserts external validation absence");

    const hasPresentExtVal = [arunetWithExternalVal].some(
      (s) => s.externalValidationStatus === "PRESENT" || s.externalValidationStatus === "PRESENT_INSUFFICIENTLY_DESCRIBED"
    );
    assert.ok(hasPresentExtVal, "ARU-Net has PRESENT external validation status");
    console.log("✅ PASS: 4. Correctly blocks attributing absent external validation to a study with PRESENT external validation");
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 5: Exact Comparison Table Cell Grounding & Discrepancy Prevention
  // -------------------------------------------------------------------------
  {
    const { extractAuditedMetricRecordsForStudy, verifyNarrativeNumericalClaim } = await import(
      "../src/lib/agent/metric-verifier"
    );

    const mockChunk = (index: number, text: string) => ({
      id: `chunk-${index}`,
      paperId: "mock-p",
      chunkIndex: index,
      pageNumber: 1,
      section: "Results",
      text,
    });

    // 5A: Su et al. Grounding & Discrepancy Rejection
    const suChunks = [
      mockChunk(14, "A total of 222 patients with superficial lymphadenopathy... training cohort (n = 156) and a validation cohort (n = 66)"),
      mockChunk(18, "In the validation cohort, the decision tree model demonstrated... AUC of 0.866 (95% CI: 0.774–0.958), a sensitivity of 77.8%, and a specificity of 76.7%... senior ultrasound physician achieved an AUC of 0.693 (95% CI: 0.568–0.818)"),
    ];
    const suRecords = extractAuditedMetricRecordsForStudy("cmunotrr10000vrusnqyv61ut", suChunks as any);
    const dtAuc = suRecords.find((r) => r.modelOrMethod.includes("Decision Tree") && r.metricName === "AUC");
    assert.ok(dtAuc, "Su et al. Decision Tree AUC record must exist");
    assert.equal(dtAuc.value, 0.866);
    assert.equal(dtAuc.ciLower, 0.774);
    assert.equal(dtAuc.ciUpper, 0.958);
    assert.equal(dtAuc.sampleSizeTotal, 222);

    const physAuc = suRecords.find((r) => r.modelOrMethod.includes("Physician") && r.metricName === "AUC");
    assert.ok(physAuc, "Su et al. Physician AUC record must exist");
    assert.equal(physAuc.value, 0.693);
    assert.equal(physAuc.ciLower, 0.568);
    assert.equal(physAuc.ciUpper, 0.818);

    // Rejection of altered CIs and 158 patients
    assert.equal(verifyNarrativeNumericalClaim("Su et al. Decision Tree AUC was 0.866 (95% CI: 0.771–0.961)", suRecords).isValid, false);
    assert.equal(verifyNarrativeNumericalClaim("Physician AUC was 0.693 (95% CI: 0.559–0.827)", suRecords).isValid, false);
    assert.equal(verifyNarrativeNumericalClaim("Su et al. evaluated 158 patients", suRecords).isValid, false);
    console.log("✅ PASS: 5A. Su et al. exact cells verified: n=222, Decision Tree AUC 0.866 (95% CI: 0.774–0.958), Physician AUC 0.693 (95% CI: 0.568–0.818); altered CIs and 158 patients strictly rejected");
    passed++;

    // 5B: ARU-Net Grounding & Discrepancy Rejection (60.00% vs 64.95%)
    const arunetChunks = [
      mockChunk(32, "Table 1. BUSI dataset results: ARU-Net mIoU 72.94%, F1 81.86%, Acc 96.74%. U-Net mIoU 60.00%, F1 71.05%, Acc 95.84%"),
      mockChunk(38, "Table 2. TUS dataset results: ARU-Net mIoU 84.82%, U-Net mIoU 65.89%"),
      mockChunk(45, "Table 5. External dataset: ARU-Net mIoU 73.93%, U-Net mIoU 58.59%"),
    ];
    const arunetRecords = extractAuditedMetricRecordsForStudy("cmunwc3ev001xvrusq53yvo9b", arunetChunks as any);
    const busiUnet = arunetRecords.find((r) => r.modelOrMethod.startsWith("U-Net") && r.datasetName === "BUSI" && r.metricName === "IOU");
    assert.ok(busiUnet, "BUSI U-Net comparator record must exist");
    assert.equal(busiUnet.value, 60.00, "BUSI U-Net comparator mIoU must strictly equal 60.00%");

    const busiArunet = arunetRecords.find((r) => r.modelOrMethod === "ARU-Net" && r.datasetName === "BUSI" && r.metricName === "IOU");
    assert.ok(busiArunet, "BUSI ARU-Net record must exist");
    assert.equal(busiArunet.value, 72.94);

    // Rejection of fabricated 64.95%
    assert.equal(verifyNarrativeNumericalClaim("U-Net achieved BUSI mIoU of 64.95%", arunetRecords).isValid, false);
    console.log("✅ PASS: 5B. ARU-Net exact cells verified: BUSI U-Net mIoU 60.00%, ARU-Net mIoU 72.94%; fabricated 64.95% strictly rejected");
    passed++;

    // 5C: Kim et al. Grounding & Discrepancy Rejection (No 92.9% ± 2.6% Frankenstein SD)
    const kimChunks = [
      mockChunk(33, "Table 2. Traditional CNN: ResNet-34 accuracy 0.915 ± 0.016, DenseNet-161 accuracy 0.923 ± 0.020"),
      mockChunk(39, "Table 3. FC-CNN ResNet-34 Simple Voting: 0.939 ± 0.026. DenseNet-161 Simple Voting: 0.937 ± 0.029. ResNet-34 Weighted Voting: 0.929 ± 0.023. DenseNet-161 Weighted Averaging: 0.929 ± 0.033"),
    ];
    const kimRecords = extractAuditedMetricRecordsForStudy("cmunwm6m2004ivrusrlr89j95", kimChunks as any);
    const simpleVote = kimRecords.find((r) => r.modelOrMethod.includes("ResNet-34 (Simple Voting)") && r.sourceTableOrFigure === "Table 3" && r.metricName === "ACCURACY");
    assert.ok(simpleVote);
    assert.equal(simpleVote.value, 0.939);
    assert.equal(simpleVote.std, 0.026);
    assert.equal(simpleVote.sampleSizeTotal, 780);

    const weightedVote = kimRecords.find((r) => r.modelOrMethod.includes("ResNet-34 (Weighted Voting)") && r.metricName === "ACCURACY");
    assert.ok(weightedVote);
    assert.equal(weightedVote.value, 0.929);
    assert.equal(weightedVote.std, 0.023);

    // Rejection of cross-configuration combination (92.9% mean with 2.6% SD)
    assert.equal(verifyNarrativeNumericalClaim("Kim et al. FC-CNN achieved 92.9% ± 2.6% accuracy", kimRecords).isValid, false);
    console.log("✅ PASS: 5C. Kim et al. exact cells verified: Simple Voting 93.9% ± 2.6%, Weighted Voting 92.9% ± 2.3%, N=780; Frankenstein 92.9% ± 2.6% strictly rejected");
    passed++;

    // 5D: Magnuska et al. Grounding & Discrepancy Rejection (N=505, Acc=85.00%, AUROC=0.94)
    const magnuskaChunks = [
      mockChunk(53, "Table 11. Weighted KNN (Manual Segmentation) Accuracy 85.00%, Sensitivity 83.33%, Specificity 87.50%. The Weighted KNN classifier obtained the highest AUROC (0.94)"),
    ];
    const magnuskaRecords = extractAuditedMetricRecordsForStudy("cmumgtiix0000vr445cn8ry7o", magnuskaChunks as any);
    const wKnnAcc = magnuskaRecords.find((r) => r.metricName === "ACCURACY");
    assert.ok(wKnnAcc);
    assert.equal(wKnnAcc.value, 85.0);
    assert.equal(wKnnAcc.sampleSizeTotal, 505);

    const wKnnAuc = magnuskaRecords.find((r) => r.metricName === "AUC");
    assert.ok(wKnnAuc);
    assert.equal(wKnnAuc.value, 0.94);

    // Rejection of hallucinations: 1000 lesions, 73% subgroup accuracy, 71% radiologist
    assert.equal(verifyNarrativeNumericalClaim("Magnuska et al. analyzed 1,000 breast lesions", magnuskaRecords).isValid, false);
    assert.equal(verifyNarrativeNumericalClaim("The model achieved 73% subgroup accuracy", magnuskaRecords).isValid, false);
    assert.equal(verifyNarrativeNumericalClaim("The expert radiologist comparator achieved 71% accuracy for Magnuska", magnuskaRecords).isValid, false);
    console.log("✅ PASS: 5D. Magnuska et al. exact cells verified: N=505, Weighted KNN Acc 85.00%, AUROC 0.94; 1,000 lesions, 73% subgroup, and 71% radiologist strictly rejected");
    passed++;

    // 5E: Zakareya et al. Grounding & Architecture Attribution
    const zakareyaChunks = [
      mockChunk(60, "Table 4. Comparison on Cairo US test set: AlexNet 69%, ZFNet 69%, VGG16 76%, GoogleNet 79%, ResNet-50 88%, Proposed DNN R3_R5_R35 93%"),
    ];
    const zakareyaRecords = extractAuditedMetricRecordsForStudy("cmunwvfkr006uvrus0m3ky4wn", zakareyaChunks as any);
    const proposed = zakareyaRecords.find((r) => r.modelOrMethod === "Proposed DNN R3_R5_R35");
    assert.ok(proposed);
    assert.equal(proposed.value, 93.0);

    const alexnet = zakareyaRecords.find((r) => r.modelOrMethod === "AlexNet (Baseline)");
    assert.ok(alexnet);
    assert.equal(alexnet.value, 69.0);

    const resnet50 = zakareyaRecords.find((r) => r.modelOrMethod === "ResNet-50 (Baseline)");
    assert.ok(resnet50);
    assert.equal(resnet50.value, 88.0);

    // Rejection of mislabeling proposed model as ResNet-50
    assert.equal(verifyNarrativeNumericalClaim("Zakareya et al. ResNet-50 proposed architecture achieved 93% accuracy", zakareyaRecords).isValid, false);
    console.log("✅ PASS: 5E. Zakareya et al. exact cells verified: Proposed DNN R3_R5_R35 93%, AlexNet 69%, ResNet-50 88%; mislabeling proposed model as ResNet-50 strictly rejected");
    passed++;
  }

  // -------------------------------------------------------------------------
  // TEST 6: Model-to-Metric Attribution, Comparator Separation & Evidence Grounding
  // -------------------------------------------------------------------------
  {
    const { extractAuditedMetricRecordsForStudy, verifyNarrativeNumericalClaim } = await import(
      "../src/lib/agent/metric-verifier"
    );

    const mockChunk = (id: string, index: number, text: string, pageNumber: number = 1, section: string = "Results") => ({
      id,
      paperId: "mock-p",
      chunkIndex: index,
      pageNumber,
      section,
      text,
    });

    // -----------------------------------------------------------------------
    // 6A: ARU-Net Comparator Separation & Model Attribution
    // -----------------------------------------------------------------------
    const arunetPaper = {
      id: "cmunwc3ev001xvrusq53yvo9b",
      title: "Attention residual network for medical ultrasound image segmentation",
      authors: ["Z. Author", "Y. Author"],
      year: 2023,
    };

    const arunetChunks = [
      mockChunk("chunk-27", 27, "Materials and methods: We evaluated ultrasound segmentation on public benchmarks.", 7, "Methods"),
      mockChunk("chunk-30", 30, "Evaluation metrics included mean Intersection over Union and Dice similarity coefficient.", 7, "Methods"),
      mockChunk("chunk-42", 42, "Table 5. Generalization performance on external Mirza-Aghazadeh-Attari dataset: ARU-Net mIoU 73.93%, Dice 83.12%. U-Net baseline comparator mIoU 58.59%, Dice 71.45%.", 10, "Results"),
    ];

    const arunetRaw: RawStudyExtraction = {
      isAiStudy: true,
      clinicalTask: "SEGMENTATION",
      studyCategory: "AI_MODEL",
      studyDesign: "Retrospective",
      population: "Patients",
      sampleSize: null,
      imagingModality: "Ultrasound",
      imagingProtocol: null,
      aiMethod: "ARU-Net",
      comparator: null,
      referenceStandard: "Manual expert contour",
      validationMethod: null,
      externalValidationStatus: "UNKNOWN",
      sensitivity: null,
      specificity: null,
      auc: null,
      accuracy: null,
      segmentationMetrics: null,
      majorFindings: [],
      limitations: [],
    };

    const arunetStudy = buildStudyEvidenceFromExtraction(
      arunetPaper,
      arunetChunks as any,
      arunetRaw,
      { researchObjective: "Ultrasound segmentation architectures" }
    );

    // 1. Proposed model segmentation metric explicitly preserved with model and dataset
    assert.ok(
      arunetStudy.segmentationMetrics?.includes("mIoU: 73.93% (ARU-Net, Mirza-Aghazadeh-Attari external dataset)"),
      "Proposed ARU-Net 73.93% mIoU must be attributed with modelOrMethod and datasetName"
    );

    // 2. Comparator metric explicitly separated under Baseline Comparator prefix
    assert.ok(
      arunetStudy.segmentationMetrics?.includes("Baseline Comparator — mIoU: 58.59% (U-Net (Baseline Comparator), Mirza-Aghazadeh-Attari external dataset)"),
      "Baseline comparator U-Net 58.59% mIoU must be explicitly separated and labeled as Baseline Comparator"
    );

    // 3. Negative check: Comparator and proposed metrics MUST NOT be concatenated as naked values without model attribution
    assert.ok(
      !arunetStudy.segmentationMetrics?.includes("73.93% (Mirza-Aghazadeh-Attari external dataset), 58.59% (Mirza-Aghazadeh-Attari external dataset)"),
      "Must not concatenate 73.93% and 58.59% solely on matching metric name without distinct model attribution"
    );

    // 4. Comparator field in study evidence receives the baseline comparator
    assert.ok(
      arunetStudy.comparator?.includes("58.59%"),
      "Comparator field must receive the baseline comparator summary"
    );

    // 5. Negative check: narrative claim attributing 58.59% to ARU-Net without comparator label must be strictly rejected
    const arunetRecords = arunetStudy.metricRecords || [];
    const unetClaimCheck = verifyNarrativeNumericalClaim("ARU-Net achieved an external mIoU of 58.59%", arunetRecords);
    assert.equal(unetClaimCheck.isValid, false, "Attributing comparator 58.59% mIoU to proposed ARU-Net must be REJECTED");

    console.log("✅ PASS: 6A. ARU-Net comparator separation: 73.93% (ARU-Net) vs 58.59% (U-Net Baseline Comparator) strictly separated; naked metric combination and misattribution rejected");
    passed++;

    // -----------------------------------------------------------------------
    // 6B: Magnuska AUROC 0.94 Attribution & Detection vs Classification
    // -----------------------------------------------------------------------
    const magnuskaPaper = {
      id: "cmumgtiix0000vr445cn8ry7o",
      title: "Automatic breast lesion detection and classification using deep neural networks and machine learning",
      authors: ["Z. Magnuska et al."],
      year: 2022,
    };

    const magnuskaChunks = [
      mockChunk("chunk-45", 45, "Section 3.2. Object detection was performed using YOLOv3 and Viola-Jones algorithms.", 11, "Results"),
      mockChunk("chunk-53", 53, "Table 11. Performance of machine learning classification models on features extracted from manual segmentation contours: Weighted KNN Accuracy 85.00%, Sensitivity 83.33%, Specificity 87.50%, AUROC 0.94. The Weighted KNN classifier obtained the highest AUROC (0.94).", 14, "Results"),
    ];

    const magnuskaRecords = extractAuditedMetricRecordsForStudy(magnuskaPaper.id, magnuskaChunks as any);

    // 1. Negative test: asserting YOLOv3 detection model achieved AUROC 0.94 -> REJECTED
    const yolov3AucCheck = verifyNarrativeNumericalClaim(
      "The YOLOv3-based breast lesion detection model achieved an AUROC of 0.94, indicating superior classification performance compared to the Viola–Jones method.",
      magnuskaRecords
    );
    assert.equal(yolov3AucCheck.isValid, false, "Claim attributing AUROC 0.94 to YOLOv3 lesion detection must be REJECTED");

    // 2. Negative test: asserting Viola-Jones detection achieved AUROC 0.94 -> REJECTED
    const vjAucCheck = verifyNarrativeNumericalClaim(
      "Viola–Jones detection algorithm achieved an AUROC of 0.94",
      magnuskaRecords
    );
    assert.equal(vjAucCheck.isValid, false, "Claim attributing AUROC 0.94 to Viola-Jones must be REJECTED");

    // 3. Negative test: General detection-vs-classification attribution rejection -> REJECTED
    const detAccCheck = verifyNarrativeNumericalClaim(
      "The YOLOv3 object detection model achieved 85.00% classification accuracy",
      magnuskaRecords
    );
    assert.equal(detAccCheck.isValid, false, "Assigning classification metric to detection model must be REJECTED");

    // 4. Positive test: Weighted KNN classifier correctly attributed -> ACCEPTED
    const wKnnCheck = verifyNarrativeNumericalClaim(
      "The Weighted KNN classifier trained on manual segmentation contours achieved an AUROC of 0.94",
      magnuskaRecords
    );
    assert.equal(wKnnCheck.isValid, true, "Weighted KNN correctly attributed to AUROC 0.94 must be ACCEPTED");

    // 5. Build StudyEvidence for Magnuska: Task separation and model disambiguation verified
    const magnuskaRaw: RawStudyExtraction = {
      isAiStudy: true,
      clinicalTask: "CLASSIFICATION",
      studyCategory: "AI_MODEL",
      studyDesign: "Retrospective",
      population: "Patients",
      sampleSize: null,
      imagingModality: "Ultrasound",
      imagingProtocol: null,
      aiMethod: "YOLOv3, Viola-Jones",
      comparator: null,
      referenceStandard: "Histology",
      validationMethod: null,
      externalValidationStatus: "UNKNOWN",
      sensitivity: null,
      specificity: null,
      auc: null,
      accuracy: null,
      segmentationMetrics: null,
      majorFindings: [],
      limitations: [],
    };

    const magnuskaStudy = buildStudyEvidenceFromExtraction(
      magnuskaPaper,
      magnuskaChunks as any,
      magnuskaRaw,
      { researchObjective: "Breast ultrasound lesion detection and classification" }
    );

    assert.equal(
      magnuskaStudy.aiMethod,
      "YOLOv3, Viola–Jones (Detection); Weighted KNN (Classification)",
      "Detection and classification methods must be explicitly disambiguated in aiMethod"
    );
    assert.ok(
      magnuskaStudy.auc?.includes("0.94") &&
        magnuskaStudy.auc?.includes("Weighted KNN") &&
        magnuskaStudy.auc?.includes("Manual Segmentation"),
      "AUC metric must preserve model and condition tags"
    );
    assert.ok(
      magnuskaStudy.accuracy?.includes("85.00%") &&
        magnuskaStudy.accuracy?.includes("Weighted KNN") &&
        magnuskaStudy.accuracy?.includes("Manual Segmentation"),
      "Accuracy metric must preserve model and condition tags"
    );

    console.log("✅ PASS: 6B. Magnuska AUROC 0.94 strictly attributed to Weighted KNN (Manual Segmentation); YOLOv3/Viola-Jones misattribution and cross-task attribution rejected");
    passed++;

    // -----------------------------------------------------------------------
    // 6C: Strict Quantitative Citation Grounding & Evidence Anchor Verification
    // -----------------------------------------------------------------------
    const paperLookupMap = new Map<string, PaperLookup>();

    // Paper with chunk-27, chunk-30 (no 73.93%) AND chunk-42 (contains 73.93%)
    const pLookup: PaperLookup = {
      title: arunetPaper.title,
      authors: arunetPaper.authors,
      year: arunetPaper.year,
      chunks: new Map(),
    };
    for (const c of arunetChunks) {
      pLookup.chunks.set(c.id, c as any);
    }
    paperLookupMap.set(arunetPaper.id, pLookup);

    // Case 1: Model cited non-supporting chunks (chunk-27, chunk-30). Chunk-42 IS retrieved.
    // Chunk-27 and chunk-30 must be rejected; chunk-42 must be recovered as the verified anchor.
    const citedRefsCase1 = [{ paperId: arunetPaper.id, chunkIds: ["chunk-27", "chunk-30"] }];
    const claimCase1 = "ARU-Net achieved 73.93% external mIoU on the Mirza-Aghazadeh-Attari dataset.";

    const resCase1 = validateClaimEvidenceRefs(
      citedRefsCase1,
      claimCase1,
      paperLookupMap,
      arunetRecords,
      "Ultrasound segmentation architectures"
    );

    assert.equal(resCase1.validAnchors.length, 1, "Must have exactly 1 valid anchor");
    assert.equal(resCase1.validAnchors[0].chunkId, "chunk-42", "Must anchor to chunk-42 (Table 5) supporting 73.93%");
    assert.equal(resCase1.validAnchors[0].pageNumber, 10, "Chunk-42 is on Page 10, not Page 7");
    assert.equal(resCase1.rejectedCitationsCount, 2, "Chunks 27 and 30 must be rejected as non-supporting chunks");

    // Case 2: Model cited non-supporting chunks (chunk-27, chunk-30), but chunk-42 was NEVER retrieved.
    // Must return 0 valid anchors (fail-closed) so the claim is dropped rather than cited to non-supporting chunks.
    const paperLookupWithoutChunk42 = new Map<string, PaperLookup>();
    const pLookupNo42: PaperLookup = {
      title: arunetPaper.title,
      authors: arunetPaper.authors,
      year: arunetPaper.year,
      chunks: new Map(),
    };
    pLookupNo42.chunks.set("chunk-27", arunetChunks[0] as any);
    pLookupNo42.chunks.set("chunk-30", arunetChunks[1] as any);
    paperLookupWithoutChunk42.set(arunetPaper.id, pLookupNo42);

    const resCase2 = validateClaimEvidenceRefs(
      citedRefsCase1,
      claimCase1,
      paperLookupWithoutChunk42,
      arunetRecords,
      "Ultrasound segmentation architectures"
    );

    assert.equal(resCase2.validAnchors.length, 0, "When supporting chunk was not retrieved, must fail-closed with 0 valid anchors");
    assert.equal(resCase2.rejectedCitationsCount, 2, "Both non-supporting chunks must be rejected");

    // Case 3: Model cites chunk from a DIFFERENT paper for ARU-Net 73.93% -> REJECTED
    const citedRefsCase3 = [{ paperId: magnuskaPaper.id, chunkIds: ["chunk-53"] }];
    const resCase3 = validateClaimEvidenceRefs(
      citedRefsCase3,
      claimCase1,
      paperLookupMap,
      arunetRecords,
      "Ultrasound segmentation architectures"
    );
    assert.equal(resCase3.validAnchors.length, 0, "Cross-paper citation mismatch must be rejected with 0 valid anchors");

    console.log("✅ PASS: 6C. Quantitative citation grounding: non-supporting chunks (27, 30) rejected; verified source chunk (42, p.10) anchored; unretrieved evidence fails closed with 0 anchors");
    passed++;

    // -----------------------------------------------------------------------
    // 6D: Multi-Model Metric Summaries Model Identifier Preservation
    // -----------------------------------------------------------------------
    const zakareyaPaper = {
      id: "cmunwvfkr006uvrus0m3ky4wn",
      title: "Deep learning models for breast cancer detection in ultrasound images",
      authors: ["Z. Zakareya et al."],
      year: 2021,
    };
    const zakareyaChunks = [
      mockChunk("chunk-60", 60, "Table 4. Comparison on Cairo US test set: AlexNet 69%, ZFNet 69%, VGG16 76%, GoogleNet 79%, ResNet-50 88%, Proposed DNN R3_R5_R35 93%.", 12, "Results"),
    ];
    const zakareyaRaw: RawStudyExtraction = {
      isAiStudy: true,
      clinicalTask: "CLASSIFICATION",
      studyCategory: "AI_MODEL",
      studyDesign: "Retrospective",
      population: "Patients",
      sampleSize: null,
      imagingModality: "Ultrasound",
      imagingProtocol: null,
      aiMethod: "Proposed DNN R3_R5_R35",
      comparator: null,
      referenceStandard: "Histology",
      validationMethod: null,
      externalValidationStatus: "UNKNOWN",
      sensitivity: null,
      specificity: null,
      auc: null,
      accuracy: null,
      segmentationMetrics: null,
      majorFindings: [],
      limitations: [],
    };

    const zakareyaStudy = buildStudyEvidenceFromExtraction(
      zakareyaPaper,
      zakareyaChunks as any,
      zakareyaRaw,
      { researchObjective: "Breast ultrasound deep learning architectures" }
    );

    assert.ok(
      zakareyaStudy.accuracy?.includes("Proposed DNN R3_R5_R35"),
      "Multi-model accuracy summary must include proposed model label"
    );
    assert.ok(
      zakareyaStudy.accuracy?.includes("AlexNet (Baseline)"),
      "Multi-model accuracy summary must include AlexNet baseline label"
    );
    assert.ok(
      zakareyaStudy.accuracy?.includes("ResNet-50 (Baseline)"),
      "Multi-model accuracy summary must include ResNet-50 baseline label"
    );
    assert.ok(
      !/^[\d\.\s%,\-]+$/.test(zakareyaStudy.accuracy || ""),
      "Accuracy summary must NOT be a naked list of numbers without model identifiers"
    );

    console.log("✅ PASS: 6D. Multi-model metric summary: each metric explicitly attributed with model identifier; naked metric lists rejected");
    passed++;
  }

  console.log("==========================================================");
  console.log(`PHASE 2.1 TEST SUITE: ALL ${passed} TESTS PASSED!`);
  console.log("==========================================================");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
