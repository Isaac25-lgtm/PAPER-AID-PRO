import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { Container } from "@/components/Layout";
import { useStyles } from "@/components/papers";
import { Alert, Button, EmptyState, Input, Label, Modal, PageHeader, Select, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { DOC_TYPES, relativeTime } from "@/lib/format";
import type { DocumentSummary, ResearchDocument } from "@/lib/types";

const TEMPLATES: Record<string, string[]> = {
  draft: [],
  manuscript: ["Introduction", "Methods", "Results", "Discussion", "Conclusion"],
  proposal: ["Background", "Problem statement", "Objectives", "Methodology", "Expected outcomes", "Timeline"],
  literature_review: ["Introduction", "Search strategy", "Thematic review", "Gaps in the literature", "Conclusion"],
  thesis: ["Abstract", "Introduction", "Literature review", "Methodology", "Results", "Discussion", "Conclusion"],
  report: ["Executive summary", "Background", "Findings", "Recommendations"],
};

function templateContent(type: string) {
  const headings = TEMPLATES[type] ?? [];
  if (!headings.length) return undefined;
  return {
    type: "doc",
    content: headings.flatMap((h) => [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: h }] },
      { type: "paragraph" },
    ]),
  };
}

function NewDocumentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const styles = useStyles();
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState("manuscript");
  const [style, setStyle] = useState("apa");
  const create = useMutation({
    mutationFn: () => api.post<ResearchDocument>("/documents", { title: title || "Untitled document", doc_type: docType, csl_style: style, content: templateContent(docType) }),
    onSuccess: (doc) => navigate(`/documents/${doc.id}`),
  });
  return (
    <Modal open={open} onClose={onClose} title="New document">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder="Untitled document" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="type">Type (adds a section outline)</Label>
            <Select id="type" value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="style">Citation style</Label>
            <Select id="style" value={style} onChange={(e) => setStyle(e.target.value)}>
              {(styles.data ?? [{ id: "apa", title: "APA 7th edition" }]).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </Select>
          </div>
        </div>
        {create.error && <Alert kind="error">{errorMessage(create.error)}</Alert>}
        <Button type="submit" loading={create.isPending}>Create</Button>
      </form>
    </Modal>
  );
}

export default function DocumentsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const docs = useQuery({ queryKey: ["documents"], queryFn: () => api.get<DocumentSummary[]>("/documents") });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });
  return (
    <Container>
      <PageHeader title="Documents" subtitle="Write with sources from your library and correctly formatted citations." actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New document</Button>} />
      {docs.isLoading && <Spinner />}
      {docs.error && <Alert kind="error">{errorMessage(docs.error)}</Alert>}
      {docs.data?.length === 0 && (
        <EmptyState icon={<FileText className="h-8 w-8" />} title="No documents yet" action={<Button onClick={() => setOpen(true)}>Create your first document</Button>}>
          Start a manuscript, proposal, literature review or thesis chapter.
        </EmptyState>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {docs.data?.map((doc) => (
          <div key={doc.id} className="group relative rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-300">
            <Link to={`/documents/${doc.id}`} className="block">
              <FileText className="h-5 w-5 text-brand-700" />
              <h2 className="mt-2 line-clamp-2 font-semibold text-slate-900">{doc.title}</h2>
              <p className="mt-1 text-xs text-slate-500">
                {DOC_TYPES.find((t) => t.value === doc.doc_type)?.label} · {doc.word_count.toLocaleString()} words · {doc.csl_style.toUpperCase()}
              </p>
              <p className="mt-2 text-xs text-slate-500">Edited {relativeTime(doc.updated_at)}</p>
            </Link>
            <button
              className="absolute right-3 top-3 hidden rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 group-hover:block"
              aria-label={`Delete ${doc.title}`}
              onClick={() => window.confirm(`Delete “${doc.title}” and its history? This cannot be undone.`) && remove.mutate(doc.id)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <NewDocumentModal open={open} onClose={() => setOpen(false)} />
    </Container>
  );
}
