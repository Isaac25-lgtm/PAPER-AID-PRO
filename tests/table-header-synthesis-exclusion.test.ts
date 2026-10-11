/**
 * AI RESEARCH HUB — TABLE HEADER & LABEL SYNTHESIS EXCLUSION TEST
 *
 * Verifies that:
 * 1. Numeric-looking class indices (e.g. "0" and "1" in confusion matrices) are excluded.
 * 2. Multi-line column headers (e.g. "Voting", "Averaging", "Mod.") are excluded.
 * 3. Cohort and group labels (e.g. "Training Set", "Validation Set") are excluded.
 * 4. Difficulty headers (e.g. "Easy", "Mod.", "Hard") are excluded.
 * 5. Categorical modality tokens (e.g. "Lidar & Img.", "Lidar") are excluded.
 * 6. Legitimate scientific measurements (AUC, accuracy, sensitivity, mIOU, confusion counts) are retained.
 */

import { isScientificNumericalMeasurement } from "../src/lib/tables/types";

let passed = 0;
let failed = 0;

function assert(condition: boolean, testId: string, desc: string) {
  if (condition) {
    console.log(`[PASS] ${testId}: ${desc}`);
    passed++;
  } else {
    console.error(`[FAIL] ${testId}: ${desc}`);
    failed++;
  }
}

console.log("================================================================================");
console.log(" FOCUSED TEST: TABLE HEADERS & LABELS EXCLUSION FROM SCIENTIFIC SYNTHESIS");
console.log("================================================================================\n");

// Case 1: Numeric-looking class label "0" in header row (Zakareya col 4, row 1)
const axisZeroHeaderRow = isScientificNumericalMeasurement({
  normalizedNumericValue: 0,
  rawPrintedValue: "0",
  modelOrMethod: "Predicted",
  headerPath: ["Col_4"],
  rowIdx: 1,
  colIdx: 4,
});
assert(!axisZeroHeaderRow, "EXCLUDE_AXIS_0_HEADER_ROW", "Class label '0' in header row is strictly excluded");

// Case 2: Numeric-looking class label "1" in header row (Zakareya col 5, row 1)
const axisOneHeaderRow = isScientificNumericalMeasurement({
  normalizedNumericValue: 1,
  rawPrintedValue: "1",
  modelOrMethod: "Predicted",
  headerPath: ["Col_5"],
  rowIdx: 1,
  colIdx: 5,
});
assert(!axisOneHeaderRow, "EXCLUDE_AXIS_1_HEADER_ROW", "Class label '1' in header row is strictly excluded");

// Case 3: Numeric-looking class label "0" in index column (Zakareya col 3, row 2)
const axisZeroIndexCol = isScientificNumericalMeasurement({
  normalizedNumericValue: 0,
  rawPrintedValue: "0",
  modelOrMethod: "Predicted",
  headerPath: ["Col_3"],
  rowIdx: 2,
  colIdx: 3,
});
assert(!axisZeroIndexCol, "EXCLUDE_AXIS_0_INDEX_COL", "Class label '0' in index column is strictly excluded");

// Case 4: Numeric-looking class label "1" in index column (Zakareya col 3, row 4)
const axisOneIndexCol = isScientificNumericalMeasurement({
  normalizedNumericValue: 1,
  rawPrintedValue: "1",
  modelOrMethod: "Actual",
  headerPath: ["Col_3"],
  rowIdx: 4,
  colIdx: 3,
});
assert(!axisOneIndexCol, "EXCLUDE_AXIS_1_INDEX_COL", "Class label '1' in index column is strictly excluded");

// Case 5: Genuine confusion matrix count 1 in data cell (Zakareya col 4, row 4: count=1)
const confusionCountOne = isScientificNumericalMeasurement({
  normalizedNumericValue: 1,
  rawPrintedValue: "1",
  modelOrMethod: "Actual",
  headerPath: ["Col_4"],
  rowIdx: 4,
  colIdx: 4,
});
assert(confusionCountOne, "RETAIN_CONFUSION_COUNT_1", "Genuine confusion matrix count=1 in data cell is retained");

// Case 6: Genuine confusion matrix count 33 in data cell (Zakareya col 4, row 2)
const confusionCount33 = isScientificNumericalMeasurement({
  normalizedNumericValue: 33,
  rawPrintedValue: "33",
  modelOrMethod: "Predicted",
  headerPath: ["Col_4"],
  rowIdx: 2,
  colIdx: 4,
});
assert(confusionCount33, "RETAIN_CONFUSION_COUNT_33", "Genuine confusion matrix count=33 in data cell is retained");

// Case 7: Cohort label "Training Set" in data cell (Su et al.)
const cohortTrainingSet = isScientificNumericalMeasurement({
  normalizedNumericValue: null,
  rawPrintedValue: "Training Set",
  modelOrMethod: "LR",
  headerPath: ["Group"],
  rowIdx: 0,
  colIdx: 1,
});
assert(!cohortTrainingSet, "EXCLUDE_COHORT_TRAINING_SET", "Cohort label 'Training Set' is strictly excluded");

// Case 8: Cohort label with accidental numerical representation
const cohortWithNum = isScientificNumericalMeasurement({
  normalizedNumericValue: 1,
  rawPrintedValue: "Training Set",
  modelOrMethod: "LR",
  headerPath: ["Group"],
  rowIdx: 0,
  colIdx: 1,
});
assert(!cohortWithNum, "EXCLUDE_COHORT_WITH_NUM", "Cohort label with numeric value is strictly excluded via word list");

// Case 9: Multi-line column header "Voting" (Kim et al. Table 3 Row 0)
const headerVoting = isScientificNumericalMeasurement({
  normalizedNumericValue: null,
  rawPrintedValue: "Voting",
  modelOrMethod: "CNN",
  headerPath: ["Simple Voting"],
  rowIdx: 0,
  colIdx: 1,
});
assert(!headerVoting, "EXCLUDE_HEADER_VOTING", "Column header fragment 'Voting' is strictly excluded");

// Case 10: Multi-line column header "Averaging" (Kim et al. Table 3 Row 0)
const headerAveraging = isScientificNumericalMeasurement({
  normalizedNumericValue: null,
  rawPrintedValue: "Averaging",
  modelOrMethod: "CNN",
  headerPath: ["Weighted Averaging"],
  rowIdx: 0,
  colIdx: 2,
});
assert(!headerAveraging, "EXCLUDE_HEADER_AVERAGING", "Column header fragment 'Averaging' is strictly excluded");

// Case 11: Difficulty sub-header "Mod." (PointPillars Row 0)
const headerMod = isScientificNumericalMeasurement({
  normalizedNumericValue: null,
  rawPrintedValue: "Mod.",
  modelOrMethod: "(Hz)",
  headerPath: ["Unassigned"],
  rowIdx: 0,
  colIdx: 0,
});
assert(!headerMod, "EXCLUDE_HEADER_MOD", "Difficulty sub-header 'Mod.' is strictly excluded");

// Case 12: Difficulty sub-headers "Easy" and "Hard"
const headerEasy = isScientificNumericalMeasurement({
  normalizedNumericValue: null,
  rawPrintedValue: "Easy",
  modelOrMethod: "PointPillars",
  headerPath: ["Car"],
  rowIdx: 0,
  colIdx: 2,
});
const headerHard = isScientificNumericalMeasurement({
  normalizedNumericValue: null,
  rawPrintedValue: "Hard",
  modelOrMethod: "PointPillars",
  headerPath: ["Car"],
  rowIdx: 0,
  colIdx: 4,
});
assert(!headerEasy && !headerHard, "EXCLUDE_DIFFICULTY_HEADERS", "Difficulty sub-headers 'Easy' and 'Hard' are strictly excluded");

// Case 13: Categorical modality "Lidar & Img." (PointPillars)
const modalityLidarImg = isScientificNumericalMeasurement({
  normalizedNumericValue: null,
  rawPrintedValue: "Lidar & Img.",
  modelOrMethod: "MV3D [2]",
  headerPath: ["Modality"],
  rowIdx: 1,
  colIdx: 1,
});
assert(!modalityLidarImg, "EXCLUDE_MODALITY_LIDAR_IMG", "Categorical modality 'Lidar & Img.' is strictly excluded");

// Case 14: Categorical modality "Lidar" (PointPillars)
const modalityLidar = isScientificNumericalMeasurement({
  normalizedNumericValue: null,
  rawPrintedValue: "Lidar",
  modelOrMethod: "PointPillars",
  headerPath: ["Modality"],
  rowIdx: 10,
  colIdx: 1,
});
assert(!modalityLidar, "EXCLUDE_MODALITY_LIDAR", "Categorical modality 'Lidar' is strictly excluded");

// Case 15: Structural header row model "(Hz)"
const structuralHz = isScientificNumericalMeasurement({
  normalizedNumericValue: 62,
  rawPrintedValue: "62",
  modelOrMethod: "(Hz)",
  headerPath: ["Speed"],
  rowIdx: 0,
  colIdx: 1,
});
assert(!structuralHz, "EXCLUDE_STRUCTURAL_HZ_ROW", "Structural header row model '(Hz)' is strictly excluded");

// Case 16: Legitimate AUC measurement (Su et al. Table 2)
const genuineAuc = isScientificNumericalMeasurement({
  normalizedNumericValue: 0.896,
  rawPrintedValue: "0.896(0.845–0.947)",
  modelOrMethod: "LR",
  headerPath: ["AUC (95% CI)"],
  rowIdx: 0,
  colIdx: 2,
});
assert(genuineAuc, "RETAIN_GENUINE_AUC", "Legitimate AUC measurement 0.896 is retained");

// Case 17: Legitimate Accuracy measurement (ARU-Net Table 2)
const genuineAccuracy = isScientificNumericalMeasurement({
  normalizedNumericValue: 97.73,
  rawPrintedValue: "97.73",
  modelOrMethod: "ARU-Net",
  headerPath: ["Accuracy(%)"],
  unit: "PERCENT",
  rowIdx: 2,
  colIdx: 4,
});
assert(genuineAccuracy, "RETAIN_GENUINE_ACCURACY", "Legitimate accuracy measurement 97.73% is retained");

// Case 18: Legitimate mIOU measurement (ARU-Net Table 2)
const genuineMIou = isScientificNumericalMeasurement({
  normalizedNumericValue: 84.82,
  rawPrintedValue: "84.82",
  modelOrMethod: "ARU-Net",
  headerPath: ["mIOU(%)"],
  unit: "PERCENT",
  rowIdx: 2,
  colIdx: 0,
});
assert(genuineMIou, "RETAIN_GENUINE_MIOU", "Legitimate mIOU measurement 84.82% is retained");

// Case 19: Legitimate Ensemble Accuracy with STD (Kim et al. Table 3)
const genuineEnsemble = isScientificNumericalMeasurement({
  normalizedNumericValue: 0.939,
  rawPrintedValue: "0.939 ± 0.026",
  modelOrMethod: "ResNet-34",
  headerPath: ["Simple Voting"],
  rowIdx: 1,
  colIdx: 1,
});
assert(genuineEnsemble, "RETAIN_GENUINE_ENSEMBLE", "Legitimate ensemble accuracy 0.939 is retained");

// Case 20: Missing / NaN numerical value
const missingValue = isScientificNumericalMeasurement({
  normalizedNumericValue: null,
  rawPrintedValue: "-",
  modelOrMethod: "ARU-Net",
  headerPath: ["mIOU(%)"],
  rowIdx: 2,
  colIdx: 0,
});
assert(!missingValue, "EXCLUDE_MISSING_VALUE", "Missing or '-' value is strictly excluded");

console.log("\n================================================================================");
console.log(` SUMMARY: ${passed}/${passed + failed} Tests Passed (${((passed / (passed + failed)) * 100).toFixed(1)}%)`);
console.log("================================================================================\n");

if (failed > 0) {
  process.exit(1);
}
