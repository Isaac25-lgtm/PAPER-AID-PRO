// Editor writing tools: ghost-text suggestions, /cite, the cite palette (library + all sources), the selection menu
// (rewrite keeps citations; stale passages are never overwritten) and PDF quote clean-up.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  posts: [] as { path: string; body: unknown }[],
  gets: [] as { path: string; query: unknown }[],
  post: (async () => ({})) as (path: string, body: unknown) => Promise<unknown>,
  get: (async () => ({})) as (path: string, query: unknown) => Promise<unknown>,
  library: [] as unknown[],
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1", preferences: {} }, loading: false }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: {
    get: (path: string, query: unknown) => {
      calls.gets.push({ path, query });
      return calls.get(path, query);
    },
    page: () => Promise.resolve({ items: calls.library, total: calls.library.length }),
    post: (path: string, body: unknown) => {
      calls.posts.push({ path, body });
      return calls.post(path, body);
    },
    patch: () => Promise.resolve({}),
  },
}));

const { ApiError } = await import("@/lib/api");
const { CitationNode } = await import("@/lib/citationNode");
const { CiteTrigger } = await import("@/lib/citeTrigger");
const { GhostText, acceptGhost, currentGhost, showGhost, suggestionPoint } = await import("@/lib/ghostText");
const { CitePalette, queryFromSelection } = await import("@/components/editor/CitePalette");
const { SelectionMenu } = await import("@/components/editor/SelectionMenu");
const { buildRewriteInput, rewriteContent, applyRewrite } = await import("@/lib/rewrite");
const { useAutocomplete } = await import("@/components/editor/useAutocomplete");
const { cleanPdfQuote } = await import("@/components/editor/PdfPanel");
const { applyCitationLabels } = await import("@/lib/citationLabels");

// jsdom has no layout: give ranges empty rectangles so ProseMirror can "scroll the cursor into view".
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getClientRects ??= emptyRects;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

type J = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: J[] };

const editors: InstanceType<typeof Editor>[] = [];
function makeEditor(content: unknown, extra: unknown[] = []) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: [StarterKit, CitationNode, GhostText, ...(extra as [])], content: content as string });
  editor.view.dom.tabIndex = 0; // jsdom only focuses elements with a tab index
  editors.push(editor);
  return editor;
}
const endOf = (editor: InstanceType<typeof Editor>) => editor.state.doc.content.size - 1;

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const paper = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, title, authors: ["Jack, W."], year: 2014, doi: null, has_pdf: false, ...extra });

beforeEach(() => {
  calls.posts = [];
  calls.gets = [];
  calls.library = [];
  calls.post = async () => ({});
  calls.get = async () => ({});
});
afterEach(() => {
  vi.useRealTimers();
  editors.splice(0).forEach((e) => e.destroy());
  document.body.innerHTML = "";
});

describe("ghost text", () => {
  it("is offered only at the end of a non-empty paragraph with an empty cursor", () => {
    const editor = makeEditor("<p>Mobile money spread quickly</p><p></p>");
    editor.commands.setTextSelection(endOf(editor) - 2); // end of first paragraph is before the empty one
    editor.commands.setTextSelection(1 + "Mobile money spread quickly".length);
    expect(suggestionPoint(editor.state)).toBe(1 + "Mobile money spread quickly".length);
    editor.commands.setTextSelection(4);
    expect(suggestionPoint(editor.state)).toBeNull(); // mid-paragraph
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(suggestionPoint(editor.state)).toBeNull(); // a selection
    editor.commands.setTextSelection(endOf(editor));
    expect(suggestionPoint(editor.state)).toBeNull(); // empty paragraph
  });

  it("shows grey text that is not part of the document until Tab accepts it", () => {
    const editor = makeEditor("<p>Agent networks expanded</p>");
    const pos = endOf(editor);
    editor.commands.setTextSelection(pos);
    showGhost(editor.view, { pos, text: " across rural areas." });
    expect(editor.view.dom.querySelector(".ghost-text")?.textContent).toBe(" across rural areas.");
    expect(editor.getText()).toBe("Agent networks expanded");
    expect(JSON.stringify(editor.getJSON())).not.toContain("rural");
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(editor.getText()).toBe("Agent networks expanded across rural areas.");
    expect(currentGhost(editor.state)).toBeNull();
  });

  it("Esc, typing or moving the cursor dismisses it", () => {
    const editor = makeEditor("<p>Agent networks expanded</p>");
    const pos = endOf(editor);
    editor.commands.setTextSelection(pos);
    showGhost(editor.view, { pos, text: " quickly." });
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(currentGhost(editor.state)).toBeNull();
    showGhost(editor.view, { pos, text: " quickly." });
    editor.commands.insertContent("!");
    expect(currentGhost(editor.state)).toBeNull();
    expect(acceptGhost(editor.view)).toBe(false);
    showGhost(editor.view, { pos: endOf(editor), text: " more" });
    editor.commands.setTextSelection(3);
    expect(currentGhost(editor.state)).toBeNull();
  });
});

describe("/cite", () => {
  function typeChar(editor: InstanceType<typeof Editor>, text: string) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (f) => f(editor.view, from, to, text, () => editor.state.tr.insertText(text, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(text, from, to));
  }

  it("removes the command and opens the cite search at that point", async () => {
    const onTrigger = vi.fn();
    const editor = makeEditor("<p>Evidence /cit</p>", [CiteTrigger.configure({ onTrigger })]);
    editor.commands.setTextSelection(endOf(editor));
    typeChar(editor, "e");
    await new Promise((r) => setTimeout(r, 0));
    expect(editor.getText()).toBe("Evidence ");
    expect(onTrigger).toHaveBeenCalledWith(1 + "Evidence ".length);
  });

  it("does not fire inside a word or a URL", async () => {
    const onTrigger = vi.fn();
    const editor = makeEditor("<p>see example.org/cit</p>", [CiteTrigger.configure({ onTrigger })]);
    editor.commands.setTextSelection(endOf(editor));
    typeChar(editor, "e");
    await new Promise((r) => setTimeout(r, 0));
    expect(onTrigger).not.toHaveBeenCalled();
    expect(editor.getText()).toBe("see example.org/cite");
  });
});

describe("rewrite helpers", () => {
  const cite = (id: string, label: string) => ({ type: "citation", attrs: { citationIds: [id], label } });
  const twoClaims = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Mobile money reduced poverty " },
          cite("c1", "(Suri & Jack, 2016)"),
          { type: "text", text: ". Phones cut search costs " },
          cite("c2", "(Aker, 2010)"),
          { type: "text", text: "." },
        ],
      },
    ],
  };

  it("sends citations as numbered placeholders and keeps each with its own claim", () => {
    const editor = makeEditor(twoClaims);
    const input = buildRewriteInput(editor, 1, endOf(editor));
    if (typeof input === "string") throw new Error(input);
    expect(input.text).toBe("Mobile money reduced poverty [[C1]]. Phones cut search costs [[C2]].");
    expect(applyRewrite(editor, input, "Mobile money lowered poverty [[C1]]. Mobile phones lowered search costs [[C2]].")).toBeNull();
    const nodes = (editor.getJSON() as J).content?.[0]?.content ?? [];
    expect(nodes.map((n) => n.type)).toEqual(["text", "citation", "text", "citation", "text"]);
    expect(nodes[0]?.text).toBe("Mobile money lowered poverty ");
    expect(nodes[1]?.attrs?.citationIds).toEqual(["c1"]);
    expect(nodes[2]?.text).toBe(". Mobile phones lowered search costs ");
    expect(nodes[3]?.attrs?.citationIds).toEqual(["c2"]);
  });

  it("refuses a proposal that moves, drops, repeats or invents a citation", () => {
    const editor = makeEditor(twoClaims);
    const input = buildRewriteInput(editor, 1, endOf(editor));
    if (typeof input === "string") throw new Error(input);
    for (const bad of [
      "Phones cut search costs [[C2]] and mobile money reduced poverty [[C1]].",
      "Mobile money and phones helped households [[C1]].",
      "Mobile money reduced poverty [[C1]][[C1]]. Phones cut costs [[C2]].",
      "Mobile money reduced poverty [[C1]]. Phones cut costs [[C2]] [[C3]].",
    ]) {
      expect(rewriteContent(input, bad)).toHaveProperty("error");
    }
    expect(applyRewrite(editor, input, "Phones cut search costs [[C2]] and mobile money reduced poverty [[C1]].")).toMatch(/moved, dropped or repeated/);
    expect(editor.getText()).toContain("Mobile money reduced poverty");
  });

  it("refuses selections across paragraphs and keeps surrounding spaces", () => {
    const editor = makeEditor("<p>First paragraph here.</p><p>Second paragraph here.</p>");
    expect(buildRewriteInput(editor, 1, endOf(editor))).toBe("multiple-paragraphs");
    const plain = makeEditor({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a passage to improve " }] }] });
    const input = buildRewriteInput(plain, 1, endOf(plain));
    if (typeof input === "string") throw new Error(input);
    expect(rewriteContent(input, "A clearer passage.")).toEqual({ content: [{ type: "text", text: "A clearer passage. " }] });
  });

  it("builds a short search from a selected sentence without citation labels", () => {
    expect(queryFromSelection("Households smoothed consumption after shocks (Jack & Suri, 2014), especially in rural areas.")).toBe(
      "Households smoothed consumption after shocks , especially in rural areas.",
    );
  });

  it("joins hyphenated PDF line breaks and collapses whitespace", () => {
    expect(cleanPdfQuote("risk shar-\ning and trans-\n actions   costs\nin Kenya")).toBe("risk sharing and transactions costs in Kenya");
  });
});

describe("cite palette", () => {
  function setup(responses: { library?: unknown[]; works?: unknown[] }) {
    calls.library = (responses.library ?? []).map((p) => ({ paper: p, notes: null, tags: [], collection_ids: [], added_at: "" }));
    calls.get = async (path) => (path === "/discovery/search" ? { query: "", results: responses.works ?? [], providers: [] } : {});
    calls.post = async (path) => {
      if (path === "/papers/import") return paper("imported", "Mobile phones and economic development in Africa");
      if (path.endsWith("/citations")) return { id: "cit-1" };
      return {};
    };
    const editor = makeEditor("<p>Mobile money matters </p>");
    const onClose = vi.fn();
    const onInserted = vi.fn();
    wrap(<CitePalette editor={editor} documentId="d1" request={{ pos: endOf(editor), query: "mobile money" }} onClose={onClose} onInserted={onInserted} />);
    return { editor, onClose, onInserted };
  }

  it("cites a library paper at the insertion point with an optional page", async () => {
    const { editor, onClose, onInserted } = setup({ library: [paper("p1", "Risk sharing and transactions costs")] });
    expect(await screen.findByText("Risk sharing and transactions costs")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Page (optional)"), "12");
    await userEvent.type(screen.getByLabelText("Search sources to cite"), "{Enter}");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.posts).toEqual([{ path: "/documents/d1/citations", body: { paper_id: "p1", locator: "12" } }]);
    expect(onInserted).toHaveBeenCalled();
    const citation = (editor.getJSON() as J).content?.[0]?.content?.find((n) => n.type === "citation");
    expect(citation?.attrs?.citationIds).toEqual(["cit-1"]);
  });

  it("imports a result from all sources into the library, then cites it", async () => {
    const work = { title: "Mobile phones and economic development in Africa", authors: ["Aker, J."], year: 2010, journal: "J. Econ. Perspectives", sources: ["openalex", "crossref"], doi: "10.1257/jep.24.3.207", identifier: "10.1257/jep.24.3.207", library_paper_id: null };
    const { onClose } = setup({ works: [work] });
    expect(await screen.findByText(work.title, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText(/via OpenAlex, Crossref · adds to your library/)).toBeInTheDocument();
    await userEvent.click(screen.getByText(work.title));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.posts.map((p) => p.path)).toEqual(["/papers/import", "/documents/d1/citations"]);
    expect(calls.posts[0]?.body).toEqual({ identifier: "10.1257/jep.24.3.207", add_to_library: true });
    expect(calls.posts[1]?.body).toEqual({ paper_id: "imported", locator: null });
  });

  it("explains why a result without an identifier cannot be cited", async () => {
    const work = { title: "An unindexed report", authors: [], year: 2020, journal: null, doi: null, identifier: null, library_paper_id: null };
    setup({ works: [work] });
    await userEvent.click(await screen.findByText(work.title, {}, { timeout: 2000 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no DOI or other identifier");
    expect(calls.posts).toEqual([]);
  });

  it("hides all-sources results already in the library", async () => {
    const mine = paper("p1", "Mobile money and poverty", { doi: "10.1126/science.aah5309" });
    const dup = { title: "Mobile money and poverty", authors: [], year: 2016, journal: null, doi: "10.1126/SCIENCE.AAH5309", identifier: "10.1126/science.aah5309", library_paper_id: null };
    setup({ library: [mine], works: [dup] });
    await waitFor(() => expect(calls.gets.some((g) => g.path === "/discovery/search")).toBe(true), { timeout: 2000 });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
  });
});

describe("selection menu", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Mobile money reduced poverty " },
          { type: "citation", attrs: { citationIds: ["c1"], label: "(Suri & Jack, 2016)" } },
          { type: "text", text: "." },
        ],
      },
    ],
  };

  function select(editor: InstanceType<typeof Editor>) {
    act(() => {
      editor.view.dom.focus();
      editor.commands.setTextSelection({ from: 1, to: endOf(editor) });
    });
  }

  it("offers only non-AI actions when AI is off", async () => {
    const editor = makeEditor(doc);
    const onFindSource = vi.fn();
    wrap(<SelectionMenu editor={editor} aiEnabled={false} onFindSource={onFindSource} onCheck={vi.fn()} />);
    select(editor);
    await userEvent.click(await screen.findByRole("button", { name: /Find a source/ }));
    expect(screen.queryByRole("button", { name: /Rewrite/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Check against my sources/ })).toBeNull();
    expect(onFindSource.mock.calls[0]?.[0].text).toContain("Mobile money reduced poverty");
  });

  it("replaces the passage only on Replace, keeping its citation", async () => {
    calls.post = async () => ({ text: "Mobile money lowered poverty [[C1]].", model: "fake-model" });
    const editor = makeEditor(doc);
    wrap(<SelectionMenu editor={editor} aiEnabled onFindSource={vi.fn()} onCheck={vi.fn()} />);
    select(editor);
    await userEvent.click(await screen.findByRole("button", { name: /Rewrite/ }));
    expect(await screen.findByText("Mobile money lowered poverty (Suri & Jack, 2016).")).toBeInTheDocument(); // shown with its label
    expect(editor.getText()).toContain("reduced"); // nothing changes before Replace
    expect(calls.posts[0]).toEqual({ path: "/ai/rewrite", body: { text: "Mobile money reduced poverty [[C1]].", mode: "academic" } });
    await userEvent.click(screen.getByRole("button", { name: /Replace/ }));
    const nodes = (editor.getJSON() as J).content?.[0]?.content ?? [];
    expect(nodes.map((n) => n.type)).toEqual(["text", "citation", "text"]);
    expect(nodes[0]?.text).toBe("Mobile money lowered poverty ");
    expect(nodes[1]?.attrs?.citationIds).toEqual(["c1"]);
  });

  it("never overwrites a passage that changed while the rewrite was pending", async () => {
    let finish: (value: unknown) => void = () => undefined;
    calls.post = () => new Promise((resolve) => (finish = resolve));
    const editor = makeEditor(doc);
    wrap(<SelectionMenu editor={editor} aiEnabled onFindSource={vi.fn()} onCheck={vi.fn()} />);
    select(editor);
    await userEvent.click(await screen.findByRole("button", { name: /Shorten/ }));
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("Clearly, ", 1));
      editor.commands.setTextSelection({ from: 1, to: endOf(editor) - 9 }); // same range as before
    });
    await act(async () => finish({ text: "Shorter.", model: "fake-model" }));
    await userEvent.click(await screen.findByRole("button", { name: /Replace/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("has changed");
    expect(screen.queryByRole("button", { name: /Replace/ })).toBeNull();
    expect(editor.getText()).toContain("Clearly, Mobile money reduced poverty");
  });
});

describe("autocomplete", () => {
  function Harness({ editor }: { editor: InstanceType<typeof Editor> }) {
    const status = useAutocomplete(editor, "d1", true, 100);
    return <p data-testid="status">{status}</p>;
  }
  const PARAGRAPH = "Mobile money has changed how households in East Africa save and send money";

  it("suggests after a pause and shows it as ghost text", async () => {
    vi.useFakeTimers();
    calls.post = async () => ({ text: "to relatives in rural areas.", model: "fake-model" });
    const editor = makeEditor(`<p>${PARAGRAPH}</p>`);
    render(<Harness editor={editor} />);
    act(() => {
      editor.view.dom.focus();
      editor.commands.setTextSelection(endOf(editor));
      editor.commands.insertContent(" ");
    });
    await act(async () => vi.advanceTimersByTimeAsync(150));
    expect(calls.posts[0]?.path).toBe("/ai/complete");
    expect((calls.posts[0]?.body as { preceding_text: string }).preceding_text).toBe(`${PARAGRAPH} `);
    expect(editor.view.dom.querySelector(".ghost-text")?.textContent).toBe("to relatives in rural areas.");
    expect(screen.getByTestId("status")).toHaveTextContent("ready");
  });

  it("drops a suggestion when the text changed before it arrived", async () => {
    vi.useFakeTimers();
    let finish: (value: unknown) => void = () => undefined;
    calls.post = () => new Promise((resolve) => (finish = resolve));
    const editor = makeEditor(`<p>${PARAGRAPH}</p>`);
    render(<Harness editor={editor} />);
    act(() => {
      editor.view.dom.focus();
      editor.commands.setTextSelection(endOf(editor));
      editor.commands.insertContent(" ");
    });
    await act(async () => vi.advanceTimersByTimeAsync(150));
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("x", 2)); // edit elsewhere; no new request yet (timer pending)
    });
    await act(async () => finish({ text: "stale words", model: "fake-model" }));
    expect(editor.view.dom.querySelector(".ghost-text")).toBeNull();
  });

  it("pauses instead of retrying when rate limited", async () => {
    vi.useFakeTimers();
    calls.post = async () => {
      throw new ApiError(429, "RATE_LIMITED", "Too many requests");
    };
    const editor = makeEditor(`<p>${PARAGRAPH}</p>`);
    render(<Harness editor={editor} />);
    act(() => {
      editor.view.dom.focus();
      editor.commands.setTextSelection(endOf(editor));
      editor.commands.insertContent(" ");
    });
    await act(async () => vi.advanceTimersByTimeAsync(150));
    expect(screen.getByTestId("status")).toHaveTextContent("paused");
    act(() => {
      editor.commands.insertContent("and");
    });
    await act(async () => vi.advanceTimersByTimeAsync(150));
    expect(calls.posts).toHaveLength(1);
  });
});

describe("citation labels", () => {
  const cite = (id: string) => ({ type: "citation", attrs: { citationIds: [id] } });
  const doc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "First claim " }, cite("c1")] },
      { type: "paragraph", content: [{ type: "text", text: "Later claim " }, cite("c1")] },
    ],
  };
  const labels = (editor: InstanceType<typeof Editor>) => {
    const out: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === "citation") out.push(n.attrs.label as string);
    });
    return out;
  };

  it("labels repeated citations by occurrence (full first note, short later note)", () => {
    const editor = makeEditor(doc);
    const applied = applyCitationLabels(editor, {
      style: "chicago-note",
      bibliography: [],
      clusters: [
        { citation_ids: ["c1"], text: "Tavneet Suri and William Jack, “The Long-Run Poverty…,” Science 354 (2016)", missing_ids: [] },
        { citation_ids: ["c1"], text: "Suri and Jack, “Long-Run Poverty.”", missing_ids: [] },
      ],
    } as never);
    expect(applied).toBe(true);
    expect(labels(editor)).toEqual(["Tavneet Suri and William Jack, “The Long-Run Poverty…,” Science 354 (2016)", "Suri and Jack, “Long-Run Poverty.”"]);
  });

  it("ignores a stale render when the citations changed since it was requested", () => {
    const editor = makeEditor(doc);
    const applied = applyCitationLabels(editor, {
      style: "apa",
      bibliography: [],
      clusters: [{ citation_ids: ["c1"], text: "(Suri & Jack, 2016)", missing_ids: [] }],
    } as never);
    expect(applied).toBe(false);
    expect(labels(editor)).toEqual(["[…]", "[…]"]);
  });
});
