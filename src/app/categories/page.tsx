import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { paperVisibilityFilter } from "@/lib/auth/paper-visibility";
import { ArrowRight, BookOpen, Layers, Dna, Brain, Cpu, Eye, Stethoscope, FileText } from "lucide-react";
import { SectionHeader } from "@/components/shared/section-header";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Research Categories & Scientific Disciplines",
  description: "Explore scientific literature organized by disciplinary boundaries, domain ontologies, and research fields.",
};

const iconMap: Record<string, any> = {
  Brain,
  FileText,
  Dna,
  Cpu,
  Eye,
  Stethoscope,
};

export default async function CategoriesPage() {
  const session = await getServerSession(authOptions);
  const visibilityWhere = paperVisibilityFilter(session?.user?.id, { role: session?.user?.role });

  const categories = await prisma.category.findMany({
    include: {
      _count: {
        select: {
          papers: {
            where: {
              paper: visibilityWhere,
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <SectionHeader
        badge="Taxonomy"
        title="Research Categories &amp; Fields"
        description="Browse scientific papers organized by disciplinary boundaries, domain ontologies, and emerging research fronts."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {categories.map((cat) => {
          const IconComponent = (cat.iconName && iconMap[cat.iconName]) || Layers;

          return (
            <Link key={cat.id} href={`/categories/${cat.slug}`} className="group">
              <Card className="h-full bg-white hover:border-indigo-300 hover:shadow-sm transition-all p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="h-10 w-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                      <IconComponent className="h-5 w-5" />
                    </div>
                    <Badge variant="secondary" className="text-xs font-semibold">
                      {cat._count.papers} {cat._count.papers === 1 ? "Paper" : "Papers"}
                    </Badge>
                  </div>
                  <h3 className="font-bold text-lg text-slate-900 group-hover:text-indigo-600 transition-colors">
                    {cat.name}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mt-2 line-clamp-3">
                    {cat.description || "Research papers and literature indexed under this disciplinary domain."}
                  </p>
                </div>
                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-indigo-600 group-hover:translate-x-1 transition-transform">
                  <span>Explore domain papers</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
