// Landing-page live demo: plays the writing story while visible; reduced-motion users get the finished frame.
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LIVE_DEMO_SCRIPT, LiveDemo } from "@/components/LiveDemo";

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => vi.useRealTimers());

describe("live demo", () => {
  it("shows the finished frame, without animation, to people who prefer reduced motion", () => {
    setReducedMotion(true);
    render(<LiveDemo />);
    const demo = screen.getByTestId("live-demo");
    expect(demo).toHaveTextContent("Aker & Mbiti, 2010");
    expect(demo).toHaveTextContent(LIVE_DEMO_SCRIPT.SUGGESTION.trim());
    expect(screen.getAllByText("Matched")).toHaveLength(3);
    expect(demo.querySelector(".pa-pop")).toBeNull();
  });

  it("plays the story: typing, a suggestion accepted with Tab, /cite, a pick and the reference check", async () => {
    setReducedMotion(false);
    vi.useFakeTimers();
    render(<LiveDemo />);
    const demo = screen.getByTestId("live-demo");
    expect(demo).not.toHaveTextContent("Aker & Mbiti, 2010");
    await act(async () => vi.advanceTimersByTimeAsync(4500));
    expect(demo).toHaveTextContent(LIVE_DEMO_SCRIPT.TYPED.trim());
    expect(demo).toHaveTextContent("Tab");
    await act(async () => vi.advanceTimersByTimeAsync(7000));
    expect(demo).toHaveTextContent("/cite");
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(demo).toHaveTextContent("Aker & Mbiti, 2010");
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(screen.getAllByText("Matched")).toHaveLength(3);
  });
});
