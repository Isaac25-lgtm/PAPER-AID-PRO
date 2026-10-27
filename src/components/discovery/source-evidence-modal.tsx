"use client";

import * as React from "react";
import Link from "next/link";
import { X, ExternalLink, BookOpen, CheckCircle2, ShieldCheck, Quote, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SnapshotCitation } from "@/lib/discovery/snapshot/types";
import { formatMetadataText } from "@/lib/utils";

interface SourceEvidenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  citation: SnapshotCitation | null;
  onOpenCiteModal?: (citation: SnapshotCitation) => void;
}

export function SourceEvidenceModal({
  isOpen,
  onClose,
  citation,
  onOpenCiteModal,
}: SourceEvidenceModalProps) {
  if (!isOpen || !citation) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4"
        role="dialog"
        aria-modal="true"
      >
        {/* Header with citation badge */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="h-7 w-7 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
              [{citation.index}]
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Supporting Source Evidence</h2>
              <p className="text-[11px] text-slate-500">
                Grounding anchor for claims in the AI Research Snapshot
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Paper Metadata Card */}
        <div className="space-y-2">
          <h3 className="text-base font-bold text-slate-900 leading-snug">
            {citation.title}
          </h3>

          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-slate-800">{citation.authors}</span>
            {citation.year && (
              <>
                <span className="text-slate-300">•</span>
                <span>{citation.year}</span>
              </>
            )}
            {citation.journal && (
              <>
                <span className="text-slate-300">•</span>
                <span className="italic">{formatMetadataText(citation.journal)}</span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {citation.provenance.isFullText ? (
              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-semibold flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                <span>Verified Full-Text Passage</span>
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-slate-100 text-slate-700 text-[10px] font-semibold flex items-center gap-1">
                <BookOpen className="h-3 w-3" />
                <span>Abstract Evidence Anchor</span>
              </Badge>
            )}

            {citation.isOpenAccess && (
              <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-700 bg-emerald-50/50">
                Open Access
              </Badge>
            )}

            {citation.doi && (
              <a
                href={`https://doi.org/${citation.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-0.5 font-mono"
              >
                <span>doi:{citation.doi}</span>
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </div>

        {/* Verifiable Supporting Excerpt Box */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
            <span>Verifiable Supporting Passage:</span>
            {citation.provenance.section && (
              <span className="text-slate-400 font-normal">
                Section: {citation.provenance.section}
              </span>
            )}
          </div>
          <blockquote className="p-3.5 rounded-xl border border-indigo-100 bg-indigo-50/40 text-xs text-slate-800 leading-relaxed font-serif italic border-l-3 border-l-indigo-600">
            "{citation.supportingSnippet}"
          </blockquote>
        </div>

        {/* Provenance Telemetry */}
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
            <span>Grounded in authentic scholarly text</span>
          </div>
          {citation.provenance.sourceProvider && (
            <span>Provider: {citation.provenance.sourceProvider}</span>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="text-xs h-8 border-slate-200"
          >
            Close
          </Button>

          <div className="flex items-center gap-2">
            {onOpenCiteModal && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onClose();
                  onOpenCiteModal(citation);
                }}
                className="text-xs h-8 gap-1 border-slate-200"
              >
                <Quote className="h-3 w-3" />
                <span>Cite</span>
              </Button>
            )}

            {citation.doi ? (
              <Button asChild size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8 gap-1">
                <a href={`https://doi.org/${citation.doi}`} target="_blank" rel="noopener noreferrer">
                  <span>Open DOI Manuscript</span>
                  <ExternalLink className="h-3 w-3 ml-0.5" />
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
