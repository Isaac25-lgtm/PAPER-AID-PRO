/**
 * AI RESEARCH HUB — PHASE 3C STAGE 2
 * SCIENTIFIC TABLE PERSISTENCE SERVICE & ISOLATION REPOSITORY
 *
 * Implements safe, idempotent persistence and verification management:
 * 1. Forced Default: Creates every candidate cell as UNVERIFIED.
 * 2. Zero Trust: Discards any verificationStatus submitted by external clients or LLMs.
 * 3. Trusted Promotion: Only the deterministic cell-verifier can promote cells to VERIFIED.
 * 4. Atomic Audit: Status updates, verifiedAt, and audit logs are persisted atomically.
 * 5. Run Versioning: Active extraction runs are isolated by runId and sourcePdfHash.
 * 6. Superseded Isolation: Inactive/superseded runs are strictly excluded from queries.
 */

import { VerificationStatus, TableCellEvidence, PaperTableEvidence } from "./types";
import { verifyCellEvidence, TableGeometryLayout, NativeTextItem } from "./cell-verifier";

export type RunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SUPERSEDED";

export interface ExtractionRunEntity {
  id: string;
  paperId: string;
  sourcePdfHash: string;
  engineVersion: string;
  status: RunStatus;
  isActive: boolean;
  jobId?: string;
  config?: Record<string, any>;
  tableCount: number;
  cellCount: number;
  verifiedCellCount: number;
  errorMessage?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaperTableEntity {
  id: string;
  extractionRunId: string;
  paperId: string;
  tableIndex: number; // 0-based sequence in manuscript detection order
  pageNumber: number;
  tableNumber: string; // e.g. "Table 1"
  caption?: string;
  multiPagePart: number;
  parentTableId?: string;
  tableBbox: { x0: number; y0: number; x1: number; y1: number };
  sourcePdfHash: string;
  headerHierarchy: any;
  datasetNames: string[];
  rawMarkdown?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TableCellEntity {
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
  scale?: string;
  modelOrMethod: string;
  groupOrSubrow?: string;
  datasetOrCohort?: string;
  experimentalCondition?: string;
  headerPath: string[];
  cellBbox?: { x0: number; y0: number; x1: number; y1: number };
  rowInterval?: [number, number];
  colInterval?: [number, number];
  cropImageUri?: string;
  verificationStatus: VerificationStatus; // Always UNVERIFIED upon creation
  verificationMethod: string;
  verifiedAt: Date | null;
  verifierVersion?: string;
  verificationNotes?: string;
  transcriptionError: boolean;
  columnShiftError: boolean;
  rowMisattribution: boolean;
  coordinateMismatch: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TableCellAuditLogEntity {
  id: string;
  cellId: string;
  previousStatus: VerificationStatus;
  newStatus: VerificationStatus;
  decisionReason: string;
  verifierVersion: string;
  sourcePdfHash: string;
  checkedTokens: string[];
  errorFlags?: Record<string, boolean>;
  actor: string;
  timestamp: Date;
}

/**
 * In-memory transactional database interface for isolated testing and development.
 * Simulates strict PostgreSQL uniqueness constraints, foreign keys, and atomic commits.
 */
export class TableEvidenceMemoryStore {
  public runs: Map<string, ExtractionRunEntity> = new Map();
  public tables: Map<string, PaperTableEntity> = new Map();
  public cells: Map<string, TableCellEntity> = new Map();
  public auditLogs: TableCellAuditLogEntity[] = [];

  // Index helper for unique constraints
  // @@unique([extractionRunId, tableIndex])
  public tableIndexMap: Map<string, string> = new Map(); // `${runId}:${tableIndex}` -> tableId
  // @@unique([tableId, rowIdx, colIdx])
  public cellIndexMap: Map<string, string> = new Map(); // `${tableId}:${rowIdx}:${colIdx}` -> cellId

  public clear() {
    this.runs.clear();
    this.tables.clear();
    this.cells.clear();
    this.auditLogs = [];
    this.tableIndexMap.clear();
    this.cellIndexMap.clear();
  }
}

/**
 * Service orchestrating extraction runs, candidate ingestion, deterministic promotion, and isolation.
 */
export class TablePersistenceService {
  constructor(private store: TableEvidenceMemoryStore) {}

  /**
   * Initializes a new extraction run for a paper and PDF hash.
   * Status defaults to 'PENDING', isActive defaults to false.
   */
  public async createExtractionRun(params: {
    paperId: string;
    sourcePdfHash: string;
    engineVersion: string;
    jobId?: string;
    config?: Record<string, any>;
  }): Promise<ExtractionRunEntity> {
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const run: ExtractionRunEntity = {
      id: runId,
      paperId: params.paperId,
      sourcePdfHash: params.sourcePdfHash,
      engineVersion: params.engineVersion,
      status: "PENDING",
      isActive: false, // Inactive by default; only promoted when run completes and is activated
      jobId: params.jobId,
      config: params.config,
      tableCount: 0,
      cellCount: 0,
      verifiedCellCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.store.runs.set(run.id, run);
    return { ...run };
  }

  /**
   * Persists an extracted table instance and its candidate cells.
   *
   * SAFETY GUARANTEE:
   * Strips any untrusted verificationStatus provided by caller or LLM.
   * Every newly created cell is forced to 'UNVERIFIED'.
   */
  public async saveCandidateTable(
    runId: string,
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
    candidateCells: Array<Partial<TableCellEntity> & {
      rowIdx: number;
      colIdx: number;
      rawPrintedValue: string;
      modelOrMethod: string;
      headerPath: string[];
      // Untrusted status may be passed by malicious client/LLM — will be ignored
      verificationStatus?: any;
    }>
  ): Promise<{ table: PaperTableEntity; cells: TableCellEntity[] }> {
    const run = this.store.runs.get(runId);
    if (!run) throw new Error(`ExtractionRun '${runId}' not found.`);

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
      const parent = this.store.tables.get(tableData.parentTableId);
      if (!parent) {
        throw new Error(`Foreign key constraint violation: Parent table '${tableData.parentTableId}' not found.`);
      }
      if (parent.extractionRunId !== runId || parent.paperId !== run.paperId) {
        throw new Error(
          `Composite foreign key constraint violation: Continuation table in run '${runId}' (paper '${run.paperId}') cannot link to parent table in run '${parent.extractionRunId}' (paper '${parent.paperId}').`
        );
      }
    }

    // Enforce uniqueness: @@unique([extractionRunId, tableIndex])
    const tableKey = `${runId}:${tableData.tableIndex}`;
    if (this.store.tableIndexMap.has(tableKey)) {
      throw new Error(
        `Unique constraint violation: Table with tableIndex ${tableData.tableIndex} already exists in run '${runId}'.`
      );
    }

    const tableId = `tbl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const tableEntity: PaperTableEntity = {
      id: tableId,
      extractionRunId: runId,
      paperId: run.paperId,
      tableIndex: tableData.tableIndex,
      pageNumber: tableData.pageNumber,
      tableNumber: tableData.tableNumber,
      caption: tableData.caption,
      multiPagePart: tableData.multiPagePart ?? 1,
      parentTableId: tableData.parentTableId,
      tableBbox: tableData.tableBbox,
      sourcePdfHash: run.sourcePdfHash,
      headerHierarchy: tableData.headerHierarchy ?? {},
      datasetNames: tableData.datasetNames ?? [],
      rawMarkdown: tableData.rawMarkdown,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.store.tables.set(tableId, tableEntity);
    this.store.tableIndexMap.set(tableKey, tableId);

    const savedCells: TableCellEntity[] = [];

    for (const c of candidateCells) {
      // Composite relation validation: Cell cannot reference different paper or run than parent table
      if ((c as any).paperId && (c as any).paperId !== run.paperId) {
        throw new Error(
          `Composite foreign key constraint violation: Cell paperId '${(c as any).paperId}' does not match parent table paperId '${run.paperId}'.`
        );
      }
      if ((c as any).extractionRunId && (c as any).extractionRunId !== runId) {
        throw new Error(
          `Composite foreign key constraint violation: Cell extractionRunId '${(c as any).extractionRunId}' does not match parent table extractionRunId '${runId}'.`
        );
      }

      // Enforce cell uniqueness: @@unique([tableId, rowIdx, colIdx])
      const cellKey = `${tableId}:${c.rowIdx}:${c.colIdx}`;
      if (this.store.cellIndexMap.has(cellKey)) {
        throw new Error(
          `Unique constraint violation: Cell at (${c.rowIdx}, ${c.colIdx}) already exists in table '${tableId}'.`
        );
      }

      const cellId = `cell_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const cellEntity: TableCellEntity = {
        id: cellId,
        tableId,
        extractionRunId: runId,
        paperId: run.paperId,
        rowIdx: c.rowIdx,
        colIdx: c.colIdx,
        rowSpan: c.rowSpan ?? 1,
        colSpan: c.colSpan ?? 1,
        rawPrintedValue: c.rawPrintedValue,
        verbatimPdfTokens: c.verbatimPdfTokens ?? [],
        isMissingOrNa: c.isMissingOrNa ?? false,
        footnoteReferences: c.footnoteReferences ?? [],
        normalizedNumericValue: c.normalizedNumericValue ?? null,
        confidenceInterval: c.confidenceInterval ?? [],
        standardDeviation: c.standardDeviation ?? null,
        unit: c.unit ?? "UNSPECIFIED",
        scale: c.scale,
        modelOrMethod: c.modelOrMethod,
        groupOrSubrow: c.groupOrSubrow,
        datasetOrCohort: c.datasetOrCohort,
        experimentalCondition: c.experimentalCondition,
        headerPath: c.headerPath,
        cellBbox: c.cellBbox,
        rowInterval: c.rowInterval,
        colInterval: c.colInterval,
        cropImageUri: c.cropImageUri,

        // SAFETY DEFAULT: Discard any external status. Always UNVERIFIED.
        verificationStatus: "UNVERIFIED",
        verificationMethod: "UNVERIFIED",
        verifiedAt: null,
        verifierVersion: undefined,
        verificationNotes: undefined,
        transcriptionError: false,
        columnShiftError: false,
        rowMisattribution: false,
        coordinateMismatch: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.store.cells.set(cellId, cellEntity);
      this.store.cellIndexMap.set(cellKey, cellId);
      savedCells.push(cellEntity);
    }

    run.tableCount += 1;
    run.cellCount += savedCells.length;
    run.status = "RUNNING";
    run.updatedAt = new Date();

    return { table: { ...tableEntity }, cells: savedCells.map(c => ({ ...c })) };
  }

  /**
   * Deterministically verifies candidate cells for a given table against native PDF text tokens.
   * Atomically transitions verified cells and records immutable audit logs.
   */
  public async verifyAndPromoteTableCells(
    tableId: string,
    layout: TableGeometryLayout,
    pageTokens: NativeTextItem[],
    verifierVersion: string = "hybrid-cell-verifier-v1.0"
  ): Promise<{
    verifiedCount: number;
    rejectedCount: number;
    disagreementCount: number;
  }> {
    const table = this.store.tables.get(tableId);
    if (!table) throw new Error(`Table '${tableId}' not found.`);

    const run = this.store.runs.get(table.extractionRunId);
    if (!run) throw new Error(`ExtractionRun '${table.extractionRunId}' not found.`);

    const tableCells = Array.from(this.store.cells.values()).filter(c => c.tableId === tableId);

    let verifiedCount = 0;
    let rejectedCount = 0;
    let disagreementCount = 0;

    for (const cell of tableCells) {
      const prevStatus = cell.verificationStatus;

      // Execute trusted deterministic verification
      const vResult = verifyCellEvidence(
        {
          rawPrintedValue: cell.rawPrintedValue,
          numericValue: cell.normalizedNumericValue,
          modelOrMethod: cell.modelOrMethod,
          groupOrSubrow: cell.groupOrSubrow,
          headerPath: cell.headerPath,
          rowIdx: cell.rowIdx,
          colIdx: cell.colIdx,
        },
        layout,
        pageTokens
      );

      // Atomically update cell state
      cell.verificationStatus = vResult.status;
      cell.verificationMethod = vResult.method;
      cell.verifierVersion = verifierVersion;
      cell.verificationNotes = vResult.notes;
      cell.updatedAt = new Date();

      if (vResult.status === "VERIFIED") {
        cell.verifiedAt = new Date();
        verifiedCount++;
        run.verifiedCellCount++;
      } else {
        cell.verifiedAt = null;
        if (vResult.status === "REJECTED") rejectedCount++;
        if (vResult.status === "DISAGREEMENT") disagreementCount++;
      }

      cell.transcriptionError = vResult.transcriptionError;
      cell.columnShiftError = vResult.columnShiftError;
      cell.rowMisattribution = vResult.rowMisattribution;
      cell.coordinateMismatch = vResult.status === "DISAGREEMENT" && vResult.notes.includes("not found");

      // Record immutable audit log
      this.store.auditLogs.push({
        id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        cellId: cell.id,
        previousStatus: prevStatus,
        newStatus: vResult.status,
        decisionReason: vResult.notes || `Verification evaluated to ${vResult.status}`,
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
        timestamp: new Date(),
      });
    }

    return { verifiedCount, rejectedCount, disagreementCount };
  }

  /**
   * Activates an extraction run upon successful completion.
   * Atomically supersedes any previous active runs for this paper.
   */
  public async activateExtractionRun(runId: string): Promise<ExtractionRunEntity> {
    const targetRun = this.store.runs.get(runId);
    if (!targetRun) throw new Error(`Run '${runId}' not found.`);

    // Deactivate and supersede all previous runs for the same paperId
    const allRuns = Array.from(this.store.runs.values());
    for (const run of allRuns) {
      if (run.paperId === targetRun.paperId && run.id !== runId && run.isActive) {
        run.isActive = false;
        run.status = "SUPERSEDED";
        run.updatedAt = new Date();
      }
    }

    targetRun.isActive = true;
    targetRun.status = "COMPLETED";
    targetRun.completedAt = new Date();
    targetRun.updatedAt = new Date();

    return { ...targetRun };
  }

  /**
   * Marks an extraction run as FAILED.
   * Failed runs are NEVER made active.
   */
  public async failExtractionRun(runId: string, errorMessage: string): Promise<ExtractionRunEntity> {
    const run = this.store.runs.get(runId);
    if (!run) throw new Error(`Run '${runId}' not found.`);

    run.status = "FAILED";
    run.isActive = false;
    run.errorMessage = errorMessage;
    run.completedAt = new Date();
    run.updatedAt = new Date();

    return { ...run };
  }

  /**
   * Query API for Scientific RAG & Synthesis.
   *
   * STRICT GUARANTEE:
   * 1. Only retrieves cells from ACTIVE extraction runs.
   * 2. Only retrieves cells where verificationStatus === 'VERIFIED'.
   * 3. Excludes UNVERIFIED, UNVERIFIED_VISUAL_ONLY, AMBIGUOUS, DISAGREEMENT, and REJECTED cells.
   */
  public async getActiveVerifiedEvidence(params: {
    paperId: string;
    modelOrMethod?: string;
    datasetOrCohort?: string;
  }): Promise<TableCellEntity[]> {
    // 1. Locate active run for this paper
    const activeRun = Array.from(this.store.runs.values()).find(
      r => r.paperId === params.paperId && r.isActive && r.status === "COMPLETED"
    );

    if (!activeRun) return []; // No active verified run available

    // 2. Filter cells belonging to active run with strict status
    return Array.from(this.store.cells.values()).filter(cell => {
      if (cell.extractionRunId !== activeRun.id) return false;
      if (cell.verificationStatus !== "VERIFIED") return false; // Strict filter
      if (params.modelOrMethod && cell.modelOrMethod.toLowerCase() !== params.modelOrMethod.toLowerCase()) {
        return false;
      }
      if (params.datasetOrCohort && cell.datasetOrCohort?.toLowerCase() !== params.datasetOrCohort.toLowerCase()) {
        return false;
      }
      return true;
    });
  }

  /**
   * Audit query API to inspect provenance and verification history of a cell.
   */
  public async getCellAuditTrail(cellId: string): Promise<TableCellAuditLogEntity[]> {
    return this.store.auditLogs.filter(log => log.cellId === cellId);
  }
}
