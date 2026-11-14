import { useMutation, useQuery } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import { Loader2, Quote, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { useLibrarySearch } from "@/components/papers";
import { Alert, Select, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { Citation, Paper } from "@/lib/types";

import { insertCitationAt } from "./CitePalette";
import { openPdf, renderPage, type PdfDocument } from "./pdfDocument";

export const MAX_QUOTE = 600;

/** Text selected in a PDF text layer, as one clean line (joins hyphenated line breaks, collapses whitespace). */
export function cleanPdfQuote(raw: string): string {
  return raw.replace(/(\w)-\s*\n\s*(?=[a-z])/g, "$1").replace(/\s+/g, " ").trim();
}

function PdfPage({ pdf, number, width }: { pdf: PdfDocument; number: number; width: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(number <= 2);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (visible || !holder.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "800px 0px" });
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !canvas.current || !text.current || width < 50) return;
    const controller = new AbortController();
    setFailed(false);
    renderPage(pdf, number, canvas.current, text.current, width, controller.signal).catch(() => setFailed(true));
    return () => controller.abort();
  }, [pdf, number, width, visible]);

  return (
    <div ref={holder} data-page={number} className="pdf-page relative mx-auto mb-3 bg-white shadow-sm ring-1 ring-slate-200" style={{ width, minHeight: Math.round(width * 1.29) }}>
      <canvas ref={canvas} aria-hidden className="block" />
      <div ref={text} className="textLayer" />
      {failed && <p className="absolute inset-x-0 top-1/3 text-center text-xs text-slate-500">Page {number} could not be displayed.</p>}
      <span className="pointer-events-none absolute bottom-1 right-2 select-none text-[10px] text-slate-400">{number}</span>
    </div>
  );
}

/**
 * A source's PDF beside the draft. Select words on a page, then cite that page (or quote the words and cite
 * them) at the cursor in the draft. The page number is the PDF's page; it can be corrected before citing when the
 * printed page numbers differ.
 */
export default function PdfPanel({ editor, documentId, onInserted }: { editor: Editor; documentId: string; onInserted: () => void }) {
  const sources = useQuery({ queryKey: ["document-sources", documentId], queryFn: () => api.get<Paper[]>(`/documents/${documentId}/sources`) });
  const library = useLibrarySearch("", 50);
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    return [...(sources.data ?? []), ...(library.data?.items ?? []).map((i) => i.paper)].filter((p) => p.has_pdf && !seen.has(p.id) && Boolean(seen.add(p.id)));
  }, [sources.data, library.data]);
  const [paperId, setPaperId] = useState<string>("");
  useEffect(() => {
    if (!paperId && candidates[0]) setPaperId(candidates[0].id);
  }, [candidates, paperId]);

  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!paperId) return;
    let cancelled = false;
    let destroy: (() => void) | undefined;
    setPdf(null);
    setLoadError(null);
    setLoading(true);
    setPick(null);
    (async () => {
      try {
        const blob = await api.blob(`/papers/${paperId}/pdf`);
        if (cancelled) return;
        const task = openPdf(await blob.arrayBuffer());
        destroy = task.destroy;
        const doc = await task.promise;
        if (!cancelled) setPdf(doc);
      } catch (error) {
        if (!cancelled) setLoadError(errorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [paperId]);

  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(0, el.clientWidth - 16));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pdf]);

  const [pick, setPick] = useState<{ text: string; page: number } | null>(null);
  const [locator, setLocator] = useState("");
  const capture = () => {
    const selection = window.getSelection();
    const raw = selection?.toString() ?? "";
    const node = selection?.anchorNode;
    const page = node && scroller.current?.contains(node) ? (node instanceof Element ? node : node.parentElement)?.closest("[data-page]") : null;
    const text = cleanPdfQuote(raw);
    if (!page || !text) return;
    const number = Number(page.getAttribute("data-page"));
    setPick({ text, page: number });
    setLocator(String(number));
  };

  const cite = useMutation({
    mutationFn: async ({ quote }: { quote: boolean }) => {
      const citation = await api.post<Citation>(`/documents/${documentId}/citations`, { paper_id: paperId, locator: locator.trim() || null });
      return { citation, quote };
    },
    onSuccess: ({ citation, quote }) => {
      const pos = editor.state.selection.to;
      if (quote && pick) {
        editor.chain().focus().insertContentAt(pos, [{ type: "text", text: `“${pick.text}” ` }]).run();
        insertCitationAt(editor, pos + pick.text.length + 3, citation.id);
      } else insertCitationAt(editor, pos, citation.id);
      window.getSelection()?.removeAllRanges();
      setPick(null);
      onInserted();
    },
  });

  if (sources.isLoading || library.isLoading) return <Spinner label="Finding your PDFs" />;
  if (!candidates.length)
    return (
      <p className="text-sm text-slate-600">
        None of your sources has a PDF yet. Open a paper from your <Link className="text-brand-700 underline" to="/library">library</Link> and retrieve its open-access PDF or upload your copy; it will appear here.
      </p>
    );

  const paper = candidates.find((p) => p.id === paperId);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Select value={paperId} onChange={(e) => setPaperId(e.target.value)} aria-label="PDF to show">
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>{p.title.length > 80 ? `${p.title.slice(0, 80)}…` : p.title}</option>
        ))}
      </Select>
      {paper && <p className="-mt-1 text-xs text-slate-500">{paper.authors[0] ?? "Unknown author"}{paper.authors.length > 1 ? " et al." : ""} · {paper.year ?? "n.d."}{pdf ? ` · ${pdf.numPages} pages` : ""}</p>}
      {loadError && <Alert kind="error" title="The PDF could not be opened">{loadError}</Alert>}
      <div ref={scroller} onMouseUp={capture} onKeyUp={capture} className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-slate-100 p-2" aria-label="PDF pages" tabIndex={0}>
        {loading && <Spinner label="Opening PDF" />}
        {pdf && width > 0 && Array.from({ length: pdf.numPages }, (_, i) => <PdfPage key={`${paperId}-${i + 1}`} pdf={pdf} number={i + 1} width={width} />)}
      </div>
      {pdf && !pick && <p className="text-xs text-slate-500">Select words on a page to cite that page or quote them in your draft.</p>}
      {pick && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm" role="region" aria-label="Cite the selected words">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-3 font-serif text-sm text-slate-800">“{pick.text}”</p>
            <button type="button" className="rounded p-0.5 text-slate-400 hover:bg-slate-100" aria-label="Clear selection" onClick={() => setPick(null)}><X className="h-3.5 w-3.5" /></button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            Page
            <input value={locator} onChange={(e) => setLocator(e.target.value)} maxLength={50} className="w-20 rounded-md border border-slate-200 px-2 py-1 text-xs" />
            <span className="text-slate-400">PDF page; change it if the printed number differs</span>
          </label>
          {cite.error && <div className="mt-2"><Alert kind="error">{errorMessage(cite.error)}</Alert></div>}
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={cite.isPending} onClick={() => cite.mutate({ quote: false })} className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
              {cite.isPending && !cite.variables?.quote && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              Cite{locator.trim() ? ` p. ${locator.trim()}` : ""}
            </button>
            <button
              type="button"
              disabled={cite.isPending || pick.text.length > MAX_QUOTE}
              title={pick.text.length > MAX_QUOTE ? "Select a shorter passage to quote it" : undefined}
              onClick={() => cite.mutate({ quote: true })}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            >
              {cite.isPending && cite.variables?.quote ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Quote className="h-3.5 w-3.5" aria-hidden />}
              Quote and cite
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Inserted at your cursor in the draft.</p>
        </div>
      )}
    </div>
  );
}
