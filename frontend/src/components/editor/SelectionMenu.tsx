import { useMutation } from "@tanstack/react-query";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { Bot, Check, Loader2, ScanSearch, Search, Scissors, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { AIError } from "@/components/GroundedAnswerView";
import { api } from "@/lib/api";
import { useEditGate } from "@/lib/editGate";
import { applyRewrite, buildRewriteInput, REWRITE_PROBLEMS, type RewriteInput } from "@/lib/rewrite";

export interface Span {
  from: number;
  to: number;
  text: string;
}

/** Plain text of a document range, with citation chips as their labels. */
export function textOf(editor: Editor, from: number, to: number): string {
  return editor.state.doc.textBetween(from, to, " ", (leaf) => (leaf.type.name === "citation" ? String(leaf.attrs.label ?? "") : " "));
}

/** The current selection when the menu should offer actions on it (a real text selection of 3+ characters). */
export function selectedSpan(editor: Editor): Span | null {
  const { selection } = editor.state;
  if (selection.empty || !(selection instanceof TextSelection)) return null;
  const text = textOf(editor, selection.from, selection.to);
  if (text.trim().length < 3) return null;
  return { from: selection.from, to: selection.to, text };
}

type RewriteMode = "academic" | "concise";
const MAX_REWRITE = 8000;

/**
 * Actions on selected text, shown just above the selection: rewrite, shorten, find a source, check against my
 * sources. AI actions appear only when AI is switched on. A rewrite is a proposal: it replaces the passage only
 * when the writer chooses "Replace", and only if the passage has not changed in the meantime.
 */
export function SelectionMenu({
  editor,
  aiEnabled,
  disabled,
  onFindSource,
  onCheck,
}: {
  editor: Editor;
  aiEnabled: boolean;
  disabled?: boolean;
  onFindSource: (span: Span) => void;
  onCheck: (span: Span) => void;
}) {
  const [span, setSpan] = useState<Span | null>(null);
  const [proposal, setProposal] = useState<{ span: Span; mode: RewriteMode; input: RewriteInput } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const gate = useEditGate();
  const menuRef = useRef<HTMLDivElement>(null);

  const rewrite = useMutation({
    mutationFn: ({ input, mode }: { input: RewriteInput; mode: RewriteMode }) => api.post<{ text: string; model: string }>("/ai/rewrite", { text: input.text, mode }),
  });

  const refresh = useCallback(() => {
    if (!editor.isEditable) {
      setSpan(null);
      return;
    }
    setSpan(editor.isFocused || menuRef.current?.contains(document.activeElement) ? selectedSpan(editor) : null);
  }, [editor]);

  useEffect(() => {
    const onBlur = ({ event }: { event: FocusEvent }) => {
      if (menuRef.current && event.relatedTarget instanceof Node && menuRef.current.contains(event.relatedTarget)) return;
      setSpan(null);
    };
    editor.on("selectionUpdate", refresh);
    editor.on("focus", refresh);
    editor.on("blur", onBlur);
    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("focus", refresh);
      editor.off("blur", onBlur);
    };
  }, [editor, refresh]);

  // A pending or shown proposal is dropped once the writer moves on to other text.
  useEffect(() => {
    if (proposal && span && (span.from !== proposal.span.from || span.to !== proposal.span.to)) {
      setProposal(null);
      rewrite.reset();
    }
  }, [span, proposal, rewrite]);

  const anchor = proposal?.span ?? span;
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    if (!anchor) return;
    try {
      const start = editor.view.coordsAtPos(anchor.from);
      const end = editor.view.coordsAtPos(anchor.to);
      const width = menuRef.current?.offsetWidth ?? 420;
      const centre = start.top === end.top ? (start.left + end.right) / 2 : start.left + width / 2;
      const left = Math.max(12, Math.min(centre - width / 2, window.innerWidth - width - 12));
      const above = start.top - 52;
      setStyle(above > 64 && !proposal ? { left, top: above } : { left, top: end.bottom + 10 });
    } catch {
      setStyle({ left: 16, top: 80 });
    }
  }, [editor, anchor, proposal, rewrite.data]);

  if (disabled || !anchor) return null;

  const start = (mode: RewriteMode) => {
    if (!span) return;
    setProblem(null);
    const input = buildRewriteInput(editor, span.from, span.to);
    if (typeof input === "string") {
      setProblem(REWRITE_PROBLEMS[input]);
      return;
    }
    if (input.text.length > MAX_REWRITE) {
      setProblem("Select a shorter passage (up to about 1,200 words) to rewrite it.");
      return;
    }
    setProposal({ span, mode, input });
    rewrite.mutate({ input, mode });
  };

  const discard = () => {
    setProposal(null);
    setProblem(null);
    rewrite.reset();
    editor.commands.focus();
  };

  const replace = () => {
    if (!proposal || !rewrite.data) return;
    if (!gate.isOpen) {
      setProblem("Editing is paused while the document is exported or restored. Try again in a moment.");
      return;
    }
    const error = applyRewrite(editor, proposal.input, rewrite.data.text);
    if (error) {
      setProblem(error);
      return;
    }
    setProposal(null);
    rewrite.reset();
  };
  // Show citation placeholders as their labels while the writer reviews the proposal.
  const readable = (text: string) =>
    text.replace(/\[\[C(\d+)\]\]/g, (_m, n: string) => String((proposal?.input.citations[Number(n) - 1]?.attrs as { label?: string } | undefined)?.label ?? "[citation]"));

  const button = "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-white/90 hover:bg-white/10 focus:bg-white/10 focus:outline-none";
  return (
    <div ref={menuRef} className="fixed z-30 max-w-[calc(100vw-24px)]" style={style}>
      {!proposal && span && (
        <div role="toolbar" aria-label="Selected text" className="flex flex-wrap items-center gap-0.5 rounded-lg bg-slate-900 p-1 shadow-xl">
          {aiEnabled && (
            <>
              <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => start("academic")}><Wand2 className="h-3.5 w-3.5" aria-hidden /> Rewrite</button>
              <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => start("concise")}><Scissors className="h-3.5 w-3.5" aria-hidden /> Shorten</button>
            </>
          )}
          <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => onFindSource(span)}><Search className="h-3.5 w-3.5" aria-hidden /> Find a source</button>
          {aiEnabled && (
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => onCheck(span)}><ScanSearch className="h-3.5 w-3.5" aria-hidden /> Check against my sources</button>
          )}
        </div>
      )}
      {!proposal && problem && (
        <p role="alert" className="mt-1 rounded-md bg-white px-2 py-1 text-xs text-red-700 shadow">{problem}</p>
      )}
      {proposal && (
        <div role="dialog" aria-label={proposal.mode === "concise" ? "Shorter version" : "Rewritten version"} className="w-[min(36rem,calc(100vw-24px))] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl">
          {rewrite.isPending && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {proposal.mode === "concise" ? "Shortening" : "Rewriting"}…</p>}
          {rewrite.error && <AIError error={rewrite.error} />}
          {problem && <p role="alert" className="mb-2 text-xs text-red-700">{problem}</p>}
          {rewrite.data && (
            <>
              <p className="max-h-60 overflow-y-auto whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-slate-900">{readable(rewrite.data.text)}</p>
              <p className="mt-2 flex items-center gap-1 text-xs text-slate-600"><Bot className="h-3.5 w-3.5" aria-hidden /> {rewrite.data.model} · instructed not to add facts or citations; each citation stays with its claim. Review before keeping it.</p>
              {proposal.input.hasFormatting && <p className="mt-1 text-xs text-slate-600">Bold, italics and links in this passage are not kept.</p>}
            </>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={discard} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"><X className="h-3.5 w-3.5" aria-hidden /> {rewrite.data ? "Discard" : "Cancel"}</button>
            {rewrite.data && !problem && (
              <button type="button" onClick={replace} className="flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"><Check className="h-3.5 w-3.5" aria-hidden /> Replace</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
