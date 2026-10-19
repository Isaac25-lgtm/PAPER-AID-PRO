"use client";

import React, { useState, useEffect } from "react";
import {
  Download,
  Copy,
  Check,
  X,
  FileCode,
  Layers,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  mapReferenceToCslJson,
  createCiteprocEngine,
  renderBibliography,
  exportMultipleToBibTeX,
  exportMultipleToRIS,
  BUNDLED_STYLES,
  CslItem,
  cslToPlainText,
} from "@/lib/citations/csl";

export interface BulkExportItem {
  id: string;
  title: string;
  authors?: string[] | any;
  publicationDate?: Date | string | null;
  journal?: string | null;
  doi?: string | null;
  volume?: string | number | null;
  issue?: string | number | null;
  pages?: string | null;
  publisher?: string | null;
  documentType?: string | null;
}

interface BulkExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: BulkExportItem[];
}

const BULK_FORMATS = [
  { id: "bibtex", label: "BibTeX (.bib)", ext: "bib", mime: "application/x-bibtex" },
  { id: "ris", label: "RIS EndNote / Zotero (.ris)", ext: "ris", mime: "application/x-research-info-systems" },
  { id: "apa", label: "APA 7th Bibliography", ext: "txt", mime: "text/plain" },
  { id: "ieee", label: "IEEE Bibliography", ext: "txt", mime: "text/plain" },
  { id: "vancouver", label: "Vancouver Bibliography", ext: "txt", mime: "text/plain" },
  { id: "mla", label: "MLA 9th Bibliography", ext: "txt", mime: "text/plain" },
  { id: "chicago-author-date", label: "Chicago (Author-Date)", ext: "txt", mime: "text/plain" },
];

export function BulkExportModal({ isOpen, onClose, items }: BulkExportModalProps) {
  const [format, setFormat] = useState<string>("bibtex");
  const [outputContent, setOutputContent] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || items.length === 0) return;

    const cslItems: CslItem[] = items.map((it) => mapReferenceToCslJson(it));

    if (format === "bibtex") {
      setOutputContent(exportMultipleToBibTeX(cslItems));
      return;
    }

    if (format === "ris") {
      setOutputContent(exportMultipleToRIS(cslItems));
      return;
    }

    // CSL Formatted Bibliography
    const bundled = BUNDLED_STYLES[format];
    if (bundled) {
      try {
        const engine = createCiteprocEngine(bundled.xml, cslItems);
        engine.updateItems(cslItems.map((c) => c.id));
        const bib = renderBibliography(engine, format, bundled.title);
        // Clean text entries separated by double newline
        const plainEntries = bib.entries.map((e) => cslToPlainText(e));
        setOutputContent(plainEntries.join("\n\n"));
      } catch (err: any) {
        console.warn("Failed to format bulk bibliography:", err);
        setOutputContent(items.map((i) => i.title).join("\n"));
      }
    }
  }, [isOpen, items, format]);

  if (!isOpen) return null;

  const currentFormatMeta = BULK_FORMATS.find((f) => f.id === format) || BULK_FORMATS[0];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(outputContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = outputContent;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([outputContent], {
      type: `${currentFormatMeta.mime};charset=utf-8`,
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `exported_references_${items.length}_items.${currentFormatMeta.ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Export Selected References ({items.length})
              </h2>
              <p className="text-xs text-slate-500">
                Standard bibliographic export for Zotero, Mendeley, EndNote, or formatted bibliographies
              </p>
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

        {/* Format Selector Bar */}
        <div className="px-6 py-3 border-b border-slate-100 bg-white flex flex-wrap gap-1.5">
          {BULK_FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFormat(f.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                format === f.id
                  ? "bg-indigo-600 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Preview Content */}
        <div className="p-6 flex-1 overflow-y-auto">
          <pre className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 text-xs font-mono text-slate-800 leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-[400px]">
            {outputContent || "Preparing export..."}
          </pre>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            {items.length} references ready for export
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="h-9 px-4 text-xs gap-1.5 border-slate-200 hover:bg-slate-100"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? "Copied!" : "Copy to Clipboard"}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleDownload}
              className="h-9 px-4 text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download .{currentFormatMeta.ext}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
