-- CreateTable
CREATE TABLE "document_revisions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled Research Document',
    "docType" "DocumentType" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB,
    "textContent" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "cslStyleId" TEXT DEFAULT 'apa',
    "cslRevisionSha" TEXT,
    "citations" JSONB,
    "linkedPapers" JSONB,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "document_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_revisions_documentId_idx" ON "document_revisions"("documentId");

-- CreateIndex
CREATE INDEX "document_revisions_documentId_version_idx" ON "document_revisions"("documentId", "version");

-- CreateIndex
CREATE INDEX "document_revisions_createdAt_idx" ON "document_revisions"("createdAt");

-- AddForeignKey
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "research_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

