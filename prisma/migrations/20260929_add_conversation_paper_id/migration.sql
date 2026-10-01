-- AlterTable
ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "paperId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_conversations_paperId_idx" ON "ai_conversations"("paperId");
CREATE INDEX IF NOT EXISTS "ai_conversations_userId_paperId_idx" ON "ai_conversations"("userId", "paperId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversations_paperId_fkey'
  ) THEN
    ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
