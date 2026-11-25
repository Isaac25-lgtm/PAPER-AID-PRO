// Writing without the template (Silver, 25 November 2026): a blank document is the first choice and is created
// straight away, and a guided outline can leave out the writing guidance under each heading.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { guidedContent } from "@/lib/templates";
import type { JSONContent } from "@/lib/types";

const calls = vi.hoisted(() => ({ posts: [] as { path: string; body: { doc_type: string; content: JSONContent } }[] }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: "u1", name: "Grace", role: "user", preferences: { guides: {} } }, loading: false }) }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: {
    get: () => Promise.resolve([]),
    post: (path: string, body: (typeof calls.posts)[number]["body"]) => {
      calls.posts.push({ path, body });
      return Promise.resolve({ id: "new-doc" });
    },
  },
}));

const { default: DocumentsPage } = await import("@/pages/Documents");

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

function open(path: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/documents/:id" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const guidanceParagraphs = (doc: JSONContent) => (doc.content ?? []).filter((node) => node.attrs?.guidance);
const headings = (doc: JSONContent) => (doc.content ?? []).filter((node) => node.type === "heading");

beforeEach(() => {
  calls.posts = [];
});

describe("templates", () => {
  it("leave out the guidance when asked, keeping the headings", () => {
    const config = { topic: "t", docType: "proposal" as const, design: "", generalObjective: "", specificObjectives: [], headings: ["Background", "Methods"] };
    expect(guidanceParagraphs(guidedContent(config))).toHaveLength(2);
    const plain = guidedContent({ ...config, guidance: false });
    expect(guidanceParagraphs(plain)).toHaveLength(0);
    expect(headings(plain)).toHaveLength(2);
  });
});

describe("New document", () => {
  it("lists Blank document first and creates it at once, with an empty page", async () => {
    open("/documents?new=1");
    const dialog = await screen.findByRole("dialog", { name: "New document" });
    const type = within(dialog).getByLabelText("Document type");
    expect(within(type).getAllByRole("option")[0]).toHaveTextContent("Blank document");
    await userEvent.selectOptions(type, "draft");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create blank document" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/documents/new-doc");
    expect(calls.posts).toHaveLength(1);
    expect(calls.posts[0]!.body.doc_type).toBe("draft");
    expect(calls.posts[0]!.body.content).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("opens straight on Blank document from the home page link", async () => {
    open("/documents?new=1&type=draft");
    const dialog = await screen.findByRole("dialog", { name: "New document" });
    expect(within(dialog).getByLabelText("Document type")).toHaveValue("draft");
    expect(within(dialog).getByRole("button", { name: "Create blank document" })).toBeInTheDocument();
  });

  it("creates a guided outline without writing guidance when the switch is off", async () => {
    open("/documents?new=1&type=proposal");
    const dialog = await screen.findByRole("dialog", { name: "New document" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Next: objectives/ }));
    const step2 = await screen.findByRole("dialog", { name: "Objectives & outline" });
    const toggle = within(step2).getByRole("checkbox", { name: /Include writing guidance/ });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await userEvent.click(within(step2).getByRole("button", { name: "Create document" }));
    await screen.findByTestId("where");
    const content = calls.posts[0]!.body.content;
    expect(headings(content).length).toBeGreaterThan(2);
    expect(guidanceParagraphs(content)).toHaveLength(0);
  });
});
