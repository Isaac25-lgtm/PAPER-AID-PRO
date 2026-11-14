// Section walkthroughs: every scene is internally consistent, plays to its last step, and reduced motion shows the end.
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DemoStage, finalState } from "@/components/SectionDemo";
import { DEMOS } from "@/lib/demos";
import { GUIDES, type SectionKey } from "@/lib/guides";

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({ matches: reduce && query.includes("reduce"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
}

afterEach(() => vi.useRealTimers());

describe("section walkthroughs", () => {
  it("cover every section, reference only their own elements, and every guide step", () => {
    for (const [key, scene] of Object.entries(DEMOS)) {
      const ids = new Set(scene.elements.map((e) => e.id));
      for (const frame of scene.frames) {
        for (const id of [frame.to, ...(frame.reveal ?? []), ...(frame.hide ?? []), ...(frame.select ?? []), ...Object.keys(frame.set ?? {})]) {
          if (id) expect(ids.has(id), `${key}: unknown element ${id}`).toBe(true);
        }
      }
      const steps = new Set(scene.frames.map((f) => f.step));
      expect([...steps].sort(), key).toEqual(GUIDES[key as SectionKey].steps.map((_, i) => i));
    }
  });

  it("plays through the steps with a moving pointer", async () => {
    setReducedMotion(false);
    vi.useFakeTimers();
    const seen: number[] = [];
    render(<DemoStage scene={DEMOS.library} playing onStep={(s) => seen.push(s)} />);
    await act(async () => vi.advanceTimersByTimeAsync(10_500));
    expect(screen.getByTestId("section-demo")).toHaveTextContent("Chapter 2"); // the collection was created
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(new Set(seen)).toEqual(new Set([0, 1, 2, 3]));
  });

  it("shows the finished state without animation for reduced motion", () => {
    setReducedMotion(true);
    render(<DemoStage scene={DEMOS.discover} playing />);
    expect(screen.getByTestId("section-demo")).toHaveTextContent("Saved ✓");
    expect(finalState(DEMOS.discover).hidden.size).toBe(0);
  });
});
