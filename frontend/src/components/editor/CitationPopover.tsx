import { useQueries, useQuery, type QueryClient } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Spinner } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { authorLine } from "@/lib/format";
import type { Citation, Paper } from "@/lib/types";

const citationsKey = (documentId: string) => ["citations", documentId];

/**
 * Add a citation the editor has just created to the document's cached citation list, so opening it at once shows
 * its source (audit SF11). Every path that creates a citation calls this: the cite palette, the Sources panel and
 * the PDF quote.
 */
export function rememberCitation(queryClient: QueryClient, documentId: string, citation: Citation): void {
  queryClient.setQueryData<Citation[]>(citationsKey(documentId), (list) =>
    list ? [...list.filter((c) => c.id !== citation.id), citation] : list,
  );
}

export interface CitationTarget {
  ids: string[];
  /** Where the clicked citation is on screen (the popover opens below it, or above when there is no room). */
  rect: { left: number; top: number; bottom: number };
  /** Opened from the keyboard: the dialog takes focus so its links can be reached with Tab (audit SF13). */
  fromKeyboard?: boolean;
}

/** How the popover was closed: Escape or its button return focus to the editor; a click elsewhere does not. */
export type CloseReason = "escape" | "button" | "outside";

/** A page locator as the reader expects it: "12" → "p. 12", "12-14" → "pp. 12-14"; anything else as written. */
export function pageLabel(locator: string): string {
  const value = locator.trim();
  if (/^\d+[a-z]?$/i.test(value)) return `p. ${value}`;
  if (/^\d+\s*[-–]\s*\d+$/.test(value)) return `pp. ${value}`;
  return value;
}

/**
 * The source(s) behind an in-text citation, with links to the paper's page and its DOI (both in a new tab), so a
 * citation in a draft can always be followed back to what it cites (Silver, 25 November 2026).
 */
export function CitationPopover({ documentId, target, onClose }: { documentId: string; target: CitationTarget; onClose: (reason: CloseReason) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const citations = useQuery({
    queryKey: citationsKey(documentId),
    queryFn: () => api.get<Citation[]>(`/documents/${documentId}/citations`),
    staleTime: 30_000,
  });
  const cited = target.ids.map((id) => citations.data?.find((c) => c.id === id)).filter((c): c is Citation => Boolean(c));
  // A citation the cached list does not know yet (created since it was fetched): refresh the list once before
  // saying the source is unavailable (audit SF11).
  const refreshed = useRef(false);
  const missing = citations.isSuccess && cited.length < target.ids.length;
  useEffect(() => {
    if (missing && !refreshed.current) {
      refreshed.current = true;
      void citations.refetch();
    }
  }, [missing, citations]);
  const papers = useQueries({
    queries: cited.map((c) => ({ queryKey: ["paper", c.paper_id], queryFn: () => api.get<Paper>(`/papers/${c.paper_id}`), staleTime: 60_000 })),
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose("escape");
      }
    };
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose("outside");
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  // Below the citation; above it when there is more room there. Content taller than the room on either side scrolls
  // inside a window-bounded panel, so several sources stay usable on a short screen (audit SF13).
  const [above, setAbove] = useState(false);
  const roomBelow = window.innerHeight - target.rect.bottom - 14;
  const roomAbove = target.rect.top - 14;
  const loaded = papers.every((p) => !p.isLoading) && !citations.isLoading;
  useLayoutEffect(() => {
    const height = ref.current?.scrollHeight ?? 0;
    setAbove(height > roomBelow && roomAbove > roomBelow);
  }, [target, loaded, roomBelow, roomAbove]);
  useEffect(() => {
    if (target.fromKeyboard) ref.current?.focus();
  }, [target]);
  const left = Math.max(8, Math.min(target.rect.left, window.innerWidth - 360));
  const position = {
    left,
    maxHeight: Math.max(120, above ? roomAbove : roomBelow),
    ...(above ? { bottom: window.innerHeight - target.rect.top + 6 } : { top: target.rect.bottom + 6 }),
  };
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Cited source"
      tabIndex={-1}
      className="fixed z-50 w-[min(340px,calc(100vw-16px))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg outline-none"
      style={position}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cited source{target.ids.length > 1 ? "s" : ""}</span>
        <button type="button" onClick={() => onClose("button")} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {(citations.isLoading || papers.some((p) => p.isLoading)) && <Spinner label="Loading source" />}
      {citations.isError && <p className="text-slate-600">The source could not be loaded. Close this and try again.</p>}
      {citations.isSuccess && !citations.isFetching && refreshed.current && missing && !cited.length && (
        <p className="text-slate-600">This citation's source is no longer available.</p>
      )}
      <ul className="space-y-3">
        {cited.map((citation, index) => {
          const query = papers[index];
          const paper = query?.data;
          if (!paper) {
            if (!query?.isError) return null; // still loading
            // A paper that is gone (or no longer visible to this account) differs from a request that failed.
            const gone = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 403);
            return (
              <li key={citation.id} className="text-slate-600">
                {gone ? "This source is no longer in PaperAid or is no longer available to you." : "This source could not be loaded right now."}
                {!gone && (
                  <button type="button" className="ml-2 text-brand-700 underline" onClick={() => void query.refetch()}>Retry</button>
                )}
              </li>
            );
          }
          return (
            <li key={citation.id}>
              <p className="font-medium text-slate-900">{paper.title}</p>
              <p className="text-xs text-slate-500">
                {authorLine(paper.authors)} · {paper.year ?? "n.d."}
                {citation.locator ? ` · ${pageLabel(citation.locator)}` : ""}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-3">
                <a href={`/papers/${paper.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                  Open paper <ExternalLink className="h-3 w-3" />
                </a>
                {paper.doi && (
                  <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                    Open DOI <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
