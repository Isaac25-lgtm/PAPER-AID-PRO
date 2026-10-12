/**
 * AI RESEARCH HUB — SCIENTIFIC TABLE EVIDENCE ORCHESTRATOR
 *
 * Implements the complete end-to-end local table evidence lifecycle:
 * 1. Creates extraction run (status: PENDING, isActive: false).
 * 2. Extracts candidate tables via deterministic 2D spatial layouts.
 * 3. Persists candidates to database with forced 'UNVERIFIED' status.
 * 4. Executes physical cell-level token intersection verification.
 * 5. Atomically promotes verified cells and writes immutable audit logs.
 * 6. Marks run COMPLETED.
 * 7. Activates run using transaction-safe supersession (enforcing at most one active run).
 * 8. Queries verified scientific evidence strictly from the active completed run.
 */

import * as crypto from "crypto";
import * as unpdf from "unpdf";
import {
  PrismaTableRepository,
  PrismaTableCell,
  PrismaTableExtractionRun,
  PrismaPaperTable,
} from "./prisma-table-repository";
import {
  SpatialTableExtractor,
  ExtractedTable,
  ExtractedCell,
} from "./spatial-extractor";
import {
  TableGeometryLayout,
  NativeTextItem,
} from "./cell-verifier";

export interface OrchestrationRunOptions {
  paperId: string;
  pdfBuffer: Buffer;
  sourcePdfHash?: string;
  engineVersion?: string;
  targetPageNumber?: number;
  targetTableNumber?: string;
  verifierVersion?: string;
}

export interface OrchestratedTableResult {
  table: PrismaPaperTable;
  extractedCount: number;
  verifiedCount: number;
  rejectedCount: number;
  disagreementCount: number;
}

export interface OrchestrationResult {
  run: PrismaTableExtractionRun;
  tables: OrchestratedTableResult[];
  activeRun: PrismaTableExtractionRun;
  activeVerifiedEvidence: PrismaTableCell[];
  summary: {
    totalCandidateCells: number;
    totalVerifiedCells: number;
    totalRejectedCells: number;
    totalDisagreements: number;
    verificationSuccessRate: number;
  };
}

export class TableEvidenceOrchestrator {
  private extractor = new SpatialTableExtractor();

  constructor(private repository: PrismaTableRepository) {}

  /**
   * Builds physical geometry layout from spatial table and page text items.
   */
  public buildGeometryLayout(
    table: ExtractedTable,
    _pageItems: NativeTextItem[],
    options?: { datasetNames?: string[]; sourcePdfHash?: string }
  ): TableGeometryLayout {
    const tableBbox = {
      x0: table.bbox[0],
      y0: table.bbox[1],
      x1: table.bbox[0] + table.bbox[2],
      y1: table.bbox[1] + table.bbox[3],
    };

    // Group cells by rowIndex
    const rowMap = new Map<number, ExtractedCell[]>();
    for (const cell of table.cells) {
      if (!rowMap.has(cell.rowIndex)) rowMap.set(cell.rowIndex, []);
      rowMap.get(cell.rowIndex)!.push(cell);
    }

    const rowIntervals = Array.from(rowMap.entries()).map(([rIdx, rCells]) => {
      const yMin = Math.min(...rCells.map((c) => c.bbox[1])) - 3.0;
      const yMax = Math.max(...rCells.map((c) => c.bbox[1] + c.bbox[3])) + 3.0;
      const groupCell = rCells.find(
        (c) => c.columnHeader && c.columnHeader.toLowerCase().includes("group")
      );
      return {
        rowIdx: rIdx,
        label: rCells[0]?.rowLabel || "Unknown_Row",
        sublabel: groupCell ? groupCell.rawValue : undefined,
        yMin,
        yMax,
      };
    });

    let colIntervals: Array<{
      colIdx: number;
      header: string;
      superHeader?: string;
      xMin: number;
      xMax: number;
    }> = [];

    if (table.colIntervals && table.colIntervals.length > 0) {
      colIntervals = table.colIntervals.map((c) => ({
        colIdx: c.colIndex,
        header: c.name,
        superHeader: c.superName,
        xMin: c.xMin,
        xMax: c.xMax,
      }));
    } else {
      // Group cells by colIndex
      const colMap = new Map<number, ExtractedCell[]>();
      for (const cell of table.cells) {
        const cIdx = cell.colIndex >= 0 ? cell.colIndex : 0;
        if (!colMap.has(cIdx)) colMap.set(cIdx, []);
        colMap.get(cIdx)!.push(cell);
      }

      colIntervals = Array.from(colMap.entries()).map(([cIdx, cCells]) => {
        const xMin = Math.min(...cCells.map((c) => c.bbox[0])) - 4.0;
        const xMax = Math.max(...cCells.map((c) => c.bbox[0] + c.bbox[2])) + 4.0;
        return {
          colIdx: cIdx,
          header: cCells[0]?.columnHeader || `Col_${cIdx}`,
          superHeader: cCells[0]?.superHeader || undefined,
          xMin,
          xMax,
        };
      });
    }

    return {
      tableBbox,
      datasetNames: options?.datasetNames,
      sourcePdfHash: options?.sourcePdfHash,
      rowIntervals,
      colIntervals,
    };
  }

  /**
   * Executes the complete end-to-end table evidence persistence and verification workflow.
   */
  public async executeWorkflow(
    options: OrchestrationRunOptions
  ): Promise<OrchestrationResult> {
    const sourcePdfHash =
      options.sourcePdfHash ||
      crypto.createHash("sha256").update(options.pdfBuffer).digest("hex");
    const engineVersion = options.engineVersion || "hybrid-reconciled-v1.0";
    const verifierVersion =
      options.verifierVersion || "geometric-token-verifier-v1.0";

    // 1. Initialize TableExtractionRun (PENDING, isActive: false)
    const run = await this.repository.createExtractionRun({
      paperId: options.paperId,
      sourcePdfHash,
      engineVersion,
    });

    // 2. Extract text items from PDF
    const { items: allPagesItems } = await unpdf.extractTextItems(
      new Uint8Array(options.pdfBuffer)
    );

    // 3. Extract tables
    let targetPages: number[] = [];
    if (options.targetPageNumber) {
      targetPages = [options.targetPageNumber];
    } else {
      targetPages = allPagesItems.map((_, i) => i + 1);
    }

    const extractedTables: Array<{ pageNum: number; table: ExtractedTable }> = [];
    for (const pageNum of targetPages) {
      const pageItems = (allPagesItems[pageNum - 1] || []) as any;
      const tablesOnPage = this.extractor.extractTablesFromPage(pageNum, pageItems);
      for (const t of tablesOnPage) {
        if (
          !options.targetTableNumber ||
          t.tableNumber
            .toLowerCase()
            .includes(options.targetTableNumber.toLowerCase())
        ) {
          extractedTables.push({ pageNum, table: t });
        }
      }
    }

    const tableResults: OrchestratedTableResult[] = [];
    let totalCandidates = 0;
    let totalVerified = 0;
    let totalRejected = 0;
    let totalDisagreements = 0;

    // 4 & 5. Persist candidates as UNVERIFIED, then verify and promote
    for (let tIdx = 0; tIdx < extractedTables.length; tIdx++) {
      const { pageNum, table: extTable } = extractedTables[tIdx];
      const pageTokens: NativeTextItem[] = (allPagesItems[pageNum - 1] || []).map(
        (it: any) => ({
          str: it.str,
          x: it.x,
          y: it.y,
          width: it.width,
          height: it.height,
        })
      );

      const rowColTracker = new Map<number, Set<number>>();
      const candidateCells = extTable.cells.map((c, cIdx) => {
        if (!rowColTracker.has(c.rowIndex)) {
          rowColTracker.set(c.rowIndex, new Set<number>());
        }
        const usedCols = rowColTracker.get(c.rowIndex)!;
        let assignedCol = c.colIndex >= 0 ? c.colIndex : cIdx;
        while (usedCols.has(assignedCol)) {
          assignedCol++;
        }
        usedCols.add(assignedCol);

        return {
          rowIdx: c.rowIndex,
          colIdx: assignedCol,
          rawPrintedValue: c.rawValue,
          modelOrMethod: c.rowLabel,
          headerPath:
            c.headerPath && c.headerPath.length > 0
              ? c.headerPath
              : ([c.superHeader, c.columnHeader].filter(Boolean) as string[]),
          normalizedNumericValue: c.numericValue,
          confidenceInterval:
            typeof c.ciLower === "number" && typeof c.ciUpper === "number"
              ? [c.ciLower, c.ciUpper]
              : [],
          standardDeviation: typeof c.std === "number" ? c.std : null,
          unit:
            c.unit &&
            ["PERCENT", "RATIO", "COUNT", "HERTZ", "MILLISECONDS", "DECIBELS"].includes(
              c.unit
            )
              ? c.unit
              : "UNSPECIFIED",
          cellBbox: {
            x0: c.bbox[0],
            y0: c.bbox[1],
            x1: c.bbox[0] + c.bbox[2],
            y1: c.bbox[1] + c.bbox[3],
          },
        };
      });

      // Persist candidate table (cells forced to UNVERIFIED)
      const { table: savedTable } = await this.repository.saveCandidateTable(
        run.id,
        {
          tableIndex: tIdx,
          pageNumber: pageNum,
          tableNumber: extTable.tableNumber,
          caption: extTable.caption,
          tableBbox: {
            x0: extTable.bbox[0],
            y0: extTable.bbox[1],
            x1: extTable.bbox[0] + extTable.bbox[2],
            y1: extTable.bbox[1] + extTable.bbox[3],
          },
          headerHierarchy: {
            superHeaders: extTable.superHeaders,
            columnHeaders: extTable.columnHeaders,
          },
          datasetNames: [],
        },
        candidateCells as any
      );

      totalCandidates += candidateCells.length;

      // Execute physical verification & atomic audit log promotion
      const layout = this.buildGeometryLayout(extTable, pageTokens, {
        datasetNames: [],
        sourcePdfHash,
      });
      const vResult = await this.repository.verifyAndPromoteTableCells(
        savedTable.id,
        layout,
        pageTokens,
        verifierVersion
      );

      totalVerified += vResult.verifiedCount;
      totalRejected += vResult.rejectedCount;
      totalDisagreements += vResult.disagreementCount;

      tableResults.push({
        table: savedTable,
        extractedCount: candidateCells.length,
        verifiedCount: vResult.verifiedCount,
        rejectedCount: vResult.rejectedCount,
        disagreementCount: vResult.disagreementCount,
      });
    }

    // 6. Complete run
    await this.repository.completeExtractionRun(run.id);

    // 7. Activate run using transaction-safe supersession
    const activeRun = await this.repository.activateExtractionRun(run.id);

    // 8. Retrieve verified scientific evidence strictly from active run
    const activeVerifiedEvidence = await this.repository.getActiveVerifiedEvidence({
      paperId: options.paperId,
    });

    const successRate =
      totalCandidates > 0 ? (totalVerified / totalCandidates) * 100 : 0;

    return {
      run,
      tables: tableResults,
      activeRun,
      activeVerifiedEvidence,
      summary: {
        totalCandidateCells: totalCandidates,
        totalVerifiedCells: totalVerified,
        totalRejectedCells: totalRejected,
        totalDisagreements: totalDisagreements,
        verificationSuccessRate: parseFloat(successRate.toFixed(1)),
      },
    };
  }

  /**
   * Retrieves verified numerical scientific measurements strictly for synthesis queries.
   * Excludes table headers, class indices, and categorical descriptors.
   */
  public async getActiveVerifiedNumericalMeasurements(
    paperId: string
  ): Promise<PrismaTableCell[]> {
    return await this.repository.getActiveVerifiedNumericalMeasurements({ paperId });
  }
}
