"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DocumentType } from "@prisma/client";
import { EditorHeader, SaveStatus } from "@/components/editor/editor-header";
import { EditorCanvas } from "@/components/editor/editor-canvas";
import { SourcesDrawer } from "@/components/editor/sources-drawer";
import { EvidenceSummaryModal } from "@/components/editor/evidence-summary-modal";
import { ConflictResolutionModal } from "@/components/editor/conflict-resolution-modal";
import {
  saveDocumentAction,
  renameDocumentAction,
  getDocumentAction,
} from "@/app/editor/actions";
import { toPlainTipTapJson } from "@/lib/editor/content-sanitizer";
import { AlertCircle, RefreshCw, Save, ShieldAlert } from "lucide-react";

interface EditorClientProps {
  initialDocument: any;
}

function extractTextFromContent(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text" && typeof node.text === "string") {
    return node.text;
  }
  if (Array.isArray(node.content)) {
    return node.content.map(extractTextFromContent).join(" ");
  }
  return "";
}

function calculateCountsFromContent(content: any): { words: number; chars: number } {
  if (!content) return { words: 0, chars: 0 };
  const text = extractTextFromContent(content).trim();
  if (!text) return { words: 0, chars: 0 };
  const words = text.split(/\s+/).filter(Boolean).length;
  const chars = text.length;
  return { words, chars };
}

function extractHeadingsFromContent(content: any): string[] {
  if (!content) return [];
  const headings: string[] = [];
  if (Array.isArray(content.content)) {
    for (const node of content.content) {
      if (node.type === "heading" && Array.isArray(node.content)) {
        const text = node.content.map((c: any) => c.text || "").join("").trim();
        if (text) headings.push(text);
      }
    }
  }
  return headings;
}

export function EditorClient({ initialDocument }: EditorClientProps) {
  const router = useRouter();

  // Initial Content Metrics
  const initialCounts = calculateCountsFromContent(initialDocument.content);

  // Document Core State - renamed to researchDocument to avoid shadowing browser window.document
  const [researchDocument, setResearchDocument] = useState<any>(initialDocument);
  const [version, setVersion] = useState<number>(initialDocument.version);
  const [updatedAt, setUpdatedAt] = useState<string>(
    new Date(initialDocument.updatedAt).toISOString()
  );
  const [wordCount, setWordCount] = useState<number>(initialCounts.words);
  const [charCount, setCharCount] = useState<number>(initialCounts.chars);

  // Guided Document metadata and live outline synchronization
  const guidedMetaRef = useRef<any>((initialDocument.content as any)?.meta || null);
  const [liveHeadings, setLiveHeadings] = useState<string[]>(() =>
    extractHeadingsFromContent(initialDocument.content)
  );

  // Save State Machine
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);

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

  // Refs for debounced autosave and latest draft snapshot
  const pendingUpdatesRef = useRef<{
    content: any;
    textContent: string;
    wordCount: number;
    charCount: number;
  } | null>(null);
  const latestDraftRef = useRef<{
    content: any;
    textContent: string;
    wordCount: number;
    charCount: number;
  }>({
    content: initialDocument.content,
    textContent: extractTextFromContent(initialDocument.content),
    wordCount: initialCounts.words,
    charCount: initialCounts.chars,
  });
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const activeSavePromiseRef = useRef<Promise<boolean> | null>(null);
  const currentVersionRef = useRef(version);

  // Sync version ref
  useEffect(() => {
    currentVersionRef.current = version;
  }, [version]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, []);

  // Save Execution Core with in-flight snapshot comparison, serialized chaining and boolean return
  const executeSave = useCallback(
    async (forceOverwrite: boolean = false): Promise<boolean> => {
      // Clear any pending debounce timer
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      // If a save is already in-flight, await its completion instead of dropping or prematurely failing
      if (isSavingRef.current && activeSavePromiseRef.current) {
        const inFlightSuccess = await activeSavePromiseRef.current;
        if (pendingUpdatesRef.current === null) {
          return inFlightSuccess;
        }
      }

      const snapshot = pendingUpdatesRef.current || (forceOverwrite ? latestDraftRef.current : null);
      if (!snapshot) return true;

      isSavingRef.current = true;
      setSaveStatus("saving");

      // Snapshot the updates to send for this request, guaranteed plain and RSC-safe
      const updates = {
        content: toPlainTipTapJson(snapshot.content),
        textContent: typeof snapshot.textContent === "string" ? snapshot.textContent : "",
        expectedVersion: forceOverwrite ? undefined : currentVersionRef.current,
      };

      const saveOperation = async (): Promise<boolean> => {
        try {
          const res = await saveDocumentAction(researchDocument.id, updates);

          if (res.success && res.document) {
            setVersion(res.version);
            setUpdatedAt(res.updatedAt);
            currentVersionRef.current = res.version;
            setConflictError(null);
            setSaveErrorMessage(null);

            // If no newer edits arrived during the save round-trip, we are cleanly saved
            if (pendingUpdatesRef.current === snapshot) {
              pendingUpdatesRef.current = null;
              setSaveStatus("saved");
            } else {
              // Newer keystrokes arrived while saving was in flight
              setSaveStatus("unsaved");
            }
            return true;
          } else if (res.isConflict) {
            setSaveStatus("conflict");
            setConflictError(
              "Concurrent edit conflict detected. This document was modified in another session. Please reload or overwrite."
            );
            return false;
          } else {
            setSaveStatus("error");
            setSaveErrorMessage(res.error || "Autosave failed. Server did not respond.");
            console.error("Autosave failed:", res.error);
            return false;
          }
        } catch (err: any) {
          setSaveStatus("error");
          setSaveErrorMessage(err.message || "Network error during autosave.");
          console.error("Save error:", err);
          return false;
        } finally {
          isSavingRef.current = false;
          activeSavePromiseRef.current = null;

          // If newer edits arrived during the in-flight save, chain the next save
          if (pendingUpdatesRef.current !== null) {
            autosaveTimerRef.current = setTimeout(() => {
              executeSave(false);
            }, 600);
          }
        }
      };

      const currentSavePromise = saveOperation();
      activeSavePromiseRef.current = currentSavePromise;
      return await currentSavePromise;
    },
    [researchDocument.id]
  );

  // Handle TipTap Canvas Content Changes
  const handleContentChange = useCallback(
    (contentJson: any, textContent: string) => {
      const words = textContent.trim() ? textContent.trim().split(/\s+/).filter(Boolean).length : 0;
      const chars = textContent.length;

      // Update live word & char count states
      setWordCount(words);
      setCharCount(chars);

      // Extract current live headings from contentJson
      const currentHeadings = extractHeadingsFromContent(contentJson);
      if (currentHeadings.length > 0) {
        setLiveHeadings(currentHeadings);
      }

      // Preserve guided metadata even if TipTap's getJSON() drops it
      const rawContentToSave =
        guidedMetaRef.current && contentJson && !contentJson.meta
          ? { ...contentJson, meta: guidedMetaRef.current }
          : contentJson;
      const contentToSave = toPlainTipTapJson(rawContentToSave);

      latestDraftRef.current = {
        content: contentToSave,
        textContent,
        wordCount: words,
        charCount: chars,
      };

      pendingUpdatesRef.current = {
        content: contentToSave,
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
      const res = await renameDocumentAction(researchDocument.id, newTitle);
      if (res.success && res.document) {
        setResearchDocument((prev: any) => ({ ...prev, title: res.document!.title }));
      }
    } catch (err) {
      console.error("Rename failed:", err);
    }
  };

  // Refresh document state (e.g. after adding sources or citations)
  const handleRefreshDocument = async () => {
    try {
      const res = await getDocumentAction(researchDocument.id);
      if (res.success && res.document) {
        setResearchDocument(res.document);
        setVersion(res.document.version);
        setUpdatedAt(new Date(res.document.updatedAt).toISOString());
        currentVersionRef.current = res.document.version;
        if ((res.document.content as any)?.meta) {
          guidedMetaRef.current = (res.document.content as any).meta;
        }
        const refreshedHeadings = extractHeadingsFromContent(res.document.content);
        if (refreshedHeadings.length > 0) {
          setLiveHeadings(refreshedHeadings);
        }
        const refreshedCounts = calculateCountsFromContent(res.document.content);
        setWordCount(refreshedCounts.words);
        setCharCount(refreshedCounts.chars);
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
    setSaveErrorMessage(null);
    pendingUpdatesRef.current = null;
    await handleRefreshDocument();
    router.refresh();
  };

  // Resolve Concurrency Conflict: Force Overwrite
  const handleForceOverwrite = async () => {
    setConflictError(null);
    setSaveErrorMessage(null);
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

  // Guard against accidental page reload / tab close when unsaved changes exist
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingUpdatesRef.current !== null || saveStatus === "unsaved" || saveStatus === "saving") {
        e.preventDefault();
        e.returnValue = "You have unsaved research edits. Are you sure you want to leave?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveStatus]);

  // Intercept internal Next.js link transitions to flush pending autosave
  useEffect(() => {
    const handleDocumentClick = async (e: MouseEvent) => {
      // 1. Check for non-left clicks or modifier keys (Ctrl/Cmd/Shift/Alt) which open in new tabs
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
        return;
      }

      // 2. If no unsaved edits and no in-flight save, allow default navigation immediately
      if (pendingUpdatesRef.current === null && saveStatus === "saved" && !isSavingRef.current) {
        return;
      }

      // 3. Find if this click was on or inside an anchor element
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("javascript:") ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      ) {
        return;
      }

      // 4. We have unsaved changes and the user is navigating away:
      // Prevent default route change until we attempt to save
      e.preventDefault();
      e.stopPropagation();

      const success = await executeSave(false);
      if (success) {
        if (href.startsWith("http://") || href.startsWith("https://")) {
          window.location.href = href;
        } else {
          router.push(href);
        }
      } else {
        const discard = window.confirm(
          "Autosave could not complete. If you leave now, recent edits may be lost. Are you sure you want to discard your changes?"
        );
        if (discard) {
          pendingUpdatesRef.current = null;
          if (href.startsWith("http://") || href.startsWith("https://")) {
            window.location.href = href;
          } else {
            router.push(href);
          }
        }
      }
    };

    if (typeof window !== "undefined") {
      window.document.addEventListener("click", handleDocumentClick, true);
      return () => window.document.removeEventListener("click", handleDocumentClick, true);
    }
  }, [executeSave, router, saveStatus]);

  const linkedPaperIds = (researchDocument.linkedPapers || []).map((lp: any) => lp.paperId);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50">
      {/* Editor Header Bar */}
      <EditorHeader
        documentId={researchDocument.id}
        initialTitle={researchDocument.title}
        docType={researchDocument.docType}
        version={version}
        updatedAt={updatedAt}
        saveStatus={saveStatus}
        wordCount={wordCount}
        charCount={charCount}
        sourcesCount={researchDocument.linkedPapers?.length || 0}
        isSourcesOpen={isSourcesOpen}
        onToggleSources={() => setIsSourcesOpen(!isSourcesOpen)}
        onRename={handleRename}
        onManualSave={() => executeSave(false)}
        guidedMeta={(researchDocument.content as any)?.meta || guidedMetaRef.current}
        liveHeadings={liveHeadings}
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
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white border border-rose-300 text-rose-700 font-medium hover:bg-rose-50 transition-colors shadow-2xs cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Reload Latest</span>
            </button>
            <button
              type="button"
              onClick={() => setIsConflictModalOpen(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-600 text-white font-medium hover:bg-rose-700 transition-colors shadow-2xs cursor-pointer"
            >
              <ShieldAlert className="w-3 h-3" />
              <span>Review Conflict & Resolve...</span>
            </button>
          </div>
        </div>
      )}

      {/* Autosave Failure Error Banner with Retry */}
      {saveStatus === "error" && saveErrorMessage && !conflictError && (
        <div className="bg-rose-50 border-b border-rose-200 px-6 py-2.5 flex items-center justify-between gap-4 text-xs text-rose-800 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span className="font-medium">
              Autosave failed: {saveErrorMessage}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => executeSave(false)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-rose-600 text-white font-medium hover:bg-rose-700 transition-colors shadow-2xs cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry Saving Now</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace Body: Editor Canvas & Sources Drawer */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* TipTap Rich Text Writing Canvas */}
        <EditorCanvas
          documentId={researchDocument.id}
          initialContent={researchDocument.content}
          onContentChange={handleContentChange}
          onCountsChange={handleCountsChange}
          linkedPaperIds={linkedPaperIds}
          externalInsertText={externalInsertText}
        />

        {/* My Library & Verified Sources Slide-Over Drawer */}
        <SourcesDrawer
          documentId={researchDocument.id}
          isOpen={isSourcesOpen}
          onClose={() => setIsSourcesOpen(false)}
          linkedPapers={researchDocument.linkedPapers || []}
          citations={researchDocument.citations || []}
          onInsertCitationText={handleInsertCitationText}
          onSummarizeEvidenceRequest={handleSummarizeEvidenceRequest}
          onRefreshDocument={handleRefreshDocument}
        />
      </div>

      {/* Evidence-Grounded Summarizer Modal */}
      {summaryModalTarget && (
        <EvidenceSummaryModal
          documentId={researchDocument.id}
          paperId={summaryModalTarget.paperId}
          paperTitle={summaryModalTarget.paperTitle}
          isOpen={Boolean(summaryModalTarget)}
          onClose={() => setSummaryModalTarget(null)}
          onInsertContent={handleInsertSummaryContent}
          onRefreshDocument={handleRefreshDocument}
        />
      )}

      {/* Concurrency Conflict Resolution Modal */}
      <ConflictResolutionModal
        isOpen={isConflictModalOpen}
        onClose={() => setIsConflictModalOpen(false)}
        documentId={researchDocument.id}
        draftVersion={version}
        draftWordCount={wordCount}
        draftTextContent={
          latestDraftRef.current.textContent || extractTextFromContent(researchDocument.content)
        }
        onConfirmOverwrite={async () => {
          setIsConflictModalOpen(false);
          setConflictError(null);
          setSaveErrorMessage(null);
          await executeSave(true);
        }}
        onReloadLatest={async () => {
          setIsConflictModalOpen(false);
          await handleReloadLatest();
        }}
      />
    </div>
  );
}
