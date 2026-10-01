import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, BookOpen, Edit } from "lucide-react";
import { EditPaperForm } from "./edit-paper-form";

import { getPaperEmbeddingStats } from "@/lib/ai/embedding-pipeline";

export const metadata = {
  title: "Edit Manuscript Metadata | Admin Portal",
};

export default async function EditPaperPage({
  params,
}: {
  params: { id: string };
}) {
  const [paper, categories, embeddingStats] = await Promise.all([
    prisma.paper.findUnique({
      where: { id: params.id },
      include: {
        authors: {
          include: { author: true },
          orderBy: { orderIndex: "asc" },
        },
        categories: {
          include: { category: true },
        },
        aiSummary: true,
        _count: {
          select: { chunks: true },
        },
        processingJobs: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    }),
    prisma.category.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    }),
    getPaperEmbeddingStats(params.id),
  ]);

  if (!paper) {
    notFound();
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/admin/papers"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to paper catalog
        </Link>
        <Link
          href={`/papers/${paper.id}`}
          className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
        >
          View public page →
        </Link>
      </div>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Edit className="h-6 w-6 text-indigo-600" />
          Edit Manuscript Metadata
        </h1>
        <p className="text-xs text-slate-500">
          Update bibliographic citations, author affiliations, disciplinary categories, and structured grounding sections.
        </p>
      </div>

      <EditPaperForm paper={paper} categories={categories} embeddingStats={embeddingStats} />
    </div>
  );
}
