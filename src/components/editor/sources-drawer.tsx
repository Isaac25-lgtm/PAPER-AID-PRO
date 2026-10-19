"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Plus,
  Search,
  BookOpen,
  FileText,
  ExternalLink,
  Trash2,
  Quote,
  Sparkles,
  Check,
  AlertCircle,
  FileCheck2,
  Copy,
  Download,
} from "lucide-react";
import { UserLibraryItem } from "@/lib/library/user-library-service";
import { getUserLibrarySourcesAction, attachSourcePaperAction, detachSourcePaperAction } from "@/app/editor/actions";
import { parseAuthorName } from "@/lib/citations/csl/csl-mapper";

interface LinkedPaper {
  id: string;
  paperId: string;
  paper: {
    id: string;
    title: string;
    abstract?: string;
    doi?: string | null;
    arxivId?: string | null;
    journal?: string | null;
    publicationDate?: string | Date | null;
    status?: string;
    authors?: (string | { name?: string; author?: { name: string } | null })[];
    categories?: { category?: { name: string } | null }[];
    _count?: { chunks: number };
  };
}

function getSafeAuthorName(authorItem: any): string {
  if (!authorItem) return "";
  if (typeof authorItem === "string") return authorItem.trim();
  if (authorItem.author && typeof authorItem.author.name === "string") {
    return authorItem.author.name.trim();
  }
  if (typeof authorItem.name === "string") {
    return authorItem.name.trim();
  }
  return "";
}

function getSafeAuthorLastName(authorItem: any): string {
  const name = getSafeAuthorName(authorItem);
  if (!name) return "Unknown";
  const parsed = parseAuthorName(name);
  return parsed.family || parsed.literal || name;
}

interface DocumentCitationItem {
  id: string;
  paperId: string;
  citationText: string;
  citationType: string;
  pageNumber?: number | null;
  section?: string | null;
  paper?: {
    id: string;
    title: string;
    doi?: string | null;
    journal?: string | null;
    publicationDate?: string | Date | null;
  };
}

interface SourcesDrawerProps {
  documentId: string;
  isOpen: boolean;
  onClose: () => void;
  linkedPapers: LinkedPaper[];
  citations: DocumentCitationItem[];
  onInsertCitationText?: (text: string, paperId: string, citationData?: any) => void;
  onInsertStructuredCitation?: (params: {
    paperId: string;
    paperTitle: string;
    locator?: string;
  }) => void;
  onSummarizeEvidenceRequest: (paperId: string, paperTitle: string) => void;
  onRefreshDocument: () => Promise<void>;
  activeStyleId?: string;
  activeStyleName?: string;
  bibliographyEntries?: string[];
  onInsertBibliographyToCanvas?: () => void;
}

export function SourcesDrawer({
  documentId,
  isOpen,
  onClose,
  linkedPapers,
  citations,
  onInsertCitationText,
  onInsertStructuredCitation,
  onSummarizeEvidenceRequest,
  onRefreshDocument,
  activeStyleId = "apa",
  activeStyleName = "APA 7th",
  bibliographyEntries = [],
  onInsertBibliographyToCanvas,
}: SourcesDrawerProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [libraryItems, setLibraryItems] = useState<UserLibraryItem[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // Citation Locator modal state
  const [locatorTarget, setLocatorTarget] = useState<{ id: string; title: string } | null>(null);
  const [locatorValue, setLocatorValue] = useState("");
  const [copiedBib, setCopiedBib] = useState(false);

  // Load library items when picker modal opens
  useEffect(() => {
    if (isPickerOpen) {
      loadLibraryItems();
    }
  }, [isPickerOpen]);

  const loadLibraryItems = async () => {
    setIsLoadingLibrary(true);
    setActionError(null);
    try {
      const res = await getUserLibrarySourcesAction();
      if (res.success && res.items) {
        setLibraryItems(res.items);
      } else {
        setActionError(res.error || "Failed to load library items.");
      }
    } catch (err: any) {
      setActionError(err.message || "Network error loading library.");
    } finally {
      setIsLoadingLibrary(false);
    }
  };

  const handleAttachPaper = async (paperId: string) => {
    try {
      const res = await attachSourcePaperAction(documentId, paperId);
      if (res.success) {
        await onRefreshDocument();
        setIsPickerOpen(false);
      } else {
        setActionError(res.error || "Failed to attach paper.");
      }
    } catch (err: any) {
      setActionError(err.message || "Failed to attach paper.");
    }
  };

  const handleDetachPaper = async (paperId: string) => {
    try {
      const res = await detachSourcePaperAction(documentId, paperId);
      if (res.success) {
        await onRefreshDocument();
      }
    } catch (err: any) {
      console.warn("Failed to detach paper:", err);
    }
  };

  // Helper to construct APA formatted in-text citation string: e.g. (Vaswani et al., 2017) or (Fink & Hoyka, 2026)
  const formatCitationText = (paper: LinkedPaper["paper"]) => {
    if (!paper) return "(Unknown, n.d.)";
    const authors = Array.isArray(paper.authors) ? paper.authors : [];
    const year = paper.publicationDate
      ? new Date(paper.publicationDate).getFullYear()
      : "n.d.";

    if (authors.length === 0) {
      return `(Unknown, ${year})`;
    }

    const firstLastName = getSafeAuthorLastName(authors[0]);

    if (authors.length > 2) {
      return `(${firstLastName} et al., ${year})`;
    } else if (authors.length === 2) {
      const secondLastName = getSafeAuthorLastName(authors[1]);
      return `(${firstLastName} & ${secondLastName}, ${year})`;
    }
    return `(${firstLastName}, ${year})`;
  };

  if (!isOpen) return null;

  const linkedPaperIds = new Set(
    linkedPapers
      .map((lp) => lp?.paper?.id)
      .filter((id): id is string => Boolean(id))
  );
  const filteredLibrary = libraryItems.filter((item) => {
    if (!item) return false;
    const title = (item.title || "").toLowerCase();
    const q = searchQuery.toLowerCase();
    const authors = Array.isArray(item.authors) ? item.authors : [];
    return title.includes(q) || authors.some((a) => (a || "").toLowerCase().includes(q));
  });

  return (
    <>
      {/* Slide-over Drawer Panel */}
      <aside className="fixed inset-y-0 right-0 z-40 w-full sm:w-96 bg-white border-l border-slate-200 shadow-xl flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-900">
              Research Sources & Citations
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Bar */}
        <div className="p-3 border-b border-slate-100 bg-white flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">
            {linkedPapers.length} attached {linkedPapers.length === 1 ? "source" : "sources"}
          </span>
          <button
            type="button"
            onClick={() => setIsPickerOpen(true)}
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add from Library</span>
          </button>
        </div>

        {/* Content Body: Attached Sources List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {linkedPapers.length === 0 ? (
            <div className="text-center py-10 px-4">
              <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto mb-3 text-indigo-600">
                <BookOpen className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium text-slate-800 mb-1">
                No Sources Attached Yet
              </p>
              <p className="text-xs text-slate-500 mb-4 max-w-xs mx-auto">
                Connect papers from My Library to generate grounded citations, insert passage evidence, and summarize contributions.
              </p>
              <button
                type="button"
                onClick={() => setIsPickerOpen(true)}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors inline-flex items-center gap-1.5 shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Browse My Library</span>
              </button>
            </div>
          ) : (
            linkedPapers.map((lp) => {
              const p = lp.paper;
              const hasFullText = p.status === "COMPLETED" || (p._count?.chunks || 0) > 0;
              const authorsList = Array.isArray(p.authors)
                ? p.authors.map(getSafeAuthorName).filter(Boolean).join(", ")
                : "";
              const citationString = formatCitationText(p);

              return (
                <div
                  key={lp.id}
                  className="p-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition-all shadow-xs space-y-2 group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-xs font-semibold text-slate-900 leading-snug line-clamp-2">
                      {p.title}
                    </h3>
                    <button
                      type="button"
                      onClick={() => handleDetachPaper(p.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-50 transition-colors opacity-0 group-hover:opacity-100"
                      title="Detach source"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-500 line-clamp-1">
                    {authorsList || "Unknown Authors"}
                  </p>

                  <div className="flex items-center gap-2 text-[10px]">
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium ${
                        hasFullText
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-slate-100 text-slate-600 border border-slate-200"
                      }`}
                    >
                      <FileCheck2 className="w-3 h-3" />
                      {hasFullText ? "Full Text" : "Metadata Only"}
                    </span>
                    {p.doi && (
                      <span className="font-mono text-slate-400 truncate max-w-[150px]">
                        doi:{p.doi}
                      </span>
                    )}
                  </div>

                  {/* Citation & AI Actions */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (onInsertStructuredCitation) {
                          setLocatorTarget({ id: p.id, title: p.title });
                          setLocatorValue("");
                        } else if (onInsertCitationText) {
                          onInsertCitationText(citationString, p.id, {
                            paperId: p.id,
                            citationText: citationString,
                          });
                        }
                      }}
                      className="px-2 py-1 text-[11px] font-medium rounded bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors flex items-center gap-1"
                      title="Insert structured citation with optional locator"
                    >
                      <Quote className="w-3 h-3 text-slate-500" />
                      <span>Cite in Manuscript</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSummarizeEvidenceRequest(p.id, p.title)}
                      className="px-2 py-1 text-[11px] font-medium rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-colors flex items-center gap-1"
                      title="Draft an evidence-grounded summary"
                    >
                      <Sparkles className="w-3 h-3 text-indigo-600" />
                      <span>Summarize</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}

          {/* Section: Bibliography & Inserted Citations */}
          {(citations.length > 0 || bibliographyEntries.length > 0) && (
            <div className="pt-4 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
                  Bibliography ({bibliographyEntries.length || citations.length})
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-indigo-50 text-indigo-700 border border-indigo-200">
                  {activeStyleName}
                </span>
              </div>

              {/* Action: Insert Bibliography into Canvas */}
              {onInsertBibliographyToCanvas && bibliographyEntries.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onInsertBibliographyToCanvas}
                    className="flex-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1.5 shadow-xs"
                    title="Insert or update the References section in the manuscript"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Insert into Manuscript</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const text = bibliographyEntries.join("\n\n");
                      navigator.clipboard.writeText(text).catch(() => {});
                      setCopiedBib(true);
                      setTimeout(() => setCopiedBib(false), 2000);
                    }}
                    className="px-2 py-1.5 text-xs font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors flex items-center gap-1"
                    title="Copy formatted references to clipboard"
                  >
                    {copiedBib ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              )}

              {/* Formatted Bibliography Preview */}
              {bibliographyEntries.length > 0 ? (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {bibliographyEntries.map((entry, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded bg-slate-50 border border-slate-200/80 text-[11px] text-slate-700 leading-relaxed font-serif"
                    >
                      {entry}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {citations.map((c) => (
                    <div
                      key={c.id}
                      className="p-2 rounded bg-slate-50 border border-slate-100 text-[11px] text-slate-700"
                    >
                      <span className="font-semibold text-indigo-700">
                        {c.citationText}
                      </span>{" "}
                      — <span className="italic">{c.paper?.title}</span>
                      {c.section && (
                        <span className="text-slate-400 block text-[10px] mt-0.5">
                          Section: {c.section} {c.pageNumber ? `(p. ${c.pageNumber})` : ""}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Library Picker Modal */}
      {isPickerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-semibold text-slate-900">
                  Select Papers from My Library
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 border-b border-slate-100 bg-white">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search by title, author, or keyword..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {isLoadingLibrary ? (
                <div className="py-12 text-center text-slate-400 text-sm">
                  Loading library documents...
                </div>
              ) : actionError ? (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{actionError}</span>
                </div>
              ) : filteredLibrary.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-sm">
                  No matching papers found in your library.
                </div>
              ) : (
                filteredLibrary.map((item) => {
                  const isAlreadyAttached = linkedPaperIds.has(item.id);

                  return (
                    <div
                      key={item.id}
                      className="p-3 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors flex items-start justify-between gap-3 bg-white"
                    >
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-medium text-slate-900 line-clamp-1">
                          {item.title}
                        </h4>
                        <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                          {Array.isArray(item.authors)
                            ? item.authors.map(getSafeAuthorName).filter(Boolean).join(", ")
                            : (getSafeAuthorName(item.authors) || "Unknown Authors")}
                        </p>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1">
                          <span
                            className={`px-1.5 py-0.2 rounded font-medium ${
                              item.hasPdf
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {item.hasPdf ? "Full Text" : "Metadata Only"}
                          </span>
                          {item.documentType && (
                            <span className="uppercase">{item.documentType}</span>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleAttachPaper(item.id)}
                        disabled={isAlreadyAttached}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 flex-shrink-0 ${
                          isAlreadyAttached
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                            : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs"
                        }`}
                      >
                        {isAlreadyAttached ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-slate-400" />
                            <span>Attached</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5" />
                            <span>Attach</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-200 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Citation Locator Dialog */}
      {locatorTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Quote className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Insert Citation
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLocatorTarget(null);
                  setLocatorValue("");
                }}
                className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-600 font-medium line-clamp-2">
                {locatorTarget.title}
              </p>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  Page or Locator <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. 42 or 12-15"
                  value={locatorValue}
                  onChange={(e) => setLocatorValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onInsertStructuredCitation?.({
                        paperId: locatorTarget.id,
                        paperTitle: locatorTarget.title,
                        locator: locatorValue.trim() || undefined,
                      });
                      setLocatorTarget(null);
                      setLocatorValue("");
                    }
                  }}
                  autoFocus
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  CSL formats the locator according to the active style rules (e.g. p. 42).
                </span>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setLocatorTarget(null);
                  setLocatorValue("");
                }}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onInsertStructuredCitation?.({
                    paperId: locatorTarget.id,
                    paperTitle: locatorTarget.title,
                    locator: locatorValue.trim() || undefined,
                  });
                  setLocatorTarget(null);
                  setLocatorValue("");
                }}
                className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 rounded-md shadow-xs transition-colors"
              >
                Insert Citation
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
