"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DocumentType } from "@prisma/client";
import { EditorHeader, SaveStatus } from "@/components/editor/editor-header";
import { EditorCanvas } from "@/components/editor/editor-canvas";
import { SourcesDrawer } from "@/components/editor/sources-drawer";
import { EvidenceSummaryModal } from "@/components/editor/evidence-summary-modal";
import {
  saveDocumentAction,
  renameDocumentAction,
  getDocumentAction,
} from "@/app/editor/actions";
import { AlertCircle, RefreshCw, Save } from "lucide-react";

interface EditorClientProps {
  initialDocument: any;
}

export function EditorClient({ initialDocument }: EditorClientProps) {
  const router = useRouter();

  // Document Core State
  const [document, setDocument] = useState<any>(initialDocument);
  const [version, setVersion] = useState<number>(initialDocument.version);
  const [updatedAt, setUpdatedAt] = useState<string>(
    new Date(initialDocument.updatedAt).toISOString()
  );
  const [wordCount, setWordCount] = useState<number>(initialDocument.wordCount || 0);
  const [charCount, setCharCount] = useState<number>(initialDocument.charCount || 0);

  // Save State Machine
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [conflictError, setConflictError] = useState<string | null>(null);

  // Sources Drawer State
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);

  // Evidence Summary Modal State
  const [summaryModalTarget, setSummaryModalTarget] = useState<{
    paperId: string;
    paperTitle: string;
  } | null>(null);

  // External Text Insertion bridge (to inject citation text or summary into TipTap)
  const [externalInsertText, setExternalInsertText] = useState<{
    text: string;
    id: number;
  } | null>(null);

  // Refs for debounced autosave
  const pendingUpdatesRef = useRef<{
    content: any;
    textContent: string;
    wordCount: number;
    charCount: number;
  } | null>(null);
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const currentVersionRef = useRef(version);

  // Sync version ref
  useEffect(() => {
    currentVersionRef.current = version;
  }, [version]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  // Save Execution Core
  const executeSave = useCallback(
    async (forceOverwrite: boolean = false) => {
      if (!pendingUpdatesRef.current) return;
      if (isSavingRef.current) return;

      isSavingRef.current = true;
      setSaveStatus("saving");

      const updates = {
        content: pendingUpdatesRef.current.content,
        textContent: pendingUpdatesRef.current.textContent,
        wordCount: pendingUpdatesRef.current.wordCount,
        charCount: pendingUpdatesRef.current.charCount,
        expectedVersion: forceOverwrite ? undefined : currentVersionRef.current,
      };

      try {
        const res = await saveDocumentAction(document.id, updates);

        if (res.success && res.document) {
          setVersion(res.version);
          setUpdatedAt(res.updatedAt);
          currentVersionRef.current = res.version;
          setSaveStatus("saved");
          setConflictError(null);
          pendingUpdatesRef.current = null;
        } else if (res.isConflict) {
          setSaveStatus("conflict");
          setConflictError(
            "Concurrent edit conflict detected. This document was modified in another session. Please reload or overwrite."
          );
        } else {
          setSaveStatus("unsaved");
          console.error("Autosave failed:", res.error);
        }
      } catch (err: any) {
        setSaveStatus("unsaved");
        console.error("Save error:", err);
      } finally {
        isSavingRef.current = false;
      }
    },
    [document.id]
  );

  // Handle TipTap Canvas Content Changes
  const handleContentChange = useCallback(
    (contentJson: any, textContent: string) => {
      const words = textContent.trim() ? textContent.trim().split(/\s+/).length : 0;
      const chars = textContent.length;

      pendingUpdatesRef.current = {
        content: contentJson,
        textContent,
        wordCount: words,
        charCount: chars,
      };

      setSaveStatus("unsaved");

      // Reset debounced autosave timer (1500ms debounce)
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }

      autosaveTimerRef.current = setTimeout(() => {
        executeSave(false);
      }, 1500);
    },
    [executeSave]
  );

  // Handle Word/Char counts
  const handleCountsChange = useCallback((words: number, chars: number) => {
    setWordCount(words);
    setCharCount(chars);
  }, []);

  // Handle Document Rename
  const handleRename = async (newTitle: string) => {
    try {
      const res = await renameDocumentAction(document.id, newTitle);
      if (res.success && res.document) {
        setDocument((prev: any) => ({ ...prev, title: res.document!.title }));
      }
    } catch (err) {
      console.error("Rename failed:", err);
    }
  };

  // Refresh document state (e.g. after adding sources or citations)
  const handleRefreshDocument = async () => {
    try {
      const res = await getDocumentAction(document.id);
      if (res.success && res.document) {
        setDocument(res.document);
        setVersion(res.document.version);
        setUpdatedAt(new Date(res.document.updatedAt).toISOString());
        currentVersionRef.current = res.document.version;
      }
    } catch (err) {
      console.error("Refresh failed:", err);
    }
  };

  // Handle external citation text injection
  const handleInsertCitationText = (
    citationText: string,
    paperId: string,
    citationData?: any
  ) => {
    setExternalInsertText({
      text: " " + citationText,
      id: Date.now(),
    });
  };

  // Handle Summarize Evidence Modal Request
  const handleSummarizeEvidenceRequest = (paperId: string, paperTitle: string) => {
    setSummaryModalTarget({ paperId, paperTitle });
  };

  // Handle Evidence Summary insertion into Canvas
  const handleInsertSummaryContent = (text: string, citationData?: any) => {
    setExternalInsertText({
      text: "\n" + text + "\n",
      id: Date.now(),
    });
  };

  // Resolve Concurrency Conflict: Reload Latest from DB
  const handleReloadLatest = async () => {
    setConflictError(null);
    await handleRefreshDocument();
    router.refresh();
  };

  // Resolve Concurrency Conflict: Force Overwrite
  const handleForceOverwrite = async () => {
    await executeSave(true);
  };

  // Keyboard shortcut listener for Ctrl+S or Cmd+S (manual save)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        executeSave(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [executeSave]);

  const linkedPaperIds = (document.linkedPapers || []).map((lp: any) => lp.paperId);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50">
      {/* Editor Header Bar */}
      <EditorHeader
        documentId={document.id}
        initialTitle={document.title}
        docType={document.docType}
        version={version}
        updatedAt={updatedAt}
        saveStatus={saveStatus}
        wordCount={wordCount}
        charCount={charCount}
        sourcesCount={document.linkedPapers?.length || 0}
        isSourcesOpen={isSourcesOpen}
        onToggleSources={() => setIsSourcesOpen(!isSourcesOpen)}
        onRename={handleRename}
      />

      {/* Concurrency Conflict Alert Banner */}
      {conflictError && (
        <div className="bg-rose-50 border-b border-rose-200 px-6 py-2.5 flex items-center justify-between gap-4 text-xs text-rose-800 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span className="font-medium">{conflictError}</span>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={handleReloadLatest}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-rose-300 text-rose-700 font-medium hover:bg-rose-50 transition-colors shadow-2xs"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Reload Latest</span>
            </button>
            <button
              type="button"
              onClick={handleForceOverwrite}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-600 text-white font-medium hover:bg-rose-700 transition-colors shadow-2xs"
            >
              <Save className="w-3 h-3" />
              <span>Overwrite with Draft</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace Body: Editor Canvas & Sources Drawer */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* TipTap Rich Text Writing Canvas */}
        <EditorCanvas
          documentId={document.id}
          initialContent={document.content}
          onContentChange={handleContentChange}
          onCountsChange={handleCountsChange}
          linkedPaperIds={linkedPaperIds}
          externalInsertText={externalInsertText}
        />

        {/* My Library & Verified Sources Slide-Over Drawer */}
        <SourcesDrawer
          documentId={document.id}
          isOpen={isSourcesOpen}
          onClose={() => setIsSourcesOpen(false)}
          linkedPapers={document.linkedPapers || []}
          citations={document.citations || []}
          onInsertCitationText={handleInsertCitationText}
          onSummarizeEvidenceRequest={handleSummarizeEvidenceRequest}
          onRefreshDocument={handleRefreshDocument}
        />
      </div>

      {/* Evidence-Grounded Summarizer Modal */}
      {summaryModalTarget && (
        <EvidenceSummaryModal
          documentId={document.id}
          paperId={summaryModalTarget.paperId}
          paperTitle={summaryModalTarget.paperTitle}
          isOpen={Boolean(summaryModalTarget)}
          onClose={() => setSummaryModalTarget(null)}
          onInsertContent={handleInsertSummaryContent}
          onRefreshDocument={handleRefreshDocument}
        />
      )}
    </div>
  );
}
