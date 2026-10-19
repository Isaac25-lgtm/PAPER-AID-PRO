"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import { GhostSuggestion, ghostSuggestionPluginKey } from "./ghost-suggestion-extension";
import { EditorToolbar } from "./editor-toolbar";
import { AiSelectionPopover } from "./ai-selection-popover";
import { generateAutocompleteAction } from "@/app/editor/actions";
import { toPlainTipTapJson } from "@/lib/editor/content-sanitizer";
import { Sparkles, Check, X, CornerDownLeft } from "lucide-react";

interface EditorCanvasProps {
  documentId: string;
  initialContent: any;
  onContentChange: (content: any, textContent: string) => void;
  onCountsChange: (words: number, chars: number) => void;
  linkedPaperIds?: string[];
  externalInsertText?: { text: string; id: number } | null;
}

export function EditorCanvas({
  documentId,
  initialContent,
  onContentChange,
  onCountsChange,
  linkedPaperIds = [],
  externalInsertText,
}: EditorCanvasProps) {
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [surroundingContext, setSurroundingContext] = useState<string>("");
  const [ghostSuggestion, setGhostSuggestion] = useState<string | null>(null);
  const [suggestionMeta, setSuggestionMeta] = useState<{ model?: string; provider?: string } | null>(null);
  const [autocompleteNotice, setAutocompleteNotice] = useState<string | null>(null);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Initialize TipTap
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Underline,
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({
        placeholder: "Start drafting your research manuscript, or press Ctrl+J for AI autocomplete...",
      }),
      GhostSuggestion.configure({
        onTrigger: () => {
          triggerAutocomplete();
        },
        onAccept: () => {
          setGhostSuggestion(null);
        },
        onDismiss: () => {
          setGhostSuggestion(null);
        },
      }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class:
          "prose prose-slate max-w-none focus:outline-none min-h-[550px] font-serif text-slate-800 text-base leading-relaxed px-8 py-10",
      },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON();
      const text = editor.getText();
      onContentChange(toPlainTipTapJson(json), text);

      // Compute word count & char count
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const chars = text.length;
      onCountsChange(words, chars);

      // Dismiss ghost suggestion on edit
      if (ghostSuggestion) {
        setGhostSuggestion(null);
      }
    },
    onSelectionUpdate: ({ editor }) => {
      // If cursor moved, verify whether ghost suggestion decoration was cleared
      const pluginState = ghostSuggestionPluginKey.getState(editor.state);
      if (!pluginState && ghostSuggestion) {
        setGhostSuggestion(null);
      }

      const { from, to } = editor.state.selection;
      if (from !== to) {
        const text = editor.state.doc.textBetween(from, to, " ");
        if (text && text.trim().length > 3) {
          setSelectedText(text.trim());
          // Extract paragraph context
          const paragraphText = editor.state.doc.textBetween(
            Math.max(0, from - 200),
            Math.min(editor.state.doc.content.size, to + 200),
            " "
          );
          setSurroundingContext(paragraphText);
          return;
        }
      }
      setSelectedText(null);
    },
  });

  // Handle external text insertion (e.g. from SourcesDrawer citations or summaries)
  useEffect(() => {
    if (editor && externalInsertText) {
      editor.chain().focus().insertContent(externalInsertText.text).run();
    }
  }, [editor, externalInsertText]);

  // Autocomplete generator
  const triggerAutocomplete = useCallback(async () => {
    if (!editor || isAiGenerating) return;

    setIsAiGenerating(true);
    setGhostSuggestion(null);
    setAutocompleteNotice(null);
    editor.commands.clearGhostSuggestion();

    try {
      const { from } = editor.state.selection;
      const textBefore = editor.state.doc.textBetween(0, from, "\n");
      const textAfter = editor.state.doc.textBetween(
        from,
        editor.state.doc.content.size,
        "\n"
      );

      // Detect active section heading above current cursor position
      let currentSection = "";
      editor.state.doc.nodesBetween(0, from, (node) => {
        if (node.type.name === "heading") {
          currentSection = node.textContent;
        }
      });

      const res = await generateAutocompleteAction({
        documentId,
        prefixText: textBefore,
        suffixText: textAfter,
        selectedSourceIds: linkedPaperIds,
        currentSection,
      });

      if (res.success && res.suggestion) {
        setGhostSuggestion(res.suggestion);
        setSuggestionMeta({ model: res.model, provider: res.provider });
        // Inject inline ProseMirror ghost suggestion decoration at cursor position
        editor.commands.setGhostSuggestion({
          pos: from,
          text: res.suggestion,
        });
      } else if (res.success && !res.suggestion) {
        setSuggestionMeta(null);
        if (res.outcome === "TOKEN_LIMIT_REACHED") {
          setAutocompleteNotice("Completion token limit reached during reasoning. No suggestion generated.");
        } else if (res.outcome === "MISSING_CONTEXT") {
          setAutocompleteNotice("Insufficient context. Please enter preceding text or select a section heading.");
        } else {
          setAutocompleteNotice("No safe continuation available without empirical data. Model conservatively abstained.");
        }
        setTimeout(() => setAutocompleteNotice(null), 4500);
      } else if (!res.success && res.error) {
        setSuggestionMeta(null);
        setAutocompleteNotice(res.error);
        setTimeout(() => setAutocompleteNotice(null), 5000);
      }
    } catch (err: any) {
      console.error("Autocomplete failed:", err);
      setSuggestionMeta(null);
      setAutocompleteNotice(err.message || "Autocomplete service unavailable.");
      setTimeout(() => setAutocompleteNotice(null), 5000);
    } finally {
      setIsAiGenerating(false);
    }
  }, [editor, documentId, linkedPaperIds, isAiGenerating]);

  // Accept ghost suggestion
  const acceptGhostSuggestion = useCallback(() => {
    if (!editor) return;
    editor.commands.acceptGhostSuggestion();
    setGhostSuggestion(null);
    setSuggestionMeta(null);
  }, [editor]);

  // Reject ghost suggestion
  const rejectGhostSuggestion = useCallback(() => {
    if (!editor) return;
    editor.commands.clearGhostSuggestion();
    setGhostSuggestion(null);
    setSuggestionMeta(null);
  }, [editor]);

  // Keyboard shortcut listener (Ctrl+J or Cmd+J for AI autocomplete, Tab for accept)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Tab to accept ghost text
      if (e.key === "Tab" && ghostSuggestion) {
        e.preventDefault();
        acceptGhostSuggestion();
        return;
      }

      // Escape to dismiss ghost text
      if (e.key === "Escape" && ghostSuggestion) {
        e.preventDefault();
        rejectGhostSuggestion();
        return;
      }

      // Ctrl+J or Cmd+J to trigger autocomplete
      if ((e.ctrlKey || e.metaKey) && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        triggerAutocomplete();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [triggerAutocomplete, ghostSuggestion, acceptGhostSuggestion, rejectGhostSuggestion]);

  // Apply rewrite replacement
  const handleApplyReplacement = (replacement: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(replacement).run();
    setSelectedText(null);
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-100 min-h-0 overflow-y-auto" ref={editorContainerRef}>
      {/* TipTap Formatting Toolbar */}
      <EditorToolbar
        editor={editor}
        onTriggerAiAutocomplete={triggerAutocomplete}
        isAiGenerating={isAiGenerating}
        autocompleteMode={suggestionMeta?.model === "gpt-6-luna" ? "live" : "mock"}
      />

      {/* Main Canvas Paper Sheet */}
      <div className="flex-1 py-8 px-4 flex justify-center">
        <div className="w-full max-w-4xl bg-white rounded-xl shadow-xs border border-slate-200/80 min-h-[700px] flex flex-col relative">
          {/* TipTap Editor Content */}
          <EditorContent editor={editor} className="flex-1" />

          {/* Inline Autocomplete Helper Pill */}
          {ghostSuggestion && (
            <div className="mx-8 mb-4 p-2.5 rounded-lg bg-indigo-50/80 border border-indigo-200/80 text-xs flex items-center justify-between gap-3 shadow-2xs animate-in fade-in duration-150">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <span className="font-semibold text-indigo-900 shrink-0">AI Suggestion:</span>
                {suggestionMeta?.model === "gpt-6-luna" ? (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-300 shrink-0">
                    GPT-6 Luna (Live Pilot)
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-300 shrink-0">
                    Deterministic Mock
                  </span>
                )}
                <span className="text-slate-600 truncate italic">"{ghostSuggestion}"</span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={acceptGhostSuggestion}
                  className="px-2 py-0.5 rounded bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors flex items-center gap-1 text-[11px] shadow-2xs"
                  title="Accept (Tab)"
                >
                  <Check className="w-3 h-3" />
                  <span>Accept</span>
                  <kbd className="px-1 py-0.2 text-[9px] bg-indigo-700 rounded border border-indigo-500 text-indigo-100">
                    Tab
                  </kbd>
                </button>
                <button
                  type="button"
                  onClick={rejectGhostSuggestion}
                  className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
                  title="Dismiss (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Autocomplete Notice (e.g. In production or unconfigured environments) */}
          {autocompleteNotice && (
            <div className="mx-8 mb-4 p-2.5 rounded-lg bg-amber-50/90 border border-amber-200 text-xs flex items-center justify-between gap-3 text-amber-800 shadow-2xs animate-in fade-in duration-150">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="truncate">{autocompleteNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setAutocompleteNotice(null)}
                className="p-1 rounded text-amber-500 hover:text-amber-800 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Floating AI Selection Popover */}
          {selectedText && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
              <AiSelectionPopover
                documentId={documentId}
                selectedText={selectedText}
                surroundingContext={surroundingContext}
                onApplyReplacement={handleApplyReplacement}
                onClose={() => setSelectedText(null)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
