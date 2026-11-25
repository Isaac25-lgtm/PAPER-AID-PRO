import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, Circle, Compass, FileText, LibraryBig, MessageSquare, Plus, Quote, X } from "lucide-react";
import { Link } from "react-router";

import { HelpButton, SectionGuide, useGuidance } from "@/components/Guidance";
import { Container } from "@/components/Layout";
import { Alert, Button, Card, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DOC_TYPES, relativeTime } from "@/lib/format";
import { usePreference } from "@/lib/preferences";
import type { ConversationSummary, DocumentSummary, Progress } from "@/lib/types";

function RetryAlert({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <Alert kind="error">
      Could not load {what}.{" "}
      <button className="font-medium underline" onClick={onRetry}>
        Try again
      </button>
    </Alert>
  );
}

function Checklist() {
  const [hidden, setHidden] = usePreference<boolean>("checklist_hidden", false);
  const progress = useQuery({ queryKey: ["progress"], queryFn: () => api.get<Progress>("/me/progress") });
  if (progress.isLoading) return <Spinner label="Checking your progress" />;
  if (progress.error || !progress.data) return <div><RetryAlert what="your progress" onRetry={() => void progress.refetch()} /></div>;
  const p = progress.data;
  const items = [
    { done: p.library > 0, title: "Save your first paper", body: "Search Discover and choose Save to library, or add one by DOI.", to: "/discover", action: "Find papers" },
    { done: p.full_text > 0, title: "Add a paper's full text", body: "Retrieve an open-access PDF or upload your own, so you can search and cite exact passages.", to: "/library", action: "Open library" },
    { done: p.collections > 0, title: "Organise a collection", body: "Group papers for a chapter, a review or a course.", to: "/library", action: "Create a collection" },
    { done: p.documents > 0, title: "Start a document", body: "Pick your field and design to get a guided outline.", to: "/documents", action: "New document" },
    { done: p.conversations > 0, title: "Ask your sources a question", body: "Choose papers and ask; every statement links to its source passage.", to: "/research", action: "Open research" },
  ];
  const completed = items.filter((i) => i.done).length;
  if (hidden) {
    return (
      <button className="text-sm font-medium text-brand-700 hover:underline" onClick={() => setHidden(false)}>
        Show the getting-started checklist ({completed}/{items.length})
      </button>
    );
  }
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-slate-900">Getting started</h2>
          <p className="text-sm text-slate-600">{completed === items.length ? "All done. You know your way around." : `${completed} of ${items.length} steps complete. Each step ticks itself off when you do it.`}</p>
        </div>
        <button className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Hide checklist" onClick={() => setHidden(true)}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={completed} aria-label="Getting started progress">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(completed / items.length) * 100}%` }} />
      </div>
      <ol className="mt-4 divide-y divide-slate-100">
        {items.map((item) => (
          <li key={item.title} className="flex items-start gap-3 py-3">
            {item.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" aria-label="Done" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" aria-label="Not done yet" />}
            <div className="min-w-0 flex-1">
              <p className={clsx("text-sm font-medium", item.done ? "text-slate-500 line-through" : "text-slate-900")}>{item.title}</p>
              {!item.done && <p className="text-sm text-slate-600">{item.body}</p>}
              {!item.done && (
                <Link to={item.to} className="mt-1 inline-block text-sm font-medium text-brand-700 hover:underline">{item.action} →</Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

const START = [
  { type: "draft", label: "Blank document", body: "An empty page: no outline, no guidance. Write and cite as you go." },
  { type: "manuscript", label: "Manuscript", body: "An original research article, from abstract to discussion." },
  { type: "proposal", label: "Research proposal", body: "Background, objectives and methods for a study you plan." },
  { type: "literature_review", label: "Literature review", body: "What is known, how it fits together and where the gaps are." },
  { type: "thesis", label: "Thesis chapter", body: "A chapter of a thesis or dissertation, with its own outline." },
  { type: "report", label: "Report", body: "Findings and recommendations for a project, organisation or funder." },
] as const;

function greeting(now = new Date()): string {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function Stat({ value, label }: { value: number | undefined; label: string }) {
  return (
    <div>
      <p className="font-mono text-2xl font-semibold tabular-nums tracking-[-0.02em] text-slate-950">{value === undefined ? "–" : value.toLocaleString()}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const documents = useQuery({ queryKey: ["documents"], queryFn: () => api.get<DocumentSummary[]>("/documents") });
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: () => api.get<ConversationSummary[]>("/research/conversations") });
  const progress = useQuery({ queryKey: ["progress"], queryFn: () => api.get<Progress>("/me/progress") });
  const { openTour } = useGuidance();
  const [tourSeen, setTourSeen] = usePreference<boolean>("tour_seen", false);
  if (!user) return null;
  const first = (user.name || "").split(" ")[0];
  const recent = [...(documents.data ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const [latest, ...others] = recent;
  const typeLabel = (type: string | undefined) => DOC_TYPES.find((t) => t.value === type)?.label;
  return (
    <Container className="max-w-6xl">
      <PageHeader
        title={first ? `${greeting()}, ${first}` : greeting()}
        subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
        actions={<HelpButton section="dashboard" label="Help" />}
      />
      <SectionGuide section="dashboard" />
      {!tourSeen && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-700"><span className="font-medium text-slate-900">New to PaperAid Pro?</span> A one-minute tour shows how the sections fit together.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setTourSeen(true)}>No thanks</Button>
            <Button size="sm" onClick={openTour}>Take the tour</Button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Continue writing: the document touched most recently, then the next few. */}
          <Card className="p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Continue writing</h2>
            {documents.isLoading && <Spinner label="Loading your documents" />}
            {documents.error && <div className="mt-3"><RetryAlert what="your documents" onRetry={() => void documents.refetch()} /></div>}
            {documents.data?.length === 0 && (
              <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-5 text-center">
                <p className="text-sm text-slate-600">No documents yet. Pick a kind of document below to start from a guided outline.</p>
              </div>
            )}
            {latest && (
              <Link to={`/documents/${latest.id}`} className="group mt-3 flex items-start gap-4 rounded-lg border border-slate-200 p-4 transition hover:border-slate-300 hover:bg-slate-50">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-950">{latest.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {[typeLabel(latest.doc_type), `${latest.word_count.toLocaleString()} words`, `edited ${relativeTime(latest.updated_at)}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white group-hover:bg-slate-800">Open</span>
              </Link>
            )}
            {others.length > 0 && (
              <ul className="mt-2 divide-y divide-slate-100">
                {others.slice(0, 4).map((doc) => (
                  <li key={doc.id}>
                    <Link to={`/documents/${doc.id}`} className="flex items-center gap-3 px-1 py-2.5 hover:text-slate-950">
                      <FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{doc.title}</span>
                      <span className="shrink-0 text-xs text-slate-500">{doc.word_count.toLocaleString()} words · {relativeTime(doc.updated_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {(documents.data?.length ?? 0) > 5 && (
              <Link to="/documents" className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">All documents →</Link>
            )}
          </Card>

          {/* Start something new: each opens New document with that kind chosen (a blank document needs no outline). */}
          <section aria-labelledby="start-new">
            <h2 id="start-new" className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Start something new</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {START.map(({ type, label, body }) => (
                <Link key={type} to={`/documents?new=1&type=${type}`} className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 group-hover:bg-slate-900 group-hover:text-white">
                    <Plus className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-900">{label}</span>
                    <span className="mt-0.5 block text-xs text-slate-600">{body}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Recent research questions</h2>
              <Link to="/research" className="text-sm text-brand-700 hover:underline">Ask a question</Link>
            </div>
            {conversations.error && <RetryAlert what="your research history" onRetry={() => void conversations.refetch()} />}
            {conversations.data?.length === 0 && (
              <p className="text-sm text-slate-500">
                No questions yet. Choose papers in <Link to="/research" className="text-brand-700">Research</Link> and ask; every statement links to its source.
              </p>
            )}
            <ul className="divide-y divide-slate-100">
              {conversations.data?.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link to={`/research?c=${c.id}`} className="flex items-center gap-3 py-2.5 hover:text-slate-950">
                    <MessageSquare className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.title}</span>
                    <span className="shrink-0 text-xs text-slate-500">{relativeTime(c.updated_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          {/* The library at a glance, with the ways papers come in. */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Your library</h2>
              <Link to="/library" className="text-sm text-brand-700 hover:underline">Open</Link>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat value={progress.data?.library} label="papers" />
              <Stat value={progress.data?.full_text} label="with full text" />
              <Stat value={progress.data?.collections} label="collections" />
            </div>
            <div className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-sm">
              <Link to="/discover" className="flex items-center gap-2 rounded-md px-1 py-1.5 text-slate-700 hover:bg-slate-50 hover:text-slate-950">
                <Compass className="h-4 w-4 text-slate-400" aria-hidden /> Find papers in every field
              </Link>
              <Link to="/library" className="flex items-center gap-2 rounded-md px-1 py-1.5 text-slate-700 hover:bg-slate-50 hover:text-slate-950">
                <LibraryBig className="h-4 w-4 text-slate-400" aria-hidden /> Add by DOI or upload a PDF
              </Link>
              <Link to="/tools/citations" className="flex items-center gap-2 rounded-md px-1 py-1.5 text-slate-700 hover:bg-slate-50 hover:text-slate-950">
                <Quote className="h-4 w-4 text-slate-400" aria-hidden /> Format or check references
              </Link>
            </div>
          </Card>
          <Checklist />
        </div>
      </div>
    </Container>
  );
}
