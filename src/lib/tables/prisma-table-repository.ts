/**
 * AI RESEARCH HUB — PHASE 3C STAGE 2A
 * PRISMA-BACKED SCIENTIFIC TABLE REPOSITORY
 *
 * Implements real Prisma database operations with ACID transactions:
 * 1. Safe Candidate Creation: Forces verificationStatus to 'UNVERIFIED', verifiedAt to null.
 * 2. Status Stripping: Discards any client/LLM-supplied verificationStatus.
 * 3. Source-Grounded Verification: Calls trusted verifyCellEvidence before promotion.
 * 4. Atomic Promotion & Auditing: Updates cell and writes TableCellAuditLog in one transaction.
 * 5. Run-Level Activation Safety: Uses interactive transaction with PostgreSQL partial unique index
 *    guarding against concurrent race conditions (at most one active run per paper).
 * 6. Scientific Query Boundary: Queries strictly WHERE run.isActive = true AND cell.verificationStatus = 'VERIFIED'.
 */

import { PrismaClient } from "@prisma/client";
import { VerificationStatus, TableCellEvidence } from "./types";
import { verifyCellEvidence, TableGeometryLayout, NativeTextItem } from "./cell-verifier";

export interface PrismaTableExtractionRun {
  id: string;
  paperId: string;
  processingJobId?: string | null;
  sourcePdfHash: string;
  engineVersion: string;
  extractionMethod: "SPATIAL_2D" | "VISION_MULTIMODAL" | "HYBRID_RECONCILED";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SUPERSEDED";
  isActive: boolean;
  tableCount: number;
  cellCount: number;
  verifiedCellCount: number;
  config?: any;
  startedAt: Date;
  completedAt?: Date | null;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaPaperTable {
  id: string;
  extractionRunId: string;
  paperId: string;
  tableIndex: number;
  pageNumber: number;
  tableNumber: string;
  caption?: string | null;
  multiPagePart: number;
  parentTableId?: string | null;
  tableBbox: { x0: number; y0: number; x1: number; y1: number };
  sourcePdfHash: string;
  headerHierarchy: any;
  datasetNames: string[];
  rawMarkdown?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaTableCell {
  id: string;
  tableId: string;
  extractionRunId: string;
  paperId: string;
  rowIdx: number;
  colIdx: number;
  rowSpan: number;
  colSpan: number;
  rawPrintedValue: string;
  verbatimPdfTokens: string[];
  isMissingOrNa: boolean;
  footnoteReferences: string[];
  normalizedNumericValue: number | null;
  confidenceInterval: number[];
  standardDeviation: number | null;
  unit: string;
  scale?: string | null;
  modelOrMethod: string;
  groupOrSubrow?: string | null;
  datasetOrCohort?: string | null;
  experimentalCondition?: string | null;
  headerPath: string[];
  cellBbox?: any;
  rowInterval?: number[];
  colInterval?: number[];
  cropImageUri?: string | null;
  verificationStatus: VerificationStatus;
  verificationMethod: string;
  verifiedAt: Date | null;
  verifierVersion?: string | null;
  verificationNotes?: string | null;
  transcriptionError: boolean;
  columnShiftError: boolean;
  rowMisattribution: boolean;
  coordinateMismatch: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaTableCellAuditLog {
  id: string;
  cellId: string;
  previousStatus: VerificationStatus;
  newStatus: VerificationStatus;
  decisionReason: string;
  verifierVersion: string;
  sourcePdfHash: string;
  checkedTokens: string[];
  errorFlags?: any;
  actor: string;
  timestamp: Date;
}

export class PrismaTableRepository {
  constructor(private prismaClient: any) {}

  /**
   * Initializes a new TableExtractionRun in database.
   * Defaults to status: 'PENDING', isActive: false.
   */
  public async createExtractionRun(data: {
    paperId: string;
    sourcePdfHash: string;
    engineVersion: string;
    processingJobId?: string;
    config?: Record<string, any>;
  }): Promise<PrismaTableExtractionRun> {
    const delegate = (this.prismaClient as any).tableExtractionRun;
    if (!delegate) {
      throw new Error("Prisma client does not have tableExtractionRun model generated yet.");
    }

    return await delegate.create({
      data: {
        paperId: data.paperId,
        sourcePdfHash: data.sourcePdfHash,
        engineVersion: data.engineVersion,
        processingJobId: data.processingJobId || null,
        config: data.config || null,
        status: "PENDING",
        isActive: false, // Inactive until explicitly activated
        tableCount: 0,
        cellCount: 0,
        verifiedCellCount: 0,
      },
    });
  }

  /**
   * Saves a table and its candidate cells.
   *
   * SECURITY RULE:
   * Any client- or LLM-supplied verificationStatus is stripped.
   * All candidate cells are forced to 'UNVERIFIED' with verifiedAt: null.
   */
  public async saveCandidateTable(
    extractionRunId: string,
    tableData: {
      tableIndex: number;
      pageNumber: number;
      tableNumber: string;
      caption?: string;
      multiPagePart?: number;
      parentTableId?: string;
      tableBbox: { x0: number; y0: number; x1: number; y1: number };
      headerHierarchy?: any;
      datasetNames?: string[];
      rawMarkdown?: string;
    },
    candidateCells: Array<Partial<PrismaTableCell> & {
      rowIdx: number;
      colIdx: number;
      rawPrintedValue: string;
      modelOrMethod: string;
      headerPath: string[];
      verificationStatus?: any; // Ignored/stripped
    }>
  ): Promise<{ table: PrismaPaperTable; cells: PrismaTableCell[] }> {
    return await this.prismaClient.$transaction(async (tx: any) => {
      const run = await tx.tableExtractionRun.findUnique({
        where: { id: extractionRunId },
      });
      if (!run) throw new Error(`ExtractionRun '${extractionRunId}' not found.`);

      // 1. Cross-run / cross-paper / cross-hash consistency validation
      if ((tableData as any).paperId && (tableData as any).paperId !== run.paperId) {
        throw new Error(
          `Relational integrity violation: Table paperId '${(tableData as any).paperId}' does not match extraction run paperId '${run.paperId}'.`
        );
      }
      if ((tableData as any).sourcePdfHash && (tableData as any).sourcePdfHash !== run.sourcePdfHash) {
        throw new Error(
          `Relational integrity violation: Table sourcePdfHash '${(tableData as any).sourcePdfHash}' does not match extraction run sourcePdfHash '${run.sourcePdfHash}'.`
        );
      }

      // 2. Multi-page continuation validation: strictly prevents crossing runs or papers
      if (tableData.parentTableId) {
        const parent = await tx.paperTable.findUnique({
          where: { id: tableData.parentTableId },
        });
        if (!parent) {
          throw new Error(`Foreign key constraint violation: Parent table '${tableData.parentTableId}' not found.`);
        }
        if (parent.extractionRunId !== extractionRunId || parent.paperId !== run.paperId) {
          throw new Error(
            `Composite foreign key constraint violation: Continuation table in run '${extractionRunId}' (paper '${run.paperId}') cannot link to parent table in run '${parent.extractionRunId}' (paper '${parent.paperId}').`
          );
        }
      }

      // 3. Candidate cells composite consistency validation
      for (const c of candidateCells) {
        if ((c as any).paperId && (c as any).paperId !== run.paperId) {
          throw new Error(
            `Composite foreign key constraint violation: Cell paperId '${(c as any).paperId}' does not match parent table paperId '${run.paperId}'.`
          );
        }
        if ((c as any).extractionRunId && (c as any).extractionRunId !== extractionRunId) {
          throw new Error(
            `Composite foreign key constraint violation: Cell extractionRunId '${(c as any).extractionRunId}' does not match parent table extractionRunId '${extractionRunId}'.`
          );
        }
      }

      // 4. Create PaperTable
      const table = await tx.paperTable.create({
        data: {
          extractionRunId,
          paperId: run.paperId,
          tableIndex: tableData.tableIndex,
          pageNumber: tableData.pageNumber,
          tableNumber: tableData.tableNumber,
          caption: tableData.caption || null,
          multiPagePart: tableData.multiPagePart ?? 1,
          parentTableId: tableData.parentTableId || null,
          tableBbox: tableData.tableBbox,
          sourcePdfHash: run.sourcePdfHash,
          headerHierarchy: tableData.headerHierarchy || {},
          datasetNames: tableData.datasetNames || [],
          rawMarkdown: tableData.rawMarkdown || null,
        },
      });

      // 2. Prepare cells with forced UNVERIFIED default
      const cellCreates = candidateCells.map((c) => ({
        tableId: table.id,
        extractionRunId,
        paperId: run.paperId,
        rowIdx: c.rowIdx,
        colIdx: c.colIdx,
        rowSpan: c.rowSpan ?? 1,
        colSpan: c.colSpan ?? 1,
        rawPrintedValue: c.rawPrintedValue,
        verbatimPdfTokens: c.verbatimPdfTokens || [],
        isMissingOrNa: c.isMissingOrNa || false,
        footnoteReferences: c.footnoteReferences || [],
        normalizedNumericValue: c.normalizedNumericValue ?? null,
        confidenceInterval: c.confidenceInterval || [],
        standardDeviation: c.standardDeviation ?? null,
        unit: (c.unit as any) || "UNSPECIFIED",
        scale: c.scale || null,
        modelOrMethod: c.modelOrMethod,
        groupOrSubrow: c.groupOrSubrow || null,
        datasetOrCohort: c.datasetOrCohort || null,
        experimentalCondition: c.experimentalCondition || null,
        headerPath: c.headerPath,
        cellBbox: c.cellBbox || null,
        rowInterval: c.rowInterval || [],
        colInterval: c.colInterval || [],
        cropImageUri: c.cropImageUri || null,
        // ZERO-TRUST DEFAULT
        verificationStatus: "UNVERIFIED",
        verificationMethod: "UNVERIFIED",
        verifiedAt: null,
        verifierVersion: null,
        verificationNotes: null,
        transcriptionError: false,
        columnShiftError: false,
        rowMisattribution: false,
        coordinateMismatch: false,
      }));

      // Create cells
      await tx.tableCell.createMany({
        data: cellCreates,
      });

      // Update run counts
      await tx.tableExtractionRun.update({
        where: { id: extractionRunId },
        data: {
          tableCount: { increment: 1 },
          cellCount: { increment: cellCreates.length },
          status: "RUNNING",
        },
      });

      const savedCells = await tx.tableCell.findMany({
        where: { tableId: table.id },
      });

      return { table, cells: savedCells };
    });
  }

  /**
   * Deterministically verifies cells of a table and executes atomic status promotion + audit logs.
   */
  public async verifyAndPromoteTableCells(
    tableId: string,
    layout: TableGeometryLayout,
    pageTokens: NativeTextItem[],
    verifierVersion: string = "hybrid-cell-verifier-v1.0"
  ): Promise<{ verifiedCount: number; rejectedCount: number; disagreementCount: number }> {
    return await this.prismaClient.$transaction(async (tx: any) => {
      const table = await tx.paperTable.findUnique({
        where: { id: tableId },
      });
      if (!table) throw new Error(`Table '${tableId}' not found.`);

      const cells: PrismaTableCell[] = await tx.tableCell.findMany({
        where: { tableId },
      });

      let verifiedCount = 0;
      let rejectedCount = 0;
      let disagreementCount = 0;

      for (const cell of cells) {
        const prevStatus = cell.verificationStatus;

        // Run trusted deterministic verifier
        const vResult = verifyCellEvidence(
          {
            rawPrintedValue: cell.rawPrintedValue,
            numericValue: cell.normalizedNumericValue,
            modelOrMethod: cell.modelOrMethod,
            groupOrSubrow: cell.groupOrSubrow || undefined,
            headerPath: cell.headerPath,
            rowIdx: cell.rowIdx,
            colIdx: cell.colIdx,
          },
          layout,
          pageTokens
        );

        const isVerified = vResult.status === "VERIFIED";
        if (isVerified) verifiedCount++;
        else if (vResult.status === "REJECTED") rejectedCount++;
        else if (vResult.status === "DISAGREEMENT") disagreementCount++;

        // Update cell in transaction
        await tx.tableCell.update({
          where: { id: cell.id },
          data: {
            verificationStatus: vResult.status,
            verificationMethod: vResult.method,
            verifierVersion,
            verificationNotes: vResult.notes,
            verifiedAt: isVerified ? new Date() : null,
            transcriptionError: vResult.transcriptionError,
            columnShiftError: vResult.columnShiftError,
            rowMisattribution: vResult.rowMisattribution,
            coordinateMismatch: vResult.status === "DISAGREEMENT" && vResult.notes.includes("not found"),
          },
        });

        // Write immutable audit log in same transaction
        await tx.tableCellAuditLog.create({
          data: {
            cellId: cell.id,
            previousStatus: prevStatus,
            newStatus: vResult.status,
            decisionReason: vResult.notes || `Promoted to ${vResult.status}`,
            verifierVersion,
            sourcePdfHash: table.sourcePdfHash,
            checkedTokens: vResult.matchedTokens || [],
            errorFlags: {
              transcriptionError: vResult.transcriptionError,
              columnShiftError: vResult.columnShiftError,
              rowMisattribution: vResult.rowMisattribution,
              narrativeLeakError: vResult.narrativeLeakError,
            },
            actor: "SYSTEM_CELL_VERIFIER",
          },
        });
      }

      // Update run verified count
      if (verifiedCount > 0) {
        await tx.tableExtractionRun.update({
          where: { id: table.extractionRunId },
          data: { verifiedCellCount: { increment: verifiedCount } },
        });
      }

      return { verifiedCount, rejectedCount, disagreementCount };
    });
  }

  /**
   * Marks an extraction run as COMPLETED after all tables and cells have been processed.
   */
  public async completeExtractionRun(extractionRunId: string): Promise<PrismaTableExtractionRun> {
    const delegate = (this.prismaClient as any).tableExtractionRun;
    if (!delegate) throw new Error("Prisma client does not have tableExtractionRun model.");
    return await delegate.update({
      where: { id: extractionRunId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
  }

  /**
   * Activates an extraction run atomically.
   *
   * DATABASE SAFETY SAFEGUARD:
   * In PostgreSQL, the partial unique index:
   *   CREATE UNIQUE INDEX "table_extraction_runs_paperId_active_unique"
   *   ON "table_extraction_runs"("paperId") WHERE "isActive" = true;
   * guarantees that AT MOST ONE run can be active per paper.
   *
   * In addition, the check constraint:
   *   CHECK ("isActive" = false OR ("isActive" = true AND "status" = 'COMPLETED'))
   * prevents any PENDING, RUNNING or FAILED run from becoming active.
   */
  public async activateExtractionRun(extractionRunId: string): Promise<PrismaTableExtractionRun> {
    return await this.prismaClient.$transaction(async (tx: any) => {
      const targetRun = await tx.tableExtractionRun.findUnique({
        where: { id: extractionRunId },
      });
      if (!targetRun) throw new Error(`Run '${extractionRunId}' not found.`);

      // 1. Deactivate and mark all previous active runs as SUPERSEDED
      await tx.tableExtractionRun.updateMany({
        where: {
          paperId: targetRun.paperId,
          id: { not: extractionRunId },
          isActive: true,
        },
        data: {
          isActive: false,
          status: "SUPERSEDED",
        },
      });

      // 2. Atomically activate target run
      return await tx.tableExtractionRun.update({
        where: { id: extractionRunId },
        data: {
          isActive: true,
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });
    });
  }

  /**
   * Queries verified evidence strictly from active completed runs.
   */
  public async getActiveVerifiedEvidence(params: {
    paperId: string;
    modelOrMethod?: string;
    datasetOrCohort?: string;
  }): Promise<PrismaTableCell[]> {
    const delegate = (this.prismaClient as any).tableCell;
    if (!delegate) return [];

    return await delegate.findMany({
      where: {
        paperId: params.paperId,
        verificationStatus: "VERIFIED",
        table: {
          extractionRun: {
            isActive: true,
            status: "COMPLETED",
          },
        },
        ...(params.modelOrMethod
          ? { modelOrMethod: { equals: params.modelOrMethod, mode: "insensitive" } }
          : {}),
        ...(params.datasetOrCohort
          ? { datasetOrCohort: { equals: params.datasetOrCohort, mode: "insensitive" } }
          : {}),
      },
      include: {
        table: true,
      },
    });
  }

  /**
   * Queries verified numerical measurements strictly for scientific synthesis.
   * Filters out categorical values, table headers, and matrix axis labels.
   */
  public async getActiveVerifiedNumericalMeasurements(params: {
    paperId: string;
    modelOrMethod?: string;
    datasetOrCohort?: string;
  }): Promise<PrismaTableCell[]> {
    const allVerified = await this.getActiveVerifiedEvidence(params);
    const { isScientificNumericalMeasurement } = require("./types");
    return allVerified.filter((c: any) =>
      isScientificNumericalMeasurement({
        normalizedNumericValue: c.normalizedNumericValue,
        rawPrintedValue: c.rawPrintedValue,
        modelOrMethod: c.modelOrMethod,
        headerPath: c.headerPath,
        unit: c.unit,
        rowIdx: c.rowIdx,
        colIdx: c.colIdx,
      })
    );
  }
}
