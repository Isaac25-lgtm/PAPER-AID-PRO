"use client";

import React, { useState, useEffect } from "react";
import { AlertCircle, Copy, Check, RefreshCw, Save, X, ShieldAlert, ArrowRight } from "lucide-react";
import { getDocumentAction } from "@/app/editor/actions";

interface ConflictResolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  draftVersion: number;
  draftWordCount: number;
  draftTextContent: string;
  onConfirmOverwrite: () => Promise<void>;
  onReloadLatest: () => Promise<void>;
}

export function ConflictResolutionModal({
  isOpen,
  onClose,
  documentId,
  draftVersion,
  draftWordCount,
  draftTextContent,
  onConfirmOverwrite,
  onReloadLatest,
}: ConflictResolutionModalProps) {
  const [serverDoc, setServerDoc] = useState<any>(null);
  const [isLoadingServer, setIsLoadingServer] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isOverwriting, setIsOverwriting] = useState(false);
  const [backupKey, setBackupKey] = useState<string | null>(null);

  // Fetch competing server document details on open
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setIsLoadingServer(true);

    getDocumentAction(documentId)
      .then((res) => {
        if (isMounted && res.success && res.document) {
          setServerDoc(res.document);
          // Automatically save competing server version into localStorage as a safety backup
          try {
            const key = `competing_backup_${documentId}_v${res.document.version}_${Date.now()}`;
            localStorage.setItem(
              key,
              JSON.stringify({
                documentId,
                title: res.document.title,
                version: res.document.version,
                updatedAt: res.document.updatedAt,
                textContent: res.document.textContent,
                content: res.document.content,
              })
            );
            setBackupKey(key);
          } catch (e) {
            console.warn("Could not write competing backup to localStorage:", e);
          }
        }
      })
      .catch((err) => {
        console.error("Failed to load competing server document:", err);
      })
      .finally(() => {
        if (isMounted) setIsLoadingServer(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, documentId]);

  if (!isOpen) return null;

  const handleCopyCompeting = async () => {
    if (!serverDoc?.textContent) return;
    try {
      await navigator.clipboard.writeText(serverDoc.textContent);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    } catch (err) {
      console.error("Clipboard copy failed:", err);
    }
  };

  const handleConfirmOverwriteClick = async () => {
    setIsOverwriting(true);
    try {
      await onConfirmOverwrite();
      onClose();
    } finally {
      setIsOverwriting(false);
    }
  };

  const serverWordCount = serverDoc?.textContent
    ? serverDoc.textContent.trim().split(/\s+/).filter(Boolean).length
    : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-2xl w-full flex flex-col overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-amber-900">
            <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <h2 id="conflict-modal-title" className="text-base font-semibold">
              Concurrent Edit Conflict Detected
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto space-y-4 text-xs text-slate-700">
          <p className="text-slate-600 leading-relaxed text-sm">
            This manuscript was modified in another browser tab or session while you were editing.
            To avoid overwriting colleague or concurrent changes, please review the versions below:
          </p>

          {/* Comparison Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
            {/* Draft Version */}
            <div className="p-3.5 rounded-lg border border-indigo-200 bg-indigo-50/50 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between font-semibold text-indigo-900 mb-1">
                  <span>Your Current Draft</span>
                  <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                    v{draftVersion}
                  </span>
                </div>
                <div className="text-slate-500 font-mono text-[11px] mb-2">
                  {draftWordCount} words in current view
                </div>
                <div className="bg-white p-2.5 rounded border border-indigo-100 font-serif text-[11px] text-slate-700 max-h-32 overflow-y-auto leading-relaxed">
                  {draftTextContent.slice(0, 350)}
                  {draftTextContent.length > 350 ? "..." : ""}
                </div>
              </div>
            </div>

            {/* Server Version */}
            <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/50 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between font-semibold text-amber-900 mb-1">
                  <span>Server Version</span>
                  <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                    {isLoadingServer ? "Loading..." : `v${serverDoc?.version || "?"}`}
                  </span>
                </div>
                <div className="text-slate-500 font-mono text-[11px] mb-2">
                  {isLoadingServer ? "..." : `${serverWordCount} words on server`}
                </div>
                <div className="bg-white p-2.5 rounded border border-amber-100 font-serif text-[11px] text-slate-700 max-h-32 overflow-y-auto leading-relaxed">
                  {isLoadingServer ? (
                    <span className="italic text-slate-400">Loading server snapshot...</span>
                  ) : serverDoc?.textContent ? (
                    <>
                      {serverDoc.textContent.slice(0, 350)}
                      {serverDoc.textContent.length > 350 ? "..." : ""}
                    </>
                  ) : (
                    <span className="italic text-slate-400">No server text preview available.</span>
                  )}
                </div>
              </div>

              {serverDoc?.textContent && (
                <div className="pt-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleCopyCompeting}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 hover:text-amber-900 hover:underline"
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span className="text-emerald-700 font-semibold">Copied to Clipboard</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-amber-700" />
                        <span>Copy Server Text</span>
                      </>
                    )}
                  </button>
                  {backupKey && (
                    <span className="text-[10px] text-slate-400 font-mono">
                      Backed up locally
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Warning Explaining Risk */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 space-y-1">
            <div className="font-semibold text-slate-800 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-slate-500" />
              <span>Safety & Preservation Notice</span>
            </div>
            <p className="leading-relaxed">
              Choosing <strong>"Overwrite with Draft"</strong> will replace the server's version with your current draft.
              A safety backup has automatically been cached locally in your browser session so you can recover it if needed.
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-100 transition-colors"
          >
            Cancel & Keep Comparing
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                await onReloadLatest();
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-800 font-medium hover:bg-amber-50 transition-colors shadow-2xs"
            >
              <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
              <span>Reload Server Version</span>
            </button>

            <button
              type="button"
              onClick={handleConfirmOverwriteClick}
              disabled={isOverwriting}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-rose-600 text-white font-medium hover:bg-rose-700 transition-colors shadow-sm disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isOverwriting ? "Overwriting..." : "Confirm & Overwrite with Draft"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
