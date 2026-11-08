"use client";

import React, { useState, useEffect } from "react";
import {
  Clock,
  X,
  RotateCcw,
  Download,
  Loader2,
  FileText,
  Quote,
  BookOpen,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ArrowUpRight,
  History,
  ShieldCheck,
} from "lucide-react";
import {
  listDocumentRevisionsAction,
  getDocumentRevisionAction,
  restoreDocumentRevisionAction,
  exportDocumentRevisionAction,
} from "@/app/editor/actions";
import { RevisionSummary } from "@/lib/editor/revision-service";

interface RevisionHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  currentVersion: number;
  currentWordCount: number;
  hasUnsavedChanges?: boolean;
  isSaving?: boolean;
  onRestoreStart?: () => void;
  onRestoreEnd?: () => void;
  onRestoreSuccess: (updatedDoc: any) => void;
}

export function RevisionHistoryDrawer({
  isOpen,
  onClose,
  documentId,
  currentVersion,
  currentWordCount,
  hasUnsavedChanges = false,
  isSaving = false,
  onRestoreStart,
  onRestoreEnd,
  onRestoreSuccess,
}: RevisionHistoryDrawerProps) {
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<any | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Restore confirmation modal
  const [isConfirmingRestore, setIsConfirmingRestore] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Export state
  const [isExporting, setIsExporting] = useState<string | null>(null);

  // Consistent active revision check
  const isRevisionReady = Boolean(
    selectedRevision &&
      selectedRevisionId &&
      selectedRevision.id === selectedRevisionId
  );

  // Fetch revisions list when opened
  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    setIsLoadingList(true);
    setRestoreError(null);

    listDocumentRevisionsAction(documentId)
      .then((res) => {
        if (!mounted) return;
        if (res.success && res.revisions) {
          setRevisions(res.revisions);
          if (res.revisions.length > 0) {
            setSelectedRevisionId(res.revisions[0].id);
          }
        }
      })
      .finally(() => {
        if (mounted) setIsLoadingList(false);
      });

    return () => {
      mounted = false;
    };
  }, [isOpen, documentId]);

  // Fetch full detail when selected revision changes, clearing stale preview on failure
  useEffect(() => {
    if (!selectedRevisionId || !isOpen) {
      setSelectedRevision(null);
      return;
    }

    let mounted = true;
    setIsLoadingDetail(true);

    getDocumentRevisionAction(documentId, selectedRevisionId)
      .then((res) => {
        if (!mounted) return;
        if (res.success && res.revision && res.revision.id === selectedRevisionId) {
          setSelectedRevision(res.revision);
        } else {
          // Clear stale preview data when a revision load fails
          setSelectedRevision(null);
        }
      })
      .catch(() => {
        if (mounted) setSelectedRevision(null);
      })
      .finally(() => {
        if (mounted) setIsLoadingDetail(false);
      });

    return () => {
      mounted = false;
    };
  }, [selectedRevisionId, documentId, isOpen]);

  if (!isOpen) return null;

  const handleExecuteRestore = async () => {
    if (!isRevisionReady || !selectedRevision) return;
    if (hasUnsavedChanges || isSaving) return;
    setIsRestoring(true);
    setRestoreError(null);
    onRestoreStart?.();

    try {
      const res = await restoreDocumentRevisionAction(documentId, {
        targetRevisionId: selectedRevision.id,
        expectedCurrentVersion: currentVersion,
        description: `Restored to v${selectedRevision.version}`,
      });

      if (res.success && res.result) {
        setIsConfirmingRestore(false);
        onRestoreSuccess(res.result.document);
        onClose();
      } else {
        setRestoreError(res.error || "Failed to restore revision.");
      }
    } catch (err: any) {
      setRestoreError(err.message || "An unexpected error occurred during restore.");
    } finally {
      setIsRestoring(false);
      onRestoreEnd?.();
    }
  };

  const handleExportRevision = async (
    format: "markdown" | "pdf" | "docx" | "bibtex" | "ris" | "text"
  ) => {
    if (!isRevisionReady || !selectedRevision) return;
    const targetRevId = selectedRevision.id;
    setIsExporting(format);
    try {
      if (format === "pdf" || format === "docx") {
        window.open(
          `/api/editor/${documentId}/revisions/${targetRevId}/export?format=${format}`,
          "_blank"
        );
      } else {
        const res = await exportDocumentRevisionAction(documentId, targetRevId, format);
        if (res.success && res.export) {
          const blob = new Blob([res.export.content], { type: res.export.mimeType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = res.export.filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else {
          alert(res.error || "Failed to export revision.");
        }
      }
    } catch (err: any) {
      alert(err.message || "Failed to export revision.");
    } finally {
      setIsExporting(null);
    }
  };

  const formatTimestamp = (dateStr: string | Date) => {
    const d = new Date(dateStr);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="ml-auto w-full max-w-4xl bg-white shadow-2xl flex flex-col h-full border-l border-slate-200 animate-in slide-in-from-right duration-300">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900">Revision History</h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-indigo-100 text-indigo-700 font-medium">
                  {revisions.length} {revisions.length === 1 ? "snapshot" : "snapshots"}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Browse historical snapshots, preview previous drafts, or perform a guarded restore.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Unsaved Edits / Saving In-Flight Guard Notice Banner */}
        {(hasUnsavedChanges || isSaving) && (
          <div className="px-6 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs flex items-center gap-2 flex-shrink-0">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>
              {isSaving
                ? "A save is currently in progress. Restoring is disabled until save completes."
                : "You have unsaved changes in the editor. Restoring is blocked to protect your draft. Please save your draft before restoring a historical snapshot."}
            </span>
          </div>
        )}

        {/* Drawer Body - Split View */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column: Revision Timeline */}
          <div className="w-80 border-r border-slate-200 flex flex-col bg-slate-50/50 overflow-y-auto">
            <div className="p-3 border-b border-slate-200 bg-white sticky top-0 z-10 flex items-center justify-between text-xs text-slate-500 font-medium">
              <span>Timeline (v{currentVersion} is current)</span>
              <span>Retention: up to 50</span>
            </div>

            {isLoadingList ? (
              <div className="flex flex-col items-center justify-center p-8 text-slate-400 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                <span className="text-xs">Loading history...</span>
              </div>
            ) : revisions.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                <Clock className="w-8 h-8 mx-auto mb-2 opacity-40 text-slate-400" />
                <p className="font-medium text-slate-600">No revisions yet</p>
                <p className="mt-1">
                  Snapshots are automatically created each time you make edits and save your manuscript.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {revisions.map((rev) => {
                  const isSelected = rev.id === selectedRevisionId;
                  const wordDiff = rev.wordCount - currentWordCount;

                  return (
                    <button
                      key={rev.id}
                      type="button"
                      onClick={() => setSelectedRevisionId(rev.id)}
                      className={`w-full text-left p-3.5 transition-all flex flex-col gap-1.5 relative ${
                        isSelected
                          ? "bg-white border-l-4 border-l-indigo-600 shadow-xs"
                          : "hover:bg-slate-100/70 border-l-4 border-l-transparent"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                          v{rev.version}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {formatTimestamp(rev.createdAt)}
                        </span>
                      </div>

                      <div className="text-xs font-medium text-slate-800 line-clamp-1">
                        {rev.description || rev.title}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-slate-500">
                        <span>{rev.wordCount.toLocaleString()} words</span>
                        <span className="text-slate-300">•</span>
                        <span>{rev.citationCount} {rev.citationCount === 1 ? "cite" : "cites"}</span>
                        {wordDiff !== 0 && (
                          <span
                            className={`font-mono text-[10px] ml-auto font-medium ${
                              wordDiff > 0 ? "text-emerald-600" : "text-rose-600"
                            }`}
                          >
                            {wordDiff > 0 ? `+${wordDiff}` : wordDiff}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Read-Only Preview Pane */}
          <div className="flex-1 flex flex-col bg-white overflow-y-auto">
            {isLoadingDetail ? (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-400 gap-2">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                <span className="text-xs">Loading snapshot details...</span>
              </div>
            ) : !selectedRevision ? (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-400 text-xs">
                <History className="w-10 h-10 mb-2 opacity-30 text-slate-400" />
                <p>Select a revision on the left to preview its content and citations.</p>
              </div>
            ) : (
              <div className="flex flex-col h-full">
                {/* Preview Toolbar */}
                <div className="px-6 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <span className="px-2.5 py-1 rounded-md text-xs font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                      Version {selectedRevision.version}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">
                      Captured {formatTimestamp(selectedRevision.createdAt)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Read-only Exports */}
                    <div className="flex items-center gap-1 border-r border-slate-200 pr-2 mr-1">
                      <button
                        type="button"
                        onClick={() => handleExportRevision("pdf")}
                        disabled={isExporting !== null}
                        className="px-2 py-1 rounded text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition-colors flex items-center gap-1"
                        title="Export this revision as PDF"
                      >
                        <Download className="w-3.5 h-3.5 text-rose-600" />
                        <span>PDF</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportRevision("docx")}
                        disabled={isExporting !== null}
                        className="px-2 py-1 rounded text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition-colors flex items-center gap-1"
                        title="Export this revision as Word document"
                      >
                        <Download className="w-3.5 h-3.5 text-indigo-600" />
                        <span>DOCX</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportRevision("markdown")}
                        disabled={isExporting !== null}
                        className="px-2 py-1 rounded text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition-colors flex items-center gap-1"
                        title="Export this revision as Markdown"
                      >
                        <Download className="w-3.5 h-3.5 text-slate-600" />
                        <span>MD</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportRevision("bibtex")}
                        disabled={isExporting !== null}
                        className="px-2 py-1 rounded text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition-colors flex items-center gap-1"
                        title="Export citations as BibTeX"
                      >
                        <Quote className="w-3.5 h-3.5 text-amber-600" />
                        <span>BibTeX</span>
                      </button>
                    </div>

                    {/* Restore Button */}
                    <button
                      type="button"
                      onClick={() => {
                        if (hasUnsavedChanges || isSaving || !isRevisionReady) return;
                        setIsConfirmingRestore(true);
                      }}
                      disabled={hasUnsavedChanges || isSaving || !isRevisionReady}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shadow-2xs ${
                        hasUnsavedChanges || isSaving || !isRevisionReady
                          ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                          : "bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
                      }`}
                      title={
                        hasUnsavedChanges
                          ? "Cannot restore while you have unsaved edits. Please save or wait for autosave."
                          : isSaving
                          ? "Saving in progress. Please wait..."
                          : "Restore this version"
                      }
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restore this version</span>
                    </button>
                  </div>
                </div>

                {/* Preview Metadata Card */}
                <div className="p-6 border-b border-slate-100 bg-white">
                  <h1 className="text-xl font-serif font-bold text-slate-900 mb-2">
                    {selectedRevision.title}
                  </h1>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5 font-mono">
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
                      {selectedRevision.wordCount.toLocaleString()} words ({selectedRevision.charCount.toLocaleString()} chars)
                    </span>
                    <span className="text-slate-300">•</span>
                    <span className="flex items-center gap-1.5 font-mono">
                      <Quote className="w-3.5 h-3.5 text-indigo-500" />
                      {Array.isArray(selectedRevision.citations)
                        ? selectedRevision.citations.length
                        : 0}{" "}
                      citations ({selectedRevision.cslStyleId?.toUpperCase() || "APA"})
                    </span>
                    <span className="text-slate-300">•</span>
                    <span className="flex items-center gap-1.5 font-mono">
                      <BookOpen className="w-3.5 h-3.5 text-emerald-500" />
                      {Array.isArray(selectedRevision.linkedPapers)
                        ? selectedRevision.linkedPapers.length
                        : 0}{" "}
                      sources attached
                    </span>
                  </div>
                </div>

                {/* Preview Content Document Body */}
                <div className="p-6 flex-1 overflow-y-auto font-serif text-slate-800 text-sm leading-relaxed space-y-4">
                  {selectedRevision.textContent ? (
                    <div className="whitespace-pre-wrap font-sans text-xs bg-slate-50 p-4 rounded-lg border border-slate-200 text-slate-700">
                      {selectedRevision.textContent}
                    </div>
                  ) : (
                    <p className="italic text-slate-400 text-xs">No text preview available for this snapshot.</p>
                  )}

                  {/* Citations Preview in this Revision */}
                  {Array.isArray(selectedRevision.citations) && selectedRevision.citations.length > 0 && (
                    <div className="mt-8 pt-4 border-t border-slate-200 font-sans">
                      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                        <Quote className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Preserved Citations in this Snapshot ({selectedRevision.citations.length})</span>
                      </h3>
                      <ol className="space-y-2 text-xs text-slate-600 list-decimal list-inside">
                        {selectedRevision.citations.map((c: any, i: number) => (
                          <li key={c.id || i} className="p-2 rounded bg-slate-50 border border-slate-100">
                            <span className="font-semibold text-slate-900">{c.citationText}</span>
                            {c.paper?.title && (
                              <span className="text-slate-500 ml-1">
                                — &ldquo;{c.paper.title}&rdquo; {c.paper?.doi ? `(DOI: ${c.paper.doi})` : ""}
                              </span>
                            )}
                            {c.pageNumber && (
                              <span className="ml-2 font-mono text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                                p. {c.pageNumber}
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Guarded Restore Confirmation Modal */}
        {isConfirmingRestore && selectedRevision && (
          <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
              <div className="flex items-center gap-3 text-indigo-600">
                <div className="p-2 rounded-full bg-indigo-50 border border-indigo-100">
                  <RotateCcw className="w-5 h-5 text-indigo-600" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">
                  Restore Version {selectedRevision.version}?
                </h3>
              </div>

              <div className="text-xs text-slate-600 space-y-2 leading-relaxed">
                <p>
                  You are about to restore this manuscript to snapshot{" "}
                  <strong className="text-slate-900">v{selectedRevision.version}</strong>.
                </p>
                <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg text-emerald-800 text-[11px] flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong>Automatic Pre-Restore Snapshot:</strong> An automatic snapshot of your
                    current saved draft (<strong>v{currentVersion}</strong>) will be captured before
                    restoring and will remain available in your revision history while retained
                    (subject to the 50-revision retention limit).
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  Your restored document will be saved as <strong>v{currentVersion + 1}</strong>.
                </p>
              </div>

              {restoreError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{restoreError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsConfirmingRestore(false)}
                  disabled={isRestoring}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteRestore}
                  disabled={isRestoring || hasUnsavedChanges || isSaving || !isRevisionReady}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-2xs disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  {isRestoring ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Restoring...</span>
                    </>
                  ) : (
                    <span>Confirm Restore</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

