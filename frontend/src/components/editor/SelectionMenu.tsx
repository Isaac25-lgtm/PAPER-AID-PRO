import { useMutation } from "@tanstack/react-query";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { Bot, Check, Loader2, ScanSearch, Search, Scissors, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { AIError } from "@/components/GroundedAnswerView";
import { api } from "@/lib/api";

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

type JSONNode = Record<string, unknown>;

/**
 * Replacement content for a rewritten passage. Citation chips inside the original passage are kept as real
 * citations (never flattened to text): their labels are removed from the model's text and the chips are placed at
 * the end of the passage, before its final full stop. Leading/trailing spaces of the original are preserved.
 */
export function withCitations(original: string, rewritten: string, cites: Array<{ label: string; json: JSONNode }>): JSONNode[] {
  let body = rewritten;
  for (const c of cites) if (c.label && c.label !== "[…]") body = body.split(c.label).join(" ");
  body = body.replace(/\(\s*\)/g, " ").replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
  const lead = /^\s/.test(original) ? " " : "";
  const trail = /\s$/.test(original) ? " " : "";
  const text = (value: string): JSONNode[] => (value ? [{ type: "text", text: value }] : []);
  if (!cites.length) return text(lead + body + trail);
  const match = /^([\s\S]*?)([.!?]?)$/.exec(body);
  const main = match?.[1] ?? body;
  const end = match?.[2] ?? "";
  const out: JSONNode[] = text(lead + (main ? `${main} ` : ""));
  cites.forEach((c, i) => {
    out.push(c.json);
    if (i < cites.length - 1) out.push({ type: "text", text: " " });
  });
  return [...out, ...text(end + trail)];
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
  const [proposal, setProposal] = useState<{ span: Span; mode: RewriteMode } | null>(null);
  const [stale, setStale] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const rewrite = useMutation({
    mutationFn: ({ span: s, mode }: { span: Span; mode: RewriteMode }) => api.post<{ text: string; model: string }>("/ai/rewrite", { text: s.text, mode }),
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
    if (span.text.length > MAX_REWRITE) {
      window.alert("Select a shorter passage (up to about 1,200 words) to rewrite it.");
      return;
    }
    setStale(false);
    setProposal({ span, mode });
    rewrite.mutate({ span, mode });
  };

  const discard = () => {
    setProposal(null);
    rewrite.reset();
    editor.commands.focus();
  };

  const replace = () => {
    if (!proposal || !rewrite.data) return;
    const { from, to, text } = proposal.span;
    if (to > editor.state.doc.content.size || textOf(editor, from, to) !== text) {
      setStale(true);
      return;
    }
    const cites: Array<{ label: string; json: JSONNode }> = [];
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.type.name === "citation") cites.push({ label: String(node.attrs.label ?? ""), json: node.toJSON() as JSONNode });
    });
    const content = withCitations(text, rewrite.data.text, cites);
    if (content.length) editor.chain().focus().insertContentAt({ from, to }, content).run();
    setProposal(null);
    rewrite.reset();
  };

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
      {proposal && (
        <div role="dialog" aria-label={proposal.mode === "concise" ? "Shorter version" : "Rewritten version"} className="w-[min(36rem,calc(100vw-24px))] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl">
          {rewrite.isPending && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {proposal.mode === "concise" ? "Shortening" : "Rewriting"}…</p>}
          {rewrite.error && <AIError error={rewrite.error} />}
          {rewrite.data && (
            <>
              <p className="max-h-60 overflow-y-auto whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-slate-900">{rewrite.data.text}</p>
              <p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><Bot className="h-3.5 w-3.5" aria-hidden /> {rewrite.data.model} · instructed not to add facts or citations. Any citations in the passage are kept. Review before keeping it.</p>
              {stale && <p role="alert" className="mt-2 text-xs text-red-700">The original passage has changed, so it was not replaced. Select it again to rewrite it.</p>}
            </>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={discard} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"><X className="h-3.5 w-3.5" aria-hidden /> {rewrite.data ? "Discard" : "Cancel"}</button>
            {rewrite.data && !stale && (
              <button type="button" onClick={replace} className="flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"><Check className="h-3.5 w-3.5" aria-hidden /> Replace</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
