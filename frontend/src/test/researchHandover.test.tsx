// The two research modes hand over the question and the sources (Silver, 25 November 2026), in memory only: the
// question and the papers never appear in the address, the history or a reload (audit SF02), and they never pass to
// another account.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearHandover, handOver, peekHandover } from "@/lib/handover";

const calls = vi.hoisted(() => ({ posts: [] as { path: string; body: unknown }[], run: null as unknown, importFails: 0, hold: null as null | Promise<void> }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: {
    get: (path: string) => {
      if (path === "/research/deep/status") return Promise.resolve({ databases: ["openalex"], ai: false, web_search: false });
      if (path === "/research/deep" || path === "/research/conversations") return Promise.resolve([]);
      if (path === "/ai/status") return Promise.resolve({ enabled: false });
      return Promise.resolve(calls.run);
    },
    page: () => Promise.resolve({ items: [], total: 0 }),
    post: async (path: string, body: unknown) => {
      calls.posts.push({ path, body });
      if (calls.hold) await calls.hold;
      if (path === "/papers/import" && calls.importFails > 0) {
        calls.importFails -= 1;
        throw new Error("Crossref is unavailable.");
      }
      return path === "/papers/import" ? { id: "imported-1" } : {};
    },
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1", name: "Grace", role: "user", preferences: { guides: {} } }, loading: false }) }));

const { default: DeepResearchPage } = await import("@/pages/DeepResearch");
const { default: ResearchPage } = await import("@/pages/Research");

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function open(path: string, routes: { research?: boolean; deep?: boolean } = { deep: true }) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/research/deep" element={routes.deep ? <DeepResearchPage /> : <Where />} />
          <Route path="/research" element={routes.research ? <ResearchPage /> : <Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const QUESTION = "Does mobile money raise savings?";

beforeEach(() => {
  calls.posts = [];
  calls.importFails = 0;
  calls.hold = null;
  clearHandover();
});

describe("handing over between the research modes", () => {
  it("Deep research opens with the question handed from Ask my papers, and consumes it", async () => {
    handOver("u1", "deep", { question: QUESTION, paperIds: [] });
    open("/research/deep");
    expect(await screen.findByLabelText("Your research question")).toHaveValue(QUESTION);
    expect(peekHandover("u1", "deep")).toBeNull(); // read once: a later visit starts empty
  });

  it("another account never receives a handed-over question", async () => {
    handOver("someone-else", "deep", { question: QUESTION, paperIds: [] });
    open("/research/deep");
    expect(await screen.findByLabelText("Your research question")).toHaveValue("");
  });

  it("Ask my papers hands its question to Deep research without putting it in the address", async () => {
    handOver("u1", "ask", { question: QUESTION, paperIds: ["p1", "p2"] });
    open("/research", { research: true });
    expect(await screen.findByLabelText("Research question")).toHaveValue(QUESTION);
    expect(screen.getByText("2 papers selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Search further with Deep research/ }));
    expect(await screen.findByTestId("where")).toHaveTextContent(/^\/research\/deep$/); // no ?q=
    expect(peekHandover("u1", "deep")?.question).toBe(QUESTION);
  });

  it("a report's sources are saved to the library and handed to Ask my papers, with nothing in the address", async () => {
    calls.run = {
      id: "r1",
      question: QUESTION,
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
    expect(await screen.findByTestId("where")).toHaveTextContent(/^\/research$/); // no question, no paper ids
    expect(peekHandover("u1", "ask")).toEqual({ question: QUESTION, paperIds: ["p1", "imported-1"] });
  });
});

const RUN = {
  id: "r1",
  question: QUESTION,
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
  ],
};

describe("a handover that only partly succeeds (audit SF08)", () => {
  it("says what was saved, can continue with it, and a retry redoes only what failed", async () => {
    calls.run = RUN;
    calls.importFails = 1;
    open("/research/deep?r=r1");
    await userEvent.click(await screen.findByRole("button", { name: /Ask my papers about these sources/ }));
    expect(await screen.findByText(/Saved 1 of 2 to your library/)).toBeInTheDocument();
    expect(screen.getByText(/Not yet in PaperAid \(Crossref is unavailable\.\)/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry the 1 that failed" }));
    expect(await screen.findByTestId("where")).toHaveTextContent(/^\/research$/);
    expect(calls.posts.map((c) => c.path)).toEqual(["/library", "/papers/import", "/papers/import"]); // p1 not saved twice
    expect(peekHandover("u1", "ask")?.paperIds).toEqual(["p1", "imported-1"]);
  });

  it("can continue with the papers that were saved", async () => {
    calls.run = RUN;
    calls.importFails = 1;
    open("/research/deep?r=r1");
    await userEvent.click(await screen.findByRole("button", { name: /Ask my papers about these sources/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Continue with the 1 saved" }));
    expect(await screen.findByTestId("where")).toHaveTextContent(/^\/research$/);
    expect(peekHandover("u1", "ask")?.paperIds).toEqual(["p1"]);
  });

  it("leaving while the saves are running never pulls the person back", async () => {
    calls.run = RUN;
    let release!: () => void;
    calls.hold = new Promise<void>((resolve) => (release = resolve));
    const view = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/research/deep?r=r1"]}>
          <Routes>
            <Route path="/research/deep" element={<DeepResearchPage />} />
            <Route path="/research" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: /Ask my papers about these sources/ }));
    view.unmount(); // the person went elsewhere
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(peekHandover("u1", "ask")).toBeNull(); // nothing handed over, no late navigation
  });
});
