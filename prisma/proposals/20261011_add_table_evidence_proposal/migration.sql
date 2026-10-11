-- =============================================================================
-- AI RESEARCH HUB — PHASE 3C STAGE 2B DEVELOPMENT MIGRATION PROPOSAL
-- Migration: 20261011_add_table_evidence_proposal
--
-- TARGET: Isolated Development PostgreSQL Database ONLY
-- CRITICAL SAFETY: DO NOT EXECUTE AGAINST REMOTE PRODUCTION / STAGING SUPABASE!
--
-- SUMMARY OF CHANGES:
-- 1. Adds 'TABLE_EXTRACTION' to ProcessingStage enum.
-- 2. Creates enums: TableExtractionStatus, TableVerificationStatus, TableExtractionMethod, TableMetricUnit.
-- 3. Creates tables: table_extraction_runs, paper_tables, table_cells, table_cell_audit_logs.
-- 4. Enforces STRICT SAFETY DEFAULT: table_cells.verificationStatus defaults to 'UNVERIFIED'.
-- 5. Enforces CHECK constraint: only COMPLETED extraction runs can be marked active.
-- 6. Enforces partial unique index: at most ONE active extraction run per paper.
-- 7. Enforces composite foreign keys:
--    - paper_tables -> table_extraction_runs(id, paperId, sourcePdfHash)
--    - paper_tables (continuation) -> paper_tables(id, extractionRunId, paperId)
--    - table_cells -> paper_tables(id, extractionRunId, paperId)
-- =============================================================================

-- Step 1: Extend ProcessingStage enum
ALTER TYPE "ProcessingStage" ADD VALUE IF NOT EXISTS 'TABLE_EXTRACTION';

-- Step 2: Create new enums
CREATE TYPE "TableExtractionStatus" AS ENUM (
    'PENDING',
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'SUPERSEDED'
);

CREATE TYPE "TableVerificationStatus" AS ENUM (
    'UNVERIFIED',
    'VERIFIED',
    'UNVERIFIED_VISUAL_ONLY',
    'AMBIGUOUS',
    'DISAGREEMENT',
    'REJECTED'
);

CREATE TYPE "TableExtractionMethod" AS ENUM (
    'SPATIAL_2D',
    'VISION_MULTIMODAL',
    'HYBRID_RECONCILED'
);

CREATE TYPE "TableMetricUnit" AS ENUM (
    'PERCENT',
    'RATIO',
    'COUNT',
    'HERTZ',
    'MILLISECONDS',
    'DECIBELS',
    'UNSPECIFIED'
);

-- Step 3: Create table_extraction_runs table
CREATE TABLE "table_extraction_runs" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "processingJobId" TEXT,
    "sourcePdfHash" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "extractionMethod" "TableExtractionMethod" NOT NULL DEFAULT 'HYBRID_RECONCILED',
    "status" "TableExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "tableCount" INTEGER NOT NULL DEFAULT 0,
    "cellCount" INTEGER NOT NULL DEFAULT 0,
    "verifiedCellCount" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_extraction_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "table_extraction_runs_id_paperId_sourcePdfHash_key" UNIQUE ("id", "paperId", "sourcePdfHash"),
    CONSTRAINT "table_extraction_runs_active_completed_check" CHECK ("isActive" = false OR ("isActive" = true AND "status" = 'COMPLETED'))
);

-- Partial Unique Index: Exactly one active extraction run per paper in PostgreSQL
CREATE UNIQUE INDEX "table_extraction_runs_paperId_active_unique"
    ON "table_extraction_runs"("paperId")
    WHERE "isActive" = true;

CREATE INDEX "table_extraction_runs_paperId_idx" ON "table_extraction_runs"("paperId");
CREATE INDEX "table_extraction_runs_sourcePdfHash_idx" ON "table_extraction_runs"("sourcePdfHash");
CREATE INDEX "table_extraction_runs_paperId_isActive_idx" ON "table_extraction_runs"("paperId", "isActive");
CREATE INDEX "table_extraction_runs_status_idx" ON "table_extraction_runs"("status");

-- Step 4: Create paper_tables table
CREATE TABLE "paper_tables" (
    "id" TEXT NOT NULL,
    "extractionRunId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "tableIndex" INTEGER NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "tableNumber" TEXT NOT NULL,
    "caption" TEXT,
    "multiPagePart" INTEGER NOT NULL DEFAULT 1,
    "parentTableId" TEXT,
    "tableBbox" JSONB NOT NULL,
    "sourcePdfHash" TEXT NOT NULL,
    "headerHierarchy" JSONB NOT NULL DEFAULT '{}'::JSONB,
    "datasetNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "rawMarkdown" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paper_tables_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "paper_tables_extractionRunId_tableIndex_key" UNIQUE ("extractionRunId", "tableIndex"),
    CONSTRAINT "paper_tables_id_extractionRunId_paperId_key" UNIQUE ("id", "extractionRunId", "paperId")
);

CREATE INDEX "paper_tables_paperId_idx" ON "paper_tables"("paperId");
CREATE INDEX "paper_tables_extractionRunId_idx" ON "paper_tables"("extractionRunId");
CREATE INDEX "paper_tables_sourcePdfHash_idx" ON "paper_tables"("sourcePdfHash");
CREATE INDEX "paper_tables_paperId_tableNumber_idx" ON "paper_tables"("paperId", "tableNumber");

-- Step 5: Create table_cells table
CREATE TABLE "table_cells" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "extractionRunId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "rowIdx" INTEGER NOT NULL,
    "colIdx" INTEGER NOT NULL,
    "rowSpan" INTEGER NOT NULL DEFAULT 1,
    "colSpan" INTEGER NOT NULL DEFAULT 1,
    "rawPrintedValue" TEXT NOT NULL,
    "verbatimPdfTokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "isMissingOrNa" BOOLEAN NOT NULL DEFAULT false,
    "footnoteReferences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "normalizedNumericValue" DOUBLE PRECISION,
    "confidenceInterval" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "standardDeviation" DOUBLE PRECISION,
    "unit" "TableMetricUnit" NOT NULL DEFAULT 'UNSPECIFIED',
    "scale" TEXT,
    "modelOrMethod" TEXT NOT NULL,
    "groupOrSubrow" TEXT,
    "datasetOrCohort" TEXT,
    "experimentalCondition" TEXT,
    "headerPath" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "cellBbox" JSONB,
    "rowInterval" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "colInterval" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "cropImageUri" TEXT,
    "verificationStatus" "TableVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verificationMethod" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "verifierVersion" TEXT,
    "verificationNotes" TEXT,
    "transcriptionError" BOOLEAN NOT NULL DEFAULT false,
    "columnShiftError" BOOLEAN NOT NULL DEFAULT false,
    "rowMisattribution" BOOLEAN NOT NULL DEFAULT false,
    "coordinateMismatch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_cells_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "table_cells_tableId_rowIdx_colIdx_key" UNIQUE ("tableId", "rowIdx", "colIdx")
);

CREATE INDEX "table_cells_tableId_idx" ON "table_cells"("tableId");
CREATE INDEX "table_cells_extractionRunId_idx" ON "table_cells"("extractionRunId");
CREATE INDEX "table_cells_paperId_verificationStatus_idx" ON "table_cells"("paperId", "verificationStatus");
CREATE INDEX "table_cells_verificationStatus_idx" ON "table_cells"("verificationStatus");
CREATE INDEX "table_cells_modelOrMethod_verificationStatus_idx" ON "table_cells"("modelOrMethod", "verificationStatus");
CREATE INDEX "table_cells_datasetOrCohort_verificationStatus_idx" ON "table_cells"("datasetOrCohort", "verificationStatus");

-- Step 6: Create table_cell_audit_logs table
CREATE TABLE "table_cell_audit_logs" (
    "id" TEXT NOT NULL,
    "cellId" TEXT NOT NULL,
    "previousStatus" "TableVerificationStatus" NOT NULL,
    "newStatus" "TableVerificationStatus" NOT NULL,
    "decisionReason" TEXT NOT NULL,
    "verifierVersion" TEXT NOT NULL,
    "sourcePdfHash" TEXT NOT NULL,
    "checkedTokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "errorFlags" JSONB,
    "actor" TEXT NOT NULL DEFAULT 'SYSTEM_CELL_VERIFIER',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_cell_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "table_cell_audit_logs_cellId_idx" ON "table_cell_audit_logs"("cellId");
CREATE INDEX "table_cell_audit_logs_timestamp_idx" ON "table_cell_audit_logs"("timestamp");
CREATE INDEX "table_cell_audit_logs_newStatus_idx" ON "table_cell_audit_logs"("newStatus");

-- Step 7: Add Foreign Key Constraints

-- table_extraction_runs foreign keys
ALTER TABLE "table_extraction_runs" ADD CONSTRAINT "table_extraction_runs_paperId_fkey"
    FOREIGN KEY ("paperId") REFERENCES "papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "table_extraction_runs" ADD CONSTRAINT "table_extraction_runs_processingJobId_fkey"
    FOREIGN KEY ("processingJobId") REFERENCES "processing_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- paper_tables foreign keys
-- COMPOSITE FK: strictly guarantees table paperId AND sourcePdfHash match the run
ALTER TABLE "paper_tables" ADD CONSTRAINT "paper_tables_extractionRunId_paperId_sourcePdfHash_fkey"
    FOREIGN KEY ("extractionRunId", "paperId", "sourcePdfHash")
    REFERENCES "table_extraction_runs"("id", "paperId", "sourcePdfHash")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "paper_tables" ADD CONSTRAINT "paper_tables_paperId_fkey"
    FOREIGN KEY ("paperId") REFERENCES "papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- COMPOSITE SELF-RELATION FK: strictly guarantees continuation table belongs to same run AND same paper
ALTER TABLE "paper_tables" ADD CONSTRAINT "paper_tables_parentTableId_extractionRunId_paperId_fkey"
    FOREIGN KEY ("parentTableId", "extractionRunId", "paperId")
    REFERENCES "paper_tables"("id", "extractionRunId", "paperId")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- table_cells foreign keys
-- COMPOSITE FK: strictly guarantees cell tableId, extractionRunId, AND paperId match the parent table
ALTER TABLE "table_cells" ADD CONSTRAINT "table_cells_tableId_extractionRunId_paperId_fkey"
    FOREIGN KEY ("tableId", "extractionRunId", "paperId")
    REFERENCES "paper_tables"("id", "extractionRunId", "paperId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "table_cells" ADD CONSTRAINT "table_cells_paperId_fkey"
    FOREIGN KEY ("paperId") REFERENCES "papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- table_cell_audit_logs foreign keys
ALTER TABLE "table_cell_audit_logs" ADD CONSTRAINT "table_cell_audit_logs_cellId_fkey"
    FOREIGN KEY ("cellId") REFERENCES "table_cells"("id") ON DELETE CASCADE ON UPDATE CASCADE;
