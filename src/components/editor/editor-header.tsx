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
}: EditorHeaderProps) {
  const [title, setTitle] = useState(initialTitle);
  const [isEditingTitle, setIsEditingTitle] = useState(false);

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

  return (
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

      {/* Right: Status, Counters & Sources Drawer Toggle */}
      <div className="flex items-center gap-3 flex-shrink-0">
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
  );
}
