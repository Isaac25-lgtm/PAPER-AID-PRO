import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import { Loader2, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { useLibrarySearch } from "@/components/papers";
import { Alert } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { trackPosition, useEditGate } from "@/lib/editGate";
import { PROVIDER_LABELS, type Citation, type Paper, type SearchResponse, type Work } from "@/lib/types";

export interface CiteRequest {
  /** Document position where the citation is inserted. */
  pos: number;
  /** Initial search text (e.g. the selected sentence for "Find a source"). */
  query?: string;
  /**
   * Where the initial text came from. Text taken from the draft ("selection") is searched in the person's own
   * library only; it is sent to the external scholarly indexes only after they review it and choose to.
   */
  origin?: "selection" | "typed";
}

type Option = { kind: "library"; paper: Paper } | { kind: "work"; work: Work };

const WIDTH = 460;
const MIN_ALL_SOURCES_QUERY = 3;

function byline(authors: string[], year: number | null): string {
  const first = authors[0] ?? "Unknown author";
  return `${first}${authors.length > 1 ? " et al." : ""} · ${year ?? "n.d."}`;
}

/** Insert a citation node at `pos`, with a space after it unless punctuation or a space already follows. */
export function insertCitationAt(editor: Editor, pos: number, citationId: string, options: { before?: string } = {}): void {
  const at = Math.max(0, Math.min(pos, editor.state.doc.content.size));
  const next = editor.state.doc.textBetween(at, Math.min(at + 1, editor.state.doc.content.size), "", "");
  const content: Array<Record<string, unknown>> = [];
  if (options.before) content.push({ type: "text", text: options.before });
  content.push({ type: "citation", attrs: { citationIds: [citationId] } });
  if (!/^[\s.,;:!?)\]]/.test(next)) content.push({ type: "text", text: " " });
  // One transaction: a quotation and its citation can never be separated or interleaved with another edit.
  editor.chain().focus().insertContentAt(at, content).run();
}

/** Short search text from a selected passage: the first words, without citation labels or punctuation runs. */
export function queryFromSelection(text: string): string {
  return text.replace(/\([^)]*\d{4}[^)]*\)/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 14).join(" ").slice(0, 200);
}

/**
 * Cite while writing: one search box over the writer's library and every scholarly index. Picking a library
 * paper cites it; picking any other result imports it (registry metadata, added to the library) and cites it.
 */
export function CitePalette({
  editor,
  documentId,
  request,
  onClose,
  onInserted,
}: {
  editor: Editor;
  documentId: string;
  request: CiteRequest;
  onClose: () => void;
  onInserted: () => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState(request.query ?? "");
  // External search is armed for words the person types; draft text must be confirmed first.
  const [externalAllowed, setExternalAllowed] = useState(request.origin !== "selection");
  const [locator, setLocator] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [debounced, setDebounced] = useState(query.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 450);
    return () => window.clearTimeout(timer);
  }, [query]);

  const library = useLibrarySearch(query, 5);
  const everywhere = useQuery({
    queryKey: ["cite-search", debounced],
    queryFn: ({ signal }) => api.get<SearchResponse>("/discovery/search", { q: debounced, limit: 6 }, signal),
    enabled: externalAllowed && debounced.length >= MIN_ALL_SOURCES_QUERY,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const options = useMemo<Option[]>(() => {
    const papers = (library.data?.items ?? []).map((i) => i.paper);
    const mine = new Set(papers.map((p) => p.id));
    const mineDois = new Set(papers.map((p) => p.doi?.toLowerCase()).filter(Boolean));
    const works = (everywhere.data?.results ?? []).filter(
      (w) => !(w.library_paper_id && mine.has(w.library_paper_id)) && !(w.doi && mineDois.has(w.doi.toLowerCase())),
    );
    return [...papers.map((paper) => ({ kind: "library" as const, paper })), ...works.map((work) => ({ kind: "work" as const, work }))];
  }, [library.data, everywhere.data]);

  useEffect(() => setActive(0), [debounced]);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const gate = useEditGate();
  const cite = useMutation({
    // Part of the export/restore gate; the insertion point follows any edits made while the request runs.
    mutationFn: (option: Option) =>
      gate.run(async () => {
        const target = trackPosition(editor, request.pos);
        try {
          let paperId: string;
          if (option.kind === "library") paperId = option.paper.id;
          else {
            if (!option.work.identifier) throw new Error("This result has no DOI or other identifier, so it cannot be cited automatically. Add it from the Library page.");
            const paper = await api.post<Paper>("/papers/import", { identifier: option.work.identifier, add_to_library: true });
            paperId = paper.id;
            void queryClient.invalidateQueries({ queryKey: ["library"] });
          }
          const citation = await api.post<Citation>(`/documents/${documentId}/citations`, { paper_id: paperId, locator: locator.trim() || null });
          insertCitationAt(editor, target.pos, citation.id);
          return citation;
        } finally {
          target.stop();
        }
      }),
    onSuccess: () => {
      onInserted();
      onClose();
    },
  });

  const close = () => {
    onClose();
    editor.commands.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      const option = options[active];
      if (option && !cite.isPending) cite.mutate(option);
    }
  };

  // Place the palette under the insertion point (above it when there is no room), inside the viewport.
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    const narrow = window.innerWidth < 640;
    if (narrow) {
      setStyle({ left: 16, right: 16, top: 72 });
      return;
    }
    let rect = { top: 120, bottom: 120, left: (window.innerWidth - WIDTH) / 2 };
    try {
      rect = editor.view.coordsAtPos(Math.min(request.pos, editor.state.doc.content.size));
    } catch {
      /* position not rendered (e.g. in tests): fall back to the centre */
    }
    const left = Math.max(16, Math.min(rect.left - 24, window.innerWidth - WIDTH - 16));
    const below = window.innerHeight - rect.bottom;
    setStyle(below >= 360 || below >= rect.top ? { left, top: rect.bottom + 8, width: WIDTH } : { left, bottom: window.innerHeight - rect.top + 8, width: WIDTH });
  }, [editor, request.pos]);

  const optionId = (i: number) => `cite-option-${i}`;
  const libraryCount = options.filter((o) => o.kind === "library").length;
  const searching = everywhere.isFetching || library.isFetching;
  const noResults = !searching && options.length === 0 && query.trim().length > 0;

  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden onMouseDown={close} />
      <div
        role="dialog"
        aria-label="Cite a source"
        className="fixed z-50 flex max-h-[min(30rem,calc(100vh-6rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        style={style}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
          {searching ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden /> : <Search className="h-4 w-4 text-slate-400" aria-hidden />}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setExternalAllowed(true); // the person is now writing their own search
            }}
            placeholder="Search your library and all sources"
            aria-label="Search sources to cite"
            role="combobox"
            aria-expanded={options.length > 0}
            aria-controls="cite-options"
            aria-activedescendant={options.length ? optionId(active) : undefined}
            className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-slate-900 outline-none placeholder:text-slate-500"
            maxLength={300}
          />
          <input
            value={locator}
            onChange={(e) => setLocator(e.target.value)}
            placeholder="Page"
            aria-label="Page (optional)"
            maxLength={50}
            className="w-16 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 outline-none focus:border-slate-400"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {cite.error && <div className="p-1.5"><Alert kind="error">{errorMessage(cite.error)}</Alert></div>}
          {!externalAllowed && query.trim().length >= MIN_ALL_SOURCES_QUERY && (
            <div className="m-1 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
              <p>Showing matches from your library only. Searching all sources sends these words to OpenAlex, Crossref and other scholarly indexes:</p>
              <p className="mt-1 font-medium text-slate-900">“{query.trim()}”</p>
              <p className="mt-1">Edit them above first if they contain anything private.</p>
              <button type="button" onClick={() => setExternalAllowed(true)} className="mt-2 rounded-md bg-slate-900 px-2.5 py-1 font-medium text-white hover:bg-slate-800">
                Search all sources
              </button>
            </div>
          )}
          {everywhere.error && <p className="px-2.5 py-1.5 text-xs text-slate-500">Searching all sources failed: {errorMessage(everywhere.error)} Your library results are still shown.</p>}
          <ul id="cite-options" role="listbox" aria-label="Sources">
            {options.map((option, i) => {
              const isLibrary = option.kind === "library";
              const title = isLibrary ? option.paper.title : option.work.title;
              const meta = isLibrary
                ? `${byline(option.paper.authors, option.paper.year)} · in your library`
                : `${byline(option.work.authors, option.work.year)}${option.work.journal ? ` · ${option.work.journal}` : ""}${option.work.sources?.length ? ` · via ${option.work.sources.map((s) => PROVIDER_LABELS[s] ?? s).join(", ")}` : ""} · ${option.work.identifier ? "adds to your library" : "no identifier"}`;
              return (
                <li key={isLibrary ? option.paper.id : `${option.work.identifier ?? option.work.title}-${i}`}>
                  {i === libraryCount && libraryCount > 0 && <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">All sources</p>}
                  {i === 0 && isLibrary && <p className="px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Your library</p>}
                  <div
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    aria-disabled={!isLibrary && !option.work.identifier}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => !cite.isPending && cite.mutate(option)}
                    className={`flex cursor-pointer items-start justify-between gap-3 rounded-lg px-2.5 py-2 ${i === active ? "bg-slate-100" : ""}`}
                  >
                    <span className="min-w-0">
                      <span className="line-clamp-2 block text-sm text-slate-900">{title}</span>
                      <span className="block truncate text-xs text-slate-500">{meta}</span>
                    </span>
                    {cite.isPending && cite.variables === option ? (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-slate-500" aria-label="Citing" />
                    ) : (
                      i === active && <span className="mt-0.5 shrink-0 text-xs text-slate-500">↵ cite</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {noResults && debounced.length >= MIN_ALL_SOURCES_QUERY && !everywhere.isFetching && <p className="px-2.5 py-3 text-sm text-slate-500">No matching sources. Try different words or a DOI.</p>}
          {!query.trim() && libraryCount === 0 && <p className="px-2.5 py-3 text-sm text-slate-500">Type a few words of a title, an author or a topic.</p>}
          {externalAllowed && query.trim().length > 0 && debounced.length < MIN_ALL_SOURCES_QUERY && <p className="px-2.5 py-2 text-xs text-slate-500">Type at least {MIN_ALL_SOURCES_QUERY} characters to search all sources.</p>}
        </div>
        <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">↑↓ choose · Enter cite · Esc close · type <kbd className="font-mono">/cite</kbd> while writing to open this</p>
      </div>
    </>
  );
}
