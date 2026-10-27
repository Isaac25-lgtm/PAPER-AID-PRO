"use client";

import * as React from "react";
import {
  Sparkles,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Info,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ResearchSnapshot, SnapshotCitation } from "@/lib/discovery/snapshot/types";
import { formatMetadataText } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface AIResearchSnapshotCardProps {
  snapshot: ResearchSnapshot | null;
  loading: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onSelectCitation: (citation: SnapshotCitation) => void;
  onScrollToPaper?: (paperId: string) => void;
}

export function AIResearchSnapshotCard({
  snapshot,
  loading,
  error,
  onRefresh,
  onSelectCitation,
  onScrollToPaper,
}: AIResearchSnapshotCardProps) {
  const [sourcesExpanded, setSourcesExpanded] = React.useState(false);
  const [activeCitationTooltip, setActiveCitationTooltip] = React.useState<number | null>(null);

  // Loading skeleton state
  if (loading) {
    return (
      <Card className="p-5 mb-6 border-indigo-200/80 bg-gradient-to-br from-indigo-50/40 via-white to-slate-50/50 shadow-xs animate-pulse">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-indigo-200/70" />
            <div className="h-5 w-44 bg-indigo-200/60 rounded-md" />
          </div>
          <div className="h-5 w-32 bg-slate-200/70 rounded-full" />
        </div>
        <div className="space-y-2 pt-2">
          <div className="h-4 bg-slate-200/70 rounded-md w-full" />
          <div className="h-4 bg-slate-200/70 rounded-md w-11/12" />
          <div className="h-4 bg-slate-200/70 rounded-md w-4/5" />
        </div>
        <div className="pt-3 flex items-center justify-between">
          <div className="h-3 w-40 bg-slate-200/50 rounded" />
          <div className="h-3 w-28 bg-slate-200/50 rounded" />
        </div>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="p-4 mb-6 border-amber-200 bg-amber-50/50 text-xs text-amber-900 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
          <span>{error}</span>
        </div>
        {onRefresh && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-100/50"
          >
            Retry
          </Button>
        )}
      </Card>
    );
  }

  if (!snapshot) return null;

  // Insufficient evidence state
  if (snapshot.isInsufficientEvidence) {
    return (
      <Card className="p-4 sm:p-5 mb-6 border-slate-200 bg-slate-50/70 shadow-2xs">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-lg bg-slate-200 flex items-center justify-center text-slate-600 shrink-0 mt-0.5">
            <Info className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-800">Evidence-Based Research Snapshot — Insufficient Literature</h3>
              <Badge variant="outline" className="text-[10px] text-slate-500 border-slate-300">
                Evidence Safeguard
              </Badge>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {snapshot.summaryText}
            </p>
            <p className="text-[11px] text-slate-500 pt-1">
              Tip: Try searching broader domain keywords, removing date filters, or enabling additional scholarly providers.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  // Helper to render text with interactive inline citation buttons [1], [2]
  const renderTextWithCitations = (text: string) => {
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[(\d+)\]/);
      if (match) {
        const idx = parseInt(match[1], 10);
        const citation = snapshot.citations.find((c) => c.index === idx);

        return (
          <span key={i} className="relative inline-block mx-0.5 align-baseline">
            <button
              type="button"
              onClick={() => {
                if (citation) {
                  onSelectCitation(citation);
                  if (onScrollToPaper) onScrollToPaper(citation.paperId);
                }
              }}
              onMouseEnter={() => setActiveCitationTooltip(idx)}
              onMouseLeave={() => setActiveCitationTooltip(null)}
              className="inline-flex items-center justify-center px-1.5 py-0.2 text-[10px] font-bold rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-colors shadow-2xs cursor-pointer select-none"
              title={citation ? `${citation.title} (${citation.authors})` : `Citation [${idx}]`}
            >
              [{idx}]
            </button>

            {/* Quick Hover Preview Tooltip */}
            {activeCitationTooltip === idx && citation && (
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-40 hidden sm:block w-64 p-2 bg-slate-900 text-white rounded-lg shadow-xl text-[11px] leading-tight pointer-events-none animate-in fade-in duration-100">
                <span className="font-semibold block truncate">{citation.title}</span>
                <span className="text-slate-300 text-[10px] block mt-0.5 truncate">
                  {citation.authors} {citation.year ? `(${citation.year})` : ""}
                </span>
              </span>
            )}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <Card className="mb-6 overflow-hidden border-indigo-200/90 bg-gradient-to-br from-indigo-50/50 via-white to-slate-50/40 shadow-xs">
      {/* Top Bar */}
      <div className="px-5 py-3.5 border-b border-indigo-100/80 bg-white/80 backdrop-blur-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-2xs">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">Evidence-Based Research Snapshot</h2>
              {snapshot.cached && (
                <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                  cached
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 hidden sm:block">
              Synthesized from {snapshot.citedCount ?? snapshot.citations.length} cited {snapshot.evidenceMode === "FULL_TEXT_EVIDENCE" ? "passages" : "abstracts"} ({snapshot.retrievedCount ?? snapshot.sourcesCount} retrieved studies) · {snapshot.wordCount} words
            </p>
          </div>
        </div>

        {/* Evidence Mode Badge & Controls */}
        <div className="flex items-center gap-2">
          {snapshot.evidenceMode === "FULL_TEXT_EVIDENCE" ? (
            <Badge className="bg-emerald-100/80 text-emerald-800 border-emerald-300 text-[10px] font-semibold flex items-center gap-1 px-2.5 py-0.5 shadow-2xs">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              <span>Based on verified full-text passages</span>
            </Badge>
          ) : (
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50/70 text-indigo-700 text-[10px] font-semibold flex items-center gap-1 px-2.5 py-0.5 shadow-2xs">
              <BookOpen className="h-3 w-3 text-indigo-600" />
              <span>Abstract-Only Evidence (based on available abstracts)</span>
            </Badge>
          )}

          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
              title="Refresh snapshot"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Concise Evidence Disclosure */}
      <div className="px-5 py-2 bg-slate-50/70 border-b border-indigo-50/80 text-[11px] text-slate-500 flex items-center gap-1.5">
        <Info className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <span>Generated from retrieved scholarly evidence. Review supporting citations before relying on conclusions.</span>
      </div>

      {/* Main Narrative Body */}
      <div className="p-5 space-y-3">
        <div className="text-xs sm:text-sm text-slate-800 leading-relaxed font-sans space-y-2">
          <p>{renderTextWithCitations(snapshot.summaryText)}</p>
        </div>

        {/* Supporting Studies Accordion Header */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => setSourcesExpanded(!sourcesExpanded)}
            className="flex items-center gap-1.5 font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-indigo-600" />
            <span>Supporting Studies ({snapshot.citations.length} cited)</span>
            {sourcesExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          <span className="text-[11px] text-slate-400 italic hidden sm:block">
            Click citation number or study row to inspect source evidence
          </span>
        </div>

        {/* Expandable Supporting Studies Drawer */}
        {sourcesExpanded && (
          <div className="pt-2 space-y-2 text-xs border-t border-slate-100">
            {snapshot.citations.map((c) => (
              <div
                key={c.index}
                onClick={() => onSelectCitation(c)}
                className="p-3 rounded-xl border border-slate-200/80 bg-white hover:border-indigo-300 hover:bg-indigo-50/30 transition-all cursor-pointer space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <span className="h-5 w-5 rounded bg-indigo-100 text-indigo-700 font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                      [{c.index}]
                    </span>
                    <div>
                      <h4 className="font-semibold text-slate-900 leading-snug hover:text-indigo-600">
                        {formatMetadataText(c.title)}
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        {c.authors} {c.year ? `• ${c.year}` : ""} {c.journal ? `• ${formatMetadataText(c.journal)}` : ""}
                      </p>
                    </div>
                  </div>

                  {c.doi && (
                    <Badge variant="outline" className="text-[9px] font-mono shrink-0 border-slate-200 text-slate-500">
                      doi:{c.doi}
                    </Badge>
                  )}
                </div>

                <div className="pl-7 text-[11px] text-slate-700 italic border-l-2 border-indigo-200 ml-2.5">
                  "{c.supportingSnippet}"
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
