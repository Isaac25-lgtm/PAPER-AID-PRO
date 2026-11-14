import { Bot, FileText, Info } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { ApiError } from "@/lib/api";
import type { AnswerCitation, GroundedAnswer } from "@/lib/types";
import { Alert, Badge } from "./ui";

interface Selection {
  key: string;
  claim: number;
}

/**
 * Number each statement's markers: the answer is assembled one statement at a time, each ending with its group of
 * markers ("[E1][E3]"), so the n-th group belongs to statement n. Markers become "[E1#n]" for rendering.
 */
export function numberClaims(text: string): string {
  let claim = -1;
  let previousEnd = -1;
  return text.replace(/\[(E\d+)\]/g, (_match, key: string, offset: number) => {
    if (offset !== previousEnd) claim += 1; // a new group of markers starts a new statement
    previousEnd = offset + key.length + 2;
    return `[${key}#${claim}]`;
  });
}

/** Renders model text where citations appear as [E1#n] markers, turning each into a link to its source excerpt. */
function renderInline(text: string, byKey: Map<string, AnswerCitation>, onSelect: (selection: Selection) => void): ReactNode[] {
  const parts = text.split(/(\[E\d+#\d+\]|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    const marker = /^\[(E\d+)#(\d+)\]$/.exec(part);
    if (marker) {
      const key = marker[1]!;
      const claim = Number(marker[2]);
      const cite = byKey.get(key);
      const n = cite ? Array.from(byKey.keys()).indexOf(key) + 1 : "?";
      return (
        <button
          key={index}
          type="button"
          onClick={() => onSelect({ key, claim })}
          className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-brand-100 px-1 align-baseline text-[11px] font-semibold text-brand-800 hover:bg-brand-200"
          title={cite ? `${cite.title} (${cite.year ?? "n.d."})` : "Source"}
        >
          {n}
        </button>
      );
    }
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    if (bold) return <strong key={index}>{bold[1]}</strong>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export function AnswerText({ text, citations }: { text: string; citations: AnswerCitation[] }) {
  const [active, setActive] = useState<Selection | null>(null);
  const byKey = new Map(citations.map((c) => [c.key, c]));
  const paragraphs = numberClaims(text).split(/\n{2,}/);
  return (
    <div>
      <div className="space-y-3 font-serif text-[15px] leading-relaxed text-slate-800">
        {paragraphs.map((paragraph, index) =>
          paragraph.trim().startsWith("- ") ? (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {paragraph.split(/\n/).map((line, i) => (
                <li key={i}>{renderInline(line.replace(/^\s*-\s*/, ""), byKey, setActive)}</li>
              ))}
            </ul>
          ) : (
            <p key={index}>{renderInline(paragraph, byKey, setActive)}</p>
          ),
        )}
      </div>
      {citations.length > 0 && (
        <ol className="mt-5 space-y-2 border-t border-slate-200 pt-4">
          {citations.map((c, index) => (
            <li
              key={c.key}
              className={`rounded-lg border p-3 text-sm transition ${active?.key === c.key ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-brand-800">{index + 1}.</span>
                <Link to={`/papers/${c.paper_id}`} className="font-medium text-slate-900 hover:text-brand-700">
                  {c.title}
                </Link>
                <span className="text-slate-500">
                  {c.authors[0] ?? "Unknown"}
                  {c.authors.length > 1 ? " et al." : ""} ({c.year ?? "n.d."})
                </span>
                <Badge tone={c.kind === "passage" ? "green" : "slate"}>
                  <FileText className="h-3 w-3" />
                  {c.kind === "passage" ? `${c.section ?? "Full text"}${c.page_start ? `, p. ${c.page_start}` : ""}` : "Abstract"}
                </Badge>
              </div>
              <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 text-slate-600">
                <HighlightedExcerpt citation={c} activeClaim={active?.key === c.key ? active.claim : undefined} />
              </blockquote>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function GroundedAnswerView({ answer }: { answer: GroundedAnswer }) {
  return (
    <div className="space-y-3">
      {answer.insufficient_evidence && (
        <Alert kind="warning" title="The selected sources don’t fully answer this">
          {answer.gaps || "Try adding papers with full text, or rephrase the question."}
        </Alert>
      )}
      <AnswerText text={answer.answer} citations={answer.citations} />
      {!answer.insufficient_evidence && answer.gaps && (
        <p className="flex gap-2 text-sm text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0" /> Not covered by the sources: {answer.gaps}
        </p>
      )}
      {answer.model && (
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <Bot className="h-3.5 w-3.5" /> AI-generated by {answer.model} from the excerpts shown. Check the sources before relying on it.
        </p>
      )}
    </div>
  );
}

/** Consistent rendering of AI errors: unconfigured, refused, discarded-as-invalid, rate limited. */
export function AIError({ error }: { error: unknown }) {
  if (error instanceof ApiError) {
    if (error.code === "AI_NOT_ENABLED_FOR_ACCOUNT")
      return <Alert kind="info" title="AI features are not enabled for your account yet">They are being tested with a small group first. Everything else works normally.</Alert>;
    if (error.code === "AI_FEATURE_OFF") return <Alert kind="info" title="This AI feature is switched off">{error.message}</Alert>;
    if (error.code === "AI_NOT_CONFIGURED")
      return <Alert kind="info" title="AI features are not switched on yet">This deployment has no AI provider configured. Everything else works normally.</Alert>;
    if (error.code === "AI_OUTPUT_INVALID")
      return <Alert kind="warning" title="Answer withheld">The AI response failed our citation checks, so it was discarded rather than shown. Please try again.</Alert>;
    if (error.code === "AI_REFUSED") return <Alert kind="warning">{error.message}</Alert>;
    return <Alert kind="error">{error.message}</Alert>;
  }
  return <Alert kind="error">Something went wrong.</Alert>;
}


/** Code-point offsets (answers stored before offsets were UTF-16) converted to UTF-16 units. */
function toUtf16(text: string, codePoint: number): number {
  return Array.from(text).slice(0, codePoint).join("").length;
}

/**
 * The excerpt with the verified supporting words highlighted. Overlapping quotes are merged (no supporting word is
 * ever dropped); when a statement's marker was clicked, the words supporting THAT statement are emphasised.
 */
export function HighlightedExcerpt({ citation, activeClaim }: { citation: AnswerCitation; activeClaim?: number }) {
  const text = citation.excerpt;
  const legacy = citation.offset_unit !== "utf16";
  const spans = (citation.quotes ?? [])
    .map((q) => ({ start: legacy ? toUtf16(text, q.start) : q.start, end: legacy ? toUtf16(text, q.end) : q.end, claims: q.claims ?? [] }))
    .filter((q) => q.start >= 0 && q.end <= text.length && q.start < q.end);
  const points = Array.from(new Set([0, text.length, ...spans.flatMap((q) => [q.start, q.end])])).sort((a, b) => a - b);
  const parts: ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const covering = spans.filter((q) => q.start <= from && q.end >= to);
    const piece = text.slice(from, to);
    if (!covering.length) {
      parts.push(piece);
      continue;
    }
    const emphasised = activeClaim !== undefined && covering.some((q) => q.claims.includes(activeClaim));
    parts.push(
      <mark
        key={from}
        data-claim-match={emphasised ? "" : undefined}
        className={emphasised ? "rounded bg-brand-200 px-0.5 text-slate-950" : "rounded bg-amber-100 px-0.5 text-slate-900"}
        title="The words this statement relies on"
      >
        {piece}
      </mark>,
    );
  }
  return (
    <>
      “{citation.excerpt_truncated_start ? "…" : ""}
      {parts}
      {citation.excerpt_truncated_end ? "…" : ""}”
    </>
  );
}
