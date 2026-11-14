import clsx from "clsx";
import {
  ArrowLeft, ArrowRight, BookOpen, ChevronDown, ChevronUp, CircleHelp, Compass, FileText, FlaskConical, Keyboard,
  LibraryBig, Quote, ShieldCheck, Sparkles,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { useAuth } from "@/lib/auth";
import { EDITOR_SHORTCUTS, GUIDES, SECTION_ORDER, type SectionKey } from "@/lib/guides";
import { usePreference } from "@/lib/preferences";
import { Button, Modal } from "./ui";

// --------------------------------------------------------------------------------------------- context
interface Guidance {
  openHelp(section?: SectionKey): void;
  openTour(): void;
}

const GuidanceContext = createContext<Guidance>({ openHelp: () => undefined, openTour: () => undefined });

export function useGuidance(): Guidance {
  return useContext(GuidanceContext);
}

/**
 * Hosts the Help centre and the welcome tour. Nothing pops up by itself: the tour is offered on Home and in Help,
 * and finishing or skipping it is remembered on the account (so the Home offer disappears on every device).
 */
export function GuidanceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [help, setHelp] = useState<{ open: boolean; section?: SectionKey }>({ open: false });
  const [tourOpen, setTourOpen] = useState(false);
  const [, setTourSeen] = usePreference<boolean>("tour_seen", false);

  const closeTour = useCallback(() => {
    setTourSeen(true);
    setTourOpen(false);
  }, [setTourSeen]);

  const value = useMemo<Guidance>(
    () => ({
      openHelp: (section) => setHelp({ open: true, section }),
      openTour: () => {
        setHelp({ open: false });
        setTourOpen(true);
      },
    }),
    [],
  );

  return (
    <GuidanceContext.Provider value={value}>
      {children}
      <HelpCenter open={help.open} initialSection={help.section} onClose={() => setHelp({ open: false })} />
      {user && <WelcomeTour open={tourOpen} name={user.name} onClose={closeTour} />}
    </GuidanceContext.Provider>
  );
}

// --------------------------------------------------------------------------------- per-section guide
/**
 * "How to use this page": a single quiet line ("New here? How Library works") that expands into the steps and
 * tips. Collapsed by default; if someone opens it, that choice is remembered on their account. Signed-in only.
 */
export function SectionGuide({ section, className }: { section: SectionKey; className?: string }) {
  const { user } = useAuth();
  const guide = GUIDES[section];
  const [expanded, setExpanded] = usePreference<boolean>(`guide_${section}_open`, false);
  if (!user) return null;
  const toggle = () => setExpanded(!expanded);
  return (
    <section
      aria-label={`How to use ${guide.title}`}
      className={clsx("mb-6 rounded-xl border border-slate-200 bg-white", expanded ? "p-4" : "px-4 py-2", className)}
    >
      <button type="button" onClick={toggle} aria-expanded={expanded} className="flex w-full items-center gap-2 text-left">
        <CircleHelp className="h-4 w-4 shrink-0 text-brand-700" aria-hidden />
        <span className="flex-1 text-sm font-medium text-slate-900">
          {expanded ? `How to use ${guide.title}` : `New here? How ${guide.title} works`}
          {!expanded && <span className="ml-2 hidden font-normal text-slate-600 sm:inline">· {guide.summary}</span>}
        </span>
        <span className="text-xs text-brand-700">{expanded ? "Hide" : "Show"}</span>
        {expanded ? <ChevronUp className="h-4 w-4 text-brand-700" /> : <ChevronDown className="h-4 w-4 text-brand-700" />}
      </button>
      {expanded && <GuideBody section={section} />}
    </section>
  );
}

function GuideBody({ section }: { section: SectionKey }) {
  const guide = GUIDES[section];
  return (
    <div className="mt-3 grid gap-4 text-sm text-slate-700 md:grid-cols-[1fr_auto]">
      <div>
        <p className="text-slate-600">{guide.summary}</p>
        <ol className="mt-3 space-y-1.5">
          {guide.steps.map((step, index) => (
            <li key={step} className="flex gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
      {guide.tips.length > 0 && (
        <ul className="space-y-1.5 rounded-lg bg-white/80 p-3 text-xs text-slate-600 md:max-w-xs">
          <li className="font-semibold uppercase tracking-wide text-slate-500">Good to know</li>
          {guide.tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Small "?" button for headers (opens the Help centre on this section). */
export function HelpButton({ section, className, label = "Help" }: { section?: SectionKey; className?: string; label?: string }) {
  const { openHelp } = useGuidance();
  return (
    <button
      type="button"
      onClick={() => openHelp(section)}
      className={clsx("flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100", className)}
      aria-label={label}
      title={label}
    >
      <CircleHelp className="h-4 w-4" aria-hidden />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------- help centre
type HelpTab = "sections" | "editor" | "evidence";

function HelpCenter({ open, initialSection, onClose }: { open: boolean; initialSection?: SectionKey; onClose: () => void }) {
  const { openTour } = useGuidance();
  const [tab, setTab] = useState<HelpTab>("sections");
  const [section, setSection] = useState<SectionKey>(initialSection ?? "discover");
  useEffect(() => {
    if (open) {
      setTab("sections");
      setSection(initialSection && initialSection !== "dashboard" ? initialSection : "discover");
    }
  }, [open, initialSection]);
  const guide = GUIDES[section];
  return (
    <Modal open={open} onClose={onClose} title="Help centre" wide>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
        {(
          [
            ["sections", "How each section works"],
            ["editor", "Editor shortcuts"],
            ["evidence", "Sources & evidence"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={clsx("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === key ? "border-brand-500 text-slate-950" : "border-transparent text-slate-500 hover:text-slate-800")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "sections" && (
        <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
          <ul className="flex gap-1 overflow-x-auto sm:flex-col">
            {SECTION_ORDER.map((key) => (
              <li key={key}>
                <button
                  onClick={() => setSection(key)}
                  className={clsx("w-full whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-sm", key === section ? "bg-slate-100 font-medium text-slate-950" : "text-slate-600 hover:bg-slate-100")}
                >
                  {GUIDES[key].title}
                </button>
              </li>
            ))}
          </ul>
          <div>
            <h3 className="font-semibold text-slate-900">{guide.title}</h3>
            <GuideBody section={section} />
            {section !== "paper" && section !== "editor" && (
              <Link to={guide.path} onClick={onClose} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                Go to {guide.title} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>
      )}

      {tab === "editor" && (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">Keyboard shortcuts in the document editor. Changes save automatically.</p>
          <table className="w-full text-left">
            <tbody className="divide-y divide-slate-100">
              {EDITOR_SHORTCUTS.map((s) => (
                <tr key={s.action}>
                  <td className="py-1.5 pr-4"><kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-xs">{s.keys}</kbd></td>
                  <td className="py-1.5 text-slate-700">{s.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="flex items-start gap-2 text-slate-600"><Keyboard className="mt-0.5 h-4 w-4 shrink-0" /> On a Mac use ⌘ in place of Ctrl.</p>
        </div>
      )}

      {tab === "evidence" && (
        <div className="space-y-3 text-sm text-slate-700">
          <p><strong>Metadata comes from registries.</strong> Titles, authors and dates come from scholarly registries (Crossref, OpenAlex, PubMed and others), never from free text you paste; sources you type in yourself are marked “user-supplied”, so citations are built from authoritative records.</p>
          <p><strong>Citations use official styles.</strong> In-text citations and reference lists are produced by the same citation engine used by Zotero and Mendeley, with the official style files.</p>
          <p><strong>AI answers show their sources.</strong> Each statement in an AI answer must quote the passage it relies on. Statements the cited text does not support are removed, and the answer says so. Click a numbered marker to read the source yourself.</p>
          <p><strong>Your work is private.</strong> Uploads, notes, documents and research conversations are visible only to you.</p>
          <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-900"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> AI output can still be wrong. Read the cited passages before you rely on an answer in your own writing.</p>
        </div>
      )}

      <div className="mt-5 flex justify-between border-t border-slate-200 pt-4">
        <Button variant="ghost" size="sm" onClick={openTour}><Sparkles className="h-4 w-4" /> Replay the welcome tour</Button>
        <Button size="sm" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------- welcome tour
const TOUR = [
  { icon: Sparkles, title: "Welcome to PaperAid Pro", body: "PaperAid Pro takes you from finding literature to a finished, correctly cited document. Here is how the pieces fit together; it takes under a minute.", to: null },
  { icon: Compass, title: "1. Find papers", body: "Discover searches major scholarly databases in every field at once; choose a subject to focus it. Save to library brings in a paper with metadata from the official registry.", to: "/discover" },
  { icon: LibraryBig, title: "2. Build your library", body: "Your Library holds saved papers and your own PDFs. Organise them into collections, add notes and tags, and import or export BibTeX and RIS.", to: "/library" },
  { icon: FileText, title: "3. Write with citations", body: "Documents start from a guided outline for your study design. Cite from your library at the cursor; the reference list builds itself in your chosen style.", to: "/documents" },
  { icon: FlaskConical, title: "4. Ask your sources", body: "The Research assistant answers questions across papers you choose, and every statement links to the passage it came from.", to: "/research" },
  { icon: Quote, title: "5. Check your references", body: "Before you submit, Citation tools check each reference against Crossref and format identifiers in 18 styles, from APA and Harvard to OSCOLA and IEEE.", to: "/tools/citations" },
  { icon: BookOpen, title: "Help is always one click away", body: "Each page has a “How to use” guide at the top, and the Help button in the top bar opens guides for every section.", to: null },
] as const;

function WelcomeTour({ open, name, onClose }: { open: boolean; name: string | null; onClose: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (open) setStep(0);
  }, [open]);
  const current = TOUR[step]!;
  const Icon = current.icon;
  const last = step === TOUR.length - 1;
  return (
    <Modal open={open} onClose={onClose} title={step === 0 && name ? `Welcome, ${name.split(" ")[0]}` : "Getting started"}>
      <div className="flex gap-1.5" aria-hidden>
        {TOUR.map((_, index) => (
          <span key={index} className={clsx("h-1.5 flex-1 rounded-full", index < step ? "bg-emerald-500" : index === step ? "bg-slate-900" : "bg-slate-200")} />
        ))}
      </div>
      <div className="mt-6 flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Icon className="h-6 w-6" /></span>
        <h3 className="mt-4 text-lg font-semibold text-slate-900">{current.title}</h3>
        <p className="mt-2 max-w-md text-sm text-slate-600">{current.body}</p>
        {current.to && (
          <Link to={current.to} onClick={onClose} className="mt-3 text-sm font-medium text-brand-700 hover:underline">
            Open it now →
          </Link>
        )}
      </div>
      <div className="mt-8 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onClose}>Skip tour</Button>
        <div className="flex gap-2">
          {step > 0 && <Button variant="secondary" size="sm" onClick={() => setStep(step - 1)}><ArrowLeft className="h-4 w-4" /> Back</Button>}
          <Button size="sm" onClick={() => (last ? onClose() : setStep(step + 1))}>
            {last ? "Start" : "Next"} {!last && <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-slate-400">Step {step + 1} of {TOUR.length}</p>
    </Modal>
  );
}
