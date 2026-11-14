// Readability in both themes: text colour roles meet WCAG AA (4.5:1) on every surface they are used on, computed from
// the actual theme tokens; icon/placeholder grey meets the 3:1 non-text minimum.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../theme.css"), "utf-8");
const [lightBlock = "", darkBlock = ""] = css.split(":root.dark");

function tokens(block: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const m of block.matchAll(/--c-([a-z0-9-]+): (\d+) (\d+) (\d+);/g)) out[m[1]!] = [Number(m[2]), Number(m[3]), Number(m[4])];
  return out;
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["white", "slate-50", "slate-100"];
const TEXT_ROLES = ["slate-500", "slate-600", "slate-700", "slate-900", "slate-950", "brand-700", "emerald-700", "red-700"];

describe.each([
  ["Graphite (light)", tokens(lightBlock)],
  ["Night", tokens(darkBlock)],
])("%s theme", (_name, t) => {
  it("text roles reach 4.5:1 on every surface", () => {
    for (const fg of TEXT_ROLES) for (const bg of SURFACES) expect(ratio(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("icons and placeholders reach 3:1 on the main surface", () => {
    expect(ratio(t["slate-400"]!, t.white!)).toBeGreaterThanOrEqual(3);
  });
});
