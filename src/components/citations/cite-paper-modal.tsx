"use client";

import React, { useState, useEffect } from "react";
import {
  Copy,
  Check,
  Download,
  X,
  Quote,
  Sparkles,
  BookOpen,
  Search,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  mapReferenceToCslJson,
  createCiteprocEngine,
  renderBibliography,
  exportToBibTeX,
  exportToRIS,
  BUNDLED_STYLES,
  sanitizeCslHtml,
  cslToPlainText,
} from "@/lib/citations/csl";
import { loadStyleXmlClient } from "@/lib/citations/csl/csl-client-formatter";
import { StyleSelectorModal } from "./style-selector-modal";

export interface CitePaperModalProps {
  isOpen: boolean;
  onClose: () => void;
  paper: {
    id: string;
    title: string;
    authors?: (string | { name?: string; author?: { name: string } })[] | null;
    publicationDate?: Date | string | null;
    year?: number | string | null;
    journal?: string | null;
    doi?: string | null;
    arxivId?: string | null;
    pmid?: string | null;
    volume?: string | number | null;
    issue?: string | number | null;
    pages?: string | null;
    publisher?: string | null;
    institution?: string | null;
    documentType?: string | null;
    abstract?: string | null;
  } | null;
}

const QUICK_STYLES = [
  { id: "apa", label: "APA 7th" },
  { id: "vancouver", label: "Vancouver" },
  { id: "ieee", label: "IEEE" },
  { id: "mla", label: "MLA 9th" },
  { id: "chicago-author-date", label: "Chicago" },
  { id: "harvard", label: "Harvard" },
  { id: "bibtex", label: "BibTeX" },
  { id: "ris", label: "RIS (EndNote)" },
];

export function CitePaperModal({ isOpen, onClose, paper }: CitePaperModalProps) {
  const [selectedStyle, setSelectedStyle] = useState<string>("apa");
  const [formattedText, setFormattedText] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [isCatalogOpen, setIsCatalogOpen] = useState<boolean>(false);
  const [customStyleName, setCustomStyleName] = useState<string | null>(null);

  // Compute formatted text whenever paper or selectedStyle changes
  useEffect(() => {
    if (!paper) return;

    const cslItem = mapReferenceToCslJson(paper);

    if (selectedStyle === "bibtex") {
      setFormattedText(exportToBibTeX(cslItem));
      return;
    }

    if (selectedStyle === "ris") {
      setFormattedText(exportToRIS(cslItem));
      return;
    }

    // Check bundled styles first
    const bundled = BUNDLED_STYLES[selectedStyle];
    if (bundled) {
      try {
        const engine = createCiteprocEngine(bundled.xml, [cslItem]);
        engine.updateItems([cslItem.id]);
        const bib = renderBibliography(engine, selectedStyle, bundled.title);
        const entry = bib.entries[0] || cslItem.title || "Reference";
        setFormattedText(entry);
      } catch (err: any) {
        console.warn("Formatting error:", err);
        setFormattedText(cslItem.title || "Reference");
      }
      return;
    }

    // Custom or external style
    let isCancelled = false;
    loadStyleXmlClient(selectedStyle)
      .then((styleDef: { xml: string; title: string; format: any }) => {
        if (isCancelled) return;
        const engine = createCiteprocEngine(styleDef.xml, [cslItem]);
        engine.updateItems([cslItem.id]);
        const bib = renderBibliography(engine, selectedStyle, styleDef.title);
        const entry = bib.entries[0] || cslItem.title || "Reference";
        setFormattedText(entry);
      })
      .catch((err: any) => {
        if (isCancelled) return;
        console.warn("Error loading custom style:", err);
        setFormattedText(cslItem.title || "Reference");
      });

    return () => {
      isCancelled = true;
    };
  }, [paper, selectedStyle]);

  if (!isOpen || !paper) return null;

  const handleCopy = async () => {
    try {
      // Strip HTML if not bibtex/ris using safe plain text converter
      const cleanText =
        selectedStyle === "bibtex" || selectedStyle === "ris"
          ? formattedText
          : cslToPlainText(formattedText);

      await navigator.clipboard.writeText(cleanText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const cleanText =
        selectedStyle === "bibtex" || selectedStyle === "ris"
          ? formattedText
          : cslToPlainText(formattedText);
      const textarea = document.createElement("textarea");
      textarea.value = cleanText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadFile = () => {
    const isBib = selectedStyle === "bibtex";
    const extension = isBib ? "bib" : "ris";
    const mimeType = isBib ? "application/x-bibtex" : "application/x-research-info-systems";
    const blob = new Blob([formattedText], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const cleanTitle = (paper.title || "citation").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 25);
    link.href = url;
    link.download = `${cleanTitle}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-5"
          onClick={(e) => e.stopPropagation()}
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
                <p className="text-xs text-slate-500">Official CSL academic citation formats with verifiable metadata</p>
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
              {paper.journal && <span className="italic">{paper.journal}</span>}
              {paper.doi && <span className="font-mono text-slate-400">doi:{paper.doi}</span>}
            </div>
          </div>

          {/* Format Selector Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-2">
            {QUICK_STYLES.map((style) => (
              <button
                key={style.id}
                type="button"
                onClick={() => {
                  setSelectedStyle(style.id);
                  setCustomStyleName(null);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                  selectedStyle === style.id
                    ? "bg-indigo-600 text-white shadow-2xs"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {style.label}
              </button>
            ))}

            {/* Custom style tab if active */}
            {customStyleName && (
              <button
                type="button"
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white shadow-2xs"
              >
                {customStyleName}
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsCatalogOpen(true)}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg text-indigo-600 hover:bg-indigo-50 border border-dashed border-indigo-200 transition-all flex items-center gap-1 ml-auto"
            >
              <Search className="w-3 h-3" />
              <span>More Styles...</span>
            </button>
          </div>

          {/* Citation Output Box */}
          <div className="relative">
            {selectedStyle === "bibtex" || selectedStyle === "ris" ? (
              <pre className="p-4 rounded-xl border text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap font-mono bg-slate-900 text-slate-100 border-slate-800">
                {formattedText}
              </pre>
            ) : (
              <div
                className="p-4 rounded-xl border text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap font-sans bg-slate-50 text-slate-800 border-slate-200"
                dangerouslySetInnerHTML={{
                  __html: sanitizeCslHtml(formattedText),
                }}
              />
            )}
          </div>

          {/* Actions Bar */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              {(selectedStyle === "bibtex" || selectedStyle === "ris") && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadFile}
                  className="text-xs h-9 gap-1.5 border-slate-200 hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download .{selectedStyle === "bibtex" ? "bib" : "ris"}</span>
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={handleCopy}
                className="text-xs h-9 gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? "Copied to Clipboard!" : "Copy Citation"}</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 10k Style Selector Modal */}
      <StyleSelectorModal
        isOpen={isCatalogOpen}
        onClose={() => setIsCatalogOpen(false)}
        activeStyleId={selectedStyle}
        onSelectStyle={(id, meta) => {
          setSelectedStyle(id);
          setCustomStyleName(meta?.title ? meta.title.slice(0, 20) : id);
        }}
      />
    </>
  );
}
