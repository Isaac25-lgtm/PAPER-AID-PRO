/**
 * AI RESEARCH HUB — SCIENTIFIC TABLE EVIDENCE CONTRACTS
 *
 * Defines canonical data structures for verifiable, zero-hallucination table extraction.
 * Preserves verbatim extracted manuscript text separately from normalized representations.
 * Maintains full multi-level provenance: page, table bbox, cell bbox, token IDs, crop reference.
 */

export type VerificationStatus =
  | "UNVERIFIED"                // Default: Raw candidate awaiting verification. Never promoted implicitly.
  | "VERIFIED"                  // Strict geometric token intersection + verbatim string match + semantic header alignment
  | "UNVERIFIED_VISUAL_ONLY"    // Extracted from visual raster image where native vector text tokens are absent
  | "AMBIGUOUS"                 // Multiple competing spatial candidates or unresolved coordinate splits
  | "DISAGREEMENT"              // Explicit conflict between spatial text stream and visual OCR in the same cell box
  | "REJECTED";                 // Failed validation (transcription drift, boundary misalignment, attribution error)

export type ExtractionMethod =
  | "SPATIAL_2D"                // Phase 3A deterministic geometric clustering
  | "VISION_MULTIMODAL"         // Multimodal vision inference (e.g. gpt-4o-mini)
  | "HYBRID_RECONCILED";        // Phase 3B/3C vision structure + spatial token corroboration

export type MetricUnit =
  | "PERCENT"
  | "RATIO"
  | "COUNT"
  | "HERTZ"
  | "MILLISECONDS"
  | "DECIBELS"
  | "UNSPECIFIED";

export interface BoundingBox {
  x0: number; // Left coordinate in PDF points
  y0: number; // Bottom or top coordinate in PDF points
  x1: number; // Right coordinate in PDF points
  y1: number; // Top or bottom coordinate in PDF points
}

export interface CellSourceProvenance {
  paperId: string;
  pageNumber: number;
  tableId: string;
  tableBbox: BoundingBox;
  cellBbox?: BoundingBox;
  rowInterval?: [number, number];   // [yMin, yMax] in PDF points
  colInterval?: [number, number];   // [xMin, xMax] in PDF points
  verbatimPdfTokens?: string[];      // Exact TextItem.str tokens inside this cell's physical bounding box
  cropImageUri?: string;            // Supabase storage URI or local artifact path for table crop
  sourcePdfHash?: string;           // SHA-256 hash of original PDF manuscript
  extractionVersion: string;        // e.g. "hybrid-v1.0"
}

export interface HeaderHierarchy {
  superHeaders: string[];           // Top-level spanning categories (e.g., ["Car", "Pedestrian", "Cyclist"])
  columnHeaders: string[];          // Column headers (e.g., ["Easy", "Mod.", "Hard"])
  rowHeaders: string[];             // Primary row labels (e.g., models or methods)
  subrowHeaders?: string[];         // Secondary row labels (e.g., ["Accuracy", "STD"] or ["Training", "Validation"])
}

export interface TableCellEvidence {
  cellId: string;
  rowIdx: number;
  colIdx: number;
  rowSpan?: number;
  colSpan?: number;

  // Verbatim Text & Numerical Representation
  rawPrintedValue: string;          // Verbatim OCR or text token string (e.g. "88.35", "0.896(0.845–0.947)")
  normalizedNumericValue: number | null; // Clean parsed float (e.g. 88.35, 0.896), null for N/A or text
  confidenceInterval?: [number, number] | null; // e.g. [0.845, 0.947]
  standardDeviation?: number | null; // e.g. 0.026
  unit: MetricUnit;
  scale?: string;                   // e.g. "x10^-2"
  isMissingOrNa: boolean;           // True if printed as "-", "N/A", "None", or empty
  footnoteReferences: string[];     // e.g. ["*", "a", "1"]

  // Semantic Attribution
  modelOrMethod: string;            // e.g. "PointPillars", "ResNet-34", "DT"
  groupOrSubrow?: string;           // e.g. "Validation Set", "Accuracy"
  datasetOrCohort?: string;         // e.g. "KITTI BEV", "Cairo Ultrasound"
  experimentalCondition?: string;   // e.g. "3D BEV", "Entropy + Phase"
  headerPath: string[];             // e.g. ["Car", "Mod."] or ["Traditional CNN"]

  // Source Grounding & Verification
  provenance: CellSourceProvenance;
  verificationStatus: VerificationStatus;
  verificationMethod: "GEOMETRIC_TOKEN_INTERSECTION" | "RASTER_IMAGE_INFERENCE" | "UNVERIFIED";
  verificationNotes?: string;
}

export interface TableRowEvidence {
  rowIdx: number;
  modelOrMethod: string;
  groupOrSubrow?: string;
  dataset?: string;
  cells: TableCellEvidence[];
}

export interface PaperTableEvidence {
  tableId: string;
  paperId: string;
  pageNumber: number;
  multiPageContinuation?: boolean;
  caption: string;
  tableNumber: string;              // e.g. "Table 1", "Table 3"
  datasetNames: string[];
  headerHierarchy: HeaderHierarchy;
  rows: TableRowEvidence[];
  footnotes: string[];
  sourcePdfHash: string;
  extractionEngine: "HYBRID_SPATIAL_VISION_V1";
  extractionVersion: string;
  extractedAt: string;
}

/**
 * Determines whether a verified table cell represents a legitimate scientific
 * numerical measurement, strictly distinguishing measurements from:
 * 1. Text headers and multi-line column header fragments (e.g. "Voting", "Averaging", "Mod.")
 * 2. Categorical metadata values (e.g. "Training Set", "Lidar & Img.", "Lidar")
 * 3. Classification / confusion-matrix axis indices (e.g. "0", "1")
 */
export function isScientificNumericalMeasurement(cell: {
  normalizedNumericValue: number | null;
  rawPrintedValue: string;
  modelOrMethod: string;
  headerPath?: string[];
  unit?: string;
  rowIdx?: number;
  colIdx?: number;
}): boolean {
  // 1. Must possess a valid normalized numerical value
  if (
    cell.normalizedNumericValue === null ||
    typeof cell.normalizedNumericValue !== "number" ||
    isNaN(cell.normalizedNumericValue)
  ) {
    return false;
  }

  const raw = cell.rawPrintedValue.trim().toLowerCase();
  const model = cell.modelOrMethod.trim().toLowerCase();
  const headers = (cell.headerPath || []).map((h) => h.trim().toLowerCase());
  const rowIdx = cell.rowIdx ?? 0;
  const colIdx = cell.colIdx ?? 0;

  // 2. Reject table header/axis label rows where modelOrMethod is a non-model structural header
  const nonModelHeaders = ["(hz)", "cnn", "unassigned"];
  if (nonModelHeaders.some((s) => model === s || model.startsWith(s + " "))) {
    return false;
  }

  // 3. Reject classification / matrix axis index cells and row/col header positions
  // Numeric-looking class labels (e.g. "0" and "1") in header rows or header/index columns
  const isZeroOrOne = raw === "0" || raw === "1";
  if (isZeroOrOne) {
    // If it's in the header row (rowIdx <= 1) or in the row header column (colIdx <= 3)
    if (rowIdx <= 1 || colIdx <= 3) {
      return false;
    }
    // Or if header explicitly denotes a class index
    if (headers.some((h) => h === "class" || h === "index" || h === "label")) {
      return false;
    }
  }

  // 4. Reject multi-line column header words or difficulty labels
  const nonMetricWords = [
    "voting",
    "averaging",
    "mod.",
    "easy",
    "hard",
    "training set",
    "validation set",
    "modality",
    "lidar",
    "lidar & img.",
    "lidar & map",
  ];
  if (nonMetricWords.includes(raw)) {
    return false;
  }

  // 5. Reject if column header explicitly indicates categorical grouping or modality
  if (headers.some((h) => h === "group" || h === "modality" || h === "method" || h === "model")) {
    return false;
  }

  return true;
}
