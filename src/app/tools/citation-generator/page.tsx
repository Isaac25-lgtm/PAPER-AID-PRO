"use client";

import * as React from "react";
import Link from "next/link";
import {
  Quote,
  Copy,
  Check,
  Download,
  ArrowLeft,
  Sparkles,
  BookOpen,
  Search,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PaperCitationData {
  title: string;
  authors: string[];
  year: number;
  journal: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi: string;
}

const sampleCitations: Record<string, PaperCitationData> = {
  transformer: {
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit", "Llion Jones", "Aidan N. Gomez", "Lukasz Kaiser", "Illia Polosukhin"],
    year: 2017,
    journal: "Advances in Neural Information Processing Systems (NeurIPS)",
    volume: "30",
    pages: "5998–6008",
    doi: "10.48550/arXiv.1706.03762",
  },
  alphafold: {
    title: "Accurate structure prediction of biomolecular interactions with AlphaFold 3",
    authors: ["Josh Abramson", "Jonas Adler", "Jack Dunger", "Richard Evans", "John Jumper", "Demis Hassabis"],
    year: 2024,
    journal: "Nature",
    volume: "630",
    issue: "8016",
    pages: "493–500",
    doi: "10.1038/s41586-024-07487-w",
  },
  quantum: {
    title: "Fault-tolerant quantum computation with surface codes",
    authors: ["Austin G. Fowler", "Matteo Mariantoni", "John M. Martinis", "Andrew N. Cleland"],
    year: 2012,
    journal: "Physical Review A",
    volume: "86",
    issue: "3",
    pages: "032324",
    doi: "10.1103/PhysRevA.86.032324",
  },
};

export default function CitationGeneratorPage() {
  const [selectedKey, setSelectedKey] = React.useState<string>("alphafold");
  const [format, setFormat] = React.useState<"apa" | "mla" | "chicago" | "ieee" | "bibtex">("apa");
  const [copied, setCopied] = React.useState(false);

  const paper = sampleCitations[selectedKey];

  const formatCitation = () => {
    const authorList = paper.authors.join(", ");
    const firstAuthor = paper.authors[0];

    switch (format) {
      case "apa":
        return `${firstAuthor}, et al. (${paper.year}). ${paper.title}. ${paper.journal}, ${paper.volume || ""}(${paper.issue || ""}), ${paper.pages || ""}. https://doi.org/${paper.doi}`;
      case "mla":
        return `${firstAuthor}, et al. "${paper.title}." ${paper.journal}, vol. ${paper.volume || "1"}, no. ${paper.issue || "1"}, ${paper.year}, pp. ${paper.pages || ""}. DOI: ${paper.doi}`;
      case "chicago":
        return `${firstAuthor}, et al. ${paper.year}. "${paper.title}." ${paper.journal} ${paper.volume || ""}: ${paper.pages || ""}. https://doi.org/${paper.doi}.`;
      case "ieee":
        return `[1] ${firstAuthor} et al., "${paper.title}," ${paper.journal}, vol. ${paper.volume || ""}, no. ${paper.issue || ""}, pp. ${paper.pages || ""}, ${paper.year}, doi: ${paper.doi}.`;
      case "bibtex":
        return `@article{${firstAuthor.split(" ").pop()?.toLowerCase()}${paper.year}${paper.title.slice(0, 5).toLowerCase()},
  author    = {${paper.authors.join(" and ")}},
  title     = {${paper.title}},
  journal   = {${paper.journal}},
  year      = {${paper.year}},
  volume    = {${paper.volume || ""}},
  pages     = {${paper.pages || ""}},
  doi       = {${paper.doi}}
}`;
      default:
        return "";
    }
  };

  const citationText = formatCitation();

  const handleCopy = () => {
    navigator.clipboard.writeText(citationText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Header */}
      <div className="space-y-1">
        <Link
          href="/tools"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Tools Suite
        </Link>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
          <Quote className="h-6 w-6 text-indigo-600" />
          Academic Citation Generator
        </h1>
        <p className="text-xs sm:text-sm text-slate-500">
          Format citations accurately in APA 7, MLA 9, Chicago, IEEE, and export clean BibTeX for LaTeX.
        </p>
      </div>

      {/* Select Paper Sample or Input */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between border-b border-slate-100 pb-4">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Choose Sample Paper or Search DOI
          </span>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              onClick={() => setSelectedKey("alphafold")}
              className={cn(
                "px-3 py-1.5 rounded-full font-semibold border transition-all",
                selectedKey === "alphafold"
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              )}
            >
              AlphaFold 3
            </button>
            <button
              onClick={() => setSelectedKey("transformer")}
              className={cn(
                "px-3 py-1.5 rounded-full font-semibold border transition-all",
                selectedKey === "transformer"
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              )}
            >
              Transformers
            </button>
            <button
              onClick={() => setSelectedKey("quantum")}
              className={cn(
                "px-3 py-1.5 rounded-full font-semibold border transition-all",
                selectedKey === "quantum"
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              )}
            >
              Surface Codes
            </button>
          </div>
        </div>

        {/* Selected Paper Details */}
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-slate-900">{paper.title}</h2>
          <p className="text-xs text-slate-600">
            {paper.authors.join(", ")} ({paper.year})
          </p>
          <p className="text-xs text-indigo-600 font-mono">DOI: {paper.doi}</p>
        </div>
      </div>

      {/* Formats Selector */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
            {[
              { id: "apa", label: "APA 7th" },
              { id: "mla", label: "MLA 9th" },
              { id: "chicago", label: "Chicago" },
              { id: "ieee", label: "IEEE" },
              { id: "bibtex", label: "BibTeX" },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFormat(f.id as any)}
                className={cn(
                  "rounded-lg px-4 py-2 transition-all border",
                  format === f.id
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <Button
            onClick={handleCopy}
            size="sm"
            className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 text-emerald-300" />
                Copied to Clipboard
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copy Citation
              </>
            )}
          </Button>
        </div>

        {/* Citation Output Box */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm font-mono text-xs sm:text-sm text-slate-800 leading-relaxed overflow-x-auto whitespace-pre-wrap">
          {citationText}
        </div>

        {/* Reference Manager Export Options */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-600">
          <span>Export reference to external tools:</span>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-md bg-white border border-slate-200 hover:bg-slate-100 font-semibold"
            >
              Export RIS
            </button>
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-md bg-white border border-slate-200 hover:bg-slate-100 font-semibold"
            >
              Sync to Zotero
            </button>
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-md bg-white border border-slate-200 hover:bg-slate-100 font-semibold"
            >
              Sync to Mendeley
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
