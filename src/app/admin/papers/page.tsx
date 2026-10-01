import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  Plus,
  Search,
  ExternalLink,
  Calendar,
  Users,
  FileText,
  Pencil,
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { DeletePaperButton } from "./delete-paper-button";
import { BackfillEmbeddingsButton } from "./backfill-button";

export const metadata = {
  title: "Manage Papers | Admin Portal",
};

export default async function AdminPapersPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const query = searchParams?.q?.trim() || "";

  const [papers, embeddedChunkCounts] = await Promise.all([
    prisma.paper.findMany({
      where: query
        ? {
            OR: [
              { title: { contains: query, mode: "insensitive" } },
              { abstract: { contains: query, mode: "insensitive" } },
              { doi: { contains: query, mode: "insensitive" } },
              { keywords: { has: query } },
            ],
          }
        : undefined,
      include: {
        authors: {
          include: { author: true },
          orderBy: { orderIndex: "asc" },
        },
        categories: {
          include: { category: true },
        },
        aiSummary: {
          select: { id: true, modelUsed: true },
        },
        _count: {
          select: { chunks: true },
        },
        processingJobs: {
          where: { stage: "SUMMARY_GENERATION" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.$queryRaw<Array<{ paperId: string; count: bigint }>>`
      SELECT "paperId", COUNT(*) as count 
      FROM "paper_chunks" 
      WHERE "embedding" IS NOT NULL
      GROUP BY "paperId";
    `,
  ]);

  const embeddedMap = new Map<string, number>(
    embeddedChunkCounts.map((r) => [r.paperId, Number(r.count)])
  );

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Paper Management Catalog
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Manage published manuscripts, trigger AI evidence synthesis, and monitor ingestion pipelines.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <BackfillEmbeddingsButton />
          <Link href="/admin/papers/new">
            <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 shadow-sm gap-1.5 text-xs font-semibold">
              <Plus className="h-4 w-4" />
              Publish New Manuscript
            </Button>
          </Link>
        </div>
      </div>

      {/* Search Bar */}
      <Card className="p-4 bg-white shadow-xs">
        <form method="GET" className="relative flex items-center">
          <Search className="absolute left-3.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search papers by title, abstract, DOI, or keywords..."
            className="w-full pl-10 pr-24 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <Button
            type="submit"
            size="sm"
            className="absolute right-1.5 h-7 px-3 text-xs bg-slate-900 hover:bg-slate-800"
          >
            Search
          </Button>
        </form>
      </Card>

      {/* Papers Table */}
      {papers.length === 0 ? (
        <Card className="p-12 text-center bg-white shadow-xs space-y-3">
          <FileText className="mx-auto h-8 w-8 text-slate-300" />
          <h3 className="text-sm font-semibold text-slate-700">No manuscripts found</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            {query
              ? `No papers matching query "${query}". Try searching with different keywords.`
              : "No papers have been published yet. Click Publish New Manuscript to get started."}
          </p>
          <div className="pt-2">
            <Link href="/admin/papers/new">
              <Button size="sm" variant="outline" className="text-xs">
                Publish New Manuscript
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                <tr>
                  <th className="py-3 px-4">Title &amp; DOI</th>
                  <th className="py-3 px-4">Authors</th>
                  <th className="py-3 px-4">Categories</th>
                  <th className="py-3 px-4">Ingestion &amp; Chunks</th>
                  <th className="py-3 px-4">AI Summary Status</th>
                  <th className="py-3 px-4">Vector Index</th>
                  <th className="py-3 px-4">Published</th>
                  <th className="py-3 px-4 text-right">Management Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {papers.map((p) => {
                  const chunkCount = p._count?.chunks || 0;
                  const embeddedCount = embeddedMap.get(p.id) || 0;
                  const hasSummary = !!p.aiSummary;
                  const latestSummaryJob = p.processingJobs?.[0];
                  const isGenerating = latestSummaryJob?.status === "RUNNING";
                  const isSummaryFailed = latestSummaryJob?.status === "FAILED" && !hasSummary;
                  const isReadyToGenerate = p.status === "COMPLETED" && chunkCount > 0 && !hasSummary;

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Title & Identifiers */}
                      <td className="py-3 px-4 max-w-xs">
                        <Link
                          href={`/papers/${p.id}`}
                          className="font-bold text-slate-900 hover:text-indigo-600 transition-colors line-clamp-2"
                        >
                          {p.title}
                        </Link>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5 truncate">
                          {p.doi || p.journal || "No DOI registered"}
                        </div>
                      </td>

                      {/* Authors */}
                      <td className="py-3 px-4 max-w-[180px] text-slate-600">
                        <div className="truncate">
                          {p.authors.map((pa) => pa.author.name).join(", ") || "—"}
                        </div>
                      </td>

                      {/* Categories */}
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {p.categories.map((pc) => (
                            <Badge key={pc.categoryId} variant="secondary" className="text-[10px] py-0 px-1.5 font-normal">
                              {pc.category.name}
                            </Badge>
                          ))}
                        </div>
                      </td>

                      {/* Ingestion & Chunks */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="space-y-1">
                          <Link href="/admin/processing" title="View processing pipeline">
                            <Badge
                              variant={
                                p.status === "COMPLETED"
                                  ? "success"
                                  : p.status === "FAILED"
                                  ? "destructive"
                                  : "secondary"
                              }
                              className="text-[10px] font-mono cursor-pointer hover:opacity-85"
                            >
                              {p.status}
                            </Badge>
                          </Link>
                          <div className="text-[11px] text-slate-400">
                            {chunkCount} {chunkCount === 1 ? "chunk" : "chunks"}
                          </div>
                        </div>
                      </td>

                      {/* Unambiguous AI Summary Status */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {hasSummary ? (
                          <Link href={`/admin/papers/${p.id}/edit`} title={`Model: ${p.aiSummary?.modelUsed || "gpt-4o-mini"}`}>
                            <Badge variant="success" className="text-[10px] font-mono cursor-pointer hover:opacity-85 gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              GENERATED
                            </Badge>
                          </Link>
                        ) : isGenerating ? (
                          <Badge variant="secondary" className="text-[10px] font-mono gap-1 animate-pulse">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            GENERATING
                          </Badge>
                        ) : isSummaryFailed ? (
                          <Link href={`/admin/papers/${p.id}/edit`} title="Generation failed. Click to inspect & retry.">
                            <Badge variant="destructive" className="text-[10px] font-mono cursor-pointer gap-1">
                              <AlertCircle className="h-3 w-3" />
                              FAILED
                            </Badge>
                          </Link>
                        ) : isReadyToGenerate ? (
                          <Link href={`/admin/papers/${p.id}/edit`} title="Ingestion complete. Ready to synthesize.">
                            <Badge variant="outline" className="text-[10px] font-mono text-indigo-700 border-indigo-300 bg-indigo-50/50 cursor-pointer hover:bg-indigo-100 gap-1 font-semibold">
                              <Sparkles className="h-3 w-3 text-indigo-600" />
                              READY TO GENERATE
                            </Badge>
                          </Link>
                        ) : (
                          <Badge variant="outline" className="text-[10px] font-mono text-slate-400 border-slate-200">
                            NOT READY
                          </Badge>
                        )}
                      </td>

                      {/* Vector Index Status */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <Link href={`/admin/papers/${p.id}/edit`} title={`${embeddedCount} of ${chunkCount} chunks embedded`}>
                          {embeddedCount === chunkCount && chunkCount > 0 ? (
                            <Badge variant="success" className="text-[10px] font-mono cursor-pointer hover:opacity-85 gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              EMBEDDED
                            </Badge>
                          ) : embeddedCount > 0 ? (
                            <Badge variant="warning" className="text-[10px] font-mono cursor-pointer hover:opacity-85 gap-1">
                              PARTIAL ({embeddedCount}/{chunkCount})
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] font-mono text-slate-400 border-slate-200">
                              NONE
                            </Badge>
                          )}
                        </Link>
                      </td>

                      {/* Date */}
                      <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                        {p.publicationDate ? formatDate(p.publicationDate.toISOString()) : "—"}
                      </td>

                      {/* Obvious Management Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* View Public Paper */}
                          <Link href={`/papers/${p.id}`}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2.5 text-xs text-slate-700 hover:text-indigo-600 gap-1"
                              title="View public paper"
                            >
                              <ExternalLink className="h-3 w-3" />
                              View
                            </Button>
                          </Link>

                          {/* Edit / Manage (Primary Admin Action) */}
                          <Link href={`/admin/papers/${p.id}/edit`}>
                            <Button
                              size="sm"
                              className="h-7 px-2.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium gap-1 shadow-xs"
                              title="Edit metadata and manage AI summary"
                            >
                              <Pencil className="h-3 w-3" />
                              Edit / Manage
                            </Button>
                          </Link>

                          {/* View PDF if attached */}
                          {(p.storagePath || p.pdfUrl) && (
                            <a
                              href={`/api/papers/${p.id}/pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open original manuscript PDF"
                            >
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-slate-600 hover:text-indigo-600 hover:bg-slate-100 gap-1"
                              >
                                <FileText className="h-3 w-3" />
                                PDF
                              </Button>
                            </a>
                          )}

                          <DeletePaperButton paperId={p.id} paperTitle={p.title} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
