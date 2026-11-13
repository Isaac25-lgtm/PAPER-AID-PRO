import { BookOpen, FileText, FlaskConical, Quote, Search, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { Button, Input } from "@/components/ui";
import { useAuth } from "@/lib/auth";

const FEATURES = [
  { icon: Search, title: "Federated discovery", body: "Search OpenAlex, Crossref, PubMed, Semantic Scholar and arXiv at once, de-duplicated and ranked transparently." },
  { icon: BookOpen, title: "A real research library", body: "Save papers, organise collections, upload PDFs, and import or export BibTeX, RIS and CSL-JSON." },
  { icon: FileText, title: "Write with correct citations", body: "A document editor with in-text citations and bibliographies in APA, MLA, Chicago, Vancouver, IEEE and more." },
  { icon: Quote, title: "Reference checking", body: "Check every reference against Crossref so fabricated or mistyped citations are caught before submission." },
  { icon: FlaskConical, title: "Grounded research answers", body: "Ask questions across your papers. Every claim links to the exact passage it came from, or the answer is withheld." },
  { icon: ShieldCheck, title: "Private by default", body: "Your uploads, notes and documents are visible only to you. PDFs are stored privately and streamed only to you." },
];

export function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  return (
    <div>
      <section className="border-b border-slate-200 bg-gradient-to-b from-white to-brand-50">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center">
          <h1 className="font-serif text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">Research you can cite with confidence.</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
            Discover literature, keep a clean library, write with properly formatted citations, and get answers that always show their sources.
          </p>
          <form
            className="mx-auto mt-8 flex max-w-2xl gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (query.trim().length >= 2) navigate(`/discover?q=${encodeURIComponent(query.trim())}`);
            }}
          >
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. school-based malaria prevention" aria-label="Search the literature" className="h-11 text-base" />
            <Button type="submit" className="h-11 px-6">Search</Button>
          </form>
          {!user && (
            <p className="mt-4 text-sm text-slate-600">
              <Link to="/register" className="font-medium text-brand-700">Create a free account</Link> to save papers and write.
            </p>
          )}
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-16 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-xl border border-slate-200 bg-white p-5">
            <Icon className="h-6 w-6 text-brand-700" aria-hidden />
            <h2 className="mt-3 font-semibold text-slate-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-600">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
