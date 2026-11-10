"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, Globe, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HeroSearch() {
  const router = useRouter();
  const [query, setQuery] = React.useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    // Homepage search targets global scholarly discovery directly
    router.push(`/discover?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-3">
      {/* Main Search Input Form */}
      <form
        onSubmit={handleSubmit}
        className="relative flex items-center shadow-lg rounded-2xl overflow-hidden border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-500 transition-all"
      >
        <div className="pl-4 text-slate-400">
          <Search className="h-5 w-5" />
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search global research papers across PubMed, Crossref & Semantic Scholar..."
          className="w-full py-4 px-3 text-xs sm:text-sm text-slate-900 focus:outline-hidden placeholder:text-slate-400"
        />
        <div className="pr-2 flex items-center gap-2">
          <Button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-700 font-semibold text-xs sm:text-sm px-4 sm:px-6 shadow-xs"
          >
            Search Literature
          </Button>
        </div>
      </form>

      {/* Search Scope Context & Library Access Guidance */}
      <div className="flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 px-2 gap-1.5">
        <span className="flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
          <span>Searching global literature across PubMed, Crossref &amp; Semantic Scholar.</span>
        </span>
        <Link
          href="/library"
          className="text-indigo-600 hover:text-indigo-800 hover:underline font-semibold inline-flex items-center gap-1 shrink-0"
        >
          <BookOpen className="h-3 w-3" />
          <span>Go to My Library</span>
        </Link>
      </div>
    </div>
  );
}
