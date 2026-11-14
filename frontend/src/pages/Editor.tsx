import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  ArrowLeft, Bold, BookMarked, Bot, FileText, Heading2, Heading3, History, Italic, List, ListOrdered, Quote, Redo2,
  ScanSearch, Sparkles, Table as TableIcon, TextQuote, Underline as UnderlineIcon, Undo2, X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink, useParams } from "react-router";

import { CitePalette, queryFromSelection, type CiteRequest } from "@/components/editor/CitePalette";
import { SelectionMenu, type Span } from "@/components/editor/SelectionMenu";
import { useAutocomplete, type AutocompleteStatus } from "@/components/editor/useAutocomplete";
import { AIError, GroundedAnswerView } from "@/components/GroundedAnswerView";
import { HelpButton, SectionGuide } from "@/components/Guidance";
import { StyleOptions, useLibrarySearch, useStyles } from "@/components/papers";
import { Alert, Badge, Button, Input, Modal, Select, Spinner, useDialogFocus } from "@/components/ui";
import { api, ApiError, downloadFile, errorMessage } from "@/lib/api";
import { applyCitationLabels } from "@/lib/citationLabels";
import { CitationNode, LABEL_META } from "@/lib/citationNode";
import { CiteTrigger } from "@/lib/citeTrigger";
import { GhostText } from "@/lib/ghostText";
import { usePreference } from "@/lib/preferences";
import { relativeTime, sanitizeHtml } from "@/lib/format";
import { SaveQueue, type Fields } from "@/lib/saveQueue";
import { normalizeSuggestion } from "@/lib/templates";
import type { AIStatus, Citation, GroundedAnswer, JSONContent, Paper, RenderedCitations, ResearchDocument, Revision } from "@/lib/types";

// pdf.js is large: the PDF panel and its worker load only when the panel is first opened.
const PdfPanel = lazy(() => import("@/components/editor/PdfPanel"));

type Panel = "sources" | "pdf" | "check" | "history";
const PANEL_TITLES: Record<Panel, string> = {
  sources: "Cite from your library",
  pdf: "PDF beside your draft",
  check: "Check against your sources",
  history: "Version history",
};

type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

function Toolbar({
  editor,
  onAI,
  onCite,
  aiEnabled,
  autocomplete,
  onToggleAutocomplete,
  autocompleteStatus,
}: {
  editor: Editor;
  onAI: () => void;
  onCite: () => void;
  aiEnabled: boolean;
  autocomplete: boolean;
  onToggleAutocomplete: () => void;
  autocompleteStatus: AutocompleteStatus;
}) {
  const btn = (active: boolean, onClick: () => void, label: string, Icon: typeof Bold) => (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={`rounded p-1.5 ${active ? "bg-brand-100 text-brand-800" : "text-slate-600 hover:bg-slate-100"}`}>
      <Icon className="h-4 w-4" />
    </button>
  );
  const chain = () => editor.chain().focus();
  return (
    <div className="sticky top-14 z-20 flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white px-3 py-1.5">
      {btn(false, () => chain().undo().run(), "Undo", Undo2)}
      {btn(false, () => chain().redo().run(), "Redo", Redo2)}
      <span className="mx-1 h-5 w-px bg-slate-200" />
      {btn(editor.isActive("heading", { level: 2 }), () => chain().toggleHeading({ level: 2 }).run(), "Heading", Heading2)}
      {btn(editor.isActive("heading", { level: 3 }), () => chain().toggleHeading({ level: 3 }).run(), "Subheading", Heading3)}
      {btn(editor.isActive("bold"), () => chain().toggleBold().run(), "Bold", Bold)}
      {btn(editor.isActive("italic"), () => chain().toggleItalic().run(), "Italic", Italic)}
      {btn(editor.isActive("underline"), () => chain().toggleUnderline().run(), "Underline", UnderlineIcon)}
      {btn(editor.isActive("bulletList"), () => chain().toggleBulletList().run(), "Bulleted list", List)}
      {btn(editor.isActive("orderedList"), () => chain().toggleOrderedList().run(), "Numbered list", ListOrdered)}
      {btn(editor.isActive("blockquote"), () => chain().toggleBlockquote().run(), "Quote", Quote)}
      {btn(false, () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), "Insert table", TableIcon)}
      <span className="mx-1 h-5 w-px bg-slate-200" />
      <button type="button" onClick={onCite} title="Cite a source at the cursor (or type /cite)" className="flex items-center gap-1 rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-100">
        <TextQuote className="h-4 w-4" /> Cite
      </button>
      <button type="button" onClick={onAI} className="flex items-center gap-1 rounded px-2 py-1 text-sm text-brand-700 hover:bg-brand-50">
        <Sparkles className="h-4 w-4" /> AI assist
      </button>
      {aiEnabled && (
        <label className="ml-auto flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" title="Suggest the next words when you pause at the end of a paragraph. Tab accepts, Esc dismisses.">
          <input type="checkbox" className="h-3.5 w-3.5 accent-slate-900" checked={autocomplete} onChange={onToggleAutocomplete} />
          Suggestions
          {autocomplete && autocompleteStatus === "thinking" && <span className="text-slate-400">…</span>}
          {autocomplete && autocompleteStatus === "paused" && <span className="text-amber-700">paused for a minute</span>}
        </label>
      )}
    </div>
  );
}

function SourcesPanel({ documentId, editor, onInserted }: { documentId: string; editor: Editor; onInserted: () => void }) {
  const [filter, setFilter] = useState("");
  const [locator, setLocator] = useState("");
  const library = useLibrarySearch(filter);
  const insert = useMutation({
    mutationFn: (paper: Paper) => api.post<Citation>(`/documents/${documentId}/citations`, { paper_id: paper.id, locator: locator.trim() || null }),
    onSuccess: (citation) => {
      editor.chain().focus().insertContent([{ type: "citation", attrs: { citationIds: [citation.id] } }, { type: "text", text: " " }]).run();
      setLocator("");
      onInserted();
    },
  });
  const papers = (library.data?.items ?? []).map((i) => i.paper);
  const more = (library.data?.total ?? 0) - papers.length;
  return (
    <div className="space-y-3">
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search your library by title" aria-label="Search sources" />
      <Input value={locator} onChange={(e) => setLocator(e.target.value)} placeholder="Page (optional), e.g. 12 or 12-14" aria-label="Page locator" maxLength={50} />
      {insert.error && <Alert kind="error">{errorMessage(insert.error)}</Alert>}
      {library.isLoading && <Spinner />}
      {library.error && <Alert kind="error">{errorMessage(library.error)}</Alert>}
      {more > 0 && <p className="text-xs text-slate-500">Showing the {papers.length} newest of {library.data?.total} matches. Type to narrow the search.</p>}
      {library.data?.total === 0 && !filter && <p className="text-sm text-slate-500">Your library is empty. <RouterLink className="text-brand-700" to="/discover">Find papers</RouterLink> first.</p>}
      <ul className="space-y-2">
        {papers.map((paper) => (
          <li key={paper.id} className="rounded-lg border border-slate-200 p-2.5">
            <p className="line-clamp-2 text-sm font-medium text-slate-900">{paper.title}</p>
            <p className="text-xs text-slate-500">{paper.authors[0] ?? "Unknown"}{paper.authors.length > 1 ? " et al." : ""} · {paper.year ?? "n.d."}</p>
            <Button size="sm" variant="secondary" className="mt-2" loading={insert.isPending && insert.variables?.id === paper.id} onClick={() => insert.mutate(paper)}>
              Cite at cursor
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RevisionsPanel({ documentId, onRestore }: { documentId: string; onRestore: (revisionId: string) => Promise<void> }) {
  const revisions = useQuery({ queryKey: ["revisions", documentId], queryFn: () => api.get<Revision[]>(`/documents/${documentId}/revisions`) });
  const restore = useMutation({ mutationFn: onRestore });
  if (revisions.isLoading) return <Spinner />;
  return (
    <ul className="space-y-2">
      {restore.error && <li><Alert kind="error">{errorMessage(restore.error)}</Alert></li>}
      {revisions.data?.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5 text-sm">
          <div>
            <p className="font-medium text-slate-900">v{r.version} · {r.title}</p>
            <p className="text-xs text-slate-500">{relativeTime(r.created_at)} · {r.word_count} words · {r.reason.replace("_", " ")}</p>
          </div>
          <Button size="sm" variant="ghost" loading={restore.isPending && restore.variables === r.id} onClick={() => window.confirm(`Restore version ${r.version}? Your current text is kept in history.`) && restore.mutate(r.id)}>
            Restore
          </Button>
        </li>
      ))}
    </ul>
  );
}

function AIAssistModal({ editor, documentId, open, onClose }: { editor: Editor; documentId: string; open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState("academic");
  const selection = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ");
  const rewrite = useMutation({ mutationFn: () => api.post<{ text: string; model: string }>("/ai/rewrite", { text: selection, mode }) });
  const preceding = editor.state.doc.textBetween(0, editor.state.selection.from, "\n").slice(-6000);
  const complete = useMutation({ mutationFn: () => api.post<{ text: string; model: string }>("/ai/complete", { document_id: documentId, preceding_text: preceding }) });
  const result = rewrite.data ?? complete.data;
  return (
    <Modal open={open} onClose={onClose} title="AI writing assistant" wide>
      {selection ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Rewrite the selected passage. The assistant is instructed not to add facts or citations.</p>
          <blockquote className="max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 font-serif text-sm">{selection}</blockquote>
          <div className="flex gap-2">
            <Select value={mode} onChange={(e) => setMode(e.target.value)} className="w-56" aria-label="Rewrite mode">
              <option value="academic">More academic</option>
              <option value="concise">More concise</option>
              <option value="expand">Expand / clarify</option>
              <option value="simplify">Plain language</option>
              <option value="grammar">Fix grammar only</option>
            </Select>
            <Button loading={rewrite.isPending} onClick={() => rewrite.mutate()}>Rewrite</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Suggest the next sentence at your cursor (framing and transitions only — no invented findings). Tip: select text to rewrite it instead.</p>
          <Button loading={complete.isPending} disabled={preceding.trim().length < 20} onClick={() => complete.mutate()}>Suggest next sentence</Button>
        </div>
      )}
      {(rewrite.error || complete.error) && <div className="mt-3"><AIError error={rewrite.error ?? complete.error} /></div>}
      {result && (
        <div className="mt-4 space-y-2">
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3 font-serif text-sm">{result.text}</div>
          <p className="flex items-center gap-1 text-xs text-slate-500"><Bot className="h-3.5 w-3.5" /> Generated by {result.model}. Review before keeping it.</p>
          <Button
            size="sm"
            onClick={() => {
              editor.chain().focus().insertContentAt(selection ? { from: editor.state.selection.from, to: editor.state.selection.to } : editor.state.selection.from, selection ? result.text : normalizeSuggestion(preceding, result.text)).run();
              onClose();
            }}
          >
            {selection ? "Replace selection" : "Insert at cursor"}
          </Button>
        </div>
      )}
    </Modal>
  );
}

function CheckPanel({ documentId, span }: { documentId: string; span: Span | null }) {
  const check = useMutation({ mutationFn: (text: string) => api.post<GroundedAnswer>(`/documents/${documentId}/check`, { text }) });
  const text = span?.text.trim().slice(0, 2000) ?? "";
  const { mutate } = check;
  useEffect(() => {
    if (text.length >= 3) mutate(text);
  }, [span, text, mutate]);
  if (!span) return <p className="text-sm text-slate-600">Select a sentence or paragraph in your draft and choose “Check against my sources”.</p>;
  return (
    <div className="space-y-3">
      <blockquote className="max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 font-serif text-sm text-slate-800">{text}</blockquote>
      <p className="text-xs text-slate-500">Compared with this document’s sources (or your library if the document has none yet). Every statement below quotes the source it relies on.</p>
      {check.isPending && <Spinner label="Reading your sources" />}
      {check.error && <AIError error={check.error} />}
      {check.data && <GroundedAnswerView answer={check.data} />}
    </div>
  );
}

export default function EditorPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const styles = useStyles();
  const docQuery = useQuery({ queryKey: ["document", id], queryFn: () => api.get<ResearchDocument>(`/documents/${id}`), refetchOnMount: "always", staleTime: 0 });
  const [title, setTitle] = useState("");
  const [style, setStyle] = useState("apa");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  // The side panel is open by default only where there is room for it next to the page.
  const [panel, setPanel] = useState<Panel | null>(() =>
    typeof window.matchMedia === "function" && !window.matchMedia("(min-width: 1024px)").matches ? null : "sources",
  );
  const [exportError, setExportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); // exporting or restoring: editing paused
  // Below the lg breakpoint the side panel is a modal drawer over the page, with dialog focus behaviour.
  const [narrow, setNarrow] = useState(() => typeof window.matchMedia === "function" && !window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setNarrow(!query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const drawerRef = useRef<HTMLElement>(null);
  useDialogFocus(drawerRef, Boolean(panel) && narrow, () => setPanel(null));
  const [aiOpen, setAiOpen] = useState(false);
  const aiStatus = useQuery({ queryKey: ["ai-status"], queryFn: () => api.get<AIStatus>("/ai/status"), staleTime: 10 * 60_000 });
  const aiEnabled = Boolean(aiStatus.data?.enabled);
  const [autocomplete, setAutocomplete] = usePreference<boolean>("editor_suggestions", true);
  const [citeRequest, setCiteRequest] = useState<CiteRequest | null>(null);
  const [checkSpan, setCheckSpan] = useState<Span | null>(null);
  const openCiteRef = useRef<(pos: number) => void>(() => undefined);
  const [rendered, setRendered] = useState<RenderedCitations | null>(null);
  const versionRef = useRef<number>(1);
  const timer = useRef<number | undefined>(undefined);
  const retryTimer = useRef<number | undefined>(undefined);
  const scheduleRef = useRef<() => void>(() => undefined);
  const sendRef = useRef<(fields: Fields) => Promise<void>>(async () => undefined);
  // One serial queue per editor: saves never overlap, failures keep their edits, conflicts stop autosave.
  const queue = useRef<SaveQueue | null>(null);
  if (queue.current === null) {
    queue.current = new SaveQueue(
      (fields) => sendRef.current(fields),
      (error) => error instanceof ApiError && error.status === 409,
      {
        onStart: () => setSaveState("saving"),
        onSaved: (hasMore) => {
          setSaveState(hasMore ? "dirty" : "saved");
          if (hasMore) scheduleRef.current(); // edits made while the request was in flight
        },
        onError: (_error, conflict) => {
          setSaveState(conflict ? "conflict" : "error");
          if (!conflict) {
            window.clearTimeout(retryTimer.current);
            retryTimer.current = window.setTimeout(() => scheduleRef.current(), 10_000);
          }
        },
      },
    );
  }
  const saves = queue.current;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Underline,
      Link.configure({ openOnClick: false, protocols: ["http", "https", "mailto"] }),
      Placeholder.configure({ placeholder: "Start writing… Type /cite to cite a source." }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      CitationNode,
      GhostText,
      CiteTrigger.configure({ onTrigger: (pos: number) => openCiteRef.current(pos) }),
    ],
    content: "",
    onUpdate: ({ editor: ed, transaction }) => {
      if (transaction.getMeta(LABEL_META)) return;
      saves.update({ content: ed.getJSON() as JSONContent });
      scheduleRef.current();
    },
  });

  const refreshCitations = useCallback(async () => {
    if (!editor) return;
    try {
      const result = await api.get<RenderedCitations>(`/documents/${id}/rendered-citations`);
      setRendered(result);
      applyCitationLabels(editor, result);
    } catch {
      /* citation preview is best-effort; saving is unaffected */
    }
  }, [editor, id]);

  sendRef.current = async (fields) => {
    const saved = await api.patch<ResearchDocument>(`/documents/${id}`, { base_version: versionRef.current, ...fields });
    versionRef.current = saved.version;
    queryClient.setQueryData(["document", id], saved);
    void refreshCitations();
  };

  /** Save now (behind any running save). Resolves true only if the server has every edit. */
  const flush = useCallback((): Promise<boolean> => {
    window.clearTimeout(timer.current);
    return saves.flush();
  }, [saves]);

  const scheduleSave = useCallback(() => {
    setSaveState((state) => (state === "conflict" ? state : "dirty"));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 1200);
  }, [flush]);
  scheduleRef.current = scheduleSave;

  // Load the document once (later refetches must not clobber local edits).
  const loaded = useRef(false);
  useEffect(() => {
    if (!editor || !docQuery.data || loaded.current) return;
    loaded.current = true;
    versionRef.current = docQuery.data.version;
    setTitle(docQuery.data.title);
    setStyle(docQuery.data.csl_style);
    editor.commands.setContent(docQuery.data.content, { emitUpdate: false });
    void refreshCitations();
  }, [editor, docQuery.data, refreshCitations]);

  // Save on tab close / navigation; warn while anything is unsaved OR still being sent.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (saves.dirty || saves.inFlight) {
        void flush();
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.clearTimeout(retryTimer.current);
      void flush();
    };
  }, [flush, saves]);

  const reloadLatest = async () => {
    const latest = await api.get<ResearchDocument>(`/documents/${id}`);
    saves.discard();
    saves.resolveConflict();
    versionRef.current = latest.version;
    setTitle(latest.title);
    setStyle(latest.csl_style);
    editor?.commands.setContent(latest.content, { emitUpdate: false });
    setSaveState("saved");
    void refreshCitations();
  };
  const keepMine = async () => {
    const latest = await api.get<ResearchDocument>(`/documents/${id}`);
    versionRef.current = latest.version;
    saves.update({ content: editor?.getJSON() as JSONContent, title, csl_style: style });
    saves.resolveConflict();
    await flush();
  };

  /** Run `task` with editing paused, so the text cannot change between "everything is saved" and the action. */
  const frozen = async <T,>(task: () => Promise<T>): Promise<T> => {
    editor?.setEditable(false);
    setBusy(true);
    try {
      return await task();
    } finally {
      editor?.setEditable(true);
      setBusy(false);
    }
  };

  /** Restore: save pending edits first (or discard them only with explicit consent), then restore that version. */
  const restoreRevision = (revisionId: string) =>
    frozen(async () => {
      if (!(await flush())) {
        if (saves.conflicted) {
          window.alert("Resolve the editing conflict shown above before restoring a version.");
          return;
        }
        if (!window.confirm("Your latest changes could not be saved. Restore anyway and discard them?")) return;
        saves.discard();
      }
      const doc = await api.post<ResearchDocument>(`/documents/${id}/revisions/${revisionId}/restore`, { base_version: versionRef.current });
      versionRef.current = doc.version;
      saves.discard();
      setTitle(doc.title);
      setStyle(doc.csl_style);
      editor?.commands.setContent(doc.content, { emitUpdate: false });
      setSaveState("saved");
      queryClient.setQueryData(["document", id], doc);
      void queryClient.invalidateQueries({ queryKey: ["revisions", id] });
      void refreshCitations();
    });

  const exportAs = (format: string) =>
    frozen(async () => {
      setExportError(null);
      if (!(await flush())) {
        setExportError("Your latest changes are not saved yet, so the export would be out of date. Resolve the save problem, then export again.");
        return;
      }
      try {
        await downloadFile(`/documents/${id}/export`, `${title || "document"}.${format}`, { format });
      } catch (error) {
        setExportError(errorMessage(error));
      }
    });

  openCiteRef.current = (pos: number) => {
    if (!busy) setCiteRequest({ pos });
  };
  const suggestionStatus = useAutocomplete(editor, id, aiEnabled && autocomplete && !busy && !citeRequest);

  if (docQuery.isLoading || !editor) return <Spinner label="Opening document" />;
  if (docQuery.error) return <div className="p-8"><Alert kind="error">{errorMessage(docQuery.error)}</Alert></div>;

  const status = { saved: ["Saved", "green"], dirty: ["Unsaved changes", "slate"], saving: ["Saving…", "blue"], conflict: ["Conflict", "red"], error: ["Save failed — retrying on next edit", "red"] } as const;
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <RouterLink to="/documents" className="rounded p-1.5 text-slate-600 hover:bg-slate-100" aria-label="Back to documents"><ArrowLeft className="h-4 w-4" /></RouterLink>
        <input
          value={title}
          maxLength={300}
          aria-label="Document title"
          disabled={busy}
          onChange={(e) => { setTitle(e.target.value); saves.update({ title: e.target.value }); scheduleSave(); }}
          className="min-w-0 flex-1 truncate rounded px-2 py-1 text-lg font-semibold text-slate-900 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        <Badge tone={status[saveState][1]}>{status[saveState][0]}</Badge>
        <HelpButton section="editor" label="How to write here" className="hidden sm:flex" />
        <Select className="w-28 py-1.5 sm:w-52" value={style} aria-label="Citation style" disabled={busy} onChange={(e) => { setStyle(e.target.value); saves.update({ csl_style: e.target.value }); void flush(); }}>
          <StyleOptions styles={styles.data} />
        </Select>
        <Button size="sm" variant={panel === "sources" ? "primary" : "secondary"} onClick={() => setPanel(panel === "sources" ? null : "sources")} aria-label="Sources"><BookMarked className="h-4 w-4" /> <span className="hidden sm:inline">Sources</span></Button>
        <Button size="sm" variant={panel === "pdf" ? "primary" : "secondary"} onClick={() => setPanel(panel === "pdf" ? null : "pdf")} aria-label="PDF beside draft"><FileText className="h-4 w-4" /> <span className="hidden xl:inline">PDF</span></Button>
        {aiEnabled && <Button size="sm" variant={panel === "check" ? "primary" : "secondary"} onClick={() => setPanel(panel === "check" ? null : "check")} aria-label="Check against sources"><ScanSearch className="h-4 w-4" /></Button>}
        <Button size="sm" variant={panel === "history" ? "primary" : "secondary"} onClick={() => setPanel(panel === "history" ? null : "history")} aria-label="Version history"><History className="h-4 w-4" /></Button>
        <Select
          className="w-24 py-1.5 sm:w-32"
          value=""
          aria-label="Export"
          onChange={(e) => {
            if (e.target.value) void exportAs(e.target.value);
          }}
        >
          <option value="">Export…</option>
          <option value="docx">Word (.docx)</option>
          <option value="pdf">PDF</option>
        </Select>
      </header>
      {exportError && (
        <div className="mx-auto max-w-4xl px-4 pt-4">
          <Alert kind="error" title="Export not started">{exportError}</Alert>
        </div>
      )}
      {saveState === "conflict" && (
        <div className="mx-auto max-w-4xl px-4 pt-4">
          <Alert kind="error" title="This document was edited in another tab or device">
            Choose which version to keep.
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void reloadLatest()}>Load the other version</Button>
              <Button size="sm" variant="danger" onClick={() => void keepMine()}>Keep my version</Button>
            </div>
          </Alert>
        </div>
      )}
      <div className="flex">
        <div className="min-w-0 flex-1">
          <Toolbar
            editor={editor}
            onAI={() => setAiOpen(true)}
            onCite={() => !busy && setCiteRequest({ pos: editor.state.selection.to })}
            aiEnabled={aiEnabled}
            autocomplete={autocomplete}
            onToggleAutocomplete={() => setAutocomplete(!autocomplete)}
            autocompleteStatus={suggestionStatus}
          />
          <p className="sr-only" aria-live="polite">{suggestionStatus === "ready" ? "Suggestion shown after the cursor. Press Tab to accept or Escape to dismiss." : ""}</p>
          <SectionGuide section="editor" className="mx-3 mb-0 mt-4 max-w-[820px] sm:mx-auto" />
          <div className="mx-auto my-4 max-w-[820px] rounded-lg bg-white px-5 py-6 shadow-sm sm:my-6 sm:px-12 sm:py-10">
            <EditorContent editor={editor} />
            {rendered && rendered.bibliography.length > 0 && (
              <section className="mt-10 border-t border-slate-200 pt-6">
                <h2 className="mb-3 font-serif text-xl font-bold">References</h2>
                <ol className="space-y-2 font-serif text-[15px] leading-relaxed">
                  {rendered.bibliography.map((entry, index) => (
                    <li key={index} className="pl-6 -indent-6" dangerouslySetInnerHTML={{ __html: sanitizeHtml(entry) }} />
                  ))}
                </ol>
                <p className="mt-3 text-xs text-slate-400">Generated automatically in {styles.data?.find((s) => s.id === style)?.title ?? style}. Only cited works are listed.</p>
              </section>
            )}
          </div>
        </div>
        {panel && (
          <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" aria-hidden onClick={() => setPanel(null)} />
        )}
        {panel && (
          <aside
            ref={drawerRef}
            role={narrow ? "dialog" : undefined}
            aria-modal={narrow ? true : undefined}
            aria-label={PANEL_TITLES[panel]}
            className={`fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-slate-200 bg-white p-4 shadow-xl lg:sticky lg:top-14 lg:z-auto lg:h-[calc(100vh-3.5rem)] lg:max-w-none lg:shrink-0 lg:shadow-none ${panel === "pdf" ? "max-w-xl lg:w-[30rem]" : "max-w-sm overflow-y-auto lg:w-80"}`}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">{PANEL_TITLES[panel]}</h2>
              <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Close panel" onClick={() => setPanel(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {panel === "sources" && <SourcesPanel documentId={id} editor={editor} onInserted={() => void flush()} />}
              {panel === "pdf" && (
                <Suspense fallback={<Spinner label="Loading the PDF viewer" />}>
                  <PdfPanel editor={editor} documentId={id} onInserted={() => void flush()} />
                </Suspense>
              )}
              {panel === "check" && <CheckPanel documentId={id} span={checkSpan} />}
              {panel === "history" && <RevisionsPanel documentId={id} onRestore={restoreRevision} />}
            </div>
          </aside>
        )}
      </div>
      <SelectionMenu
        editor={editor}
        aiEnabled={aiEnabled}
        disabled={busy || Boolean(citeRequest) || aiOpen}
        onFindSource={(span) => setCiteRequest({ pos: span.to, query: queryFromSelection(span.text) })}
        onCheck={(span) => {
          setCheckSpan({ ...span });
          setPanel("check");
        }}
      />
      {citeRequest && (
        <CitePalette editor={editor} documentId={id} request={citeRequest} onClose={() => setCiteRequest(null)} onInserted={() => void flush()} />
      )}
      {aiOpen && <AIAssistModal editor={editor} documentId={id} open={aiOpen} onClose={() => setAiOpen(false)} />}
    </div>
  );
}
