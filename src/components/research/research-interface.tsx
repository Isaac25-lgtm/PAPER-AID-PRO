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
  MessageSquare,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  synthesizeResearchAction,
  getResearchThreadsAction,
  getResearchThreadMessagesAction,
  getChunkPassageAction,
} from "@/app/research/actions";
import { MultiPaperSynthesisResult, ValidatedMultiPaperClaim, HydratedMultiPaperAnchor } from "@/lib/synthesis/types";

interface SupportingExcerptCardProps {
  citation: HydratedMultiPaperAnchor;
  variant?: "indigo" | "amber";
  conversationId?: string;
}

function SupportingExcerptCard({ citation, variant = "indigo", conversationId }: SupportingExcerptCardProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [fullText, setFullText] = React.useState<string | undefined>(citation.fullText);
  const [isLoadingFull, setIsLoadingFull] = React.useState(false);

  const snippet = citation.snippet || "";
  const effectiveFull = fullText || citation.fullText;
  const hasMore = Boolean(
    (effectiveFull && effectiveFull.trim().length > snippet.trim().length) ||
    snippet.endsWith("...") ||
    snippet.length >= 200
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

  return (
    <div
      className={`bg-white rounded-lg border ${
        isAmber ? "border-amber-200/80" : "border-slate-200"
      } p-3 space-y-2 shadow-2xs`}
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-2 border-b ${
          isAmber ? "border-amber-100" : "border-slate-100"
        } pb-2`}
      >
        <div className="flex items-center gap-2 max-w-full sm:max-w-[70%]">
          <BookOpen className={`h-3.5 w-3.5 shrink-0 ${isAmber ? "text-amber-700" : "text-indigo-600"}`} />
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
                isAmber ? "hover:text-amber-700" : "hover:text-indigo-600"
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
          <a
            href={`/api/papers/${citation.paperId}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              size="sm"
              variant="secondary"
              className={`text-[10px] h-6 px-2 ${
                isAmber
                  ? "bg-amber-50 text-amber-800 hover:bg-amber-100"
                  : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              }`}
            >
              Original PDF
            </Button>
          </a>
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
        <blockquote
          className={`text-xs text-slate-700 ${
            isAmber
              ? "bg-amber-50/50 border-amber-500"
              : "bg-slate-50/80 border-indigo-400"
          } p-2.5 rounded border-l-2 italic leading-relaxed whitespace-pre-wrap break-words`}
        >
          &ldquo;{textToDisplay}&rdquo;
        </blockquote>

        {hasMore && (
          <div className="flex justify-end pt-0.5">
            <button
              type="button"
              onClick={handleToggle}
              disabled={isLoadingFull}
              className={`text-[11px] font-medium ${
                isAmber
                  ? "text-amber-700 hover:text-amber-800"
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
}

export function ResearchInterface({ initialThreadId }: ResearchInterfaceProps) {
  const [question, setQuestion] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [currentResult, setCurrentResult] = React.useState<MultiPaperSynthesisResult | null>(null);
  const [activeConversationId, setActiveConversationId] = React.useState<string | undefined>(
    initialThreadId
  );
  const [expandedClaimIndices, setExpandedClaimIndices] = React.useState<Set<number>>(new Set());
  const [expandedDisagreementIndices, setExpandedDisagreementIndices] = React.useState<Set<number>>(new Set());
  const [threads, setThreads] = React.useState<Array<{ id: string; title: string; updatedAt: string }>>([]);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Load threads on mount
  React.useEffect(() => {
    loadThreads();
  }, []);

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
    try {
      const res = await getResearchThreadMessagesAction(threadId);
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
          totalEvidenceChunks: (cit.selectedPapers || []).reduce(
            (acc: number, p: any) => acc + (p.chunksContributed || 0),
            0
          ),
          insufficientEvidence: !!cit.insufficientEvidence,
          libraryScopeNote: cit.libraryScopeNote || "",
          rejectedCitationCount: 0,
          rejectedClaimsCount: 0,
        });
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
      });

      if (!response.success || !response.data) {
        setErrorMessage(response.error || "Synthesis could not be generated.");
      } else {
        setCurrentResult(response.data);
        setActiveConversationId(response.data.conversationId);
        loadThreads();
        // Expand first claim by default
        setExpandedClaimIndices(new Set([0]));
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

  const STARTER_QUESTIONS = [
    "What does the available literature say about AI-assisted breast ultrasound classification?",
    "What methodology and datasets were used in ultrasound diagnostic studies?",
    "What limitations or constraints were reported across the studies?",
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
          {/* Question Input Card */}
          <Card className="bg-white border-slate-200 p-6 shadow-xs rounded-2xl space-y-4">
            <form onSubmit={(e) => handleSubmit(e)} className="space-y-3">
              <div className="relative">
                <Search className="absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask a research question across your library (e.g., 'What does the available literature say about...')"
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
                    className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 shadow-xs text-xs px-5 py-2"
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

            {/* Quick Prompts */}
            {!currentResult && (
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Suggested Research Questions:
                </span>
                <div className="flex flex-wrap gap-2">
                  {STARTER_QUESTIONS.map((q, idx) => (
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
            )}
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
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      {currentResult.selectedPapers.length === 0
                        ? "0 Relevant Papers Found"
                        : currentResult.selectedPapers.length === 1
                        ? "Based on 1 relevant paper in the current library"
                        : `Synthesized across ${currentResult.selectedPapers.length} relevant papers in library`}
                    </span>
                    <Badge variant="outline" className="text-[10px] bg-slate-50 text-slate-600">
                      {currentResult.totalEvidenceChunks} chunks analyzed
                    </Badge>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Question: &ldquo;{currentResult.question}&rdquo;
                  </p>
                </div>

                {/* Badges for selected papers */}
                <div className="flex flex-wrap gap-1.5 max-w-lg">
                  {currentResult.selectedPapers.map((p) => (
                    <Link key={p.paperId} href={`/papers/${p.paperId}`}>
                      <Badge
                        variant="secondary"
                        className="text-[10px] bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 max-w-[220px] truncate"
                        title={p.paperTitle}
                      >
                        <FileText className="h-2.5 w-2.5 mr-1 shrink-0" />
                        <span className="truncate">{p.paperTitle}</span>
                      </Badge>
                    </Link>
                  ))}
                </div>
              </div>

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
                      Click claim to inspect supporting evidence
                    </span>
                  </div>

                  <div className="space-y-3">
                    {currentResult.claims.map((claim, idx) => {
                      const isExpanded = expandedClaimIndices.has(idx);
                      const paperCount = claim.supportingPaperCount;

                      return (
                        <Card
                          key={idx}
                          className="bg-white border-slate-200 overflow-hidden shadow-xs hover:border-indigo-200 transition-all"
                        >
                          <div
                            onClick={() => toggleClaimExpansion(idx)}
                            className="p-4 cursor-pointer flex items-start justify-between gap-4 hover:bg-slate-50/50 transition-colors"
                          >
                            <div className="space-y-2 flex-1">
                              <p className="text-sm text-slate-900 font-medium leading-relaxed">
                                {claim.text}
                              </p>
                              <div className="flex items-center gap-2">
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
                              </div>
                            </div>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400">
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                          </div>

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
                    <Card className="bg-slate-50 border-slate-200 p-5 rounded-xl space-y-3">
                      <div className="flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4 text-slate-600" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                          Reported Limitations in Available Evidence ({currentResult.limitations.length})
                        </h3>
                      </div>
                      <div className="space-y-2">
                        {currentResult.limitations.map((lim, lIdx) => (
                          <div key={lIdx} className="bg-white rounded-lg p-3 border border-slate-200 text-xs text-slate-700 space-y-1">
                            <p>{lim.text}</p>
                            <div className="flex flex-wrap gap-1 text-[10px] text-slate-400">
                              <span>Source:</span>
                              {lim.citations.map((c, ci) => (
                                <span key={ci} className="italic text-slate-600">
                                  {c.paperTitle.slice(0, 35)}... (§{c.section})
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
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
    </div>
  );
}
