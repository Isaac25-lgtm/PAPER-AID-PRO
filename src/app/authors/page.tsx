import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Users, Search, GraduationCap, Building2, BookOpen, Quote, Award } from "lucide-react";
import { SectionHeader } from "@/components/shared/section-header";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata = {
  title: "Author Directory & Scholarly Profiles",
  description: "Explore leading researchers, citation metrics, h-indices, and affiliated academic institutions.",
};

export default async function AuthorsPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const query = searchParams?.q?.trim() || "";

  const authors = await prisma.author.findMany({
    where: query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { institution: { contains: query, mode: "insensitive" } },
            { bio: { contains: query, mode: "insensitive" } },
          ],
        }
      : undefined,
    include: {
      _count: {
        select: { papers: true },
      },
    },
    orderBy: { citationCount: "desc" },
  });

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <SectionHeader
        badge="Faculty & Researchers"
        title="Scholarly Author Directory"
        description="Explore research contributions, verified bibliometrics, and affiliated academic institutions."
      />

      {/* Search Bar */}
      <div className="max-w-md">
        <form method="GET" className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Search researchers by name or institution..."
            className="pl-9 pr-3 h-10 w-full bg-white border border-slate-200 rounded-md text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </form>
      </div>

      {/* Authors Grid */}
      {authors.length === 0 ? (
        <Card className="bg-white border-dashed p-12 text-center space-y-3">
          <Users className="mx-auto h-8 w-8 text-slate-400" />
          <div className="text-sm font-semibold text-slate-800">No authors found</div>
          <p className="text-xs text-slate-500">
            {query ? `No scholars matched "${query}".` : "No researchers registered yet."}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {authors.map((author) => (
            <Card
              key={author.id}
              className="bg-white hover:border-indigo-300 hover:shadow-sm transition-all flex flex-col justify-between"
            >
              <CardHeader className="p-5 pb-3">
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm shrink-0">
                    {author.name
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")}
                  </div>
                  <div className="space-y-1 min-w-0">
                    <Link href={`/authors/${author.id}`}>
                      <h3 className="font-bold text-base text-slate-900 hover:text-indigo-600 transition-colors truncate">
                        {author.name}
                      </h3>
                    </Link>
                    {author.institution && (
                      <div className="flex items-center gap-1 text-xs text-slate-500 truncate">
                        <Building2 className="h-3 w-3 shrink-0 text-slate-400" />
                        <span className="truncate">{author.institution}</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-5 pt-0 space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                  {author.bio || "Academic contributor to scientific literature and research manuscripts."}
                </p>

                {/* Bibliometrics Bar */}
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 text-center">
                  <div className="p-1.5 rounded-lg bg-slate-50">
                    <div className="font-bold text-xs text-slate-900">
                      {author._count.papers}
                    </div>
                    <div className="text-[10px] text-slate-500">Papers</div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-slate-50">
                    <div className="font-bold text-xs text-indigo-600">
                      {author.citationCount.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-slate-500">Citations</div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-slate-50">
                    <div className="font-bold text-xs text-slate-900">
                      {author.hIndex ? `h-${author.hIndex}` : "—"}
                    </div>
                    <div className="text-[10px] text-slate-500">Impact</div>
                  </div>
                </div>

                <Link href={`/authors/${author.id}`} className="block pt-1">
                  <Button variant="outline" size="sm" className="w-full text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200">
                    View Published Papers
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
