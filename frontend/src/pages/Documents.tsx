import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { SectionGuide } from "@/components/Guidance";
import { Container } from "@/components/Layout";
import { StyleOptions, useStyles } from "@/components/papers";
import { Alert, Button, EmptyState, Input, Label, Modal, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { DOC_TYPES, relativeTime } from "@/lib/format";
import { DESIGN_GROUPS, DOC_TYPE_LABELS, STUDY_DESIGNS, defaultHeadings, defaultObjectives, guidedContent } from "@/lib/templates";
import type { DocumentSummary, DocumentType, ResearchDocument } from "@/lib/types";

const NL = String.fromCharCode(10);
// Examples from different fields, so the form does not suggest the app is for one discipline only.
const TOPIC_EXAMPLES = [
  "e.g. Mobile money adoption among small traders in Kampala",
  "e.g. Land rights of women under customary law in Kenya",
  "e.g. Teacher motivation in public secondary schools",
  "e.g. Solar mini-grids for rural electrification",
  "e.g. Oral history and memory in post-apartheid Cape Town",
  "e.g. School-based malaria prevention in rural Uganda",
];
const TOPIC_EXAMPLE = TOPIC_EXAMPLES[Math.floor(Math.random() * TOPIC_EXAMPLES.length)];

function NewDocumentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const styles = useStyles();
  const [step, setStep] = useState<1 | 2>(1);
  const [topic, setTopic] = useState("");
  const [docType, setDocType] = useState<DocumentType>("manuscript");
  const [design, setDesign] = useState("");
  const [style, setStyle] = useState("apa");
  const [general, setGeneral] = useState("");
  const [specific, setSpecific] = useState("");
  const [headings, setHeadings] = useState("");

  const prepareOutline = () => {
    const objectives = defaultObjectives(topic, docType, design);
    setGeneral(docType === "draft" ? "" : objectives.general);
    setSpecific(docType === "draft" ? "" : objectives.specific.join(NL));
    setHeadings(defaultHeadings(docType, design).join(NL));
    setStep(2);
  };
  const create = useMutation({
    mutationFn: () =>
      api.post<ResearchDocument>("/documents", {
        title: topic.trim() || "Untitled document",
        doc_type: docType,
        csl_style: style,
        content: guidedContent({
          topic,
          docType,
          design,
          generalObjective: general,
          specificObjectives: specific.split(NL),
          headings: headings.split(NL),
        }),
      }),
    onSuccess: (doc) => navigate(`/documents/${doc.id}`),
  });
  const close = () => {
    setStep(1);
    onClose();
  };
  return (
    <Modal open={open} onClose={close} title={step === 1 ? "New document" : "Objectives & outline"} wide>
      {step === 1 ? (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); prepareOutline(); }}>
          <div>
            <Label htmlFor="topic">Title / research topic</Label>
            <Input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300} placeholder={TOPIC_EXAMPLE} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="type">Document type</Label>
              <Select id="type" value={docType} onChange={(e) => { setDocType(e.target.value as DocumentType); setDesign(""); }}>
                {(Object.keys(DOC_TYPE_LABELS) as DocumentType[]).map((t) => <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="design">Study design</Label>
              <Select id="design" value={design} onChange={(e) => setDesign(e.target.value)} disabled={!STUDY_DESIGNS[docType].length}>
                <option value="">{STUDY_DESIGNS[docType].length ? "General (no specific design)" : "Not applicable"}</option>
                {DESIGN_GROUPS[docType].map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.designs.map((d) => <option key={d} value={d}>{d}</option>)}
                  </optgroup>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="style">Citation style</Label>
            <Select id="style" value={style} onChange={(e) => setStyle(e.target.value)}>
              <StyleOptions styles={styles.data} />
            </Select>
          </div>
          <div className="flex justify-end">
            <Button type="submit">Next: objectives & outline</Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Suggested for a {DOC_TYPE_LABELS[docType].toLowerCase()}{design ? ` (${design})` : ""}. Edit anything — each line becomes a section with writing guidance.</p>
          {docType !== "draft" && (
            <>
              <div>
                <Label htmlFor="general">General objective</Label>
                <Textarea id="general" rows={2} value={general} onChange={(e) => setGeneral(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="specific">Specific objectives (one per line)</Label>
                <Textarea id="specific" rows={4} value={specific} onChange={(e) => setSpecific(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <Label htmlFor="headings">Sections (one per line{docType === "draft" ? "; leave empty for a blank page" : ""})</Label>
            <Textarea id="headings" rows={8} value={headings} onChange={(e) => setHeadings(e.target.value)} />
            <p className="mt-1 text-xs text-slate-500">The reference list is generated automatically from your citations — no References section needed.</p>
          </div>
          {create.error && <Alert kind="error">{errorMessage(create.error)}</Alert>}
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>Create document</Button>
          </div>
        </div>
      )}
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
      <SectionGuide section="documents" />
      {docs.isLoading && <Spinner />}
      {docs.error && <Alert kind="error">{errorMessage(docs.error)}</Alert>}
      {docs.data?.length === 0 && (
        <EmptyState icon={<FileText className="h-8 w-8" />} title="No documents yet" action={<Button onClick={() => setOpen(true)}>Create your first document</Button>}>
          Start a manuscript, proposal, literature review or thesis chapter.
        </EmptyState>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {docs.data?.map((doc) => (
          <div key={doc.id} className="group relative rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300">
            <Link to={`/documents/${doc.id}`} className="block">
              <FileText className="h-5 w-5 text-brand-700" />
              <h2 className="mt-2 line-clamp-2 font-semibold text-slate-900">{doc.title}</h2>
              <p className="mt-1 text-xs text-slate-500">
                {DOC_TYPES.find((t) => t.value === doc.doc_type)?.label} · {doc.word_count.toLocaleString()} words · {doc.csl_style.toUpperCase()}
              </p>
              <p className="mt-2 text-xs text-slate-500">Edited {relativeTime(doc.updated_at)}</p>
            </Link>
            <button
              className="absolute right-3 top-3 rounded p-1 text-slate-500 opacity-100 hover:bg-red-50 hover:text-red-600 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
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
