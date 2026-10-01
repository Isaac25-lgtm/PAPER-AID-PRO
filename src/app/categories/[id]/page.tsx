import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, BookOpen, Layers, Dna, Brain, Cpu, Eye, Stethoscope, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PaperCard } from "@/components/shared/paper-card";
import { Paper } from "@/lib/types/paper";

const iconMap: Record<string, any> = {
  Brain,
  FileText,
  Dna,
  Cpu,
  Eye,
  Stethoscope,
};

export async function generateMetadata({ params }: { params: { id: string } }) {
  const category = await prisma.category.findFirst({
    where: {
      OR: [{ id: params.id }, { slug: params.id }],
    },
  });

  if (!category) {
    return { title: "Category Not Found | AI Research Hub" };
  }

  return {
    title: `${category.name} Research Papers | AI Research Hub`,
    description: category.description || `Browse papers in ${category.name}`,
  };
}

export default async function CategoryDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const category = await prisma.category.findFirst({
    where: {
      OR: [{ id: params.id }, { slug: params.id }],
    },
    include: {
      papers: {
        include: {
          paper: {
            include: {
              authors: {
                include: { author: true },
                orderBy: { orderIndex: "asc" },
              },
              categories: {
                include: { category: true },
              },
            },
          },
        },
        orderBy: { paper: { citationCount: "desc" } },
      },
    },
  });

  if (!category) {
    notFound();
  }

  const IconComponent = (category.iconName && iconMap[category.iconName]) || Layers;

  const papers: Paper[] = category.papers.map(({ paper: p }) => ({
    id: p.id,
    title: p.title,
    abstract: p.abstract,
    publicationDate: p.publicationDate?.toISOString() || new Date().toISOString(),
    journal: p.journal || "Research Manuscript",
    doi: p.doi || undefined,
    pdfUrl: p.pdfUrl || undefined,
    status: p.status as any,
    keywords: p.keywords,
    citationCount: p.citationCount,
    researchQuestion: p.researchQuestion || undefined,
    methodology: p.methodology || undefined,
    results: p.results || undefined,
    limitations: p.limitations || undefined,
    conclusion: p.conclusion || undefined,
    authors: p.authors.map((pa) => ({
      id: pa.author.id,
      name: pa.author.name,
      institution: pa.author.institution || undefined,
    })),
    categories: p.categories.map((pc) => ({
      id: pc.category.id,
      name: pc.category.name,
    })),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <Link
        href="/categories"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to categories
      </Link>

      {/* Category Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <IconComponent className="h-7 w-7" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="academic">Disciplinary Field</Badge>
                <span className="text-xs text-slate-400 font-mono">/{category.slug}</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                {category.name}
              </h1>
            </div>
          </div>

          <Badge variant="secondary" className="text-xs font-bold px-3 py-1">
            {papers.length} {papers.length === 1 ? "Indexed Paper" : "Indexed Papers"}
          </Badge>
        </div>

        {category.description && (
          <div className="pt-3 border-t border-slate-100">
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              {category.description}
            </p>
          </div>
        )}
      </div>

      {/* Categorized Papers Listing */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-indigo-600" />
            Domain Literature ({papers.length})
          </h2>
          <Link href={`/papers?category=${category.slug}`}>
            <Button variant="ghost" size="sm" className="text-xs text-indigo-600">
              View in Catalog
            </Button>
          </Link>
        </div>

        {papers.length === 0 ? (
          <Card className="bg-white p-12 text-center text-xs text-slate-500 border-dashed space-y-2">
            <Layers className="mx-auto h-8 w-8 text-slate-400" />
            <div className="font-semibold text-slate-700">No papers registered in this domain yet</div>
            <p>Admin manuscripts tagged with this category will appear here automatically.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {papers.map((paper) => (
              <PaperCard key={paper.id} paper={paper} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
