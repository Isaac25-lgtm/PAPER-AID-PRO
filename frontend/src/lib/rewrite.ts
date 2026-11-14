import type { Editor } from "@tiptap/react";

/*
 * One path for applying AI rewrites (selection menu and toolbar). Citations in the passage are sent as numbered
 * placeholders ([[C1]], [[C2]], ...) that the model is told to keep with the claims they support. A proposal is
 * applied only if every placeholder comes back exactly once and in the original order, so a citation can never move
 * to a different claim or disappear, and only if the passage has not changed since it was sent.
 */

type JSONNode = Record<string, unknown>;

export interface RewriteInput {
  from: number;
  to: number;
  /** Text sent to the model, with citation placeholders. */
  text: string;
  citations: JSONNode[];
  /** Bold, italics or links in the passage (not carried into the rewrite). */
  hasFormatting: boolean;
}

export type RewriteProblem = "empty" | "multiple-paragraphs";

const TOKEN = /\[\[C(\d+)\]\]/g;

export function buildRewriteInput(editor: Editor, from: number, to: number): RewriteInput | RewriteProblem {
  const doc = editor.state.doc;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  if (!$from.sameParent($to)) return "multiple-paragraphs";
  let text = "";
  const citations: JSONNode[] = [];
  let hasFormatting = false;
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) {
      const start = Math.max(from, pos) - pos;
      const end = Math.min(to, pos + node.nodeSize) - pos;
      text += (node.text ?? "").slice(start, end);
      if (node.marks.length) hasFormatting = true;
    } else if (node.type.name === "citation") {
      citations.push(node.toJSON() as JSONNode);
      text += `[[C${citations.length}]]`;
    }
    return true;
  });
  if (!text.replace(TOKEN, "").trim()) return "empty";
  return { from, to, text, citations, hasFormatting };
}

/** Whether the passage still reads exactly as it did when it was sent (otherwise a proposal must not be applied). */
export function isUnchanged(editor: Editor, input: RewriteInput): boolean {
  if (input.to > editor.state.doc.content.size) return false;
  const now = buildRewriteInput(editor, input.from, input.to);
  return typeof now !== "string" && now.text === input.text;
}

/**
 * Replacement content for a proposal, or an explanation of why it cannot be applied safely.
 * Leading and trailing spaces of the original passage are preserved.
 */
export function rewriteContent(input: RewriteInput, proposal: string): { content: JSONNode[] } | { error: string } {
  const found = Array.from(proposal.matchAll(TOKEN), (m) => Number(m[1]));
  const expected = input.citations.map((_, i) => i + 1);
  if (found.length !== expected.length || found.some((n, i) => n !== expected[i])) {
    return {
      error:
        expected.length === 0
          ? "The rewrite added citation markers that were not in your text, so it was not applied."
          : "The rewrite moved, dropped or repeated a citation, so it was not applied. Try a shorter passage.",
    };
  }
  const lead = /^\s/.test(input.text) ? " " : "";
  const trail = /\s$/.test(input.text) ? " " : "";
  const body = proposal.trim();
  const content: JSONNode[] = [];
  let last = 0;
  for (const match of body.matchAll(TOKEN)) {
    const before = body.slice(last, match.index);
    if (before) content.push({ type: "text", text: before });
    content.push(input.citations[Number(match[1]) - 1]!);
    last = (match.index ?? 0) + match[0].length;
  }
  if (body.slice(last)) content.push({ type: "text", text: body.slice(last) });
  if (lead) {
    const first = content[0];
    if (first?.type === "text") first.text = lead + String(first.text);
    else content.unshift({ type: "text", text: lead });
  }
  if (trail) {
    const end = content[content.length - 1];
    if (end?.type === "text") end.text = String(end.text) + trail;
    else content.push({ type: "text", text: trail });
  }
  return { content };
}

/** Apply a proposal in one transaction. Returns an error message instead of changing anything when unsafe. */
export function applyRewrite(editor: Editor, input: RewriteInput, proposal: string): string | null {
  if (!isUnchanged(editor, input)) return "The passage has changed since it was sent, so it was not replaced. Select it again to rewrite it.";
  const result = rewriteContent(input, proposal);
  if ("error" in result) return result.error;
  editor.chain().focus().insertContentAt({ from: input.from, to: input.to }, result.content).run();
  return null;
}

export const REWRITE_PROBLEMS: Record<RewriteProblem, string> = {
  empty: "Select some words to rewrite.",
  "multiple-paragraphs": "Select text within one paragraph to rewrite it.",
};
