-- AlterTable
ALTER TABLE "ai_summaries" ADD COLUMN IF NOT EXISTS "citations" JSONB;
