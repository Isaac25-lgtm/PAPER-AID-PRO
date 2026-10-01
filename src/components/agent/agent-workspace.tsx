"use client";

import * as React from "react";
import Link from "next/link";
import {
  Search,
  Sparkles,
  Bot,
  Layers,
  FileText,
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Scale,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  Database,
  Globe,
  Filter,
  Check,
  RefreshCw,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  startResearchAgentRunAction,
  continueAgentRunAction,
  getAgentRunAction,
  getAgentThreadsAction,
} from "@/app/agent/actions";
import { AgentRunState, AgentState } from "@/lib/agent/types";
import { HydratedMultiPaperAnchor } from "@/lib/synthesis/types";

interface AgentWorkspaceProps {
  initialConversationId?: string;
}

const EXAMPLE_OBJECTIVES = [
  "Research the evidence currently available on AI-assisted breast ultrasound lesion classification. Compare the approaches used, reported diagnostic performance, validation strategies, major limitations, and identify evidence-supported research gaps.",
  "Evaluate multi-center external validation of deep learning CAD systems in breast cancer ultrasound diagnosis.",
  "Compare reported diagnostic performance (sensitivity, specificity, AUC) and reference standards across AI models for breast mass differentiation.",
];

export function AgentWorkspace({ initialConversationId }: AgentWorkspaceProps) {
  const [objective, setObjective] = React.useState("");
  const [allowExternalDiscovery, setAllowExternalDiscovery] = React.useState(true);
  const [isRunning, setIsRunning] = React.useState(false);
  const [currentRun, setCurrentRun] = React.useState<AgentRunState | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = React.useState<string[]>([]);
  const [threads, setThreads] = React.useState<Array<{ id: string; title: string; updatedAt: string; state?: string }>>([]);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [expandedTrace, setExpandedTrace] = React.useState(true);
  const [expandedPlan, setExpandedPlan] = React.useState(true);
  const [expandedStudyComparison, setExpandedStudyComparison] = React.useState(true);
  const [expandedCitationKeys, setExpandedCitationKeys] = React.useState<Set<string>>(new Set());

  // Load threads on mount
  React.useEffect(() => {
    loadThreads();
    if (initialConversationId) {
      loadRun(initialConversationId);
    }
  }, [initialConversationId]);

  const loadThreads = async () => {
    try {
      const res = await getAgentThreadsAction();
      setThreads(res.threads || []);
    } catch (e) {
      console.error("Failed to load agent threads:", e);
    }
  };

  const loadRun = async (conversationId: string) => {
    setIsRunning(true);
    setErrorMessage(null);
    try {
      const res = await getAgentRunAction(conversationId);
      if (res.success && res.data) {
        setCurrentRun(res.data);
        if (res.data.pendingImportCandidateIds) {
          setSelectedCandidateIds(res.data.pendingImportCandidateIds);
        }
      } else {
        setErrorMessage(res.error || "Failed to load run.");
      }
    } catch (e: any) {
      setErrorMessage(e?.message || "Failed to load run.");
    } finally {
      setIsRunning(false);
    }
  };

  const handleStartRun = async () => {
    if (!objective.trim() || isRunning) return;
    setIsRunning(true);
    setErrorMessage(null);
    try {
      const res = await startResearchAgentRunAction({
        objective: objective.trim(),
        options: {
          allowExternalDiscovery,
        },
      });

      if (res.success && res.data) {
        setCurrentRun(res.data);
        if (res.data.pendingImportCandidateIds) {
          setSelectedCandidateIds(res.data.pendingImportCandidateIds);
        }
        await loadThreads();
      } else {
        setErrorMessage(res.error || "Failed to start agent run.");
      }
    } catch (e: any) {
      setErrorMessage(e?.message || "An unexpected error occurred.");
    } finally {
      setIsRunning(false);
    }
  };

  const handleContinueRun = async (action: "APPROVE_IMPORT" | "SKIP_AND_CONTINUE") => {
    if (!currentRun || isRunning) return;
    setIsRunning(true);
    setErrorMessage(null);
    try {
      const res = await continueAgentRunAction({
        conversationId: currentRun.conversationId,
        action,
        approvedCandidateIds: action === "APPROVE_IMPORT" ? selectedCandidateIds : [],
        options: {
          allowExternalDiscovery,
        },
      });

      if (res.success && res.data) {
        setCurrentRun(res.data);
        await loadThreads();
      } else {
        setErrorMessage(res.error || "Failed to continue run.");
      }
    } catch (e: any) {
      setErrorMessage(e?.message || "An error occurred while continuing.");
    } finally {
      setIsRunning(false);
    }
  };

  const toggleCitation = (key: string) => {
    setExpandedCitationKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderStateBadge = (state: AgentState) => {
    switch (state) {
      case "PLANNING":
        return <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 animate-pulse">1. Planning</Badge>;
      case "LOCAL_DISCOVERY":
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">2. Local Discovery</Badge>;
      case "EVIDENCE_ASSESSMENT":
        return <Badge className="bg-amber-100 text-amber-800 border-amber-200">3. Evidence Assessment</Badge>;
      case "EXTERNAL_DISCOVERY":
        return <Badge className="bg-purple-100 text-purple-800 border-purple-200">4. External Discovery</Badge>;
      case "CANDIDATE_CLASSIFICATION":
        return <Badge className="bg-sky-100 text-sky-800 border-sky-200">5. Classifying Candidates</Badge>;
      case "WAITING_FOR_USER":
        return <Badge className="bg-orange-100 text-orange-800 border-orange-300 font-semibold animate-bounce">Awaiting Human Approval</Badge>;
      case "EVIDENCE_RETRIEVAL":
        return <Badge className="bg-teal-100 text-teal-800 border-teal-200">6. Evidence Retrieval</Badge>;
      case "STUDY_EXTRACTION":
        return <Badge className="bg-cyan-100 text-cyan-800 border-cyan-200">7. Study Extraction</Badge>;
      case "SYNTHESIS":
        return <Badge className="bg-violet-100 text-violet-800 border-violet-200 animate-pulse">8. Synthesizing Brief</Badge>;
      case "VALIDATION":
        return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">9. Validating Claims</Badge>;
      case "COMPLETED":
        return <Badge className="bg-emerald-600 text-white border-transparent">Completed</Badge>;
      case "FAILED":
        return <Badge className="bg-red-100 text-red-800 border-red-200">Run Failed</Badge>;
      default:
        return <Badge className="bg-slate-100 text-slate-800">{state}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  <Bot className="w-3.5 h-3.5 mr-1" />
                  Phase 10 Orchestration Layer
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                  Evidence-Grounded (Zero Speculation)
                </span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                Evidence-Grounded Research Agent
              </h1>
              <p className="mt-1 text-sm text-slate-600 max-w-3xl">
                Autonomous, bounded research orchestrator with local-first discovery,
                cross-study empirical comparison, multi-paper claim validation, and transparent trace telemetry.
              </p>
            </div>

            {currentRun && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCurrentRun(null);
                    setObjective("");
                  }}
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  New Research Run
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Left Sidebar: Threads History & Info */}
          <div className="lg:col-span-1 space-y-6">
            <Card className="p-4 bg-white border-slate-200">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 flex items-center justify-between">
                <span>Recent Research Runs</span>
                <Clock className="w-3.5 h-3.5" />
              </h3>

              {threads.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No past agent runs recorded.</p>
              ) : (
                <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                  {threads.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => loadRun(t.id)}
                      className={`w-full text-left p-2.5 rounded-lg text-xs transition border ${
                        currentRun?.conversationId === t.id
                          ? "bg-indigo-50/70 border-indigo-200 text-indigo-900 font-medium"
                          : "hover:bg-slate-50 border-transparent text-slate-700"
                      }`}
                    >
                      <div className="line-clamp-2 leading-relaxed">{t.title}</div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                        <span>{new Date(t.updatedAt).toLocaleDateString()}</span>
                        {t.state && (
                          <span className="font-mono uppercase text-[9px] px-1 py-0.2 rounded bg-slate-100 text-slate-600">
                            {t.state}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            {/* Core Integrity Guardrails Card */}
            <Card className="p-4 bg-white border-slate-200 text-xs text-slate-600 space-y-2">
              <h4 className="font-semibold text-slate-800 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Scientific Boundary Rules
              </h4>
              <ul className="space-y-1.5 list-disc pl-4 text-slate-500 leading-relaxed">
                <li><strong className="text-slate-700">Manuscript Evidence Only:</strong> Abstracts, search snippets, and agent reasoning are NEVER scientific evidence.</li>
                <li><strong className="text-slate-700">Local-First Priority:</strong> External discovery is invoked only when local evidence is insufficient.</li>
                <li><strong className="text-slate-700">Human Control:</strong> External paper acquisitions require human review.</li>
                <li><strong className="text-slate-700">Unique Corroboration:</strong> Corroboration requires $\ge 2$ unique papers.</li>
                <li><strong className="text-slate-700">Strict Gap Scoping:</strong> Absences are strictly scoped to the analyzed evidence set.</li>
              </ul>
            </Card>
          </div>

          {/* Main Area: Input / Active Run Workspace */}
          <div className="lg:col-span-3 space-y-6">
            {/* Input Card (if no active run or wanting to edit) */}
            {!currentRun && (
              <Card className="p-6 bg-white border-slate-200 shadow-sm space-y-4">
                <div>
                  <label htmlFor="agent-objective" className="block text-sm font-semibold text-slate-800 mb-1">
                    Research Objective
                  </label>
                  <textarea
                    id="agent-objective"
                    rows={4}
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    placeholder="e.g. Research the evidence on AI-assisted breast ultrasound diagnosis. Identify the major approaches, compare reported diagnostic performance, summarize methodological limitations, and highlight research gaps."
                    className="w-full text-sm rounded-lg border-slate-300 focus:border-indigo-500 focus:ring-indigo-500 p-3 shadow-inner text-slate-800 bg-white"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-600 select-none">
                    <input
                      type="checkbox"
                      checked={allowExternalDiscovery}
                      onChange={(e) => setAllowExternalDiscovery(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Allow Phase 9 external discovery (PubMed/Crossref) if local library is insufficient</span>
                  </label>

                  <Button
                    onClick={handleStartRun}
                    disabled={!objective.trim() || isRunning}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-5"
                  >
                    {isRunning ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Orchestrating Run...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Execute Research Agent
                      </>
                    )}
                  </Button>
                </div>

                {/* Example chips */}
                <div className="pt-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400 block mb-2">
                    Quick Sample Objectives
                  </span>
                  <div className="space-y-1.5">
                    {EXAMPLE_OBJECTIVES.map((ex, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setObjective(ex)}
                        className="text-left block w-full text-xs text-slate-600 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50/50 p-2 rounded border border-slate-200/60 transition"
                      >
                        "{ex}"
                      </button>
                    ))}
                  </div>
                </div>
              </Card>
            )}

            {errorMessage && (
              <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-2">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold">Execution Error:</strong> {errorMessage}
                </div>
              </div>
            )}

            {/* Active Run Display */}
            {currentRun && (
              <div className="space-y-6">
                {/* Status & Summary Header Bar */}
                <Card className="p-4 bg-white border-slate-200 flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500">Run ID:</span>
                      <span className="font-mono text-xs text-slate-700">{currentRun.runId}</span>
                      {renderStateBadge(currentRun.state)}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 line-clamp-1">
                      {currentRun.objective}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <div>Step: <strong className="text-slate-800">{currentRun.currentStep}</strong> / {currentRun.maxSteps}</div>
                    <div className="h-3 w-px bg-slate-200" />
                    <div>Evidence Papers: <strong className="text-slate-800">{currentRun.selectedPaperIds.length}</strong></div>
                  </div>
                </Card>

                {/* WAITING_FOR_USER HUMAN APPROVAL BANNER */}
                {currentRun.state === "WAITING_FOR_USER" && (
                  <Card className="p-5 bg-amber-50/60 border-amber-300 shadow-sm space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 text-amber-700">
                        <AlertCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-amber-900">
                          Human Approval Required for Scholarly Import
                        </h3>
                        <p className="text-xs text-amber-800 mt-0.5">
                          {currentRun.waitingForUserReason || "Candidate papers with open-access full text were discovered. Please approve which papers to import into the local research library."}
                        </p>
                      </div>
                    </div>

                    {currentRun.candidateExternalPapers.length > 0 && (
                      <div className="space-y-2 border-t border-amber-200/70 pt-3">
                        <div className="text-xs font-semibold text-amber-900 uppercase tracking-wider">
                          Discovered Candidates ({currentRun.candidateExternalPapers.length})
                        </div>
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                          {currentRun.candidateExternalPapers.map((c) => {
                            const isSelected = selectedCandidateIds.includes(c.id);
                            return (
                              <div
                                key={c.id}
                                className={`p-3 rounded-md border text-xs flex items-start gap-3 ${
                                  isSelected ? "bg-white border-amber-400" : "bg-white/60 border-amber-200"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  id={`cand-${c.id}`}
                                  checked={isSelected}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedCandidateIds((prev) => [...prev, c.id]);
                                    } else {
                                      setSelectedCandidateIds((prev) => prev.filter((id) => id !== c.id));
                                    }
                                  }}
                                  className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <div className="space-y-1 flex-1">
                                  <label htmlFor={`cand-${c.id}`} className="font-semibold text-slate-900 block cursor-pointer">
                                    {c.title}
                                  </label>
                                  <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                                    <span>
                                      {c.authors
                                        .map((a: any) => (typeof a === "string" ? a : a.name))
                                        .slice(0, 3)
                                        .join(", ")}
                                      {c.authors.length > 3 ? " et al." : ""}
                                    </span>
                                    <span>•</span>
                                    <span>{c.journal || "Journal N/A"} ({c.year || "Year N/A"})</span>
                                    {c.doi && <span>• DOI: {c.doi}</span>}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleContinueRun("SKIP_AND_CONTINUE")}
                        disabled={isRunning}
                        className="text-xs border-amber-300 text-amber-900 hover:bg-amber-100/60"
                      >
                        Skip & Continue With Local Evidence
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleContinueRun("APPROVE_IMPORT")}
                        disabled={isRunning || selectedCandidateIds.length === 0}
                        className="text-xs bg-amber-600 hover:bg-amber-700 text-white"
                      >
                        {isRunning ? "Acquiring..." : `Approve & Import Selected (${selectedCandidateIds.length})`}
                      </Button>
                    </div>
                  </Card>
                )}

                {/* Research Plan Drawer */}
                {currentRun.plan && (
                  <Card className="p-4 bg-white border-slate-200">
                    <button
                      onClick={() => setExpandedPlan(!expandedPlan)}
                      className="w-full flex items-center justify-between text-left font-semibold text-sm text-slate-800"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-indigo-600" />
                        <span>Structured Research Plan</span>
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {currentRun.plan.researchQuestions.length} Questions • {currentRun.plan.searchQueries.length} Queries
                        </Badge>
                      </div>
                      {expandedPlan ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </button>

                    {expandedPlan && (
                      <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        <div>
                          <span className="font-semibold text-slate-700 block mb-1.5 uppercase tracking-wider text-[10px]">
                            Research Subquestions
                          </span>
                          <ol className="list-decimal pl-4 space-y-1 text-slate-600">
                            {currentRun.plan.researchQuestions.map((q, idx) => (
                              <li key={idx} className="leading-relaxed">{q}</li>
                            ))}
                          </ol>
                        </div>

                        <div>
                          <span className="font-semibold text-slate-700 block mb-1.5 uppercase tracking-wider text-[10px]">
                            Targeted Search Queries
                          </span>
                          <ul className="list-disc pl-4 space-y-1 text-slate-600">
                            {currentRun.plan.searchQueries.map((sq, idx) => (
                              <li key={idx} className="font-mono text-[11px]">{sq}</li>
                            ))}
                          </ul>

                          {currentRun.plan.comparisonDimensions.length > 0 && (
                            <div className="mt-3">
                              <span className="font-semibold text-slate-700 block mb-1 uppercase tracking-wider text-[10px]">
                                Comparison Dimensions
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {currentRun.plan.comparisonDimensions.map((dim, idx) => (
                                  <span key={idx} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px]">
                                    {dim}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </Card>
                )}

                {/* Inspectable Research Trace */}
                <Card className="p-4 bg-white border-slate-200">
                  <button
                    onClick={() => setExpandedTrace(!expandedTrace)}
                    className="w-full flex items-center justify-between text-left font-semibold text-sm text-slate-800"
                  >
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-600" />
                      <span>Research Process Trace ({currentRun.trace.length} steps)</span>
                      <span className="text-xs text-slate-400 font-normal">Actions & Tool Telemetry</span>
                    </div>
                    {expandedTrace ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </button>

                  {expandedTrace && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-2 text-xs">
                      {currentRun.trace.map((step, idx) => (
                        <div key={idx} className="flex items-start gap-2.5 p-2 rounded hover:bg-slate-50 transition border border-transparent hover:border-slate-100">
                          <span className="font-mono text-slate-400 text-[11px] w-5 text-right flex-shrink-0">
                            {step.stepIndex}.
                          </span>
                          <div className="flex-1 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-800">{step.action}</span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                {new Date(step.timestamp).toLocaleTimeString()}
                              </span>
                              {step.durationMs && (
                                <span className="text-[10px] text-slate-400">({step.durationMs}ms)</span>
                              )}
                            </div>
                            <p className="text-slate-600">{step.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                {/* Cross-Study Comparison Matrix */}
                {currentRun.studyEvidence && currentRun.studyEvidence.length > 0 && (
                  <Card className="p-4 bg-white border-slate-200">
                    <button
                      onClick={() => setExpandedStudyComparison(!expandedStudyComparison)}
                      className="w-full flex items-center justify-between text-left font-semibold text-sm text-slate-800"
                    >
                      <div className="flex items-center gap-2">
                        <Scale className="w-4 h-4 text-indigo-600" />
                        <span>Cross-Study Empirical Comparison ({currentRun.studyEvidence.length} Studies)</span>
                      </div>
                      {expandedStudyComparison ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </button>

                    {expandedStudyComparison && (
                      <div className="mt-4 pt-2 overflow-x-auto border-t border-slate-100">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-500 font-semibold bg-slate-50/70">
                              <th className="p-2.5">Study / Authors</th>
                              <th className="p-2.5">Modality</th>
                              <th className="p-2.5">Sample Size</th>
                              <th className="p-2.5">AI Architecture</th>
                              <th className="p-2.5">Validation</th>
                              <th className="p-2.5">Sensitivity</th>
                              <th className="p-2.5">Specificity</th>
                              <th className="p-2.5">AUC</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-slate-700">
                            {currentRun.studyEvidence.map((study) => (
                              <tr key={study.paperId} className="hover:bg-slate-50/50">
                                <td className="p-2.5 font-medium text-slate-900 max-w-[200px]">
                                  <Link
                                    href={`/papers/${study.paperId}`}
                                    target="_blank"
                                    className="hover:text-indigo-600 hover:underline flex items-center gap-1"
                                  >
                                    <span className="line-clamp-2">{study.title}</span>
                                    <ExternalLink className="w-3 h-3 flex-shrink-0 text-slate-400" />
                                  </Link>
                                  <div className="text-[10px] text-slate-400 mt-0.5">
                                    {study.authors[0] || "Author N/A"}{study.authors.length > 1 ? " et al." : ""} ({study.year || "Year N/A"})
                                  </div>
                                </td>
                                <td className="p-2.5">
                                  {study.imagingModality ? (
                                    <span className="font-medium text-slate-800">{study.imagingModality}</span>
                                  ) : (
                                    <span className="text-slate-400 italic">Not reported in retrieved evidence</span>
                                  )}
                                </td>
                                <td className="p-2.5 font-mono text-[11px]">
                                  {study.sampleSize || <span className="text-slate-400 italic font-sans">Not reported in retrieved evidence</span>}
                                </td>
                                <td className="p-2.5">
                                  {study.aiMethod || <span className="text-slate-400 italic">Not reported in retrieved evidence</span>}
                                </td>
                                <td className="p-2.5">
                                  {study.validationMethod || <span className="text-slate-400 italic">Not reported in retrieved evidence</span>}
                                </td>
                                <td className="p-2.5 font-mono text-[11px] text-emerald-700">
                                  {study.sensitivity || <span className="text-slate-400 italic font-sans">Not reported in retrieved evidence</span>}
                                </td>
                                <td className="p-2.5 font-mono text-[11px] text-teal-700">
                                  {study.specificity || <span className="text-slate-400 italic font-sans">Not reported in retrieved evidence</span>}
                                </td>
                                <td className="p-2.5 font-mono text-[11px] font-semibold text-indigo-700">
                                  {study.auc || <span className="text-slate-400 italic font-sans font-normal">Not reported in retrieved evidence</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                )}

                {/* Structured Research Brief */}
                {currentRun.researchBrief && (
                  <div className="space-y-6">
                    {/* Executive Summary */}
                    <Card className="p-6 bg-white border-slate-200 shadow-sm space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                          <FileText className="w-5 h-5 text-indigo-600" />
                          Validated Scientific Research Brief
                        </h2>
                        <span className="text-xs text-slate-500">
                          {currentRun.researchBrief.evidenceReadyPapersCount} evidence papers • {currentRun.researchBrief.totalEvidenceChunksUsed} chunks anchored
                        </span>
                      </div>

                      <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed">
                        {currentRun.researchBrief.executiveSummary}
                      </div>

                      {/* Scope Disclosure */}
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-start gap-2">
                        <Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <strong className="font-semibold text-slate-700">Scope Disclosure: </strong>
                          {currentRun.researchBrief.scopeDisclosure}
                        </div>
                      </div>
                    </Card>

                    {/* Corroborated Findings */}
                    {currentRun.researchBrief.corroboratedFindings.length > 0 && (
                      <Card className="p-6 bg-white border-slate-200 shadow-sm space-y-4">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          Corroborated Findings Across Studies
                        </h3>
                        <div className="space-y-3">
                          {currentRun.researchBrief.corroboratedFindings.map((corr, idx) => {
                            const citationKey = `corr-${idx}`;
                            const isExpanded = expandedCitationKeys.has(citationKey);
                            return (
                              <div key={idx} className="p-4 rounded-lg bg-emerald-50/40 border border-emerald-200/80 space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="text-sm font-semibold text-slate-900 leading-snug">
                                    {corr.claim}
                                  </div>
                                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px] flex-shrink-0">
                                    Supported by {corr.supportingPaperCount} unique papers
                                  </Badge>
                                </div>
                                <p className="text-xs text-slate-600 italic">
                                  {corr.synthesisNote}
                                </p>

                                <div className="pt-2 border-t border-emerald-100/80 flex items-center justify-between text-xs">
                                  <span className="text-[11px] text-slate-500 font-mono">
                                    {corr.citations.length} Verified Anchors
                                  </span>
                                  <button
                                    onClick={() => toggleCitation(citationKey)}
                                    className="text-xs font-medium text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
                                  >
                                    {isExpanded ? "Hide Anchors" : "Inspect Ground-Truth Anchors"}
                                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                  </button>
                                </div>

                                {isExpanded && renderAnchorsList(corr.citations)}
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    )}

                    {/* Key Empirical Findings */}
                    <Card className="p-6 bg-white border-slate-200 shadow-sm space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-indigo-600" />
                        Key Empirical Findings ({currentRun.researchBrief.keyFindings.length})
                      </h3>
                      <div className="space-y-3">
                        {currentRun.researchBrief.keyFindings.map((finding, idx) => {
                          const citationKey = `finding-${idx}`;
                          const isExpanded = expandedCitationKeys.has(citationKey);
                          return (
                            <div key={idx} className="p-4 rounded-lg bg-slate-50/70 border border-slate-200 space-y-2">
                              <div className="flex items-start justify-between gap-3">
                                <div className="text-sm font-medium text-slate-900 leading-snug">
                                  {finding.text}
                                </div>
                                <Badge variant="outline" className="text-[10px] font-semibold text-slate-600">
                                  {finding.category}
                                </Badge>
                              </div>

                              <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs">
                                <span className="text-[11px] text-slate-500 font-mono">
                                  {finding.citations.length} Grounded Anchor{finding.citations.length === 1 ? "" : "s"}
                                </span>
                                <button
                                  onClick={() => toggleCitation(citationKey)}
                                  className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                                >
                                  {isExpanded ? "Hide Excerpts" : "View Manuscript Excerpts"}
                                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                </button>
                              </div>

                              {isExpanded && renderAnchorsList(finding.citations)}
                            </div>
                          );
                        })}
                      </div>
                    </Card>

                    {/* Disagreements & Methodological Heterogeneity */}
                    {currentRun.researchBrief.disagreementsAndHeterogeneity.length > 0 && (
                      <Card className="p-6 bg-white border-slate-200 shadow-sm space-y-4">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                          <Scale className="w-4 h-4 text-amber-600" />
                          Disagreements & Methodological Heterogeneity
                        </h3>
                        <div className="space-y-3">
                          {currentRun.researchBrief.disagreementsAndHeterogeneity.map((dis, idx) => {
                            const citationKey = `dis-${idx}`;
                            const isExpanded = expandedCitationKeys.has(citationKey);
                            return (
                              <div key={idx} className="p-4 rounded-lg bg-amber-50/40 border border-amber-200 space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="text-sm font-semibold text-amber-950">
                                    {dis.topic}
                                  </div>
                                  <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px]">
                                    {dis.type.replace(/_/g, " ")}
                                  </Badge>
                                </div>
                                <p className="text-xs text-slate-700 leading-relaxed">
                                  {dis.description}
                                </p>

                                <div className="pt-2 border-t border-amber-200/60 flex items-center justify-between text-xs">
                                  <span className="text-[11px] text-slate-500 font-mono">
                                    {dis.citations.length} Participating Anchors
                                  </span>
                                  <button
                                    onClick={() => toggleCitation(citationKey)}
                                    className="text-xs font-medium text-amber-800 hover:text-amber-900 flex items-center gap-1"
                                  >
                                    {isExpanded ? "Hide Anchors" : "Inspect Anchors"}
                                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                  </button>
                                </div>

                                {isExpanded && renderAnchorsList(dis.citations)}
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    )}

                    {/* Evidence-Supported Limitations */}
                    {currentRun.researchBrief.evidenceSupportedLimitations.length > 0 && (
                      <Card className="p-6 bg-white border-slate-200 shadow-sm space-y-4">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                          <ShieldAlert className="w-4 h-4 text-orange-600" />
                          Evidence-Supported Limitations
                        </h3>
                        <div className="space-y-3">
                          {currentRun.researchBrief.evidenceSupportedLimitations.map((lim, idx) => {
                            const citationKey = `lim-${idx}`;
                            const isExpanded = expandedCitationKeys.has(citationKey);
                            return (
                              <div key={idx} className="p-4 rounded-lg bg-orange-50/40 border border-orange-200 space-y-2">
                                <div className="text-sm font-medium text-slate-900">
                                  {lim.text}
                                </div>
                                <div className="pt-2 border-t border-orange-200/60 flex items-center justify-between text-xs">
                                  <span className="text-[11px] text-slate-500 font-mono">
                                    {lim.citations.length} Anchor{lim.citations.length === 1 ? "" : "s"}
                                  </span>
                                  <button
                                    onClick={() => toggleCitation(citationKey)}
                                    className="text-xs font-medium text-orange-800 hover:text-orange-950 flex items-center gap-1"
                                  >
                                    {isExpanded ? "Hide" : "Inspect Verification"}
                                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                                {isExpanded && renderAnchorsList(lim.citations)}
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    )}

                    {/* Scoped Research Gaps */}
                    {currentRun.researchBrief.researchGaps.length > 0 && (
                      <Card className="p-6 bg-white border-slate-200 shadow-sm space-y-4">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-indigo-600" />
                          Evidence-Supported Research Gaps
                        </h3>
                        <div className="space-y-3">
                          {currentRun.researchBrief.researchGaps.map((gap, idx) => {
                            const citationKey = `gap-${idx}`;
                            const isExpanded = expandedCitationKeys.has(citationKey);
                            return (
                              <div key={idx} className="p-4 rounded-lg bg-indigo-50/40 border border-indigo-200 space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="text-sm font-medium text-slate-900 leading-snug">
                                    {gap.description}
                                  </div>
                                  <Badge variant="outline" className="text-[10px] border-indigo-300 text-indigo-800 font-semibold flex-shrink-0">
                                    {gap.type === "EXPLICITLY_STATED_BY_AUTHORS" ? "Author-Reported Limitation" : "Scoped Evidence Set Observation"}
                                  </Badge>
                                </div>
                                <div className="pt-2 border-t border-indigo-200/60 flex items-center justify-between text-xs">
                                  <span className="text-[11px] text-slate-500 font-mono">
                                    {gap.citations.length} Anchor{gap.citations.length === 1 ? "" : "s"}
                                  </span>
                                  <button
                                    onClick={() => toggleCitation(citationKey)}
                                    className="text-xs font-medium text-indigo-700 hover:text-indigo-900 flex items-center gap-1"
                                  >
                                    {isExpanded ? "Hide" : "Inspect Evidence"}
                                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                                {isExpanded && renderAnchorsList(gap.citations)}
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    )}

                    {/* Unanswered Questions */}
                    {currentRun.researchBrief.unansweredQuestions.length > 0 && (
                      <Card className="p-4 bg-slate-50 border-slate-200 text-xs text-slate-600 space-y-2">
                        <h4 className="font-semibold text-slate-800">
                          Unanswered Research Questions (Withheld due to absence of manuscript evidence):
                        </h4>
                        <ul className="list-disc pl-4 space-y-1 text-slate-500">
                          {currentRun.researchBrief.unansweredQuestions.map((uq, idx) => (
                            <li key={idx}>{uq}</li>
                          ))}
                        </ul>
                      </Card>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  function renderAnchorsList(anchors: HydratedMultiPaperAnchor[]) {
    return (
      <div className="mt-3 pt-3 border-t border-slate-200/60 space-y-2.5">
        {anchors.map((a, i) => (
          <div key={i} className="p-3 bg-white rounded border border-slate-200/80 shadow-2xs space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-800 line-clamp-1">{a.paperTitle}</span>
              <Link
                href={`/api/papers/${a.paperId}/pdf`}
                target="_blank"
                className="text-[11px] text-indigo-600 hover:underline flex items-center gap-1 flex-shrink-0 font-medium"
              >
                <span>View PDF (P.{a.pageNumber ?? "?"})</span>
                <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
            <div className="text-[10px] text-slate-400 font-mono">
              Chunk #{a.chunkIndex} • Section: {a.section || "General"} • {a.authors[0] || "Author N/A"} ({a.publicationDate ? new Date(a.publicationDate).getFullYear() : "N/A"})
            </div>
            <blockquote className="p-2 bg-slate-50 rounded border-l-2 border-indigo-400 text-slate-700 italic text-[11px] leading-relaxed">
              "{a.snippet}"
            </blockquote>
          </div>
        ))}
      </div>
    );
  }
}
