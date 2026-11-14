import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ user: { id: "u1", name: "Grace Namaganda", email: "g@example.edu", role: "user" } as null | Record<string, string> }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: authState.user, loading: false }) }));
const apiData = vi.hoisted(() => ({ responses: {} as Record<string, unknown> }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: { get: (path: string) => Promise.resolve(apiData.responses[path] ?? []) },
}));

const { GuidanceProvider, SectionGuide } = await import("@/components/Guidance");
const { default: DashboardPage } = await import("@/pages/Dashboard");
const { HomePage } = await import("@/pages/Home");

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  authState.user = { id: "u1", name: "Grace Namaganda", email: "g@example.edu", role: "user" };
  apiData.responses = {};
});

describe("SectionGuide", () => {
  it("is expanded on the first visit and remembers when it is hidden", async () => {
    const { unmount } = wrap(<SectionGuide section="library" />);
    expect(screen.getByText(/Create collections/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /How to use Library/ }));
    expect(screen.queryByText(/Create collections/)).not.toBeInTheDocument();
    unmount();
    wrap(<SectionGuide section="library" />);
    expect(screen.queryByText(/Create collections/)).not.toBeInTheDocument(); // still collapsed on return
    expect(screen.getByRole("button", { name: /How to use Library/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("is not shown to signed-out visitors", () => {
    authState.user = null;
    wrap(<SectionGuide section="discover" />);
    expect(screen.queryByText(/How to use/)).not.toBeInTheDocument();
  });
});

describe("Welcome tour", () => {
  it("appears once per account and can be stepped through", async () => {
    const { unmount } = wrap(<GuidanceProvider><p>app</p></GuidanceProvider>);
    const dialog = await screen.findByRole("dialog", { name: "Welcome, Grace" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Next/ }));
    expect(within(dialog).getByText("1. Find papers")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    unmount();
    wrap(<GuidanceProvider><p>app</p></GuidanceProvider>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Dashboard checklist", () => {
  it("ticks steps off from the account's real data", async () => {
    window.localStorage.setItem("paperaid.welcome.v1.u1", "done");
    apiData.responses = {
      "/library": [{ paper: { id: "p1", has_full_text: true } }],
      "/documents": [{ id: "d1", title: "Chapter 2", word_count: 1200, updated_at: new Date().toISOString() }],
    };
    wrap(<DashboardPage />);
    expect(await screen.findByText("3 of 5 steps complete. Each step ticks itself off when you do it.")).toBeInTheDocument();
    expect(screen.getByText("Organise a collection")).toBeInTheDocument();
    expect(screen.getByText("Chapter 2")).toBeInTheDocument();
  });
});

describe("Landing page", () => {
  it("has one primary call to action, an FAQ and no invented social proof", async () => {
    authState.user = null;
    wrap(<HomePage />);
    expect(screen.getAllByRole("link", { name: /Start writing — it's free/ })[0]).toHaveAttribute("href", "/register");
    await userEvent.click(screen.getByRole("button", { name: "Who can see my work?" }));
    expect(screen.getByText(/Only you\./)).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\d[\d,.]*\s*(million|k\b|users|researchers|universities)/i);
  });
});
