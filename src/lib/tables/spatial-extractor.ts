/**
 * AI RESEARCH HUB — SPATIAL PDF TABLE EXTRACTOR
 *
 * Implements deterministic 2D geometric table extraction from native PDF text items:
 * - Supports Caption-Above (BMC, IEEE, MDPI, CVPR) and Caption-Below (Nature/SciReports) styles
 * - 2D Y-baseline row clustering with font-size tolerance
 * - 2D X-column boundary interval detection
 * - Multi-level nested column headers
 * - Subrows for STD / CI parsing
 * - Fails closed with AMBIGUOUS classification when geometry is uncertain
 * - Zero LLM cost, 100% deterministic
 */

export interface ExtractedCell {
  rowIndex: number;
  colIndex: number;
  rowLabel: string;
  columnHeader: string;
  superHeader?: string | null;
  dataset?: string | null;
  metricName?: string | null;
  unit: string;
  rawValue: string;
  numericValue: number | null;
  ciLower?: number | null;
  ciUpper?: number | null;
  std?: number | null;
  bbox: [number, number, number, number]; // [x, y, w, h]
  status: "VERIFIED" | "AMBIGUOUS";
  ambiguityReason?: string;
}

export interface ExtractedTable {
  tableNumber: string;
  caption: string;
  pageNumber: number;
  captionPosition: "ABOVE" | "BELOW";
  bbox: [number, number, number, number];
  columnHeaders: string[];
  superHeaders: string[];
  rowLabels: string[];
  cells: ExtractedCell[];
  footnotes: string[];
  isGeometryCertain: boolean;
  uncertaintyReason?: string;
  totalSourceCellsExpected: number;
  totalExtractedCells: number;
  verifiedCount: number;
  ambiguousCount: number;
}

export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
}

function clean(str: string): string {
  return str.replace(/\s+/g, " ").trim();
}

export function parseCellNumbers(valStr: string): {
  numericValue: number | null;
  ciLower: number | null;
  ciUpper: number | null;
  std: number | null;
  unit: string;
} {
  const s = valStr.trim();
  let unit = "RATIO";
  if (s.includes("%") || /\(%\)/i.test(s)) unit = "PERCENT";
  else if (/hz/i.test(s)) unit = "HERTZ";

  // Check for ± std: e.g. "93.9 ± 2.6" or "0.939 ± 0.026"
  const pmMatch = s.match(/([0-9]+\.?[0-9]*)\s*±\s*([0-9]+\.?[0-9]*)/);
  if (pmMatch) {
    return {
      numericValue: parseFloat(pmMatch[1]),
      ciLower: null,
      ciUpper: null,
      std: parseFloat(pmMatch[2]),
      unit,
    };
  }

  // Check for 95% CI: e.g. "0.866(0.774–0.958)" or "0.866 (0.774-0.958)"
  const ciMatch = s.match(/([0-9]+\.?[0-9]*)\s*[\(\[]\s*([0-9]+\.?[0-9]*)\s*[–\-\—\,]\s*([0-9]+\.?[0-9]*)\s*[\)\]]/);
  if (ciMatch) {
    return {
      numericValue: parseFloat(ciMatch[1]),
      ciLower: parseFloat(ciMatch[2]),
      ciUpper: parseFloat(ciMatch[3]),
      std: null,
      unit,
    };
  }

  // Standard numeric match
  const numMatch = s.match(/^([0-9]+\.?[0-9]*)/);
  if (numMatch) {
    const n = parseFloat(numMatch[1]);
    return {
      numericValue: isNaN(n) ? null : n,
      ciLower: null,
      ciUpper: null,
      std: null,
      unit,
    };
  }

  return {
    numericValue: null,
    ciLower: null,
    ciUpper: null,
    std: null,
    unit,
  };
}

export class SpatialTableExtractor {
  public extractTablesFromPage(pageNumber: number, items: TextItem[]): ExtractedTable[] {
    const tables: ExtractedTable[] = [];
    const validItems = items.filter((it) => it.str && it.str.trim().length > 0);
    if (validItems.length === 0) return tables;

    // 1. Locate all table caption anchors on this page
    const captionAnchors: Array<{
      index: number;
      tableNumber: string;
      captionText: string;
      y: number;
      x: number;
    }> = [];

    for (let i = 0; i < validItems.length; i++) {
      const it = validItems[i];
      const match = it.str.match(/\b(Table|TABLE)\s+(\d+)\b/);
      if (match) {
        let caption = it.str;
        let j = i + 1;
        while (j < validItems.length && Math.abs(validItems[j].y - it.y) < it.fontSize * 0.8) {
          caption += " " + validItems[j].str;
          j++;
        }
        captionAnchors.push({
          index: i,
          tableNumber: `Table ${match[2]}`,
          captionText: clean(caption),
          y: it.y,
          x: it.x,
        });
      }
    }

    if (captionAnchors.length === 0) return tables;

    // 2. Process each detected table caption
    for (const cap of captionAnchors) {
      const itemsAboveCaption = validItems.filter((it) => it.y > cap.y && it.y < cap.y + 350);
      const itemsBelowCaption = validItems.filter((it) => it.y < cap.y && it.y > cap.y - 350);

      const numScoreAbove = itemsAboveCaption.filter((it) =>
        /[0-9]+\.[0-9]+|%|mIOU|AUC|Accuracy/i.test(it.str)
      ).length;
      const numScoreBelow = itemsBelowCaption.filter((it) =>
        /[0-9]+\.[0-9]+|%|mIOU|AUC|Accuracy/i.test(it.str)
      ).length;

      let captionPosition: "ABOVE" | "BELOW" = "ABOVE";
      let tableItems: TextItem[] = [];

      if (numScoreAbove > numScoreBelow && numScoreAbove >= 6) {
        captionPosition = "BELOW";
        const minY = cap.y + 5;
        const candidates = validItems
          .filter((it) => it.y >= minY && it.y <= cap.y + 350)
          .sort((a, b) => a.y - b.y);
        let topBound = cap.y + 350;
        let lastY = minY;
        for (const it of candidates) {
          if (
            it.y - lastY > 26 &&
            (it.width > 220 ||
              /(?:demonstrates|paper|dataset|compare|shown in|accuracy of)/i.test(it.str))
          ) {
            topBound = lastY + 5;
            break;
          }
          if (
            /(?:Table\s+\d+|Fig\.\s*\d+|doi\.org|https?:\/\/|www\.)/i.test(it.str) &&
            it.y > cap.y + 40
          ) {
            topBound = Math.min(topBound, it.y - 2);
            break;
          }
          lastY = Math.max(lastY, it.y);
        }
        tableItems = validItems.filter((it) => it.y >= minY && it.y <= topBound);
      } else {
        captionPosition = "ABOVE";
        const maxY = cap.y - 5;
        const nextBounds = validItems
          .filter(
            (it) =>
              it.y < cap.y - 30 &&
              /(?:Table\s+\d+|Fig\.\s*\d+|Discussion|References|Methods)/i.test(it.str)
          )
          .map((it) => it.y);
        const minY =
          nextBounds.length > 0
            ? Math.max(...nextBounds) + 5
            : Math.max(50, cap.y - 320);
        tableItems = validItems.filter((it) => it.y <= maxY && it.y >= minY);
      }

      if (tableItems.length < 5) {
        tables.push({
          tableNumber: cap.tableNumber,
          caption: cap.captionText,
          pageNumber,
          captionPosition,
          bbox: [cap.x, cap.y, 0, 0],
          columnHeaders: [],
          superHeaders: [],
          rowLabels: [],
          cells: [],
          footnotes: [],
          isGeometryCertain: false,
          uncertaintyReason:
            "Insufficient text items found in table spatial envelope (< 5 items).",
          totalSourceCellsExpected: 0,
          totalExtractedCells: 0,
          verifiedCount: 0,
          ambiguousCount: 0,
        });
        continue;
      }

      // 3. Cluster table items into Y-baseline rows
      const sortedByY = [...tableItems].sort((a, b) => b.y - a.y);
      const rowClusters: Array<{ y: number; items: TextItem[] }> = [];

      for (const it of sortedByY) {
        const existingRow = rowClusters.find(
          (r) => Math.abs(r.y - it.y) <= Math.max(3.0, it.fontSize * 0.45)
        );
        if (existingRow) {
          existingRow.items.push(it);
        } else {
          rowClusters.push({ y: it.y, items: [it] });
        }
      }

      for (const r of rowClusters) {
        r.items.sort((a, b) => a.x - b.x);
      }

      if (rowClusters.length < 2) {
        tables.push({
          tableNumber: cap.tableNumber,
          caption: cap.captionText,
          pageNumber,
          captionPosition,
          bbox: [cap.x, cap.y, 0, 0],
          columnHeaders: [],
          superHeaders: [],
          rowLabels: [],
          cells: [],
          footnotes: [],
          isGeometryCertain: false,
          uncertaintyReason: "Table contains fewer than 2 distinct Y-baseline rows.",
          totalSourceCellsExpected: 0,
          totalExtractedCells: 0,
          verifiedCount: 0,
          ambiguousCount: 0,
        });
        continue;
      }

      // 4. Identify header rows and columns
      const headerRow0 = rowClusters[0];
      const headerRow1 =
        rowClusters.length > 2 &&
        rowClusters[1].items.some((it) =>
          /(?:Easy|Mod|Hard|STD|Recall|Precision|F1|Accuracy|Sensitivity|Specificity|Mean|Std\.?\s*Dev|mIOU|Loss|AUC|Rate|Rank)/i.test(
            it.str
          )
        )
          ? rowClusters[1]
          : null;

      const dataRowStartIndex = headerRow1 ? 2 : 1;
      const dataRows = rowClusters.slice(dataRowStartIndex);

      const superHeaders: string[] = [];
      const columnHeaders: string[] = [];
      const colIntervals: Array<{
        colIndex: number;
        name: string;
        superName?: string;
        xMin: number;
        xMax: number;
        xCenter: number;
      }> = [];

      if (headerRow1) {
        for (const superIt of headerRow0.items) {
          if (clean(superIt.str)) superHeaders.push(clean(superIt.str));
        }

        for (let cIdx = 0; cIdx < headerRow1.items.length; cIdx++) {
          const subIt = headerRow1.items[cIdx];
          const subName = clean(subIt.str);
          if (!subName) continue;

          const parentSuper = headerRow0.items.find(
            (sIt) => subIt.x >= sIt.x - 20 && subIt.x <= sIt.x + sIt.width + 30
          );
          const superName = parentSuper ? clean(parentSuper.str) : undefined;
          const fullHeader = superName ? `${superName} ${subName}` : subName;

          columnHeaders.push(fullHeader);
          colIntervals.push({
            colIndex: cIdx,
            name: fullHeader,
            superName,
            xMin: subIt.x - 12,
            xMax: subIt.x + subIt.width + 12,
            xCenter: subIt.x + subIt.width / 2,
          });
        }
      } else {
        for (let cIdx = 0; cIdx < headerRow0.items.length; cIdx++) {
          const it = headerRow0.items[cIdx];
          const name = clean(it.str);
          if (!name) continue;
          columnHeaders.push(name);
          colIntervals.push({
            colIndex: cIdx,
            name,
            xMin: it.x - 10,
            xMax: it.x + it.width + 15,
            xCenter: it.x + it.width / 2,
          });
        }
      }

      if (colIntervals.length <= 1) {
        const xPositions = dataRows
          .flatMap((r) => r.items.map((it) => it.x))
          .sort((a, b) => a - b);
        const xClusters: number[] = [];
        for (const x of xPositions) {
          const match = xClusters.find((cx) => Math.abs(cx - x) < 18);
          if (!match) xClusters.push(x);
        }
        xClusters.sort((a, b) => a - b);

        colIntervals.length = 0;
        columnHeaders.length = 0;
        for (let c = 0; c < xClusters.length; c++) {
          const cx = xClusters[c];
          const name = `Col_${c}`;
          columnHeaders.push(name);
          colIntervals.push({
            colIndex: c,
            name,
            xMin: cx - 15,
            xMax: cx + 25,
            xCenter: cx,
          });
        }
      }

      // 5. Parse Data Rows into Cells
      const rowLabels: string[] = [];
      const cells: ExtractedCell[] = [];
      let verifiedCount = 0;
      let ambiguousCount = 0;
      let currentRowLabel = "Unknown_Model";

      for (let rIdx = 0; rIdx < dataRows.length; rIdx++) {
        const row = dataRows[rIdx];
        if (row.items.length === 0) continue;

        const firstItem = row.items[0];
        const isNumericRow = /^[0-9\.\-\–\±\%\s]+$/.test(clean(firstItem.str));

        if (!isNumericRow && clean(firstItem.str).length > 1) {
          currentRowLabel = clean(firstItem.str);
          if (!rowLabels.includes(currentRowLabel)) {
            rowLabels.push(currentRowLabel);
          }
        }

        for (let itemIdx = 0; itemIdx < row.items.length; itemIdx++) {
          const it = row.items[itemIdx];
          const str = clean(it.str);
          if (!str) continue;

          if (!isNumericRow && itemIdx === 0 && str === currentRowLabel) {
            continue;
          }

          const bestCol = colIntervals.reduce(
            (best, col) => {
              const dist = Math.abs(col.xCenter - (it.x + it.width / 2));
              return !best || dist < best.dist ? { col, dist } : best;
            },
            null as { col: (typeof colIntervals)[0]; dist: number } | null
          );

          if (!bestCol || bestCol.dist > 50) {
            ambiguousCount++;
            cells.push({
              rowIndex: rIdx,
              colIndex: -1,
              rowLabel: currentRowLabel,
              columnHeader: "Unassigned",
              unit: "UNKNOWN",
              rawValue: str,
              numericValue: null,
              bbox: [it.x, it.y, it.width, it.height],
              status: "AMBIGUOUS",
              ambiguityReason: `Text item does not align with discovered columns.`,
            });
            continue;
          }

          const parsed = parseCellNumbers(str);
          const status = parsed.numericValue !== null ? "VERIFIED" : "AMBIGUOUS";
          if (status === "VERIFIED") verifiedCount++;
          else ambiguousCount++;

          cells.push({
            rowIndex: rIdx,
            colIndex: bestCol.col.colIndex,
            rowLabel: currentRowLabel,
            columnHeader: bestCol.col.name,
            superHeader: bestCol.col.superName,
            unit: parsed.unit,
            rawValue: str,
            numericValue: parsed.numericValue,
            ciLower: parsed.ciLower,
            ciUpper: parsed.ciUpper,
            std: parsed.std,
            bbox: [it.x, it.y, it.width, it.height],
            status,
            ambiguityReason:
              status === "AMBIGUOUS"
                ? "Cell content could not be parsed as a valid numeric point estimate."
                : undefined,
          });
        }
      }

      const minX = Math.min(...tableItems.map((it) => it.x));
      const maxX = Math.max(...tableItems.map((it) => it.x + it.width));
      const minY = Math.min(...tableItems.map((it) => it.y));
      const maxY = Math.max(...tableItems.map((it) => it.y + it.height));

      const isGeometryCertain = verifiedCount >= 4 && ambiguousCount <= verifiedCount;

      tables.push({
        tableNumber: cap.tableNumber,
        caption: cap.captionText,
        pageNumber,
        captionPosition,
        bbox: [minX, minY, maxX - minX, maxY - minY],
        columnHeaders,
        superHeaders,
        rowLabels,
        cells,
        footnotes: [],
        isGeometryCertain,
        uncertaintyReason: !isGeometryCertain
          ? `Geometry uncertain: ${ambiguousCount} ambiguous cells vs ${verifiedCount} verified cells.`
          : undefined,
        totalSourceCellsExpected: rowLabels.length * Math.max(1, columnHeaders.length),
        totalExtractedCells: cells.length,
        verifiedCount,
        ambiguousCount,
      });
    }

    return tables;
  }
}
