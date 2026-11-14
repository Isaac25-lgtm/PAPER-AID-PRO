import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, Circle, Compass, FileText, FlaskConical, LibraryBig, MessageSquare, Quote, X } from "lucide-react";
import { Link } from "react-router";

import { HelpButton, SectionGuide, useGuidance } from "@/components/Guidance";
import { Container } from "@/components/Layout";
import { Alert, Button, Card, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { relativeTime } from "@/lib/format";
import { GUIDES } from "@/lib/guides";
import { usePreference } from "@/lib/preferences";
import type { ConversationSummary, DocumentSummary, Progress } from "@/lib/types";

const QUICK = [
  { key: "discover", icon: Compass },
  { key: "library", icon: LibraryBig },
  { key: "documents", icon: FileText },
  { key: "research", icon: FlaskConical },
  { key: "citations", icon: Quote },
] as const;

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
  if (progress.error || !progress.data) return <div className="mb-6"><RetryAlert what="your progress" onRetry={() => void progress.refetch()} /></div>;
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
      <button className="mb-6 text-sm font-medium text-brand-700 hover:underline" onClick={() => setHidden(false)}>
        Show the getting-started checklist ({completed}/{items.length})
      </button>
    );
  }
  return (
    <Card className="mb-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-slate-900">Getting started</h2>
          <p className="text-sm text-slate-600">{completed === items.length ? "All done. You know your way around." : `${completed} of ${items.length} steps complete. Each step ticks itself off when you do it.`}</p>
        </div>
        <button className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Hide checklist" onClick={() => setHidden(true)}>
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
            </div>
            {!item.done && (
              <Link to={item.to} className="shrink-0 text-sm font-medium text-brand-700 hover:underline">{item.action} →</Link>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const documents = useQuery({ queryKey: ["documents"], queryFn: () => api.get<DocumentSummary[]>("/documents") });
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: () => api.get<ConversationSummary[]>("/research/conversations") });
  const { openTour } = useGuidance();
  const [tourSeen, setTourSeen] = usePreference<boolean>("tour_seen", false);
  if (!user) return null;
  const first = (user.name || "").split(" ")[0];
  return (
    <Container>
      <PageHeader title={first ? `Welcome back, ${first}` : "Welcome back"} subtitle="Pick up where you left off, or start something new." actions={<HelpButton section="dashboard" label="Help" />} />
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
      <Checklist />

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Go to</h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {QUICK.map(({ key, icon: Icon }) => (
          <Link key={key} to={GUIDES[key].path} className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow">
            <Icon className="h-5 w-5 text-brand-700" aria-hidden />
            <p className="mt-2 font-medium text-slate-900">{GUIDES[key].title}</p>
            <p className="mt-1 line-clamp-3 text-xs text-slate-600">{GUIDES[key].summary}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Recent documents</h2>
            <Link to="/documents" className="text-sm text-brand-700 hover:underline">All documents</Link>
          </div>
          {documents.error && <RetryAlert what="your documents" onRetry={() => void documents.refetch()} />}
          {documents.data?.length === 0 && <p className="text-sm text-slate-500">No documents yet. <Link to="/documents" className="text-brand-700">Start one</Link> from a guided outline.</p>}
          <ul className="divide-y divide-slate-100">
            {documents.data?.slice(0, 5).map((doc) => (
              <li key={doc.id}>
                <Link to={`/documents/${doc.id}`} className="flex items-center gap-3 py-2.5 hover:text-slate-950">
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{doc.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">{doc.word_count.toLocaleString()} words · {relativeTime(doc.updated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Recent research questions</h2>
            <Link to="/research" className="text-sm text-brand-700 hover:underline">Research assistant</Link>
          </div>
          {conversations.error && <RetryAlert what="your research history" onRetry={() => void conversations.refetch()} />}
          {conversations.data?.length === 0 && <p className="text-sm text-slate-500">No questions yet. Choose papers in <Link to="/research" className="text-brand-700">Research</Link> and ask.</p>}
          <ul className="divide-y divide-slate-100">
            {conversations.data?.slice(0, 5).map((c) => (
              <li key={c.id}>
                <Link to={`/research?c=${c.id}`} className="flex items-center gap-3 py-2.5 hover:text-slate-950">
                  <MessageSquare className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">{relativeTime(c.updated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Container>
  );
}
