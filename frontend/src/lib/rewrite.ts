import type { Editor } from "@tiptap/react";

import { api } from "./api";

/*
 * One path for AI rewrites (selection menu and toolbar). The passage is split at its citations: each piece of text
 * is rewritten on its own and its citations stay attached right after it, exactly as before. The model never sees
 * or moves a citation, so a citation cannot end up beside a different claim or disappear. A proposal is applied
 * only if the passage, including the identity of every citation in it, is unchanged since it was sent.
 */

type JSONNode = Record<string, unknown>;

export interface RewriteSegment {
  lead: string;
  /** The words to rewrite (trimmed). */
  core: string;
  trail: string;
  /** Citations that directly follow this text, kept in place. */
  citations: JSONNode[];
  /** Whether this piece has words worth rewriting (not just punctuation between citations). */
  rewrite: boolean;
}

export interface RewriteInput {
  from: number;
  to: number;
  segments: RewriteSegment[];
  /** Exact text and citation identities, used to detect any change before applying. */
  signature: string;
  /** Bold, italics or links in the passage (not carried into the rewrite). */
  hasFormatting: boolean;
}

export interface RewriteProposal {
  /** Rewritten text per segment (null where the segment is kept as is). */
  texts: (string | null)[];
  model: string;
}

export type RewriteProblem = "empty" | "multiple-paragraphs" | "too-many-citations";

/** At most this many pieces of text are rewritten per request (one AI call each). */
export const MAX_REWRITE_SEGMENTS = 6;

const WORDS = /\p{L}/u;

function signatureOf(segments: RewriteSegment[]): string {
  return JSON.stringify(
    segments.map((s) => [s.lead, s.core, s.trail, s.citations.map((c) => (c.attrs as { citationIds?: string[] } | undefined)?.citationIds ?? [])]),
  );
}

export function buildRewriteInput(editor: Editor, from: number, to: number): RewriteInput | RewriteProblem {
  const doc = editor.state.doc;
  if (!doc.resolve(from).sameParent(doc.resolve(to))) return "multiple-paragraphs";
  const raw: { text: string; citations: JSONNode[] }[] = [{ text: "", citations: [] }];
  let hasFormatting = false;
  doc.nodesBetween(from, to, (node, pos) => {
    const current = raw[raw.length - 1]!;
    if (node.isText) {
      const start = Math.max(from, pos) - pos;
      const end = Math.min(to, pos + node.nodeSize) - pos;
      const piece = (node.text ?? "").slice(start, end);
      if (current.citations.length) raw.push({ text: piece, citations: [] });
      else current.text += piece;
      if (node.marks.length) hasFormatting = true;
    } else if (node.type.name === "citation") {
      current.citations.push(node.toJSON() as JSONNode);
    }
    return true;
  });
  const segments = raw
    .filter((r) => r.text || r.citations.length)
    .map((r) => {
      // Punctuation right after a citation (". ", ", ") closes the previous claim: kept as it is, not rewritten.
      const lead = /^[\s.,;:!?)\]]*/.exec(r.text)![0];
      const trail = r.text.slice(lead.length).match(/\s*$/)![0];
      const core = r.text.slice(lead.length, r.text.length - trail.length);
      return { lead, core, trail, citations: r.citations, rewrite: WORDS.test(core) };
    });
  const rewritable = segments.filter((s) => s.rewrite).length;
  if (!rewritable) return "empty";
  if (rewritable > MAX_REWRITE_SEGMENTS) return "too-many-citations";
  return { from, to, segments, signature: signatureOf(segments), hasFormatting };
}

/** Ask the AI to rewrite each piece separately (citations are never sent). */
export async function requestRewrite(input: RewriteInput, mode: string): Promise<RewriteProposal> {
  let model = "";
  const texts = await Promise.all(
    input.segments.map(async (segment) => {
      if (!segment.rewrite) return null;
      const result = await api.post<{ text: string; model: string }>("/ai/rewrite", { text: segment.core, mode });
      model = result.model;
      return fitToSegment(segment, result.text);
    }),
  );
  return { texts, model };
}

/** Keep a rewritten piece shaped like the original: no sentence-ending stop added before a citation. */
export function fitToSegment(segment: RewriteSegment, rewritten: string): string {
  let text = rewritten.trim();
  if (!/[.!?;:,]$/.test(segment.core)) text = text.replace(/[.!?]+$/, "");
  return text || segment.core;
}

function labelOf(citation: JSONNode): string {
  return String((citation.attrs as { label?: string } | undefined)?.label ?? "[citation]");
}

/** The proposal as readable text, citations shown as their labels, for the writer to review. */
export function proposalText(input: RewriteInput, proposal: RewriteProposal): string {
  return input.segments
    .map((s, i) => `${s.lead}${proposal.texts[i] ?? s.core}${s.trail}${s.citations.map(labelOf).join("")}`)
    .join("");
}

/** The passage as sent (readable). */
export function inputText(input: RewriteInput): string {
  return input.segments.map((s) => `${s.lead}${s.core}${s.trail}${s.citations.map(labelOf).join("")}`).join("");
}

/** Whether the passage, including the identity of each citation, still reads exactly as when it was sent. */
export function isUnchanged(editor: Editor, input: RewriteInput): boolean {
  if (input.to > editor.state.doc.content.size) return false;
  const now = buildRewriteInput(editor, input.from, input.to);
  return typeof now !== "string" && now.signature === input.signature;
}

/** Replacement content: each segment's (rewritten) text followed by its original citation nodes. */
export function rewriteContent(input: RewriteInput, proposal: RewriteProposal): JSONNode[] {
  const content: JSONNode[] = [];
  input.segments.forEach((segment, i) => {
    const text = `${segment.lead}${proposal.texts[i] ?? segment.core}${segment.trail}`;
    if (text) content.push({ type: "text", text });
    content.push(...segment.citations);
  });
  return content;
}

/** Apply a proposal in one transaction. Returns an error message instead of changing anything when unsafe. */
export function applyRewrite(editor: Editor, input: RewriteInput, proposal: RewriteProposal): string | null {
  if (!isUnchanged(editor, input)) return "The passage or one of its citations changed since it was sent, so it was not replaced. Select it again to rewrite it.";
  editor.chain().focus().insertContentAt({ from: input.from, to: input.to }, rewriteContent(input, proposal)).run();
  return null;
}

export const REWRITE_PROBLEMS: Record<RewriteProblem, string> = {
  empty: "Select some words to rewrite.",
  "multiple-paragraphs": "Select text within one paragraph to rewrite it.",
  "too-many-citations": `Select a shorter passage (up to ${MAX_REWRITE_SEGMENTS} cited claims) to rewrite it.`,
};
