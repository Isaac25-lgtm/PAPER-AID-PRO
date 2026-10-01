import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, BookOpen } from "lucide-react";
import { NewPaperForm } from "./new-paper-form";

export const metadata = {
  title: "Publish Research Paper | Admin Portal",
};

export default async function NewPaperPage() {
  const categories = await prisma.category.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });

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
      </div>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-indigo-600" />
          Publish Academic Manuscript
        </h1>
        <p className="text-xs text-slate-500">
          Add scientific papers and research manuscripts with exact bibliographic anchors, author networks, and verbatim manuscript sections.
        </p>
      </div>

      <NewPaperForm categories={categories} />
    </div>
  );
}
