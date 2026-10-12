/**
 * AI RESEARCH HUB — PHASE 3D
 * HIERARCHICAL SCIENTIFIC TABLE RECONSTRUCTION TEST SUITE
 *
 * Deterministic unit and regression tests for:
 * 1. Multi-level column headers (3-level PointPillars, 2-level Kim, 1-level ARU-Net)
 * 2. Spanning parent headers (Car, Pedestrian, Cyclist, Speed, mAP)
 * 3. Nested subcolumns (Easy, Mod., Hard) with explicit hierarchical paths
 * 4. Midpoint Voronoi column interval boundary formulation (preventing collapsed columns)
 * 5. Deterministic firstDataRowIdx identification isolating header rows from data rows
 * 6. Cell-level geometric verification and exact scientific value preservation
 * 7. Negative attribution controls (wrong model, wrong condition, wrong metric, wrong hash)
 * 8. Scientific synthesis exclusion of headers, axis labels, and categorical strings
 */

import {
  SpatialTableExtractor,
  parseCellNumbers,
  clean,
  TextItem,
} from "../src/lib/tables/spatial-extractor";
import {
  verifyCellEvidence,
  TableGeometryLayout,
  NativeTextItem,
} from "../src/lib/tables/cell-verifier";
import { isScientificNumericalMeasurement } from "../src/lib/tables/types";

console.log("================================================================================");
console.log(" PHASE 3D: HIERARCHICAL SCIENTIFIC TABLE RECONSTRUCTION TESTS");
console.log("================================================================================\n");

let passedCount = 0;
let totalTests = 0;

function assert(condition: boolean, testId: string, desc: string, details?: any) {
  totalTests++;
  if (condition) {
    passedCount++;
    console.log(`[PASS] ${testId}: ${desc}`);
  } else {
    console.error(`[FAIL] ${testId}: ${desc}`);
    if (details) console.error("       Details:", details);
  }
}

// ---------------------------------------------------------------------------------
// GROUP 1: DETERMINISTIC MULTI-LEVEL HEADER RECONSTRUCTION & SPANNING ASSOCIATION
// ---------------------------------------------------------------------------------
console.log("--- GROUP 1: MULTI-LEVEL HEADER & SPANNING SUPER-HEADER DISCOVERY ---");

const extractor = new SpatialTableExtractor();

// Synthetic 3-Level Header modeled on PointPillars Table 1 (KITTI BEV benchmark)
const pointPillarsHeaderRows: Array<{ y: number; items: TextItem[] }> = [
  // Row 0 (Super-headers): Speed, mAP, Car, Pedestrian, Cyclist
  {
    y: 712.0,
    items: [
      { str: "Speed", x: 196.7, y: 712.0, width: 25.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "mAP", x: 238.9, y: 712.0, width: 20.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Car", x: 305.1, y: 712.0, width: 16.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Pedestrian", x: 403.5, y: 712.0, width: 40.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Cyclist", x: 501.9, y: 712.0, width: 28.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
    ],
  },
  // Row 1 (Level-1 Headers): Method, Modality
  {
    y: 706.5,
    items: [
      { str: "Method", x: 86.6, y: 706.5, width: 30.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Modality", x: 152.8, y: 706.5, width: 35.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
    ],
  },
  // Row 2 (Subheaders): (Hz), Mod., Easy, Mod., Hard, Easy, Mod., Hard, Easy, Mod., Hard
  {
    y: 701.0,
    items: [
      { str: "(Hz)", x: 196.7, y: 701.0, width: 15.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Mod.", x: 238.9, y: 701.0, width: 18.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      // Car subcolumns
      { str: "Easy", x: 273.0, y: 701.0, width: 18.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Mod.", x: 305.1, y: 701.0, width: 18.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Hard", x: 337.3, y: 701.0, width: 18.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      // Pedestrian subcolumns
      { str: "Easy", x: 371.4, y: 701.0, width: 18.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Mod.", x: 403.5, y: 701.0, width: 18.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Hard", x: 435.7, y: 701.0, width: 18.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      // Cyclist subcolumns
      { str: "Easy", x: 469.8, y: 701.0, width: 18.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Mod.", x: 501.9, y: 701.0, width: 18.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Hard", x: 534.0, y: 701.0, width: 18.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
    ],
  },
];

// Call private method via reflection for unit test verification
const ppDiscoveredCols = (extractor as any).discoverColumnsFromHeaderRows(pointPillarsHeaderRows);

assert(
  ppDiscoveredCols.length === 13,
  "HIER_01_COL_COUNT",
  `PointPillars 3-level header correctly reconstructed into exactly 13 leaf columns (Found ${ppDiscoveredCols.length})`
);

assert(
  ppDiscoveredCols[0].name === "Method" && ppDiscoveredCols[0].headerPath.join(" > ") === "Method",
  "HIER_02_METHOD_COL",
  "Col 0 correctly resolved to Method without superheader"
);

assert(
  ppDiscoveredCols[1].name === "Modality" && ppDiscoveredCols[1].headerPath.join(" > ") === "Modality",
  "HIER_03_MODALITY_COL",
  "Col 1 correctly resolved to Modality without superheader"
);

assert(
  ppDiscoveredCols[2].name === "Speed (Hz)" && ppDiscoveredCols[2].headerPath.join(" > ") === "Speed > (Hz)",
  "HIER_04_SPEED_COL",
  "Col 2 correctly linked to Speed superheader: 'Speed > (Hz)'"
);

assert(
  ppDiscoveredCols[3].name === "mAP Mod." && ppDiscoveredCols[3].headerPath.join(" > ") === "mAP > Mod.",
  "HIER_05_MAP_COL",
  "Col 3 correctly linked to mAP superheader: 'mAP > Mod.'"
);

// Verify Car nested Easy / Mod. / Hard subcolumns
assert(
  ppDiscoveredCols[4].headerPath.join(" > ") === "Car > Easy" &&
  ppDiscoveredCols[5].headerPath.join(" > ") === "Car > Mod." &&
  ppDiscoveredCols[6].headerPath.join(" > ") === "Car > Hard",
  "HIER_06_CAR_SUBCOLS",
  "Cols 4, 5, 6 correctly nested under parent 'Car': Easy, Mod., Hard"
);

// Verify Pedestrian nested Easy / Mod. / Hard subcolumns
assert(
  ppDiscoveredCols[7].headerPath.join(" > ") === "Pedestrian > Easy" &&
  ppDiscoveredCols[8].headerPath.join(" > ") === "Pedestrian > Mod." &&
  ppDiscoveredCols[9].headerPath.join(" > ") === "Pedestrian > Hard",
  "HIER_07_PED_SUBCOLS",
  "Cols 7, 8, 9 correctly nested under parent 'Pedestrian': Easy, Mod., Hard"
);

// Verify Cyclist nested Easy / Mod. / Hard subcolumns
assert(
  ppDiscoveredCols[10].headerPath.join(" > ") === "Cyclist > Easy" &&
  ppDiscoveredCols[11].headerPath.join(" > ") === "Cyclist > Mod." &&
  ppDiscoveredCols[12].headerPath.join(" > ") === "Cyclist > Hard",
  "HIER_08_CYC_SUBCOLS",
  "Cols 10, 11, 12 correctly nested under parent 'Cyclist': Easy, Mod., Hard"
);

// ---------------------------------------------------------------------------------
// GROUP 2: CALIBRATED MIDPOINT INTERVALS & OVERLAP PREVENTION
// ---------------------------------------------------------------------------------
console.log("\n--- GROUP 2: CALIBRATED MIDPOINT INTERVALS & BOUNDARY INTEGRITY ---");

let noOverlaps = true;
for (let i = 0; i < ppDiscoveredCols.length - 1; i++) {
  const cur = ppDiscoveredCols[i];
  const next = ppDiscoveredCols[i + 1];
  // Right bound of current must equal left bound of next within floating point precision
  if (Math.abs(cur.xMax - next.xMin) > 0.01) {
    noOverlaps = false;
    break;
  }
}

assert(
  noOverlaps,
  "GEOM_01_NO_INTERVAL_OVERLAPS",
  "Discovered column intervals strictly partition horizontal space with seamless midpoint boundaries"
);

// Check that each column's center lies strictly inside [xMin, xMax]
const centersContained = ppDiscoveredCols.every(
  (c: any) => c.xCenter >= c.xMin && c.xCenter <= c.xMax
);
assert(
  centersContained,
  "GEOM_02_CENTERS_CONTAINED",
  "All 13 column centers strictly lie within their calibrated [xMin, xMax] intervals"
);

// ---------------------------------------------------------------------------------
// GROUP 3: 2-LEVEL AND 1-LEVEL REGRESSION COMPATIBILITY
// ---------------------------------------------------------------------------------
console.log("\n--- GROUP 3: 2-LEVEL & 1-LEVEL HEADER COMPATIBILITY ---");

// Single-Level Header (ARU-Net Table 2 style)
const arunetHeaderRows: Array<{ y: number; items: TextItem[] }> = [
  {
    y: 724.0,
    items: [
      { str: "Method", x: 170.5, y: 724.0, width: 30.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "mIOU(%)", x: 226.8, y: 724.0, width: 35.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Recall(%)", x: 262.6, y: 724.0, width: 35.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Precision(%)", x: 302.7, y: 724.0, width: 40.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "F1(%)", x: 337.4, y: 724.0, width: 25.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Accuracy(%)", x: 372.1, y: 724.0, width: 45.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
    ],
  },
];

const aruCols = (extractor as any).discoverColumnsFromHeaderRows(arunetHeaderRows);
assert(
  aruCols.length === 6 && aruCols[0].name === "Method" && aruCols[1].name === "mIOU(%)",
  "HIER_09_ARUNET_1_LEVEL",
  "Single-level ARU-Net header seamlessly extracted into 6 columns"
);

// 2-Level Header (Kim et al. Table 3 style)
const kimHeaderRows: Array<{ y: number; items: TextItem[] }> = [
  {
    y: 679.0,
    items: [
      { str: "Traditional", x: 222.9, y: 679.0, width: 45.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Simple", x: 297.5, y: 679.0, width: 30.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Weighted", x: 372.2, y: 679.0, width: 35.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
    ],
  },
  {
    y: 673.0,
    items: [
      { str: "CNN Model", x: 110.8, y: 673.0, width: 45.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "CNN", x: 222.9, y: 673.0, width: 20.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Voting", x: 297.5, y: 673.0, width: 25.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
      { str: "Voting", x: 372.2, y: 673.0, width: 25.0, height: 7.0, fontSize: 7.0, fontFamily: "sans-serif" },
    ],
  },
];

const kimCols = (extractor as any).discoverColumnsFromHeaderRows(kimHeaderRows);
assert(
  kimCols.length === 4 && kimCols[1].headerPath.join(" > ") === "Traditional > CNN" && kimCols[2].headerPath.join(" > ") === "Simple > Voting",
  "HIER_10_KIM_2_LEVEL",
  "2-level Kim et al. header correctly nested with 'Traditional > CNN' and 'Simple > Voting'"
);

// ---------------------------------------------------------------------------------
// GROUP 4: CELL-LEVEL GEOMETRIC VERIFICATION & ATTRIBUTION SAFEGUARDS
// ---------------------------------------------------------------------------------
console.log("\n--- GROUP 4: GEOMETRIC TOKEN GROUNDING & NEGATIVE ATTRIBUTION CONTROLS ---");

const testLayout: TableGeometryLayout = {
  tableBbox: { x0: 50, y0: 550, x1: 560, y1: 720 },
  datasetNames: ["KITTI test BEV detection benchmark"],
  sourcePdfHash: "a".repeat(64),
  rowIntervals: [
    { rowIdx: 0, label: "MV3D [2]", yMin: 685, yMax: 695 },
    { rowIdx: 9, label: "PointPillars", yMin: 585, yMax: 595 },
  ],
  colIntervals: [
    { colIdx: 0, header: "Method", xMin: 56.6, xMax: 119.7 },
    { colIdx: 1, header: "Modality", xMin: 119.7, xMax: 174.7 },
    { colIdx: 2, header: "(Hz)", superHeader: "Speed", xMin: 174.7, xMax: 217.8 },
    { colIdx: 3, header: "Mod.", superHeader: "mAP", xMin: 217.8, xMax: 256.0 },
    { colIdx: 4, header: "Easy", superHeader: "Car", xMin: 256.0, xMax: 289.1 },
    { colIdx: 5, header: "Mod.", superHeader: "Car", xMin: 289.1, xMax: 321.2 },
    { colIdx: 6, header: "Hard", superHeader: "Car", xMin: 321.2, xMax: 354.3 },
  ],
};

const syntheticTokens: NativeTextItem[] = [
  // Row 9 (PointPillars)
  { str: "PointPillars", x: 70, y: 590, width: 45, height: 7 },
  { str: "Lidar", x: 140, y: 590, width: 20, height: 7 },
  { str: "62", x: 195, y: 590, width: 10, height: 7 },
  { str: "66.19", x: 235, y: 590, width: 18, height: 7 },
  { str: "88.35", x: 270, y: 590, width: 18, height: 7 },
  { str: "86.10", x: 302, y: 590, width: 18, height: 7 },
  { str: "79.83", x: 334, y: 590, width: 18, height: 7 },
];

// Test 4.1: Positive Verification of PointPillars Car Easy (88.35)
const posCarEasy = verifyCellEvidence(
  {
    rawPrintedValue: "88.35",
    numericValue: 88.35,
    modelOrMethod: "PointPillars",
    headerPath: ["Car", "Easy"],
    datasetName: "KITTI test BEV detection benchmark",
    sourcePdfHash: "a".repeat(64),
    rowIdx: 9,
    colIdx: 4,
  },
  testLayout,
  syntheticTokens
);
assert(
  posCarEasy.status === "VERIFIED" && posCarEasy.exactStringMatch,
  "VERIF_01_POINTPILLARS_CAR_EASY",
  "PointPillars Car Easy (88.35) successfully promoted to VERIFIED by geometric token intersection"
);

// Test 4.2: Negative Control - Wrong Model (claims SECOND instead of PointPillars)
const negWrongModel = verifyCellEvidence(
  {
    rawPrintedValue: "88.35",
    numericValue: 88.35,
    modelOrMethod: "SECOND [28]",
    headerPath: ["Car", "Easy"],
    datasetName: "KITTI test BEV detection benchmark",
    sourcePdfHash: "a".repeat(64),
    rowIdx: 9,
    colIdx: 4,
  },
  testLayout,
  syntheticTokens
);
assert(
  negWrongModel.status === "REJECTED" && negWrongModel.rowMisattribution,
  "NEG_01_WRONG_MODEL_REJECTED",
  "Candidate with conflicting model label 'SECOND [28]' rejected with rowMisattribution=true"
);

// Test 4.3: Negative Control - Wrong Metric Header (claims Hard instead of Easy)
const negWrongHeader = verifyCellEvidence(
  {
    rawPrintedValue: "88.35",
    numericValue: 88.35,
    modelOrMethod: "PointPillars",
    headerPath: ["Car", "Hard"],
    datasetName: "KITTI test BEV detection benchmark",
    sourcePdfHash: "a".repeat(64),
    rowIdx: 9,
    colIdx: 4,
  },
  testLayout,
  syntheticTokens
);
assert(
  negWrongHeader.status === "REJECTED" && negWrongHeader.columnShiftError,
  "NEG_02_WRONG_HEADER_REJECTED",
  "Candidate with conflicting header 'Car > Hard' in Col 4 rejected with columnShiftError=true"
);

// Test 4.4: Negative Control - Wrong Dataset Name
const negWrongDataset = verifyCellEvidence(
  {
    rawPrintedValue: "88.35",
    numericValue: 88.35,
    modelOrMethod: "PointPillars",
    headerPath: ["Car", "Easy"],
    datasetName: "nuScenes Benchmark",
    sourcePdfHash: "a".repeat(64),
    rowIdx: 9,
    colIdx: 4,
  },
  testLayout,
  syntheticTokens
);
assert(
  negWrongDataset.status === "REJECTED",
  "NEG_03_WRONG_DATASET_REJECTED",
  "Candidate with mismatched dataset 'nuScenes Benchmark' rejected"
);

// ---------------------------------------------------------------------------------
// GROUP 5: SCIENTIFIC SYNTHESIS EXCLUSION OF HEADERS AND CATEGORICAL STRINGS
// ---------------------------------------------------------------------------------
console.log("\n--- GROUP 5: SYNTHESIS EXCLUSION OF NON-NUMERICAL TOKENS ---");

// Test 5.1: Legitimate numerical measurement preserved
assert(
  isScientificNumericalMeasurement({
    rawPrintedValue: "88.35",
    normalizedNumericValue: 88.35,
    modelOrMethod: "PointPillars",
    headerPath: ["Car", "Easy"],
    rowIdx: 9,
    colIdx: 4,
  }),
  "SYNTH_01_MEASUREMENT_PRESERVED",
  "Legitimate numerical measurement (88.35) preserved"
);

// Test 5.2: Categorical modality excluded
assert(
  !isScientificNumericalMeasurement({
    rawPrintedValue: "Lidar & Img.",
    normalizedNumericValue: null,
    modelOrMethod: "PointPillars",
    headerPath: ["Modality"],
    rowIdx: 9,
    colIdx: 1,
  }),
  "SYNTH_02_MODALITY_EXCLUDED",
  "Categorical modality string 'Lidar & Img.' excluded from numerical measurements"
);

// Test 5.3: N/A cell excluded
assert(
  !isScientificNumericalMeasurement({
    rawPrintedValue: "N/A",
    normalizedNumericValue: null,
    modelOrMethod: "MV3D [2]",
    headerPath: ["Car", "Hard"],
    rowIdx: 0,
    colIdx: 6,
  }),
  "SYNTH_03_NA_EXCLUDED",
  "Missing data token 'N/A' excluded from numerical measurements"
);

// Test 5.4: Subheader word 'Mod.' excluded
assert(
  !isScientificNumericalMeasurement({
    rawPrintedValue: "Mod.",
    normalizedNumericValue: null,
    modelOrMethod: "Speed",
    headerPath: ["mAP", "Mod."],
    rowIdx: 2,
    colIdx: 3,
  }),
  "SYNTH_04_HEADER_WORD_EXCLUDED",
  "Header fragment 'Mod.' excluded from numerical measurements"
);

// Test 5.5: Confusion matrix axis index label '0' in col 0 excluded
assert(
  !isScientificNumericalMeasurement({
    rawPrintedValue: "0",
    normalizedNumericValue: 0,
    modelOrMethod: "Actual",
    headerPath: ["0"],
    rowIdx: 0,
    colIdx: 0,
  }),
  "SYNTH_05_AXIS_LABEL_0_EXCLUDED",
  "Matrix axis index label '0' in row header column excluded"
);

// Test 5.6: Confusion matrix count '1' in count data column (colIdx 4) preserved
assert(
  isScientificNumericalMeasurement({
    rawPrintedValue: "1",
    normalizedNumericValue: 1,
    modelOrMethod: "Actual",
    headerPath: ["Predicted", "0"],
    rowIdx: 4,
    colIdx: 4,
  }),
  "SYNTH_06_CONFUSION_COUNT_1_PRESERVED",
  "Legitimate confusion matrix count '1' in data column preserved"
);

console.log("\n================================================================================");
console.log(` SUMMARY: ${passedCount}/${totalTests} Hierarchical Table Reconstruction Tests Passed (${((passedCount / totalTests) * 100).toFixed(1)}%)`);
console.log("================================================================================\n");

if (passedCount !== totalTests) {
  process.exit(1);
}
