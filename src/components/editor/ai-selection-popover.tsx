"use client";

import React, { useState } from "react";
import {
  Sparkles,
  RefreshCw,
  Scissors,
  Maximize2,
  Check,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { RewriteMode } from "@/lib/editor/ai-editor-service";
import { rewriteTextAction } from "@/app/editor/actions";

interface AiSelectionPopoverProps {
  documentId: string;
  selectedText: string;
  surroundingContext?: string;
  onApplyReplacement: (newText: string) => void;
  onClose: () => void;
}

export function AiSelectionPopover({
  documentId,
  selectedText,
  surroundingContext,
  onApplyReplacement,
  onClose,
}: AiSelectionPopoverProps) {
  const [activeMode, setActiveMode] = useState<RewriteMode | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [modelMeta, setModelMeta] = useState<{ provider: string; model: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleRewrite = async (mode: RewriteMode) => {
    setActiveMode(mode);
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await rewriteTextAction({
        documentId,
        selectedText,
        mode,
        surroundingContext,
      });

      if (res.success) {
        setSuggestion(res.replacementText);
        setModelMeta({ provider: res.provider, model: res.model });
      } else {
        setErrorMessage(res.error || "Failed to generate AI rewrite.");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Network error generating suggestion.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-3 max-w-lg w-full transition-all text-xs">
      {/* Top Header / Mode Selection */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
        <div className="flex items-center gap-1.5 font-semibold text-slate-800">
          <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
          <span>AI Academic Assistant</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Modes Grid */}
      {!suggestion && (
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          <button
            type="button"
            onClick={() => handleRewrite("academic_tone")}
            disabled={isLoading}
            className="flex items-center gap-2 p-2 rounded-lg bg-indigo-50/70 hover:bg-indigo-100 text-indigo-800 font-medium border border-indigo-200/60 transition-colors disabled:opacity-50 text-left"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />
            <span>Academic Tone</span>
          </button>

          <button
            type="button"
            onClick={() => handleRewrite("rewrite")}
            disabled={isLoading}
            className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-800 font-medium border border-slate-200 transition-colors disabled:opacity-50 text-left"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
            <span>Paraphrase</span>
          </button>

          <button
            type="button"
            onClick={() => handleRewrite("concise")}
            disabled={isLoading}
            className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-800 font-medium border border-slate-200 transition-colors disabled:opacity-50 text-left"
          >
            <Scissors className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
            <span>Make Concise</span>
          </button>

          <button
            type="button"
            onClick={() => handleRewrite("expand")}
            disabled={isLoading}
            className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-800 font-medium border border-slate-200 transition-colors disabled:opacity-50 text-left"
          >
            <Maximize2 className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
            <span>Expand Concept</span>
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="py-6 flex flex-col items-center justify-center text-slate-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
          <span className="text-[11px] font-medium">
            Generating scholarly {activeMode?.replace("_", " ")} revision...
          </span>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div className="p-2 mb-2 rounded bg-rose-50 border border-rose-200 text-rose-700 text-[11px] flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Suggestion Review Card */}
      {suggestion && (
        <div className="space-y-2">
          <div className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
              Original Text:
            </span>
            <div className="p-2 rounded bg-slate-50 border border-slate-100 text-slate-600 text-xs line-clamp-3">
              "{selectedText}"
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide">
                AI Scholarly Revision:
              </span>
              {modelMeta && (
                <span className="text-[10px] font-mono text-slate-400">
                  {modelMeta.provider}/{modelMeta.model}
                </span>
              )}
            </div>
            <div className="p-2.5 rounded bg-indigo-50/50 border border-indigo-200 text-slate-900 text-xs font-serif leading-relaxed">
              {suggestion}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                setSuggestion(null);
                setActiveMode(null);
              }}
              className="px-2.5 py-1 text-xs font-medium rounded text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Try Another
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 text-xs font-medium rounded text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => onApplyReplacement(suggestion)}
              className="px-3 py-1 text-xs font-medium rounded bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-xs"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Accept & Replace</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
