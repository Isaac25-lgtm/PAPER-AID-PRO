"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, BookOpen, Globe, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HeroSearch() {
  const router = useRouter();
  const [searchTarget, setSearchTarget] = React.useState<"library" | "scholarly">("library");
  const [query, setQuery] = React.useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    if (searchTarget === "library") {
      router.push(`/papers?q=${encodeURIComponent(q)}`);
    } else {
      router.push(`/discover?q=${encodeURIComponent(q)}`);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-3">
      {/* Target Selector Tabs */}
      <div className="flex items-center justify-center gap-1.5 p-1 bg-slate-100/90 rounded-xl max-w-xs mx-auto text-xs font-semibold">
        <button
          type="button"
          onClick={() => setSearchTarget("library")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg transition-all ${
            searchTarget === "library"
              ? "bg-white text-indigo-700 shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span>Library</span>
        </button>
        <button
          type="button"
          onClick={() => setSearchTarget("scholarly")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg transition-all ${
            searchTarget === "scholarly"
              ? "bg-white text-indigo-700 shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Globe className="h-3.5 w-3.5" />
          <span>Scholarly Sources</span>
        </button>
      </div>

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
          placeholder={
            searchTarget === "library"
              ? "Search indexed papers in your library by title, author, DOI..."
              : "Search global literature across PubMed, Crossref & Semantic Scholar..."
          }
          className="w-full py-4 px-3 text-xs sm:text-sm text-slate-900 focus:outline-hidden placeholder:text-slate-400"
        />
        <div className="pr-2 flex items-center gap-2">
          <Button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-700 font-semibold text-xs sm:text-sm px-4 sm:px-6 shadow-xs"
          >
            {searchTarget === "library" ? "Search Library" : "Search Sources"}
          </Button>
        </div>
      </form>

      {/* Search Scope Context Note */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 px-2">
        <span>
          {searchTarget === "library"
            ? "Searching verified full-text papers and extracted evidence in local library."
            : "Searching external academic databases (PubMed, Crossref, Semantic Scholar)."}
        </span>
        <button
          type="button"
          onClick={() => setSearchTarget(searchTarget === "library" ? "scholarly" : "library")}
          className="text-indigo-600 hover:underline font-semibold"
        >
          Switch to {searchTarget === "library" ? "Scholarly Sources" : "Library"}
        </button>
      </div>
    </div>
  );
}
