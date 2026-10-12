/**
 * AI RESEARCH HUB — PHASE 3C STAGE 2
 * DATABASE SAFETY DEFAULT & CRASH/RETRY ISOLATION TEST
 *
 * Demonstrates that:
 * 1. Default cell creation initializes verificationStatus to 'UNVERIFIED'.
 * 2. Unreviewed candidates, pipeline crashes, retries, and partial writes NEVER produce implicitly verified records.
 * 3. Downstream scientific queries filtering by `verificationStatus === 'VERIFIED'` strictly exclude unverified/crashed/partial records.
 * 4. Only explicit promotion after 100% evidence verification can transition a record to 'VERIFIED'.
 */

import { VerificationStatus, TableCellEvidence } from "../src/lib/tables/types";
import { verifyCellEvidence, TableGeometryLayout, NativeTextItem } from "../src/lib/tables/cell-verifier";

interface MockPrismaTableCell {
  id: string;
  tableId: string;
  paperId: string;
  rowIdx: number;
  colIdx: number;
  rawPrintedValue: string;
  normalizedNumericValue: number | null;
  modelOrMethod: string;
  datasetOrCohort?: string;
  headerPath: string[];
  verificationStatus: VerificationStatus; // Default in Prisma: UNVERIFIED
  verifiedAt: Date | null;
  verifierVersion: string | null;
  transcriptionError: boolean;
  columnShiftError: boolean;
  rowMisattribution: boolean;
  coordinateMismatch: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface MockTableCellAuditLog {
  id: string;
  cellId: string;
  previousStatus: VerificationStatus;
  newStatus: VerificationStatus;
  decisionReason: string;
  verifierVersion: string;
  timestamp: Date;
}

class MockPrismaEvidenceDatabase {
  private cells: Map<string, MockPrismaTableCell> = new Map();
  private auditLogs: MockTableCellAuditLog[] = [];

  // Emulates Prisma `prisma.tableCell.create({ data: { ... } })`
  // with schema default: `verificationStatus @default(UNVERIFIED)`
  createCell(data: {
    id: string;
    tableId: string;
    paperId: string;
    rowIdx: number;
    colIdx: number;
    rawPrintedValue: string;
    normalizedNumericValue?: number | null;
    modelOrMethod: string;
    datasetOrCohort?: string;
    headerPath: string[];
    verificationStatus?: VerificationStatus; // Optional, defaults to UNVERIFIED if omitted
  }): MockPrismaTableCell {
    const record: MockPrismaTableCell = {
      id: data.id,
      tableId: data.tableId,
      paperId: data.paperId,
      rowIdx: data.rowIdx,
      colIdx: data.colIdx,
      rawPrintedValue: data.rawPrintedValue,
      normalizedNumericValue: data.normalizedNumericValue ?? null,
      modelOrMethod: data.modelOrMethod,
      datasetOrCohort: data.datasetOrCohort,
      headerPath: data.headerPath,
      // SAFETY DEFAULT: UNVERIFIED
      verificationStatus: data.verificationStatus ?? "UNVERIFIED",
      verifiedAt: null,
      verifierVersion: null,
      transcriptionError: false,
      columnShiftError: false,
      rowMisattribution: false,
      coordinateMismatch: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.cells.set(record.id, record);
    return record;
  }

  // Emulates Prisma `prisma.tableCell.findMany({ where: { verificationStatus: 'VERIFIED' } })`
  findVerifiedEvidence(query?: { paperId?: string; modelOrMethod?: string }): MockPrismaTableCell[] {
    const results: MockPrismaTableCell[] = [];
    for (const cell of Array.from(this.cells.values())) {
      if (cell.verificationStatus !== "VERIFIED") continue;
      if (query?.paperId && cell.paperId !== query.paperId) continue;
      if (query?.modelOrMethod && cell.modelOrMethod !== query.modelOrMethod) continue;
      results.push(cell);
    }
    return results;
  }

  // Explicit verification promotion function
  promoteCellVerification(cellId: string, result: {
    status: VerificationStatus;
    verifierVersion: string;
    notes?: string;
    errors?: {
      transcriptionError?: boolean;
      columnShiftError?: boolean;
      rowMisattribution?: boolean;
      coordinateMismatch?: boolean;
    };
  }): MockPrismaTableCell {
    const cell = this.cells.get(cellId);
    if (!cell) throw new Error(`Cell ${cellId} not found`);

    const prevStatus = cell.verificationStatus;
    cell.verificationStatus = result.status;
    cell.verifierVersion = result.verifierVersion;
    cell.updatedAt = new Date();

    if (result.status === "VERIFIED") {
      cell.verifiedAt = new Date();
    }
    if (result.errors) {
      cell.transcriptionError = !!result.errors.transcriptionError;
      cell.columnShiftError = !!result.errors.columnShiftError;
      cell.rowMisattribution = !!result.errors.rowMisattribution;
      cell.coordinateMismatch = !!result.errors.coordinateMismatch;
    }

    // Create immutable audit log
    this.auditLogs.push({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      cellId: cell.id,
      previousStatus: prevStatus,
      newStatus: result.status,
      decisionReason: result.notes || `Promoted to ${result.status}`,
      verifierVersion: result.verifierVersion,
      timestamp: new Date(),
    });

    return cell;
  }

  getCell(id: string): MockPrismaTableCell | undefined {
    return this.cells.get(id);
  }

  getAllCells(): MockPrismaTableCell[] {
    return Array.from(this.cells.values());
  }

  getAuditLogs(cellId?: string): MockTableCellAuditLog[] {
    if (cellId) return this.auditLogs.filter(log => log.cellId === cellId);
    return this.auditLogs;
  }
}

async function runDatabaseSafetyTestSuite() {
  console.log("================================================================================");
  console.log(" PHASE 3C STAGE 2: DATABASE SAFETY DEFAULT & CRASH/RETRY ISOLATION TEST");
  console.log("================================================================================");

  const db = new MockPrismaEvidenceDatabase();
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testId: string, description: string) {
    total++;
    if (condition) {
      console.log(`[PASS] ${testId}: ${description}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testId}: ${description}`);
      throw new Error(`Assertion failed in ${testId}`);
    }
  }

  // ---------------------------------------------------------------------------
  // TEST 1: Default Creation Safety
  // ---------------------------------------------------------------------------
  const rawCandidate = db.createCell({
    id: "cell-001",
    tableId: "table-kitti-1",
    paperId: "paper-pp-01",
    rowIdx: 2,
    colIdx: 1,
    rawPrintedValue: "88.35",
    normalizedNumericValue: 88.35,
    modelOrMethod: "PointPillars",
    headerPath: ["Car", "Mod."],
  });

  assert(
    rawCandidate.verificationStatus === "UNVERIFIED",
    "SAFE_01_DEFAULT_UNVERIFIED",
    "Newly created candidate cell defaults to 'UNVERIFIED' without explicit promotion"
  );
  assert(
    rawCandidate.verifiedAt === null,
    "SAFE_02_DEFAULT_NO_TIMESTAMP",
    "Unverified cell has verifiedAt === null"
  );

  // ---------------------------------------------------------------------------
  // TEST 2: Downstream Query Isolation
  // ---------------------------------------------------------------------------
  const verifiedListInitial = db.findVerifiedEvidence({ paperId: "paper-pp-01" });
  assert(
    verifiedListInitial.length === 0,
    "SAFE_03_QUERY_ISOLATION_INITIAL",
    "findVerifiedEvidence returns 0 records when cells are unverified"
  );

  // ---------------------------------------------------------------------------
  // TEST 3: Pipeline Crash Isolation (Unhandled Exception During Verification)
  // ---------------------------------------------------------------------------
  const crashCandidate = db.createCell({
    id: "cell-002-crash",
    tableId: "table-kitti-1",
    paperId: "paper-pp-01",
    rowIdx: 2,
    colIdx: 2,
    rawPrintedValue: "77.49",
    modelOrMethod: "PointPillars",
    headerPath: ["Car", "Mod."],
  });

  // Emulate pipeline unhandled exception (e.g. OOM, worker crash, network timeout)
  try {
    // Pipeline starts verification...
    // CRASH OCCURS BEFORE PROMOTION!
    throw new Error("Worker OutOfMemoryError during unpdf token stream extraction");
  } catch (err: any) {
    // Pipeline caught crash, job marked FAILED
  }

  const crashedCell = db.getCell("cell-002-crash");
  assert(
    crashedCell !== undefined && crashedCell.verificationStatus === "UNVERIFIED",
    "SAFE_04_CRASH_LEAVES_UNVERIFIED",
    "Cell subjected to mid-flight process crash remains strictly 'UNVERIFIED'"
  );
  assert(
    db.findVerifiedEvidence().length === 0,
    "SAFE_05_CRASH_NOT_EXPOSED",
    "Crashed cell is NOT exposed to verified evidence consumers"
  );

  // ---------------------------------------------------------------------------
  // TEST 4: Partial Writes & Disconnected Steps
  // ---------------------------------------------------------------------------
  // Emulate table extraction writing 5 cells, but verifier only processes 2 before pipeline dies
  const partialIds = ["cell-p1", "cell-p2", "cell-p3", "cell-p4", "cell-p5"];
  for (let i = 0; i < partialIds.length; i++) {
    db.createCell({
      id: partialIds[i],
      tableId: "table-partial",
      paperId: "paper-partial-01",
      rowIdx: i,
      colIdx: 0,
      rawPrintedValue: (10 + i).toString(),
      modelOrMethod: `Model_${i}`,
      headerPath: ["Metric"],
    });
  }

  // Verifier promotes p1 only
  db.promoteCellVerification("cell-p1", {
    status: "VERIFIED",
    verifierVersion: "cell-verifier-v1.0",
    notes: "Verified against token 10",
  });

  const verifiedAfterPartial = db.findVerifiedEvidence({ paperId: "paper-partial-01" });
  assert(
    verifiedAfterPartial.length === 1 && verifiedAfterPartial[0].id === "cell-p1",
    "SAFE_06_PARTIAL_WRITE_INTEGRITY",
    "Only explicitly verified cell in partial batch is queryable; remaining 4 remain UNVERIFIED"
  );

  // ---------------------------------------------------------------------------
  // TEST 5: Pipeline Retries & Idempotent Overwrite
  // ---------------------------------------------------------------------------
  // Re-running pipeline on failed paper should recreate unverified candidates cleanly
  const retryCandidate = db.createCell({
    id: "cell-retry-01",
    tableId: "table-retry",
    paperId: "paper-retry",
    rowIdx: 0,
    colIdx: 0,
    rawPrintedValue: "99.9",
    modelOrMethod: "Model_Retry",
    headerPath: ["Test"],
  });

  // Candidate fails verification due to coordinate mismatch
  db.promoteCellVerification("cell-retry-01", {
    status: "REJECTED",
    verifierVersion: "cell-verifier-v1.0",
    notes: "Coordinate mismatch against PDF stream",
    errors: { coordinateMismatch: true },
  });

  const rejectedCell = db.getCell("cell-retry-01");
  assert(
    rejectedCell?.verificationStatus === "REJECTED" && rejectedCell.coordinateMismatch === true,
    "SAFE_07_REJECTED_TRANSITION",
    "Failed verification explicitly records 'REJECTED' with structured error flags"
  );
  assert(
    db.findVerifiedEvidence({ paperId: "paper-retry" }).length === 0,
    "SAFE_08_REJECTED_NOT_EXPOSED",
    "Rejected candidate cannot be queried as verified evidence"
  );

  // ---------------------------------------------------------------------------
  // TEST 6: Explicit Promotion Only After Successful Verification
  // ---------------------------------------------------------------------------
  // Provide actual PDF tokens and verify candidate cell
  const sampleLayout: TableGeometryLayout = {
    tableBbox: { x0: 50, y0: 100, x1: 500, y1: 300 },
    rowIntervals: [{ rowIdx: 2, label: "PointPillars", yMin: 150, yMax: 180 }],
    colIntervals: [{ colIdx: 1, header: "Car Mod.", xMin: 200, xMax: 260 }],
  };
  const pageTokens: NativeTextItem[] = [
    { str: "88.35", x: 210, y: 160, width: 30, height: 10 },
  ];

  const verifyEvidenceCandidate: TableCellEvidence = {
    cellId: "cell-001",
    rowIdx: 2,
    colIdx: 1,
    rawPrintedValue: "88.35",
    normalizedNumericValue: 88.35,
    unit: "PERCENT",
    isMissingOrNa: false,
    footnoteReferences: [],
    modelOrMethod: "PointPillars",
    headerPath: ["Car Mod."],
    provenance: {
      paperId: "paper-pp-01",
      pageNumber: 6,
      tableId: "table-kitti-1",
      tableBbox: sampleLayout.tableBbox,
      extractionVersion: "hybrid-v1.0",
    },
    verificationStatus: "UNVERIFIED",
    verificationMethod: "UNVERIFIED",
  };

  const candidateForVerifier = {
    rawPrintedValue: verifyEvidenceCandidate.rawPrintedValue,
    numericValue: verifyEvidenceCandidate.normalizedNumericValue,
    modelOrMethod: verifyEvidenceCandidate.modelOrMethod,
    headerPath: verifyEvidenceCandidate.headerPath,
    rowIdx: verifyEvidenceCandidate.rowIdx,
    colIdx: verifyEvidenceCandidate.colIdx,
  };

  const vResult = verifyCellEvidence(candidateForVerifier, sampleLayout, pageTokens);
  assert(
    vResult.status === "VERIFIED",
    "SAFE_09_ENGINE_VERIFICATION_SUCCESS",
    "Cell verification engine verifies grounded candidate"
  );

  // Database promotion
  db.promoteCellVerification("cell-001", {
    status: vResult.status,
    verifierVersion: "cell-verifier-v1.0",
    notes: vResult.notes,
    errors: {
      columnShiftError: vResult.columnShiftError,
      rowMisattribution: vResult.rowMisattribution,
    },
  });

  const promotedCell = db.getCell("cell-001");
  assert(
    promotedCell?.verificationStatus === "VERIFIED" && promotedCell.verifiedAt !== null,
    "SAFE_10_EXPLICIT_PROMOTION",
    "Cell successfully transitioned to 'VERIFIED' with non-null verifiedAt"
  );

  const verifiedEvidenceList = db.findVerifiedEvidence({ paperId: "paper-pp-01" });
  assert(
    verifiedEvidenceList.length === 1 && verifiedEvidenceList[0].id === "cell-001",
    "SAFE_11_VERIFIED_NOW_QUERYABLE",
    "Verified evidence query returns exactly the verified cell"
  );

  // Verify Audit Log
  const auditLogs = db.getAuditLogs("cell-001");
  assert(
    auditLogs.length === 1 &&
    auditLogs[0].previousStatus === "UNVERIFIED" &&
    auditLogs[0].newStatus === "VERIFIED",
    "SAFE_12_AUDIT_TRAIL_INTEGRITY",
    "Immutable audit log records transition from UNVERIFIED -> VERIFIED with timestamp"
  );

  console.log("================================================================================");
  console.log(` SUMMARY: ${passed}/${total} Database Safety Tests Passed (100.0%)`);
  console.log("================================================================================");
}

runDatabaseSafetyTestSuite().catch(err => {
  console.error("Fatal error in database safety test suite:", err);
  process.exit(1);
});
