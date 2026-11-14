import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { LABEL_META } from "@/lib/citationNode";
import { clearGhost, currentGhost, showGhost, suggestionPoint } from "@/lib/ghostText";
import { normalizeSuggestion } from "@/lib/templates";

export type AutocompleteStatus = "off" | "idle" | "thinking" | "ready" | "paused";

/** The writer has to have written something before a continuation is worth suggesting. */
export const MIN_CONTEXT_CHARS = 40;
const BACKOFF_MS = 60_000;

/**
 * Suggests the next words after the writer pauses at the end of a paragraph, shown as ghost text (Tab accepts).
 * One request at a time: a new keystroke cancels the pending timer and aborts the request in flight, and a
 * suggestion is only shown if the text and cursor are exactly as they were when it was requested.
 * Rate limits or a missing AI configuration pause suggestions instead of retrying in a loop.
 */
export function useAutocomplete(editor: Editor | null, documentId: string, enabled: boolean, delayMs = 1200): AutocompleteStatus {
  const [status, setStatus] = useState<AutocompleteStatus>(enabled ? "idle" : "off");
  const pausedUntil = useRef(0);

  useEffect(() => {
    if (!editor || !enabled) {
      setStatus("off");
      if (editor && !editor.isDestroyed) clearGhost(editor.view);
      return;
    }
    setStatus("idle");
    let timer: number | undefined;
    let controller: AbortController | null = null;
    const cancel = () => {
      window.clearTimeout(timer);
      controller?.abort();
      controller = null;
    };

    const request = async () => {
      if (editor.isDestroyed || !editor.isEditable || !editor.isFocused || Date.now() < pausedUntil.current) return;
      const state = editor.state;
      const pos = suggestionPoint(state);
      if (pos === null) return;
      const preceding = state.doc
        .textBetween(0, pos, "\n", (leaf) => (leaf.type.name === "citation" ? String(leaf.attrs.label ?? "") : " "))
        .slice(-6000);
      if (preceding.trim().length < MIN_CONTEXT_CHARS) return;
      const doc = state.doc;
      const mine = new AbortController();
      controller = mine;
      setStatus("thinking");
      try {
        const result = await api.post<{ text: string; model: string }>(
          "/ai/complete",
          { document_id: documentId, preceding_text: preceding },
          undefined,
          mine.signal,
        );
        if (mine.signal.aborted || editor.isDestroyed) return;
        if (editor.state.doc !== doc || editor.state.selection.head !== pos || !editor.state.selection.empty) {
          setStatus("idle");
          return;
        }
        const text = normalizeSuggestion(preceding, result.text);
        if (text.trim()) {
          showGhost(editor.view, { pos, text });
          setStatus("ready");
        } else setStatus("idle");
      } catch (error) {
        if (mine.signal.aborted) return;
        if (error instanceof ApiError && (error.status === 429 || error.status === 503)) {
          pausedUntil.current = Date.now() + BACKOFF_MS;
          setStatus("paused");
        } else setStatus("idle");
      } finally {
        if (controller === mine) controller = null;
      }
    };

    const onUpdate = ({ transaction }: { transaction: { getMeta: (key: string) => unknown } }) => {
      if (transaction.getMeta(LABEL_META)) return; // citation labels refreshed, not the writer typing
      cancel();
      setStatus((s) => (s === "paused" && Date.now() < pausedUntil.current ? s : "idle"));
      timer = window.setTimeout(() => void request(), delayMs);
    };
    const onSelection = () => {
      if (!currentGhost(editor.state)) setStatus((s) => (s === "ready" ? "idle" : s));
    };
    const onBlur = () => {
      cancel();
      setStatus((s) => (s === "thinking" ? "idle" : s));
    };
    editor.on("update", onUpdate);
    editor.on("selectionUpdate", onSelection);
    editor.on("blur", onBlur);
    return () => {
      editor.off("update", onUpdate);
      editor.off("selectionUpdate", onSelection);
      editor.off("blur", onBlur);
      cancel();
      if (!editor.isDestroyed) clearGhost(editor.view);
    };
  }, [editor, documentId, enabled, delayMs]);

  return status;
}
