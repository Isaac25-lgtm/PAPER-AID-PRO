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
  headerPath?: string[];
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
  colIntervals?: Array<{
    colIndex: number;
    name: string;
    superName?: string;
    headerPath: string[];
    xMin: number;
    xMax: number;
    xCenter: number;
  }>;
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

export function clean(str: string): string {
  return (str || "").replace(/\s+/g, " ").trim();
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

      // 4. Identify header rows vs data rows deterministically
      let firstDataRowIdx = -1;
      for (let i = 0; i < rowClusters.length; i++) {
        const r = rowClusters[i];
        const measurementCount = r.items.filter((it) => {
          const s = clean(it.str);
          if (s === "N/A" || s === "-" || s === "–") return true;
          const parsed = parseCellNumbers(s);
          return parsed.numericValue !== null;
        }).length;

        const isAxisIndexRow =
          r.items.length <= 3 &&
          r.items.every((it) => {
            const s = clean(it.str).toLowerCase();
            return (
              s === "0" ||
              s === "1" ||
              s === "predicted" ||
              s === "actual" ||
              s === "class"
            );
          });

        if (measurementCount >= 2 && !isAxisIndexRow) {
          firstDataRowIdx = i;
          break;
        }
      }
      if (firstDataRowIdx <= 0) firstDataRowIdx = 1;

      const headerRows = rowClusters.slice(0, firstDataRowIdx);
      const dataRows = rowClusters.slice(firstDataRowIdx);

      // Multi-level column and subcolumn discovery
      const colIntervals = this.discoverColumnsFromHeaderRows(headerRows);
      const superHeaders = Array.from(
        new Set(colIntervals.map((c) => c.superName).filter(Boolean))
      ) as string[];
      const columnHeaders = colIntervals.map((c) => c.name);

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
            headerPath: [name],
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

          const itCenter = it.x + it.width / 2;
          const matchedCol = colIntervals.find(
            (c) => itCenter >= c.xMin && itCenter < c.xMax
          );

          if (!matchedCol) {
            ambiguousCount++;
            cells.push({
              rowIndex: rIdx,
              colIndex: -1,
              rowLabel: currentRowLabel,
              columnHeader: "Unassigned",
              headerPath: ["Unassigned"],
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
            colIndex: matchedCol.colIndex,
            rowLabel: currentRowLabel,
            columnHeader: matchedCol.name,
            superHeader: matchedCol.superName,
            headerPath: matchedCol.headerPath,
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
        colIntervals,
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

  /**
   * Deterministically reconstructs leaf column intervals and hierarchical super-header paths.
   */
  private discoverColumnsFromHeaderRows(
    headerRows: Array<{ y: number; items: TextItem[] }>
  ): Array<{
    colIndex: number;
    name: string;
    superName?: string;
    headerPath: string[];
    xMin: number;
    xMax: number;
    xCenter: number;
  }> {
    const cleanHeaderRows = headerRows
      .map((r) => ({
        y: r.y,
        items: r.items.filter((it) => clean(it.str).length > 0),
      }))
      .filter((r) => r.items.length > 0);

    if (cleanHeaderRows.length === 0) return [];

    if (cleanHeaderRows.length === 1) {
      const hr = cleanHeaderRows[0];
      const cols: Array<{
        colIndex: number;
        name: string;
        superName?: string;
        headerPath: string[];
        xMin: number;
        xMax: number;
        xCenter: number;
      }> = [];
      for (let c = 0; c < hr.items.length; c++) {
        const it = hr.items[c];
        const prev = c > 0 ? hr.items[c - 1] : null;
        const next = c < hr.items.length - 1 ? hr.items[c + 1] : null;
        const cCenter = it.x + it.width / 2;
        const prevCenter = prev ? prev.x + prev.width / 2 : cCenter - 40;
        const nextCenter = next ? next.x + next.width / 2 : cCenter + 40;

        const name = clean(it.str);
        cols.push({
          colIndex: c,
          name,
          headerPath: [name],
          xMin: (prevCenter + cCenter) / 2,
          xMax: (cCenter + nextCenter) / 2,
          xCenter: cCenter,
        });
      }
      return cols;
    }

    // Multi-level header
    // 1. Collect all header tokens across all header rows tagged with their rowIndex
    const allHeaderItems: Array<TextItem & { rowIndex: number; text: string }> = [];
    for (let rIdx = 0; rIdx < cleanHeaderRows.length; rIdx++) {
      for (const it of cleanHeaderRows[rIdx].items) {
        allHeaderItems.push({ ...it, rowIndex: rIdx, text: clean(it.str) });
      }
    }

    // Sort from bottom row to top row (highest rowIndex first), then left to right
    allHeaderItems.sort((a, b) => b.rowIndex - a.rowIndex || a.x - b.x);

    // 2. Discover distinct leaf x-centers (items >= 16 pt apart)
    const distinctX: Array<{
      item: TextItem & { rowIndex: number; text: string };
      center: number;
    }> = [];
    for (const it of allHeaderItems) {
      const itCenter = it.x + it.width / 2;
      const exists = distinctX.some((d) => Math.abs(d.center - itCenter) < 16);
      if (!exists) {
        distinctX.push({ item: it, center: itCenter });
      }
    }
    distinctX.sort((a, b) => a.center - b.center);

    // 3. For each leaf column, find its parent spanning super-header in upper header rows via midpoint partitioning
    const cols: Array<{
      colIndex: number;
      name: string;
      superName?: string;
      headerPath: string[];
      xMin: number;
      xMax: number;
      xCenter: number;
    }> = [];

    for (let c = 0; c < distinctX.length; c++) {
      const cur = distinctX[c];
      const prev = c > 0 ? distinctX[c - 1] : null;
      const next = c < distinctX.length - 1 ? distinctX[c + 1] : null;

      const xMin = prev ? (prev.center + cur.center) / 2 : cur.center - 30;
      const xMax = next ? (cur.center + next.center) / 2 : cur.center + 30;

      let superName: string | undefined;
      for (let r = 0; r < cur.item.rowIndex; r++) {
        const upperRow = cleanHeaderRows[r];
        for (let sIdx = 0; sIdx < upperRow.items.length; sIdx++) {
          const sIt = upperRow.items[sIdx];
          const sCenter = sIt.x + sIt.width / 2;
          const prevS = sIdx > 0 ? upperRow.items[sIdx - 1] : null;
          const nextS = sIdx < upperRow.items.length - 1 ? upperRow.items[sIdx + 1] : null;

          const prevCenter = prevS ? prevS.x + prevS.width / 2 : null;
          const nextCenter = nextS ? nextS.x + nextS.width / 2 : null;

          const sLeft =
            prevCenter !== null
              ? (prevCenter + sCenter) / 2
              : nextCenter !== null
              ? sCenter - (nextCenter - sCenter) / 2
              : sCenter - 45;

          const sRight =
            nextCenter !== null
              ? (sCenter + nextCenter) / 2
              : prevCenter !== null
              ? sCenter + (sCenter - prevCenter) / 2
              : sCenter + 45;

          if (cur.center >= sLeft && cur.center < sRight) {
            superName = clean(sIt.str);
            break;
          }
        }
        if (superName) break;
      }

      const colName = cur.item.text;
      const headerPath =
        superName && superName !== colName ? [superName, colName] : [colName];
      const fullName =
        superName && superName !== colName ? `${superName} ${colName}` : colName;

      cols.push({
        colIndex: c,
        name: fullName,
        superName,
        headerPath,
        xMin,
        xMax,
        xCenter: cur.center,
      });
    }

    return cols;
  }
}

