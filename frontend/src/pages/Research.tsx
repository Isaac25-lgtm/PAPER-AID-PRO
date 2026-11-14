import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, MessageSquare, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { AIError, GroundedAnswerView } from "@/components/GroundedAnswerView";
import { SectionGuide } from "@/components/Guidance";
import { Container } from "@/components/Layout";
import { useLibrarySearch } from "@/components/papers";
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Spinner, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import type { Conversation, ConversationSummary, GroundedAnswer } from "@/lib/types";

export default function ResearchPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const conversationId = params.get("c");
  // null = untouched (a reopened thread uses its own papers); a Set, even an empty one, is the user's explicit choice.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [question, setQuestion] = useState("");
  const [filter, setFilter] = useState("");

  const library = useLibrarySearch(filter, 100);
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: () => api.get<ConversationSummary[]>("/research/conversations") });
  const conversation = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => api.get<Conversation>(`/research/conversations/${conversationId}`),
    enabled: Boolean(conversationId),
  });
  const effectiveSelection = selected ?? new Set(conversation.data?.paper_ids ?? []);

  // The thread on screen right now; a late answer must not pull the user back to a thread they left.
  const currentThread = useRef(conversationId);
  currentThread.current = conversationId;
  const ask = useMutation({
    mutationFn: async () => {
      const origin = conversationId;
      const answer = await api.post<GroundedAnswer>("/research/ask", {
        question: question.trim(),
        paper_ids: Array.from(effectiveSelection),
        conversation_id: origin ?? undefined,
      });
      return { answer, origin };
    },
    onSuccess: ({ answer, origin }) => {
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (answer.conversation_id) void queryClient.invalidateQueries({ queryKey: ["conversation", answer.conversation_id] });
      if (currentThread.current !== origin) return; // the user moved on; the answer is saved in its own thread
      setQuestion("");
      if (answer.conversation_id) setParams({ c: answer.conversation_id });
    },
  });
  const remove = useMutation({
    mutationFn: (cid: string) => api.delete(`/research/conversations/${cid}`),
    onSuccess: () => {
      setParams({});
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const toggle = (paperId: string) => {
    const next = new Set(effectiveSelection);
    if (next.has(paperId)) next.delete(paperId);
    else next.add(paperId);
    setSelected(next);
  };
  const papers = (library.data?.items ?? []).map((i) => i.paper);

  return (
    <Container>
      <PageHeader title="Research assistant" subtitle="Ask a question across papers you choose. Every claim is linked to the passage or abstract it came from." />
      <SectionGuide section="research" />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr_300px]">
        <aside>
          <Button size="sm" variant="secondary" className="mb-3 w-full" onClick={() => { setParams({}); setSelected(null); }}>
            <Plus className="h-4 w-4" /> New question
          </Button>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">History</p>
          {conversations.error && <Alert kind="error">Could not load your history. <button className="underline" onClick={() => void conversations.refetch()}>Retry</button></Alert>}
          {conversations.data?.length === 0 && <p className="text-sm text-slate-500">No conversations yet.</p>}
          <ul className="space-y-1">
            {conversations.data?.map((c) => (
              <li key={c.id} className="group flex items-center">
                <button onClick={() => { setSelected(null); setParams({ c: c.id }); }} className={`flex-1 rounded-lg px-2 py-1.5 text-left text-sm ${conversationId === c.id ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-100"}`}>
                  <span className="line-clamp-2">{c.title}</span>
                  <span className="text-xs text-slate-500">{relativeTime(c.updated_at)}</span>
                </button>
                <button className="p-1 text-slate-500 opacity-100 hover:text-red-600 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" aria-label="Delete conversation" onClick={() => remove.mutate(c.id)}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="min-w-0 space-y-4">
          {conversation.isLoading && <Spinner />}
          {conversation.error && <Alert kind="error">{errorMessage(conversation.error)} <button className="underline" onClick={() => void conversation.refetch()}>Retry</button></Alert>}
          {conversation.data?.messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end"><div className="max-w-[85%] rounded-2xl bg-slate-900 px-4 py-2 text-white">{m.content}</div></div>
            ) : (
              <Card key={m.id} className="p-5">
                <GroundedAnswerView answer={{ answer: m.content, citations: m.citations, model: m.model, insufficient_evidence: m.insufficient_evidence, gaps: m.gaps }} />
              </Card>
            ),
          )}
          {!conversationId && !ask.data && (
            <EmptyState icon={<FlaskConical className="h-8 w-8" />} title="Pick papers, then ask">
              Choose papers from your library on the right. Papers with full text give detailed, page-referenced answers; others use their abstracts.
            </EmptyState>
          )}
          <Card className="p-4">
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (question.trim().length >= 3 && effectiveSelection.size) ask.mutate(); }}>
              <Textarea rows={3} value={question} maxLength={2000} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. What do these studies find about the main question, and where do they disagree?" aria-label="Research question" />
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">{effectiveSelection.size} paper{effectiveSelection.size === 1 ? "" : "s"} selected</span>
                <Button type="submit" loading={ask.isPending} disabled={!effectiveSelection.size || question.trim().length < 3}><MessageSquare className="h-4 w-4" /> Ask</Button>
              </div>
            </form>
            {ask.error && <div className="mt-3"><AIError error={ask.error} /></div>}
          </Card>
        </section>

        <aside>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Sources from your library</p>
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter papers" className="mb-2" />
          {library.isLoading && <Spinner />}
          {library.error && <Alert kind="error">{errorMessage(library.error)}</Alert>}
          {library.data?.total === 0 && !filter && <p className="text-sm text-slate-500">Your library is empty. <Link to="/discover" className="text-brand-700">Discover papers</Link>.</p>}
          <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto">
            {papers.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer gap-2 rounded-lg border border-slate-200 bg-white p-2 text-sm hover:border-slate-300">
                  <input type="checkbox" className="mt-1" checked={effectiveSelection.has(p.id)} onChange={() => toggle(p.id)} />
                  <span>
                    <span className="line-clamp-2 font-medium text-slate-900">{p.title}</span>
                    <span className="text-xs text-slate-500">{p.year ?? "n.d."} </span>
                    {p.has_full_text ? <Badge tone="green">Full text</Badge> : <Badge>Abstract</Badge>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </Container>
  );
}
