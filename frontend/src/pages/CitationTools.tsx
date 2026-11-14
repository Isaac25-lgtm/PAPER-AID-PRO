import { useMutation } from "@tanstack/react-query";
import { Check, CheckCircle2, Copy, HelpCircle, ShieldAlert, XCircle } from "lucide-react";
import { useState } from "react";

import { SectionGuide } from "@/components/Guidance";
import { Container } from "@/components/Layout";
import { StyleOptions, useStyles } from "@/components/papers";
import { Alert, Badge, Button, Card, PageHeader, Select, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { sanitizeHtml } from "@/lib/format";
import type { FormattedEntry, VerifyResult } from "@/lib/types";

/** Identifiers per request: the API allows 20 for visitors and 50 for signed-in accounts. */
export const IDENTIFIER_LIMIT = { anonymous: 20, signedIn: 50 } as const;

function Generator() {
  const styles = useStyles();
  const { user } = useAuth();
  const [input, setInput] = useState("");
  const [style, setStyle] = useState("apa");
  const [copied, setCopied] = useState(false);
  const identifiers = input.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const limit = user ? IDENTIFIER_LIMIT.signedIn : IDENTIFIER_LIMIT.anonymous;
  const overLimit = identifiers.length > limit;
  const format = useMutation({
    mutationFn: () =>
      api.post<{ entries: FormattedEntry[]; unresolved: string[] }>("/citations/format", {
        identifiers,
        style,
        output: "html",
      }),
  });
  const copyAll = async () => {
    const text = (format.data?.entries ?? []).map((e) => new DOMParser().parseFromString(e.bibliography, "text/html").body.textContent).join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900">Citation generator</h2>
      <p className="mb-3 text-sm text-slate-600">Paste DOIs, PubMed IDs or arXiv IDs (one per line). Metadata comes from the official registries.</p>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); format.mutate(); }}>
        <Textarea rows={5} value={input} onChange={(e) => setInput(e.target.value)} placeholder={"10.1038/nature14539\nPMID: 31978945\narXiv:1706.03762"} aria-label="Identifiers" />
        <div className="flex gap-2">
          <Select className="flex-1" value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Citation style">
            <StyleOptions styles={styles.data} />
          </Select>
          <Button type="submit" loading={format.isPending} disabled={!identifiers.length || overLimit}>Format</Button>
        </div>
        <p className={overLimit ? "text-sm font-medium text-red-700" : "text-xs text-slate-500"} aria-live="polite">
          {identifiers.length} of {limit} identifiers
          {overLimit && (user ? " — remove some lines to continue." : " — sign in to format up to 50 at once, or remove some lines.")}
        </p>
      </form>
      {format.error && <div className="mt-3"><Alert kind="error">{errorMessage(format.error)}</Alert></div>}
      {format.data && (
        <div className="mt-4 space-y-3">
          {format.data.unresolved.length > 0 && <Alert kind="warning" title="Not found in any registry">{format.data.unresolved.join(", ")}</Alert>}
          {format.data.entries.length > 0 && (
            <>
              <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={() => void copyAll()}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy references</Button></div>
              <ol className="space-y-3">
                {format.data.entries.map((entry, i) => (
                  <li key={i} className="rounded-lg bg-slate-50 p-3">
                    <div className="font-serif text-sm" dangerouslySetInnerHTML={{ __html: sanitizeHtml(entry.bibliography) }} />
                    <p className="mt-1 text-xs text-slate-500">In-text: <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(entry.in_text) }} /></p>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

const VERDICT = {
  verified: { label: "Verified", tone: "green", Icon: CheckCircle2 },
  likely_match: { label: "Likely match — check details", tone: "amber", Icon: HelpCircle },
  mismatch: { label: "DOI points to a different work", tone: "red", Icon: ShieldAlert },
  not_found: { label: "Not found", tone: "red", Icon: XCircle },
  error: { label: "Could not check", tone: "slate", Icon: HelpCircle },
} as const;

function Verifier() {
  const [input, setInput] = useState("");
  const verify = useMutation({
    mutationFn: () => api.post<{ results: VerifyResult[] }>("/citations/verify", { references: input.split(/\n\s*\n|\n(?=\s*\[?\d+[.\]]\s)/).map((r) => r.trim()).filter((r) => r.length >= 12).slice(0, 50) }),
  });
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900">Reference checker</h2>
      <p className="mb-3 text-sm text-slate-600">Paste a reference list (separate references with a blank line). Each one is checked against Crossref for title, first author and year — useful for catching fabricated or mistyped references.</p>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); verify.mutate(); }}>
        <Textarea rows={8} value={input} onChange={(e) => setInput(e.target.value)} aria-label="References" placeholder={"LeCun Y, Bengio Y, Hinton G. Deep learning. Nature. 2015;521:436-444.\n\nVaswani A, et al. Attention is all you need. 2017."} />
        <Button type="submit" loading={verify.isPending} disabled={!input.trim()}>Check references</Button>
      </form>
      {verify.error && <div className="mt-3"><Alert kind="error">{errorMessage(verify.error)}</Alert></div>}
      {verify.data && (
        <ul className="mt-4 space-y-3">
          {verify.data.results.map((r, i) => {
            const v = VERDICT[r.verdict];
            return (
              <li key={i} className="rounded-lg border border-slate-200 p-3 text-sm">
                <Badge tone={v.tone}><v.Icon className="h-3 w-3" /> {v.label}</Badge>
                <p className="mt-2 text-slate-800">{r.reference}</p>
                <p className="mt-1 text-slate-600">{r.explanation}</p>
                {r.match && (
                  <p className="mt-1 text-xs text-slate-500">
                    Closest record: <span className="italic">{r.match.title}</span> ({r.match.year ?? "n.d."}){r.match.doi ? ` · doi:${r.match.doi}` : ""}
                    {r.checks && ` · title match ${Math.round(r.checks.title_similarity * 100)}%`}
                  </p>
                )}
                {r.checks?.fields && (
                  <p className="mt-1 text-xs text-slate-500">
                    {Object.entries(r.checks.fields).map(([field, state]) => `${field.replace("_", " ")}: ${state}`).join(" · ")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default function CitationToolsPage() {
  return (
    <Container>
      <PageHeader title="Citation tools" subtitle="Format references in 18 styles across disciplines and check reference lists against Crossref. No sign-in required." />
      <SectionGuide section="citations" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Generator />
        <Verifier />
      </div>
    </Container>
  );
}
