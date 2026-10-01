-- CreateExtension
CREATE EXTENSION IF NOT EXISTS vector;

-- AlterTable
ALTER TABLE "paper_chunks" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);
ALTER TABLE "paper_chunks" ADD COLUMN IF NOT EXISTS "embeddingModel" TEXT;
ALTER TABLE "paper_chunks" ADD COLUMN IF NOT EXISTS "embeddedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "paper_chunks_embedding_hnsw_idx" ON "paper_chunks" USING hnsw ("embedding" vector_cosine_ops);
