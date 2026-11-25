// The two research modes hand over the question and the sources (Silver, 25 November 2026): Deep research opens
// with a question from Ask my papers, and a Deep research report can be asked about in Ask my papers.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ posts: [] as { path: string; body: unknown }[], run: null as unknown }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: {
    get: (path: string) => {
      if (path === "/research/deep/status") return Promise.resolve({ databases: ["openalex"], ai: false, web_search: false });
      if (path === "/research/deep") return Promise.resolve([]);
      return Promise.resolve(calls.run);
    },
    post: (path: string, body: unknown) => {
      calls.posts.push({ path, body });
      return Promise.resolve(path === "/papers/import" ? { id: "imported-1" } : {});
    },
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1", name: "Grace", role: "user", preferences: { guides: {} } }, loading: false }) }));

const { default: DeepResearchPage } = await import("@/pages/DeepResearch");

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function open(path: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/research/deep" element={<DeepResearchPage />} />
          <Route path="/research" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls.posts = [];
});

describe("handing over between the research modes", () => {
  it("Deep research opens with the question from Ask my papers", async () => {
    open("/research/deep?q=Does%20mobile%20money%20raise%20savings%3F");
    expect(await screen.findByLabelText("Your research question")).toHaveValue("Does mobile money raise savings?");
  });

  it("a report's sources are saved to the library and asked about in Ask my papers", async () => {
    calls.run = {
      id: "r1",
      question: "Does mobile money raise savings?",
      options: {},
      queries: ["mobile money savings"],
      services: [],
      report: null,
      citations: [],
      insufficient_evidence: false,
      gaps: "",
      model: null,
      report_status: "ai_not_connected",
      created_at: new Date().toISOString(),
      sources: [
        { kind: "scholarly", title: "Catalogued", url: null, year: 2016, read: false, identifier: "10.1/a", paper_id: "p1" },
        { kind: "scholarly", title: "Not yet in PaperAid", url: null, year: 2018, read: false, identifier: "10.1/b", paper_id: null },
        { kind: "web", title: "A web page", url: "https://example.org", year: 2020, read: false },
      ],
    };
    open("/research/deep?r=r1");
    await userEvent.click(await screen.findByRole("button", { name: /Ask my papers about these sources/ }));
    expect(calls.posts).toEqual([
      { path: "/library", body: { paper_id: "p1" } },
      { path: "/papers/import", body: { identifier: "10.1/b", add_to_library: true } },
    ]);
    expect(await screen.findByTestId("where")).toHaveTextContent(
      "/research?q=Does%20mobile%20money%20raise%20savings%3F&papers=p1,imported-1",
    );
  });
});
