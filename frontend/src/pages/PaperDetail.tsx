import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Download, FileUp, Quote, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { AIError, GroundedAnswerView } from "@/components/GroundedAnswerView";
import { SectionGuide } from "@/components/Guidance";
import { Container } from "@/components/Layout";
import { AddToLibraryButton, CiteModal, DoiLink, PaperMeta, StatusBadge } from "@/components/papers";
import { Alert, Badge, Button, Card, Input, Spinner, Textarea } from "@/components/ui";
import { api, ApiError, downloadFile, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { GroundedAnswer, Job, Paper, PaperSummary, Passage, SummaryPoint } from "@/lib/types";

function FullTextPanel({ paper }: { paper: Paper }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const active = paper.status === "queued" || paper.status === "processing";
  const jobs = useQuery({
    queryKey: ["jobs", paper.id],
    queryFn: () => api.get<Job[]>(`/papers/${paper.id}/jobs`),
    refetchInterval: active ? 3000 : false,
  });
  useEffect(() => {
    const latest = jobs.data?.[0];
    if (latest && latest.status !== "queued" && latest.status !== "running" && active) void queryClient.invalidateQueries({ queryKey: ["paper", paper.id] });
  }, [jobs.data, active, paper.id, queryClient]);

  const retrieve = useMutation({
    mutationFn: () => api.post<Job>(`/papers/${paper.id}/full-text`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["paper", paper.id] });
      void queryClient.invalidateQueries({ queryKey: ["jobs", paper.id] });
    },
  });
  const navigate = useNavigate();
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const id = paper.doi ?? (paper.pmid ? `PMID:${paper.pmid}` : paper.arxiv_id ? `arXiv:${paper.arxiv_id}` : "");
      if (id) form.append("identifier", id);
      else form.append("title", paper.title);
      return api.upload<Paper>("/papers/upload", form);
    },
    onSuccess: (created) => navigate(`/papers/${created.id}`),
  });

  if (paper.status === "ready") {
    return (
      <Alert kind="success" title="Full text available">
        {paper.status_detail}
        {paper.has_pdf && user && (
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={() => void downloadFile(`/papers/${paper.id}/pdf`, `${paper.title.slice(0, 60)}.pdf`)}>
              <Download className="h-4 w-4" /> Download PDF
            </Button>
          </div>
        )}
      </Alert>
    );
  }
  if (active) return <Alert kind="info" title="Extracting full text">Retrieving and reading the PDF. This usually takes under a minute.</Alert>;
  return (
    <Card className="p-4">
      <p className="text-sm text-slate-700">
        {paper.status === "failed" ? paper.status_detail : "Only metadata is available. Retrieve the open-access PDF to search its full text and ask detailed questions."}
      </p>
      {user ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {paper.visibility === "public" && (
            <Button size="sm" loading={retrieve.isPending} onClick={() => retrieve.mutate()}>Retrieve open-access PDF</Button>
          )}
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50">
            <FileUp className="h-4 w-4" /> {upload.isPending ? "Uploading…" : "Upload your copy (private)"}
            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
          </label>
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-500">Sign in to retrieve or upload the full text.</p>
      )}
      {(retrieve.error || upload.error) && <div className="mt-3"><Alert kind="error">{errorMessage(retrieve.error ?? upload.error)}</Alert></div>}
    </Card>
  );
}

function PassageSearch({ paper }: { paper: Paper }) {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const passages = useQuery({
    queryKey: ["passages", paper.id, submitted],
    queryFn: () => api.get<Passage[]>(`/papers/${paper.id}/passages`, { q: submitted || undefined, limit: 8 }),
    enabled: paper.status === "ready",
  });
  if (paper.status !== "ready") return null;
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 font-semibold text-slate-900"><Search className="h-4 w-4" /> Search inside this paper</h2>
      <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. sample size, primary outcome" aria-label="Search passages" />
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {passages.isLoading && <Spinner />}
      <div className="space-y-2">
        {passages.data?.map((p) => (
          <div key={p.chunk_id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div className="mb-1 flex gap-2 text-xs text-slate-500">
              {p.section && <Badge>{p.section}</Badge>}
              {p.page_start && <span>p. {p.page_start}{p.page_end && p.page_end !== p.page_start ? `–${p.page_end}` : ""}</span>}
            </div>
            <p className="text-slate-700">{p.text.slice(0, 700)}{p.text.length > 700 ? "…" : ""}</p>
          </div>
        ))}
        {passages.data?.length === 0 && <p className="text-sm text-slate-500">No passages matched.</p>}
      </div>
    </section>
  );
}

function SummaryPointView({ label, point }: { label?: string; point: SummaryPoint }) {
  return (
    <li className="text-sm text-slate-700">
      {label && <span className="font-medium text-slate-900">{label}: </span>}
      {point.text}
      {point.evidence.map((e) => (
        <span key={e.key} title={e.excerpt} className="ml-1 rounded bg-slate-100 px-1 text-[11px] text-slate-600">
          {e.kind === "passage" ? `${e.section ?? "text"}${e.page_start ? ` p.${e.page_start}` : ""}` : "abstract"}
        </span>
      ))}
    </li>
  );
}

function AISummary({ paper }: { paper: Paper }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const summary = useQuery({
    queryKey: ["summary", paper.id],
    queryFn: async () => {
      try {
        return await api.get<PaperSummary>(`/papers/${paper.id}/summary`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
  const generate = useMutation({
    mutationFn: () => api.post<PaperSummary>(`/papers/${paper.id}/summary`, undefined, { force: Boolean(summary.data) }),
    onSuccess: (data) => queryClient.setQueryData(["summary", paper.id], data),
  });
  const data = summary.data;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Bot className="h-4 w-4 text-brand-700" /> AI summary</h2>
        {user && <Button size="sm" variant="secondary" loading={generate.isPending} onClick={() => generate.mutate()}>{data ? "Regenerate" : "Generate summary"}</Button>}
      </div>
      {generate.error && <div className="mt-3"><AIError error={generate.error} /></div>}
      {!data && !generate.error && <p className="mt-2 text-sm text-slate-500">No summary yet.{paper.status !== "ready" && " Summaries are more accurate once full text is available."}</p>}
      {data && (
        <div className="mt-3 space-y-3">
          {data.content.overview.length > 0 && (
            <ul className="space-y-1 font-serif text-slate-800">{data.content.overview.map((p, i) => <SummaryPointView key={i} point={p} />)}</ul>
          )}
          <ul className="space-y-1.5">
            {data.content.research_question && <SummaryPointView label="Question" point={data.content.research_question} />}
            {data.content.methods && <SummaryPointView label="Methods" point={data.content.methods} />}
          </ul>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Key findings</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">{data.content.key_findings.map((p, i) => <SummaryPointView key={i} point={p} />)}</ul>
          </div>
          {data.content.limitations.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Limitations</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">{data.content.limitations.map((p, i) => <SummaryPointView key={i} point={p} />)}</ul>
            </div>
          )}
          {data.content.removed_note && <p className="text-xs text-amber-700">{data.content.removed_note}</p>}
          <p className="text-xs text-slate-500">{data.label} Based on the {data.content.based_on === "full_text" ? "full text" : "abstract only"} · {data.model}</p>
        </div>
      )}
    </Card>
  );
}

function AskPaper({ paper }: { paper: Paper }) {
  const { user } = useAuth();
  const [question, setQuestion] = useState("");
  const ask = useMutation({ mutationFn: (q: string) => api.post<GroundedAnswer>(`/papers/${paper.id}/ask`, { question: q }) });
  if (!user) return null;
  return (
    <Card className="p-5">
      <h2 className="mb-2 font-semibold text-slate-900">Ask this paper</h2>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (question.trim().length >= 3) ask.mutate(question.trim()); }}>
        <Textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What was the primary outcome and effect size?" maxLength={2000} />
        <Button type="submit" size="sm" loading={ask.isPending}>Ask</Button>
      </form>
      {ask.error && <div className="mt-3"><AIError error={ask.error} /></div>}
      {ask.data && <div className="mt-4"><GroundedAnswerView answer={ask.data} /></div>}
    </Card>
  );
}

export default function PaperDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [citeOpen, setCiteOpen] = useState(false);
  const paper = useQuery({ queryKey: ["paper", id], queryFn: () => api.get<Paper>(`/papers/${id}`) });
  const remove = useMutation({ mutationFn: () => api.delete(`/papers/${id}`), onSuccess: () => navigate("/library") });

  if (paper.isLoading) return <Spinner />;
  if (paper.error) return <Container><Alert kind="error">{errorMessage(paper.error)}</Alert></Container>;
  const p = paper.data!;
  return (
    <Container className="max-w-5xl">
      <SectionGuide section="paper" />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={p.status} />
        {p.visibility === "private" && <Badge tone="violet">Private upload</Badge>}
        {p.is_open_access && <Badge tone="green">Open access</Badge>}
        {p.citation_count > 0 && <Badge>{p.citation_count.toLocaleString()} citations</Badge>}
      </div>
      <h1 className="mt-3 font-serif text-3xl font-bold leading-tight text-slate-900">{p.title}</h1>
      <div className="mt-2"><PaperMeta paper={p} /></div>
      <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-600">
        {p.doi && <DoiLink doi={p.doi} />}
        {p.pmid && <a className="text-brand-700 hover:underline" href={`https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`} target="_blank" rel="noreferrer">PMID {p.pmid}</a>}
        {p.arxiv_id && <a className="text-brand-700 hover:underline" href={`https://arxiv.org/abs/${p.arxiv_id}`} target="_blank" rel="noreferrer">arXiv:{p.arxiv_id}</a>}
        {p.volume && <span>Vol. {p.volume}{p.issue ? `(${p.issue})` : ""}{p.pages ? `, ${p.pages}` : ""}</span>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <AddToLibraryButton paper={p} onDone={() => void queryClient.invalidateQueries({ queryKey: ["library"] })} />
        <Button size="sm" variant="secondary" onClick={() => setCiteOpen(true)}><Quote className="h-4 w-4" /> Cite</Button>
        {p.is_owner && (
          <Button size="sm" variant="ghost" loading={remove.isPending} onClick={() => window.confirm("Delete this upload permanently?") && remove.mutate()}>
            <Trash2 className="h-4 w-4" /> Delete upload
          </Button>
        )}
      </div>
      <CiteModal paperId={p.id} open={citeOpen} onClose={() => setCiteOpen(false)} />

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {p.abstract && (
            <section>
              <h2 className="mb-2 font-semibold text-slate-900">Abstract</h2>
              <p className="font-serif leading-relaxed text-slate-800">{p.abstract}</p>
            </section>
          )}
          {p.keywords.length > 0 && <div className="flex flex-wrap gap-1.5">{p.keywords.map((k) => <Badge key={k}>{k}</Badge>)}</div>}
          <PassageSearch paper={p} />
          <AskPaper paper={p} />
        </div>
        <aside className="space-y-4">
          <FullTextPanel paper={p} />
          <AISummary paper={p} />
        </aside>
      </div>
    </Container>
  );
}

