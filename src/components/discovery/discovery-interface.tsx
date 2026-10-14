"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Search,
  Globe,
  Download,
  BookOpen,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Layers,
  Sparkles,
  Info,
  Clock,
  Filter,
  FileText,
  Loader2,
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
import { cn } from "@/lib/utils";

const EXAMPLE_QUERIES = [
  "breast ultrasound artificial intelligence",
  "deep learning radiomics breast cancer classification",
  "attention transformer medical imaging ultrasound",
  "computer aided diagnosis BI-RADS ultrasound",
];

export function DiscoveryInterface() {
  const router = useRouter();
  const { data: session } = useSession();
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [searchResult, setSearchResult] = React.useState<DiscoverySearchResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Filters
  const [selectedProviders, setSelectedProviders] = React.useState<SourceProvider[]>([
    "CITED_EVIDENCE",
    "PUBMED",
    "CROSSREF",
    "SEMANTIC_SCHOLAR",
  ]);
  const [openAccessOnly, setOpenAccessOnly] = React.useState(false);
  const [expandedAbstracts, setExpandedAbstracts] = React.useState<Record<string, boolean>>({});

  // Import states
  const [importingPaperId, setImportingPaperId] = React.useState<string | null>(null);
  const [importSuccessMap, setImportSuccessMap] = React.useState<
    Record<string, { paperId: string; fullTextStatus?: string; message?: string }>
  >({});

  const toggleProvider = (provider: SourceProvider) => {
    setSelectedProviders((prev) => {
      if (prev.includes(provider)) {
        if (prev.length === 1) return prev; // Keep at least one
        return prev.filter((p) => p !== provider);
      }
      return [...prev, provider];
    });
  };

  const handleSearch = async (e?: React.FormEvent, customQuery?: string) => {
    if (e) e.preventDefault();
    const q = customQuery !== undefined ? customQuery : query;
    if (!q.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await searchScholarlyAction(q, {
        limitPerProvider: 10,
        enabledProviders: selectedProviders,
        openAccessOnly,
      });
      setSearchResult(res);
    } catch (err: any) {
      setError(err?.message || "Failed to search scholarly sources. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (
    paper: NormalizedExternalPaper,
    attemptFullTextFetch: boolean = false
  ) => {
    if (!session?.user) {
      router.push(`/login?callbackUrl=/discover`);
      return;
    }

    setImportingPaperId(paper.id);
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
                    hasFullText: res.fullTextStatus === "COMPLETED" || res.fullTextStatus === "FULL_TEXT_AVAILABLE",
                  },
                };
              }
              return p;
            }),
          });
        }
      } else {
        if (res.error?.includes("Authentication required") || res.error?.includes("sign in")) {
          router.push(`/login?callbackUrl=/discover`);
          return;
        }
        alert(res.error || "Failed to import paper.");
      }
    } catch (err: any) {
      alert(`Import error: ${err?.message || "An unexpected error occurred."}`);
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

  const filteredPapers = React.useMemo(() => {
    if (!searchResult) return [];
    let list = searchResult.papers;
    if (openAccessOnly) {
      list = list.filter((p) => p.isOpenAccess);
    }
    return list;
  }, [searchResult, openAccessOnly]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-indigo-600 font-semibold text-xs uppercase tracking-wider mb-2">
          <Globe className="h-4 w-4" />
          <span>External Scholarly Discovery</span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          Search Global Research Literature
        </h1>
        <p className="mt-2 text-base text-slate-600 max-w-3xl">
          Search across CitedEvidence Scholar, PubMed, Crossref, and Semantic Scholar with automated deduplication and
          identity resolution. Import metadata and lawfully retrieve open-access manuscripts into your
          evidence library.
        </p>
      </div>

      {/* Scope and Scientific Evaluation Disclosure */}
      <div className="mb-6 rounded-lg border border-amber-200/80 bg-amber-50/50 p-4 text-xs text-amber-900 flex items-start gap-3">
        <Info className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-amber-950">
            Scholarly Discovery & Evidence Boundary Disclosure
          </p>
          <p className="text-amber-800 leading-relaxed">
            External search results are ranked by provider relevance. Citation counts represent
            descriptive external bibliometrics and do not represent internal evidence evaluation or
            scientific consensus. Discovered metadata does not automatically participate in Phase 7 RAG
            or Phase 8 research synthesis until authentic full-text manuscripts are imported and
            processed into the local library.
          </p>
        </div>
      </div>

      {/* Search Input Bar */}
      <Card className="p-4 sm:p-6 mb-8 border-slate-200 shadow-xs bg-white">
        <form onSubmit={(e) => handleSearch(e)} className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-3 h-5 w-5 text-slate-400" />
              <Input
                type="text"
                placeholder="Search by topic, keyword, title, or DOI (e.g., breast ultrasound artificial intelligence)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-11 h-12 text-base border-slate-300 focus:border-indigo-600"
              />
            </div>
            <Button
              type="submit"
              disabled={loading || !query.trim()}
              className="h-12 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center justify-center gap-2 shrink-0"
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

          {/* Query Suggestion Chips */}
          <div className="flex flex-wrap items-center gap-2 pt-2 text-xs text-slate-500">
            <span className="font-medium text-slate-600">Sample topics:</span>
            {EXAMPLE_QUERIES.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setQuery(q);
                  handleSearch(undefined, q);
                }}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Provider Selection and Filters Bar */}
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-700 flex items-center gap-1">
                <Filter className="h-3.5 w-3.5 text-slate-500" />
                Connected Sources:
              </span>
              {(["CITED_EVIDENCE", "PUBMED", "CROSSREF", "SEMANTIC_SCHOLAR"] as SourceProvider[]).map((prov) => {
                const active = selectedProviders.includes(prov);
                return (
                  <button
                    key={prov}
                    type="button"
                    onClick={() => toggleProvider(prov)}
                    className={cn(
                      "px-2.5 py-1 rounded-md font-medium border transition-colors",
                      active
                        ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                        : "bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-700"
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

            <label className="flex items-center gap-2 cursor-pointer select-none text-slate-700">
              <input
                type="checkbox"
                checked={openAccessOnly}
                onChange={(e) => setOpenAccessOnly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>Open Access Only</span>
            </label>
          </div>
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

      {/* Telemetry and Provider Status Bar */}
      {searchResult && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-slate-100/70 p-3 text-xs text-slate-600">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-slate-900">
              {filteredPapers.length} unique results
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

          {/* Expandable Source Details Toggle */}
          <div className="flex items-center gap-2">
            {Object.values(searchResult.providerResults).some((p) => p.status !== "SUCCESS") ? (
              <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1">
                <Info className="h-3 w-3 text-amber-600" />
                <span>Some sources temporarily limited</span>
              </span>
            ) : (
              <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                <span>All connected sources active</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => setExpandedAbstracts((prev) => ({ ...prev, __providerDetails: !prev.__providerDetails }))}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
            >
              {expandedAbstracts.__providerDetails ? "Hide source details" : "Source details"}
            </button>
          </div>
        </div>
      )}

      {/* Expandable Provider Telemetry Details */}
      {searchResult && expandedAbstracts.__providerDetails && (
        <div className="mb-6 p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
          <div className="font-semibold text-slate-700">Source Provider Status:</div>
          <div className="flex flex-wrap gap-2">
            {Object.values(searchResult.providerResults).map((pRes) => (
              <div
                key={pRes.provider}
                className={cn(
                  "p-2 rounded-lg border text-xs space-y-0.5 min-w-[140px]",
                  pRes.status === "SUCCESS"
                    ? "border-emerald-200 bg-emerald-50/60 text-emerald-800"
                    : pRes.status === "RATE_LIMITED"
                    ? "border-amber-200 bg-amber-50/60 text-amber-800"
                    : "border-rose-200 bg-rose-50/60 text-rose-800"
                )}
              >
                <div className="font-bold text-[11px]">
                  {pRes.provider === "PUBMED" ? "PubMed" : pRes.provider === "CROSSREF" ? "Crossref" : "Semantic Scholar"}
                </div>
                <div className="text-[11px]">
                  {pRes.status === "SUCCESS" ? `${pRes.count} records retrieved` : pRes.status === "RATE_LIMITED" ? "Temporarily rate limited" : "Source unavailable"}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 pt-1">
            When an external source is temporarily unavailable, results from all responding providers are deduplicated and merged automatically.
          </p>
        </div>
      )}

      {/* Search Results List */}
      <div className="space-y-4">
        {filteredPapers.map((paper) => {
          const isExpanded = Boolean(expandedAbstracts[paper.id]);
          const isImporting = importingPaperId === paper.id;
          const importSuccess = importSuccessMap[paper.id];
          const localStatus = paper.localStatus;
          const isInLibrary = Boolean(localStatus?.inLibrary) || Boolean(importSuccess);
          const hasPmcFullText = paper.fullTextAvailability === "FULL_TEXT_AVAILABLE" && paper.pmcid;

          return (
            <Card
              key={paper.id}
              className="p-5 border-slate-200 hover:border-slate-300 transition-all bg-white shadow-2xs"
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

                    {/* Full text availability */}
                    {hasPmcFullText && (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-semibold border-indigo-200 bg-indigo-50 text-indigo-700"
                      >
                        PMC Open Full Text Available
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
                        <span className="italic">{paper.journal}</span>
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
                    <div className="pt-2 text-xs text-slate-700 leading-relaxed">
                      <p className={cn("transition-all", !isExpanded && "line-clamp-2")}>
                        {paper.abstract}
                      </p>
                      {paper.abstract.length > 200 && (
                        <button
                          type="button"
                          onClick={() => toggleAbstract(paper.id)}
                          className="mt-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
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
                <div className="flex flex-col sm:items-end justify-between gap-3 shrink-0 md:min-w-[200px] border-t md:border-t-0 md:border-l border-slate-100 pt-3 md:pt-0 md:pl-4">
                  {/* Library Status or Import Controls */}
                  {isInLibrary ? (
                    <div className="flex flex-col items-start sm:items-end gap-2 w-full">
                      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-semibold flex items-center gap-1 px-3 py-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>In Library</span>
                      </Badge>

                      <div className="text-[11px] text-slate-500 sm:text-right">
                        {localStatus?.hasFullText || importSuccess?.fullTextStatus === "COMPLETED" ? (
                          <span className="text-emerald-700 font-medium">
                            Full Text Processed &amp; Ready for AI Research
                          </span>
                        ) : (
                          <span className="text-slate-600">
                            Saved to Library — Full text needed
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2 mt-1">
                        <Link
                          href={`/papers/${localStatus?.paperId || importSuccess?.paperId}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                        >
                          <BookOpen className="h-3.5 w-3.5" />
                          <span>Open Paper</span>
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-start sm:items-end gap-2 w-full">
                      {/* If PMC Open Full Text is lawfully accessible */}
                      {hasPmcFullText ? (
                        <>
                          <Button
                            size="sm"
                            disabled={isImporting}
                            onClick={() => handleImport(paper, true)}
                            className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center gap-1.5"
                          >
                            {isImporting ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Ingesting...</span>
                              </>
                            ) : (
                              <>
                                <Download className="h-3.5 w-3.5" />
                                <span>Get Full Text &amp; Save</span>
                              </>
                            )}
                          </Button>
                          <button
                            type="button"
                            disabled={isImporting}
                            onClick={() => handleImport(paper, false)}
                            className="text-[11px] text-slate-500 hover:text-slate-800 underline"
                          >
                            Save to Library (metadata only)
                          </button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            disabled={isImporting}
                            onClick={() => handleImport(paper, false)}
                            variant="outline"
                            className="w-full sm:w-auto border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-semibold text-xs flex items-center gap-1.5"
                          >
                            {isImporting ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                <span>Saving...</span>
                              </>
                            ) : (
                              <>
                                <FileText className="h-3.5 w-3.5" />
                                <span>Save to Library</span>
                              </>
                            )}
                          </Button>
                          <span className="text-[10px] text-slate-400 italic">
                            Full manuscript text needed for AI inquiry
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  {/* External Source Link */}
                  {paper.externalUrl && (
                    <a
                      href={paper.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-slate-500 hover:text-indigo-600 flex items-center gap-1 pt-2 border-t border-slate-100 w-full justify-start sm:justify-end"
                    >
                      <span>External Source</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            </Card>
          );
        })}

        {/* Empty state when search returned 0 results */}
        {searchResult && filteredPapers.length === 0 && !loading && (
          <Card className="p-12 text-center border-slate-200 bg-white">
            <BookOpen className="h-10 w-10 text-slate-400 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-slate-900">
              No matching scholarly results found
            </h3>
            <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
              No external manuscripts matched your search across the selected scholarly providers.
              Try broadening your search query or selecting additional providers.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
