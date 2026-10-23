"use client";

import * as React from "react";
import Link from "next/link";
import {
  Search,
  Sparkles,
  BookOpen,
  FileText,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Layers,
  Scale,
  ShieldAlert,
  Info,
  Clock,
  PlusCircle,
  Plus,
  X,
  MessageSquare,
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  synthesizeResearchAction,
  getResearchThreadsAction,
  getResearchThreadMessagesAction,
  getChunkPassageAction,
  getSelectedPapersDetailsAction,
  getUserLibraryPaperSummariesAction,
  SelectedPaperSummary,
} from "@/app/research/actions";
import { MultiPaperSynthesisResult, ValidatedMultiPaperClaim, HydratedMultiPaperAnchor } from "@/lib/synthesis/types";

interface SupportingExcerptCardProps {
  citation: HydratedMultiPaperAnchor;
  variant?: "indigo" | "amber" | "slate";
  conversationId?: string;
}

function SupportingExcerptCard({ citation, variant = "indigo", conversationId }: SupportingExcerptCardProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [fullText, setFullText] = React.useState<string | undefined>(citation.fullText);
  const [isLoadingFull, setIsLoadingFull] = React.useState(false);

  const snippet = citation.snippet || "";
  const effectiveFull = fullText || citation.fullText;
  const hasText = Boolean(snippet.trim() || (effectiveFull && effectiveFull.trim()));
  const hasMore = Boolean(
    hasText &&
    ((effectiveFull && effectiveFull.trim().length > snippet.trim().length) ||
    snippet.endsWith("...") ||
    snippet.length >= 200)
  );

  const handleToggle = async () => {
    if (!isExpanded && !effectiveFull && citation.chunkId && conversationId) {
      setIsLoadingFull(true);
      try {
        const res = await getChunkPassageAction({
          conversationId,
          chunkId: citation.chunkId,
        });
        if (res.success && res.text) {
          setFullText(res.text);
        }
      } catch (e) {
        console.error("Failed to load chunk passage:", e);
      } finally {
        setIsLoadingFull(false);
      }
    }
    setIsExpanded((prev) => !prev);
  };

  const textToDisplay = isExpanded && effectiveFull ? effectiveFull : snippet;
  const isAmber = variant === "amber";
  const isSlate = variant === "slate";

  return (
    <div
      className={`bg-white rounded-lg border ${
        isAmber ? "border-amber-200/80" : isSlate ? "border-slate-200/90" : "border-slate-200"
      } p-3 space-y-2 shadow-2xs`}
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-2 border-b ${
          isAmber ? "border-amber-100" : isSlate ? "border-slate-100" : "border-slate-100"
        } pb-2`}
      >
        <div className="flex items-center gap-2 max-w-full sm:max-w-[70%]">
          <BookOpen className={`h-3.5 w-3.5 shrink-0 ${
            isAmber ? "text-amber-700" : isSlate ? "text-slate-600" : "text-indigo-600"
          }`} />
          <span className="text-xs font-semibold text-slate-900 truncate">
            {citation.paperTitle}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {citation.doi && (
            <a
              href={`https://doi.org/${citation.doi}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-[10px] text-slate-400 ${
                isAmber
                  ? "hover:text-amber-700"
                  : isSlate
                  ? "hover:text-slate-700"
                  : "hover:text-indigo-600"
              } flex items-center gap-0.5`}
            >
              DOI <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
          <Link href={`/papers/${citation.paperId}`}>
            <Button size="sm" variant="outline" className="text-[10px] h-6 px-2">
              View Paper
            </Button>
          </Link>
          {citation.chunkId?.startsWith("meta-abstract-") ? (
            <Badge variant="outline" className="text-[10px] bg-amber-50 border-amber-300 text-amber-800 font-semibold">
              Metadata Abstract (No Full Text)
            </Badge>
          ) : (
            <a
              href={`/api/papers/${citation.paperId}/pdf${citation.pageNumber ? `#page=${citation.pageNumber}` : ""}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                size="sm"
                variant="secondary"
                className={`text-[10px] h-6 px-2 ${
                  isAmber
                    ? "bg-amber-50 text-amber-800 hover:bg-amber-100"
                    : isSlate
                    ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                }`}
              >
                {citation.pageNumber ? `PDF (p. ${citation.pageNumber})` : "Original PDF"}
              </Button>
            </a>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span className="font-medium text-slate-700">
          {citation.pageNumber ? `Page ${citation.pageNumber}` : "Page unrecorded"}
        </span>
        <span>•</span>
        <span className="italic">{citation.section ? `§${citation.section}` : "§Unspecified"}</span>
        <span>•</span>
        <span>
          Authors: {citation.authors.slice(0, 2).join(", ")}
          {citation.authors.length > 2 ? " et al." : ""}
        </span>
      </div>

      <div className="space-y-1.5">
        {hasText ? (
          <blockquote
            className={`text-xs text-slate-700 ${
              isAmber
                ? "bg-amber-50/50 border-amber-500"
                : isSlate
                ? "bg-slate-50 border-slate-400"
                : "bg-slate-50/80 border-indigo-400"
            } p-2.5 rounded border-l-2 italic leading-relaxed whitespace-pre-wrap break-words`}
          >
            &ldquo;{textToDisplay}&rdquo;
          </blockquote>
        ) : (
          <div className="text-xs text-slate-500 italic bg-slate-50 p-2.5 rounded border border-dashed border-slate-200 flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span>Exact manuscript excerpt passage is unavailable in the database record.</span>
          </div>
        )}

        {hasMore && (
          <div className="flex justify-end pt-0.5">
            <button
              type="button"
              onClick={handleToggle}
              disabled={isLoadingFull}
              className={`text-[11px] font-medium ${
                isAmber
                  ? "text-amber-700 hover:text-amber-800"
                  : isSlate
                  ? "text-slate-600 hover:text-slate-800"
                  : "text-indigo-600 hover:text-indigo-800"
              } flex items-center gap-1 hover:underline transition-colors focus:outline-hidden disabled:opacity-50`}
              aria-expanded={isExpanded}
            >
              {isLoadingFull ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading excerpt...
                </>
              ) : isExpanded ? (
                <>
                  Show less <ChevronUp className="h-3 w-3" />
                </>
              ) : (
                <>
                  Show full excerpt <ChevronDown className="h-3 w-3" />
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface ResearchInterfaceProps {
  initialThreadId?: string;
  initialPaperIds?: string[];
}

export function ResearchInterface({ initialThreadId, initialPaperIds }: ResearchInterfaceProps) {
  const [question, setQuestion] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [currentResult, setCurrentResult] = React.useState<MultiPaperSynthesisResult | null>(null);
  const [activeConversationId, setActiveConversationId] = React.useState<string | undefined>(
    initialThreadId
  );
  const [expandedClaimIndices, setExpandedClaimIndices] = React.useState<Set<number>>(new Set());
  const [expandedDisagreementIndices, setExpandedDisagreementIndices] = React.useState<Set<number>>(new Set());
  const [expandedLimitationIndices, setExpandedLimitationIndices] = React.useState<Set<number>>(new Set());
  const [threads, setThreads] = React.useState<Array<{ id: string; title: string; updatedAt: string }>>([]);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Phase 6 Multi-Paper Selection and Context State
  const [selectedPapers, setSelectedPapers] = React.useState<SelectedPaperSummary[]>([]);
  const [isLoadingPapers, setIsLoadingPapers] = React.useState(false);
  const [contextMode, setContextMode] = React.useState<"SELECTED_PAPERS" | "ALL_LIBRARY" | "LIBRARY_AND_SCHOLARLY">(
    "SELECTED_PAPERS"
  );
  const [isAddPapersModalOpen, setIsAddPapersModalOpen] = React.useState(false);
  const [availableLibraryPapers, setAvailableLibraryPapers] = React.useState<SelectedPaperSummary[]>([]);
  const [isLoadingLibraryPapers, setIsLoadingLibraryPapers] = React.useState(false);
  const [libraryModalSearch, setLibraryModalSearch] = React.useState("");
  const [conversationHistory, setConversationHistory] = React.useState<
    Array<{ id: string; role: string; content: string; citations?: any }>
  >([]);

  // Load threads on mount
  React.useEffect(() => {
    loadThreads();
  }, []);

  // Hydrate initial selected papers from query params if supplied
  React.useEffect(() => {
    if (initialPaperIds && initialPaperIds.length > 0) {
      loadInitialPapers(initialPaperIds);
    }
  }, [initialPaperIds]);

  const loadInitialPapers = async (paperIds: string[]) => {
    setIsLoadingPapers(true);
    try {
      const res = await getSelectedPapersDetailsAction(paperIds);
      if (res.success && res.papers) {
        setSelectedPapers(res.papers);
      }
    } catch (e) {
      console.error("Failed to load selected papers:", e);
    } finally {
      setIsLoadingPapers(false);
    }
  };

  const loadThreads = async () => {
    try {
      const res = await getResearchThreadsAction();
      setThreads(res.threads || []);
    } catch (e) {
      console.error("Failed to load research threads:", e);
    }
  };

  const handleSelectThread = async (threadId: string) => {
    setActiveConversationId(threadId);
    setErrorMessage(null);
    setExpandedClaimIndices(new Set([0]));
    setExpandedDisagreementIndices(new Set());
    setExpandedLimitationIndices(new Set());
    try {
      const res = await getResearchThreadMessagesAction(threadId);
      setConversationHistory(res.messages || []);
      // Find latest assistant message with citations
      const lastAsst = [...res.messages].reverse().find((m) => m.role === "ASSISTANT" && m.citations);
      if (lastAsst && lastAsst.citations) {
        const cit = lastAsst.citations;
        setCurrentResult({
          success: true,
          conversationId: threadId,
          question: res.title,
          claims: cit.claims || [],
          disagreements: cit.disagreements || [],
          limitations: cit.limitations || [],
          selectedPapers: cit.selectedPapers || [],
          supportingPapers: cit.supportingPapers || (cit.selectedPapers || []).filter((p: any) => p.isSupporting),
          candidatePapersCount: cit.candidatePapersCount ?? (cit.selectedPapers || []).length,
          totalEvidenceChunks: (cit.selectedPapers || []).reduce(
            (acc: number, p: any) => acc + (p.chunksContributed || 0),
            0
          ),
          insufficientEvidence: !!cit.insufficientEvidence,
          libraryScopeNote: cit.libraryScopeNote || "",
          rejectedCitationCount: 0,
          rejectedClaimsCount: 0,
        });

        // Restore persistent selected papers context from the thread if currently empty
        if (Array.isArray(cit.selectedPapers) && cit.selectedPapers.length > 0) {
          const ids = cit.selectedPapers.map((p: any) => p.paperId).filter(Boolean);
          if (ids.length > 0 && selectedPapers.length === 0) {
            loadInitialPapers(ids);
          }
        }
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to load thread.");
    }
  };

  const handleNewThread = () => {
    setActiveConversationId(undefined);
    setCurrentResult(null);
    setQuestion("");
    setErrorMessage(null);
    setExpandedClaimIndices(new Set());
    setExpandedDisagreementIndices(new Set());
    setExpandedLimitationIndices(new Set());
    setConversationHistory([]);
  };

  const handleRemovePaper = (paperId: string) => {
    setSelectedPapers((prev) => prev.filter((p) => p.id !== paperId));
  };

  const handleOpenAddPapersModal = async () => {
    setIsAddPapersModalOpen(true);
    if (availableLibraryPapers.length === 0) {
      setIsLoadingLibraryPapers(true);
      try {
        const res = await getUserLibraryPaperSummariesAction();
        if (res.success && res.papers) {
          setAvailableLibraryPapers(res.papers);
        }
      } catch (e) {
        console.error("Failed to load library papers:", e);
      } finally {
        setIsLoadingLibraryPapers(false);
      }
    }
  };

  const handleToggleModalPaper = (paper: SelectedPaperSummary) => {
    setSelectedPapers((prev) => {
      const exists = prev.some((p) => p.id === paper.id);
      if (exists) {
        return prev.filter((p) => p.id !== paper.id);
      } else {
        return [...prev, paper];
      }
    });
  };

  const handleSubmit = async (e?: React.FormEvent, presetQuestion?: string) => {
    if (e) e.preventDefault();
    const queryToSubmit = presetQuestion || question;
    if (!queryToSubmit.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await synthesizeResearchAction({
        question: queryToSubmit.trim(),
        conversationId: activeConversationId,
        isNewThread: !activeConversationId,
        selectedPaperIds: contextMode === "SELECTED_PAPERS" ? selectedPapers.map((p) => p.id) : undefined,
        contextMode,
      });

      if (!response.success || !response.data) {
        setErrorMessage(response.error || "Synthesis could not be generated.");
      } else {
        setCurrentResult(response.data);
        setActiveConversationId(response.data.conversationId);
        loadThreads();
        setQuestion("");
        setConversationHistory((prev) => [
          ...prev,
          {
            id: response.data!.userMessageId || `user-${Date.now()}`,
            role: "USER",
            content: queryToSubmit.trim(),
          },
          {
            id: response.data!.assistantMessageId || `asst-${Date.now()}`,
            role: "ASSISTANT",
            content: "Synthesized evidence across selected papers.",
            citations: {
              claims: response.data!.claims,
              disagreements: response.data!.disagreements,
              limitations: response.data!.limitations,
              selectedPapers: response.data!.selectedPapers,
              supportingPapers: response.data!.supportingPapers,
              candidatePapersCount: response.data!.candidatePapersCount,
              libraryScopeNote: response.data!.libraryScopeNote,
              insufficientEvidence: response.data!.insufficientEvidence,
              omittedSourcesNotice: response.data!.omittedSourcesNotice,
            },
          },
        ]);
        // Expand first claim by default
        setExpandedClaimIndices(new Set([0]));
        setExpandedDisagreementIndices(new Set());
        setExpandedLimitationIndices(new Set());
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleClaimExpansion = (index: number) => {
    setExpandedClaimIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleDisagreementExpansion = (index: number) => {
    setExpandedDisagreementIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleLimitationExpansion = (index: number) => {
    setExpandedLimitationIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const COMPARATIVE_QUESTIONS = [
    "Compare the main empirical findings across these studies.",
    "Which papers agree or disagree in their reported outcomes?",
    "Compare reported sample sizes, patient cohorts, and methodologies.",
    "Compare reported sensitivity, specificity, accuracy, or AUC metrics.",
    "What limitations or constraints were reported by the authors?",
  ];

  return (
    <div className="space-y-8">
      {/* Top Banner: Library Scope Disclosure */}
      <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 text-xs text-indigo-900 flex items-start gap-3 shadow-xs">
        <Info className="h-5 w-5 text-indigo-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-indigo-950">Library Scope Disclosure</p>
          <p className="text-indigo-800 leading-relaxed">
            This research synthesis is grounded strictly in peer-reviewed manuscripts currently ingested in your AI Research Hub library. Every empirical statement is traceable to cited manuscript chunks.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Main Research Workspace (3 cols) */}
        <div className="lg:col-span-3 space-y-6">
          {/* Phase 6: Selected Paper Context Panel */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-indigo-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Active Research Context ({selectedPapers.length} {selectedPapers.length === 1 ? "Paper" : "Papers"})
                </h3>
                {selectedPapers.length > 0 && (
                  <span className="text-[11px] text-slate-500 hidden sm:inline">
                    • Multi-Paper Grounded Chat
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleOpenAddPapersModal}
                  className="text-xs h-7 gap-1 border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-semibold"
                >
                  <Plus className="h-3 w-3" />
                  <span>Add Papers from Library</span>
                </Button>
                {selectedPapers.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedPapers([])}
                    className="text-[11px] h-7 px-2 text-slate-400 hover:text-slate-600"
                  >
                    Clear Context
                  </Button>
                )}
              </div>
            </div>

            {/* Selected Paper Chips */}
            {selectedPapers.length === 0 ? (
              <div className="p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center space-y-1">
                <p className="text-xs text-slate-600 font-medium">
                  No specific papers currently pinned to this chat.
                </p>
                <p className="text-[11px] text-slate-400">
                  Select papers from your library to compare methodologies, or ask across your library.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {selectedPapers.map((paper) => (
                  <div
                    key={paper.id}
                    className="bg-slate-50/80 border border-slate-200 rounded-xl p-3 flex flex-col justify-between space-y-2 hover:bg-slate-100/70 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-900 line-clamp-2" title={paper.title}>
                          {paper.title}
                        </p>
                        <p className="text-[10px] text-slate-500 truncate">
                          {paper.authors.slice(0, 2).join(", ")}
                          {paper.authors.length > 2 ? " et al." : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemovePaper(paper.id)}
                        className="text-slate-400 hover:text-rose-600 p-0.5 rounded-sm transition-colors shrink-0"
                        title="Remove paper from context"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 text-[10px]">
                      {paper.isMetadataOnly ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                          Metadata Only
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                          Full Text ({paper.chunkCount} chunks)
                        </span>
                      )}
                      <Link
                        href={`/papers/${paper.id}`}
                        target="_blank"
                        className="text-indigo-600 hover:text-indigo-800 font-medium hover:underline inline-flex items-center gap-0.5"
                      >
                        View <ExternalLink className="h-2.5 w-2.5" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Researcher-Controlled Context Selector */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-600 text-[11px] uppercase tracking-wider">
                  Context Scope:
                </span>
                <div className="inline-flex p-0.5 bg-slate-100 rounded-lg text-xs">
                  <button
                    type="button"
                    onClick={() => setContextMode("SELECTED_PAPERS")}
                    className={`px-2.5 py-1 rounded-md text-xs transition-all ${
                      contextMode === "SELECTED_PAPERS"
                        ? "bg-white text-indigo-700 shadow-2xs font-bold"
                        : "text-slate-600 hover:text-slate-900 font-medium"
                    }`}
                  >
                    Selected Papers Only ({selectedPapers.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setContextMode("ALL_LIBRARY")}
                    className={`px-2.5 py-1 rounded-md text-xs transition-all ${
                      contextMode === "ALL_LIBRARY"
                        ? "bg-white text-indigo-700 shadow-2xs font-bold"
                        : "text-slate-600 hover:text-slate-900 font-medium"
                    }`}
                  >
                    Include My Library
                  </button>
                  <button
                    type="button"
                    onClick={() => setContextMode("LIBRARY_AND_SCHOLARLY")}
                    className={`px-2.5 py-1 rounded-md text-xs transition-all ${
                      contextMode === "LIBRARY_AND_SCHOLARLY"
                        ? "bg-white text-indigo-700 shadow-2xs font-bold"
                        : "text-slate-600 hover:text-slate-900 font-medium"
                    }`}
                  >
                    Include Scholarly Search
                  </button>
                </div>
              </div>
              <span className="text-[10px] text-slate-400">
                Private documents remain isolated to your account.
              </span>
            </div>
          </div>

          {/* Question Input Card */}
          <Card className="bg-white border-slate-200 p-6 shadow-xs rounded-2xl space-y-4">
            <form onSubmit={(e) => handleSubmit(e)} className="space-y-3">
              <div className="relative">
                <Search className="absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={
                    selectedPapers.length > 0
                      ? `Ask a comparative question across ${selectedPapers.length} selected papers (e.g. 'Compare the methodologies and sample sizes...')...`
                      : "Ask a research question across your library (e.g., 'What does the available literature say about...')..."
                  }
                  rows={3}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50/50 pl-11 pr-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 transition-all"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      handleSubmit(e);
                    }
                  }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <span className="text-[11px] text-slate-500">
                  Press <kbd className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 font-mono text-[10px]">Ctrl+Enter</kbd> to synthesize
                </span>
                <div className="flex items-center gap-2">
                  {activeConversationId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleNewThread}
                      className="text-xs text-slate-600 hover:text-slate-900"
                    >
                      <PlusCircle className="h-3.5 w-3.5 mr-1" />
                      New Research Thread
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={isSubmitting || !question.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 shadow-xs text-xs px-5 py-2 font-semibold"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        <span>Synthesizing Evidence...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Synthesize Literature</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </form>

            {/* Quick Prompts / Scientific Comparison Starters */}
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                {selectedPapers.length > 0 ? "Comparative Research Starters:" : "Suggested Research Questions:"}
              </span>
              <div className="flex flex-wrap gap-2">
                {COMPARATIVE_QUESTIONS.map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setQuestion(q);
                      handleSubmit(undefined, q);
                    }}
                    className="text-left text-xs bg-slate-50 hover:bg-indigo-50/70 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 rounded-lg px-3 py-1.5 text-slate-700 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {/* Error Banner */}
          {errorMessage && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-950">Synthesis Notice</p>
                <p>{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Synthesis Results View */}
          {currentResult && (
            <div className="space-y-6">
              {/* Scope & Selected Papers Bar */}
              {(() => {
                const supportingPapers =
                  currentResult.supportingPapers ||
                  currentResult.selectedPapers.filter((p) => p.isSupporting);
                const candidateCount =
                  currentResult.candidatePapersCount ?? currentResult.selectedPapers.length;
                const supportingCount = supportingPapers.length;

                return (
                  <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">
                          {supportingCount === 0
                            ? `0 Supporting Papers (${candidateCount} candidate ${candidateCount === 1 ? "paper" : "papers"} reviewed)`
                            : supportingCount === 1
                            ? `Grounded in 1 supporting paper (${candidateCount} candidate ${candidateCount === 1 ? "paper" : "papers"} reviewed)`
                            : `Grounded in ${supportingCount} supporting papers (${candidateCount} candidate papers reviewed)`}
                        </span>
                        <Badge variant="outline" className="text-[10px] bg-slate-50 text-slate-600">
                          {currentResult.totalEvidenceChunks} chunks analyzed
                        </Badge>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Question: &ldquo;{currentResult.question}&rdquo;
                      </p>
                    </div>

                    {/* Badges for supporting papers (with un-cited candidate count disclosure) */}
                    <div className="flex flex-wrap items-center gap-1.5 max-w-lg">
                      {supportingPapers.map((p) => (
                        <Link key={p.paperId} href={`/papers/${p.paperId}`}>
                          <Badge
                            variant="secondary"
                            className="text-[10px] bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-300 max-w-[220px] truncate"
                            title={`Supporting Evidence: ${p.paperTitle}`}
                          >
                            <CheckCircle2 className="h-2.5 w-2.5 mr-1 shrink-0 text-emerald-600" />
                            <span className="truncate">{p.paperTitle}</span>
                          </Badge>
                        </Link>
                      ))}
                      {candidateCount > supportingCount && (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-slate-50 text-slate-500 border-slate-200"
                          title={`${candidateCount - supportingCount} candidate papers reviewed without direct supporting citations`}
                        >
                          +{candidateCount - supportingCount} un-cited context {candidateCount - supportingCount === 1 ? "source" : "sources"}
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Omitted / Inaccessible Sources Notice */}
              {currentResult.omittedSourcesNotice && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-3 rounded-xl flex items-center gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>{currentResult.omittedSourcesNotice}</span>
                </div>
              )}

              {/* Insufficient Evidence Fallback Card */}
              {currentResult.insufficientEvidence || currentResult.claims.length === 0 ? (
                <Card className="bg-white border-dashed border-2 border-slate-300 p-8 text-center space-y-3 rounded-2xl">
                  <div className="mx-auto h-10 w-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
                    <AlertCircle className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Insufficient Evidence in Current Library
                  </h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                    The available papers in your AI Research Hub library do not contain enough direct empirical evidence to answer this question with scientific certainty.
                  </p>
                </Card>
              ) : (
                /* Substantive Synthesis Claims */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                      <Layers className="h-4 w-4 text-indigo-600" />
                      Grounded Empirical Claims ({currentResult.claims.length})
                    </h2>
                    <span className="text-[11px] text-slate-500">
                      Expand a claim to view its supporting manuscript evidence
                    </span>
                  </div>

                  <div className="space-y-3">
                    {currentResult.claims.map((claim, idx) => {
                      const isExpanded = expandedClaimIndices.has(idx);
                      const paperCount = claim.supportingPaperCount;

                      return (
                        <Card
                          key={idx}
                          className="bg-white border-slate-200 overflow-hidden shadow-xs hover:border-indigo-300 transition-all group"
                        >
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? "Hide" : "View"} supporting evidence for claim: ${claim.text.slice(0, 80)}`}
                            onClick={() => toggleClaimExpansion(idx)}
                            className="w-full text-left p-4 cursor-pointer flex items-start justify-between gap-4 hover:bg-slate-50/70 transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30 focus:ring-inset"
                          >
                            <span className="space-y-2 flex-1 block">
                              <span className="text-sm text-slate-900 font-medium leading-relaxed block">
                                {claim.text}
                              </span>
                              <span className="flex flex-wrap items-center gap-2 block">
                                <Badge
                                  className={`text-[10px] font-semibold ${
                                    paperCount > 1
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : "bg-indigo-50 text-indigo-700 border-indigo-200"
                                  } border`}
                                >
                                  {paperCount > 1 ? (
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                  ) : (
                                    <FileText className="h-3 w-3 mr-1" />
                                  )}
                                  Supported by {paperCount} {paperCount === 1 ? "paper" : "papers"}
                                </Badge>
                                <span className="text-[11px] text-slate-400">
                                  {claim.citations.length} supporting {claim.citations.length === 1 ? "manuscript excerpt" : "manuscript excerpts"}
                                </span>
                              </span>
                            </span>
                            <span className="flex items-center gap-1.5 shrink-0 pt-0.5 text-xs font-semibold text-indigo-600 group-hover:text-indigo-800 transition-colors select-none">
                              <span>{isExpanded ? "Hide supporting evidence" : "View supporting evidence"}</span>
                              <span className="h-7 w-7 flex items-center justify-center text-indigo-600 rounded-md group-hover:bg-indigo-50 transition-colors">
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </span>
                            </span>
                          </button>

                          {/* Expanded Evidence Drawer */}
                          {isExpanded && (
                            <div className="bg-slate-50 border-t border-slate-200 p-4 space-y-3">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                Supporting Manuscript Excerpts:
                              </span>
                              <div className="grid grid-cols-1 gap-3">
                                {claim.citations.map((cit, cIdx) => (
                                  <SupportingExcerptCard
                                    key={cIdx}
                                    citation={cit}
                                    variant="indigo"
                                    conversationId={currentResult.conversationId || activeConversationId}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>

                  {/* Areas of Agreement (claims supported by 2+ papers) */}
                  {currentResult.claims.some((c) => c.supportingPaperCount >= 2) && (
                    <Card className="bg-emerald-50/40 border-emerald-200 p-5 rounded-xl space-y-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-950">
                          Cross-Study Corroboration
                        </h3>
                      </div>
                      <p className="text-xs text-emerald-900 leading-relaxed">
                        The following empirical findings were corroborated across two or more independent manuscripts in your library:
                      </p>
                      <ul className="list-disc pl-5 text-xs text-emerald-950 space-y-1">
                        {currentResult.claims
                          .filter((c) => c.supportingPaperCount >= 2)
                          .map((c, i) => (
                            <li key={i}>{c.text}</li>
                          ))}
                      </ul>
                    </Card>
                  )}

                  {/* Disagreements / Conflicting Findings */}
                  {currentResult.disagreements.length > 0 && (
                    <Card className="bg-amber-50/50 border-amber-200 p-5 rounded-xl space-y-3">
                      <div className="flex items-center gap-2">
                        <Scale className="h-4 w-4 text-amber-700" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-amber-950">
                          Differences / Divergent Findings ({currentResult.disagreements.length})
                        </h3>
                      </div>
                      <div className="space-y-3">
                        {currentResult.disagreements.map((d, dIdx) => {
                          const isExpanded = expandedDisagreementIndices.has(dIdx);

                          return (
                            <div key={dIdx} className="bg-white rounded-lg border border-amber-200 overflow-hidden shadow-2xs">
                              <div
                                onClick={() => toggleDisagreementExpansion(dIdx)}
                                className="p-3.5 flex items-start justify-between gap-4 cursor-pointer hover:bg-amber-50/40 transition-colors"
                              >
                                <div className="space-y-1.5 flex-1">
                                  <p className="text-xs text-slate-900 font-medium leading-relaxed">{d.description}</p>
                                  <div className="flex flex-wrap items-center gap-2 pt-1">
                                    <Badge variant="outline" className="text-[10px] bg-amber-50 border-amber-300 text-amber-900 font-semibold">
                                      Supported by {d.supportingPaperIds.length} conflicting papers
                                    </Badge>
                                    <span className="text-[10px] text-amber-700 font-medium hover:underline">
                                      {isExpanded ? "Hide Conflicting Evidence" : `Inspect Conflicting Evidence (${d.citations.length} excerpts)`}
                                    </span>
                                  </div>
                                </div>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-amber-700">
                                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </Button>
                              </div>

                              {/* Expanded Evidence Drawer for Disagreement */}
                              {isExpanded && (
                                <div className="bg-amber-50/30 border-t border-amber-200 p-4 space-y-3">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900">
                                    Conflicting Manuscript Excerpts:
                                  </span>
                                  <div className="grid grid-cols-1 gap-3">
                                    {d.citations.map((cit, cIdx) => (
                                      <SupportingExcerptCard
                                        key={cIdx}
                                        citation={cit}
                                        variant="amber"
                                        conversationId={currentResult.conversationId || activeConversationId}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  )}

                  {/* Explicit Limitations Section */}
                  {currentResult.limitations.length > 0 && (
                    <Card className="bg-slate-50/80 border-slate-200 p-5 rounded-xl space-y-3">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4 text-slate-600" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                          Reported Limitations in Available Evidence ({currentResult.limitations.length})
                        </h3>
                      </div>
                      <div className="space-y-3">
                        {currentResult.limitations.map((lim, lIdx) => {
                          const isExpanded = expandedLimitationIndices.has(lIdx);
                          const limText = typeof lim === "string" ? lim : lim.text;
                          const limType = typeof lim === "object" ? (lim as any).limitationType : undefined;
                          const limCitations = typeof lim === "object" && Array.isArray(lim.citations) ? lim.citations : [];
                          const limPaperIds = typeof lim === "object" && Array.isArray(lim.supportingPaperIds) ? lim.supportingPaperIds : [];
                          const hasCitations = limCitations.length > 0;
                          const paperCount =
                            limPaperIds.length ||
                            (hasCitations ? new Set(limCitations.map((c) => c.paperId)).size : 0);

                          return (
                            <div
                              key={lIdx}
                              className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-2xs transition-colors hover:border-slate-300 group"
                            >
                              <button
                                type="button"
                                disabled={!hasCitations}
                                onClick={() => hasCitations && toggleLimitationExpansion(lIdx)}
                                aria-expanded={hasCitations ? isExpanded : undefined}
                                aria-label={hasCitations ? `${isExpanded ? "Hide" : "Show"} supporting excerpt for limitation: ${limText.slice(0, 80)}` : undefined}
                                className={`w-full text-left p-3.5 flex items-start justify-between gap-4 ${
                                  hasCitations ? "cursor-pointer hover:bg-slate-50/60" : "cursor-default"
                                } transition-colors focus:outline-hidden focus:ring-2 focus:ring-slate-400/30 focus:ring-inset`}
                              >
                                <span className="space-y-1.5 flex-1 block">
                                  <span className="text-xs text-slate-900 font-medium leading-relaxed block">
                                    {limText}
                                  </span>

                                  <span className="flex flex-wrap items-center gap-2 pt-1 block">
                                    {limType && (
                                      <Badge
                                        variant="outline"
                                        className={`text-[10px] font-semibold ${
                                          limType === "AUTHOR_REPORTED"
                                            ? "bg-slate-100 border-slate-300 text-slate-800"
                                            : limType === "METHODOLOGICAL_INFERENCE"
                                            ? "bg-blue-50 border-blue-200 text-blue-800"
                                            : "bg-amber-50 border-amber-200 text-amber-800"
                                        }`}
                                      >
                                        {limType === "AUTHOR_REPORTED"
                                          ? "Author-Reported"
                                          : limType === "METHODOLOGICAL_INFERENCE"
                                          ? "Methodological Inference"
                                          : "Cross-Study Gap"}
                                      </Badge>
                                    )}

                                    {paperCount > 0 && (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] bg-slate-50 border-slate-300 text-slate-700 font-semibold"
                                      >
                                        Reported in {paperCount} {paperCount === 1 ? "paper" : "papers"}
                                      </Badge>
                                    )}

                                    {hasCitations ? (
                                      <span className="text-[10px] text-slate-600 font-medium group-hover:text-slate-900 flex items-center gap-1">
                                        {isExpanded ? (
                                          <>
                                            Show less <ChevronUp className="h-3 w-3" />
                                          </>
                                        ) : (
                                          <>
                                            {limCitations.length === 1
                                              ? "Show supporting excerpt"
                                              : `Show supporting excerpts (${limCitations.length})`}
                                            <ChevronDown className="h-3 w-3" />
                                          </>
                                        )}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-amber-700 italic flex items-center gap-1">
                                        <AlertCircle className="h-3 w-3" />
                                        Evidence excerpt unavailable
                                      </span>
                                    )}
                                  </span>
                                </span>

                                {hasCitations && (
                                  <span className="h-8 w-8 flex items-center justify-center text-slate-400 group-hover:text-slate-600 shrink-0">
                                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                  </span>
                                )}
                              </button>

                              {/* Expanded Evidence Drawer for Limitation */}
                              {isExpanded && hasCitations && (
                                <div className="bg-slate-50/70 border-t border-slate-200 p-4 space-y-3">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                      Supporting Manuscript {limCitations.length === 1 ? "Excerpt" : "Excerpts"}:
                                    </span>
                                    <span className="text-[10px] text-slate-400">
                                      Exact verbatim manuscript passage
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-1 gap-3">
                                    {limCitations.map((cit, cIdx) => (
                                      <SupportingExcerptCard
                                        key={cIdx}
                                        citation={cit}
                                        variant="slate"
                                        conversationId={currentResult.conversationId || activeConversationId}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Sidebar: Research Threads History (1 col) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Research Threads
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNewThread}
              className="text-[10px] h-6 px-1.5 text-indigo-600 hover:text-indigo-800"
            >
              + New
            </Button>
          </div>

          {threads.length === 0 ? (
            <Card className="bg-white border-dashed border border-slate-200 p-4 text-center rounded-xl">
              <MessageSquare className="h-5 w-5 text-slate-300 mx-auto mb-1" />
              <p className="text-[11px] text-slate-400">No past research threads</p>
            </Card>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
              {threads.map((t) => {
                const isActive = t.id === activeConversationId;
                return (
                  <button
                    key={t.id}
                    onClick={() => handleSelectThread(t.id)}
                    className={`w-full text-left p-3 rounded-xl border text-xs transition-all ${
                      isActive
                        ? "bg-indigo-50/80 border-indigo-300 text-indigo-950 font-medium shadow-xs"
                        : "bg-white border-slate-200 hover:border-slate-300 text-slate-700"
                    }`}
                  >
                    <p className="line-clamp-2 leading-snug">{t.title}</p>
                    <span className="text-[10px] text-slate-400 block mt-1">
                      {new Date(t.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add Papers from Library Modal */}
      {isAddPapersModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Select Papers from My Library
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddPapersModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by title or author..."
                value={libraryModalSearch}
                onChange={(e) => setLibraryModalSearch(e.target.value)}
                className="pl-9 text-xs h-9"
              />
            </div>

            <div className="max-h-[340px] overflow-y-auto space-y-2 pr-1">
              {isLoadingLibraryPapers ? (
                <div className="p-8 text-center text-xs text-slate-400 space-y-2">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-indigo-600" />
                  <p>Loading library papers...</p>
                </div>
              ) : availableLibraryPapers.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  No documents found in your library. Add documents via My Library first.
                </div>
              ) : (
                availableLibraryPapers
                  .filter((p) => {
                    if (!libraryModalSearch.trim()) return true;
                    const q = libraryModalSearch.toLowerCase();
                    return (
                      p.title.toLowerCase().includes(q) ||
                      p.authors.some((a) => a.toLowerCase().includes(q))
                    );
                  })
                  .map((p) => {
                    const isSelected = selectedPapers.some((sp) => sp.id === p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={() => handleToggleModalPaper(p)}
                        className={`p-3 rounded-xl border text-xs cursor-pointer flex items-start gap-3 transition-colors ${
                          isSelected
                            ? "bg-indigo-50/70 border-indigo-300"
                            : "bg-white border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // handled by parent onClick
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 pointer-events-none"
                        />
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="font-semibold text-slate-900 leading-snug line-clamp-2">
                            {p.title}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                            <span>{p.authors.slice(0, 2).join(", ")}</span>
                            {p.isMetadataOnly ? (
                              <span className="font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                                Metadata Only
                              </span>
                            ) : (
                              <span className="font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                                Full Text ({p.chunkCount} chunks)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-xs text-slate-500">
                {selectedPapers.length} {selectedPapers.length === 1 ? "paper" : "papers"} selected for context
              </span>
              <Button
                size="sm"
                onClick={() => setIsAddPapersModalOpen(false)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-4"
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
