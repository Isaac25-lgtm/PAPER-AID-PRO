/**
 * AI RESEARCH HUB — SOURCE-GROUNDED CELL-LEVEL VERIFICATION ENGINE
 *
 * Replaces naive page-wide text matching with strict physical geometric cell intersection.
 * Validates that every numerical cell token physically resides within the table's
 * row vertical span and column horizontal span on the source PDF page.
 *
 * Guarantees zero false-acceptance on repeated numbers, column shifts, and narrative leaks.
 */

import {
  TableCellEvidence,
  VerificationStatus,
  BoundingBox,
} from "./types";

export interface NativeTextItem {
  str: string;
  x: number;      // PDF points
  y: number;      // PDF points
  width: number;  // PDF points
  height: number; // PDF points
}

export interface TableGeometryLayout {
  tableBbox: BoundingBox;
  datasetNames?: string[];
  sourcePdfHash?: string;
  rowIntervals: Array<{
    rowIdx: number;
    label: string;
    sublabel?: string;
    yMin: number;
    yMax: number;
  }>;
  colIntervals: Array<{
    colIdx: number;
    header: string;
    superHeader?: string;
    xMin: number;
    xMax: number;
  }>;
}

export interface VerificationResult {
  status: VerificationStatus;
  method: "GEOMETRIC_TOKEN_INTERSECTION" | "RASTER_IMAGE_INFERENCE" | "UNVERIFIED";
  matchedTokens: string[];
  exactStringMatch: boolean;
  transcriptionError: boolean;
  rowMisattribution: boolean;
  columnShiftError: boolean;
  narrativeLeakError: boolean;
  notes: string;
}

/**
 * Normalizes Unicode typographic variants, spaces, and separators to standard ASCII scientific format.
 * - Converts Unicode minus (− \u2212) and typographic dashes (– \u2013, — \u2014) to standard ASCII hyphens (-)
 * - Normalizes non-breaking spaces (\u00A0, \u202F, \u2007) to standard spaces
 * - Strips thousands separator commas inside numeric blocks (e.g. "1,000" -> "1000")
 * - Normalizes leading zeros (e.g. ".915" -> "0.915", "-.05" -> "-0.05")
 * - Collapses repeated whitespaces
 */
export function normalizeScientificString(str: string): string {
  if (!str) return "";
  let s = str
    .replace(/[\u2212\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/[\u00A0\u202F\u2007\u2009\u200A]/g, " ")
    .replace(/(?<=\d),(?=\d)/g, "") // remove thousands commas e.g. 1,000 -> 1000
    .replace(/(?<=^|[^0-9])\.(\d+)/g, "0.$1") // .915 -> 0.915
    .replace(/(?<=^|[^0-9])-0*0\.(\d+)/g, "-0.$1")
    .trim();
  // Clean spaces around range hyphens inside parens e.g. "(0.845 - 0.947)" -> "(0.845-0.947)"
  s = s.replace(/\(\s*([0-9.-]+)\s*-\s*([0-9.-]+)\s*\)/g, "($1-$2)");
  return s;
}

/**
 * Evaluates whether a candidate raw value matches any local cell text tokens under strict scientific equivalence.
 * Prohibits unrestricted floating-point tolerances or precision loss (e.g. 88.35 != 88.4 or 88.53).
 */
export function isScientificValueEquivalent(
  candidateRaw: string,
  candidateNum: number | null,
  localTokens: string[]
): { isEquivalent: boolean; matchedForm: string | null } {
  const normCand = normalizeScientificString(candidateRaw);
  const cleanCand = normCand.replace(/\s+/g, "");

  // 1. Direct tokens check
  for (const t of localTokens) {
    const normT = normalizeScientificString(t);
    const cleanT = normT.replace(/\s+/g, "");
    if (cleanCand === cleanT) {
      return { isEquivalent: true, matchedForm: t };
    }
    // Also check single number equivalence (leading/trailing zeros) e.g. "62" vs "62.0"
    const parsedCand = parseFloat(cleanCand);
    const parsedT = parseFloat(cleanT);
    if (!isNaN(parsedCand) && !isNaN(parsedT) && parsedCand === parsedT) {
      // Check that this is pure trailing zero difference (e.g. 62.0 vs 62 or 88.35 vs 88.350)
      // and NOT precision truncation (e.g. 88.35 vs 88.4)
      const candDec = cleanCand.includes(".") ? cleanCand.split(".")[1].replace(/0+$/, "") : "";
      const tDec = cleanT.includes(".") ? cleanT.split(".")[1].replace(/0+$/, "") : "";
      if (candDec === tDec) {
        return { isEquivalent: true, matchedForm: t };
      }
    }
  }

  // 2. Concatenated / merged tokens check (for multi-token cells e.g. ["0.896", "(", "0.845", "–", "0.947", ")"])
  const mergedNoSpace = normalizeScientificString(localTokens.join("")).replace(/\s+/g, "");
  const mergedWithSpace = normalizeScientificString(localTokens.join(" "));

  if (mergedNoSpace === cleanCand) {
    return { isEquivalent: true, matchedForm: mergedNoSpace };
  }
  if (mergedWithSpace === normCand) {
    return { isEquivalent: true, matchedForm: mergedWithSpace };
  }

  // Discrete scientific token boundary check (e.g. primary value "0.896" inside "0.896(0.845-0.947)")
  // Strictly prevents loose substring false positives (e.g. "1" or "0" matching inside "0.814")
  const escapedCand = cleanCand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const discreteNumberRegex = new RegExp(`(?<![0-9.])${escapedCand}(?![0-9.])`);
  if (discreteNumberRegex.test(mergedNoSpace)) {
    return { isEquivalent: true, matchedForm: mergedNoSpace };
  }
  if (discreteNumberRegex.test(mergedWithSpace)) {
    return { isEquivalent: true, matchedForm: mergedWithSpace };
  }

  return { isEquivalent: false, matchedForm: null };
}

/**
 * Checks whether an (x, y) point lies inside a bounding box with tolerance.
 */
function isInsideBox(
  x: number,
  y: number,
  box: BoundingBox,
  tolX = 3.0,
  tolY = 3.0
): boolean {
  const minX = Math.min(box.x0, box.x1) - tolX;
  const maxX = Math.max(box.x0, box.x1) + tolX;
  const minY = Math.min(box.y0, box.y1) - tolY;
  const maxY = Math.max(box.y0, box.y1) + tolY;
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

/**
 * Strict Cell-Level Verifier.
 * Evaluates candidate cell against physical PDF tokens and geometric layout.
 */
export function verifyCellEvidence(
  candidate: {
    rawPrintedValue: string;
    numericValue: number | null;
    modelOrMethod: string;
    groupOrSubrow?: string;
    datasetName?: string;
    sourcePdfHash?: string;
    headerPath: string[];
    rowIdx: number;
    colIdx: number;
  },
  layout: TableGeometryLayout,
  pageItems: NativeTextItem[]
): VerificationResult {
  const cleanCandidateRaw = candidate.rawPrintedValue.trim();
  const cleanCandNum = candidate.numericValue;

  // 1. Locate Row & Column Interval in Layout
  const rowLayout = layout.rowIntervals.find((r) => r.rowIdx === candidate.rowIdx);
  const colLayout = layout.colIntervals.find((c) => c.colIdx === candidate.colIdx);

  if (!rowLayout || !colLayout) {
    return {
      status: "REJECTED",
      method: "UNVERIFIED",
      matchedTokens: [],
      exactStringMatch: false,
      transcriptionError: false,
      rowMisattribution: !rowLayout,
      columnShiftError: !colLayout,
      narrativeLeakError: false,
      notes: `Geometric grid indices [row=${candidate.rowIdx}, col=${candidate.colIdx}] not found in table layout.`,
    };
  }

  // Cell Bounding Box: Intersection of row vertical span and col horizontal span
  // 0. Provenance Pre-check: Source PDF Hash
  if (candidate.sourcePdfHash && layout.sourcePdfHash && candidate.sourcePdfHash !== layout.sourcePdfHash) {
    return {
      status: "REJECTED",
      method: "UNVERIFIED",
      matchedTokens: [],
      exactStringMatch: false,
      transcriptionError: true,
      rowMisattribution: false,
      columnShiftError: false,
      narrativeLeakError: false,
      notes: `Source PDF hash mismatch: Candidate refers to hash '${candidate.sourcePdfHash}', layout has '${layout.sourcePdfHash}'.`,
    };
  }

  // 0b. Dataset Attribution Pre-check
  if (candidate.datasetName && layout.datasetNames && layout.datasetNames.length > 0) {
    const normCandDs = candidate.datasetName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const dsMatches = layout.datasetNames.some((d) => {
      const normD = d.toLowerCase().replace(/[^a-z0-9]/g, "");
      return normCandDs.includes(normD) || normD.includes(normCandDs);
    });
    if (!dsMatches) {
      return {
        status: "REJECTED",
        method: "UNVERIFIED",
        matchedTokens: [],
        exactStringMatch: false,
        transcriptionError: false,
        rowMisattribution: true,
        columnShiftError: false,
        narrativeLeakError: false,
        notes: `Dataset attribution mismatch: Candidate claims dataset '${candidate.datasetName}', but table dataset is '${layout.datasetNames.join(", ")}'.`,
      };
    }
  }

  // Cell Bounding Box: Intersection of row vertical span and col horizontal span
  const cellBox: BoundingBox = {
    x0: colLayout.xMin,
    x1: colLayout.xMax,
    y0: rowLayout.yMin,
    y1: rowLayout.yMax,
  };

  // 2. Collect Physical Tokens Inside Cell Box
  const localTokens = pageItems.filter((it) =>
    it.str && isInsideBox(it.x, it.y, cellBox, 4.0, 3.5)
  );
  const localStrings = localTokens.map((t) => t.str.trim()).filter(Boolean);

  // 3. Check Exact String and Number Match inside Local Cell Box with scientific equivalence
  const equivCheck = isScientificValueEquivalent(cleanCandidateRaw, cleanCandNum, localStrings);
  const hasExactLocalMatch = equivCheck.isEquivalent;

  // If matched inside cell box:
  if (hasExactLocalMatch) {
    // Check if model / header attribution aligns with layout labels
    const normCandModel = candidate.modelOrMethod.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normLayoutRow = (rowLayout.label + " " + (rowLayout.sublabel || "")).toLowerCase().replace(/[^a-z0-9]/g, "");

    const modelMatches =
      normCandModel === normLayoutRow ||
      normCandModel.includes(normLayoutRow) ||
      normLayoutRow.includes(normCandModel) ||
      normCandModel.length <= 2; // e.g. "0" or "1" matrix indices

    if (!modelMatches) {
      return {
        status: "REJECTED",
        method: "GEOMETRIC_TOKEN_INTERSECTION",
        matchedTokens: localStrings,
        exactStringMatch: false,
        transcriptionError: false,
        rowMisattribution: true,
        columnShiftError: false,
        narrativeLeakError: false,
        notes: `Cell value exists in cell box but row label '${rowLayout.label}' conflicts with candidate model '${candidate.modelOrMethod}'.`,
      };
    }

    // Check experimental condition / subrow attribution
    if (candidate.groupOrSubrow && rowLayout.sublabel) {
      const normCandGroup = candidate.groupOrSubrow.toLowerCase().replace(/[^a-z0-9]/g, "");
      const normLayoutGroup = rowLayout.sublabel.toLowerCase().replace(/[^a-z0-9]/g, "");
      const groupMatches =
        normLayoutGroup.includes(normCandGroup) ||
        normCandGroup.includes(normLayoutGroup);
      if (!groupMatches) {
        return {
          status: "REJECTED",
          method: "GEOMETRIC_TOKEN_INTERSECTION",
          matchedTokens: localStrings,
          exactStringMatch: false,
          transcriptionError: false,
          rowMisattribution: true,
          columnShiftError: false,
          narrativeLeakError: false,
          notes: `Cell value exists in cell box but row condition '${rowLayout.sublabel}' conflicts with candidate condition '${candidate.groupOrSubrow}'.`,
        };
      }
    }

    // Check column header / metric attribution
    if (candidate.headerPath && candidate.headerPath.length > 0) {
      const normCandHeaders = candidate.headerPath
        .map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""))
        .filter(Boolean);
      const normLayoutCol = (colLayout.header + " " + (colLayout.superHeader || ""))
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

      const headerMatches = normCandHeaders.some(
        (h) =>
          normLayoutCol.includes(h) ||
          h.includes(normLayoutCol) ||
          normLayoutCol.startsWith("col")
      );

      if (!headerMatches && normCandHeaders.length > 0 && !normLayoutCol.startsWith("col")) {
        return {
          status: "REJECTED",
          method: "GEOMETRIC_TOKEN_INTERSECTION",
          matchedTokens: localStrings,
          exactStringMatch: false,
          transcriptionError: false,
          rowMisattribution: false,
          columnShiftError: true,
          narrativeLeakError: false,
          notes: `Cell value exists in cell box but column header '${colLayout.header}' conflicts with candidate header '${candidate.headerPath.join(" > ")}'.`,
        };
      }
    }

    return {
      status: "VERIFIED",
      method: "GEOMETRIC_TOKEN_INTERSECTION",
      matchedTokens: localStrings,
      exactStringMatch: true,
      transcriptionError: false,
      rowMisattribution: false,
      columnShiftError: false,
      narrativeLeakError: false,
      notes: `Verified by physical token intersection in cell box [x=${cellBox.x0.toFixed(0)}-${cellBox.x1.toFixed(0)}, y=${cellBox.y0.toFixed(0)}-${cellBox.y1.toFixed(0)}]. Form: '${equivCheck.matchedForm}'.`,
    };
  }

  // 4. Cell Box does NOT contain the number. Perform Failure Diagnosis:
  // Is the number elsewhere on the page?
  const normCand = normalizeScientificString(cleanCandidateRaw);
  const matchingPageTokens = pageItems.filter((it) => {
    if (!it.str) return false;
    const normToken = normalizeScientificString(it.str);
    if (normToken === normCand) return true;
    const escapedCand = normCand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const discreteRegex = new RegExp(`(?<![0-9.])${escapedCand}(?![0-9.])`);
    if (discreteRegex.test(normToken)) return true;
    const parsedToken = parseFloat(normToken.replace(/[^0-9.-]/g, ""));
    const parsedCand = parseFloat(normCand.replace(/[^0-9.-]/g, ""));
    return !isNaN(parsedToken) && !isNaN(parsedCand) && parsedToken === parsedCand;
  });

  if (matchingPageTokens.length === 0) {
    // Number doesn't exist anywhere on the page
    return {
      status: "REJECTED",
      method: "UNVERIFIED",
      matchedTokens: [],
      exactStringMatch: false,
      transcriptionError: true,
      rowMisattribution: false,
      columnShiftError: false,
      narrativeLeakError: false,
      notes: `Value '${cleanCandidateRaw}' not found anywhere in source PDF page token stream (OCR hallucination or transcription error).`,
    };
  }

  // The number DOES exist elsewhere on the page! Diagnose where:
  // A. Check if token is inside a DIFFERENT column in the same row
  const sameRowOtherCol = layout.colIntervals.find((c) => {
    if (c.colIdx === candidate.colIdx) return false;
    const otherBox: BoundingBox = {
      x0: c.xMin, x1: c.xMax,
      y0: rowLayout.yMin, y1: rowLayout.yMax,
    };
    return matchingPageTokens.some((t) => isInsideBox(t.x, t.y, otherBox, 4.0, 3.5));
  });

  if (sameRowOtherCol) {
    return {
      status: "REJECTED",
      method: "GEOMETRIC_TOKEN_INTERSECTION",
      matchedTokens: matchingPageTokens.map((t) => t.str),
      exactStringMatch: false,
      transcriptionError: false,
      rowMisattribution: false,
      columnShiftError: true,
      narrativeLeakError: false,
      notes: `Column Shift Error: Value '${cleanCandidateRaw}' belongs to column '${sameRowOtherCol.header}' (col ${sameRowOtherCol.colIdx}), not target col ${candidate.colIdx}.`,
    };
  }

  // B. Check if token is inside a DIFFERENT row in the same column
  const sameColOtherRow = layout.rowIntervals.find((r) => {
    if (r.rowIdx === candidate.rowIdx) return false;
    const otherBox: BoundingBox = {
      x0: colLayout.xMin, x1: colLayout.xMax,
      y0: r.yMin, y1: r.yMax,
    };
    return matchingPageTokens.some((t) => isInsideBox(t.x, t.y, otherBox, 4.0, 3.5));
  });

  if (sameColOtherRow) {
    return {
      status: "REJECTED",
      method: "GEOMETRIC_TOKEN_INTERSECTION",
      matchedTokens: matchingPageTokens.map((t) => t.str),
      exactStringMatch: false,
      transcriptionError: false,
      rowMisattribution: true,
      columnShiftError: false,
      narrativeLeakError: false,
      notes: `Row Misattribution Error: Value '${cleanCandidateRaw}' belongs to row '${sameColOtherRow.label}' (row ${sameColOtherRow.rowIdx}), not target row ${candidate.rowIdx}.`,
    };
  }

  // C. Check if token is OUTSIDE the entire table bounding box (Narrative Leak)
  const isOutsideTable = matchingPageTokens.every(
    (t) => !isInsideBox(t.x, t.y, layout.tableBbox, 10.0, 10.0)
  );

  if (isOutsideTable) {
    return {
      status: "REJECTED",
      method: "GEOMETRIC_TOKEN_INTERSECTION",
      matchedTokens: matchingPageTokens.map((t) => t.str),
      exactStringMatch: false,
      transcriptionError: false,
      rowMisattribution: false,
      columnShiftError: false,
      narrativeLeakError: true,
      notes: `Narrative Leak Error: Value '${cleanCandidateRaw}' exists in page body text outside the table bounding box.`,
    };
  }

  // D. Disagreement / Ambiguous coordinates
  return {
    status: "DISAGREEMENT",
    method: "GEOMETRIC_TOKEN_INTERSECTION",
    matchedTokens: matchingPageTokens.map((t) => t.str),
    exactStringMatch: false,
    transcriptionError: false,
    rowMisattribution: false,
    columnShiftError: false,
    narrativeLeakError: false,
    notes: `Coordinate Disagreement: Value '${cleanCandidateRaw}' exists in table but does not align with target cell box [row=${candidate.rowIdx}, col=${candidate.colIdx}].`,
  };
}
