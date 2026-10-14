-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('DRAFT', 'MANUSCRIPT', 'PROPOSAL', 'LITERATURE_REVIEW');

-- CreateEnum
CREATE TYPE "CitationType" AS ENUM ('BIBLIOGRAPHIC', 'PASSAGE_VERIFIED');

-- CreateTable
CREATE TABLE "research_documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled Research Document',
    "content" JSONB,
    "textContent" TEXT,
    "docType" "DocumentType" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_citations" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "chunkId" TEXT,
    "citationKey" TEXT,
    "citationText" TEXT NOT NULL,
    "citationType" "CitationType" NOT NULL DEFAULT 'BIBLIOGRAPHIC',
    "pageNumber" INTEGER,
    "section" TEXT,
    "prefix" TEXT,
    "suffix" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_papers" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_papers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "research_documents_userId_idx" ON "research_documents"("userId");

-- CreateIndex
CREATE INDEX "research_documents_updatedAt_idx" ON "research_documents"("updatedAt");

-- CreateIndex
CREATE INDEX "document_citations_documentId_idx" ON "document_citations"("documentId");

-- CreateIndex
CREATE INDEX "document_citations_paperId_idx" ON "document_citations"("paperId");

-- CreateIndex
CREATE INDEX "document_citations_chunkId_idx" ON "document_citations"("chunkId");

-- CreateIndex
CREATE INDEX "document_papers_documentId_idx" ON "document_papers"("documentId");

-- CreateIndex
CREATE INDEX "document_papers_paperId_idx" ON "document_papers"("paperId");

-- CreateIndex
CREATE UNIQUE INDEX "document_papers_documentId_paperId_key" ON "document_papers"("documentId", "paperId");

-- AddForeignKey
ALTER TABLE "research_documents" ADD CONSTRAINT "research_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_citations" ADD CONSTRAINT "document_citations_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "research_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_citations" ADD CONSTRAINT "document_citations_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_citations" ADD CONSTRAINT "document_citations_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "paper_chunks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_papers" ADD CONSTRAINT "document_papers_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "research_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_papers" ADD CONSTRAINT "document_papers_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
