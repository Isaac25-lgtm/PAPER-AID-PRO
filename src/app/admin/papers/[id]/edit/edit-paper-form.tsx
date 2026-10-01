"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FileText,
  Users,
  Layers,
  Sparkles,
  Link as LinkIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Calendar,
  BookOpen,
  ArrowRight,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { updatePaper, generatePaperSummaryAction, generatePaperEmbeddingsAction } from "../../actions";
import { RefreshCw, FileSearch, CheckCircle, ShieldCheck, Database, Binary, Cpu } from "lucide-react";
import type { PaperEmbeddingStats } from "@/lib/ai/embedding-pipeline";

interface CategoryOption {
  id: string;
  name: string;
  slug: string;
}

interface PaperWithRelations {
  id: string;
  title: string;
  abstract: string;
  journal: string | null;
  doi: string | null;
  arxivId: string | null;
  publicationDate: Date | string | null;
  pdfUrl: string | null;
  storagePath?: string | null;
  status?: string;
  citationCount: number;
  keywords: string[];
  researchQuestion: string | null;
  methodology: string | null;
  results: string | null;
  limitations: string | null;
  conclusion: string | null;
  authors: Array<{
    orderIndex: number;
    author: {
      name: string;
      institution: string | null;
    };
  }>;
  categories: Array<{
    categoryId: string;
    category: {
      id: string;
      name: string;
    };
  }>;
  aiSummary?: {
    id: string;
    summary: string;
    modelUsed: string;
    promptVersion: string | null;
    updatedAt: Date | string;
    citations?: any;
  } | null;
  _count?: {
    chunks: number;
  };
  processingJobs?: Array<{
    id: string;
    stage: string;
    status: string;
    errorMessage: string | null;
    createdAt: Date | string;
  }>;
}

export function EditPaperForm({
  paper,
  categories,
  embeddingStats,
}: {
  paper: PaperWithRelations;
  categories: CategoryOption[];
  embeddingStats?: PaperEmbeddingStats;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const [isSummaryPending, startSummaryTransition] = React.useTransition();
  const [summaryError, setSummaryError] = React.useState<string | null>(null);
  const [summarySuccess, setSummarySuccess] = React.useState<string | null>(null);

  const [isEmbeddingPending, startEmbeddingTransition] = React.useTransition();
  const [embeddingError, setEmbeddingError] = React.useState<string | null>(null);
  const [embeddingSuccess, setEmbeddingSuccess] = React.useState<string | null>(null);

  // Initialize selected category IDs from paper relations
  const [selectedCategories, setSelectedCategories] = React.useState<string[]>(
    paper.categories.map((c) => c.categoryId)
  );

  const toggleCategory = (catId: string) => {
    setSelectedCategories((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  };

  // Format initial authors string: "Name (Institution); Name (Institution)"
  const initialAuthorsString = paper.authors
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((pa) =>
      pa.author.institution
        ? `${pa.author.name} (${pa.author.institution})`
        : pa.author.name
    )
    .join("; ");

  // Format publication date as YYYY-MM-DD for date input
  const initialDateString = paper.publicationDate
    ? new Date(paper.publicationDate).toISOString().split("T")[0]
    : "";

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const formData = new FormData(form);

    // Append selected categories
    selectedCategories.forEach((catId) => {
      formData.append("categoryIds", catId);
    });

    startTransition(async () => {
      const res = await updatePaper(paper.id, formData);
      if (!res.success) {
        setError(res.error || "Failed to update paper.");
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push(`/papers/${paper.id}`);
          router.refresh();
        }, 1000);
      }
    });
  };

  const latestSummaryJob = paper.processingJobs?.find(
    (j) => j.stage === "SUMMARY_GENERATION"
  );
  const isGenerating = isSummaryPending || latestSummaryJob?.status === "RUNNING";
  const hasSummary = !!paper.aiSummary;
  const isSummaryFailed = latestSummaryJob?.status === "FAILED" && !hasSummary;
  const chunkCount = paper._count?.chunks || 0;
  const isReadyToGenerate =
    paper.status === "COMPLETED" && chunkCount > 0 && !hasSummary;

  const handleGenerateSummary = () => {
    setSummaryError(null);
    setSummarySuccess(null);
    startSummaryTransition(async () => {
      const res = await generatePaperSummaryAction(paper.id, {
        forceRegenerate: true,
      });
      if (!res.success) {
        setSummaryError(res.error || "Failed to generate AI summary.");
      } else {
        setSummarySuccess(res.message || "AI Summary successfully generated.");
        router.refresh();
      }
    });
  };

  const handleGenerateEmbeddings = (force = false) => {
    setEmbeddingError(null);
    setEmbeddingSuccess(null);
    startEmbeddingTransition(async () => {
      const res = await generatePaperEmbeddingsAction(paper.id, { force });
      if (!res.success) {
        setEmbeddingError(res.error || "Failed to generate vector embeddings.");
      } else {
        setEmbeddingSuccess(res.message || "Vector embeddings generated successfully.");
        router.refresh();
      }
    });
  };

  const embeddingStatus = embeddingStats?.status || (chunkCount > 0 ? "NOT EMBEDDED" : "NOT EMBEDDED");
  const embeddedChunkCount = embeddingStats?.embeddedChunks ?? 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs sm:text-sm text-red-700 shadow-xs">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs sm:text-sm text-emerald-800 shadow-xs">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>Manuscript updated successfully! Redirecting to paper view...</span>
        </div>
      )}

      {/* Prominent AI Paper Understanding & Evidence Synthesis (Phase 5.1 Hardened) */}
      <Card className="bg-white p-6 sm:p-8 space-y-6 border-indigo-200 shadow-xs ring-1 ring-indigo-50">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                AI Paper Understanding &amp; Evidence Synthesis
              </h2>
              <p className="text-xs text-slate-500">
                Grounded OpenAI scientific synthesis anchored directly to extracted manuscript chunks
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Summary Status:</span>
            {hasSummary ? (
              <Badge variant="success" className="text-xs font-semibold gap-1 font-mono">
                <CheckCircle className="h-3.5 w-3.5" />
                GENERATED
              </Badge>
            ) : isGenerating ? (
              <Badge variant="secondary" className="text-xs font-semibold gap-1 font-mono animate-pulse">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                GENERATING
              </Badge>
            ) : isSummaryFailed ? (
              <Badge variant="destructive" className="text-xs font-semibold gap-1 font-mono">
                <AlertCircle className="h-3.5 w-3.5" />
                FAILED
              </Badge>
            ) : isReadyToGenerate ? (
              <Badge variant="outline" className="text-xs font-semibold text-indigo-700 border-indigo-300 bg-indigo-50/70 font-mono gap-1">
                <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                READY TO GENERATE
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs font-semibold text-slate-400 border-slate-200 font-mono">
                NOT READY
              </Badge>
            )}
          </div>
        </div>

        {summaryError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold">AI Synthesis Error: </span>
              <span>{summaryError}</span>
            </div>
          </div>
        )}

        {summarySuccess && (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800">
            <CheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{summarySuccess}</span>
          </div>
        )}

        {/* 4 Telemetry Metrics */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="space-y-1">
              <span className="text-slate-400 font-medium">AI Summary Status:</span>
              <div className="font-semibold text-slate-900 font-mono">
                {hasSummary ? "GENERATED" : isGenerating ? "GENERATING" : isSummaryFailed ? "FAILED" : isReadyToGenerate ? "READY TO GENERATE" : "NOT READY"}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-slate-400 font-medium">Paper Ingestion:</span>
              <div>
                <Link href="/admin/processing" className="font-semibold font-mono text-indigo-600 hover:underline">
                  {paper.status}
                </Link>
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-slate-400 font-medium">PaperChunks:</span>
              <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                <FileSearch className="h-3.5 w-3.5 text-indigo-600" />
                {chunkCount} Extracted
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-slate-400 font-medium">Model &amp; Prompt:</span>
              <div className="font-mono text-slate-700 truncate">
                {paper.aiSummary?.modelUsed || "gpt-4o-mini"} · {paper.aiSummary?.promptVersion || "paper-summary-v1"}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-3 border-t border-slate-200/80">
            <div className="space-y-0.5 max-w-lg">
              <p className="text-[11px] text-slate-600 font-medium">
                {chunkCount === 0
                  ? "Ingestion incomplete: This paper has 0 extracted chunks. Upload a PDF manuscript below to extract text chunks."
                  : hasSummary
                  ? "Summary currently active. Regenerating will analyze the manuscript chunks and atomically replace the summary."
                  : isReadyToGenerate
                  ? "Paper ingestion complete with extracted chunks. Ready to synthesize grounded evidence via OpenAI."
                  : "Ingestion in progress or incomplete. Once status is COMPLETED and chunks exist, you can generate summary."}
              </p>
              {(paper.storagePath || paper.pdfUrl) && (
                <div className="pt-1">
                  <a
                    href={`/api/papers/${paper.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-700 font-semibold"
                  >
                    <FileText className="h-3 w-3" />
                    View Original PDF
                  </a>
                </div>
              )}
            </div>

            <div className="shrink-0">
              {isReadyToGenerate ? (
                <Button
                  type="button"
                  onClick={handleGenerateSummary}
                  disabled={isPending || isSummaryPending}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold gap-2 px-4 py-2 shadow-sm"
                >
                  {isSummaryPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Generating AI Summary…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      Generate AI Summary
                    </>
                  )}
                </Button>
              ) : hasSummary ? (
                <Button
                  type="button"
                  onClick={handleGenerateSummary}
                  disabled={isPending || isSummaryPending}
                  variant="outline"
                  className="border-indigo-300 text-indigo-700 hover:bg-indigo-50 text-xs font-semibold gap-2 shadow-xs"
                >
                  {isSummaryPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Regenerating…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3.5 w-3.5" />
                      Regenerate AI Summary
                    </>
                  )}
                </Button>
              ) : isGenerating ? (
                <Button disabled className="bg-indigo-400 text-white text-xs gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generating AI Summary…
                </Button>
              ) : isSummaryFailed ? (
                <Button
                  type="button"
                  onClick={handleGenerateSummary}
                  disabled={isPending || isSummaryPending}
                  className="bg-red-600 hover:bg-red-700 text-white text-xs font-semibold gap-2 shadow-xs"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry Summary Generation
                </Button>
              ) : (
                <Button
                  disabled
                  variant="outline"
                  className="text-slate-400 border-slate-200 cursor-not-allowed text-xs"
                  title="Paper must be fully ingested with chunks > 0"
                >
                  Generate AI Summary (Not Ready)
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* 0.2. Vector Embeddings & pgvector Semantic Index (Phase 6) */}
      <Card className="bg-white p-6 sm:p-8 space-y-6 border-indigo-200 shadow-xs ring-1 ring-indigo-50">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-violet-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                Vector Embeddings &amp; pgvector Semantic Index
              </h2>
              <p className="text-xs text-slate-500">
                OpenAI high-dimensional vectors stored in PostgreSQL and indexed with HNSW for hybrid semantic retrieval
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Embedding Status:</span>
            {embeddingStatus === "EMBEDDED" ? (
              <Badge variant="success" className="text-xs font-semibold gap-1 font-mono">
                <CheckCircle className="h-3.5 w-3.5" />
                EMBEDDED
              </Badge>
            ) : embeddingStatus === "EMBEDDING" || isEmbeddingPending ? (
              <Badge variant="warning" className="text-xs font-semibold gap-1 font-mono animate-pulse">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                EMBEDDING
              </Badge>
            ) : embeddingStatus === "PARTIALLY EMBEDDED" ? (
              <Badge variant="warning" className="text-xs font-semibold gap-1 font-mono">
                PARTIALLY EMBEDDED
              </Badge>
            ) : embeddingStatus === "FAILED" ? (
              <Badge variant="destructive" className="text-xs font-semibold gap-1 font-mono">
                FAILED
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs font-semibold gap-1 font-mono text-slate-500">
                NOT EMBEDDED
              </Badge>
            )}
          </div>
        </div>

        {embeddingError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 shadow-xs">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{embeddingError}</span>
          </div>
        )}

        {embeddingSuccess && (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 shadow-xs">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{embeddingSuccess}</span>
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
            <span className="text-slate-500 block mb-0.5">Embedded Chunks</span>
            <span className="font-semibold text-slate-900 text-sm">
              {embeddedChunkCount} / {chunkCount}
            </span>
          </div>
          <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
            <span className="text-slate-500 block mb-0.5">Vector Dimensions</span>
            <span className="font-mono text-indigo-700 font-medium">
              1536 (Float32)
            </span>
          </div>
          <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
            <span className="text-slate-500 block mb-0.5">Embedding Model</span>
            <span className="font-mono text-slate-700 font-medium truncate block">
              {embeddingStats?.embeddingModel || "text-embedding-3-small"}
            </span>
          </div>
          <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
            <span className="text-slate-500 block mb-0.5">Vector Index</span>
            <span className="font-mono text-emerald-700 font-medium">
              HNSW (cosine)
            </span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
          <p className="text-xs text-slate-500">
            {chunkCount === 0
              ? "No chunks available. Please extract manuscript text first."
              : embeddingStatus === "EMBEDDED"
              ? "All chunks are embedded and indexed for hybrid semantic search."
              : "Generate embeddings to index this manuscript in the pgvector database."}
          </p>

          <div className="flex items-center gap-2">
            {embeddingStatus === "EMBEDDED" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending || isEmbeddingPending || chunkCount === 0}
                onClick={() => handleGenerateEmbeddings(true)}
                className="text-xs gap-1.5"
              >
                {isEmbeddingPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Regenerate Embeddings
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={isPending || isEmbeddingPending || chunkCount === 0}
                onClick={() => handleGenerateEmbeddings(false)}
                className="text-xs gap-1.5 bg-violet-600 hover:bg-violet-700 text-white font-semibold"
              >
                {isEmbeddingPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Database className="h-3.5 w-3.5" />
                )}
                Generate Embeddings
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* 1. Core Metadata Card */}
      <Card className="bg-white p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
          <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
            1
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Bibliographic Metadata</h2>
            <p className="text-xs text-slate-500">Core publication credentials and external DOI / arXiv anchors</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="title" className="text-xs font-semibold text-slate-700">
              Paper Title <span className="text-red-500">*</span>
            </label>
            <Input
              id="title"
              name="title"
              defaultValue={paper.title}
              required
              disabled={isPending}
              className="text-sm font-medium"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="journal" className="text-xs font-semibold text-slate-700">
                Journal / Conference
              </label>
              <Input
                id="journal"
                name="journal"
                defaultValue={paper.journal || ""}
                placeholder="e.g. NeurIPS, Nature, Physical Review A"
                disabled={isPending}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="publicationDate" className="text-xs font-semibold text-slate-700">
                Publication Date
              </label>
              <Input
                id="publicationDate"
                name="publicationDate"
                type="date"
                defaultValue={initialDateString}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="doi" className="text-xs font-semibold text-slate-700">
                DOI Identifier
              </label>
              <Input
                id="doi"
                name="doi"
                defaultValue={paper.doi || ""}
                placeholder="10.1038/s41586-024-..."
                disabled={isPending}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="arxivId" className="text-xs font-semibold text-slate-700">
                arXiv ID (Optional)
              </label>
              <Input
                id="arxivId"
                name="arxivId"
                defaultValue={paper.arxivId || ""}
                placeholder="e.g. 1706.03762"
                disabled={isPending}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="citationCount" className="text-xs font-semibold text-slate-700">
                Citation Count
              </label>
              <Input
                id="citationCount"
                name="citationCount"
                type="number"
                defaultValue={paper.citationCount}
                min="0"
                disabled={isPending}
              />
            </div>
          </div>

          {/* Storage & Manuscript File Section */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div>
                <div className="text-xs font-bold text-slate-800 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-indigo-600" />
                  PDF Storage &amp; Ingestion State
                </div>
                <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                  Storage Reference: {paper.storagePath || "No PDF in Supabase Storage"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">Pipeline Status:</span>
                <Badge
                  variant={
                    paper.status === "COMPLETED"
                      ? "success"
                      : paper.status === "FAILED"
                      ? "destructive"
                      : "secondary"
                  }
                  className="text-[10px] font-mono"
                >
                  {paper.status || "UPLOADED"}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="pdfFile" className="text-xs font-semibold text-slate-700">
                  {paper.storagePath ? "Replace PDF Manuscript (Upload New File)" : "Upload PDF Manuscript (Supabase Storage)"}
                </label>
                <Input
                  id="pdfFile"
                  name="pdfFile"
                  type="file"
                  accept=".pdf,application/pdf"
                  disabled={isPending}
                  className="text-xs file:mr-3 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
                />
                <p className="text-[11px] text-slate-400">
                  Max 30 MB. Uploading replaces the stored PDF in <code>research-papers/</code> and triggers deterministic re-chunking.
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="pdfUrl" className="text-xs font-semibold text-slate-700">
                  External PDF Link / Public URL
                </label>
                <div className="relative">
                  <LinkIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    id="pdfUrl"
                    name="pdfUrl"
                    type="url"
                    defaultValue={paper.pdfUrl || ""}
                    placeholder="https://arxiv.org/pdf/1706.03762.pdf"
                    className="pl-9 text-xs"
                    disabled={isPending}
                  />
                </div>
                <p className="text-[11px] text-slate-400">
                  Direct public link (e.g. arXiv PDF or publisher repository)
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* 2. Abstract & Keywords */}
      <Card className="bg-white p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
          <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
            2
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Abstract &amp; Taxonomy</h2>
            <p className="text-xs text-slate-500">The author's manuscript abstract and keyword indexing</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="abstract" className="text-xs font-semibold text-slate-700">
              Abstract <span className="text-red-500">*</span>
            </label>
            <textarea
              id="abstract"
              name="abstract"
              rows={5}
              defaultValue={paper.abstract}
              required
              disabled={isPending}
              className="w-full rounded-md border border-slate-300 p-3 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="keywords" className="text-xs font-semibold text-slate-700">
              Keywords (Comma-separated)
            </label>
            <Input
              id="keywords"
              name="keywords"
              defaultValue={paper.keywords?.join(", ") || ""}
              placeholder="Transformer, Self-Attention, Deep Learning, Translation"
              disabled={isPending}
            />
          </div>

          {/* Categories Selector */}
          <div className="space-y-2 pt-2">
            <label className="text-xs font-semibold text-slate-700 block">
              Disciplinary Categories
            </label>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => {
                const isSelected = selectedCategories.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleCategory(cat.id)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                      isSelected
                        ? "bg-indigo-600 border-indigo-600 text-white font-semibold shadow-xs"
                        : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {cat.name}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400">Click to select all applicable domains</p>
          </div>
        </div>
      </Card>

      {/* 3. Authors & Affiliations */}
      <Card className="bg-white p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
          <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
            3
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Authors &amp; Institutions</h2>
            <p className="text-xs text-slate-500">
              Enter authors separated by semicolons. Specify institution in parentheses if available.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="authors" className="text-xs font-semibold text-slate-700">
            Author List
          </label>
          <textarea
            id="authors"
            name="authors"
            rows={3}
            defaultValue={initialAuthorsString}
            placeholder="Ashish Vaswani (Google Brain); Noam Shazeer (Google Brain); Niki Parmar (Google Research)"
            disabled={isPending}
            className="w-full rounded-md border border-slate-300 p-3 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
          />
          <p className="text-[11px] text-slate-400">
            Format: <code>Author Name (Institution)</code> separated by semicolons (;) or new lines. The first author will be marked corresponding by default.
          </p>
        </div>
      </Card>

      {/* 4. Structured Sections (Zero-Hallucination Grounding) */}
      <Card className="bg-white p-6 sm:p-8 space-y-6">
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
          <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs">
            4
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Manuscript Structured Sections (Evidence Anchors)
            </h2>
            <p className="text-xs text-slate-500">
              Structured sections providing ground truth for citation verification and RAG reasoning
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="researchQuestion" className="text-xs font-semibold text-slate-700">
              Research Question / Core Hypothesis
            </label>
            <textarea
              id="researchQuestion"
              name="researchQuestion"
              rows={2}
              defaultValue={paper.researchQuestion || ""}
              placeholder="What core scientific problem or hypothesis does this manuscript investigate?"
              disabled={isPending}
              className="w-full rounded-md border border-slate-300 p-2.5 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="methodology" className="text-xs font-semibold text-slate-700">
              Methodology &amp; Experimental Architecture
            </label>
            <textarea
              id="methodology"
              name="methodology"
              rows={3}
              defaultValue={paper.methodology || ""}
              placeholder="Summary of empirical setup, model parameters, datasets, or lab procedures..."
              disabled={isPending}
              className="w-full rounded-md border border-slate-300 p-2.5 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="results" className="text-xs font-semibold text-slate-700">
              Empirical Results &amp; Key Findings
            </label>
            <textarea
              id="results"
              name="results"
              rows={3}
              defaultValue={paper.results || ""}
              placeholder="Numerical benchmarks, p-values, BLEU scores, or experimental outcomes..."
              disabled={isPending}
              className="w-full rounded-md border border-slate-300 p-2.5 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="limitations" className="text-xs font-semibold text-slate-700">
                Stated Limitations
              </label>
              <textarea
                id="limitations"
                name="limitations"
                rows={2}
                defaultValue={paper.limitations || ""}
                placeholder="Boundaries, compute constraints, or edge cases noted by authors..."
                disabled={isPending}
                className="w-full rounded-md border border-slate-300 p-2.5 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="conclusion" className="text-xs font-semibold text-slate-700">
                Author Conclusion
              </label>
              <textarea
                id="conclusion"
                name="conclusion"
                rows={2}
                defaultValue={paper.conclusion || ""}
                placeholder="Primary takeaway and forward-looking scientific outlook..."
                disabled={isPending}
                className="w-full rounded-md border border-slate-300 p-2.5 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>
      </Card>



      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
          className="text-xs"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isPending}
          className="bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold px-6 shadow-sm"
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving Changes…
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
