// Deep research: a clearly separate mode next to Research on your own papers; shows what is connected; runs a
// question and shows the searches, the verified report (web pages labelled as such) and every source found.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DeepResearchRun, DeepResearchStatus } from "@/lib/types";

const calls = vi.hoisted(() => ({ posts: [] as { path: string; body: unknown }[], status: null as unknown, runs: {} as Record<string, unknown> }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: {
    get: (path: string) => {
      if (path === "/research/deep/status") return Promise.resolve(calls.status);
      if (path === "/research/deep") return Promise.resolve([]);
      const id = path.split("/").pop()!;
      return Promise.resolve(calls.runs[id]);
    },
    post: (path: string, body: unknown) => {
      calls.posts.push({ path, body });
      if (path === "/research/deep") return Promise.resolve(RUN);
      return Promise.resolve({ id: "p9" });
    },
    delete: () => Promise.resolve(undefined),
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1", name: "Grace", role: "user", preferences: {} }, loading: false }) }));

const { default: DeepResearchPage } = await import("@/pages/DeepResearch");
const { ResearchModes } = await import("@/components/ResearchModes");

const CONNECTED: DeepResearchStatus = { databases: ["openalex", "crossref", "pubmed"], ai: true, web_search: true };
const QUOTE = "reduced malaria incidence";
const RUN: DeepResearchRun = {
  id: "r1",
  question: "Do school bed net programmes reduce malaria?",
  options: { subject: "all", include_web: true, planned_by_ai: true },
  queries: ["school bed nets malaria", "insecticide-treated nets schools"],
  services: [
    { name: "openalex", kind: "scholarly", ok: true, count: 25, error: null },
    { name: "pubmed", kind: "scholarly", ok: false, count: 0, error: "timeout" },
    { name: "web", kind: "web", ok: true, count: 1, error: null },
  ],
  report: "Bed nets lowered malaria incidence [E1]. A ministry page reports fewer fever visits [E2].",
  citations: [
    { key: "E1", paper_id: "p1", title: "School-based malaria prevention", authors: ["Grace Namaganda"], year: 2021, doi: "10.1/x", kind: "abstract", chunk_id: null, section: null, page_start: null, page_end: null, excerpt: `Bed nets ${QUOTE} by 31%.`, quotes: [{ text: QUOTE, start: 9, end: 9 + QUOTE.length }], offset_unit: "utf16" },
    { key: "E2", paper_id: null, url: "https://health.example.org/report", site: "health.example.org", title: "Net campaign report", authors: [], year: 2024, doi: null, kind: "web", chunk_id: null, section: null, page_start: null, page_end: null, excerpt: "fewer clinic visits for fever", quotes: [] },
  ],
  insufficient_evidence: false,
  gaps: "",
  model: "claude-opus-5-5",
  report_status: "complete",
  created_at: new Date().toISOString(),
  sources: [
    { kind: "scholarly", title: "School-based malaria prevention", url: null, year: 2021, read: true, authors: ["Grace Namaganda"], journal: "Malaria Journal", doi: "10.1/x", identifier: "10.1/x", is_open_access: true, has_abstract: true, databases: ["openalex"], paper_id: "p1" },
    { kind: "web", title: "Net campaign report", url: "https://health.example.org/report", site: "health.example.org", year: 2024, read: true },
    { kind: "scholarly", title: "Oral history archives", url: "javascript:alert(1)", year: 2019, read: false, authors: [], identifier: "10.2/y", has_abstract: false, databases: ["crossref"], paper_id: null },
  ],
};

function wrap(ui: ReactNode, path = "/research/deep") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/research/deep" element={ui} />
          <Route path="/research" element={<ResearchModes />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls.posts = [];
  calls.status = CONNECTED;
  calls.runs = { r1: RUN };
});

describe("deep research", () => {
  it("sits beside Research on your own papers, with the difference spelled out", async () => {
    wrap(<DeepResearchPage />);
    const modes = screen.getByRole("navigation", { name: "Research mode" });
    expect(within(modes).getByRole("link", { name: /My papers.*already in your library/ })).toHaveAttribute("href", "/research");
    expect(within(modes).getByRole("link", { name: /Deep research.*databases and the web/ })).toHaveAttribute("aria-current", "page");
  });

  it("says plainly what is not connected yet", async () => {
    calls.status = { databases: ["openalex"], ai: false, web_search: false };
    wrap(<DeepResearchPage />);
    const connections = await screen.findByRole("list", { name: "What Deep research can use" });
    expect(connections).toHaveTextContent("AI report writing");
    expect(connections).toHaveTextContent("you get the list of sources, without a written report");
    expect(connections).toHaveTextContent("General web searchNot connected yet");
    expect(screen.getByRole("checkbox", { name: /general web/ })).toBeDisabled();
  });

  it("runs a question and shows the searches, the checked report and every source", async () => {
    wrap(<DeepResearchPage />);
    await screen.findByRole("list", { name: "What Deep research can use" });
    const run = screen.getByRole("button", { name: /Run deep research/ });
    expect(run).toBeDisabled(); // a question is needed first
    await userEvent.type(screen.getByLabelText("Your research question"), RUN.question);
    await userEvent.type(screen.getByLabelText("From year"), "2010");
    await userEvent.click(run);
    expect(calls.posts[0]).toEqual({ path: "/research/deep", body: { question: RUN.question, subject: "all", year_from: 2010, year_to: null, include_web: true } });

    expect(await screen.findByRole("heading", { name: RUN.question })).toBeInTheDocument();
    expect(screen.getByText("school bed nets malaria")).toBeInTheDocument();
    expect(screen.getByText(/OpenAlex: 25 results/)).toBeInTheDocument();
    expect(screen.getByText(/PubMed: not reached/)).toBeInTheDocument();
    // The report cites a paper (inside PaperAid) and a web page (outside, labelled as not peer-reviewed).
    expect(screen.getAllByRole("link", { name: "School-based malaria prevention" })[0]).toHaveAttribute("href", "/papers/p1");
    const page = screen.getAllByRole("link", { name: /Net campaign report/ })[0];
    expect(page).toHaveAttribute("href", "https://health.example.org/report");
    expect(page).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByText(/Web page · not peer-reviewed/).length).toBeGreaterThan(0);

    const read = screen.getByRole("region", { name: "Read for this report (2)" });
    expect(within(read).getByText("School-based malaria prevention")).toBeInTheDocument();
    const others = screen.getByRole("region", { name: "Also found (1)" });
    expect(within(others).queryByRole("link", { name: /Publisher/ })).toBeNull(); // its only address is javascript:
    await userEvent.click(within(others).getByRole("button", { name: "Save to library" }));
    expect(calls.posts.at(-1)).toEqual({ path: "/papers/import", body: { identifier: "10.2/y", add_to_library: true } });
    expect(await within(others).findByText("In your library")).toBeInTheDocument();
  });

  it("explains a run with no written report instead of showing nothing", async () => {
    calls.runs = { r1: { ...RUN, report: null, citations: [], report_status: "ai_not_connected" } };
    wrap(<DeepResearchPage />, "/research/deep?r=r1");
    expect(await screen.findByText("No written report: AI is not connected yet")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Read for this report (2)" })).toBeInTheDocument();
  });

  it("never links to a non-web address", async () => {
    calls.runs = { r1: { ...RUN, sources: [{ ...RUN.sources[2], doi: null }] } };
    wrap(<DeepResearchPage />, "/research/deep?r=r1");
    const others = await screen.findByRole("region", { name: /Sources found|Also found/ });
    expect(within(others).queryByRole("link", { name: /Publisher/ })).toBeNull();
  });
});
