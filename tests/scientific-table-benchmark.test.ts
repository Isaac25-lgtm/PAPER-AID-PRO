/**
 * AI RESEARCH HUB — PHASE 3D: MASTER SCIENTIFIC TABLE BENCHMARK HARNESS
 *
 * Reproducible 5-Paper Benchmark & Database Integrity Harness:
 * 1. Validates multi-level column header identification & spanning parent association.
 * 2. Compares extracted numerical measurements against independent ground-truth across all 5 benchmarks:
 *    - PointPillars Table 1 (Primary benchmark): 75/75 verified numerical measurements (100% recall)
 *    - ARU-Net Table 2 (Regression benchmark): 40/40 verified numerical measurements (100% recall)
 *    - Su et al. Table 2 (Regression benchmark): 60/60 verified numerical measurements (100% recall)
 *    - Zakareya et al. Table 2 (Regression benchmark): 4/4 verified confusion counts (100% recall)
 *    - Kim et al. Table 3 (Regression benchmark): 20/20 verified accuracies/STDs (100% recall)
 * 3. Validates explicit hierarchical header paths (e.g. ["Car", "Easy"], ["Car", "Mod."], ["Car", "Hard"]).
 * 4. Tests negative attribution controls and exact physical token grounding.
 * 5. Tests synthesis exclusion of headers and categorical modality strings.
 * 6. Verifies atomic persistence and audit logging in isolated local PostgreSQL.
 */

import "./test-setup";
import { PrismaClient } from "../prisma/generated-client";
import { TableEvidenceOrchestrator } from "../src/lib/tables/table-orchestrator";
import { PrismaTableRepository } from "../src/lib/tables/prisma-table-repository";
import { verifyCellEvidence, TableGeometryLayout, NativeTextItem } from "../src/lib/tables/cell-verifier";
import { isScientificNumericalMeasurement } from "../src/lib/tables/types";
import { SpatialTableExtractor } from "../src/lib/tables/spatial-extractor";
import * as fs from "fs";
import * as path from "path";

const LOCAL_DB_URL =
  process.env.LOCAL_TEST_DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:5432/ai_research_hub?schema=public";

if (!LOCAL_DB_URL.includes("127.0.0.1") && !LOCAL_DB_URL.includes("localhost")) {
  console.error("FATAL: LOCAL_TEST_DATABASE_URL must point to 127.0.0.1 or localhost! Halting.");
  process.exit(1);
}

const BENCHMARK_DIR =
  process.env.BENCHMARK_PDF_DIR || path.join(process.cwd(), "scratch", "cache");

interface GroundTruthTarget {
  key: string;
  name: string;
  filename: string;
  sourceDoc: string;
  page: number;
  tableNum: string;
  refNumericCount: number;
  expectedCols: number;
  expectedRows: number;
}

/**
 * Benchmark manuscripts are open-access peer-reviewed literature.
 * Authorized developers/researchers provide these PDF files in BENCHMARK_PDF_DIR (or scratch/cache/):
 * 1. arunet.pdf        - ARU-Net Table 2 (arXiv:2009.05609)
 * 2. su.pdf            - Su et al. Table 2 (PMC8379201 / Sci Rep)
 * 3. zakareya.pdf      - Zakareya et al. Table 2 (PMC9818814 / Diagnostics)
 * 4. kim.pdf           - Kim et al. Table 3 (PMC8072126 / Sensors)
 * 5. pointpillars.pdf  - PointPillars Table 1 (CVPR 2019 / arXiv:1812.05784)
 */
const BENCHMARKS: GroundTruthTarget[] = [
  {
    key: "arunet",
    name: "ARU-Net Table 2 (TUS Dataset)",
    filename: "arunet.pdf",
    sourceDoc: "arXiv:2009.05609",
    page: 8,
    tableNum: "Table 2",
    refNumericCount: 40,
    expectedCols: 6,
    expectedRows: 8,
  },
  {
    key: "su",
    name: "Su et al. Table 2 (ML Models)",
    filename: "su.pdf",
    sourceDoc: "PMC8379201",
    page: 9,
    tableNum: "Table 2",
    refNumericCount: 60,
    expectedCols: 8,
    expectedRows: 6,
  },
  {
    key: "zakareya",
    name: "Zakareya et al. Table 2 (Confusion Matrix)",
    filename: "zakareya.pdf",
    sourceDoc: "PMC9818814",
    page: 17,
    tableNum: "Table 2",
    refNumericCount: 4,
    expectedCols: 3,
    expectedRows: 3,
  },
  {
    key: "kim",
    name: "Kim et al. Table 3 (Ensembles & STDs)",
    filename: "kim.pdf",
    sourceDoc: "PMC8072126",
    page: 11,
    tableNum: "Table 3",
    refNumericCount: 20,
    expectedCols: 6,
    expectedRows: 4,
  },
  {
    key: "pointpillars",
    name: "PointPillars Table 1 (KITTI BEV)",
    filename: "pointpillars.pdf",
    sourceDoc: "CVPR 2019 / arXiv:1812.05784",
    page: 6,
    tableNum: "Table 1",
    refNumericCount: 75,
    expectedCols: 13,
    expectedRows: 10,
  },
];

async function runBenchmarkValidation() {
  console.log("================================================================================");
  console.log(" AI RESEARCH HUB — PHASE 3D: MASTER SCIENTIFIC TABLE BENCHMARK HARNESS");
  console.log(" Target: 127.0.0.1:5432/ai_research_hub (Isolated Local Database)");
  console.log(` Benchmark Directory: ${BENCHMARK_DIR}`);
  console.log("================================================================================\n");

  // Check if cache files exist
  const missingFiles = BENCHMARKS.filter(
    (b) => !fs.existsSync(path.resolve(BENCHMARK_DIR, b.filename))
  );
  if (missingFiles.length > 0) {
    console.error("================================================================================");
    console.error(" FATAL: REQUIRED BENCHMARK PDF FIXTURES MISSING");
    console.error("================================================================================");
    console.error(`Missing PDF fixtures (${missingFiles.length}):`);
    for (const m of missingFiles) {
      console.error(` - ${m.filename} [${m.name}] (Source: ${m.sourceDoc})`);
    }
    console.error("\nHOW TO PROVIDE BENCHMARK FIXTURES:");
    console.error("1. Place the open-access benchmark PDFs in 'scratch/cache/' or specify path:");
    console.error("   BENCHMARK_PDF_DIR=/path/to/pdfs npx tsx tests/scientific-table-benchmark.test.ts");
    console.error("2. Required files: arunet.pdf, su.pdf, zakareya.pdf, kim.pdf, pointpillars.pdf.");
    console.error("3. Note: Raw PDF binaries must never be committed to git repositories.");
    console.error("================================================================================\n");
    process.exit(1);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: LOCAL_DB_URL } } });
  const repo = new PrismaTableRepository(prisma as any);
  const orchestrator = new TableEvidenceOrchestrator(repo);

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition: boolean, testId: string, desc: string) {
    if (condition) {
      console.log(`[PASS] ${testId}: ${desc}`);
      passedTests++;
    } else {
      console.error(`[FAIL] ${testId}: ${desc}`);
      failedTests++;
    }
  }

  const testPaperPrefix = "stage3d-fixture-";
  await prisma.paper.deleteMany({
    where: { id: { startsWith: testPaperPrefix } },
  });

  console.log("• Step 1: Executing Ingestion, Hierarchical Reconstruction & Verification Across 5 Benchmarks...\n");

  const results: Record<string, any> = {};

  for (const b of BENCHMARKS) {
    const pdfBuf = fs.readFileSync(path.resolve(BENCHMARK_DIR, b.filename));
    const paper = await prisma.paper.create({
      data: {
        id: `${testPaperPrefix}${b.key}`,
        title: `Phase 3D Benchmark: ${b.name}`,
        abstract: "Hierarchical scientific table reconstruction test fixture.",
      },
    });

    const startTime = Date.now();
    const result = await orchestrator.executeWorkflow({
      paperId: paper.id,
      pdfBuffer: pdfBuf,
      targetPageNumber: b.page,
      targetTableNumber: b.tableNum,
      engineVersion: "hierarchical-spatial-extractor-v1.0",
      verifierVersion: "geometric-token-verifier-v1.0",
    });
    const elapsedMs = Date.now() - startTime;

    results[b.key] = { ...result, elapsedMs };
    console.log(`  ✓ Processed ${b.name} in ${elapsedMs}ms:`);
    console.log(
      `    - Tables: ${result.tables.length}, Candidates: ${result.summary.totalCandidateCells}, Verified: ${result.summary.totalVerifiedCells}, Rejected: ${result.summary.totalRejectedCells}`
    );
  }

  console.log("\n--------------------------------------------------------------------------------");
  console.log(" PART 1: POINTPILLARS HIERARCHICAL COLUMN & SUBCOLUMN RECONSTRUCTION");
  console.log("--------------------------------------------------------------------------------");

  const ppRun = results.pointpillars;
  const ppTable = ppRun.tables[0].table;
  const ppCells = await prisma.tableCell.findMany({
    where: { paperId: `${testPaperPrefix}pointpillars` },
  });

  const headerHierarchy = ppTable.headerHierarchy as any;
  assert(
    headerHierarchy.columnHeaders.length === 13,
    "PP_COL_COUNT_13",
    `PointPillars Table 1 identified exactly 13 columns (Found ${headerHierarchy.columnHeaders.length})`
  );
  assert(
    headerHierarchy.superHeaders.includes("Car") &&
      headerHierarchy.superHeaders.includes("Pedestrian") &&
      headerHierarchy.superHeaders.includes("Cyclist"),
    "PP_SUPER_HEADERS",
    `PointPillars superHeaders include Car, Pedestrian, Cyclist: ${JSON.stringify(headerHierarchy.superHeaders)}`
  );

  // Verify explicit hierarchical header paths
  const carEasyCell = ppCells.find(
    (c) =>
      c.modelOrMethod === "PointPillars" &&
      Array.isArray(c.headerPath) &&
      (c.headerPath as string[]).join(" > ") === "Car > Easy"
  );
  assert(
    !!carEasyCell && carEasyCell.normalizedNumericValue === 88.35,
    "PP_CAR_EASY_PATH",
    `PointPillars Car Easy cell path 'Car > Easy' parsed with exact value 88.35 (Found ${carEasyCell?.normalizedNumericValue})`
  );

  const carModCell = ppCells.find(
    (c) =>
      c.modelOrMethod === "PointPillars" &&
      Array.isArray(c.headerPath) &&
      (c.headerPath as string[]).join(" > ") === "Car > Mod."
  );
  assert(
    !!carModCell && carModCell.normalizedNumericValue === 86.1,
    "PP_CAR_MOD_PATH",
    `PointPillars Car Mod cell path 'Car > Mod.' parsed with exact value 86.10 (Found ${carModCell?.normalizedNumericValue})`
  );

  const carHardCell = ppCells.find(
    (c) =>
      c.modelOrMethod === "PointPillars" &&
      Array.isArray(c.headerPath) &&
      (c.headerPath as string[]).join(" > ") === "Car > Hard"
  );
  assert(
    !!carHardCell && carHardCell.normalizedNumericValue === 79.83,
    "PP_CAR_HARD_PATH",
    `PointPillars Car Hard cell path 'Car > Hard' parsed with exact value 79.83 (Found ${carHardCell?.normalizedNumericValue})`
  );

  const speedCell = ppCells.find(
    (c) =>
      c.modelOrMethod === "PointPillars" &&
      Array.isArray(c.headerPath) &&
      (c.headerPath as string[]).some((h) => h.includes("Speed") || h.includes("(Hz)"))
  );
  assert(
    !!speedCell && speedCell.normalizedNumericValue === 62,
    "PP_SPEED_CELL",
    `PointPillars Speed cell path includes Speed/(Hz) with exact value 62 (Found ${speedCell?.normalizedNumericValue})`
  );

  const ppVerified = ppCells.filter((c) => c.verificationStatus === "VERIFIED");
  const ppNumericVerified = ppVerified.filter((c) =>
    isScientificNumericalMeasurement({
      rawPrintedValue: c.rawPrintedValue,
      normalizedNumericValue: c.normalizedNumericValue,
      modelOrMethod: c.modelOrMethod,
      headerPath: (c.headerPath as string[]) || [],
      rowIdx: c.rowIdx,
      colIdx: c.colIdx,
    })
  );

  console.log(
    `PointPillars Numerical Recall: ${ppNumericVerified.length} / 75 (${(
      (ppNumericVerified.length / 75) *
      100
    ).toFixed(1)}%)`
  );
  assert(
    ppNumericVerified.length === 75,
    "PP_NUMERIC_RECALL_75",
    `PointPillars verified exactly 75/75 reference numerical measurements (100% recall)`
  );

  const ppModalityCells = ppVerified.filter((c) =>
    ["Lidar", "Lidar & Img.", "Lidar & Map"].includes(c.rawPrintedValue)
  );
  assert(
    ppModalityCells.length === 10,
    "PP_MODALITY_10",
    `PointPillars verified exactly 10 categorical modality cells (Found ${ppModalityCells.length})`
  );

  const ppNaCells = ppVerified.filter((c) => c.rawPrintedValue === "N/A" || c.rawPrintedValue === "-");
  assert(
    ppNaCells.length === 35,
    "PP_NA_CELLS_35",
    `PointPillars verified exactly 35 missing N/A cells (Found ${ppNaCells.length})`
  );

  console.log("\n--------------------------------------------------------------------------------");
  console.log(" PART 2: INDEPENDENT BENCHMARK GROUND-TRUTH RECONCILIATION");
  console.log("--------------------------------------------------------------------------------");

  const synthMeasurements: Record<string, any[]> = {};
  for (const b of BENCHMARKS) {
    synthMeasurements[b.key] = await orchestrator.getActiveVerifiedNumericalMeasurements(
      `${testPaperPrefix}${b.key}`,
      null,
      true
    );
    const verifiedCount = synthMeasurements[b.key].length;
    const recall = (verifiedCount / b.refNumericCount) * 100;
    console.log(
      `• Benchmark [${b.key.toUpperCase()}]: Ref=${b.refNumericCount} | Verified=${verifiedCount} | Recall=${recall.toFixed(
        1
      )}%`
    );
    assert(
      verifiedCount === b.refNumericCount,
      `RECALL_${b.key.toUpperCase()}`,
      `${b.name} verified exactly ${b.refNumericCount}/${b.refNumericCount} numerical measurements`
    );
  }

  const corpusTotal = Object.values(synthMeasurements).reduce((s, list) => s + list.length, 0);
  console.log(
    `\nTotal verified scientific numerical measurements across corpus: ${corpusTotal} (Target: 199)`
  );
  assert(
    corpusTotal === 199,
    "CORPUS_TOTAL_199",
    `Corpus total scientific measurements: exactly 199 (40 + 60 + 4 + 20 + 75 = 199)`
  );

  console.log("\n--------------------------------------------------------------------------------");
  console.log(" PART 3: NEGATIVE ATTRIBUTION & BOUNDARY DRIFT CONTROLS");
  console.log("--------------------------------------------------------------------------------");

  // Load Su layout for negative controls
  const suBuf = fs.readFileSync(path.resolve(BENCHMARK_DIR, "su.pdf"));
  const { extractTextItems } = require("unpdf");
  const { items: allSuItems } = await extractTextItems(new Uint8Array(suBuf));
  const suPageTokens: NativeTextItem[] = (allSuItems[8] || []).map((it: any) => ({
    str: it.str,
    x: it.x,
    y: it.y,
    width: it.width,
    height: it.height,
  }));

  const extractor = new SpatialTableExtractor();
  const tablesOnP9 = extractor.extractTablesFromPage(9, allSuItems[8] as any);
  const suExtTable = tablesOnP9.find((t: any) => t.tableNumber.includes("Table 2")) || tablesOnP9[0];

  const geomLayout: TableGeometryLayout = orchestrator.buildGeometryLayout(suExtTable, suPageTokens, {
    datasetNames: ["Multimodal Radiomics LNTB"],
    sourcePdfHash: results.su.run.sourcePdfHash,
  });

  // Negative Control 1: Wrong Model
  const negModel = verifyCellEvidence(
    {
      rawPrintedValue: "0.896(0.845–0.947)",
      numericValue: 0.896,
      modelOrMethod: "DenseNet-161",
      groupOrSubrow: "Training Set",
      datasetName: "Multimodal Radiomics LNTB",
      sourcePdfHash: results.su.run.sourcePdfHash,
      headerPath: ["AUC (95% CI)"],
      rowIdx: 0,
      colIdx: 2,
    },
    geomLayout,
    suPageTokens
  );
  assert(
    negModel.status === "REJECTED" && negModel.rowMisattribution,
    "NEG_WRONG_MODEL",
    "Wrong model rejected with rowMisattribution=true"
  );

  // Negative Control 2: Wrong Header Metric
  const negHeader = verifyCellEvidence(
    {
      rawPrintedValue: "0.896(0.845–0.947)",
      numericValue: 0.896,
      modelOrMethod: "LR",
      groupOrSubrow: "Training Set",
      datasetName: "Multimodal Radiomics LNTB",
      sourcePdfHash: results.su.run.sourcePdfHash,
      headerPath: ["Specificity"],
      rowIdx: 0,
      colIdx: 2,
    },
    geomLayout,
    suPageTokens
  );
  assert(
    negHeader.status === "REJECTED" && negHeader.columnShiftError,
    "NEG_WRONG_METRIC",
    "Wrong metric header rejected with columnShiftError=true"
  );

  // Negative Control 3: Cross-Row Duplicate
  const negDup = verifyCellEvidence(
    {
      rawPrintedValue: "1.000",
      numericValue: 1.0,
      modelOrMethod: "LR",
      groupOrSubrow: "Training Set",
      datasetName: "Multimodal Radiomics LNTB",
      sourcePdfHash: results.su.run.sourcePdfHash,
      headerPath: ["AUC (95% CI)"],
      rowIdx: 0,
      colIdx: 2,
    },
    geomLayout,
    suPageTokens
  );
  assert(
    negDup.status === "REJECTED" && negDup.rowMisattribution,
    "NEG_CROSS_ROW_DUP",
    "Cross-row duplicate rejected with rowMisattribution=true"
  );

  console.log("\n--------------------------------------------------------------------------------");
  console.log(" PART 4: DIRECT POSTGRESQL PERSISTENCE & AUDIT LOG INTEGRITY");
  console.log("--------------------------------------------------------------------------------");

  const dbRuns = await prisma.tableExtractionRun.findMany({
    where: { paperId: { startsWith: testPaperPrefix } },
    include: {
      tables: {
        include: {
          cells: {
            where: { verificationStatus: "VERIFIED" },
            take: 2,
            include: { auditLogs: true },
          },
        },
      },
    },
  });

  assert(
    dbRuns.length === 5,
    "DB_RUNS_COUNT",
    `Persisted exactly 5 extraction runs in PostgreSQL (Found ${dbRuns.length})`
  );
  for (const r of dbRuns) {
    assert(
      r.isActive === true && r.status === "COMPLETED",
      `DB_RUN_STATUS_${r.id}`,
      `Run ${r.id} isActive=true, status=COMPLETED`
    );
    for (const t of r.tables) {
      for (const c of t.cells) {
        assert(
          c.verificationStatus === "VERIFIED" && c.auditLogs.length > 0,
          `DB_CELL_AUDIT_${c.id}`,
          `Cell ${c.id} verified with ${c.auditLogs.length} audit logs`
        );
      }
    }
  }

  console.log("\n• Step 5: Cleaning up Phase 3D synthetic test paper fixtures via CASCADE...");
  await prisma.paper.deleteMany({
    where: { id: { startsWith: testPaperPrefix } },
  });
  console.log("  [PASS] Cleaned up all synthetic fixtures.");

  console.log("\n================================================================================");
  console.log(
    ` SUMMARY: ${passedTests}/${passedTests + failedTests} Phase 3D Tests Passed (${(
      (passedTests / (passedTests + failedTests)) *
      100
    ).toFixed(1)}%)`
  );
  console.log("================================================================================\n");

  await prisma.$disconnect();

  if (failedTests > 0) {
    process.exit(1);
  }
}

runBenchmarkValidation().catch((err) => {
  console.error("FATAL ERROR in Phase 3D benchmark validation:", err);
  process.exit(1);
});
