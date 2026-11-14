import clsx from "clsx";
import {
  ArrowRight, BadgeCheck, BookMarked, Check, ChevronDown, FileText, FlaskConical, LibraryBig, Lock, Quote, Search,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { useAuth } from "@/lib/auth";

/*
 * Landing page. Product visuals are abstract (skeleton lines, generic labels such as "Author, Year"): no invented
 * papers, statistics, testimonials or page numbers, in line with the project's no-fabrication rule.
 */

function Bar({ w, className }: { w: string; className?: string }) {
  return <span className={clsx("block h-2 rounded-full bg-slate-200", className)} style={{ width: w }} />;
}

function Window({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-brand-900/5", className)}>
      <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-2.5" aria-hidden>
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
      </div>
      {children}
    </div>
  );
}

function CiteChip({ children = "Author, Year" }: { children?: ReactNode }) {
  return <span className="mx-1 inline-flex items-center rounded-md bg-brand-100 px-1.5 py-0.5 align-middle text-[11px] font-medium text-brand-800">({children})</span>;
}

/** Hero visual: the editor with the sources drawer and an auto-built reference list. */
function EditorMock() {
  return (
    <Window>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px]" aria-hidden>
        <div className="space-y-4 p-6 text-left">
          <p className="font-serif text-lg font-semibold text-slate-800">Introduction</p>
          <div className="space-y-2.5">
            <Bar w="95%" /><Bar w="88%" />
            <p className="flex flex-wrap items-center gap-y-1"><Bar w="55%" className="inline-block" /><CiteChip /></p>
            <Bar w="92%" /><Bar w="70%" />
          </div>
          <p className="pt-2 font-serif text-base font-semibold text-slate-800">Methods</p>
          <div className="space-y-2.5">
            <Bar w="90%" />
            <p className="flex flex-wrap items-center gap-y-1"><Bar w="40%" className="inline-block" /><CiteChip>Author et al., Year</CiteChip></p>
          </div>
          <div className="mt-2 rounded-lg border border-dashed border-slate-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">References · generated automatically</p>
            <div className="mt-2 space-y-2"><Bar w="85%" /><Bar w="78%" /></div>
          </div>
        </div>
        <div className="hidden border-l border-slate-100 bg-slate-50/70 p-4 sm:block">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><BookMarked className="h-3.5 w-3.5" /> Your library</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="mt-3 rounded-lg border border-slate-200 bg-white p-2.5">
              <Bar w="90%" /><Bar w="60%" className="mt-1.5 bg-slate-100" />
              <span className={clsx("mt-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", i === 0 ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-500")}>Cite at cursor</span>
            </div>
          ))}
        </div>
      </div>
    </Window>
  );
}

function AnswerMock() {
  return (
    <Window>
      <div className="space-y-4 p-5" aria-hidden>
        <div className="ml-auto w-3/4 rounded-2xl bg-brand-700 p-3"><Bar w="90%" className="bg-white/50" /><Bar w="60%" className="mt-1.5 bg-white/50" /></div>
        <div className="space-y-2.5 rounded-xl border border-slate-200 p-4">
          {[["92%", "1"], ["80%", "2"], ["86%", "1"]].map(([w, n], i) => (
            <p key={i} className="flex items-center gap-1.5"><Bar w={w!} /><span className="rounded bg-brand-100 px-1 text-[10px] font-semibold text-brand-800">{n}</span></p>
          ))}
        </div>
        <div className="rounded-xl border-l-4 border-brand-500 bg-brand-50 p-3">
          <p className="text-[11px] font-semibold text-brand-800">Source 1 · exact passage</p>
          <Bar w="95%" className="mt-2 bg-brand-200" /><Bar w="75%" className="mt-1.5 bg-brand-200" />
        </div>
      </div>
    </Window>
  );
}

function StylesMock() {
  const styles = ["APA", "MLA", "Chicago", "Vancouver", "IEEE"];
  return (
    <Window>
      <div className="p-5" aria-hidden>
        <div className="flex flex-wrap gap-1.5">
          {styles.map((style, i) => (
            <span key={style} className={clsx("rounded-full px-2.5 py-1 text-xs font-medium", i === 3 ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-600")}>{style}</span>
          ))}
          <span className="rounded-full px-2.5 py-1 text-xs text-slate-400">+5 more</span>
        </div>
        <p className="mt-5 flex flex-wrap items-center gap-y-1"><Bar w="60%" className="inline-block" /><CiteChip>1</CiteChip></p>
        <p className="mt-2.5 flex flex-wrap items-center gap-y-1"><Bar w="45%" className="inline-block" /><CiteChip>2, 3</CiteChip></p>
        <div className="mt-5 space-y-2.5 rounded-lg bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">References</p>
          {[1, 2, 3].map((n) => (
            <p key={n} className="flex items-center gap-2 text-xs text-slate-500">{n}.<Bar w={`${88 - n * 8}%`} /></p>
          ))}
        </div>
      </div>
    </Window>
  );
}

function CheckerMock() {
  const rows = [
    { label: "Verified", tone: "bg-emerald-100 text-emerald-800" },
    { label: "Likely match", tone: "bg-amber-100 text-amber-800" },
    { label: "Not found", tone: "bg-red-100 text-red-800" },
  ];
  return (
    <Window>
      <ul className="divide-y divide-slate-100 p-2" aria-hidden>
        {rows.map((row, i) => (
          <li key={row.label} className="flex items-center gap-3 p-3">
            <div className="flex-1 space-y-1.5"><Bar w={`${90 - i * 8}%`} /><Bar w={`${60 + i * 5}%`} className="bg-slate-100" /></div>
            <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium", row.tone)}>{row.label}</span>
          </li>
        ))}
      </ul>
    </Window>
  );
}

const STEPS = [
  { icon: Search, title: "Find", body: "Search OpenAlex, Crossref, PubMed, Semantic Scholar and arXiv at once, then save what matters." },
  { icon: LibraryBig, title: "Organise", body: "Keep papers, your own PDFs, notes and collections in one library. Import or export BibTeX and RIS." },
  { icon: FileText, title: "Write & cite", body: "Start from a guided outline, cite at the cursor, and get a reference list in APA, Vancouver, IEEE and more." },
];

const FEATURES = [
  {
    label: "Write",
    title: "Citations that format themselves",
    body: "Cite from your library at the cursor, with page numbers if you want them. The reference list builds itself and lists only what you cite. Switch between 10 official styles in one click, then export to Word or PDF.",
    visual: <StylesMock />,
  },
  {
    label: "Understand",
    title: "Answers that show their sources",
    body: "Ask a question across the papers you choose. Each statement must quote the passage it relies on; anything the sources don't support is removed, and you can open every source in one click.",
    visual: <AnswerMock />,
  },
  {
    label: "Submit",
    title: "Catch bad references before reviewers do",
    body: "Paste your reference list and each entry is checked against Crossref by title, first author and year, so mistyped or invented citations stand out.",
    visual: <CheckerMock />,
  },
];

const COMPARISON = [
  "Metadata from scholarly registries, never guessed",
  "Every AI statement linked to a quoted source passage",
  "Unsupported statements removed, not presented as fact",
  "Official citation styles, used by Zotero and Mendeley",
  "Your uploads and drafts private to you",
];

const FAQ = [
  { q: "Is PaperAid Pro free?", a: "Yes. Searching, your library, documents, citation formatting and reference checking are free to use." },
  { q: "Where do the papers come from?", a: "From OpenAlex, Crossref, PubMed, Semantic Scholar and arXiv. When you save a paper, its details are fetched from the official registry record, so your citations are built from authoritative metadata." },
  { q: "Can the AI make up references?", a: "Answers can only cite passages and abstracts from papers you selected. Each statement must quote its source, and statements the source doesn't support are removed. Always read the cited passage before relying on it." },
  { q: "Which citation styles are supported?", a: "APA 7, MLA 9, Chicago 18 (author-date and notes), Harvard, Vancouver, IEEE, AMA 11, Nature and Science, using the official CSL style files." },
  { q: "Can I use my own PDFs and reference manager?", a: "Yes. Upload PDFs (kept private to you) and import BibTeX or RIS exports from Zotero, Mendeley or EndNote. You can export your library the same way." },
  { q: "Who can see my work?", a: "Only you. Uploads, notes, documents and research conversations are private to your account, and PDFs are stored privately and sent only to you." },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-slate-200">
      <button className="flex w-full items-center justify-between gap-4 py-4 text-left font-medium text-slate-900" aria-expanded={open} onClick={() => setOpen(!open)}>
        {q}
        <ChevronDown className={clsx("h-4 w-4 shrink-0 text-slate-500 transition", open && "rotate-180")} />
      </button>
      {open && <p className="pb-4 text-sm leading-relaxed text-slate-600">{a}</p>}
    </li>
  );
}

function PrimaryCta({ className }: { className?: string }) {
  const { user } = useAuth();
  return (
    <Link
      to={user ? "/dashboard" : "/register"}
      className={clsx("inline-flex items-center gap-2 rounded-xl bg-brand-700 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-brand-700/20 transition hover:bg-brand-800", className)}
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
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-gradient-to-b from-brand-50 via-white to-white" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-16 text-center sm:pt-24">
          <p className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-white px-3 py-1 text-xs font-medium text-brand-800">
            <BadgeCheck className="h-3.5 w-3.5" /> For students, researchers and academics
          </p>
          <h1 className="mx-auto mt-5 max-w-3xl font-serif text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
            Research you can <span className="text-brand-700">cite with confidence</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
            Find the literature, keep it organised, and write with correctly formatted citations. Every AI answer shows exactly where it came from.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <PrimaryCta />
            <form
              className="flex w-full max-w-md items-center gap-2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm"
              onSubmit={(event) => {
                event.preventDefault();
                if (query.trim().length >= 2) navigate(`/discover?q=${encodeURIComponent(query.trim())}`);
              }}
            >
              <Search className="ml-2 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Or search the literature now…"
                aria-label="Search the literature"
                className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-sm focus:outline-none"
              />
              <button type="submit" className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50">Search</button>
            </form>
          </div>
          <div className="mx-auto mt-14 max-w-4xl">
            <EditorMock />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-slate-100 bg-slate-50/60">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-center font-serif text-3xl font-bold text-slate-900">From search to submission</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }, index) => (
              <li key={title} className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-brand-700">0{index + 1}</span>
                  <Icon className="h-5 w-5 text-slate-400" aria-hidden />
                </div>
                <h3 className="mt-3 text-lg font-semibold text-slate-900">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl space-y-20 px-4 py-20">
        {FEATURES.map((feature, index) => (
          <div key={feature.title} className="grid items-center gap-10 md:grid-cols-2">
            <div className={clsx(index % 2 === 1 && "md:order-2")}>
              <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">{feature.label}</p>
              <h2 className="mt-2 font-serif text-3xl font-bold text-slate-900">{feature.title}</h2>
              <p className="mt-4 leading-relaxed text-slate-600">{feature.body}</p>
            </div>
            <div className={clsx(index % 2 === 1 && "md:order-1")}>{feature.visual}</div>
          </div>
        ))}
      </section>

      {/* Why */}
      <section className="bg-slate-900">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:items-center">
          <div>
            <h2 className="font-serif text-3xl font-bold text-white">Built for academic integrity</h2>
            <p className="mt-4 text-slate-300">
              General-purpose chatbots can produce references that look real but aren't. PaperAid Pro is designed the other way round:
              sources first, and nothing presented as fact without one.
            </p>
          </div>
          <ul className="space-y-3">
            {COMPARISON.map((item) => (
              <li key={item} className="flex items-start gap-3 rounded-xl bg-white/5 p-3 text-slate-100">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden /> {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* More */}
      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-16 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: FlaskConical, title: "Guided outlines", body: "Templates for manuscripts, proposals, reviews and theses, by study design." },
          { icon: Quote, title: "10 citation styles", body: "APA, MLA, Chicago, Harvard, Vancouver, IEEE, AMA, Nature, Science." },
          { icon: LibraryBig, title: "Works with your tools", body: "Import and export BibTeX, RIS and CSL-JSON; export documents to Word." },
          { icon: Lock, title: "Private by default", body: "Your uploads and drafts are visible only to you." },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-2xl border border-slate-200 p-5">
            <Icon className="h-5 w-5 text-brand-700" aria-hidden />
            <h3 className="mt-3 font-semibold text-slate-900">{title}</h3>
            <p className="mt-1 text-sm text-slate-600">{body}</p>
          </div>
        ))}
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 pb-20">
        <h2 className="text-center font-serif text-3xl font-bold text-slate-900">Questions</h2>
        <ul className="mt-8 border-t border-slate-200">
          {FAQ.map((item) => <FaqItem key={item.q} {...item} />)}
        </ul>
      </section>

      {/* Closing CTA */}
      <section className="px-4 pb-20">
        <div className="mx-auto max-w-5xl rounded-3xl bg-gradient-to-br from-brand-700 to-brand-900 px-6 py-14 text-center">
          <h2 className="font-serif text-3xl font-bold text-white sm:text-4xl">Start your next paper on solid ground</h2>
          <p className="mx-auto mt-3 max-w-xl text-brand-100">Set up your library and first document in a few minutes.</p>
          <PrimaryCta className="mt-8 bg-white !text-brand-800 shadow-none hover:bg-brand-50" />
          <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-brand-100">
            {["Free to use", "No credit card", "Your work stays private"].map((point) => (
              <li key={point} className="flex items-center gap-1.5"><Check className="h-4 w-4" /> {point}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

