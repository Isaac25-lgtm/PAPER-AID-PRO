import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Bookmark, FileText, ExternalLink, Calendar, Users, Sparkles, BookOpen } from "lucide-react";
import { SectionHeader } from "@/components/shared/section-header";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { SavePaperButton } from "@/components/papers/save-paper-button";

export const dynamic = "force-dynamic";

export default async function SavedPapersPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/saved");
  }

  // Fetch bookmarks strictly belonging to the currently authenticated user
  const bookmarks = await prisma.bookmark.findMany({
    where: {
      userId: session.user.id,
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
          aiSummary: {
            select: {
              id: true,
              modelUsed: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <SectionHeader
        badge="Library"
        title="Saved Papers & Bookmarks"
        description="Your personal repository of curated literature, flagged studies, and synthesis citations."
      />

      {bookmarks.length === 0 ? (
        <Card className="bg-white border-dashed border-2 border-slate-300 p-12 text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
            <Bookmark className="h-6 w-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h3 className="text-base font-semibold text-slate-900">
              No Saved Papers Yet
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
              Bookmark papers while exploring the catalog to organize them into your personal research reading lists.
            </p>
          </div>
          <div className="pt-2">
            <Link href="/papers">
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                Browse Papers
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {bookmarks.map(({ id: bookmarkId, paper }) => (
            <Card
              key={bookmarkId}
              className="flex flex-col justify-between hover:shadow-md hover:border-indigo-200 transition-all bg-white"
            >
              <CardHeader className="p-5 pb-3">
                {/* Categories & Date */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex flex-wrap gap-1.5">
                    {paper.categories.map((pc) => (
                      <Badge key={pc.categoryId} variant="secondary" className="text-[11px] font-medium">
                        {pc.category.name}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex items-center text-xs text-slate-500 gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>{paper.publicationDate ? formatDate(paper.publicationDate.toISOString()) : "—"}</span>
                  </div>
                </div>

                {/* Paper Title */}
                <Link
                  href={`/papers/${paper.id}`}
                  className="hover:text-indigo-600 transition-colors"
                >
                  <h3 className="font-semibold text-base text-slate-900 leading-snug line-clamp-2">
                    {paper.title}
                  </h3>
                </Link>

                {/* Authors */}
                <div className="flex items-center gap-1.5 text-xs text-slate-600 mt-2">
                  <Users className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">
                    {paper.authors.map((pa) => pa.author.name).join(", ") || "—"}
                  </span>
                </div>

                {/* Journal */}
                {paper.journal && (
                  <div className="text-xs font-medium text-slate-500 mt-1 italic truncate">
                    {paper.journal}
                  </div>
                )}
              </CardHeader>

              <CardContent className="p-5 pt-0 flex-1 flex flex-col justify-between">
                {/* Abstract Snippet */}
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 mb-4">
                  {paper.abstract}
                </p>

                {/* Footer Toolbar */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    {paper.aiSummary && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
                        <Sparkles className="h-3 w-3 text-indigo-600" />
                        AI Summary
                      </span>
                    )}
                    {(paper.storagePath || paper.pdfUrl) && (
                      <a
                        href={`/api/papers/${paper.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-slate-600 hover:text-indigo-600"
                        title="View PDF"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        PDF
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <SavePaperButton paperId={paper.id} initialSaved={true} size="sm" />
                    <Link href={`/papers/${paper.id}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
