"use client";

import * as React from "react";
import { CitationAnchor } from "@/lib/ai/schemas";
import { Bookmark, FileText, CheckCircle2, ChevronDown } from "lucide-react";

export function CitationAnchorPill({
  citation,
  paperTitle,
}: {
  citation: CitationAnchor;
  paperTitle?: string;
}) {
  const [isOpen, setIsOpen] = React.useState(false);

  const pageLabel = citation.pageNumber ? `Page ${citation.pageNumber}` : "Manuscript";
  const sectionLabel = citation.section ? `§ ${citation.section}` : "Main Text";

  return (
    <div className="relative inline-block my-0.5">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium font-mono bg-indigo-50/80 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-all cursor-pointer shadow-2xs"
        title="Inspect grounded source evidence"
      >
        <FileText className="h-3 w-3 text-indigo-500" />
        <span>
          {pageLabel} · {sectionLabel}
        </span>
        <ChevronDown
          className={`h-2.5 w-2.5 text-indigo-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute z-30 left-0 mt-1.5 w-72 sm:w-80 p-3 bg-white rounded-xl border border-slate-200 shadow-xl text-left text-xs animate-in fade-in-50 zoom-in-95">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-2">
            <div className="flex items-center gap-1.5 text-emerald-700 font-semibold text-[11px]">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              Verified Chunk Evidence
            </div>
            <span className="text-[10px] font-mono text-slate-400">
              Chunk #{citation.chunkIndex}
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-700">
              {pageLabel} — {sectionLabel}
            </div>
            {citation.snippet && (
              <blockquote className="text-[11px] text-slate-600 italic bg-slate-50 p-2.5 rounded-lg border border-slate-100 line-clamp-4 leading-relaxed">
                &ldquo;{citation.snippet}&rdquo;
              </blockquote>
            )}
            {paperTitle && (
              <div className="text-[10px] text-slate-400 truncate pt-1">
                Source: {paperTitle}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
