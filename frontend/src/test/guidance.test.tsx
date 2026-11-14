import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TestUser = { id: string; name: string; email: string; role: string; preferences?: Record<string, unknown>; accepted_policy_version?: string | null };
const authState = vi.hoisted(() => ({
  user: null as null | TestUser,
  refresh: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: authState.user, loading: false, refresh: authState.refresh, signOut: authState.signOut }) }));
const apiData = vi.hoisted(() => ({
  responses: {} as Record<string, unknown>,
  failing: new Set<string>(),
  posts: [] as { path: string; body: unknown }[],
  patches: [] as { path: string; body: unknown }[],
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: {
    get: (path: string) =>
      apiData.failing.has(path) ? Promise.reject(new Error("offline")) : Promise.resolve(apiData.responses[path] ?? []),
    page: () => Promise.resolve({ items: [], total: 0 }),
    post: (path: string, body: unknown) => {
      apiData.posts.push({ path, body });
      return Promise.resolve({});
    },
    patch: (path: string, body: unknown) => {
      apiData.patches.push({ path, body });
      return Promise.resolve({});
    },
  },
}));

const { GuidanceProvider, SectionGuide, useGuidance } = await import("@/components/Guidance");
const { ConsentGate } = await import("@/components/Consent");
const { HighlightedExcerpt } = await import("@/components/GroundedAnswerView");
const { default: DashboardPage } = await import("@/pages/Dashboard");
const { HomePage } = await import("@/pages/Home");
const { default: CitationToolsPage } = await import("@/pages/CitationTools");

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
  authState.user = { id: "u1", name: "Grace Namaganda", email: "g@example.edu", role: "user", preferences: {}, accepted_policy_version: "2026-11-14" };
  authState.refresh.mockReset();
  apiData.responses = {};
  apiData.failing = new Set();
  apiData.posts = [];
  apiData.patches = [];
});

describe("SectionGuide", () => {
  it("is a single quiet line by default and remembers being opened, on the account", async () => {
    const { unmount } = wrap(<SectionGuide section="library" />);
    expect(screen.queryByText(/Create collections/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /New here\? How Library works/ }));
    expect(screen.getByText(/Create collections/)).toBeInTheDocument();
    expect(apiData.patches.at(-1)).toEqual({ path: "/me/preferences", body: { values: { guide_library_open: true } } });
    unmount();
    wrap(<SectionGuide section="library" />);
    expect(screen.getByText(/Create collections/)).toBeInTheDocument(); // still open on return
  });

  it("follows the account to another device", () => {
    authState.user = { ...authState.user!, preferences: { guide_discover_open: true } };
    wrap(<SectionGuide section="discover" />);
    expect(screen.getByText(/Narrow results with a start year/)).toBeInTheDocument();
  });

  it("is not shown to signed-out visitors", () => {
    authState.user = null;
    wrap(<SectionGuide section="discover" />);
    expect(screen.queryByText(/How Discover works/)).not.toBeInTheDocument();
  });
});

describe("Welcome tour", () => {
  function TourButton() {
    const { openTour } = useGuidance();
    return <button onClick={openTour}>start tour</button>;
  }

  it("never pops up by itself, and can be stepped through when asked for", async () => {
    wrap(<GuidanceProvider><TourButton /></GuidanceProvider>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("start tour"));
    const dialog = await screen.findByRole("dialog", { name: "Welcome, Grace" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Next/ }));
    expect(within(dialog).getByText("1. Find papers")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(apiData.patches.at(-1)).toEqual({ path: "/me/preferences", body: { values: { tour_seen: true } } });
  });
});

describe("Dashboard", () => {
  it("ticks checklist steps off from exact progress counts and offers the tour", async () => {
    apiData.responses = {
      "/me/progress": { library: 120, full_text: 1, collections: 0, documents: 1, conversations: 0 },
      "/documents": [{ id: "d1", title: "Chapter 2", word_count: 1200, updated_at: new Date().toISOString() }],
    };
    wrap(<GuidanceProvider><DashboardPage /></GuidanceProvider>);
    expect(await screen.findByText("3 of 5 steps complete. Each step ticks itself off when you do it.")).toBeInTheDocument();
    expect(screen.getByText("Organise a collection")).toBeInTheDocument();
    expect(screen.getByText("Chapter 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take the tour" })).toBeInTheDocument();
  });

  it("shows a retry instead of a misleading empty checklist when progress fails to load", async () => {
    apiData.failing.add("/me/progress");
    wrap(<GuidanceProvider><DashboardPage /></GuidanceProvider>);
    expect(await screen.findByText(/Could not load your progress/)).toBeInTheDocument();
    expect(screen.queryByText(/steps complete/)).not.toBeInTheDocument();
  });
});

describe("Consent gate", () => {
  it("requires every required item, keeps optional ones off by default and records the choices", async () => {
    authState.user = { ...authState.user!, accepted_policy_version: null };
    wrap(<ConsentGate />);
    const submit = screen.getByRole("button", { name: "Agree and continue" });
    expect(submit).toBeDisabled();
    const boxes = screen.getAllByRole("checkbox");
    for (const box of boxes.slice(0, 4)) await userEvent.click(box); // the four required items
    expect(boxes[4]).not.toBeChecked();
    expect(boxes[5]).not.toBeChecked();
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(apiData.posts.at(-1)).toEqual({
      path: "/me/consent",
      body: { terms: true, privacy: true, ai_processing: true, age_18: true, product_emails: false, analytics: false },
    });
  });
});

describe("Evidence excerpts", () => {
  it("highlights exactly the verified supporting words", () => {
    const excerpt = "Background. Confirmed malaria incidence was 31 percent lower in schools. More text.";
    const start = excerpt.indexOf("malaria incidence");
    const end = excerpt.indexOf(" in schools");
    render(
      <HighlightedExcerpt
        citation={{
          key: "E1", paper_id: "p", title: "t", authors: [], year: 2021, doi: null, kind: "passage", chunk_id: null,
          section: "Results", page_start: 4, page_end: 4, excerpt, quotes: [{ text: excerpt.slice(start, end), start, end }],
          excerpt_truncated_start: true,
        }}
      />,
    );
    const mark = document.querySelector("mark");
    expect(mark?.textContent).toBe("malaria incidence was 31 percent lower");
    expect(document.body.textContent?.startsWith("“…")).toBe(true);
  });
});

describe("Citation generator limits", () => {
  it("shows the identifier limit and blocks requests above it before sending", async () => {
    authState.user = null;
    wrap(<CitationToolsPage />);
    const box = screen.getByLabelText("Identifiers");
    await userEvent.click(box);
    await userEvent.paste(Array.from({ length: 21 }, (_, i) => `10.1000/${i}`).join("\n"));
    expect(screen.getByText(/21 of 20 identifiers/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Format" })).toBeDisabled();
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
