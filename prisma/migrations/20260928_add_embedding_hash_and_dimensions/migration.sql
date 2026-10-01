-- AlterTable
ALTER TABLE "paper_chunks" ADD COLUMN IF NOT EXISTS "embeddingDimensions" INTEGER;
ALTER TABLE "paper_chunks" ADD COLUMN IF NOT EXISTS "embeddingInputHash" TEXT;
