import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  Search,
  Filter,
  BookOpen,
  ArrowUpDown,
  Calendar,
  Sparkles,
  ExternalLink,
  Users,
  CheckCircle2,
  Compass,
  Upload,
  Bookmark,
  Layers,
} from "lucide-react";
import { SectionHeader } from "@/components/shared/section-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PaperCard } from "@/components/shared/paper-card";
import { searchPapersHybrid } from "@/lib/search/hybrid-search";
import { ADMIN_TEST_FIXTURE_IDS, isPublicScholarlyPaper, getPublicPaperWhereInput } from "@/lib/auth/paper-authorization";

export const metadata = {
  title: "Scholarly Literature Catalog | AI Research Hub",
  description: "Browse verified scientific literature, inspect evidence-grounded findings, and explore open-access academic publications.",
};

export default async function PapersPage({
  searchParams,
}: {
  searchParams?: { q?: string; category?: string; sort?: string; status?: string };
}) {
  const query = searchParams?.q?.trim() || "";
  const categorySlug = searchParams?.category?.trim() || "";
  const sort = searchParams?.sort || "most-cited";
  const statusFilter = searchParams?.status || "all";

  // Check user session safely for personal bookmarks
  const session = await getServerSession(authOptions);
  let savedPaperIds = new Set<string>();

  if (session?.user?.id) {
    const userBookmarks = await prisma.bookmark.findMany({
      where: { userId: session.user.id },
      select: { paperId: true },
    });
    savedPaperIds = new Set(userBookmarks.map((b) => b.paperId));
  }

  // The public /papers route strictly excludes administrator fixtures and private user uploads
  const excludeFixtures = true;

  // Query hybrid search and categories in parallel with defensive error handling
  let searchResult: Awaited<ReturnType<typeof searchPapersHybrid>> = {
    papers: [],
    total: 0,
    isFallback: false,
    query,
    executionTimeMs: 0,
  };
  let categories: Array<{ id: string; name: string; slug: string; _count: { papers: number } }> = [];
  let totalPaperCount = 0;
  let loadError: string | null = null;

  try {
    const publicWhere = getPublicPaperWhereInput();
    const [sr, cats, candidatePapers] = await Promise.all([
      searchPapersHybrid({
        query,
        categorySlug,
        sort,
        limit: 50,
        excludeFixtures,
      }),
      prisma.category.findMany({
        include: {
          _count: {
            select: { papers: true },
          },
        },
        orderBy: { name: "asc" },
      }),
      excludeFixtures
        ? prisma.paper.findMany({
            where: publicWhere,
            select: {
              id: true,
              doi: true,
              arxivId: true,
              pmid: true,
              pmcid: true,
              semanticScholarId: true,
              isOpenAccess: true,
              storagePath: true,
              sourceProvenance: true,
            },
          })
        : null,
    ]);
    searchResult = sr;
    categories = cats;
    totalPaperCount = excludeFixtures && candidatePapers
      ? candidatePapers.filter(isPublicScholarlyPaper).length
      : await prisma.paper.count();
  } catch (err: any) {
    console.error("[PapersPage] Database query error:", err?.message || err);
    loadError = "The database connection was temporarily busy. Showing cached or fallback state.";
  }

  // Apply human status filter
  let rankedItems = searchResult.papers;

  if (statusFilter === "ready") {
    rankedItems = rankedItems.filter((i) => i.paper.status === "COMPLETED");
  } else if (statusFilter === "processing") {
    rankedItems = rankedItems.filter((i) =>
      ["UPLOADED", "PROCESSING", "TEXT_EXTRACTED", "EMBEDDING"].includes(i.paper.status)
    );
  } else if (statusFilter === "needed") {
    rankedItems = rankedItems.filter((i) => i.paper.status === "METADATA_ONLY");
  } else if (statusFilter === "saved") {
    rankedItems = rankedItems.filter((i) => savedPaperIds.has(i.paper.id));
  }

  const buildQueryUrl = (newParams: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (categorySlug) params.set("category", categorySlug);
    if (sort && sort !== "most-cited") params.set("sort", sort);
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);

    for (const [key, value] of Object.entries(newParams)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    const str = params.toString();
    return str ? `/papers?${str}` : "/papers";
  };

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <SectionHeader
        badge="Scholarly Catalog"
        title="Scholarly Literature Catalog"
        description="Browse verified scientific literature, inspect evidence-grounded findings, and explore open-access academic publications."
        action={
          <div className="flex items-center gap-2">
            <Link href="/discover">
              <Button size="sm" variant="outline" className="text-xs gap-1.5 border-slate-300">
                <Compass className="h-4 w-4 text-indigo-600" />
                <span>Global Discovery</span>
              </Button>
            </Link>
            {session?.user?.id && (
              <Link href="/library">
                <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-xs gap-1.5">
                  <Bookmark className="h-4 w-4" />
                  <span>My Library</span>
                </Button>
              </Link>
            )}
          </div>
        }
      />

      {loadError && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between">
          <span>{loadError}</span>
          <Link href="/papers">
            <Button size="sm" variant="outline" className="text-xs h-7 border-amber-300">
              Retry
            </Button>
          </Link>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <form method="GET" className="relative w-full md:max-w-md">
          {categorySlug && <input type="hidden" name="category" value={categorySlug} />}
          {sort && <input type="hidden" name="sort" value={sort} />}
          {statusFilter !== "all" && <input type="hidden" name="status" value={statusFilter} />}
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Search papers, DOI, title, author, or research topic..."
            className="pl-9 pr-3 h-10 w-full bg-slate-50 border border-slate-200 rounded-md text-xs sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white"
          />
        </form>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto text-xs">
          <span className="text-slate-500 font-medium">Sort by:</span>
          <Link href={buildQueryUrl({ sort: "most-cited" })}>
            <Button
              variant={sort === "most-cited" ? "default" : "outline"}
              size="sm"
              className={sort === "most-cited" ? "bg-indigo-600 text-xs h-8" : "text-xs h-8 text-slate-700"}
            >
              Most Cited
            </Button>
          </Link>
          <Link href={buildQueryUrl({ sort: "newest" })}>
            <Button
              variant={sort === "newest" ? "default" : "outline"}
              size="sm"
              className={sort === "newest" ? "bg-indigo-600 text-xs h-8" : "text-xs h-8 text-slate-700"}
            >
              Newest
            </Button>
          </Link>
        </div>
      </div>

      {/* Unified Status Filters (Section 5) */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl text-xs font-semibold w-fit">
        <Link href={buildQueryUrl({ status: undefined })}>
          <button
            type="button"
            className={`px-3 py-1.5 rounded-lg transition-all ${
              statusFilter === "all"
                ? "bg-white text-indigo-700 shadow-2xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            All Papers
          </button>
        </Link>

        <Link href={buildQueryUrl({ status: "ready" })}>
          <button
            type="button"
            className={`px-3 py-1.5 rounded-lg transition-all ${
              statusFilter === "ready"
                ? "bg-white text-emerald-800 shadow-2xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Ready
          </button>
        </Link>

        <Link href={buildQueryUrl({ status: "processing" })}>
          <button
            type="button"
            className={`px-3 py-1.5 rounded-lg transition-all ${
              statusFilter === "processing"
                ? "bg-white text-blue-700 shadow-2xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Processing
          </button>
        </Link>

        <Link href={buildQueryUrl({ status: "needed" })}>
          <button
            type="button"
            className={`px-3 py-1.5 rounded-lg transition-all ${
              statusFilter === "needed"
                ? "bg-white text-amber-800 shadow-2xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Full Text Needed
          </button>
        </Link>

        {session?.user && (
          <Link href={buildQueryUrl({ status: "saved" })}>
            <button
              type="button"
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                statusFilter === "saved"
                  ? "bg-white text-indigo-700 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Bookmark className="h-3 w-3" />
              <span>Saved ({savedPaperIds.size})</span>
            </button>
          </Link>
        )}
      </div>

      {/* Disciplinary Category Filter Chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={buildQueryUrl({ category: undefined })}>
          <Badge
            variant={!categorySlug ? "academic" : "secondary"}
            className="cursor-pointer text-xs py-1 px-3 transition-colors"
          >
            All Disciplines ({totalPaperCount})
          </Badge>
        </Link>

        {categories.map((cat) => {
          const isActive = categorySlug === cat.slug;
          return (
            <Link key={cat.id} href={buildQueryUrl({ category: isActive ? undefined : cat.slug })}>
              <Badge
                variant={isActive ? "academic" : "secondary"}
                className={`cursor-pointer text-xs py-1 px-3 transition-colors ${
                  !isActive ? "hover:bg-slate-200" : ""
                }`}
              >
                {cat.name} ({cat._count.papers})
              </Badge>
            </Link>
          );
        })}
      </div>

      {/* Papers Grid or Actionable Empty State */}
      {rankedItems.length === 0 ? (
        <Card className="bg-white border-dashed border-2 border-slate-300 p-12 text-center space-y-4 rounded-2xl">
          <div className="mx-auto h-12 w-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <BookOpen className="h-6 w-6" />
          </div>
          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-base font-semibold text-slate-900">
              {query
                ? `No Matching Papers Found for "${query}"`
                : statusFilter !== "all"
                ? "No Papers In This View"
                : totalPaperCount === 0
                ? "Scholarly Catalog Is Empty"
                : "No Papers Found In This Category"}
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
              {query ? (
                <>
                  No published manuscripts in the catalog matched &ldquo;{query}&rdquo;. You can search connected
                  scholarly databases to discover and import papers on this topic.
                </>
              ) : statusFilter === "saved" ? (
                "You haven't bookmarked any papers yet. Save papers while browsing to organize them into your reading list."
              ) : statusFilter === "processing" ? (
                "No papers are currently being processed."
              ) : statusFilter === "needed" ? (
                "All papers currently have manuscript text attached."
              ) : totalPaperCount === 0 ? (
                "The scholarly catalog is currently empty. Discover papers from connected scholarly sources."
              ) : (
                "Try selecting a different research discipline or clearing active filters."
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {query && (
              <Link href={`/discover?q=${encodeURIComponent(query)}`}>
                <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-xs gap-1.5">
                  <Compass className="h-4 w-4" />
                  <span>Search Scholarly Sources</span>
                </Button>
              </Link>
            )}

            <Link href="/discover">
              <Button size="sm" variant={query ? "outline" : "default"} className="text-xs gap-1.5">
                <Compass className="h-4 w-4" />
                <span>Discover Research</span>
              </Button>
            </Link>

            {(query || categorySlug || statusFilter !== "all") && (
              <Link href="/papers">
                <Button size="sm" variant="outline" className="text-xs">
                  Clear Filters
                </Button>
              </Link>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {rankedItems.map((item) => (
            <PaperCard
              key={item.paper.id}
              paper={item.paper}
              matchedSnippet={item.matchedSnippet}
            />
          ))}
        </div>
      )}
    </div>
  );
}
