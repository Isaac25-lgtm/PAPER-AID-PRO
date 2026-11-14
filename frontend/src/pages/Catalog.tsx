import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import { SectionGuide } from "@/components/Guidance";
import { Container } from "@/components/Layout";
import { PaperCard } from "@/components/papers";
import { Alert, Button, EmptyState, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { PaperPage } from "@/lib/types";

export default function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const sort = params.get("sort") ?? (q ? "relevance" : "recent");
  const page = Number(params.get("page") ?? "1");
  const [draft, setDraft] = useState(q);
  const result = useQuery({
    queryKey: ["catalog", q, sort, page],
    queryFn: () => api.get<PaperPage>("/papers", { q: q || undefined, sort, page, page_size: 20 }),
  });
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  };
  const totalPages = result.data ? Math.max(1, Math.ceil(result.data.total / result.data.page_size)) : 1;

  return (
    <Container>
      <PageHeader title="Catalog" subtitle="Every paper imported into PaperAid Pro, plus your private uploads." />
      <SectionGuide section="catalog" />
      <form className="mb-6 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); update({ q: draft.trim() || null, page: null, sort: null }); }}>
        <Input className="min-w-64 flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search titles, journals and abstracts" aria-label="Search catalog" />
        <Select className="w-44" value={sort} onChange={(e) => update({ sort: e.target.value, page: null })} aria-label="Sort">
          {q && <option value="relevance">Most relevant</option>}
          <option value="recent">Recently added</option>
          <option value="year">Publication year</option>
          <option value="citations">Most cited</option>
        </Select>
        <Button type="submit">Search</Button>
      </form>
      {result.isLoading && <Spinner />}
      {result.error && <Alert kind="error">{errorMessage(result.error)}</Alert>}
      {result.data && result.data.items.length === 0 && (
        <EmptyState icon={<BookOpen className="h-8 w-8" />} title={q ? "No matching papers" : "The catalog is empty"} action={<Link to="/discover" className="font-medium text-brand-700">Discover papers →</Link>}>
          Papers appear here once someone imports them from Discover.
        </EmptyState>
      )}
      <div className="space-y-4">
        {result.data?.items.map((paper) => <PaperCard key={paper.id} paper={paper} />)}
      </div>
      {result.data && totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Pagination">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>Previous</Button>
          <span className="text-sm text-slate-600">Page {page} of {totalPages}</span>
          <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })}>Next</Button>
        </nav>
      )}
    </Container>
  );
}
