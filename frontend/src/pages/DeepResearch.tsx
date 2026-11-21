import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, CircleDashed, ExternalLink, Globe, Plus, Search, Trash2, Unlock, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { AIError, GroundedAnswerView } from "@/components/GroundedAnswerView";
import { Container } from "@/components/Layout";
import { ResearchModes } from "@/components/ResearchModes";
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { safeHref } from "@/lib/format";
import { relativeTime } from "@/lib/format";
import type { DeepResearchRun, DeepResearchService, DeepResearchSource, DeepResearchStatus, DeepResearchSummary, Paper, Subject } from "@/lib/types";
import { PROVIDER_LABELS, SUBJECTS } from "@/lib/types";

const STEPS = [
  "Planning the searches",
  "Searching the scholarly databases and the web",
  "Merging and ranking what was found",
  "Reading the best sources",
  "Writing the report and checking every sentence against its source",
];

export default function DeepResearchPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const runId = params.get("r");
  const [question, setQuestion] = useState("");
  const [subject, setSubject] = useState<Subject>("all");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [includeWeb, setIncludeWeb] = useState(false); // the person turns the web on; never by default

  const status = useQuery({ queryKey: ["deep-research-status"], queryFn: () => api.get<DeepResearchStatus>("/research/deep/status") });
  const webConnected = status.isSuccess && Boolean(status.data?.web_search);
  /** What the checkbox shows is exactly what is sent: off while the status is loading or failed (audit F01). */
  const webChosen = webConnected && includeWeb;
  const yearsSet = Boolean(yearFrom || yearTo);
  const history = useQuery({ queryKey: ["deep-research"], queryFn: () => api.get<DeepResearchSummary[]>("/research/deep") });
  const run = useQuery({
    queryKey: ["deep-research", runId],
    queryFn: () => api.get<DeepResearchRun>(`/research/deep/${runId}`),
    enabled: Boolean(runId),
  });

  // A run finishing after the person opened another report must not pull them away from it.
  const current = useRef(runId);
  current.current = runId;
  const start = useMutation({
    mutationFn: async () => {
      const origin = current.current;
      const result = await api.post<DeepResearchRun>("/research/deep", {
        question: question.trim(),
        subject,
        year_from: yearFrom ? Number(yearFrom) : null,
        year_to: yearTo ? Number(yearTo) : null,
        include_web: webChosen,
      });
      return { result, origin };
    },
    onSuccess: ({ result, origin }) => {
      queryClient.setQueryData(["deep-research", result.id], result);
      void queryClient.invalidateQueries({ queryKey: ["deep-research"], exact: true });
      if (current.current !== origin) return;
      setQuestion("");
      setParams({ r: result.id });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/research/deep/${id}`),
    onSuccess: (_, id) => {
      if (id === runId) setParams({});
      void queryClient.invalidateQueries({ queryKey: ["deep-research"], exact: true });
    },
  });

  const canRun = question.trim().length >= 10 && !start.isPending;

  return (
    <Container>
      <PageHeader
        title="Deep research"
        subtitle="Ask a research question. PaperAid searches the scholarly databases and the web, reads the most relevant sources and writes a report in which every sentence links to its source."
      />
      <ResearchModes />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside>
          <Button size="sm" variant="secondary" className="mb-3 w-full" onClick={() => setParams({})}>
            <Plus className="h-4 w-4" /> New deep research
          </Button>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Your reports</p>
          {history.error && <Alert kind="error">Could not load your reports. <button className="underline" onClick={() => void history.refetch()}>Retry</button></Alert>}
          {history.data?.length === 0 && <p className="text-sm text-slate-500">No reports yet.</p>}
          <ul className="space-y-1">
            {history.data?.map((h) => (
              <li key={h.id} className="group flex items-center">
                <button onClick={() => setParams({ r: h.id })} className={`flex-1 rounded-lg px-2 py-1.5 text-left text-sm ${runId === h.id ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-100"}`}>
                  <span className="line-clamp-2">{h.question}</span>
                  <span className="text-xs text-slate-500">{relativeTime(h.created_at)} · {h.source_count} sources</span>
                </button>
                <button className="p-1 text-slate-500 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" aria-label="Delete report" onClick={() => remove.mutate(h.id)}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="min-w-0 space-y-4">
          {status.data && <Connections status={status.data} />}

          {runId ? (
            <>
              {run.isLoading && <Spinner />}
              {run.error && <Alert kind="error">{errorMessage(run.error)}</Alert>}
              {run.data && <RunView run={run.data} />}
            </>
          ) : (
            <Card className="p-4">
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canRun) start.mutate();
                }}
              >
                <label htmlFor="deep-question" className="block text-sm font-semibold text-slate-900">Your research question</label>
                <Textarea id="deep-question" rows={4} maxLength={2000} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. What is known about school-based malaria prevention in sub-Saharan Africa, and where do the studies disagree?" />
                <div className="grid gap-3 sm:grid-cols-[1fr_110px_110px]">
                  <Select aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value as Subject)}>
                    {SUBJECTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </Select>
                  <Input aria-label="From year" type="number" min={1500} max={2100} placeholder="From year" value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} />
                  <Input aria-label="To year" type="number" min={1500} max={2100} placeholder="To year" value={yearTo} onChange={(e) => setYearTo(e.target.value)} />
                </div>
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" className="mt-1" checked={webChosen} disabled={!webConnected} onChange={(e) => setIncludeWeb(e.target.checked)} />
                  <span>
                    Also search the general web (reports, guidelines, news)
                    {!webConnected && <span className="block text-xs text-slate-500">Web search is not connected yet, so only the scholarly databases are searched.</span>}
                    {webChosen && yearsSet && <span className="block text-xs text-slate-500">With years set, web pages outside them, or without a date, are left out.</span>}
                  </span>
                </label>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">Usually takes one to two minutes.</span>
                  <Button type="submit" loading={start.isPending} disabled={!canRun}><Search className="h-4 w-4" /> Run deep research</Button>
                </div>
              </form>
              {start.isPending && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3" role="status">
                  <p className="mb-2 text-sm font-medium text-slate-900">Researching. Keep this page open.</p>
                  <ol className="space-y-1 text-sm text-slate-600">
                    {STEPS.map((step) => <li key={step} className="flex items-center gap-2"><CircleDashed className="h-3.5 w-3.5 shrink-0" /> {step}</li>)}
                  </ol>
                </div>
              )}
              {start.error && <div className="mt-3"><AIError error={start.error} /></div>}
            </Card>
          )}

          {!runId && !start.isPending && (
            <EmptyState icon={<Globe className="h-8 w-8" />} title="How it differs from Research on your papers">
              Research on <Link to="/research" className="text-brand-700">My papers</Link> answers from papers already in your library. Deep research goes out and finds sources for you: it searches the databases with several searches, merges and ranks the results, reads the best ones and writes a report. Save any source to your library to read it in full.
            </EmptyState>
          )}
        </section>
      </div>
    </Container>
  );
}

function Connections({ status }: { status: DeepResearchStatus }) {
  const rows = [
    { label: "Scholarly databases", on: status.databases.length > 0, detail: status.databases.map((d) => PROVIDER_LABELS[d] ?? d).join(", ") },
    { label: "AI report writing", on: status.ai, detail: status.ai ? "Connected" : "Not connected yet: you get the list of sources, without a written report" },
    { label: "General web search", on: status.web_search, detail: status.web_search ? "Connected" : "Not connected yet" },
  ];
  return (
    <ul aria-label="What Deep research can use" className="grid gap-2 sm:grid-cols-3">
      {rows.map((row) => (
        <li key={row.label} className="flex gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-sm">
          {row.on ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
          <span>
            <span className="block font-medium text-slate-900">{row.label}</span>
            <span className="block text-xs text-slate-500">{row.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const REPORT_NOTICE: Record<string, { title: string; body: string }> = {
  ai_not_connected: {
    title: "No written report: AI is not connected yet",
    body: "The searches ran and every source found is listed below. Once AI is connected, Deep research also reads them and writes a checked report.",
  },
  withheld: {
    title: "Report withheld",
    body: "The written report failed our citation checks, so it was discarded rather than shown. The sources found are listed below. Try running it again.",
  },
  ai_failed: {
    title: "The report could not be written this time",
    body: "The AI service did not respond. The sources found are listed below. Try running it again in a few minutes.",
  },
};

function serviceLabel(service: DeepResearchService): string {
  return service.kind === "web" ? "General web" : PROVIDER_LABELS[service.name] ?? service.name;
}

function RunView({ run }: { run: DeepResearchRun }) {
  const notice = REPORT_NOTICE[run.report_status];
  const read = run.sources.filter((s) => s.read);
  const others = run.sources.filter((s) => !s.read);
  const services = run.services.filter((s) => s.kind === "scholarly" || !["not_connected", "not_requested"].includes(s.error ?? ""));
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-xl font-semibold text-slate-950">{run.question}</h2>
        <p className="mt-1 text-xs text-slate-500">{relativeTime(run.created_at)}</p>
      </div>
      <Card className="p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">What was searched</p>
        <div className="flex flex-wrap gap-1.5">
          {run.queries.map((q) => <Badge key={q}><Search className="h-3 w-3" /> {q}</Badge>)}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {services.map((s) => (
            <li key={s.name} className="flex items-center gap-1">
              {s.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-red-600" />}
              {serviceLabel(s)}: {s.ok ? `${s.count} results` : "not reached"}
              {s.ok && s.excluded_by_date ? ` (${s.excluded_by_date} left out by the years you set)` : ""}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Report</p>
        {run.report !== null ? (
          <GroundedAnswerView answer={{ answer: run.report, citations: run.citations, model: run.model, insufficient_evidence: run.insufficient_evidence, gaps: run.gaps }} />
        ) : notice ? (
          <Alert kind={run.report_status === "ai_not_connected" ? "info" : "warning"} title={notice.title}>{notice.body}</Alert>
        ) : null}
      </Card>

      {read.length > 0 && <SourceList title={`Read for this report (${read.length})`} sources={read} />}
      <SourceList title={read.length ? `Also found (${others.length})` : `Sources found (${others.length})`} sources={others} />
    </div>
  );
}

function SourceList({ title, sources }: { title: string; sources: DeepResearchSource[] }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 text-sm font-semibold text-slate-900">{title}</h3>
      {sources.length === 0 ? (
        <p className="text-sm text-slate-500">None.</p>
      ) : (
        <ul className="space-y-2">
          {sources.map((s, index) => <SourceItem key={s.identifier ?? s.url ?? `${s.title}-${index}`} source={s} />)}
        </ul>
      )}
    </section>
  );
}

function authorLine(authors: string[]): string {
  return authors.slice(0, 3).join(", ") + (authors.length > 3 ? " et al." : "");
}

function SourceItem({ source }: { source: DeepResearchSource }) {
  const save = useMutation({ mutationFn: () => api.post<Paper>("/papers/import", { identifier: source.identifier, add_to_library: true }) });
  const link = source.doi ? `https://doi.org/${source.doi}` : safeHref(source.url);
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {source.kind === "web" ? (
          <Badge tone="amber"><Globe className="h-3 w-3" /> Web page · not peer-reviewed</Badge>
        ) : (
          <>
            {source.is_open_access && <Badge tone="green"><Unlock className="h-3 w-3" /> Open access</Badge>}
            {!source.has_abstract && <Badge>No abstract</Badge>}
            {source.databases && source.databases.length > 0 && <span className="text-xs text-slate-500">via {source.databases.map((d) => PROVIDER_LABELS[d] ?? d).join(", ")}</span>}
          </>
        )}
      </div>
      <p className="mt-1 font-medium text-slate-900">
        {source.paper_id ? <Link to={`/papers/${source.paper_id}`} className="hover:text-brand-700">{source.title}</Link> : source.title}
      </p>
      <p className="text-xs text-slate-500">
        {source.kind === "web"
          ? `${source.site ?? ""}${source.year ? ` · ${source.year}` : ""}`
          : [authorLine(source.authors ?? []), source.journal, source.year].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {source.kind === "scholarly" && source.identifier && (
          save.isSuccess ? (
            <Badge tone="green"><Check className="h-3 w-3" /> In your library</Badge>
          ) : (
            <Button size="sm" variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>Save to library</Button>
          )
        )}
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900">
            {source.kind === "web" ? "Open page" : "Publisher"} <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {save.error && <span className="text-red-700">{errorMessage(save.error)}</span>}
      </div>
    </li>
  );
}
