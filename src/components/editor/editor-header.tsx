"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Loader2,
  AlertCircle,
  BookOpen,
  FileText,
  Clock,
  Compass,
  X,
  CheckCircle2,
  Layers,
} from "lucide-react";
import { DocumentType } from "@prisma/client";

export type SaveStatus = "saved" | "saving" | "unsaved" | "conflict";

interface EditorHeaderProps {
  documentId: string;
  initialTitle: string;
  docType: DocumentType;
  version: number;
  updatedAt: string;
  saveStatus: SaveStatus;
  wordCount: number;
  charCount: number;
  sourcesCount: number;
  isSourcesOpen: boolean;
  onToggleSources: () => void;
  onRename: (newTitle: string) => Promise<void>;
  onDocTypeChange?: (newType: DocumentType) => void;
  guidedMeta?: {
    researchTopic?: string;
    docType?: string;
    studyDesign?: string;
    objectives?: { general?: string; specific?: string[] };
    headings?: string[];
  };
  liveHeadings?: string[];
}

export function EditorHeader({
  initialTitle,
  docType,
  version,
  updatedAt,
  saveStatus,
  wordCount,
  charCount,
  sourcesCount,
  isSourcesOpen,
  onToggleSources,
  onRename,
  guidedMeta,
  liveHeadings,
}: EditorHeaderProps) {
  const [title, setTitle] = useState(initialTitle);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isPlanOpen, setIsPlanOpen] = useState(false);

  useEffect(() => {
    setTitle(initialTitle);
  }, [initialTitle]);

  const handleTitleBlur = () => {
    setIsEditingTitle(false);
    if (title.trim() && title.trim() !== initialTitle) {
      onRename(title.trim());
    } else {
      setTitle(initialTitle);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      setTitle(initialTitle);
      setIsEditingTitle(false);
    }
  };

  const formattedDate = new Date(updatedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const outlineHeadings =
    liveHeadings && liveHeadings.length > 0
      ? liveHeadings
      : guidedMeta?.headings || [];

  return (
    <>
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 py-2.5 flex items-center justify-between gap-4 shadow-sm">
        {/* Left: Back & Document Metadata */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Link
            href="/editor"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors flex-shrink-0"
            title="Back to Documents"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>

          <div className="flex items-center gap-2 min-w-0 max-w-xl">
            {isEditingTitle ? (
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={handleTitleKeyDown}
                autoFocus
                className="text-base font-semibold text-slate-900 border-b-2 border-indigo-500 bg-transparent px-1 py-0.5 outline-none w-full"
              />
            ) : (
              <h1
                onClick={() => setIsEditingTitle(true)}
                className="text-base font-semibold text-slate-900 truncate hover:bg-slate-100/80 px-2 py-0.5 rounded cursor-pointer transition-colors max-w-md"
                title="Click to rename"
              >
                {title || "Untitled Research Document"}
              </h1>
            )}

            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200 uppercase tracking-wide">
              {docType}
            </span>
            <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono text-slate-500 bg-slate-50 border border-slate-200">
              v{version}
            </span>
          </div>
        </div>

        {/* Right: Status, Counters, Research Plan & Sources Drawer Toggle */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Research Plan Badge (if guided document) */}
          {guidedMeta && (
            <button
              type="button"
              onClick={() => setIsPlanOpen(true)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 border border-indigo-200 bg-indigo-50/70 text-indigo-700 hover:bg-indigo-100/80 shadow-2xs"
              title="View Guided Research Plan & Objectives"
            >
              <Compass className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden sm:inline">Research Plan</span>
            </button>
          )}

          {/* Word Count */}
          <div className="hidden md:flex items-center gap-2 text-xs text-slate-500">
            <span className="flex items-center gap-1 font-mono">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              {wordCount.toLocaleString()} words
            </span>
            <span className="text-slate-300">•</span>
            <span className="font-mono text-slate-400">{charCount.toLocaleString()} chars</span>
          </div>

          {/* Save Status Badge */}
          <div className="flex items-center">
            {saveStatus === "saving" && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Saving...</span>
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                <Check className="w-3 h-3 text-emerald-600" />
                <span>Saved</span>
                <span className="text-[10px] text-emerald-500 hidden sm:inline font-mono">
                  {formattedDate}
                </span>
              </span>
            )}
            {saveStatus === "unsaved" && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                <Clock className="w-3 h-3 text-slate-400" />
                <span>Unsaved changes</span>
              </span>
            )}
            {saveStatus === "conflict" && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                <AlertCircle className="w-3 h-3 text-rose-600" />
                <span>Conflict (Reload)</span>
              </span>
            )}
          </div>

          {/* Sources Drawer Button */}
          <button
            type="button"
            onClick={onToggleSources}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-2 border ${
              isSourcesOpen
                ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-xs"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Sources</span>
            {sourcesCount > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  isSourcesOpen
                    ? "bg-white text-indigo-700"
                    : "bg-indigo-100 text-indigo-700"
                }`}
              >
                {sourcesCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Research Plan Slide-Over / Modal */}
      {isPlanOpen && guidedMeta && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Compass className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-semibold text-slate-900">Guided Research Plan</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsPlanOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto pr-1 flex-1 text-xs">
              <div>
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                  Research Topic / Working Title
                </span>
                <p className="text-sm font-semibold text-slate-900 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  {guidedMeta.researchTopic || initialTitle}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase block">
                    Document Type
                  </span>
                  <span className="font-semibold text-slate-800">{docType}</span>
                </div>
                {guidedMeta.studyDesign && (
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase block">
                      Study Design
                    </span>
                    <span className="font-semibold text-slate-800">{guidedMeta.studyDesign}</span>
                  </div>
                )}
              </div>

              {guidedMeta.objectives?.general && (
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Primary Objective
                  </span>
                  <p className="text-xs text-slate-800 bg-indigo-50/60 p-2.5 rounded-lg border border-indigo-100 font-medium">
                    {guidedMeta.objectives.general}
                  </p>
                </div>
              )}

              {guidedMeta.objectives?.specific && guidedMeta.objectives.specific.length > 0 && (
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1.5">
                    Approved Specific Objectives
                  </span>
                  <div className="space-y-1.5">
                    {guidedMeta.objectives.specific.map((obj: string, i: number) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                        <span>{obj}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {outlineHeadings && outlineHeadings.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Section Outline ({outlineHeadings.length} Sections)
                    </span>
                    {liveHeadings && liveHeadings.length > 0 && (
                      <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 font-medium">
                        Live Synced
                      </span>
                    )}
                  </div>
                  <div className="space-y-1 max-h-36 overflow-y-auto">
                    {outlineHeadings.map((h: string, i: number) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-2.5 py-1 rounded bg-slate-50 border border-slate-200 text-slate-700 font-medium"
                      >
                        <span className="text-[10px] font-mono text-slate-400 font-bold">{i + 1}.</span>
                        <span>{h}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setIsPlanOpen(false)}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors shadow-2xs"
              >
                Close Plan
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
