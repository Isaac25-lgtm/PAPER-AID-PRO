import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import type { DemoElement, DemoScene } from "@/lib/demos";

import { Pointer } from "./LiveDemo";

interface StageState {
  hidden: Set<string>;
  labels: Record<string, string>;
  typed: Record<string, string>;
  selected: Set<string>;
  pointer: { x: number; y: number; visible: boolean; click: boolean; instant?: boolean };
}

function initial(scene: DemoScene): StageState {
  return {
    hidden: new Set(scene.elements.filter((e) => e.hidden).map((e) => e.id)),
    labels: {},
    typed: {},
    selected: new Set(),
    pointer: { x: 0, y: 0, visible: false, click: false, instant: true },
  };
}

/** The scene's final state (shown, without animation, to people who prefer reduced motion). */
export function finalState(scene: DemoScene): StageState {
  const state = initial(scene);
  for (const f of scene.frames) {
    f.reveal?.forEach((id) => state.hidden.delete(id));
    f.hide?.forEach((id) => state.hidden.add(id));
    Object.assign(state.labels, f.set ?? {});
    if (f.to && f.type) state.typed[f.to] = f.type;
    if (f.select) state.selected = new Set(f.select);
  }
  // Re-reveal anything a later frame hid only to animate it back in.
  for (const f of scene.frames) if (f.reveal && f.hide) f.reveal.forEach((id) => state.hidden.delete(id));
  return state;
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Element({ el, state, refFor }: { el: DemoElement; state: StageState; refFor: (id: string) => (node: HTMLElement | null) => void }) {
  if (state.hidden.has(el.id)) return null;
  const label = state.labels[el.id] ?? el.text;
  const typed = state.typed[el.id];
  const selected = state.selected.has(el.id);
  const common = { ref: refFor(el.id), "data-demo": el.id };
  switch (el.kind) {
    case "input":
      return (
        <div {...common} className={clsx("pa-fade flex min-w-0 items-center rounded-lg border bg-white px-2.5 py-1.5 text-[12px]", typed ? "border-slate-400" : "border-slate-200", el.grow && "flex-1")}>
          <span className={clsx("truncate", typed ? "text-slate-900" : "text-slate-400")}>{typed || label}</span>
          {typed !== undefined && <span className="pa-caret ml-px inline-block h-3.5 w-px bg-slate-900" />}
        </div>
      );
    case "button":
    case "accent":
      return (
        <div
          {...common}
          className={clsx(
            "pa-fade shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] font-medium",
            el.kind === "accent" ? "bg-brand-500 text-white" : selected ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700",
          )}
        >
          {label}
        </div>
      );
    case "card":
      return (
        <div {...common} className={clsx("pa-fade rounded-lg border bg-white px-3 py-2", selected ? "border-brand-300 ring-2 ring-brand-100" : "border-slate-200")}>
          <p className="line-clamp-2 text-[12.5px] leading-snug text-slate-900">{label}</p>
          {el.sub && <p className="mt-0.5 truncate text-[11px] text-slate-500">{el.sub}</p>}
        </div>
      );
    case "check":
      return (
        <div {...common} className="pa-fade flex items-center gap-2 text-[12.5px] text-slate-700">
          <span className={clsx("flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]", selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white")}>{selected ? "✓" : ""}</span>
          <span className={clsx(selected && "text-slate-900")}>{label}</span>
        </div>
      );
    case "chip":
      return (
        <div {...common} className={clsx("pa-pop self-start rounded-md px-2 py-1 font-mono text-[11px]", selected ? "bg-emerald-50 text-emerald-700" : "bg-brand-50 text-brand-700")}>
          {label}
        </div>
      );
    case "note":
      return (
        <div {...common} className={clsx("pa-fade rounded-lg border border-dashed px-3 py-2 text-[12px] leading-snug", selected ? "border-brand-300 bg-brand-50 text-slate-900" : "border-slate-300 bg-slate-50 text-slate-600")}>
          {label}
        </div>
      );
    default:
      return (
        <p {...common} className="font-mono text-[10.5px] uppercase tracking-wide text-slate-500">
          {label}
        </p>
      );
  }
}

/**
 * Plays a section's walkthrough: a ghost pointer moves to each element, types or clicks, and the page reacts.
 * Loops while mounted and `playing`; reports the guide step being shown. Reduced motion: the finished state.
 */
export function DemoStage({ scene, playing, onStep }: { scene: DemoScene; playing: boolean; onStep?: (step: number) => void }) {
  const reduced = useRef(reducedMotion()).current;
  const [state, setState] = useState<StageState>(() => (reduced ? finalState(scene) : initial(scene)));
  const stage = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const refFor = (id: string) => (node: HTMLElement | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  };
  const stepRef = useRef(onStep);
  stepRef.current = onStep;

  useEffect(() => {
    if (reduced || !playing) return;
    let cancelled = false;
    const timers: number[] = [];
    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) => timers.push(window.setTimeout(() => (cancelled ? reject(new Error("cancelled")) : resolve()), ms)));
    const point = (id?: string) => {
      const box = stage.current?.getBoundingClientRect();
      const r = id ? nodes.current.get(id)?.getBoundingClientRect() : undefined;
      if (!box || !r) return { x: (box?.width ?? 400) - 40, y: (box?.height ?? 240) - 30 };
      return { x: r.left - box.left + Math.min(r.width * 0.5, 60), y: r.top - box.top + r.height * 0.55 };
    };
    const update = (fn: (s: StageState) => StageState) => setState((s) => fn({ ...s, hidden: new Set(s.hidden), selected: new Set(s.selected), labels: { ...s.labels }, typed: { ...s.typed } }));
    const run = async () => {
      for (;;) {
        setState(initial(scene));
        stepRef.current?.(0);
        await sleep(500);
        const start = point(undefined);
        update((s) => ({ ...s, pointer: { ...start, visible: true, click: false, instant: true } }));
        await sleep(300);
        for (const frame of scene.frames) {
          stepRef.current?.(frame.step);
          if (frame.to) {
            const target = point(frame.to);
            update((s) => ({ ...s, pointer: { ...target, visible: true, click: false } }));
            await sleep(800);
          }
          if (frame.to && frame.type) {
            for (let i = 1; i <= frame.type.length; i++) {
              const value = frame.type.slice(0, i);
              const id = frame.to;
              update((s) => ({ ...s, typed: { ...s.typed, [id]: value } }));
              await sleep(42);
            }
            await sleep(250);
          }
          if (frame.click) {
            update((s) => ({ ...s, pointer: { ...s.pointer, click: true } }));
            await sleep(220);
            update((s) => ({ ...s, pointer: { ...s.pointer, click: false } }));
          }
          update((s) => {
            frame.hide?.forEach((id) => s.hidden.add(id));
            frame.reveal?.forEach((id) => s.hidden.delete(id));
            Object.assign(s.labels, frame.set ?? {});
            if (frame.select) s.selected = new Set(frame.select);
            return s;
          });
          await sleep(1100);
        }
        update((s) => ({ ...s, pointer: { ...s.pointer, visible: false } }));
        await sleep(2200);
      }
    };
    run().catch(() => undefined);
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [scene, playing, reduced]);

  const area = (name: DemoElement["area"]) => scene.elements.filter((e) => e.area === name).map((el) => <Element key={el.id} el={el} state={state} refFor={refFor} />);
  return (
    <div ref={stage} aria-hidden className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50" data-testid="section-demo">
      <div className="flex items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-slate-200" />
        <span className="h-2 w-2 rounded-full bg-slate-200" />
        <span className="h-2 w-2 rounded-full bg-slate-200" />
        <span className="ml-2 text-[11px] font-medium text-slate-500">{scene.title}</span>
      </div>
      <div className="flex min-h-[38px] items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">{area("bar")}</div>
      <div className="grid min-h-[200px] grid-cols-[1fr_150px] gap-3 p-3">
        <div className="flex min-w-0 flex-col gap-2">{area("main")}</div>
        <div className="flex min-w-0 flex-col gap-2">{area("side")}</div>
      </div>
      <Pointer {...state.pointer} />
    </div>
  );
}
