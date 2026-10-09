import {
  extractAuditedMetricRecordsForStudy,
  verifyMetricRecord,
  verifyNarrativeNumericalClaim,
} from "../src/lib/agent/metric-verifier";
import { MetricRecord, computeMetricRecordId } from "../src/lib/agent/metric-types";
import { RetrievedEvidenceChunk } from "../src/lib/synthesis/types";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(message);
  }
}

console.log("================================================================================");
console.log("TEST SUITE: Metric Provenance & Structured Verification");
console.log("================================================================================");

let passedCount = 0;

function runTest(name: string, fn: () => void) {
  process.stdout.write(`- ${name}... `);
  try {
    fn();
    console.log("✅ PASS");
    passedCount++;
  } catch (err: any) {
    console.log(`❌ FAIL\n  Error: ${err.message}`);
    throw err;
  }
}

// Mock Evidence Chunks for Audited Studies
const kimTable2Chunk: RetrievedEvidenceChunk = {
  id: "kim-c33",
  paperId: "cmunwm6m2004ivrusrlr89j95",
  chunkIndex: 33,
  pageNumber: 9,
  section: "Results",
  text: "Table 2. Performances of traditional CNN and the proposed FC-CNN for backbone networks. ResNet-34 ACC (%) 93.86 Recall (%) 92.03 Precision (%) 92.76 F1 Score (%) 92.31 AUC 0.9645. DenseNet-161 ACC (%) 93.73 Recall (%) 93.19 Precision (%) 92.40 F1 Score (%) 92.76 AUC 0.9706.",
  similarity: 0.95,
};

const kimTable3Chunk: RetrievedEvidenceChunk = {
  id: "kim-c39",
  paperId: "cmunwm6m2004ivrusrlr89j95",
  chunkIndex: 39,
  pageNumber: 11,
  section: "Discussion",
  text: "Table 3. Classification accuracy and standard deviation of traditional CNN and FC-CNN combining strategies. ResNet-34 Accuracy 0.915 0.939 0.929 0.935 0.928 STD 0.016 0.026 0.023 0.026 0.016 DenseNet-161 Accuracy 0.923 0.937 0.936 0.932 0.929 STD 0.020 0.029 0.023 0.033 0.033",
  similarity: 0.92,
};

const liTable4Chunk: RetrievedEvidenceChunk = {
  id: "li-c29",
  paperId: "cmunxw9il00dnvrus7w9mqij9",
  chunkIndex: 29,
  pageNumber: 8,
  section: "Methods",
  text: "TABLE 4 Comparison of diagnostic efficacy of multiple combined diagnostic methods for benign and malignant breast tumors. Diagnostic method AUC 95% CI Sensitivity Specificity PPV NPV Accuracy US+SWE+CEUS 0.946 0.893–1.000 90.7 93.2 94.2 95.3 94.7",
  similarity: 0.94,
};

const liTable8Chunk: RetrievedEvidenceChunk = {
  id: "li-c43",
  paperId: "cmunxw9il00dnvrus7w9mqij9",
  chunkIndex: 43,
  pageNumber: 13,
  section: "Methods",
  text: "TABLE 8 Comparison of diagnostic efficacy of combined diagnostic methods for breast tumor benignity and malignancy among different age groups. Age Diagnostic method AUC 95% CI Sensitivity Specificity PPV NPV Accuracy <50 US+CEUS 0.919 0.817–1.000 88.2 95.7 93.8 91.6 91.9 US+SWE+CEUS 0.949 0.867–1.000 94.1 95.7 94.2 95.6 94.9 ≥50 US+CEUS 0.908 0.816–1.000 91.2 90.5 94.0 86.4 90.8 US+SWE+CEUS 0.952 0.878–1.000 100.0 90.5 94.5 100.0 95.2",
  similarity: 0.93,
};

const magnuskaChunk53: RetrievedEvidenceChunk = {
  id: "mag-c53",
  paperId: "cmumgtiix0000vr445cn8ry7o",
  chunkIndex: 53,
  pageNumber: 14,
  section: "Methods",
  text: "Table 11. The precision metrics of the 3 best breast lesion classification models selected on the test groups of the Manual Segmentation, YOLOv3, and Viola–Jones Classification Subsets. Method Accuracy (%) Sensitivity (%) Specificity (%) Weighted KNN (trained on Manual Segmentation dataset) 85.00 83.33 87.50 Ensemble Subspace KNN (trained on YOLOv3 dataset) 70.00 70.00 70.83 Median KNN (trained on Viola-Jones dataset) 61.67 61.11 62.50 All classifiers can distinguish between malignant and benign breast lesions (AUROC > 0.5) (Figure 6). The Weighted KNN classifier trained on the Manual Segmentation dataset obtained the highest AUROC (0.94). The second-best was the Ensemble Subspace KNN model based on inference with the YOLOv3 dataset (AUROC = 0.81), and the last was the Median KNN classifier trained on the Viola–Jones dataset (AUROC = 0.70).",
  similarity: 0.95,
};

const zakareyaChunk58: RetrievedEvidenceChunk = {
  id: "zak-c58",
  paperId: "cmunwvfkr006uvrus0m3ky4wn",
  chunkIndex: 58,
  pageNumber: 17,
  section: "Results",
  text: "Table 1. The newly developed model results on Cairo University ultrasound images dataset (test part). Proposed DNN R3_R5_R35 Precision 0.93 Recall 0.93 F1-Score 0.93 Loss 0.2103 Accuracy 0.93 Table 2. Confusion matrix for the test dataset. Predicted 0: Actual 0 = 33, Actual 1 = 1. Predicted 1: Actual 0 = 4, Actual 1 = 30.",
  similarity: 0.93,
};

// =============================================================================
// TEST CASES
// =============================================================================

runTest("Kim: accuracy 0.939 and 0.937 must not be labeled AUC", () => {
  const badKimRecord: MetricRecord = {
    id: computeMetricRecordId({
      paperId: "cmunwm6m2004ivrusrlr89j95",
      modelOrMethod: "ResNet-34",
      metricName: "AUC",
      cohort: "OVERALL",
      sourceTableOrFigure: "Table 3",
    }),
    paperId: "cmunwm6m2004ivrusrlr89j95",
    paperTitle: "Classification for Breast Ultrasound...",
    modelOrMethod: "ResNet-34",
    clinicalTask: "CLASSIFICATION",
    imagingModality: "B-mode US",
    metricName: "AUC",
    value: 0.939,
    formattedValue: "0.939",
    unit: "RATIO",
    valueNature: "REPORTED",
    cohort: "OVERALL",
    sourceTableOrFigure: "Table 3",
    sourceChunkIds: [kimTable3Chunk.id],
    pdfPages: [11],
    supportingExcerpts: [kimTable3Chunk.text],
    verificationStatus: "EXTRACTED",
  };

  const check = verifyMetricRecord(badKimRecord, [kimTable3Chunk]);
  assert(!check.passed, "Validation should have failed for labeling accuracy as AUC");
  assert(check.status === "REJECTED", "Status must be REJECTED");
  assert(check.rejectionReason!.includes("represents classification accuracy, not AUC"), "Must explain accuracy vs AUC");
});

runTest("Kim: verify AUC 0.9645 and 0.9706 with correct Table 2 source anchors", () => {
  const records = extractAuditedMetricRecordsForStudy("cmunwm6m2004ivrusrlr89j95", [kimTable2Chunk, kimTable3Chunk]);
  const auc34 = records.find((r) => r.modelOrMethod.includes("ResNet-34") && r.metricName === "AUC");
  const auc161 = records.find((r) => r.modelOrMethod.includes("DenseNet-161") && r.metricName === "AUC");

  assert(Boolean(auc34), "Must extract ResNet-34 AUC");
  assert(auc34!.value === 0.9645, "ResNet-34 AUC must be 0.9645");
  assert(auc34!.sourceTableOrFigure === "Table 2", "Must cite Table 2");
  assert(auc34!.pdfPages.includes(9), "Must cite page 9");
  assert(auc34!.verificationStatus === "VERIFIED", "Must be VERIFIED");

  assert(Boolean(auc161), "Must extract DenseNet-161 AUC");
  assert(auc161!.value === 0.9706, "DenseNet-161 AUC must be 0.9706");
  assert(auc161!.sourceTableOrFigure === "Table 2", "Must cite Table 2");
  assert(auc161!.verificationStatus === "VERIFIED", "Must be VERIFIED");
});

runTest("Li: overall AUC 0.946 must remain distinct from subgroup AUC 0.949 and 0.952", () => {
  const records = extractAuditedMetricRecordsForStudy("cmunxw9il00dnvrus7w9mqij9", [liTable4Chunk, liTable8Chunk]);

  const overallAuc = records.find((r) => r.metricName === "AUC" && r.cohort === "OVERALL");
  const sub50Auc = records.find((r) => r.metricName === "AUC" && r.subgroup === "Age <50" && r.modelOrMethod === "US + SWE + CEUS");
  const subOver50Auc = records.find((r) => r.metricName === "AUC" && r.subgroup === "Age ≥50");

  assert(Boolean(overallAuc), "Must extract overall AUC");
  assert(overallAuc!.value === 0.946, "Overall AUC must be 0.946");
  assert(overallAuc!.sourceTableOrFigure === "Table 4", "Overall AUC must cite Table 4");
  assert(overallAuc!.sampleSizeTotal === 95, "Overall sample size must be 95");

  assert(Boolean(sub50Auc), "Must extract Age <50 AUC");
  assert(sub50Auc!.value === 0.949, "Age <50 AUC must be 0.949");
  assert(sub50Auc!.sourceTableOrFigure === "Table 8", "Subgroup AUC must cite Table 8");
  assert(sub50Auc!.sampleSizeTotal === 40, "Age <50 sample size must be 40");

  assert(Boolean(subOver50Auc), "Must extract Age ≥50 AUC");
  assert(subOver50Auc!.value === 0.952, "Age ≥50 AUC must be 0.952");
  assert(subOver50Auc!.sampleSizeTotal === 55, "Age ≥50 sample size must be 55");

  // Attempt to label 0.949 as OVERALL
  const falseOverallRecord: MetricRecord = {
    ...sub50Auc!,
    cohort: "OVERALL",
    subgroup: null,
  };
  const check = verifyMetricRecord(falseOverallRecord, [liTable8Chunk]);
  assert(!check.passed, "Must reject subgroup AUC labeled as OVERALL");
  assert(check.status === "REJECTED", "Status must be REJECTED");
});

runTest("Li: US+CEUS AUC 0.919 must not become US+SWE+CEUS", () => {
  const records = extractAuditedMetricRecordsForStudy("cmunxw9il00dnvrus7w9mqij9", [liTable4Chunk, liTable8Chunk]);
  const usCeusRecord = records.find((r) => r.value === 0.919);

  assert(Boolean(usCeusRecord), "Must extract 0.919");
  assert(!usCeusRecord!.imagingModality.includes("Shear-Wave"), "US+CEUS modality must NOT include Shear-Wave");
  assert(usCeusRecord!.modelOrMethod.includes("US + CEUS"), "Method must be US + CEUS");

  // Attempt to claim 0.919 as US+SWE+CEUS
  const claimCheck = verifyNarrativeNumericalClaim(
    "The clinical comparator achieved an AUC of 0.919 for US+SWE+CEUS.",
    records
  );
  assert(!claimCheck.isValid, "Claim assigning 0.919 to US+SWE+CEUS must be rejected");
  assert(claimCheck.reason!.includes("0.919 is the 2-modality US+CEUS result"), "Reason must specify 2-modality");
});

runTest("Magnuska: accuracy 85.00%, sensitivity 83.33%, specificity 87.50%, AUC 0.94", () => {
  const records = extractAuditedMetricRecordsForStudy("cmumgtiix0000vr445cn8ry7o", [magnuskaChunk53]);

  const acc = records.find((r) => r.metricName === "ACCURACY");
  const sens = records.find((r) => r.metricName === "SENSITIVITY");
  const spec = records.find((r) => r.metricName === "SPECIFICITY");
  const auc = records.find((r) => r.metricName === "AUC");

  assert(Boolean(acc) && acc!.value === 85.0, "Accuracy must be 85.00%");
  assert(Boolean(sens) && sens!.value === 83.33, "Sensitivity must be 83.33%");
  assert(Boolean(spec) && spec!.value === 87.5, "Specificity must be 87.50%");
  assert(Boolean(auc) && auc!.value === 0.94, "AUC must be 0.94");

  // Verify that an erroneous narrative claim saying "sensitivity of 85.00%" is sanitized to accuracy 85.00% & sensitivity 83.33%
  const claimCheck = verifyNarrativeNumericalClaim(
    "The Weighted KNN model achieved a sensitivity of 85.00% and specificity of 87.50%.",
    records
  );
  assert(claimCheck.isValid, "Sanitizer should succeed");
  assert(claimCheck.sanitizedClaim!.includes("accuracy of 85.00%, sensitivity of 83.33%"), "Must sanitize sensitivity vs accuracy");
});

runTest("Zakareya: do not infer or invent unreported AUC", () => {
  const records = extractAuditedMetricRecordsForStudy("cmunwvfkr006uvrus0m3ky4wn", [zakareyaChunk58]);

  const acc = records.find((r) => r.metricName === "ACCURACY");
  const auc = records.find((r) => r.metricName === "AUC");

  assert(Boolean(acc) && acc!.value === 93.0, "Accuracy must be 93%");
  assert(!auc, "AUC must NOT be extracted for Zakareya because manuscript does not report it");
});

runTest("Verify ambiguous table values are rejected rather than guessed", () => {
  const ambiguousRecord: MetricRecord = {
    id: "ambiguous-test",
    paperId: "test-paper",
    paperTitle: "Test Study",
    modelOrMethod: "Unknown Model",
    clinicalTask: "CLASSIFICATION",
    imagingModality: "Ultrasound",
    metricName: "AUC",
    value: 0.777,
    formattedValue: "0.777",
    unit: "RATIO",
    valueNature: "REPORTED",
    cohort: "OVERALL",
    sourceTableOrFigure: "Unknown Table",
    sourceChunkIds: [kimTable2Chunk.id], // chunk doesn't have 0.777
    pdfPages: [99], // page 99 doesn't match chunk page 9
    supportingExcerpts: ["Unanchored text"],
    verificationStatus: "EXTRACTED",
  };

  const check = verifyMetricRecord(ambiguousRecord, [kimTable2Chunk]);
  assert(!check.passed, "Ambiguous unanchored record must fail verification");
  assert(check.status === "AMBIGUOUS" || check.status === "REJECTED", "Status must be AMBIGUOUS or REJECTED");
});

console.log("\n================================================================================");
console.log(`ALL ${passedCount} METRIC PROVENANCE VERIFIER TESTS PASSED!`);
console.log("================================================================================");
