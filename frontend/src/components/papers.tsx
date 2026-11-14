import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, FileCheck2, Lock, Unlock } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { api, errorMessage } from "@/lib/api";
import { authorLine, sanitizeHtml } from "@/lib/format";
import type { CitationStyle, LibraryItem, Paper, PaperStatus } from "@/lib/types";
import { Alert, Badge, Button, Modal, Select, Spinner } from "./ui";

export function StatusBadge({ status }: { status: PaperStatus }) {
  const map: Record<PaperStatus, [string, "slate" | "green" | "blue" | "amber" | "red"]> = {
    metadata_only: ["Metadata only", "slate"],
    queued: ["Queued", "blue"],
    processing: ["Processing", "blue"],
    ready: ["Full text", "green"],
    failed: ["Full text unavailable", "amber"],
  };
  const [label, tone] = map[status];
  return <Badge tone={tone}>{status === "ready" && <FileCheck2 className="h-3 w-3" />}{label}</Badge>;
}

export function PaperMeta({ paper }: { paper: Pick<Paper, "authors" | "year" | "journal"> }) {
  return (
    <p className="text-sm text-slate-600">
      {authorLine(paper.authors)}
      {paper.year ? ` · ${paper.year}` : ""}
      {paper.journal ? (
        <>
          {" · "}
          <span className="italic">{paper.journal}</span>
        </>
      ) : null}
    </p>
  );
}

export function PaperCard({ paper, actions }: { paper: Paper; actions?: React.ReactNode }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={paper.status} />
        {paper.is_open_access && (
          <Badge tone="green">
            <Unlock className="h-3 w-3" /> Open access
          </Badge>
        )}
        <UserSuppliedBadge paper={paper} />
        {paper.visibility === "private" && (
          <Badge tone="violet">
            <Lock className="h-3 w-3" /> Private
          </Badge>
        )}
        {paper.citation_count > 0 && <Badge>{paper.citation_count.toLocaleString()} citations</Badge>}
      </div>
      <h3 className="mt-2 font-serif text-lg font-semibold leading-snug text-slate-900">
        <Link to={`/papers/${paper.id}`} className="hover:text-brand-700">
          {paper.title}
        </Link>
      </h3>
      <PaperMeta paper={paper} />
      {paper.abstract && <p className="mt-2 line-clamp-3 text-sm text-slate-700">{paper.abstract}</p>}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </article>
  );
}

export function DoiLink({ doi }: { doi: string }) {
  return (
    <a href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
      doi:{doi} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function useStyles() {
  return useQuery({ queryKey: ["styles"], queryFn: () => api.get<CitationStyle[]>("/citations/styles"), staleTime: Infinity });
}

export function CiteModal({ paperId, open, onClose }: { paperId: string; open: boolean; onClose: () => void }) {
  const [style, setStyle] = useState("apa");
  const [copied, setCopied] = useState<string | null>(null);
  const styles = useStyles();
  const cite = useQuery({
    queryKey: ["cite", paperId, style],
    queryFn: () => api.get<{ in_text: string; bibliography: string }>(`/papers/${paperId}/cite`, { style }),
    enabled: open,
  });
  const copy = async (label: string, html: string) => {
    const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? html;
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <Modal open={open} onClose={onClose} title="Cite this paper">
      <Select value={style} onChange={(event) => setStyle(event.target.value)} aria-label="Citation style">
        <StyleOptions styles={styles.data} />
      </Select>
      {cite.isLoading && <Spinner label="Formatting" />}
      {cite.error && <div className="mt-3"><Alert kind="error">{errorMessage(cite.error)}</Alert></div>}
      {cite.data && (
        <div className="mt-4 space-y-4">
          {[
            ["In-text", cite.data.in_text],
            ["Reference", cite.data.bibliography],
          ].map(([label, html]) => (
            <div key={label}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
                <Button size="sm" variant="ghost" onClick={() => void copy(label!, html!)}>
                  {copied === label ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy
                </Button>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 font-serif text-sm" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html!) }} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function AddToLibraryButton({ paper, onDone }: { paper: Paper; onDone?: () => void }) {
  const [added, setAdded] = useState(paper.in_library);
  const mutation = useMutation({
    mutationFn: () => api.post("/library", { paper_id: paper.id }),
    onSuccess: () => {
      setAdded(true);
      onDone?.();
    },
  });
  if (added) return <Badge tone="green"><Check className="h-3 w-3" /> In your library</Badge>;
  return (
    <Button size="sm" variant="secondary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
      Save to library
    </Button>
  );
}


/** Search the whole library on the server (title match), newest first, one page at a time. */
export function useLibrarySearch(filter: string, limit = 50) {
  const [debounced, setDebounced] = useState(filter);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(filter.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [filter]);
  return useQuery({
    queryKey: ["library", "search", debounced, limit],
    queryFn: () => api.page<LibraryItem>("/library", { q: debounced || undefined, limit }),
  });
}


/** Style <option>s grouped by discipline (Widely used, Humanities, Social sciences, Law, Sciences, ...). */
export function StyleOptions({ styles }: { styles: CitationStyle[] | undefined }) {
  const list = styles ?? [{ id: "apa", title: "APA 7th edition", kind: "author-date" as const, group: "Widely used" }];
  const groups = Array.from(new Set(list.map((s) => s.group || "Other")));
  return (
    <>
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {list
            .filter((s) => (s.group || "Other") === group)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

/** Marks records whose details were typed or uploaded by their owner rather than verified at a registry. */
export function UserSuppliedBadge({ paper }: { paper: Pick<Paper, "metadata_source"> }) {
  if (paper.metadata_source !== "user" && paper.metadata_source !== "unverified") return null;
  return (
    <span title="Details entered by you, not verified against a scholarly registry" className="inline-flex">
      <Badge tone="amber">User-supplied details</Badge>
    </span>
  );
}
