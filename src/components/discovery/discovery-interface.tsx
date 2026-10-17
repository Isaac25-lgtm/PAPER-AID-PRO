"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Search,
  Globe,
  Download,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Sparkles,
  Info,
  Clock,
  Filter,
  FileText,
  Loader2,
  Quote,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Calendar,
  ArrowUpDown,
  SlidersHorizontal,
  X,
  FileCheck,
  ShieldCheck,
  Building,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  NormalizedExternalPaper,
  DiscoverySearchResult,
  SourceProvider,
} from "@/lib/discovery/types";
import { searchScholarlyAction, importPaperMetadataAction } from "@/lib/discovery/import-actions";
import { getResearchSnapshotAction } from "@/lib/discovery/snapshot/snapshot-actions";
import { ResearchSnapshot, SnapshotCitation } from "@/lib/discovery/snapshot/types";
import { AIResearchSnapshotCard } from "./ai-research-snapshot-card";
import { SourceEvidenceModal } from "./source-evidence-modal";
import { SavePromptModal } from "./save-prompt-modal";
import { cn } from "@/lib/utils";

type SearchCategory = "PAPERS" | "AUTHORS" | "JOURNALS";
type DateFilter = "ALL" | "1_YEAR" | "5_YEARS" | "10_YEARS" | "CUSTOM";
type SortOption = "RELEVANCE" | "NEWEST" | "MOST_CITED";

const EXAMPLE_QUERIES = [
  "breast ultrasound artificial intelligence",
  "deep learning radiomics breast cancer classification",
  "attention transformer medical imaging ultrasound",
  "computer aided diagnosis BI-RADS ultrasound",
];

export function DiscoveryInterface() {
  const router = useRouter();
  const { data: session } = useSession();

  const searchParams = useSearchParams();
  const activeSearchIdRef = React.useRef(0);

  // Search state
  const [query, setQuery] = React.useState("");
  const [activeQuery, setActiveQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [searchResult, setSearchResult] = React.useState<DiscoverySearchResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Compact Sub-Controls
  const [selectedCategory, setSelectedCategory] = React.useState<SearchCategory>("PAPERS");
  const [dateFilter, setDateFilter] = React.useState<DateFilter>("ALL");
  const [customYearStart, setCustomYearStart] = React.useState("");
  const [customYearEnd, setCustomYearEnd] = React.useState("");
  const [openAccessOnly, setOpenAccessOnly] = React.useState(false);
  const [sortBy, setSortBy] = React.useState<SortOption>("RELEVANCE");

  // Advanced Search Panel Toggle
  const [showAdvancedSearch, setShowAdvancedSearch] = React.useState(false);
  const [autoGenerateSnapshot, setAutoGenerateSnapshot] = React.useState(true);
  const [selectedProviders, setSelectedProviders] = React.useState<SourceProvider[]>([
    "CITED_EVIDENCE",
    "PUBMED",
    "CROSSREF",
    "SEMANTIC_SCHOLAR",
  ]);

  // AI Research Snapshot State
  const [snapshot, setSnapshot] = React.useState<ResearchSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = React.useState(false);
  const [snapshotError, setSnapshotError] = React.useState<string | null>(null);

  // Modals state
  const [activeEvidenceCitation, setActiveEvidenceCitation] = React.useState<SnapshotCitation | null>(null);
  const [savePromptTargetTitle, setSavePromptTargetTitle] = React.useState<string | undefined>(undefined);
  const [isSavePromptOpen, setIsSavePromptOpen] = React.useState(false);

  // In-line UI states
  const [expandedAbstracts, setExpandedAbstracts] = React.useState<Record<string, boolean>>({});
  const [importingPaperId, setImportingPaperId] = React.useState<string | null>(null);
  const [importSuccessMap, setImportSuccessMap] = React.useState<
    Record<string, { paperId: string; fullTextStatus?: string; message?: string }>
  >({});
  const [importErrorMap, setImportErrorMap] = React.useState<Record<string, string>>({});

  // Synchronize URL ?q= parameter on mount or browser navigation
  React.useEffect(() => {
    const qParam = searchParams?.get("q")?.trim();
    if (qParam && qParam !== activeQuery) {
      setQuery(qParam);
      handleSearch(undefined, qParam);
    }
  }, [searchParams]);

  const toggleProvider = (provider: SourceProvider) => {
    setSelectedProviders((prev) => {
      if (prev.includes(provider)) {
        if (prev.length === 1) return prev; // Keep at least one
        return prev.filter((p) => p !== provider);
      }
      return [...prev, provider];
    });
  };

  const insertBooleanOperator = (op: string) => {
    setQuery((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return op === '""' ? '""' : op;
      if (op === '""') return `${trimmed} ""`;
      return `${trimmed} ${op} `;
    });
  };

  const handleSearch = async (e?: React.FormEvent, customQuery?: string) => {
    if (e) e.preventDefault();
    const q = (customQuery !== undefined ? customQuery : query).trim();
    if (!q) return;

    // Increment request ID to invalidate any in-flight or older requests
    const currentSearchId = ++activeSearchIdRef.current;

    setActiveQuery(q);
    setLoading(true);
    setError(null);
    setSnapshot(null);
    setSnapshotError(null);

    // Keep URL parameter in sync without reloading page
    try {
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        if (url.searchParams.get("q") !== q) {
          url.searchParams.set("q", q);
          window.history.replaceState(null, "", url.toString());
        }
      }
    } catch {
      // Non-fatal if running in environments without window.location
    }

    try {
      const res = await searchScholarlyAction(q, {
        limitPerProvider: 10,
        enabledProviders: selectedProviders,
        openAccessOnly,
      });

      // Discard response if a newer query has superseded this one
      if (activeSearchIdRef.current !== currentSearchId) {
        return;
      }

      setSearchResult(res);

      // Auto-trigger AI Research Snapshot if enabled and papers were found
      if (autoGenerateSnapshot && res.papers && res.papers.length > 0) {
        fetchSnapshot(q, res.papers, { searchId: currentSearchId });
      }
    } catch (err: any) {
      if (activeSearchIdRef.current !== currentSearchId) return;
      setError(err?.message || "Failed to search scholarly sources. Please try again.");
    } finally {
      if (activeSearchIdRef.current === currentSearchId) {
        setLoading(false);
      }
    }
  };

  const fetchSnapshot = async (
    searchQ: string,
    papersToSynthesize: NormalizedExternalPaper[],
    options: { searchId?: number; forceRefresh?: boolean } = {}
  ) => {
    const boundSearchId = options.searchId ?? activeSearchIdRef.current;
    setSnapshotLoading(true);
    setSnapshotError(null);
    try {
      const res = await getResearchSnapshotAction(searchQ, papersToSynthesize, {
        forceRefresh: options.forceRefresh,
      });
      // Stale check
      if (activeSearchIdRef.current !== boundSearchId) {
        return;
      }
      if (res.success && res.snapshot) {
        setSnapshot(res.snapshot);
      } else {
        setSnapshotError(res.error || "Unable to generate snapshot at this time.");
      }
    } catch (err: any) {
      if (activeSearchIdRef.current !== boundSearchId) return;
      setSnapshotError(err?.message || "Failed to communicate with snapshot service.");
    } finally {
      if (activeSearchIdRef.current === boundSearchId) {
        setSnapshotLoading(false);
      }
    }
  };

  const handleImport = async (
    paper: NormalizedExternalPaper,
    attemptFullTextFetch: boolean = false
  ) => {
    if (!session?.user) {
      // Unauthenticated visitor: Open Save Prompt Modal
      setSavePromptTargetTitle(paper.title);
      setIsSavePromptOpen(true);
      return;
    }

    setImportingPaperId(paper.id);
    setImportErrorMap((prev) => {
      const next = { ...prev };
      delete next[paper.id];
      return next;
    });

    try {
      const res = await importPaperMetadataAction(paper, { attemptFullTextFetch });
      if (res.success && res.paperId) {
        setImportSuccessMap((prev) => ({
          ...prev,
          [paper.id]: {
            paperId: res.paperId!,
            fullTextStatus: res.fullTextStatus,
            message: res.message,
          },
        }));

        // Update local status in current result list
        if (searchResult) {
          setSearchResult({
            ...searchResult,
            papers: searchResult.papers.map((p) => {
              if (p.id === paper.id) {
                return {
                  ...p,
                  localStatus: {
                    inLibrary: true,
                    paperId: res.paperId,
                    processingStatus: (res.fullTextStatus as any) || "METADATA_ONLY",
                    hasFullText:
                      res.fullTextStatus === "COMPLETED" ||
                      res.fullTextStatus === "FULL_TEXT_AVAILABLE",
                  },
                };
              }
              return p;
            }),
          });
        }
      } else {
        if (res.error?.includes("Authentication required") || res.error?.includes("sign in")) {
          setSavePromptTargetTitle(paper.title);
          setIsSavePromptOpen(true);
          return;
        }
        setImportErrorMap((prev) => ({
          ...prev,
          [paper.id]: res.error || "Failed to save paper.",
        }));
      }
    } catch (err: any) {
      setImportErrorMap((prev) => ({
        ...prev,
        [paper.id]: err?.message || "An unexpected error occurred during save.",
      }));
    } finally {
      setImportingPaperId(null);
    }
  };

  const toggleAbstract = (paperId: string) => {
    setExpandedAbstracts((prev) => ({
      ...prev,
      [paperId]: !prev[paperId],
    }));
  };

  // Filtered and Sorted Papers according to compact sub-controls
  const filteredAndSortedPapers = React.useMemo(() => {
    if (!searchResult) return [];
    let list = [...searchResult.papers];

    // Category filtering
    if (selectedCategory === "AUTHORS") {
      const qLower = (activeQuery || query).toLowerCase().trim();
      if (qLower) {
        const matching = list.filter((p) =>
          p.authors.some((a) => a.name.toLowerCase().includes(qLower))
        );
        if (matching.length > 0) list = matching;
      }
    } else if (selectedCategory === "JOURNALS") {
      const qLower = (activeQuery || query).toLowerCase().trim();
      if (qLower) {
        const matching = list.filter(
          (p) => p.journal && p.journal.toLowerCase().includes(qLower)
        );
        if (matching.length > 0) list = matching;
      }
    }

    // Open Access filter
    if (openAccessOnly) {
      list = list.filter((p) => p.isOpenAccess);
    }

    // Publication Date Filter
    const currentYear = new Date().getFullYear();
    if (dateFilter === "1_YEAR") {
      list = list.filter((p) => p.year && p.year >= currentYear - 1);
    } else if (dateFilter === "5_YEARS") {
      list = list.filter((p) => p.year && p.year >= currentYear - 5);
    } else if (dateFilter === "10_YEARS") {
      list = list.filter((p) => p.year && p.year >= currentYear - 10);
    } else if (dateFilter === "CUSTOM") {
      const start = customYearStart ? parseInt(customYearStart, 10) : null;
      const end = customYearEnd ? parseInt(customYearEnd, 10) : null;
      if (start) list = list.filter((p) => p.year && p.year >= start);
      if (end) list = list.filter((p) => p.year && p.year <= end);
    }

    // Sorting
    if (sortBy === "NEWEST") {
      list.sort((a, b) => (b.year || 0) - (a.year || 0));
    } else if (sortBy === "MOST_CITED") {
      list.sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));
    }
    // RELEVANCE preserves hybrid rank order

    return list;
  }, [
    searchResult,
    selectedCategory,
    openAccessOnly,
    dateFilter,
    customYearStart,
    customYearEnd,
    sortBy,
    activeQuery,
    query,
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-indigo-600 font-semibold text-xs uppercase tracking-wider mb-2">
          <Globe className="h-4 w-4" />
          <span>Academic Intelligence Discovery</span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          Scholarly Research Discovery
        </h1>
        <p className="mt-2 text-base text-slate-600 max-w-3xl">
          Search global peer-reviewed literature across PubMed, Crossref, Semantic Scholar, and
          CitedEvidence. Instantly view an evidence-grounded AI Research Snapshot, inspect supporting
          citations, and save verified papers to your private library.
        </p>
      </div>

      {/* Scope and Evidence Boundary Disclosure */}
      <div className="mb-6 rounded-lg border border-amber-200/80 bg-amber-50/50 p-3.5 text-xs text-amber-900 flex items-start gap-3">
        <Info className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="font-semibold text-amber-950">
            Scholarly Integrity &amp; Evidence Grounding Standard
          </p>
          <p className="text-amber-800 leading-relaxed">
            External search results reflect provider metadata. AI Research Snapshots are strictly
            grounded in retrieved paper abstracts or verified manuscript full text — citations link
            directly to the exact supporting source passage.
          </p>
        </div>
      </div>

      {/* Prominent Search Bar & Compact Controls Card */}
      <Card className="p-4 sm:p-6 mb-8 border-slate-200 shadow-sm bg-white">
        <form onSubmit={(e) => handleSearch(e)} className="space-y-4">
          {/* Main Natural Language Search Bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-3.5 h-5 w-5 text-slate-400" />
              <Input
                type="text"
                placeholder="Ask a scientific question or enter topic, DOI, author, or keyword..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-11 pr-8 h-12 text-base border-slate-300 focus:border-indigo-600 rounded-lg shadow-2xs"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-600"
                  title="Clear search"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
            <Button
              type="submit"
              disabled={loading || !query.trim()}
              className="h-12 px-7 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center justify-center gap-2 shrink-0 rounded-lg shadow-2xs transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Searching...</span>
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  <span>Search Literature</span>
                </>
              )}
            </Button>
          </div>

          {/* Sample Topic Chips */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-slate-500">
            <span className="font-medium text-slate-600 mr-1">Suggested topics:</span>
            {EXAMPLE_QUERIES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setQuery(q);
                  handleSearch(undefined, q);
                }}
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>

          {/* COMPACT SUB-CONTROLS DIRECTLY BELOW */}
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Left: Category Selector & Date Filter */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Category Pills */}
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50/80 p-0.5">
                {(
                  [
                    { id: "PAPERS", label: "Papers", icon: FileText },
                    { id: "AUTHORS", label: "Authors", icon: User },
                    { id: "JOURNALS", label: "Journals", icon: Building },
                  ] as const
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedCategory(id)}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors",
                      selectedCategory === id
                        ? "bg-white text-indigo-700 shadow-2xs font-semibold"
                        : "text-slate-600 hover:text-slate-900"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {/* Publication Date Filter */}
              <div className="flex items-center gap-1.5 text-slate-600">
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value as DateFilter)}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="ALL">All Publication Dates</option>
                  <option value="1_YEAR">Past 1 Year</option>
                  <option value="5_YEARS">Past 5 Years</option>
                  <option value="10_YEARS">Past 10 Years</option>
                  <option value="CUSTOM">Custom Year Range...</option>
                </select>
              </div>

              {/* Custom Year Inputs if selected */}
              {dateFilter === "CUSTOM" && (
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    placeholder="From"
                    value={customYearStart}
                    onChange={(e) => setCustomYearStart(e.target.value)}
                    className="h-7 w-16 text-xs p-1"
                  />
                  <span className="text-slate-400">–</span>
                  <Input
                    type="number"
                    placeholder="To"
                    value={customYearEnd}
                    onChange={(e) => setCustomYearEnd(e.target.value)}
                    className="h-7 w-16 text-xs p-1"
                  />
                </div>
              )}
            </div>

            {/* Right: Open Access Toggle & Sort Selector */}
            <div className="flex flex-wrap items-center gap-4">
              {/* Open Access Toggle */}
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-700 font-medium">
                <input
                  type="checkbox"
                  checked={openAccessOnly}
                  onChange={(e) => setOpenAccessOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Open Access Only</span>
                </span>
              </label>

              {/* Sort Selector */}
              <div className="flex items-center gap-1.5 text-slate-600">
                <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="RELEVANCE">Sort: Relevance</option>
                  <option value="NEWEST">Sort: Newest First</option>
                  <option value="MOST_CITED">Sort: Most Cited</option>
                </select>
              </div>

              {/* Advanced Search Panel Toggle Button */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
                className="h-8 px-2 text-xs text-slate-600 hover:text-indigo-600 flex items-center gap-1"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Advanced</span>
                {showAdvancedSearch ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>

          {/* COLLAPSIBLE ADVANCED SEARCH PANEL */}
          {showAdvancedSearch && (
            <div className="mt-3 pt-3 border-t border-slate-100 bg-slate-50/60 p-3.5 rounded-lg space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-700">Boolean Query Builder &amp; Operators:</span>
                <span className="text-slate-500 text-[11px]">Click to append syntax to search bar</span>
              </div>

              {/* Boolean Operators Bar */}
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { label: "AND", op: "AND" },
                  { label: "OR", op: "OR" },
                  { label: "NOT", op: "NOT" },
                  { label: 'Exact Phrase "..."', op: '""' },
                ].map(({ label, op }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => insertBooleanOperator(op)}
                    className="px-2.5 py-1 rounded bg-white border border-slate-200 text-slate-700 font-mono text-[11px] hover:border-indigo-400 hover:text-indigo-700 transition-colors shadow-2xs"
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Connected Source Providers */}
              <div className="pt-2 border-t border-slate-200/60 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-700 flex items-center gap-1">
                    <Filter className="h-3.5 w-3.5 text-slate-500" />
                    Scholarly Sources:
                  </span>
                  {(
                    ["CITED_EVIDENCE", "PUBMED", "CROSSREF", "SEMANTIC_SCHOLAR"] as SourceProvider[]
                  ).map((prov) => {
                    const active = selectedProviders.includes(prov);
                    return (
                      <button
                        key={prov}
                        type="button"
                        onClick={() => toggleProvider(prov)}
                        className={cn(
                          "px-2.5 py-0.5 rounded-md font-medium border text-[11px] transition-colors",
                          active
                            ? "bg-indigo-50 border-indigo-200 text-indigo-700 font-semibold"
                            : "bg-white border-slate-200 text-slate-500 hover:text-slate-700"
                        )}
                      >
                        {prov === "CITED_EVIDENCE" && "CitedEvidence"}
                        {prov === "PUBMED" && "PubMed"}
                        {prov === "CROSSREF" && "Crossref"}
                        {prov === "SEMANTIC_SCHOLAR" && "Semantic Scholar"}
                      </button>
                    );
                  })}
                </div>

                {/* AI Research Snapshot Configuration */}
                <label className="flex items-center gap-2 cursor-pointer select-none text-slate-700">
                  <input
                    type="checkbox"
                    checked={autoGenerateSnapshot}
                    onChange={(e) => setAutoGenerateSnapshot(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-indigo-600" />
                    <span>Auto-generate AI Snapshot</span>
                  </span>
                </label>
              </div>
            </div>
          )}
        </form>
      </Card>

      {/* Error state */}
      {error && (
        <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Search Failure</p>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Partial Provider Failure Warning */}
      {searchResult && (() => {
        const failed = Object.values(searchResult.providerResults).filter(
          (p) => p.status === "RATE_LIMITED" || p.status === "TIMEOUT" || p.status === "ERROR"
        );
        if (failed.length === 0) return null;
        return (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50/90 p-3.5 text-xs text-amber-900 flex items-start gap-3 shadow-2xs">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold text-amber-950">
                Partial Provider Availability Notice
              </p>
              <p className="text-amber-800 leading-relaxed">
                {failed
                  .map((p) => {
                    const name =
                      p.provider === "SEMANTIC_SCHOLAR"
                        ? "Semantic Scholar"
                        : p.provider === "PUBMED"
                        ? "PubMed"
                        : p.provider === "CROSSREF"
                        ? "Crossref"
                        : "CitedEvidence";
                    const issue =
                      p.status === "RATE_LIMITED"
                        ? "rate-limited"
                        : p.status === "TIMEOUT"
                        ? "timed out"
                        : "temporarily unavailable";
                    return `${name} (${issue})`;
                  })
                  .join(", ")}
                . Literature retrieved from active providers is displayed below.
              </p>
            </div>
          </div>
        );
      })()}

      {/* Telemetry and Results Counter Bar */}
      {searchResult && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-slate-100/70 p-3 text-xs text-slate-600">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-slate-900">
              {filteredAndSortedPapers.length} results
            </span>
            <span className="text-slate-400">•</span>
            <span>
              {searchResult.totalRawResults} raw records ({searchResult.totalRawResults - searchResult.totalUniqueResults} merged duplicates)
            </span>
            <span className="text-slate-400">•</span>
            <span className="flex items-center gap-1 text-slate-500">
              <Clock className="h-3 w-3" />
              {(searchResult.timingMs / 1000).toFixed(2)}s
            </span>
          </div>

          {/* Manual Snapshot Trigger if not auto-generated */}
          {!snapshot && !snapshotLoading && searchResult.papers.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchSnapshot(activeQuery || query, searchResult.papers)}
              className="h-7 text-xs border-indigo-200 text-indigo-700 hover:bg-indigo-50 flex items-center gap-1.5"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Generate AI Research Snapshot</span>
            </Button>
          )}
        </div>
      )}

      {/* COMPACT AI RESEARCH SNAPSHOT PANEL */}
      {(snapshot || snapshotLoading || snapshotError) && (
        <div className="mb-8">
          <AIResearchSnapshotCard
            snapshot={snapshot}
            loading={snapshotLoading}
            error={snapshotError}
            onSelectCitation={(citation: SnapshotCitation) => setActiveEvidenceCitation(citation)}
            onRefresh={() => {
              if (searchResult && searchResult.papers.length > 0) {
                fetchSnapshot(activeQuery || query, searchResult.papers, { forceRefresh: true });
              }
            }}
          />
        </div>
      )}

      {/* SCHOLARLY SEARCH RESULTS LIST */}
      <div className="space-y-4">
        {filteredAndSortedPapers.map((paper) => {
          const isExpanded = Boolean(expandedAbstracts[paper.id]);
          const isImporting = importingPaperId === paper.id;
          const importSuccess = importSuccessMap[paper.id];
          const importError = importErrorMap[paper.id];
          const localStatus = paper.localStatus;
          const isInLibrary = Boolean(localStatus?.inLibrary) || Boolean(importSuccess);
          const hasLawfulFullText =
            paper.fullTextAvailability === "FULL_TEXT_AVAILABLE" &&
            Boolean(paper.pmcid || paper.openAccessPdfUrl || paper.arxivId);

          return (
            <Card
              key={paper.id}
              className="p-5 border-slate-200 hover:border-slate-300 transition-all bg-white shadow-2xs rounded-xl"
            >
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                {/* Main Paper Metadata Column */}
                <div className="flex-1 space-y-2">
                  {/* Top Badges Bar */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Provider Provenance Badges */}
                    {paper.sourceProviders.map((prov) => (
                      <Badge
                        key={prov}
                        variant="secondary"
                        className="text-[10px] font-semibold bg-slate-100 text-slate-700"
                      >
                        {prov === "CITED_EVIDENCE" && "CitedEvidence"}
                        {prov === "PUBMED" && "PubMed"}
                        {prov === "CROSSREF" && "Crossref"}
                        {prov === "SEMANTIC_SCHOLAR" && "Semantic Scholar"}
                      </Badge>
                    ))}

                    {/* Open Access Badge */}
                    {paper.isOpenAccess && (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-semibold border-emerald-200 bg-emerald-50 text-emerald-700"
                      >
                        Open Access
                      </Badge>
                    )}

                    {/* Descriptive Bibliometric Citation Count */}
                    {paper.citationCount !== null && paper.citationCount !== undefined && (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-medium border-slate-200 text-slate-600"
                        title="Descriptive external citations from scholarly graph; does not evaluate internal evidence validity."
                      >
                        {paper.citationCount.toLocaleString()} external citations
                      </Badge>
                    )}

                    {/* Lawful Open Full Text badge */}
                    {hasLawfulFullText && (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-semibold border-indigo-200 bg-indigo-50 text-indigo-700"
                      >
                        {paper.pmcid
                          ? "PMC Open Full Text Available"
                          : paper.arxivId
                          ? "arXiv Open Full Text Available"
                          : "Open-Access Full Text Available"}
                      </Badge>
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="text-lg font-bold text-slate-900 leading-snug">
                    {paper.title}
                  </h3>

                  {/* Authors & Publication Line */}
                  <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-slate-800">
                      {paper.authors.length > 0
                        ? paper.authors.slice(0, 5).map((a) => a.name).join(", ") +
                          (paper.authors.length > 5 ? ` et al. (${paper.authors.length} authors)` : "")
                        : "Unknown Authors"}
                    </span>
                    {paper.journal && (
                      <>
                        <span className="text-slate-300">•</span>
                        <span className="italic font-medium">{paper.journal}</span>
                      </>
                    )}
                    {paper.year && (
                      <>
                        <span className="text-slate-300">•</span>
                        <span>{paper.year}</span>
                      </>
                    )}
                  </div>

                  {/* Identifiers (DOI, PMID, PMCID) */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 font-mono">
                    {paper.doi && (
                      <a
                        href={`https://doi.org/${paper.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-indigo-600 flex items-center gap-1"
                      >
                        <span>doi:{paper.doi}</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {paper.pmid && (
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-indigo-600 flex items-center gap-1"
                      >
                        <span>PMID:{paper.pmid}</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {paper.pmcid && (
                      <a
                        href={`https://www.ncbi.nlm.nih.gov/pmc/articles/${paper.pmcid}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-indigo-600 flex items-center gap-1"
                      >
                        <span>{paper.pmcid}</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>

                  {/* Abstract Preview with expand/collapse */}
                  {paper.abstract ? (
                    <div className="pt-2 text-xs text-slate-700 leading-relaxed bg-slate-50/50 p-2.5 rounded-lg border border-slate-100">
                      <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">
                        Abstract Excerpt:
                      </div>
                      <p className={cn("transition-all", !isExpanded && "line-clamp-2")}>
                        {paper.abstract}
                      </p>
                      {paper.abstract.length > 200 && (
                        <button
                          type="button"
                          onClick={() => toggleAbstract(paper.id)}
                          className="mt-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                        >
                          {isExpanded ? "Show less" : "Read full abstract"}
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="pt-1 text-xs italic text-slate-400">
                      Abstract not provided in provider metadata.
                    </p>
                  )}
                </div>

                {/* Right Action Column */}
                <div className="flex flex-col sm:items-end justify-between gap-3 shrink-0 md:min-w-[210px] border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 md:pl-4">
                  {/* Action Group: View Paper, Cite, Save to Library */}
                  <div className="flex flex-col items-start sm:items-end gap-2 w-full">
                    {/* View Paper Button */}
                    {localStatus?.paperId || importSuccess?.paperId ? (
                      <Link
                        href={`/papers/${localStatus?.paperId || importSuccess?.paperId}`}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 w-full sm:w-auto justify-center"
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                        <span>View Paper</span>
                      </Link>
                    ) : paper.externalUrl || paper.doi ? (
                      <a
                        href={paper.externalUrl || `https://doi.org/${paper.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 w-full sm:w-auto justify-center"
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                        <span>View Paper</span>
                        <ExternalLink className="h-3 w-3 text-slate-400" />
                      </a>
                    ) : null}

                    {/* Save to My Library Controls */}
                    {isInLibrary ? (
                      <div className="flex flex-col items-start sm:items-end gap-1 w-full pt-1">
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-semibold flex items-center gap-1 px-2.5 py-0.5 text-[11px]">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>In My Library</span>
                        </Badge>
                        <span className="text-[10px] text-slate-500 sm:text-right">
                          {localStatus?.hasFullText || importSuccess?.fullTextStatus === "COMPLETED"
                            ? "Full text processed for AI inquiry"
                            : "Metadata saved"}
                        </span>
                      </div>
                    ) : (
                      <div className="w-full sm:w-auto space-y-1">
                        {hasLawfulFullText ? (
                          <>
                            <Button
                              size="sm"
                              disabled={isImporting}
                              onClick={() => handleImport(paper, true)}
                              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 h-8"
                            >
                              {isImporting ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  <span>Saving &amp; Attaching...</span>
                                </>
                              ) : (
                                <>
                                  <Download className="h-3.5 w-3.5" />
                                  <span>Save &amp; Get Full Text</span>
                                </>
                              )}
                            </Button>
                            <button
                              type="button"
                              disabled={isImporting}
                              onClick={() => handleImport(paper, false)}
                              className="text-[10px] text-slate-500 hover:text-slate-800 underline block text-center sm:text-right"
                            >
                              Save metadata only
                            </button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            disabled={isImporting}
                            onClick={() => handleImport(paper, false)}
                            variant="outline"
                            className="w-full sm:w-auto border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-semibold text-xs flex items-center justify-center gap-1.5 h-8"
                          >
                            {isImporting ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Saving...</span>
                              </>
                            ) : (
                              <>
                                <Bookmark className="h-3.5 w-3.5" />
                                <span>Save to My Library</span>
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Inline Error Feedback if save fails */}
                    {importError && (
                      <div
                        role="alert"
                        className="flex items-start gap-1.5 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2 mt-1 w-full max-w-[240px] animate-in fade-in duration-150"
                      >
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-500 mt-0.5" />
                        <span className="leading-snug">{importError}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}

        {/* Results States when 0 papers are displayed */}
        {searchResult && filteredAndSortedPapers.length === 0 && !loading && (() => {
          const providerList = Object.values(searchResult.providerResults);
          const allFailed = providerList.length > 0 && providerList.every((p) => p.status !== "SUCCESS");
          const someFailed = providerList.some((p) => p.status !== "SUCCESS");
          const failedNames = providerList
            .filter((p) => p.status !== "SUCCESS")
            .map((p) =>
              p.provider === "SEMANTIC_SCHOLAR"
                ? "Semantic Scholar"
                : p.provider === "PUBMED"
                ? "PubMed"
                : p.provider === "CROSSREF"
                ? "Crossref"
                : "CitedEvidence"
            );

          // State 1: All scholarly providers unavailable
          if (allFailed) {
            return (
              <Card className="p-12 text-center border-rose-200 bg-rose-50/40">
                <AlertCircle className="h-10 w-10 text-rose-500 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-rose-950">
                  All scholarly providers temporarily unavailable
                </h3>
                <p className="mt-1 text-sm text-rose-800 max-w-lg mx-auto">
                  None of the connected scholarly literature providers could be reached due to network timeouts, rate limits, or service outages. This is not a confirmed zero-result search in the literature.
                </p>
                <div className="mt-4">
                  <Button
                    type="button"
                    onClick={() => handleSearch(undefined, activeQuery || query)}
                    variant="outline"
                    className="border-rose-300 text-rose-800 hover:bg-rose-100 text-xs font-semibold"
                  >
                    Retry Search
                  </Button>
                </div>
              </Card>
            );
          }

          // State 2: Some providers unavailable, remaining active providers returned 0
          if (someFailed) {
            return (
              <Card className="p-12 text-center border-amber-200 bg-amber-50/30">
                <AlertCircle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-slate-900">
                  No matching studies found (Partial Provider Response)
                </h3>
                <p className="mt-1 text-sm text-slate-600 max-w-lg mx-auto">
                  The active providers that responded found no matching studies for your query. Note that {failedNames.join(", ")} {failedNames.length === 1 ? "was" : "were"} unavailable.
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Try broadening your terms, toggling off Open Access, or retrying to query all providers.
                </p>
              </Card>
            );
          }

          // State 3: Genuine zero results (all active providers responded successfully with 0 matches)
          return (
            <Card className="p-12 text-center border-slate-200 bg-white">
              <BookOpen className="h-10 w-10 text-slate-400 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-slate-900">
                No matching studies found
              </h3>
              <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
                No peer-reviewed literature matched your search across the selected filters.
                Try adjusting your date range, toggling off Open Access, or broadening the query.
              </p>
            </Card>
          );
        })()}
      </div>

      {/* MODALS */}
      {/* 1. Source Evidence Provenance Modal */}
      <SourceEvidenceModal
        citation={activeEvidenceCitation}
        isOpen={Boolean(activeEvidenceCitation)}
        onClose={() => setActiveEvidenceCitation(null)}
      />

      {/* 3. Guest Save Prompt Modal */}
      <SavePromptModal
        paperTitle={savePromptTargetTitle}
        isOpen={isSavePromptOpen}
        onClose={() => setIsSavePromptOpen(false)}
      />
    </div>
  );
}

