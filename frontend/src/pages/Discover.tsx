import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2, RotateCw, Sparkles, Unlock, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { AIError, GroundedAnswerView } from "@/components/GroundedAnswerView";
import { SectionGuide } from "@/components/Guidance";
import { Container } from "@/components/Layout";
import { PaperMeta } from "@/components/papers";
import { Alert, Select, Badge, Button, Card, EmptyState, Input, PageHeader, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAIEnabled } from "@/lib/ai";
import { useAuth } from "@/lib/auth";
import { useSearchStream, type DatabaseState } from "@/lib/searchStream";
import type { GroundedAnswer, Paper, Work, Subject } from "@/lib/types";
import { PROVIDER_LABELS, SUBJECTS } from "@/lib/types";

function WorkCard({ work }: { work: Work }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const importMutation = useMutation({
    mutationFn: () => api.post<Paper>("/papers/import", { identifier: work.identifier, add_to_library: true }),
    onSuccess: (paper) => navigate(`/papers/${paper.id}`),
  });
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap gap-2">
        {work.is_open_access && <Badge tone="green"><Unlock className="h-3 w-3" /> Open access</Badge>}
        {work.citation_count > 0 && <Badge>{work.citation_count.toLocaleString()} citations</Badge>}
        <span className="text-xs text-slate-500">via {work.sources.map((s) => PROVIDER_LABELS[s] ?? s).join(", ")}</span>
      </div>
      <h3 className="mt-2 font-serif text-lg font-semibold leading-snug text-slate-900">{work.title}</h3>
      <PaperMeta paper={work} />
      {work.abstract && <p className="mt-2 line-clamp-3 text-sm text-slate-700">{work.abstract}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {work.library_paper_id ? (
          <Link to={`/papers/${work.library_paper_id}`} className="text-sm font-medium text-brand-700">Open in PaperAid →</Link>
        ) : work.identifier && user ? (
          <Button size="sm" loading={importMutation.isPending} onClick={() => importMutation.mutate()}>Save to library</Button>
        ) : work.identifier ? (
          <Link to="/login" className="text-sm font-medium text-brand-700">Sign in to save</Link>
        ) : null}
        {work.doi && (
          <a href={`https://doi.org/${work.doi}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
            Publisher <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {importMutation.error && <span className="text-sm text-red-700">{errorMessage(importMutation.error)}</span>}
      </div>
    </article>
  );
}

function ResearchOverview({ query, works }: { query: string; works: Work[] }) {
  const { user } = useAuth();
  const ai = useAIEnabled();
  const identifiers = works.filter((w) => w.abstract && w.identifier).slice(0, 8).map((w) => w.identifier!);
  const mutation = useMutation({
    mutationFn: () => api.post<GroundedAnswer>("/discovery/snapshot", { query, identifiers }),
  });
  if (!user || !ai.enabled || identifiers.length < 2) return null; // no AI: no button that can only fail
  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Sparkles className="h-4 w-4 text-brand-700" /> Research overview</h2>
          <p className="text-sm text-slate-600">An AI summary of the top results, written only from their abstracts, with every claim linked.</p>
        </div>
        {!mutation.data && <Button size="sm" variant="secondary" loading={mutation.isPending} onClick={() => mutation.mutate()}>Generate overview</Button>}
      </div>
      {mutation.error && <div className="mt-4"><AIError error={mutation.error} /></div>}
      {mutation.data && <div className="mt-4"><GroundedAnswerView answer={mutation.data} /></div>}
    </Card>
  );
}

const IDENTIFIER_LABEL: Record<string, string> = { doi: "DOI", pmid: "PubMed ID", pmcid: "PubMed Central ID", arxiv: "arXiv ID" };

function DatabaseChip({ database }: { database: DatabaseState }) {
  const label = PROVIDER_LABELS[database.provider] ?? database.provider;
  if (database.state === "searching") {
    return (
      <span role="listitem" className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-slate-600">
        <Loader2 className="h-3 w-3 animate-spin" /> {label}: searching…
      </span>
    );
  }
  const ok = database.state === "done";
  return (
    <span role="listitem" className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`} title={database.error ?? undefined}>
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}: {ok ? `${database.count} results` : "unavailable"}
    </span>
  );
}

export default function DiscoverPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const yearFrom = params.get("year_from") ?? "";
  const oaOnly = params.get("oa") === "1";
  const subject = (params.get("subject") ?? "all") as Subject;
  const exact = params.get("exact") === "1";
  const [draft, setDraft] = useState(q);
  const [from, setFrom] = useState(yearFrom);

  const search = useSearchStream(q.length >= 2 ? { q, subject, yearFrom, openAccessOnly: oaOnly, exact } : null);
  const setQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  };
  const anyFailed = search.databases.some((d) => d.state === "failed");

  return (
    <Container>
      <PageHeader title="Discover literature" subtitle="One search across major scholarly databases in every field, with duplicates merged." />
      <SectionGuide section="discover" />
      <form
        className="mb-6 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const next: Record<string, string> = { q: draft.trim() }; // a new search may be corrected again
          if (from) next.year_from = from;
          if (oaOnly) next.oa = "1";
          if (subject !== "all") next.subject = subject;
          setParams(next);
        }}
      >
        <Input className="min-w-64 flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Topic, title, or keywords" aria-label="Search query" minLength={2} required />
        <Select
          className="w-full sm:w-64"
          value={subject}
          aria-label="Subject"
          onChange={(e) => {
            const next = new URLSearchParams(params);
            if (e.target.value === "all") next.delete("subject");
            else next.set("subject", e.target.value);
            setParams(next);
          }}
        >
          {SUBJECTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
        <Input className="w-32" type="number" min={1800} max={2100} placeholder="From year" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From year" />
        <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm">
          <input
            type="checkbox"
            checked={oaOnly}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.checked) next.set("oa", "1");
              else next.delete("oa");
              setParams(next);
            }}
          />
          Open access only
        </label>
        <Button type="submit">Search</Button>
      </form>

      {!q && <EmptyState title="Start with a topic" icon={<Sparkles className="h-8 w-8" />}>Choose a subject to focus the search. Results come from OpenAlex, Crossref and the Directory of Open Access Journals, plus PubMed and Europe PMC for health and life sciences.</EmptyState>}
      {search.error ? <Alert kind="error">{errorMessage(search.error)}</Alert> : null}
      {q.length >= 2 && (
        <>
          {search.identifier ? (
            <p className="mb-4 text-sm text-slate-700" role="status">
              Looked up {IDENTIFIER_LABEL[search.identifier] ?? "the identifier"} <strong className="font-semibold text-slate-950">{q}</strong> exactly.
            </p>
          ) : (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs" aria-label="Databases" role="list">
              {search.databases.map((d) => <DatabaseChip key={d.provider} database={d} />)}
              {search.done && anyFailed && (
                <button type="button" onClick={search.retry} className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-100">
                  <RotateCw className="h-3 w-3" /> Retry unavailable
                </button>
              )}
            </div>
          )}
          {search.correctedFrom && (
            <p className="mb-4 text-sm text-slate-700" role="status">
              Showing results for <strong className="font-semibold text-slate-950">{search.query}</strong>.{" "}
              <button type="button" className="text-brand-700 underline underline-offset-2" onClick={() => setQuery({ exact: "1" })}>
                Search instead for “{search.correctedFrom}”
              </button>
            </p>
          )}
          {exact && !search.identifier && (
            <p className="mb-4 text-sm text-slate-700" role="status">
              Searching exactly for <strong className="font-semibold text-slate-950">“{q}”</strong>.{" "}
              {search.suggestion ? (
                <button type="button" className="text-brand-700 underline underline-offset-2" onClick={() => { setDraft(search.suggestion ?? q); setQuery({ q: search.suggestion, exact: null }); }}>
                  Did you mean “{search.suggestion}”?
                </button>
              ) : (
                <button type="button" className="text-brand-700 underline underline-offset-2" onClick={() => setQuery({ exact: null })}>
                  Allow spelling correction
                </button>
              )}
            </p>
          )}
          {search.done && <ResearchOverview query={search.query} works={search.results} />}
          {search.results.length > 0 && (
            <div className="space-y-4">
              {search.results.map((work, index) => (
                <WorkCard key={work.identifier ?? `${work.title}-${index}`} work={work} />
              ))}
            </div>
          )}
          {search.searching && search.results.length === 0 && <Spinner label="Searching scholarly databases" />}
          {search.done && !search.error && search.results.length === 0 && (
            <EmptyState title="No results">
              {search.identifier ? "No registry has a record for this identifier. Check it, or search for the title instead." : "Try broader keywords or remove the filters."}
            </EmptyState>
          )}
        </>
      )}
    </Container>
  );
}
