/**
 * AI Research Hub — General-Purpose Scientific Metric Extraction & Verification Tests
 *
 * Comprehensive regression tests verifying:
 * 1. Generalization across previously unseen full-text papers (SelfCheckGPT, PointPillars, piCRISPR).
 * 2. Authentic extracted text from Kim Table 3, Zakareya Tables 1, 2, and 4, SelfCheckGPT Table 3, PointPillars Table 1.
 * 3. Prevention of STD or numerical fragments ("929") as model names.
 * 4. Standard deviations stored in `std` rather than accepted as accuracy values.
 * 5. Accurate interpretation of explicit units such as Accuracy (%) and Loss (%).
 * 6. Image-based tables and ambiguous geometry failing closed as AMBIGUOUS.
 * 7. Disentangling reported 93% sensitivity from the 2x2 confusion matrix (FN=0, 100% sensitivity).
 */

import { RetrievedEvidenceChunk } from "../src/lib/synthesis/types";
import {
  extractGenericMetricRecords,
  verifyMetricRecord,
  extractMetricRecordsForStudy,
  extractAuditedMetricRecordsForStudy,
  verifyNarrativeNumericalClaim,
} from "../src/lib/agent/metric-verifier";
import {
  extractCandidateMetricRecords,
  determineMetricAbsenceReason,
} from "../src/lib/agent/candidate-metric-extractor";
import { parseTabularStructuresFromChunk, isInvalidModelName } from "../src/lib/agent/table-parser";
import { MetricRecord } from "../src/lib/agent/metric-types";

let passedCount = 0;
function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passedCount++;
  } catch (err: any) {
    console.error(`FAIL: ${name}`);
    console.error(err.message || err);
    process.exit(1);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

// =============================================================================
// Authentic Evidence Chunks from Library
// =============================================================================

// 1. SelfCheckGPT (Chunk 27: Table 3)
const authenticSelfCheckChunk27: RetrievedEvidenceChunk = {
  id: "cmuwcfkrb0062vrss7k7w9eqv",
  paperId: "cmuwcfd5h004vvrss925t6jo2",
  chunkIndex: 27,
  pageNumber: 8,
  section: "Methods",
  text: `WikiBio.6 

NoFac NoFac* Fact Pear. Spear. SelfCk-BERT 81.96 45.96 44.23 58.18 55.90 WikiBio+BERT 81.32 40.62 49.15 58.71 55.80 SelfCk-QA 84.26 40.06 48.14 61.07 59.29 WikiBio+QA 84.18 45.40 52.03 57.26 53.62 SelfCk-1gm 85.63 41.04 58.47 64.71 64.91 WikiBio+1gm 80.43 31.47 40.53 28.67 26.70 SelfCk-NLI 92.50 45.17 66.08 74.14 73.78 WikiBio+NLI 91.18 48.14 71.61 78.84 80.00 SelfCk-Prompt 93.42 53.19 67.09 78.32 78.30 WikiBio+Prompt 93.59 65.26 73.11 85.90 86.11 Table 3: The performance when using SelfCheckGPT samples versus external stored knowledge.`,
};

// 2. PointPillars (Chunk 24: Table 1)
const authenticPointPillarsChunk24: RetrievedEvidenceChunk = {
  id: "cmuwcg9510081vrsstjzfibxf",
  paperId: "cmuwcfyqc006ovrss8qyhxa1u",
  chunkIndex: 24,
  pageNumber: 6,
  section: "Methods",
  text: `(Hz) mAP Car Pedestrian Cyclist Mod. Easy Mod. Hard Easy Mod. Hard Easy Mod. Hard MV3D [2] Lidar & Img. 2.8 N/A 86.02 76.90 68.49 N/A N/A N/A N/A N/A N/A Cont-Fuse [15] Lidar & Img. 16.7 N/A 88.81 85.83 77.33 N/A N/A N/A N/A N/A N/A Roarnet [25] Lidar & Img. 10 N/A 88.20 79.41 70.02 N/A N/A N/A N/A N/A N/A AVOD-FPN [11] Lidar & Img. 10 64.11 88.53 83.79 77.90 58.75 51.05 47.54 68.09 57.48 50.77 F-PointNet [21] Lidar & Img. 5.9 65.39 88.70 84.00 75.33 58.09 50.22 47.20 75.38 61.96 54.68 HDNET [29] Lidar & Map 20 N/A 89.14 86.57 78.32 N/A N/A N/A N/A N/A N/A PIXOR++ [29] Lidar 35 N/A 89.38 83.70 77.97 N/A N/A N/A N/A N/A N/A VoxelNet [31] Lidar 4.4 58.25 89.35 79.26 77.39 46.13 40.74 38.11 66.70 54.76 50.55 SECOND [28] Lidar 20 60.56 88.07 79.37 77.95 55.10 46.27 44.76 73.67 56.04 48.78 PointPillars Lidar 62 66.19 88.35 86.10 79.83 58.66 50.23 47.19 79.14 62.25 56.00 Table 1. Results on the KITTI test BEV detection benchmark.`,
};

// 3. piCRISPR (Chunk 25: Figure 5 text, no tables)
const authenticPiCrisprChunk25: RetrievedEvidenceChunk = {
  id: "cmuwceyfl004avrss4o358cdc",
  paperId: "cmuwceqie0035vrss654u0nvy",
  chunkIndex: 25,
  pageNumber: 5,
  section: "Results",
  text: `Testing Scenario 2 Figure 5 shows that all piCRISPR-implemented models achieve state-of-the-art classification performance when measured by AUC-ROC, with RNN models yielding the best results. As mentioned in [30], the area under precision-recall curve (AU-PRC) is a much more suitable measure than the area under receiver operating curve (AU-ROC) for off-target prediction. We did not report tabular sensitivity or confusion matrix counts for this task.`,
};

// 4. Kim et al. (Authentic Chunks 33 and 39)
const authenticKimChunk33: RetrievedEvidenceChunk = {
  id: "cmunwmok80069vrusqbsdc5av",
  paperId: "cmunwm6m2004ivrusrlr89j95",
  chunkIndex: 33,
  pageNumber: 8,
  section: "Methods",
  text: `Table 2. Performances of traditional CNN and the proposed FC-CNN for backbone networks. Model Sensitivity (%) Specificity (%) Accuracy (%) AUC FC-CNN (ResNet-34) 93.33 94.12 93.86 0.9645 FC-CNN (DenseNet-161) 94.44 94.87 94.70 0.9706`,
};

const authenticKimChunk39: RetrievedEvidenceChunk = {
  id: "cmunwmok8006fvrusw2329orv",
  paperId: "cmunwm6m2004ivrusrlr89j95",
  chunkIndex: 39,
  pageNumber: 11,
  section: "Discussion",
  text: `Appl. Sci. 2021, 11, 10216 11 of 14 experiment, it is hard to find the significant differences and trends among the combining algorithms, which means all CNN models mostly agree with the same prediction of class. Table 3. Classification accuracy and standard deviation of traditional CNN and FC-CNN combining strategies. CNN Model Traditional CNN Simple Voting Weighted Voting Simple Averaging Weighted Averaging ResNet-34 Accuracy 0.915 0.939 0.929 0.935 0.928 STD 0.016 0.026 0.023 0.026 0.016 DenseNet-161 Accuracy 0.923 0.937 0.936 0.932 0.929 STD 0.020 0.029 0.023 0.033 0.033`,
};

// 5. Zakareya et al. (Authentic Chunks 58 and 60)
const authenticZakareyaChunk58: RetrievedEvidenceChunk = {
  id: "cmunwvp4b0091vrusywxb94qp",
  paperId: "cmunwvfkr006uvrus0m3ky4wn",
  chunkIndex: 58,
  pageNumber: 17,
  section: "Results",
  text: `Diagnostics 2023, 13, 1944 17 of 23Proposed DNN R5_R5_R5 Figure 6. Accuracy and loss diagrams for the three proposed models. Table 1. The newly developed model results on Cairo University ultrasound images dataset (test part). 93 Table 2. Confusion matrix for the test dataset. ). , DNN R3_R5_R35, with these architectures in Table 3. To perform this comparison, we have utilized GoogLeNet with 22 layers and ResNet with 50 layers for comparison. The results indicate that ResNet outperformed GoogLeNet in two critical evaluation metrics: accuracy and F1 score. Inspection of the table containing the results reveals that the proposed method has surpassed both of these models and yielded a higher detection accuracy than these two state-of-the-art architectures. Table 3. Comparison of the proposed model against GoogLeNet and ResNet on the test dataset. 93 The performance of GoogLeNet during the training phase is shown in Figure 7.`,
};

const authenticZakareyaChunk60: RetrievedEvidenceChunk = {
  id: "cmunwvp4c0093vrusutunqdmf",
  paperId: "cmunwvfkr006uvrus0m3ky4wn",
  chunkIndex: 60,
  pageNumber: 18,
  section: "Results",
  text: `Table 4. Comparison of the proposed model against nine state-of-the-art image processing models on the Cairo University ultrasound images dataset. Deep-Learning Model Loss (%) Accuracy (%) AlexNet 66 69 ZFNet 64 69 VGG-16 6 73 Inception v4 46 85 MobileNet 55 85 WideResNet 39 88 GoogLeNet 59 87 ResNet34 61 83 ResNet50 51 88 Proposed DNN R3_R5_R35 21 93`,
};

const authenticZakareyaChunk61: RetrievedEvidenceChunk = {
  id: "cmunwvp4c0094vrusctkot0w6",
  paperId: "cmunwvfkr006uvrus0m3ky4wn",
  chunkIndex: 61,
  pageNumber: 18,
  section: "Results",
  text: `Table 4 shows these comparisons. Table 4. Comparison of the proposed model against nine state-of-the-art image processing models on the Cairo University ultrasound images dataset. Deep-Learning Model Loss (%) Accuracy (%) AlexNet 66 69 ZFNet 64 69 VGG-16 6 73 Inception v4 46 85 MobileNet 55 85 WideResNet 39 88 GoogLeNet 59 87 ResNet34 61 83 ResNet50 51 88 Proposed DNN R3_R5_R35 21 93 The proposed model is superior to all existing image processing architectures in terms of prediction accuracy on breast cancer images.`,
};

// 6. Magnuska et al. (Authentic Chunk 53)
const authenticMagnuskaChunk53: RetrievedEvidenceChunk = {
  id: "cmumgtiix0000vr445cn8ry7o_c53",
  paperId: "cmumgtiix0000vr445cn8ry7o",
  chunkIndex: 53,
  pageNumber: 14,
  section: "Results",
  text: `Table 11. Performance metrics of classifiers trained on manual segmentation dataset. Classifier Accuracy Sensitivity Specificity Weighted KNN 85.00 83.33 87.50 Ensemble Subspace KNN 70.00 70.00 70.83 Median KNN 61.67 61.11 62.50 All classifiers can distinguish between malignant and benign lesions. The Weighted KNN classifier trained on the Manual Segmentation dataset obtained the highest AUROC (0.94).`,
};

// 7. Li et al. (Authentic Chunks 29 and 43)
const authenticLiChunk29: RetrievedEvidenceChunk = {
  id: "li-c29",
  paperId: "cmunxw9il00dnvrus7w9mqij9",
  chunkIndex: 29,
  pageNumber: 4,
  section: "Results",
  text: `TABLE 4. Comparison of diagnostic efficacy of multiple combined diagnostic methods for benign and malignant breast lesions. Method AUC (95% CI) Sensitivity (%) Specificity (%) Accuracy (%) US+SWE+CEUS 0.946 (0.893-1.000) 90.7 93.2 94.7`,
};

const authenticLiChunk43: RetrievedEvidenceChunk = {
  id: "li-c43",
  paperId: "cmunxw9il00dnvrus7w9mqij9",
  chunkIndex: 43,
  pageNumber: 6,
  section: "Results",
  text: `TABLE 8. Subgroup analysis of diagnostic performance according to age. Age <50 years: US+SWE+CEUS AUC: 0.949 (0.867-1.000) US+CEUS AUC: 0.919 (0.817-1.000) Age >=50 years: US+SWE+CEUS AUC: 0.952 (0.878-1.000)`,
};

// =============================================================================
// TEST SUITE
// =============================================================================

runTest("1. SelfCheckGPT: Generic Extraction of PR-AUC, Pearson and Spearman correlations", () => {
  const paper = { id: "cmuwcfd5h004vvrss925t6jo2", title: "SelfCheckGPT" };
  const records = extractGenericMetricRecords(paper, [authenticSelfCheckChunk27]);

  assert(records.length === 50, `SelfCheckGPT Table 3 must yield exactly 50 extracted records, got ${records.length}`);

  // Verify SelfCk-Prompt PR-AUC (NoFac)
  const promptNoFac = records.find(
    (r) => r.modelOrMethod === "SelfCk-Prompt" && r.metricName === "PR_AUC" && r.benchmarkCondition === "NoFac"
  );
  assert(Boolean(promptNoFac), "SelfCk-Prompt NoFac PR-AUC record must exist");
  assert(promptNoFac?.value === 93.42, "SelfCk-Prompt NoFac value must be 93.42");
  assert(promptNoFac?.verificationStatus === "VERIFIED", "SelfCk-Prompt NoFac must be VERIFIED");

  // Verify SelfCk-Prompt Pearson and Spearman
  const promptPear = records.find(
    (r) => r.modelOrMethod === "SelfCk-Prompt" && r.metricName === "PEARSON_CORRELATION"
  );
  assert(Boolean(promptPear), "SelfCk-Prompt Pearson correlation record must exist");
  assert(promptPear?.value === 78.32, "SelfCk-Prompt Pearson correlation must be 78.32");
  assert(promptPear?.unit === "PERCENT", "SelfCk-Prompt Pearson correlation unit must be PERCENT");
  assert(promptPear?.verificationStatus === "VERIFIED", "SelfCk-Prompt Pearson must be VERIFIED");

  const promptSpear = records.find(
    (r) => r.modelOrMethod === "SelfCk-Prompt" && r.metricName === "SPEARMAN_CORRELATION"
  );
  assert(Boolean(promptSpear), "SelfCk-Prompt Spearman correlation record must exist");
  assert(promptSpear?.value === 78.30, "SelfCk-Prompt Spearman correlation must be 78.30");
  assert(promptSpear?.unit === "PERCENT", "SelfCk-Prompt Spearman correlation unit must be PERCENT");
  assert(promptSpear?.verificationStatus === "VERIFIED", "SelfCk-Prompt Spearman must be VERIFIED");
});

runTest("2. PointPillars: Generic Extraction of mAP and Benchmark Difficulty Conditions", () => {
  const paper = { id: "cmuwcfyqc006ovrss8qyhxa1u", title: "PointPillars" };
  const records = extractGenericMetricRecords(paper, [authenticPointPillarsChunk24]);

  assert(records.length === 65, `PointPillars Table 1 must yield 65 extracted records, got ${records.length}`);

  // Verify PointPillars aggregate mAP Mod = 66.19
  const ppMod = records.find(
    (r) => r.modelOrMethod === "PointPillars" && r.metricName === "MAP" && r.benchmarkCondition === "Difficulty: Mod"
  );
  assert(Boolean(ppMod), "PointPillars mAP Mod record must exist");
  assert(ppMod?.value === 66.19, "PointPillars mAP Mod value must be 66.19");
  assert(ppMod?.verificationStatus === "VERIFIED", "PointPillars mAP Mod must be VERIFIED");

  // Verify PointPillars Car Mod AP = 86.10
  const ppCarMod = records.find(
    (r) => r.modelOrMethod === "PointPillars" && r.benchmarkCondition === "Class: Car, Difficulty: Mod"
  );
  assert(Boolean(ppCarMod), "PointPillars Car Mod record must exist");
  assert(ppCarMod?.value === 86.10, "PointPillars Car Mod value must be 86.10");
  assert(ppCarMod?.verificationStatus === "VERIFIED", "PointPillars Car Mod must be VERIFIED");

  // Verify Pedestrian Mod = 50.23 and Cyclist Mod = 62.25
  const ppPedMod = records.find(
    (r) => r.modelOrMethod === "PointPillars" && r.benchmarkCondition === "Class: Pedestrian, Difficulty: Mod"
  );
  assert(ppPedMod?.value === 50.23, "PointPillars Pedestrian Mod must be 50.23");

  const ppCycMod = records.find(
    (r) => r.modelOrMethod === "PointPillars" && r.benchmarkCondition === "Class: Cyclist, Difficulty: Mod"
  );
  assert(ppCycMod?.value === 62.25, "PointPillars Cyclist Mod must be 62.25");
});

runTest("3. Kim Table 3: Authentic Multi-Column Extraction, STD Protection & No Bogus Models", () => {
  const paper = { id: "cmunwm6m2004ivrusrlr89j95", title: "Kim et al." };
  const records = extractGenericMetricRecords(paper, [authenticKimChunk39]);

  assert(records.length === 10, `Kim Table 3 must yield exactly 10 strategy records, got ${records.length}`);

  // 1. Verify ResNet-34 Simple Voting has accuracy 0.939 and std 0.026
  const resnetSimpleVoting = records.find(
    (r) => r.modelOrMethod === "ResNet-34" && r.benchmarkCondition === "Strategy: Simple Voting"
  );
  assert(Boolean(resnetSimpleVoting), "ResNet-34 Simple Voting record must exist");
  assert(resnetSimpleVoting?.value === 0.939, "ResNet-34 Simple Voting accuracy must be 0.939");
  assert(resnetSimpleVoting?.std === 0.026, "ResNet-34 Simple Voting std must be 0.026");
  assert(resnetSimpleVoting?.formattedValue === "0.939 ± 0.026", "Formatted value must display accuracy ± std");
  assert(resnetSimpleVoting?.verificationStatus === "VERIFIED", "ResNet-34 Simple Voting must be VERIFIED");

  // 2. Verify DenseNet-161 Simple Voting has accuracy 0.937 and std 0.029
  const denseSimpleVoting = records.find(
    (r) => r.modelOrMethod === "DenseNet-161" && r.benchmarkCondition === "Strategy: Simple Voting"
  );
  assert(Boolean(denseSimpleVoting), "DenseNet-161 Simple Voting record must exist");
  assert(denseSimpleVoting?.value === 0.937, "DenseNet-161 Simple Voting accuracy must be 0.937");
  assert(denseSimpleVoting?.std === 0.029, "DenseNet-161 Simple Voting std must be 0.029");

  // 3. Negative Controls: Demonstrating STD is NEVER accepted as a model
  assert(!records.some((r) => r.modelOrMethod === "STD"), "STD must NEVER be accepted as a model name");
  assert(!records.some((r) => r.modelOrMethod.includes("raging")), "Mangled fragment 'raging' must NEVER be accepted");
  assert(!records.some((r) => r.modelOrMethod === "929"), "Numerical fragment '929' must NEVER be accepted as a model");
  assert(!records.some((r) => r.value === 0.016 && r.metricName === "ACCURACY"), "STD value 0.016 must NEVER be accepted as an accuracy");
});

runTest("4. Zakareya Table 4: Accurate Unit Propagation for Accuracy (%)", () => {
  const paper = { id: "cmunwvfkr006uvrus0m3ky4wn", title: "Zakareya et al." };
  const records = extractGenericMetricRecords(paper, [authenticZakareyaChunk60]);

  assert(records.length === 10, `Zakareya Table 4 must yield exactly 10 accuracy records, got ${records.length}`);

  // Proposed DNN R3_R5_R35: Accuracy 93%
  const proposedDnn = records.find((r) => r.modelOrMethod === "Proposed DNN R3_R5_R35");
  assert(Boolean(proposedDnn), "Proposed DNN R3_R5_R35 must exist");
  assert(proposedDnn?.value === 93, "Proposed DNN Accuracy must be 93%");
  assert(proposedDnn?.unit === "PERCENT", "Unit must be PERCENT");
  assert(proposedDnn?.verificationStatus === "VERIFIED", "Proposed DNN Accuracy 93% must be VERIFIED");

  // Benchmark comparator AlexNet: Accuracy 69%
  const alexNet = records.find((r) => r.modelOrMethod === "AlexNet");
  assert(Boolean(alexNet), "AlexNet must exist");
  assert(alexNet?.value === 69, "AlexNet Accuracy must be 69%");
  assert(alexNet?.unit === "PERCENT", "Unit must be PERCENT");
  assert(alexNet?.verificationStatus === "VERIFIED", "AlexNet Accuracy 69% must be VERIFIED");
});

runTest("5. Zakareya Chunk 58: Image-Based Tables Fail Closed as AMBIGUOUS", () => {
  const tables = parseTabularStructuresFromChunk(authenticZakareyaChunk58);

  // Both Table 1 and Table 2 must be flagged as uncertain geometry
  const table1 = tables.find((t) => t.tableIdentifier === "Table 1");
  const table2 = tables.find((t) => t.tableIdentifier === "Table 2");

  assert(Boolean(table1), "Table 1 parsed descriptor must exist");
  assert(table1?.isGeometryCertain === false, "Table 1 must fail closed with isGeometryCertain=false");
  assert(Boolean(table1?.uncertaintyReason?.includes("image-based")), "Reason must note image-based origin");

  assert(Boolean(table2), "Table 2 parsed descriptor must exist");
  assert(table2?.isGeometryCertain === false, "Table 2 must fail closed with isGeometryCertain=false");
  assert(Boolean(table2?.uncertaintyReason?.includes("image-based")), "Reason must note image-based origin");

  // In live extraction, no numerical records are extracted from Chunk 58
  const paper = { id: "cmunwvfkr006uvrus0m3ky4wn", title: "Zakareya et al." };
  const records = extractGenericMetricRecords(paper, [authenticZakareyaChunk58]);
  assert(records.length === 0, "No records should be extracted from image-based Chunk 58 without numbers");
});

runTest("6. Zakareya Attribution Disentanglement: 93% Sensitivity vs 2x2 Confusion Matrix", () => {
  // Synthetic negative control: Claim associating 93% sensitivity with the 2x2 confusion matrix
  const verifiedRecords: MetricRecord[] = [
    {
      id: "zak_acc",
      paperId: "cmunwvfkr006uvrus0m3ky4wn",
      paperTitle: "Zakareya et al.",
      modelOrMethod: "Proposed DNN R3_R5_R35",
      clinicalTask: "CLASSIFICATION",
      imagingModality: "Ultrasound",
      metricName: "ACCURACY",
      value: 93.0,
      formattedValue: "93%",
      unit: "PERCENT",
      valueNature: "REPORTED",
      cohort: "OVERALL",
      sourceTableOrFigure: "Table 4",
      sourceChunkIds: [authenticZakareyaChunk60.id],
      pdfPages: [18],
      supportingExcerpts: [authenticZakareyaChunk60.text],
      verificationStatus: "VERIFIED",
    },
  ];

  const falseAssociationClaim = "The model achieved 93% sensitivity as confirmed by the confusion matrix.";
  const check = verifyNarrativeNumericalClaim(falseAssociationClaim, verifiedRecords);
  assert(!check.isValid, "Claim associating 93% sensitivity with confusion matrix must be rejected");
  assert(
    Boolean(check.reason?.includes("distinct evaluation scopes") || check.reason?.includes("100% sensitivity")),
    "Rejection reason must note confusion matrix incompatibility"
  );
});

runTest("7. Negative Controls: Rejecting Invalid Model Names, Impossible AUC and Correlations", () => {
  // Test invalid model name validation
  assert(isInvalidModelName("STD"), "'STD' must be invalid model name");
  assert(isInvalidModelName("929"), "'929' must be invalid model name");
  assert(isInvalidModelName("0.016"), "'0.016' must be invalid model name");
  assert(isInvalidModelName("Accuracy"), "'Accuracy' must be invalid model name");
  assert(!isInvalidModelName("ResNet-34"), "'ResNet-34' must be valid model name");
  assert(!isInvalidModelName("DenseNet-161"), "'DenseNet-161' must be valid model name");
  assert(!isInvalidModelName("Proposed DNN R3_R5_R35"), "'Proposed DNN R3_R5_R35' must be valid model name");

  // Impossible AUC > 1.0
  const impossibleAuc = "The model achieved an AUC of 1.45 on the test set.";
  const aucCheck = verifyNarrativeNumericalClaim(impossibleAuc, []);
  assert(!aucCheck.isValid, "AUC > 1.0 must be rejected");

  // Impossible Correlation > 1.0
  const impossibleCorr = "The Pearson correlation was 1.82 between predictions and ground truth.";
  const corrCheck = verifyNarrativeNumericalClaim(impossibleCorr, []);
  assert(!corrCheck.isValid, "Correlation > 1.0 must be rejected");
});

runTest("8. Breast-Imaging Regression Equivalence (Kim, Li, Magnuska, Zakareya)", () => {
  // Kim et al.
  const kimRecords = extractMetricRecordsForStudy(
    { id: "cmunwm6m2004ivrusrlr89j95", title: "Kim et al." },
    [authenticKimChunk33, authenticKimChunk39]
  );
  assert(kimRecords.length >= 4, "Kim et al. must yield >= 4 verified records");
  assert(
    kimRecords.some((r) => r.metricName === "AUC" && r.value === 0.9645 && r.sourceTableOrFigure === "Table 2"),
    "Kim Table 2 AUC 0.9645 must be verified"
  );
  assert(
    kimRecords.some((r) => r.metricName === "ACCURACY" && r.value === 0.939 && r.sourceTableOrFigure === "Table 3"),
    "Kim Table 3 Accuracy 0.939 must be verified"
  );

  // Li et al.
  const liRecords = extractMetricRecordsForStudy(
    { id: "cmunxw9il00dnvrus7w9mqij9", title: "Li et al." },
    [authenticLiChunk29, authenticLiChunk43]
  );
  assert(
    liRecords.some((r) => r.metricName === "AUC" && r.value === 0.946 && r.cohort === "OVERALL"),
    "Li Table 4 Overall AUC 0.946 must be verified"
  );
  assert(
    liRecords.some((r) => r.metricName === "AUC" && r.value === 0.949 && r.cohort === "SUBGROUP"),
    "Li Table 8 Subgroup <50 AUC 0.949 must be verified"
  );

  // Magnuska et al.
  const magnuskaRecords = extractMetricRecordsForStudy(
    { id: "cmumgtiix0000vr445cn8ry7o", title: "Magnuska et al." },
    [authenticMagnuskaChunk53]
  );
  assert(
    magnuskaRecords.some((r) => r.metricName === "ACCURACY" && r.value === 85.0),
    "Magnuska Table 11 Accuracy 85.00% must be verified"
  );
  assert(
    magnuskaRecords.some((r) => r.metricName === "SENSITIVITY" && r.value === 83.33),
    "Magnuska Table 11 Sensitivity 83.33% must be verified"
  );

  // Zakareya et al.
  const zakareyaRecords = extractMetricRecordsForStudy(
    { id: "cmunwvfkr006uvrus0m3ky4wn", title: "Zakareya et al." },
    [authenticZakareyaChunk60]
  );
  assert(
    zakareyaRecords.some((r) => r.metricName === "ACCURACY" && r.value === 93.0),
    "Zakareya Accuracy 93% must be verified"
  );
});

runTest("9. Deduplication: Overlapping Chunks Produce Canonical Records with Retained Anchors", () => {
  const paper = { id: "cmunwvfkr006uvrus0m3ky4wn", title: "Zakareya et al." };
  // Chunks 60 and 61 both contain Table 4
  const records = extractGenericMetricRecords(paper, [authenticZakareyaChunk60, authenticZakareyaChunk61]);

  // Must deduplicate to exactly 10 canonical records, not 20
  assert(records.length === 10, `Must produce exactly 10 canonical records from overlapping chunks, got ${records.length}`);

  const proposedDnn = records.find((r) => r.modelOrMethod === "Proposed DNN R3_R5_R35");
  assert(Boolean(proposedDnn), "Proposed DNN record must exist");
  assert(proposedDnn?.value === 93, "Proposed DNN value must be 93%");
  assert(proposedDnn?.unit === "PERCENT", "Unit must be PERCENT");
  assert(proposedDnn?.verificationStatus === "VERIFIED", "Status must be VERIFIED");

  // Must retain source anchors from BOTH chunks
  assert(proposedDnn!.sourceChunkIds.includes(authenticZakareyaChunk60.id), "Must retain chunk 60 ID");
  assert(proposedDnn!.sourceChunkIds.includes(authenticZakareyaChunk61.id), "Must retain chunk 61 ID");
  assert(proposedDnn!.sourceChunkIds.length === 2, `Must merge exactly 2 chunk IDs, got ${proposedDnn!.sourceChunkIds.length}`);
});

runTest("10. Fail-Closed Enforcement: Older Extraction Path Cannot Bypass Image Table Ambiguity", () => {
  // Even if a chunk is crafted with synthetic text claiming "Sensitivity 93%" or "33/37"
  const syntheticChunk58WithFakeText: RetrievedEvidenceChunk = {
    ...authenticZakareyaChunk58,
    text: authenticZakareyaChunk58.text + " Sensitivity 93% 33/37 89.19%",
  };

  const auditedRecords = extractAuditedMetricRecordsForStudy(
    "cmunwvfkr006uvrus0m3ky4wn",
    [syntheticChunk58WithFakeText]
  );

  const t1 = auditedRecords.find((r) => r.sourceTableOrFigure === "Table 1");
  const t2 = auditedRecords.find((r) => r.sourceTableOrFigure === "Table 2");

  assert(Boolean(t1), "Table 1 record must be generated");
  assert(t1?.verificationStatus === "AMBIGUOUS", "Table 1 must remain AMBIGUOUS despite synthetic text");
  assert(Boolean(t2), "Table 2 record must be generated");
  assert(t2?.verificationStatus === "AMBIGUOUS", "Table 2 must remain AMBIGUOUS despite synthetic text");

  // Production extraction path must filter out AMBIGUOUS records completely
  const prodRecords = extractMetricRecordsForStudy(
    { id: "cmunwvfkr006uvrus0m3ky4wn", title: "Zakareya et al." },
    [syntheticChunk58WithFakeText]
  );
  assert(
    !prodRecords.some((r) => r.sourceTableOrFigure === "Table 1" || r.sourceTableOrFigure === "Table 2"),
    "Production extractor must yield 0 verified records for image-based Table 1 and Table 2"
  );
});

console.log("================================================================================");
console.log(`ALL ${passedCount} GENERAL-PURPOSE METRIC EXTRACTION TESTS PASSED!`);
console.log("================================================================================");
