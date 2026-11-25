import { useQueries, useQuery } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { authorLine } from "@/lib/format";
import type { Citation, Paper } from "@/lib/types";

export interface CitationTarget {
  ids: string[];
  /** Where the clicked citation is on screen (the popover opens below it, or above when there is no room). */
  rect: { left: number; top: number; bottom: number };
}

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
export function CitationPopover({ documentId, target, onClose }: { documentId: string; target: CitationTarget; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const citations = useQuery({
    queryKey: ["citations", documentId],
    queryFn: () => api.get<Citation[]>(`/documents/${documentId}/citations`),
    staleTime: 30_000,
  });
  const cited = target.ids.map((id) => citations.data?.find((c) => c.id === id)).filter((c): c is Citation => Boolean(c));
  const papers = useQueries({
    queries: cited.map((c) => ({ queryKey: ["paper", c.paper_id], queryFn: () => api.get<Paper>(`/papers/${c.paper_id}`), staleTime: 60_000 })),
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  // Below the citation; above it when the popover would run off the bottom of the window (measured once drawn).
  const [above, setAbove] = useState(false);
  const loaded = papers.every((p) => !p.isLoading) && !citations.isLoading;
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    setAbove(target.rect.bottom + 6 + height > window.innerHeight - 8 && target.rect.top - 6 - height >= 8);
  }, [target, loaded]);
  const left = Math.max(8, Math.min(target.rect.left, window.innerWidth - 360));
  const position = above ? { bottom: window.innerHeight - target.rect.top + 6, left } : { top: target.rect.bottom + 6, left };
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Cited source"
      className="fixed z-50 w-[min(340px,calc(100vw-16px))] rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg"
      style={position}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cited source{target.ids.length > 1 ? "s" : ""}</span>
        <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {(citations.isLoading || papers.some((p) => p.isLoading)) && <Spinner label="Loading source" />}
      {citations.isSuccess && !cited.length && <p className="text-slate-600">This citation's source is no longer available.</p>}
      <ul className="space-y-3">
        {cited.map((citation, index) => {
          const paper = papers[index]?.data;
          if (!paper) return null;
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
