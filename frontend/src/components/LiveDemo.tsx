import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * Landing-page product demo: a short, looping piece of "live work" in the real interface style. Someone writes,
 * an AI suggestion appears as grey text and is accepted with Tab, "/cite" opens the cite search, a pointer picks a
 * result, the citation drops into the sentence and the reference check confirms it.
 *
 * Every paper shown is real, with its real bibliographic details: Suri & Jack (2016, Science), Jack & Suri (2014,
 * American Economic Review), Aker & Mbiti (2010, Journal of Economic Perspectives) and Aker (2010, American
 * Economic Journal: Applied Economics). The three checked references were verified as matched by the live
 * reference checker. The animation runs only while visible, and people who prefer reduced motion see the
 * finished state without animation.
 */

const TYPED = " rural and urban households";
const SUGGESTION = ", which raises the question of who the agent networks reach first.";
const SECOND = " Mobile phones also lowered search costs for grain traders in Niger ";
const QUERY = "mobile phones markets Niger";
const RESULTS = [
  { title: "Information from markets near and far: mobile phones and agricultural markets in Niger", meta: "Aker · 2010 · American Economic Journal: Applied Economics · via OpenAlex, Crossref" },
  { title: "Mobile phones and economic development in Africa", meta: "Aker & Mbiti · 2010 · Journal of Economic Perspectives · via Crossref" },
];

interface DemoState {
  typed: string;
  ghost: string;
  accepted: boolean;
  tabFlash: boolean;
  second: string;
  slash: boolean;
  palette: boolean;
  query: string;
  results: number;
  pointer: { x: number; y: number; visible: boolean; click: boolean; instant?: boolean };
  cited: boolean;
  check: "none" | "checking" | "matched";
}

const START: DemoState = {
  typed: "",
  ghost: "",
  accepted: false,
  tabFlash: false,
  second: "",
  slash: false,
  palette: false,
  query: "",
  results: 0,
  pointer: { x: 0, y: 0, visible: false, click: false },
  cited: false,
  check: "none",
};

const FINISHED: DemoState = {
  ...START,
  typed: TYPED,
  ghost: SUGGESTION,
  accepted: true,
  second: SECOND,
  cited: true,
  check: "matched",
};

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Chip({ children, pop }: { children: ReactNode; pop?: boolean }) {
  return <span className={clsx("mx-0.5 inline-block whitespace-nowrap rounded-[5px] bg-brand-50 px-1.5 py-0.5 font-mono text-[11.5px] leading-none text-brand-700", pop && "pa-pop")}>{children}</span>;
}

function Kbd({ children, flash }: { children: ReactNode; flash?: boolean }) {
  return (
    <span className={clsx("rounded border px-1.5 py-px font-mono text-[10.5px] transition-colors duration-150", flash ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500")}>
      {children}
    </span>
  );
}

function Caret() {
  return <span className="pa-caret ml-px inline-block h-[18px] w-[2px] translate-y-[3px] bg-brand-500" />;
}

export function Pointer({ x, y, visible, click, instant }: DemoState["pointer"]) {
  return (
    <span
      className={clsx("pointer-events-none absolute left-0 top-0 z-20 ease-[cubic-bezier(.4,0,.2,1)]", !instant && "transition-[transform,opacity] duration-700")}
      style={{ transform: `translate(${x}px, ${y}px)`, opacity: visible ? 1 : 0 }}
    >
      {click && <span className="pa-ripple absolute -left-3 -top-3 h-6 w-6 rounded-full bg-brand-500/30" />}
      <svg width="18" height="22" viewBox="0 0 18 22" className={clsx("drop-shadow-md transition-transform duration-100", click && "scale-90")}>
        <path d="M1.5 1.5v16.2l4.3-4.1 2.8 6.4 2.7-1.2-2.8-6.3h6z" className="fill-slate-950 stroke-white" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function CheckRow({ label, status }: { label: string; status: "matched" | "checking" | "differs" }) {
  return (
    <div className={clsx("flex items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2.5 text-[13px]", status === "differs" ? "border-brand-200" : "border-slate-200")}>
      <span className={clsx("truncate", status === "differs" ? "text-slate-500" : "text-slate-800")}>{label}</span>
      {status === "matched" && <span className="shrink-0 font-medium text-emerald-700">Matched</span>}
      {status === "checking" && <span className="flex shrink-0 items-center gap-1 text-slate-500"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Checking</span>}
      {status === "differs" && <span className="shrink-0 font-medium text-brand-700">Year differs</span>}
    </div>
  );
}

export function LiveDemo() {
  const reduced = useRef(prefersReducedMotion()).current;
  const [s, setS] = useState<DemoState>(reduced ? FINISHED : START);
  const set = (patch: Partial<DemoState>) => setS((prev) => ({ ...prev, ...patch }));
  const frame = useRef<HTMLDivElement>(null);
  const firstResult = useRef<HTMLDivElement>(null);
  const restingPoint = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);

  // Animate only while on screen and while the tab is visible.
  useEffect(() => {
    if (reduced || !frame.current) return;
    let onScreen = typeof IntersectionObserver === "undefined";
    const update = () => setActive(onScreen && document.visibilityState !== "hidden");
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            onScreen = entries.some((e) => e.isIntersecting);
            update();
          }, { threshold: 0.25 });
    observer?.observe(frame.current);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [reduced]);

  const pointAt = (el: HTMLElement | null, fx = 0.35, fy = 0.5) => {
    const box = frame.current?.getBoundingClientRect();
    const r = el?.getBoundingClientRect();
    if (!box || !r) return { x: 0, y: 0 };
    return { x: r.left - box.left + r.width * fx, y: r.top - box.top + r.height * fy };
  };

  useEffect(() => {
    if (!active || paused) return;
    let cancelled = false;
    let timer: number | undefined; // one pending timer at a time
    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        timer = window.setTimeout(() => (cancelled ? reject(new Error("cancelled")) : resolve()), ms);
      });
    const type = async (key: "typed" | "second" | "query", text: string, speed: number) => {
      for (let i = 1; i <= text.length; i++) {
        const value = text.slice(0, i);
        setS((prev) => ({ ...prev, [key]: value }));
        await sleep(speed + (text[i - 1] === " " ? speed : 0));
      }
    };
    const run = async () => {
      for (;;) {
        setS(START);
        await sleep(900);
        await type("typed", TYPED, 55);
        await sleep(700);
        set({ ghost: SUGGESTION }); // the writer pauses: an AI suggestion appears in grey
        await sleep(1700);
        set({ tabFlash: true });
        await sleep(220);
        set({ accepted: true, tabFlash: false }); // Tab accepts it
        await sleep(900);
        await type("second", SECOND, 45);
        set({ slash: true }); // "/cite"
        await sleep(450);
        set({ palette: true });
        await sleep(350);
        await type("query", QUERY, 60);
        await sleep(300);
        set({ results: 1 });
        await sleep(160);
        set({ results: 2 });
        await sleep(400);
        const rest = pointAt(restingPoint.current, 0.5, 0.5);
        set({ pointer: { ...rest, visible: false, click: false, instant: true } }); // jump there unseen
        await sleep(80);
        set({ pointer: { ...rest, visible: true, click: false } });
        await sleep(250);
        const target = pointAt(firstResult.current);
        set({ pointer: { ...target, visible: true, click: false } }); // the pointer glides to the result
        await sleep(950);
        set({ pointer: { ...target, visible: true, click: true } });
        await sleep(260);
        set({ palette: false, slash: false, cited: true, check: "checking", pointer: { ...target, visible: true, click: false } });
        await sleep(500);
        set({ pointer: { ...target, visible: false, click: false } });
        await sleep(900);
        set({ check: "matched" });
        await sleep(3600);
      }
    };
    run().catch(() => undefined);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, paused]);

  const writing = !s.accepted || !s.cited;
  return (
    <div className="mx-auto mt-14 w-full max-w-[1120px]">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-left text-xs text-slate-500">
      <span>Illustrative walkthrough with real papers. “Matched” means the title, first author and year agree with the Crossref record.</span>
      {!reduced && (
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          aria-pressed={paused}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
        >
          {paused ? "▶ Play" : "❚❚ Pause"}
        </button>
      )}
    </div>
    <div ref={frame} aria-hidden className="relative w-full overflow-hidden rounded-t-2xl border border-b-0 border-slate-200 bg-slate-50 text-left" data-testid="live-demo">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-200" />
        <span className="ml-3 text-xs font-medium text-slate-500">Chapter 2 · Literature review</span>
        <span className={clsx("ml-auto font-mono text-[11px] transition-colors", writing && !reduced ? "text-slate-400" : "text-emerald-700")}>
          {writing && !reduced ? "● saving…" : "● saved"}
        </span>
      </div>
      <div className="grid md:grid-cols-[200px_1fr_280px]">
        <div className="hidden flex-col gap-1.5 border-r border-slate-200 p-4 text-[13px] text-slate-500 md:flex">
          <span className="mb-1 font-semibold text-slate-900">Documents</span>
          <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-slate-900">Chapter 2 · Literature review</span>
          <span className="px-2.5 py-2">Research proposal</span>
          <span className="px-2.5 py-2">Concept note</span>
        </div>
        <div className="relative min-h-[430px] bg-white px-6 pb-10 pt-7 sm:px-10">
          <p className="text-[22px] font-semibold tracking-[-0.02em] text-slate-950">2.1 Access and adoption</p>
          <p className="mt-3 font-serif text-[16.5px] leading-[1.8] text-slate-800">
            Mobile money has changed how households in East Africa save, send and borrow <Chip>Suri &amp; Jack, 2016</Chip>. Early studies linked access to agent
            networks with smoother consumption after shocks <Chip>Jack &amp; Suri, 2014</Chip>. Yet the benefits are not shared evenly across{s.typed}
            {s.ghost && !s.accepted && (
              <>
                <Caret />
                <span className="text-slate-500">{s.ghost}</span>
              </>
            )}
            {s.accepted && s.ghost}
            {s.second}
            {s.slash && <span className="font-mono text-[14px] text-brand-600">/cite</span>}
            {s.cited && (
              <>
                <Chip pop={!reduced}>Aker, 2010</Chip>.
              </>
            )}
            {!(s.ghost && !s.accepted) && <Caret />}
          </p>
          <p className={clsx("mt-2 flex h-5 items-center gap-1.5 text-[11.5px] text-slate-500 transition-opacity duration-300", s.ghost && !s.accepted ? "opacity-100" : "opacity-0")}>
            Suggestion · <Kbd flash={s.tabFlash}>Tab</Kbd> accept · <Kbd>Esc</Kbd> dismiss
          </p>
          {s.palette && (
            <div className="pa-rise mt-1 max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_24px_48px_-24px_rgba(0,0,0,0.35)]">
              <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
                <span className="font-mono text-xs text-brand-600">/cite</span>
                <span className="text-[14px] text-slate-900">{s.query}</span>
                <span className="pa-caret inline-block h-4 w-px bg-slate-900" />
              </div>
              <div className="min-h-[104px] p-1.5">
                {s.results === 0 && <p className="px-2.5 py-2 text-[12px] text-slate-500">Searching your library and all sources…</p>}
                {RESULTS.slice(0, s.results).map((r, i) => (
                  <div
                    key={r.title}
                    ref={i === 0 ? firstResult : undefined}
                    className={clsx("pa-fade flex items-center justify-between gap-3 rounded-lg px-2.5 py-2", i === 0 && "bg-slate-100")}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-slate-900">{r.title}</span>
                      <span className="block truncate text-[11.5px] text-slate-500">{r.meta}</span>
                    </span>
                    {i === 0 && <span className="shrink-0 font-mono text-[11px] text-slate-500">↵ cite</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="hidden flex-col gap-2.5 border-l border-slate-200 p-4 md:flex">
          <span ref={restingPoint} className="font-mono text-[11px] tracking-wide text-slate-500">REFERENCE CHECK</span>
          <CheckRow label="Jack & Suri (2014)" status="matched" />
          <CheckRow label="Suri & Jack (2016)" status="matched" />
          {s.check !== "none" && (
            <div className={clsx(!reduced && "pa-fade")}>
              <CheckRow label="Aker (2010)" status={s.check === "matched" ? "matched" : "checking"} />
            </div>
          )}
          <CheckRow label="A reference with the wrong year" status="differs" />
        </div>
      </div>
      <Pointer {...s.pointer} />
    </div>
    </div>
  );
}

/** The scripted text (used by tests). */
export const LIVE_DEMO_SCRIPT = { TYPED, SUGGESTION, SECOND, QUERY };
