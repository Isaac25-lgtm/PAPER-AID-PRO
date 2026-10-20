-- Phase 8B: Persistent CSL Citation Catalog, Styles Storage, and Manuscript Reproducibility

-- 1. Create CslCatalogRevision table
CREATE TABLE IF NOT EXISTS "csl_catalog_revisions" (
    "id" TEXT NOT NULL,
    "revisionSha" TEXT NOT NULL,
    "parentSha" TEXT,
    "sourceBranch" TEXT NOT NULL DEFAULT 'v1.0.2',
    "status" TEXT NOT NULL DEFAULT 'ARCHIVED',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "stylesCount" INTEGER NOT NULL DEFAULT 0,
    "addedCount" INTEGER NOT NULL DEFAULT 0,
    "modifiedCount" INTEGER NOT NULL DEFAULT 0,
    "removedCount" INTEGER NOT NULL DEFAULT 0,
    "validationErrors" JSONB,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "csl_catalog_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "csl_catalog_revisions_revisionSha_key" UNIQUE ("revisionSha")
);

-- 2. Create CslStyleContent table (Deduplicated XML storage by SHA-256 checksum)
CREATE TABLE IF NOT EXISTS "csl_style_contents" (
    "id" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "xmlContent" TEXT NOT NULL,
    "byteSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "csl_style_contents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "csl_style_contents_checksum_key" UNIQUE ("checksum")
);

-- 3. Create CslStyleRecord table (Metadata & revision-style mapping)
CREATE TABLE IF NOT EXISTS "csl_style_records" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "styleType" TEXT NOT NULL DEFAULT 'INDEPENDENT',
    "parentStyleId" TEXT,
    "citationFormat" TEXT,
    "contentId" TEXT,
    "isDeprecated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "csl_style_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "csl_style_records_revisionId_styleId_key" UNIQUE ("revisionId", "styleId")
);

-- 4. Create CslSyncLock table (Distributed concurrency lock)
CREATE TABLE IF NOT EXISTS "csl_sync_locks" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "csl_sync_locks_pkey" PRIMARY KEY ("id")
);

-- 5. Create indexes for performance and query efficiency
CREATE INDEX IF NOT EXISTS "csl_catalog_revisions_isActive_idx" ON "csl_catalog_revisions"("isActive");
CREATE INDEX IF NOT EXISTS "csl_catalog_revisions_createdAt_idx" ON "csl_catalog_revisions"("createdAt");

CREATE INDEX IF NOT EXISTS "csl_style_records_revisionId_idx" ON "csl_style_records"("revisionId");
CREATE INDEX IF NOT EXISTS "csl_style_records_styleId_idx" ON "csl_style_records"("styleId");
CREATE INDEX IF NOT EXISTS "csl_style_records_contentId_idx" ON "csl_style_records"("contentId");

-- 6. Extend research_documents with CSL style and revision tracking
ALTER TABLE "research_documents" 
ADD COLUMN IF NOT EXISTS "cslStyleId" TEXT DEFAULT 'apa',
ADD COLUMN IF NOT EXISTS "cslRevisionSha" TEXT;

CREATE INDEX IF NOT EXISTS "research_documents_cslRevisionSha_idx" ON "research_documents"("cslRevisionSha");

-- 7. Seed Singleton Lock Record if not exists
INSERT INTO "csl_sync_locks" ("id", "isLocked", "createdAt", "updatedAt")
VALUES ('singleton', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- 8. Seed Baseline Catalog Revision (v1.0.2-baseline-catalog)
INSERT INTO "csl_catalog_revisions" (
    "id",
    "revisionSha",
    "sourceBranch",
    "status",
    "isActive",
    "stylesCount",
    "addedCount",
    "modifiedCount",
    "removedCount",
    "createdAt",
    "activatedAt"
)
VALUES (
    'rev-baseline',
    'v1.0.2-baseline-catalog',
    'v1.0.2',
    'ACTIVE',
    true,
    10870,
    10870,
    0,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("revisionSha") DO NOTHING;

-- 9. Backfill existing manuscripts to pin them to the immutable baseline revision
-- This guarantees existing manuscripts retain 100% reproducible citation formatting and never silently follow future updates.
UPDATE "research_documents"
SET "cslRevisionSha" = 'v1.0.2-baseline-catalog',
    "cslStyleId" = COALESCE("cslStyleId", 'apa')
WHERE "cslRevisionSha" IS NULL;

-- 10. Foreign Keys (Safe constraint attachment)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'research_documents_cslRevisionSha_fkey'
    ) THEN
        ALTER TABLE "research_documents" 
        ADD CONSTRAINT "research_documents_cslRevisionSha_fkey" 
        FOREIGN KEY ("cslRevisionSha") REFERENCES "csl_catalog_revisions"("revisionSha") 
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'csl_style_records_revisionId_fkey'
    ) THEN
        ALTER TABLE "csl_style_records" 
        ADD CONSTRAINT "csl_style_records_revisionId_fkey" 
        FOREIGN KEY ("revisionId") REFERENCES "csl_catalog_revisions"("id") 
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'csl_style_records_contentId_fkey'
    ) THEN
        ALTER TABLE "csl_style_records" 
        ADD CONSTRAINT "csl_style_records_contentId_fkey" 
        FOREIGN KEY ("contentId") REFERENCES "csl_style_contents"("id") 
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
