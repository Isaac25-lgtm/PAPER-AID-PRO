import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  ArrowLeft,
  Building2,
  BookOpen,
  ExternalLink,
  Quote,
  Award,
  Calendar,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { PaperCard } from "@/components/shared/paper-card";
import { Paper } from "@/lib/types/paper";

export async function generateMetadata({ params }: { params: { id: string } }) {
  const author = await prisma.author.findUnique({
    where: { id: params.id },
  });

  if (!author) {
    return { title: "Author Not Found | AI Research Hub" };
  }

  return {
    title: `${author.name} | Author Profile`,
    description: author.bio || `Scientific contributions by ${author.name}`,
  };
}

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ADMIN_TEST_FIXTURE_IDS, isPublicScholarlyPaper, getPublicPaperWhereInput } from "@/lib/auth/paper-authorization";
import { paperVisibilityFilter } from "@/lib/auth/paper-visibility";

export default async function AuthorProfilePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  const isAdmin = session?.user?.role === "ADMIN";

  const author = await prisma.author.findUnique({
    where: { id: params.id },
    include: {
      papers: {
        where: {
          paper: paperVisibilityFilter(session?.user?.id, { role: session?.user?.role }),
        },
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
        orderBy: { paper: { publicationDate: "desc" } },
      },
    },
  });

  if (!author) {
    notFound();
  }

  const validAuthorPapers = isAdmin
    ? author.papers
    : author.papers.filter(({ paper }) => isPublicScholarlyPaper(paper));

  const papers: Paper[] = validAuthorPapers.map(({ paper: p }) => ({
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
        href="/authors"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to author directory
      </Link>

      {/* Author Bio Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-full bg-indigo-50 border-2 border-indigo-200 flex items-center justify-center text-indigo-700 font-extrabold text-2xl shrink-0">
              {author.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </div>

            <div className="space-y-1">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                {author.name}
              </h1>
              {author.institution && (
                <p className="text-xs sm:text-sm text-slate-600 flex items-center gap-1.5 font-medium">
                  <Building2 className="h-4 w-4 text-indigo-600 shrink-0" />
                  {author.institution}
                </p>
              )}
              {author.orcid && (
                <p className="text-[11px] font-mono text-slate-400">
                  ORCID: {author.orcid}
                </p>
              )}
            </div>
          </div>

          {/* Stats Badges */}
          <div className="flex items-center gap-4 text-center">
            <div className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-xl font-bold text-slate-900">{papers.length}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                Publications
              </div>
            </div>
            <div className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-xl font-bold text-indigo-600">
                {author.citationCount.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                Citations
              </div>
            </div>
            {author.hIndex && (
              <div className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-xl font-bold text-slate-900">{author.hIndex}</div>
                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                  h-Index
                </div>
              </div>
            )}
          </div>
        </div>

        {author.bio && (
          <div className="pt-4 border-t border-slate-100">
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              {author.bio}
            </p>
          </div>
        )}
      </div>

      {/* Publications Section */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-indigo-600" />
          Indexed Publications ({papers.length})
        </h2>

        {papers.length === 0 ? (
          <Card className="bg-white p-8 text-center text-xs text-slate-500 border-dashed">
            No papers registered for this author yet.
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
