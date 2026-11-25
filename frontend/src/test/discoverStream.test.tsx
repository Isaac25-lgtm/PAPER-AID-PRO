// Discover after Silver's test: results show as each database answers, failed databases can be retried, exact mode
// says so (and offers the suggested spelling), and an identifier is looked up exactly.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Emit = (event: unknown) => void;
const streams = vi.hoisted(() => ({ calls: [] as { params: Record<string, unknown>; emit: Emit; finish: () => void }[] }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: {
    get: () => Promise.resolve({ enabled: false, provider: "none", model: null, embeddings_enabled: false }),
    post: () => Promise.resolve({}),
    stream: (_path: string, params: Record<string, unknown>, onEvent: Emit) =>
      new Promise<void>((resolve) => streams.calls.push({ params, emit: onEvent, finish: resolve })),
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1", name: "Grace", role: "user", preferences: { guides: {} } }, loading: false }) }));

const { default: DiscoverPage, bareIdentifier } = await import("@/pages/Discover");

describe("identifier note", () => {
  it("shows the identifier itself, without a repeated label or link prefix", () => {
    expect(bareIdentifier("PMID: 27940873")).toBe("27940873");
    expect(bareIdentifier("https://doi.org/10.1126/science.aah5309")).toBe("10.1126/science.aah5309");
    expect(bareIdentifier("doi:10.1126/science.aah5309")).toBe("10.1126/science.aah5309");
    expect(bareIdentifier("10.1126/science.aah5309")).toBe("10.1126/science.aah5309");
    expect(bareIdentifier("arXiv:1706.03762")).toBe("1706.03762");
  });
});
const nth = (i: number) => streams.calls[i]!;

const work = (title: string) => ({ title, abstract: "a", authors: [], year: 2021, journal: null, doi: `10.1/${title}`, identifier: `10.1/${title}`, is_open_access: false, citation_count: 0, sources: ["openalex"], library_paper_id: null });

function open(path: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/discover" element={<DiscoverPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  streams.calls = [];
});

describe("streamed Discover search", () => {
  it("shows results from the first database while the others are still searching, then offers a retry", async () => {
    open("/discover?q=malaria");
    const call = nth(0);
    act(() => {
      call.emit({ type: "query", query: "malaria", corrected_from: null, identifier: null, pending: ["openalex", "europe_pmc"] });
      call.emit({ type: "results", results: [work("Fast paper")], providers: [{ provider: "openalex", ok: true, count: 1, error: null }], pending: ["europe_pmc"] });
    });
    expect(await screen.findByText("Fast paper")).toBeInTheDocument(); // shown before every database has answered
    expect(screen.getByText(/Europe PMC: searching/)).toBeInTheDocument();
    expect(screen.getByText(/OpenAlex: 1 results/)).toBeInTheDocument();
    act(() => {
      call.emit({ type: "results", results: [work("Fast paper")], providers: [{ provider: "openalex", ok: true, count: 1, error: null }, { provider: "europe_pmc", ok: false, count: 0, error: "timed out" }], pending: [] });
      call.emit({ type: "done" });
      call.finish();
    });
    expect(await screen.findByText(/Europe PMC: unavailable/)).toBeInTheDocument();
    expect(screen.getByText("Fast paper")).toBeInTheDocument(); // the others' results are kept
    await userEvent.click(screen.getByRole("button", { name: /Retry unavailable/ }));
    expect(streams.calls).toHaveLength(2);
    expect(nth(1).params).toMatchObject({ q: "malaria", exact: true }); // the same words, re-asked

    // While the retry runs, what was found stays on screen and only the failed database searches again.
    expect(screen.getByText("Fast paper")).toBeInTheDocument();
    expect(screen.getByText(/OpenAlex: 1 results/)).toBeInTheDocument();
    expect(screen.getByText(/Europe PMC: searching/)).toBeInTheDocument();
    act(() => {
      nth(1).emit({ type: "query", query: "malaria", corrected_from: null, identifier: null, pending: ["openalex", "europe_pmc"] });
      nth(1).emit({ type: "results", results: [work("Slow paper")], providers: [{ provider: "europe_pmc", ok: true, count: 1, error: null }], pending: ["openalex"] });
    });
    expect(screen.getByText("Fast paper")).toBeInTheDocument(); // not replaced until OpenAlex has answered again
    expect(screen.getByText(/OpenAlex: 1 results/)).toBeInTheDocument();
    act(() => {
      nth(1).emit({ type: "results", results: [work("Fast paper"), work("Slow paper")], providers: [{ provider: "europe_pmc", ok: true, count: 1, error: null }, { provider: "openalex", ok: true, count: 1, error: null }], pending: [] });
      nth(1).emit({ type: "done" });
    });
    expect(screen.getByText("Slow paper")).toBeInTheDocument();
    expect(screen.getByText(/Europe PMC: 1 results/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry unavailable/ })).not.toBeInTheDocument();
  });

  it("a retry after a correction keeps saying what was corrected", async () => {
    open("/discover?q=malria");
    act(() => {
      nth(0).emit({ type: "query", query: "malaria", corrected_from: "malria", identifier: null, pending: ["europe_pmc"] });
      nth(0).emit({ type: "results", results: [], providers: [{ provider: "europe_pmc", ok: false, count: 0, error: "timed out" }], pending: [] });
      nth(0).emit({ type: "done" });
    });
    await userEvent.click(await screen.findByRole("button", { name: /Retry unavailable/ }));
    expect(nth(1).params).toMatchObject({ q: "malaria", exact: true });
    act(() => {
      nth(1).emit({ type: "query", query: "malaria", corrected_from: null, identifier: null, pending: [] });
    });
    expect(screen.getByText(/Showing results for/).closest("p")).toHaveTextContent("Showing results for malaria.");
  });

  it("exact mode says so and offers the suggested spelling", async () => {
    open("/discover?q=malria&exact=1");
    act(() => {
      nth(0).emit({ type: "query", query: "malria", corrected_from: null, identifier: null, pending: [] });
      nth(0).emit({ type: "suggestion", query: "malaria" });
      nth(0).emit({ type: "done" });
    });
    expect(await screen.findByText(/Searching exactly for/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Did you mean “malaria”?" }));
    expect(streams.calls.at(-1)?.params).toMatchObject({ q: "malaria" });
    expect(streams.calls.at(-1)?.params.exact).toBeUndefined();
  });

  it("an identifier is looked up exactly and says so", async () => {
    open("/discover?q=PMID%2027940873");
    act(() => {
      nth(0).emit({ type: "query", query: "PMID 27940873", corrected_from: null, identifier: "pmid", pending: [] });
      nth(0).emit({ type: "results", results: [work("The long-run poverty and gender impacts of mobile money")], providers: [], pending: [] });
      nth(0).emit({ type: "done" });
    });
    expect(await screen.findByText(/Looked up PubMed ID/)).toHaveTextContent("Looked up PubMed ID 27940873 exactly."); // "PMID" not repeated
    expect(screen.getByText("The long-run poverty and gender impacts of mobile money")).toBeInTheDocument();
  });
});

describe("retry (audit SF05)", () => {
  const from = (title: string, source: string) => ({ ...work(title), sources: [source] });

  it("shows a recovered database's new papers even when a former success fails on the retry", async () => {
    open("/discover?q=malaria");
    act(() => {
      nth(0).emit({ type: "query", query: "malaria", corrected_from: null, identifier: null, pending: ["openalex", "europe_pmc"] });
      nth(0).emit({ type: "results", results: [from("Old OpenAlex paper", "openalex")], providers: [{ provider: "openalex", ok: true, count: 1, error: null }, { provider: "europe_pmc", ok: false, count: 0, error: "timed out" }], pending: [] });
      nth(0).emit({ type: "done" });
    });
    await userEvent.click(await screen.findByRole("button", { name: /Retry unavailable/ }));
    act(() => {
      nth(1).emit({ type: "query", query: "malaria", corrected_from: null, identifier: null, pending: ["openalex", "europe_pmc"] });
      // This time Europe PMC answers and OpenAlex fails (a new API instance, or the cache expired).
      nth(1).emit({ type: "results", results: [from("New Europe PMC paper", "europe_pmc")], providers: [{ provider: "europe_pmc", ok: true, count: 1, error: null }, { provider: "openalex", ok: false, count: 0, error: "timed out" }], pending: [] });
      nth(1).emit({ type: "done" });
    });
    expect(screen.getByText("New Europe PMC paper")).toBeInTheDocument(); // the recovered database's paper appears
    expect(screen.getByText("Old OpenAlex paper")).toBeInTheDocument(); // the earlier paper is kept
    expect(screen.getByText(/OpenAlex: unavailable, earlier results shown/)).toBeInTheDocument(); // and said honestly
    expect(screen.getByText(/Europe PMC: 1 results/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry unavailable/ })).toBeInTheDocument(); // OpenAlex can be retried
  });

  it("ignores late events from a search that has been replaced", async () => {
    open("/discover?q=malaria");
    act(() => nth(0).emit({ type: "query", query: "malaria", corrected_from: null, identifier: null, pending: ["openalex"] }));
    await userEvent.clear(screen.getByLabelText("Search query"));
    await userEvent.type(screen.getByLabelText("Search query"), "cholera{Enter}");
    act(() => {
      nth(0).emit({ type: "results", results: [from("Stale malaria paper", "openalex")], providers: [{ provider: "openalex", ok: true, count: 1, error: null }], pending: [] });
      nth(0).emit({ type: "done" });
    });
    expect(screen.queryByText("Stale malaria paper")).not.toBeInTheDocument();
  });
});
