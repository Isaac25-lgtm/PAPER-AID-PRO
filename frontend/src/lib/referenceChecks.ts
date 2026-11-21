import { CheckCircle2, HelpCircle, ShieldAlert, XCircle } from "lucide-react";

import type { VerifyResult } from "./types";

/** How each reference-checker verdict is shown. */
export const VERDICT = {
  verified: { label: "Verified", tone: "green", Icon: CheckCircle2 },
  registered: { label: "DOI is registered", tone: "green", Icon: CheckCircle2 },
  likely_match: { label: "Likely match — check details", tone: "amber", Icon: HelpCircle },
  mismatch: { label: "Details don't match", tone: "red", Icon: ShieldAlert },
  not_found: { label: "Not found", tone: "red", Icon: XCircle },
  error: { label: "Could not check", tone: "slate", Icon: HelpCircle },
} as const;

/** Server limits (backend/app/services/citations/verify.py), checked here first so the message can be specific. */
export const MAX_REFERENCE_CHARS = 1500;
export const MAX_TOTAL_CHARS = 40_000;

export function splitReferences(input: string): string[] {
  return input.split(/\n\s*\n|\n(?=\s*\[?\d+[.\]]\s)/).map((r) => r.trim()).filter((r) => r.length >= 12).slice(0, 50);
}

export function referenceProblem(references: string[]): string | null {
  const long = references.findIndex((r) => r.length > MAX_REFERENCE_CHARS);
  if (long >= 0) return `Reference ${long + 1} is longer than ${MAX_REFERENCE_CHARS.toLocaleString("en")} characters. Separate references with a blank line.`;
  if (references.reduce((total, r) => total + r.length, 0) > MAX_TOTAL_CHARS) return `The list is longer than ${MAX_TOTAL_CHARS.toLocaleString("en")} characters. Check it in parts.`;
  return null;
}

/** The badge names the actual problem: a DOI that leads elsewhere is different from a wrong year or author. */
export function verdictLabel(result: VerifyResult): string {
  const fields = result.checks?.fields ?? {};
  if (result.verdict === "mismatch" && result.via_doi && fields.title && fields.title !== "matched" && fields.title !== "not checked") return "DOI points to a different work";
  if (result.verdict === "mismatch") {
    const wrong = Object.entries(fields).filter(([, state]) => state === "does not match").map(([name]) => name.replace("_", " "));
    if (wrong.length) return `Wrong ${wrong.join(" and ")}`;
  }
  return VERDICT[result.verdict].label;
}

