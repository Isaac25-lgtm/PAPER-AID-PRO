"use client";

import * as React from "react";
import Link from "next/link";
import {
  MessageSquare,
  Sparkles,
  Send,
  Loader2,
  FileText,
  AlertCircle,
  ShieldCheck,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Plus,
  HelpCircle,
  LogIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { askPaperQuestionAction, getPaperConversationAction } from "@/app/papers/qa-actions";
import { ConversationMessageView, GroundedCitationAnchor } from "@/lib/rag/types";
import { cn } from "@/lib/utils";

interface PaperQAProps {
  paperId: string;
  paperTitle: string;
  chunkCount: number;
  isEmbedded: boolean;
  isAuthenticated: boolean;
  initialConversationId?: string;
}

const SUGGESTED_QUESTIONS = [
  "What were the main findings of this study?",
  "What methodology did the researchers use?",
  "What limitations did the authors report?",
  "What dataset or population was analyzed?",
];

export function PaperQA({
  paperId,
  paperTitle,
  chunkCount,
  isEmbedded,
  isAuthenticated,
  initialConversationId,
}: PaperQAProps) {
  const [messages, setMessages] = React.useState<ConversationMessageView[]>([]);
  const [conversationId, setConversationId] = React.useState<string | undefined>(initialConversationId);
  const [inputQuestion, setInputQuestion] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [expandedCitationId, setExpandedCitationId] = React.useState<string | null>(null);

  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Load conversation history on mount if authenticated
  React.useEffect(() => {
    if (isAuthenticated) {
      setIsLoadingHistory(true);
      getPaperConversationAction(paperId, initialConversationId)
        .then((res) => {
          if (res.success) {
            setMessages(res.messages || []);
            setConversationId(res.conversationId);
          }
        })
        .catch((err) => {
          console.error("Failed to load paper conversation:", err);
        })
        .finally(() => {
          setIsLoadingHistory(false);
        });
    }
  }, [paperId, isAuthenticated, initialConversationId]);

  // Scroll to bottom of message list on updates
  React.useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isLoading]);

  const handleSubmit = async (questionText: string, isNewThread: boolean = false) => {
    const trimmed = questionText.trim();
    if (!trimmed || isLoading) return;

    if (!isAuthenticated) {
      return;
    }

    setErrorMessage(null);
    setIsLoading(true);

    // Optimistically add user question
    const tempUserMsg: ConversationMessageView = {
      id: "temp-" + Date.now(),
      role: "USER",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUserMsg]);
    setInputQuestion("");

    try {
      const response = await askPaperQuestionAction({
        paperId,
        question: trimmed,
        conversationId: isNewThread ? undefined : conversationId,
        isNewThread,
      });

      if (!response.success) {
        setErrorMessage(response.error || response.answer || "Failed to process research question. Please try again.");
        return;
      }

      if (response.conversationId) {
        setConversationId(response.conversationId);
      }

      // Add assistant response with claim-level evidence
      const assistantMsg: ConversationMessageView = {
        id: response.assistantMessageId || "msg-" + Date.now(),
        role: "ASSISTANT",
        content: response.answer,
        claims: response.claims,
        citations: response.citations || [],
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error("[PaperQA] Error asking question:", err);
      setErrorMessage(err.message || "Failed to process question. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartNewThread = () => {
    setMessages([]);
    setConversationId(undefined);
    setErrorMessage(null);
  };

  // State 1: Manuscript text has not been processed / full text needed
  if (chunkCount === 0) {
    return (
      <Card id="ask-paper" className="p-6 sm:p-8 bg-slate-50 border-slate-200 text-center space-y-3 rounded-2xl">
        <div className="mx-auto h-10 w-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
          <FileText className="h-5 w-5" />
        </div>
        <h3 className="font-semibold text-slate-800 text-sm">Full Text Needed for Research Q&amp;A</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Full manuscript text is needed before asking questions. Attach or upload the original manuscript PDF to enable evidence-grounded research inquiry.
        </p>
      </Card>
    );
  }

  // State 2: Text exists but search indexing is still preparing
  if (!isEmbedded) {
    return (
      <Card id="ask-paper" className="p-6 sm:p-8 bg-slate-50 border-slate-200 text-center space-y-3 rounded-2xl">
        <div className="mx-auto h-10 w-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
          <AlertCircle className="h-5 w-5" />
        </div>
        <h3 className="font-semibold text-slate-800 text-sm">Preparing Research Search</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Manuscript text is extracted and the precision search index is being prepared. Research Q&amp;A will be ready momentarily.
        </p>
      </Card>
    );
  }

  return (
    <div id="ask-paper" className="rounded-2xl border-2 border-indigo-200/90 bg-white p-6 sm:p-8 shadow-xs space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-indigo-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs shrink-0">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                Ask This Paper
              </h2>
              <Badge variant="academic" className="text-[10px] bg-indigo-100 text-indigo-800 border-indigo-200">
                Single-Paper Evidence
              </Badge>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Answers are grounded strictly in manuscript excerpts with verified chunk citations.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isAuthenticated && messages.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleStartNewThread}
              className="text-xs gap-1.5 h-8 border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-300"
            >
              <Plus className="h-3.5 w-3.5" />
              New Thread
            </Button>
          )}

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Grounded in Source Evidence</span>
          </div>
        </div>
      </div>

      {/* Unauthenticated Visitor Gate */}
      {!isAuthenticated ? (
        <div className="rounded-xl border border-indigo-100 bg-gradient-to-b from-indigo-50/50 to-white p-6 sm:p-8 text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center shadow-xs">
            <Sparkles className="h-6 w-6 text-indigo-600" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="font-bold text-slate-900 text-base">
              Ask Evidence-Grounded Questions About This Study
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Sign in with your researcher account to query methodology, sample populations, benchmark results,
              and stated limitations with verifiable manuscript paragraph citations.
            </p>
          </div>
          <Button asChild className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs gap-2">
            <Link href={`/login?callbackUrl=/papers/${paperId}#ask-paper`}>
              <LogIn className="h-3.5 w-3.5" />
              Sign in to Ask This Paper
            </Link>
          </Button>
        </div>
      ) : (
        /* Authenticated Interactive Q&A */
        <div className="space-y-6">
          {/* Conversation History / Initial State */}
          {isLoadingHistory ? (
            <div className="flex items-center justify-center py-8 text-slate-400 gap-2 text-xs">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
              Loading research conversation...
            </div>
          ) : messages.length === 0 ? (
            /* Suggested Query Chips */
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <HelpCircle className="h-3.5 w-3.5 text-indigo-600" />
                <span>Suggested Research Questions</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTED_QUESTIONS.map((suggestion, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={isLoading}
                    onClick={() => handleSubmit(suggestion)}
                    className="text-left p-3 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-indigo-50/60 hover:border-indigo-300 text-xs text-slate-700 hover:text-indigo-900 transition-all font-medium flex items-center justify-between group cursor-pointer shadow-2xs"
                  >
                    <span>{suggestion}</span>
                    <Sparkles className="h-3 w-3 text-slate-400 group-hover:text-indigo-600 shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Messages Thread */
            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
              {messages.map((msg, index) => {
                const isUser = msg.role === "USER";
                const isInsufficient =
                  !isUser && msg.content.includes("does not clearly answer this question");

                return (
                  <div
                    key={msg.id || index}
                    className={cn(
                      "flex flex-col space-y-1.5",
                      isUser ? "items-end" : "items-start"
                    )}
                  >
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-1">
                      {isUser ? "You" : "Evidence Engine"}
                    </span>

                    <div
                      className={cn(
                        "rounded-2xl p-4 text-xs sm:text-sm leading-relaxed max-w-2xl shadow-xs",
                        isUser
                          ? "bg-indigo-600 text-white font-medium"
                          : isInsufficient
                          ? "bg-amber-50/80 border border-amber-200 text-amber-950 font-normal"
                          : "bg-slate-50 border border-slate-200 text-slate-800 font-normal"
                      )}
                    >
                      {/* Substantive Claims (Claim-Level Provenance) */}
                      {!isUser && msg.claims && msg.claims.length > 0 ? (
                        <div className="space-y-3">
                          {msg.claims.map((claim, clmIdx) => (
                            <div key={clmIdx} className="space-y-1.5">
                              <p className="whitespace-pre-line text-slate-800 leading-relaxed font-normal">
                                {claim.text}
                              </p>
                              {claim.citations && claim.citations.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 pt-0.5">
                                  {claim.citations.map((cite, cIdx) => {
                                    const pageText =
                                      cite.pageNumber !== null ? `p. ${cite.pageNumber}` : "Main Text";
                                    const sectionText = cite.section ? `§ ${cite.section}` : "Section";
                                    const isExpanded = expandedCitationId === `${clmIdx}-${cite.chunkId}`;

                                    return (
                                      <div key={cIdx} className="relative">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setExpandedCitationId(
                                              isExpanded ? null : `${clmIdx}-${cite.chunkId}`
                                            )
                                          }
                                          className={cn(
                                            "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium font-mono transition-all cursor-pointer border",
                                            isExpanded
                                              ? "bg-indigo-600 text-white border-indigo-700 shadow-xs"
                                              : "bg-white hover:bg-indigo-50 text-indigo-700 border-indigo-200"
                                          )}
                                        >
                                          <FileText className="h-2.5 w-2.5 text-indigo-500" />
                                          <span>
                                            {sectionText} · {pageText}
                                          </span>
                                          <ChevronDown
                                            className={cn(
                                              "h-2.5 w-2.5 transition-transform",
                                              isExpanded ? "rotate-180" : ""
                                            )}
                                          />
                                        </button>

                                        {/* Expanded Popover Preview */}
                                        {isExpanded && (
                                          <div className="mt-2 p-3.5 bg-white rounded-xl border border-indigo-200 shadow-lg text-left text-xs space-y-2 animate-in fade-in-50 zoom-in-95 z-20">
                                            <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                                              <span className="font-semibold text-slate-800 text-[11px]">
                                                {sectionText} — {pageText}
                                              </span>
                                              <span className="text-[10px] font-mono text-slate-400">
                                                Chunk #{cite.chunkIndex}
                                              </span>
                                            </div>

                                            <blockquote className="text-[11px] text-slate-700 italic bg-slate-50 p-2.5 rounded-lg border border-slate-100 leading-relaxed font-normal">
                                              &ldquo;{cite.snippet}&rdquo;
                                            </blockquote>

                                            <div className="flex items-center justify-between pt-1 text-[11px]">
                                              <span className="text-slate-400 truncate max-w-[200px]">
                                                {paperTitle}
                                              </span>
                                              <Link
                                                href={`/api/papers/${paperId}/pdf`}
                                                target="_blank"
                                                className="text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1"
                                              >
                                                View Original PDF
                                                <ExternalLink className="h-3 w-3" />
                                              </Link>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="whitespace-pre-line">{msg.content}</p>
                      )}

                      {/* Evidence Citations (Fallback when claims not broken down) */}
                      {!isUser && (!msg.claims || msg.claims.length === 0) && msg.citations && msg.citations.length > 0 && (
                        <div className="mt-3.5 pt-3 border-t border-slate-200/80 space-y-2">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-900">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Supporting Manuscript Evidence:</span>
                          </div>

                          <div className="flex flex-wrap gap-1.5">
                            {msg.citations.map((cite, cIdx) => {
                              const pageText =
                                cite.pageNumber !== null ? `Page ${cite.pageNumber}` : "Main Text";
                              const sectionText = cite.section ? `§ ${cite.section}` : "Section";
                              const isExpanded = expandedCitationId === cite.chunkId;

                              return (
                                <div key={cIdx} className="relative">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedCitationId(isExpanded ? null : cite.chunkId)
                                    }
                                    className={cn(
                                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium font-mono transition-all cursor-pointer shadow-2xs border",
                                      isExpanded
                                        ? "bg-indigo-600 text-white border-indigo-700 shadow-xs"
                                        : "bg-white hover:bg-indigo-50 text-indigo-700 border-indigo-200"
                                    )}
                                  >
                                    <FileText className="h-3 w-3 text-indigo-500" />
                                    <span>
                                      [{cIdx + 1}] {sectionText} · {pageText}
                                    </span>
                                    <ChevronDown
                                      className={cn(
                                        "h-2.5 w-2.5 transition-transform",
                                        isExpanded ? "rotate-180" : ""
                                      )}
                                    />
                                  </button>

                                  {/* Expanded Popover Preview */}
                                  {isExpanded && (
                                    <div className="mt-2 p-3.5 bg-white rounded-xl border border-indigo-200 shadow-lg text-left text-xs space-y-2 animate-in fade-in-50 zoom-in-95">
                                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                        <span className="font-semibold text-slate-800 text-[11px]">
                                          {sectionText} — {pageText}
                                        </span>
                                        <span className="text-[10px] font-mono text-slate-400">
                                          Chunk #{cite.chunkIndex}
                                        </span>
                                      </div>

                                      <blockquote className="text-[11px] text-slate-700 italic bg-slate-50 p-2.5 rounded-lg border border-slate-100 leading-relaxed font-normal">
                                        &ldquo;{cite.snippet}&rdquo;
                                      </blockquote>

                                      <div className="flex items-center justify-between pt-1 text-[11px]">
                                        <span className="text-slate-400 truncate max-w-[200px]">
                                          {paperTitle}
                                        </span>
                                        <Link
                                          href={`/api/papers/${paperId}/pdf`}
                                          target="_blank"
                                          className="text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1"
                                        >
                                          View Original PDF
                                          <ExternalLink className="h-3 w-3" />
                                        </Link>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {isLoading && (
                <div className="flex items-start gap-2 text-xs text-indigo-700 animate-pulse py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                  <span>Retrieving manuscript chunks &amp; validating scientific evidence...</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Input Box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit(inputQuestion);
            }}
            className="space-y-2 pt-2 border-t border-slate-100"
          >
            <div className="relative rounded-xl border border-slate-300 focus-within:border-indigo-600 focus-within:ring-2 focus-within:ring-indigo-600/10 transition-all bg-white shadow-2xs">
              <textarea
                value={inputQuestion}
                onChange={(e) => setInputQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(inputQuestion);
                  }
                }}
                disabled={isLoading}
                placeholder="Ask about this study's methodology, results, limitations, or dataset..."
                rows={2}
                maxLength={500}
                className="w-full resize-none border-0 bg-transparent p-3.5 pr-24 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden font-normal"
              />

              <div className="absolute right-2 bottom-2.5 flex items-center gap-2">
                <span className="text-[10px] font-mono text-slate-400">
                  {inputQuestion.length}/500
                </span>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isLoading || inputQuestion.trim().length < 3}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs h-8 px-3 gap-1.5 shadow-2xs"
                >
                  {isLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <span>Ask</span>
                      <Send className="h-3 w-3" />
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
              <span>Press <kbd className="font-mono bg-slate-100 px-1 py-0.5 rounded border border-slate-200">Enter</kbd> to submit · <kbd className="font-mono bg-slate-100 px-1 py-0.5 rounded border border-slate-200">Shift+Enter</kbd> for new line</span>
              <span>Single-paper source retrieval only</span>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
