"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorToolbar } from "./editor-toolbar";
import { AiSelectionPopover } from "./ai-selection-popover";
import { generateAutocompleteAction } from "@/app/editor/actions";
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
      onContentChange(json, text);

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

    try {
      const { from } = editor.state.selection;
      const textBefore = editor.state.doc.textBetween(0, from, "\n");
      const textAfter = editor.state.doc.textBetween(
        from,
        editor.state.doc.content.size,
        "\n"
      );

      const res = await generateAutocompleteAction({
        documentId,
        prefixText: textBefore,
        suffixText: textAfter,
        selectedSourceIds: linkedPaperIds,
      });

      if (res.success && res.suggestion) {
        setGhostSuggestion(res.suggestion);
      }
    } catch (err) {
      console.error("Autocomplete failed:", err);
    } finally {
      setIsAiGenerating(false);
    }
  }, [editor, documentId, linkedPaperIds, isAiGenerating]);

  // Accept ghost suggestion
  const acceptGhostSuggestion = useCallback(() => {
    if (!editor || !ghostSuggestion) return;
    editor.chain().focus().insertContent(" " + ghostSuggestion).run();
    setGhostSuggestion(null);
  }, [editor, ghostSuggestion]);

  // Reject ghost suggestion
  const rejectGhostSuggestion = useCallback(() => {
    setGhostSuggestion(null);
  }, []);

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
      />

      {/* Main Canvas Paper Sheet */}
      <div className="flex-1 py-8 px-4 flex justify-center">
        <div className="w-full max-w-4xl bg-white rounded-xl shadow-xs border border-slate-200/80 min-h-[700px] flex flex-col relative">
          {/* TipTap Editor Content */}
          <EditorContent editor={editor} className="flex-1" />

          {/* Jenni-style Ghost-Text Inline Banner */}
          {ghostSuggestion && (
            <div className="mx-8 mb-6 p-3 rounded-lg bg-indigo-50/70 border border-indigo-200 text-xs flex items-start justify-between gap-3 shadow-xs animate-in fade-in slide-in-from-bottom-1 duration-200">
              <div className="flex items-start gap-2 min-w-0">
                <Sparkles className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-indigo-900 block mb-0.5">
                    AI Suggested Completion:
                  </span>
                  <p className="font-serif text-slate-800 text-sm leading-relaxed">
                    "{ghostSuggestion}"
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={acceptGhostSuggestion}
                  className="px-2.5 py-1 rounded bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors flex items-center gap-1 shadow-xs"
                  title="Accept (Tab)"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Accept</span>
                  <kbd className="px-1 py-0.2 text-[10px] bg-indigo-700 rounded border border-indigo-500 text-indigo-100">
                    Tab
                  </kbd>
                </button>
                <button
                  type="button"
                  onClick={rejectGhostSuggestion}
                  className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
                  title="Dismiss (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
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
