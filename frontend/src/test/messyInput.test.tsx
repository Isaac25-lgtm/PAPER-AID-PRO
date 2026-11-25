// Real users misspell: Discover says when it corrected a search and offers the exact words; AI controls are not
// offered while AI is off (they could only fail), and say plainly why.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ gets: [] as { path: string; params?: Record<string, unknown> }[], ai: false }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: {
    get: (path: string, params?: Record<string, unknown>) => {
      calls.gets.push({ path, params });
      if (path === "/ai/status") return Promise.resolve({ enabled: calls.ai, provider: "none", model: null, embeddings_enabled: false });
      return Promise.resolve([]);
    },
    // Discover's search is streamed: replay the events the server sends.
    stream: (path: string, params: Record<string, unknown>, onEvent: (event: unknown) => void) => {
      calls.gets.push({ path, params });
      const exact = Boolean(params?.exact);
      const results = [
        { title: "School malaria prevention trial", abstract: "a", authors: [], year: 2021, journal: null, doi: "10.1/a", identifier: "10.1/a", is_open_access: false, citation_count: 0, sources: ["openalex"], library_paper_id: null },
        { title: "Second study", abstract: "b", authors: [], year: 2020, journal: null, doi: "10.1/b", identifier: "10.1/b", is_open_access: false, citation_count: 0, sources: ["crossref"], library_paper_id: null },
      ];
      onEvent({ type: "query", query: exact ? "malria preventon" : "malaria prevention", corrected_from: exact ? null : "malria preventon", identifier: null, pending: ["openalex"] });
      onEvent({ type: "results", results, providers: [{ provider: "openalex", ok: true, count: 2, error: null }], pending: [] });
      if (exact) onEvent({ type: "suggestion", query: "malaria prevention" });
      onEvent({ type: "done" });
      return Promise.resolve();
    },
    post: () => Promise.resolve({}),
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1", name: "Grace", role: "user", preferences: { guides: {} } }, loading: false }) }));

const { default: DiscoverPage } = await import("@/pages/Discover");

function wrap(ui: ReactNode, path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/discover" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls.gets = [];
  calls.ai = false;
});

describe("misspelled searches", () => {
  it("says what it searched for and offers exactly what was typed", async () => {
    wrap(<DiscoverPage />, "/discover?q=malria%20preventon");
    const note = (await screen.findByText(/Showing results for/)).closest("p")!;
    expect(note).toHaveTextContent("Showing results for malaria prevention.");
    expect(note).toHaveAttribute("role", "status");
    await userEvent.click(screen.getByRole("button", { name: "Search instead for “malria preventon”" }));
    expect(calls.gets.filter((c) => c.path === "/discovery/search/stream").at(-1)?.params).toMatchObject({ q: "malria preventon", exact: true });
    expect(await screen.findByText("School malaria prevention trial")).toBeInTheDocument();
    expect(screen.queryByText(/Showing results for/)).toBeNull();
  });
});

describe("AI controls while AI is off", () => {
  it("does not offer the research overview", async () => {
    wrap(<DiscoverPage />, "/discover?q=malria%20preventon");
    await screen.findByText("School malaria prevention trial");
    expect(screen.queryByRole("button", { name: "Generate overview" })).toBeNull();
  });

  it("offers it once AI is on", async () => {
    calls.ai = true;
    wrap(<DiscoverPage />, "/discover?q=malria%20preventon");
    expect(await screen.findByRole("button", { name: "Generate overview" })).toBeInTheDocument();
  });
});
