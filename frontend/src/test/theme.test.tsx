// Night mode: Light / Night / Match device, applied to <html>, remembered in the browser and on the account.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as null | { id: string; preferences: Record<string, unknown> }, patches: [] as unknown[] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: { patch: (_path: string, body: unknown) => (auth.patches.push(body), Promise.resolve({})) },
}));

const { ThemeProvider, ThemeSwitch, THEME_KEY } = await import("@/lib/theme");

function setDeviceDark(dark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: dark && query.includes("dark"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  auth.user = null;
  auth.patches = [];
  setDeviceDark(false);
});

describe("appearance", () => {
  it("switches to Night and back, remembering the choice", async () => {
    render(<ThemeProvider><ThemeSwitch /></ThemeProvider>);
    await userEvent.click(screen.getByRole("radio", { name: "Night" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement).not.toHaveClass("dark");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
  });

  it("follows the device by default", () => {
    setDeviceDark(true);
    render(<ThemeProvider><ThemeSwitch /></ThemeProvider>);
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByRole("radio", { name: "Match device" })).toHaveAttribute("aria-checked", "true");
  });

  it("saves the choice to the account and adopts the account's choice on a new device", async () => {
    auth.user = { id: "u1", preferences: { theme: "dark" } };
    render(<ThemeProvider><ThemeSwitch /></ThemeProvider>);
    expect(document.documentElement).toHaveClass("dark"); // new device: the account says Night
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(auth.patches.at(-1)).toEqual({ values: { theme: "light" } });
  });
});
