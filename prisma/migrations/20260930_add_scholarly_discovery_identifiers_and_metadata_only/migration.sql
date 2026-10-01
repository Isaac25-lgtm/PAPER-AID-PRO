-- AlterEnum
ALTER TYPE "PaperProcessingStatus" ADD VALUE 'METADATA_ONLY';

-- AlterTable
ALTER TABLE "papers" ADD COLUMN "pmid" TEXT,
ADD COLUMN "pmcid" TEXT,
ADD COLUMN "semanticScholarId" TEXT,
ADD COLUMN "isOpenAccess" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "sourceProvenance" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "papers_pmid_key" ON "papers"("pmid");

-- CreateIndex
CREATE UNIQUE INDEX "papers_pmcid_key" ON "papers"("pmcid");

-- CreateIndex
CREATE UNIQUE INDEX "papers_semanticScholarId_key" ON "papers"("semanticScholarId");
