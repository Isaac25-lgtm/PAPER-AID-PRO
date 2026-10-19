"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Search,
  Check,
  X,
  BookOpen,
  Sparkles,
  Quote,
  Filter,
  Layers,
  ChevronRight,
  ExternalLink,
  Clock,
  Loader2,
} from "lucide-react";
import { CslStyleMetadata, CslCitationFormat } from "@/lib/citations/csl/types";
import { BUNDLED_STYLES } from "@/lib/citations/csl/styles/bundled-styles";

interface StyleSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeStyleId: string;
  onSelectStyle: (styleId: string, styleMetadata?: CslStyleMetadata) => void;
}

const PROMINENT_STYLES: { id: string; title: string; shortName: string; format: CslCitationFormat; sampleInText: string }[] = [
  { id: "apa", title: "American Psychological Association 7th", shortName: "APA 7th", format: "author-date", sampleInText: "(Vaswani et al., 2017)" },
  { id: "vancouver", title: "Vancouver (ICMJE / NLM Recommendations)", shortName: "Vancouver", format: "numeric", sampleInText: "(1)" },
  { id: "ieee", title: "IEEE (Institute of Electrical & Electronics Engineers)", shortName: "IEEE", format: "numeric", sampleInText: "[1]" },
  { id: "mla", title: "Modern Language Association 9th", shortName: "MLA 9th", format: "author-date", sampleInText: "(Vaswani et al. 15)" },
  { id: "chicago-author-date", title: "Chicago Manual of Style 17th (Author-Date)", shortName: "Chicago (Author-Date)", format: "author-date", sampleInText: "(Vaswani et al. 2017)" },
  { id: "chicago-note", title: "Chicago Manual of Style 17th (Full Notes)", shortName: "Chicago (Notes)", format: "note", sampleInText: "¹" },
  { id: "harvard", title: "Harvard (Cite Them Right 12th)", shortName: "Harvard", format: "author-date", sampleInText: "(Vaswani et al., 2017)" },
  { id: "ama", title: "American Medical Association 11th", shortName: "AMA 11th", format: "numeric", sampleInText: "¹" },
  { id: "nature", title: "Nature", shortName: "Nature", format: "numeric", sampleInText: "¹" },
  { id: "science", title: "Science", shortName: "Science", format: "numeric", sampleInText: "(1)" },
];

export function StyleSelectorModal({
  isOpen,
  onClose,
  activeStyleId,
  onSelectStyle,
}: StyleSelectorModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFormat, setSelectedFormat] = useState<"all" | CslCitationFormat>("all");
  const [searchResults, setSearchResults] = useState<CslStyleMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedStyleId, setSelectedStyleId] = useState(activeStyleId || "apa");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sync selectedStyleId when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedStyleId(activeStyleId || "apa");
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen, activeStyleId]);

  // Debounced search query
  useEffect(() => {
    if (!isOpen) return;

    if (!searchQuery.trim() && selectedFormat === "all") {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (searchQuery.trim()) params.set("q", searchQuery.trim());
        if (selectedFormat !== "all") params.set("format", selectedFormat);
        params.set("limit", "40");

        const res = await fetch(`/api/citations/styles?${params.toString()}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.styles)) {
          setSearchResults(data.styles);
        }
      } catch (err) {
        console.warn("Failed to search styles:", err);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [searchQuery, selectedFormat, isOpen]);

  // Format badge helper
  const getFormatBadge = (format: CslCitationFormat) => {
    switch (format) {
      case "author-date":
        return {
          label: "Author-Date",
          color: "bg-blue-50 text-blue-700 border-blue-200",
        };
      case "numeric":
        return {
          label: "Numbered",
          color: "bg-emerald-50 text-emerald-700 border-emerald-200",
        };
      case "note":
        return {
          label: "Notes / Footnotes",
          color: "bg-purple-50 text-purple-700 border-purple-200",
        };
      default:
        return {
          label: "Standard",
          color: "bg-slate-100 text-slate-700 border-slate-200",
        };
    }
  };

  const handleApply = () => {
    const prominent = PROMINENT_STYLES.find((s) => s.id === selectedStyleId);
    const searchMatch = searchResults.find((s) => s.id === selectedStyleId);
    const meta: CslStyleMetadata = {
      id: selectedStyleId,
      title: prominent?.title || searchMatch?.title || selectedStyleId,
      format: prominent?.format || searchMatch?.format || "numeric",
      dependent: searchMatch?.dependent || false,
    };

    onSelectStyle(selectedStyleId, meta);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="style-selector-title"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-200/60 flex items-center justify-center text-indigo-700">
              <Quote className="w-5 h-5" />
            </div>
            <div>
              <h2 id="style-selector-title" className="text-base font-bold text-slate-900 tracking-tight">
                Citation Style Language (CSL) Catalog
              </h2>
              <p className="text-xs text-slate-500">
                10,000+ official journal, institutional, and publisher citation styles
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar & Format Filter Tabs */}
        <div className="px-6 pt-4 pb-3 border-b border-slate-100 space-y-3 bg-white">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search 10,000+ styles or journals (e.g., Nature, IEEE, APA, Lancet, Cell, Science)..."
              className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent placeholder:text-slate-400"
            />
            {isLoading && (
              <Loader2 className="w-4 h-4 text-indigo-600 animate-spin absolute right-3.5 top-1/2 -translate-y-1/2" />
            )}
            {searchQuery && !isLoading && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            <button
              type="button"
              onClick={() => setSelectedFormat("all")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                selectedFormat === "all"
                  ? "bg-slate-900 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              All Formats
            </button>
            <button
              type="button"
              onClick={() => setSelectedFormat("author-date")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                selectedFormat === "author-date"
                  ? "bg-blue-600 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Author-Date (e.g. APA, Harvard)
            </button>
            <button
              type="button"
              onClick={() => setSelectedFormat("numeric")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                selectedFormat === "numeric"
                  ? "bg-emerald-600 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Numeric (e.g. IEEE, Vancouver, Nature)
            </button>
            <button
              type="button"
              onClick={() => setSelectedFormat("note")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                selectedFormat === "note"
                  ? "bg-purple-600 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Notes & Footnotes (e.g. Chicago)
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Prominent Styles Section (Always visible when not deep in search) */}
          {(!searchQuery || searchResults.length === 0) && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                  Standard Academic & Journal Styles
                </span>
                <span className="text-[11px] text-slate-400">Offline & Fast</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PROMINENT_STYLES.filter(
                  (s) => selectedFormat === "all" || s.format === selectedFormat
                ).map((s) => {
                  const isSelected = selectedStyleId === s.id;
                  const badge = getFormatBadge(s.format);

                  return (
                    <div
                      key={s.id}
                      onClick={() => setSelectedStyleId(s.id)}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all flex items-start justify-between gap-3 ${
                        isSelected
                          ? "bg-indigo-50/70 border-indigo-400 ring-1 ring-indigo-400"
                          : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/60"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-slate-900 truncate">
                            {s.shortName}
                          </h4>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-semibold border ${badge.color}`}
                          >
                            {badge.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                          {s.title}
                        </p>
                        <p className="text-[11px] text-slate-400 font-mono mt-1">
                          Preview: {s.sampleInText}
                        </p>
                      </div>

                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center border flex-shrink-0 mt-0.5 ${
                          isSelected
                            ? "bg-indigo-600 border-indigo-600 text-white"
                            : "border-slate-300 bg-white"
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Search Results Section */}
          {searchQuery && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Catalog Results ({searchResults.length})
                </span>
                <span className="text-[11px] text-slate-400">Official CSL Styles</span>
              </div>

              {isLoading ? (
                <div className="py-8 text-center text-slate-400 text-xs">
                  <Loader2 className="w-6 h-6 text-indigo-600 animate-spin mx-auto mb-2" />
                  Searching official style repository...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  No styles matched &ldquo;{searchQuery}&rdquo;. Try searching by publisher or standard abbreviation.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
                  {searchResults.map((s) => {
                    const isSelected = selectedStyleId === s.id;
                    const badge = getFormatBadge(s.format);

                    return (
                      <div
                        key={s.id}
                        onClick={() => setSelectedStyleId(s.id)}
                        className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all flex items-center justify-between gap-3 ${
                          isSelected
                            ? "bg-indigo-50 border-indigo-300 ring-1 ring-indigo-300"
                            : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/60"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-semibold text-slate-900 truncate">
                              {s.title}
                            </h4>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-semibold border ${badge.color}`}
                            >
                              {badge.label}
                            </span>
                            {s.dependent && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                                Dependent
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 font-mono truncate mt-0.5">
                            csl:{s.id}
                          </p>
                        </div>

                        <div
                          className={`w-4 h-4 rounded-full flex items-center justify-center border flex-shrink-0 ${
                            isSelected
                              ? "bg-indigo-600 border-indigo-600 text-white"
                              : "border-slate-300 bg-white"
                          }`}
                        >
                          {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            Selected Style:{" "}
            <span className="font-semibold text-slate-800">
              {PROMINENT_STYLES.find((s) => s.id === selectedStyleId)?.shortName ||
                searchResults.find((s) => s.id === selectedStyleId)?.title ||
                selectedStyleId}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-200/60 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-sm transition-all flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Apply to Manuscript</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
