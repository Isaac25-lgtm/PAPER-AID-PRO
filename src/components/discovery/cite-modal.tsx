"use client";

import * as React from "react";
import { Copy, Check, Download, X, Quote, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NormalizedExternalPaper } from "@/lib/discovery/types";
import { formatBibliographicCitation, CitationStyle } from "@/lib/citations/citation-formatter";

interface CiteModalProps {
  isOpen: boolean;
  onClose: () => void;
  paper: NormalizedExternalPaper | null;
}

const STYLES: { key: CitationStyle; label: string }[] = [
  { key: "apa", label: "APA 7th" },
  { key: "mla", label: "MLA 9th" },
  { key: "chicago", label: "Chicago" },
  { key: "ieee", label: "IEEE" },
  { key: "bibtex", label: "BibTeX" },
];

export function CiteModal({ isOpen, onClose, paper }: CiteModalProps) {
  const [selectedStyle, setSelectedStyle] = React.useState<CitationStyle>("apa");
  const [copied, setCopied] = React.useState(false);

  if (!isOpen || !paper) return null;

  // Adapt NormalizedExternalPaper into BibliographicCitationInput format
  const citationInput = {
    title: paper.title,
    authors: paper.authors.map((a) => a.name),
    year: paper.year,
    journal: paper.journal,
    doi: paper.doi,
  };

  const citationResult = formatBibliographicCitation(citationInput, selectedStyle);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(citationResult.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API is restricted
      const textarea = document.createElement("textarea");
      textarea.value = citationResult.text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadBibtex = () => {
    const bibResult = formatBibliographicCitation(citationInput, "bibtex");
    const element = document.createElement("a");
    const file = new Blob([bibResult.text], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    const cleanName = paper.title.slice(0, 20).replace(/[^a-zA-Z0-9]/g, "_");
    element.download = `${cleanName || "citation"}.bib`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-5"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <Quote className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Cite this Publication</h2>
              <p className="text-xs text-slate-500">Standard academic citation formats with verifiable metadata</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Paper Mini Preview */}
        <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100 text-xs space-y-1">
          <p className="font-semibold text-slate-800 line-clamp-2">{paper.title}</p>
          <div className="text-slate-500 flex flex-wrap gap-x-2">
            <span>{paper.authors.slice(0, 3).map((a) => a.name).join(", ")}</span>
            {paper.year && <span>• {paper.year}</span>}
            {paper.journal && <span className="italic">• {paper.journal}</span>}
          </div>
        </div>

        {/* Format Selector Tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 pb-2">
          {STYLES.map((style) => (
            <button
              key={style.key}
              type="button"
              onClick={() => setSelectedStyle(style.key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                selectedStyle === style.key
                  ? "bg-indigo-600 text-white shadow-2xs"
                  : "bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {style.label}
            </button>
          ))}
        </div>

        {/* Citation Output Box */}
        <div className="relative">
          <pre
            className={`p-4 rounded-xl border text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap font-sans ${
              selectedStyle === "bibtex" ? "font-mono bg-slate-900 text-slate-100 border-slate-800" : "bg-slate-50 text-slate-800 border-slate-200"
            }`}
          >
            {citationResult.text}
          </pre>
        </div>

        {/* Actions Bar */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            {selectedStyle === "bibtex" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadBibtex}
                className="text-xs h-9 gap-1.5 border-slate-200 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Export .bib</span>
              </Button>
            )}
            {paper.doi && (
              <Badge variant="outline" className="text-[10px] text-slate-500 border-slate-200">
                doi:{paper.doi}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs h-9 border-slate-200"
            >
              Close
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleCopy}
              className={`text-xs h-9 font-semibold gap-1.5 transition-all ${
                copied
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-indigo-600 hover:bg-indigo-700 text-white"
              }`}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>Copied to Clipboard</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy Citation</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
