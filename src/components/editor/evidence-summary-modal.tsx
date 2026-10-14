"use client";

import React, { useState } from "react";
import {
  X,
  Sparkles,
  BookOpen,
  Check,
  Loader2,
  AlertCircle,
  Quote,
} from "lucide-react";
import { summarizeEvidenceAction, insertCitationAction } from "@/app/editor/actions";

interface EvidenceSummaryModalProps {
  documentId: string;
  paperId: string;
  paperTitle: string;
  isOpen: boolean;
  onClose: () => void;
  onInsertContent: (text: string, citationData?: any) => void;
  onRefreshDocument: () => Promise<void>;
}

export function EvidenceSummaryModal({
  documentId,
  paperId,
  paperTitle,
  isOpen,
  onClose,
  onInsertContent,
  onRefreshDocument,
}: EvidenceSummaryModalProps) {
  const [promptFocus, setPromptFocus] = useState("Summarize core contribution and empirical results.");
  const [isLoading, setIsLoading] = useState(false);
  const [summaryResult, setSummaryResult] = useState<{
    synthesizedText: string;
    citationText: string;
    chunkId?: string;
    pageNumber?: number;
    section?: string;
    provider?: string;
    model?: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await summarizeEvidenceAction({
        documentId,
        paperId,
        userPrompt: promptFocus,
      });

      if (res.success) {
        setSummaryResult({
          synthesizedText: res.synthesizedText,
          citationText: res.citationText,
          chunkId: res.chunkId || undefined,
          pageNumber: res.pageNumber ?? undefined,
          section: res.section ?? undefined,
          provider: res.provider,
          model: res.model,
        });
      } else {
        setErrorMessage(res.error || "Failed to summarize paper evidence.");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Network error summarizing evidence.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleInsert = async () => {
    if (!summaryResult) return;

    // 1. Insert text into editor
    onInsertContent(summaryResult.synthesizedText + " ");

    // 2. Persist citation record
    try {
      await insertCitationAction(documentId, {
        paperId,
        chunkId: summaryResult.chunkId,
        citationText: summaryResult.citationText,
        pageNumber: summaryResult.pageNumber,
        section: summaryResult.section,
      });
      await onRefreshDocument();
    } catch (err) {
      console.warn("Auto-citation record note:", err);
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <h3 className="text-base font-semibold text-slate-900">
              Summarize Source Evidence
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">
              Selected Paper
            </span>
            <p className="text-sm font-semibold text-slate-900 line-clamp-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
              {paperTitle}
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700 block mb-1">
              Focus / Synthesis Prompt
            </label>
            <input
              type="text"
              value={promptFocus}
              onChange={(e) => setPromptFocus(e.target.value)}
              placeholder="e.g. Focus on self-attention layer complexity..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            />
          </div>

          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {summaryResult && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">
                  Grounded Evidence Passage
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {summaryResult.provider}/{summaryResult.model}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-indigo-50/40 border border-indigo-200 text-slate-900 text-xs font-serif leading-relaxed">
                {summaryResult.synthesizedText}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Quote className="w-3.5 h-3.5 text-indigo-600" />
                <span>Citation Anchor: <strong>{summaryResult.citationText}</strong></span>
                {summaryResult.section && (
                  <span className="text-slate-400">({summaryResult.section})</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            {!summaryResult ? (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isLoading}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Synthesizing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Generate Evidence</span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleInsert}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-all flex items-center gap-1.5 shadow-sm"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Insert into Manuscript</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
