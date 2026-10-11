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
  Edit3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CitationVerifier } from "@/components/tools/citation-verification/citation-verifier";
import { RegisteredMetadata } from "@/lib/citations/verification-types";

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
    authors: [
      "Ashish Vaswani",
      "Noam Shazeer",
      "Niki Parmar",
      "Jakob Uszkoreit",
      "Llion Jones",
      "Aidan N. Gomez",
      "Lukasz Kaiser",
      "Illia Polosukhin",
    ],
    year: 2017,
    journal: "Advances in Neural Information Processing Systems (NeurIPS)",
    volume: "30",
    pages: "5998–6008",
    doi: "10.48550/arXiv.1706.03762",
  },
  alphafold: {
    title: "Accurate structure prediction of biomolecular interactions with AlphaFold 3",
    authors: [
      "Josh Abramson",
      "Jonas Adler",
      "Jack Dunger",
      "Richard Evans",
      "John Jumper",
      "Demis Hassabis",
    ],
    year: 2024,
    journal: "Nature",
    volume: "630",
    issue: "8016",
    pages: "493–500",
    doi: "10.1038/s41586-024-07487-w",
  },
  quantum: {
    title: "Fault-tolerant quantum computation with surface codes",
    authors: [
      "Austin G. Fowler",
      "Matteo Mariantoni",
      "John M. Martinis",
      "Andrew N. Cleland",
    ],
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
  const [paper, setPaper] = React.useState<PaperCitationData>(sampleCitations.alphafold);
  const [isEditing, setIsEditing] = React.useState(false);
  const [format, setFormat] = React.useState<"apa" | "mla" | "chicago" | "ieee" | "bibtex">("apa");
  const [copied, setCopied] = React.useState(false);

  // Form input state for custom/edited references
  const [editForm, setEditForm] = React.useState<PaperCitationData>(sampleCitations.alphafold);

  const handleSelectPreset = (key: string) => {
    setSelectedKey(key);
    setIsEditing(false);
    const chosen = sampleCitations[key];
    setPaper(chosen);
    setEditForm(chosen);
  };

  const handleSaveCustom = (e: React.FormEvent) => {
    e.preventDefault();
    setPaper(editForm);
    setIsEditing(false);
  };

  const handleApplyVerifiedMetadata = (meta: RegisteredMetadata) => {
    const updated: PaperCitationData = {
      title: meta.title || paper.title,
      authors: meta.authors.length > 0 ? meta.authors : paper.authors,
      year: meta.year || paper.year,
      journal: meta.venue || paper.journal,
      volume: meta.volume || paper.volume,
      issue: meta.issue || paper.issue,
      pages: meta.pages || paper.pages,
      doi: meta.doi || paper.doi,
    };
    setPaper(updated);
    setEditForm(updated);
  };

  const formatCitation = () => {
    const authorList = paper.authors.join(", ");
    const firstAuthor = paper.authors[0] || "Unknown";

    switch (format) {
      case "apa":
        return `${firstAuthor}, et al. (${paper.year}). ${paper.title}. ${paper.journal}${
          paper.volume ? `, ${paper.volume}` : ""
        }${paper.issue ? `(${paper.issue})` : ""}${
          paper.pages ? `, ${paper.pages}` : ""
        }.${paper.doi ? ` https://doi.org/${paper.doi}` : ""}`;
      case "mla":
        return `${firstAuthor}, et al. "${paper.title}." ${paper.journal}${
          paper.volume ? `, vol. ${paper.volume}` : ""
        }${paper.issue ? `, no. ${paper.issue}` : ""}, ${paper.year}${
          paper.pages ? `, pp. ${paper.pages}` : ""
        }.${paper.doi ? ` DOI: ${paper.doi}` : ""}`;
      case "chicago":
        return `${firstAuthor}, et al. ${paper.year}. "${paper.title}." ${paper.journal}${
          paper.volume ? ` ${paper.volume}` : ""
        }${paper.pages ? `: ${paper.pages}` : ""}.${
          paper.doi ? ` https://doi.org/${paper.doi}.` : ""
        }`;
      case "ieee":
        return `[1] ${firstAuthor} et al., "${paper.title}," ${paper.journal}${
          paper.volume ? `, vol. ${paper.volume}` : ""
        }${paper.issue ? `, no. ${paper.issue}` : ""}${
          paper.pages ? `, pp. ${paper.pages}` : ""
        }, ${paper.year}${paper.doi ? `, doi: ${paper.doi}` : ""}.`;
      case "bibtex":
        return `@article{${firstAuthor.split(" ").pop()?.toLowerCase() || "ref"}${paper.year}${paper.title.slice(0, 5).toLowerCase().replace(/\s+/g, "")},
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

  const handleDownloadBibtex = () => {
    const element = document.createElement("a");
    const file = new Blob([citationText], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = `citation-${paper.doi.replace(/[^a-zA-Z0-9]/g, "_")}.bib`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
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
          Academic Citation Generator & Verifier
        </h1>
        <p className="text-xs sm:text-sm text-slate-500">
          Format citations accurately in APA 7, MLA 9, Chicago, IEEE, and verify references against authoritative registries.
        </p>
      </div>

      {/* Select Paper Sample or Input Custom Citation */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between border-b border-slate-100 pb-4">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Choose Sample Paper or Enter Reference
          </span>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              onClick={() => handleSelectPreset("alphafold")}
              className={cn(
                "px-3 py-1.5 rounded-full font-semibold border transition-all cursor-pointer",
                selectedKey === "alphafold" && !isEditing
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              )}
            >
              AlphaFold 3
            </button>
            <button
              onClick={() => handleSelectPreset("transformer")}
              className={cn(
                "px-3 py-1.5 rounded-full font-semibold border transition-all cursor-pointer",
                selectedKey === "transformer" && !isEditing
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              )}
            >
              Transformers
            </button>
            <button
              onClick={() => handleSelectPreset("quantum")}
              className={cn(
                "px-3 py-1.5 rounded-full font-semibold border transition-all cursor-pointer",
                selectedKey === "quantum" && !isEditing
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              )}
            >
              Surface Codes
            </button>
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={cn(
                "px-3 py-1.5 rounded-full font-semibold border transition-all cursor-pointer flex items-center gap-1",
                isEditing
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              )}
            >
              <Edit3 className="h-3 w-3" />
              {isEditing ? "Close Editor" : "Custom Reference"}
            </button>
          </div>
        </div>

        {/* Custom Metadata Editor (Optional) */}
        {isEditing ? (
          <form onSubmit={handleSaveCustom} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1 sm:col-span-2">
                <label className="font-semibold text-slate-700">Manuscript Title</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. Attention Is All You Need"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">DOI or PMID</label>
                <input
                  type="text"
                  value={editForm.doi}
                  onChange={(e) => setEditForm({ ...editForm, doi: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. 10.1038/s41586-024-07487-w or 38718835"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Publication Year</label>
                <input
                  type="number"
                  value={editForm.year}
                  onChange={(e) =>
                    setEditForm({ ...editForm, year: parseInt(e.target.value, 10) || 2024 })
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. 2024"
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="font-semibold text-slate-700">
                  Authors (comma-separated)
                </label>
                <input
                  type="text"
                  value={editForm.authors.join(", ")}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      authors: e.target.value
                        .split(",")
                        .map((a) => a.trim())
                        .filter(Boolean),
                    })
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. Vaswani, Shazeer, Parmar"
                  required
                />
              </div>

              <div className="space-y-1 sm:col-span-2">
                <label className="font-semibold text-slate-700">Journal or Conference</label>
                <input
                  type="text"
                  value={editForm.journal}
                  onChange={(e) => setEditForm({ ...editForm, journal: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g. Nature"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold"
              >
                Update Citation
              </Button>
            </div>
          </form>
        ) : (
          /* Active Paper Details */
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900">{paper.title}</h2>
            <p className="text-xs text-slate-600">
              {paper.authors.join(", ")} ({paper.year}) —{" "}
              <span className="italic">{paper.journal}</span>
            </p>
            {paper.doi ? (
              <p className="text-xs text-indigo-600 font-mono">Identifier: {paper.doi}</p>
            ) : (
              <p className="text-xs text-slate-400 font-mono">No persistent identifier provided</p>
            )}
          </div>
        )}
      </div>

      {/* Registry Citation Verifier Component */}
      <CitationVerifier
        currentPaper={paper}
        onApplyVerifiedMetadata={handleApplyVerifiedMetadata}
      />

      {/* Formats Selector & Output */}
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
                  "rounded-lg px-4 py-2 transition-all border cursor-pointer",
                  format === f.id
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {format === "bibtex" && (
              <Button
                onClick={handleDownloadBibtex}
                variant="outline"
                size="sm"
                className="gap-1.5 text-slate-700 border-slate-200 hover:bg-slate-50 font-semibold"
              >
                <Download className="h-4 w-4" />
                .bib
              </Button>
            )}
            <Button
              onClick={handleCopy}
              size="sm"
              className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold cursor-pointer"
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
        </div>

        {/* Citation Output Box */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs font-mono text-xs sm:text-sm text-slate-800 leading-relaxed overflow-x-auto whitespace-pre-wrap select-all">
          {citationText}
        </div>

        {/* Reference Manager Export Options */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-600">
          <span>Export reference to external tools:</span>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-md bg-white border border-slate-200 hover:bg-slate-100 font-semibold cursor-pointer"
            >
              Export RIS
            </button>
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-md bg-white border border-slate-200 hover:bg-slate-100 font-semibold cursor-pointer"
            >
              Sync to Zotero
            </button>
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-md bg-white border border-slate-200 hover:bg-slate-100 font-semibold cursor-pointer"
            >
              Sync to Mendeley
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
