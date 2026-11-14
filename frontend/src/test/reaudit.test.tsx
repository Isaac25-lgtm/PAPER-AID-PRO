// Regression tests for docs/PAPERAID_V2_SYSTEM_REAUDIT.md (frontend): draft text stays private until confirmed,
// PDF quotes keep the words, pages and position captured at the click, the export/restore gate, stale renders and
// claim-level highlights.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  gets: [] as { path: string; query: unknown }[],
  posts: [] as { path: string; body: unknown }[],
  post: (async () => ({})) as (path: string, body: unknown) => Promise<unknown>,
  library: [] as unknown[],
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1", preferences: {} }, loading: false }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: {
    get: (path: string, query: unknown) => {
      calls.gets.push({ path, query });
      if (path.endsWith("/sources")) return Promise.resolve([{ id: "p1", title: "Risk sharing and transactions costs", authors: ["Jack, W."], year: 2014, has_pdf: true }]);
      return Promise.resolve({ query: "", results: [], providers: [] });
    },
    page: () => Promise.resolve({ items: calls.library, total: calls.library.length }),
    post: (path: string, body: unknown) => {
      calls.posts.push({ path, body });
      return calls.post(path, body);
    },
    patch: () => Promise.resolve({}),
    blob: () => Promise.resolve({ arrayBuffer: async () => new ArrayBuffer(8) }),
  },
}));
// A two-page PDF whose text layers contain known words (no real PDF engine in the test environment).
vi.mock("@/components/editor/pdfDocument", () => ({
  openPdf: () => ({ promise: Promise.resolve({ numPages: 2 }), destroy: () => undefined }),
  renderPage: async (_pdf: unknown, page: number, _canvas: unknown, textLayer: HTMLDivElement) => {
    textLayer.innerHTML = `<span>words printed on page ${page}</span>`;
  },
}));

const { CitationNode } = await import("@/lib/citationNode");
const { CitePalette } = await import("@/components/editor/CitePalette");
const { default: PdfPanel } = await import("@/components/editor/PdfPanel");
const { EditGate } = await import("@/lib/editGate");
const { applyRenderIfCurrent } = await import("@/lib/citationLabels");
const { HighlightedExcerpt, numberClaims } = await import("@/components/GroundedAnswerView");

const Range = window.Range;
Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const editors: InstanceType<typeof Editor>[] = [];
function makeEditor(content: unknown) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: [StarterKit, CitationNode], content: content as string });
  editors.push(editor);
  return editor;
}
function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls.gets = [];
  calls.posts = [];
  calls.library = [];
  calls.post = async () => ({});
});
afterEach(() => {
  vi.useRealTimers();
  editors.splice(0).forEach((e) => e.destroy());
  document.body.innerHTML = "";
});

describe("H1: Find a source keeps draft text private until confirmed", () => {
  it("searches only the library until the writer chooses to search all sources", async () => {
    const editor = makeEditor("<p>Unpublished finding about our village cohort</p>");
    wrap(<CitePalette editor={editor} documentId="d1" request={{ pos: 5, query: "Unpublished finding about our village cohort", origin: "selection" }} onClose={vi.fn()} onInserted={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 700));
    expect(calls.gets.some((g) => g.path === "/discovery/search")).toBe(false);
    expect(screen.getByText(/sends these words to OpenAlex, Crossref/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Search all sources" }));
    await waitFor(() => expect(calls.gets.some((g) => g.path === "/discovery/search")).toBe(true), { timeout: 2000 });
  });

  it("searches all sources as the writer types their own words", async () => {
    const editor = makeEditor("<p>Text</p>");
    wrap(<CitePalette editor={editor} documentId="d1" request={{ pos: 1 }} onClose={vi.fn()} onInserted={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Search sources to cite"), "mobile money");
    await waitFor(() => expect(calls.gets.some((g) => g.path === "/discovery/search")).toBe(true), { timeout: 2000 });
  });
});

describe("H2: Quote and cite uses what was captured at the click", () => {
  it("keeps page 1's words and page with page 1's citation even if the selection changes while citing", async () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 500 });
    let finish: (value: unknown) => void = () => undefined;
    calls.post = () => new Promise((resolve) => (finish = resolve));
    const editor = makeEditor({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Draft sentence." }] }] });
    editor.commands.setTextSelection(1 + "Draft sentence.".length);
    wrap(<PdfPanel editor={editor} documentId="d1" onInserted={vi.fn()} />);
    const page1 = await screen.findByText("words printed on page 1");
    const page2 = await screen.findByText("words printed on page 2");
    const select = (node: Element) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      fireEvent.mouseUp(screen.getByLabelText("PDF pages"));
    };
    select(page1);
    await userEvent.click(await screen.findByRole("button", { name: /Quote and cite/ }));
    // While the request is in flight: different words on page 2 are selected, and the draft is edited before the cursor.
    select(page2);
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("New ", 1));
    });
    await act(async () => finish({ id: "cit-1" }));
    await waitFor(() => expect(editor.getText()).toContain("“words printed on page 1”"));
    expect(calls.posts[0]).toEqual({ path: "/documents/d1/citations", body: { paper_id: "p1", locator: "1" } });
    expect(editor.getText()).not.toContain("page 2");
    expect(editor.getText().startsWith("New Draft sentence.“words printed on page 1”")).toBe(true); // mapped position
  });
});

describe("M7: export and restore wait for in-flight edits and block new ones", () => {
  it("drains running operations before locking, then refuses new ones until resumed", async () => {
    const gate = new EditGate();
    let finish: () => void = () => undefined;
    const running = gate.run(() => new Promise<void>((r) => (finish = r)));
    let paused = false;
    const pausing = gate.pause().then(() => (paused = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(paused).toBe(false); // still waiting for the citation in flight
    finish();
    await running;
    await pausing;
    expect(paused).toBe(true);
    await expect(gate.run(async () => "late")).rejects.toThrow(/paused/);
    gate.resume();
    await expect(gate.run(async () => "ok")).resolves.toBe("ok");
  });
});

describe("M8: stale citation renders never replace newer previews", () => {
  it("ignores a render made for a different style", () => {
    const editor = makeEditor({ type: "doc", content: [{ type: "paragraph", content: [{ type: "citation", attrs: { citationIds: ["c1"] } }] }] });
    const old = { style: "apa", bibliography: [], clusters: [{ citation_ids: ["c1"], text: "(Suri & Jack, 2016)", missing_ids: [] }] };
    expect(applyRenderIfCurrent(editor, old as never, "chicago-note")).toBe(false);
    expect(applyRenderIfCurrent(editor, old as never, "apa")).toBe(true);
  });
});

describe("M10: highlights per statement", () => {
  it("numbers each statement's marker group", () => {
    expect(numberClaims("First [E1]. Second [E1][E2]. Third [E2].")).toBe("First [E1#0]. Second [E1#1][E2#1]. Third [E2#2].");
  });

  it("merges overlapping quotes and emphasises the clicked statement's words", () => {
    const excerpt = "Confirmed malaria incidence was 31 percent lower in intervention schools.";
    const a = { text: "malaria incidence was 31 percent", start: 10, end: 42, claims: [0] };
    const b = { text: "31 percent lower in intervention", start: 32, end: 64, claims: [1] };
    render(
      <HighlightedExcerpt
        citation={{ key: "E1", paper_id: "p", title: "t", authors: [], year: 2021, doi: null, kind: "passage", chunk_id: null, section: null, page_start: 1, page_end: 1, excerpt, offset_unit: "utf16", quotes: [a, b] }}
        activeClaim={1}
      />,
    );
    const marked = Array.from(document.querySelectorAll("mark")).map((m) => m.textContent).join("");
    expect(marked).toBe("malaria incidence was 31 percent lower in intervention"); // nothing dropped
    const emphasised = Array.from(document.querySelectorAll("mark[data-claim-match]")).map((m) => m.textContent).join("");
    expect(emphasised).toBe("31 percent lower in intervention");
  });

  it("converts offsets stored before they were UTF-16", () => {
    const excerpt = "Rated 😀 highly. Incidence fell.";
    const start = Array.from(excerpt).indexOf("I");
    render(
      <HighlightedExcerpt
        citation={{ key: "E1", paper_id: "p", title: "t", authors: [], year: 2021, doi: null, kind: "passage", chunk_id: null, section: null, page_start: 1, page_end: 1, excerpt, quotes: [{ text: "Incidence fell", start, end: start + 14 }] }}
      />,
    );
    expect(document.querySelector("mark")?.textContent).toBe("Incidence fell");
  });
});
