import clsx from "clsx";
import { ArrowRight, Check, ChevronDown, FileText, LibraryBig, Lock, Quote, ScanSearch, Search, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { useAuth } from "@/lib/auth";

/*
 * Landing page (Graphite). The product preview is built from the app's real interface elements and shows real,
 * published papers with their real bibliographic details (Suri & Jack 2016, Science; Jack & Suri 2014, American
 * Economic Review; Aker & Mbiti 2010, Journal of Economic Perspectives). No invented papers, numbers, users or
 * testimonials, in line with the project's no-fabrication rule.
 */

const PAPERS = {
  suri: { cite: "Suri & Jack, 2016", title: "The long-run poverty and gender impacts of mobile money", meta: "Suri & Jack · 2016 · Science" },
  jack: { cite: "Jack & Suri, 2014", title: "Risk sharing and transactions costs: evidence from Kenya's mobile money revolution", meta: "Jack & Suri · 2014 · American Economic Review" },
  aker: { cite: "Aker & Mbiti, 2010", title: "Mobile phones and economic development in Africa", meta: "Aker & Mbiti · 2010 · Journal of Economic Perspectives" },
};

function Chip({ children }: { children: ReactNode }) {
  return <span className="mx-0.5 whitespace-nowrap rounded-[5px] bg-brand-50 px-1.5 py-0.5 align-[0.1em] font-mono text-[11.5px] text-brand-700">{children}</span>;
}

function Kbd({ children }: { children: ReactNode }) {
  return <span className="rounded border border-slate-200 bg-white px-1.5 py-px font-mono text-[10.5px] text-slate-500">{children}</span>;
}

/** Hero preview: documents, the writing surface with citations, a /cite search and the reference check. */
function ProductPreview() {
  return (
    <div aria-hidden className="mx-auto mt-14 w-full max-w-[1120px] overflow-hidden rounded-t-2xl border border-b-0 border-slate-200 bg-slate-50 text-left">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="ml-3 text-xs font-medium text-slate-500">Chapter 2 · Literature review</span>
        <span className="ml-auto font-mono text-[11px] text-emerald-700">● saved</span>
      </div>
      <div className="grid md:grid-cols-[200px_1fr_280px]">
        <div className="hidden flex-col gap-1.5 border-r border-slate-200 p-4 text-[13px] text-slate-500 md:flex">
          <span className="mb-1 font-semibold text-slate-900">Documents</span>
          <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-slate-900">Chapter 2 · Literature review</span>
          <span className="px-2.5 py-2">Research proposal</span>
          <span className="px-2.5 py-2">Concept note</span>
        </div>
        <div className="relative bg-white px-6 pb-10 pt-7 sm:px-10">
          <p className="text-[22px] font-semibold tracking-[-0.02em] text-slate-950">2.1 Access and adoption</p>
          <p className="mt-3 font-serif text-[16.5px] leading-[1.75] text-slate-800">
            Mobile money has changed how households in East Africa save, send and borrow <Chip>{PAPERS.suri.cite}</Chip>. Early studies linked access to
            agent networks with smoother consumption after shocks <Chip>{PAPERS.jack.cite}</Chip>. Yet the benefits are not shared evenly across
            <span className="text-slate-400"> rural and urban households…</span>
            <span className="ml-0.5 inline-block h-[18px] w-[2px] translate-y-[3px] bg-brand-500" />
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-slate-500">
            Suggestion · <Kbd>Tab</Kbd> accept · <Kbd>Esc</Kbd> dismiss
          </p>
          <div className="mt-5 max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_24px_48px_-24px_rgba(0,0,0,0.35)]">
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
              <span className="font-mono text-xs text-brand-600">/cite</span>
              <span className="text-[14px] text-slate-900">mobile phones development Africa</span>
            </div>
            <div className="p-1.5">
              <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-100 px-2.5 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-slate-900">{PAPERS.aker.title}</span>
                  <span className="block truncate text-[11.5px] text-slate-500">{PAPERS.aker.meta} · via OpenAlex, Crossref</span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-slate-500">↵ cite</span>
              </div>
            </div>
          </div>
        </div>
        <div className="hidden flex-col gap-2.5 border-l border-slate-200 p-4 md:flex">
          <span className="font-mono text-[11px] tracking-wide text-slate-500">REFERENCE CHECK</span>
          {[PAPERS.aker, PAPERS.jack, PAPERS.suri].map((p) => (
            <div key={p.cite} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px]">
              <span className="truncate text-slate-800">{p.cite.replace(", ", " (")})</span>
              <span className="shrink-0 font-medium text-emerald-700">Matched</span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-white px-3 py-2.5 text-[13px]">
            <span className="truncate text-slate-500">A reference with the wrong year</span>
            <span className="shrink-0 font-medium text-brand-700">Year differs</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: Quote, label: "Cite while you write", body: "Type /cite and search your library and the scholarly indexes at once. Pick a result and it is cited, formatted and added to the reference list." },
  { icon: FileText, label: "Your PDF beside your draft", body: "Read a source next to your writing. Select words on the page to cite that page, or quote them with the citation." },
  { icon: ScanSearch, label: "Check every reference", body: "Paste a reference list and see which entries match the registry record and where the title, first author or year differs." },
  { icon: ShieldCheck, label: "Answers with their evidence", body: "Ask your sources a question. Every statement quotes the passage it relies on, and unsupported statements are removed." },
];

const STYLES = ["APA 7", "Harvard", "MLA 9", "Chicago", "OSCOLA", "Bluebook", "ASA", "APSA", "Vancouver", "AMA", "IEEE", "Nature", "Science", "ACS"];
const SOURCES = ["OpenAlex", "Crossref", "Semantic Scholar", "DOAJ", "Europe PMC", "PubMed"];

const PRINCIPLES = [
  "Metadata from scholarly registries, never guessed",
  "Every AI statement linked to a quoted source passage",
  "Official citation styles, the same ones Zotero and Mendeley use",
  "Your uploads and drafts private to you",
];

const FAQ = [
  { q: "Is PaperAid Pro free?", a: "Yes. Searching, your library, documents, citation formatting and reference checking are free to use." },
  { q: "Where do the papers come from?", a: "From OpenAlex, Crossref, Semantic Scholar, DOAJ, Europe PMC and PubMed (arXiv on request). When you save a paper, its details are fetched from the official registry record, so your citations are built from authoritative metadata." },
  { q: "Can the AI make up references?", a: "Answers can only cite passages and abstracts from papers you selected. Each statement must quote its source, and statements the source doesn't support are removed. Always read the cited passage before relying on it." },
  { q: "Which citation styles are supported?", a: "18 official CSL styles, from APA 7, Harvard, MLA 9 and Chicago to OSCOLA and Bluebook for law, ASA and APSA for the social sciences, and Vancouver, AMA, IEEE, Nature, Science and ACS for the sciences. Books, chapters, reports, court cases and statutes can be entered manually." },
  { q: "Can I use my own PDFs and reference manager?", a: "Yes. Upload PDFs (kept private to you) and import BibTeX or RIS exports from Zotero, Mendeley or EndNote. You can export your library the same way." },
  { q: "Who can see my work?", a: "Only you. Uploads, notes, documents and research conversations are private to your account, and PDFs are stored privately and sent only to you." },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-slate-200">
      <button className="flex w-full items-center justify-between gap-4 py-4 text-left font-medium text-slate-950" aria-expanded={open} onClick={() => setOpen(!open)}>
        {q}
        <ChevronDown className={clsx("h-4 w-4 shrink-0 text-slate-400 transition", open && "rotate-180")} />
      </button>
      {open && <p className="pb-4 text-[15px] leading-relaxed text-slate-600">{a}</p>}
    </li>
  );
}

function PrimaryCta({ className }: { className?: string }) {
  const { user } = useAuth();
  return (
    <Link
      to={user ? "/dashboard" : "/register"}
      className={clsx("inline-flex items-center justify-center gap-2 rounded-[10px] bg-brand-500 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-brand-600", className)}
    >
      {user ? "Go to your workspace" : "Start writing — it's free"} <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  return (
    <div className="bg-white">
      {/* Hero */}
      <section className="border-b border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-col items-center px-4 pt-16 text-center sm:pt-20">
          <p className="rounded-full border border-slate-200 px-3 py-1.5 font-mono text-[11.5px] text-slate-500">Discover · Library · Write · Cite · Check</p>
          <h1 className="mt-6 max-w-4xl text-[44px] font-semibold leading-[1] tracking-[-0.045em] text-slate-950 sm:text-[68px]">
            From search to submission, every source accounted for.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-500">
            A writing workspace for researchers in every discipline. Cite while you write, check every reference, and see the exact words behind every AI answer.
          </p>
          <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:flex-row">
            <PrimaryCta className="w-full sm:w-auto" />
            <form
              className="flex w-full items-center gap-2 rounded-[10px] border border-slate-200 bg-white px-3 sm:w-[360px]"
              onSubmit={(event) => {
                event.preventDefault();
                if (query.trim().length >= 2) navigate(`/discover?q=${encodeURIComponent(query.trim())}`);
              }}
            >
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the literature in any field"
                aria-label="Search the literature"
                className="min-w-0 flex-1 bg-transparent py-3.5 text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
              <button type="submit" className="rounded-md px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100">Search</button>
            </form>
          </div>
          <ProductPreview />
        </div>
      </section>

      {/* What it does */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="max-w-2xl text-[34px] font-semibold leading-tight tracking-[-0.03em] text-slate-950">The parts of academic writing that take the longest, done properly.</h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, label, body }) => (
            <div key={label} className="bg-white p-7">
              <Icon className="h-5 w-5 text-brand-600" aria-hidden />
              <h3 className="mt-4 text-lg font-semibold tracking-[-0.01em] text-slate-950">{label}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Every discipline */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-[1fr_1.3fr] md:items-center">
          <div>
            <p className="font-mono text-[11.5px] tracking-wide text-slate-500">FOR EVERY FIELD</p>
            <h2 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.03em] text-slate-950">Humanities, law, social sciences, health, engineering.</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
              Search the indexes that cover your subject, cite in the style your department asks for, and start from an outline that fits your
              research approach.
            </p>
          </div>
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-medium text-slate-500">Citation styles</p>
              <div className="flex flex-wrap gap-1.5">
                {STYLES.map((s) => <span key={s} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[13px] text-slate-700">{s}</span>)}
                <span className="rounded-md px-2.5 py-1 text-[13px] text-slate-500">and more</span>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-slate-500">Scholarly sources</p>
              <div className="flex flex-wrap gap-1.5">
                {SOURCES.map((s) => <span key={s} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[13px] text-slate-700">{s}</span>)}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Principles */}
      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-20 md:grid-cols-2 md:items-start">
        <div>
          <h2 className="text-[30px] font-semibold leading-tight tracking-[-0.03em] text-slate-950">Built for academic integrity.</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
            General-purpose chatbots can produce references that look real but aren't. PaperAid Pro works the other way round: sources first,
            and nothing presented as fact without one.
          </p>
          <div className="mt-6 flex flex-wrap gap-4 text-sm text-slate-600">
            <span className="flex items-center gap-1.5"><LibraryBig className="h-4 w-4 text-slate-400" aria-hidden /> BibTeX, RIS, CSL-JSON</span>
            <span className="flex items-center gap-1.5"><Lock className="h-4 w-4 text-slate-400" aria-hidden /> Private by default</span>
          </div>
        </div>
        <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200">
          {PRINCIPLES.map((item) => (
            <li key={item} className="flex items-start gap-3 px-5 py-4 text-[15px] text-slate-800">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden /> {item}
            </li>
          ))}
        </ul>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 pb-20">
        <h2 className="text-[30px] font-semibold tracking-[-0.03em] text-slate-950">Questions</h2>
        <ul className="mt-6 border-t border-slate-200">
          {FAQ.map((item) => <FaqItem key={item.q} {...item} />)}
        </ul>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-16 text-center">
          <h2 className="max-w-2xl text-[34px] font-semibold leading-tight tracking-[-0.03em] text-slate-950">Start your next paper on solid ground.</h2>
          <PrimaryCta />
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-500">
            {["Free to use", "No credit card", "Your work stays private"].map((point) => (
              <li key={point} className="flex items-center gap-1.5"><Check className="h-4 w-4 text-slate-400" aria-hidden /> {point}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
