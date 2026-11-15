// Workspace audit, finding 1 (high) and 8: every editor instance belongs to exactly one document, a create that
// finishes after its dialog was dismissed never moves the person, and lists and counts follow writes.
// Drives the real app router, editor and New document dialog with a mocked API.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  user: { id: "u1", name: "Grace", email: "g@example.edu", role: "user", preferences: { tour_seen: true, guide_editor_collapsed: true, guide_documents_collapsed: true } },
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: authState.user,
    firebaseUser: { emailVerified: true, email: authState.user.email },
    loading: false,
    signOut: vi.fn(),
    refresh: vi.fn(),
  }),
}));

type Doc = { id: string; title: string; doc_type: string; word_count: number; csl_style: string; version: number; updated_at: string; created_at: string; content: unknown };
const doc = (id: string, title: string): Doc => ({
  id,
  title,
  doc_type: "manuscript",
  word_count: 3,
  csl_style: "apa",
  version: 1, // equal versions: the server alone could not tell the drafts apart
  updated_at: "2026-11-01T00:00:00Z",
  created_at: "2026-11-01T00:00:00Z",
  content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Body of ${title}` }] }] },
});
const server = vi.hoisted(() => ({
  docs: {} as Record<string, Doc>,
  patches: [] as { path: string; body: Record<string, unknown> }[],
  gets: [] as string[],
  create: null as null | ((d: unknown) => void),
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: {
    get: (path: string) => {
      server.gets.push(path);
      const id = /^\/documents\/([^/]+)$/.exec(path)?.[1];
      if (id) return Promise.resolve(server.docs[id]);
      if (path === "/documents") return Promise.resolve(Object.values(server.docs).map(({ content: _c, ...summary }) => summary));
      if (path === "/me/progress") return Promise.resolve({ library: 0, full_text: 0, collections: 0, documents: Object.keys(server.docs).length, conversations: 0 });
      if (path.endsWith("/rendered-citations")) return Promise.resolve({ style: "apa", bibliography: [], clusters: [] });
      if (path === "/ai/status") return Promise.resolve({ enabled: false, autocomplete: false });
      return Promise.resolve([]);
    },
    page: () => Promise.resolve({ items: [], total: 0 }),
    post: (path: string) => (path === "/documents" ? new Promise((resolve) => (server.create = resolve)) : Promise.resolve({})),
    patch: (path: string, body: Record<string, unknown>) => {
      server.patches.push({ path, body });
      const id = /^\/documents\/([^/]+)$/.exec(path)?.[1];
      if (!id) return Promise.resolve({});
      const current = server.docs[id]!;
      const saved = { ...current, ...(body.title ? { title: body.title as string } : {}), version: current.version + 1, updated_at: "2026-11-15T10:00:00Z" };
      server.docs[id] = saved;
      return Promise.resolve(saved);
    },
    delete: () => Promise.resolve(undefined),
    blob: () => Promise.resolve(new Blob()),
  },
}));

const { App } = await import("@/App");

let navigate: NavigateFunction = () => undefined;
function Remote() {
  navigate = useNavigate();
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

function renderApp(path: string, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const ui = (children: ReactNode) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  render(ui(<><App /><Remote /></>));
  return client;
}

async function titleField(expected: string) {
  const field = await screen.findByLabelText("Document title", {}, { timeout: 5000 });
  await waitFor(() => expect(field).toHaveValue(expected));
  return field;
}

beforeEach(() => {
  server.docs = { d1: doc("d1", "Draft A"), d2: doc("d2", "Draft B") };
  server.patches = [];
  server.gets = [];
  server.create = null;
});

describe("one editor per document", () => {
  it("never sends draft A's pending edits to draft B, and B loads its own state", async () => {
    renderApp("/documents/d1");
    const title = await titleField("Draft A");
    fireEvent.change(title, { target: { value: "Draft A, edited" } }); // autosave is pending (debounced)
    act(() => navigate("/documents/d2")); // e.g. Recent documents, or a late create that moved here
    await titleField("Draft B");
    expect(screen.getByText(/Body of Draft B/)).toBeInTheDocument();
    await waitFor(() => expect(server.patches.length).toBeGreaterThan(0), { timeout: 4000 });
    await new Promise((r) => setTimeout(r, 1500)); // past any debounce
    for (const { path, body } of server.patches) {
      if (body.title === "Draft A, edited") expect(path).toBe("/documents/d1");
      expect(path === "/documents/d2" && body.title === "Draft A, edited").toBe(false);
    }
    expect(server.docs.d1!.title).toBe("Draft A, edited"); // A's edit was saved, to A
    expect(server.docs.d2!.title).toBe("Draft B");
  }, 30_000);
});

describe("New document after the dialog is dismissed", () => {
  it("a late create refreshes the list but does not move the person", async () => {
    const client = renderApp("/documents");
    const sidebar = await screen.findByRole("complementary", { name: "Sidebar" }, { timeout: 5000 });
    await userEvent.click(within(sidebar).getByRole("button", { name: "New document" }));
    const dialog = await screen.findByRole("dialog", { name: "New document" });
    await userEvent.type(within(dialog).getByLabelText("Title / research topic"), "Late draft");
    await userEvent.click(within(dialog).getByRole("button", { name: /Next/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Create document" }));
    await waitFor(() => expect(server.create).not.toBeNull());
    await userEvent.keyboard("{Escape}"); // closed while the request is still running
    act(() => navigate("/documents/d1")); // and went to work on another draft
    await titleField("Draft A");
    const listFetches = server.gets.filter((p) => p === "/documents").length;
    server.docs.d3 = doc("d3", "Late draft");
    await act(async () => server.create!(server.docs.d3));
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByTestId("where")).toHaveTextContent("/documents/d1"); // still on draft A
    await waitFor(() => expect(client.getQueryState(["documents"])?.isInvalidated || server.gets.filter((p) => p === "/documents").length > listFetches).toBe(true));
  }, 30_000);
});

describe("lists follow writes (warm caches)", () => {
  it("a renamed draft shows its new title in the cached list right after saving", async () => {
    const client = renderApp("/documents/d1");
    client.setQueryData(["documents"], Object.values(server.docs).map(({ content: _c, ...s }) => s));
    const title = await titleField("Draft A");
    fireEvent.change(title, { target: { value: "Renamed A" } });
    await waitFor(() => expect(server.patches.some((p) => p.body.title === "Renamed A")).toBe(true), { timeout: 4000 });
    await waitFor(() => {
      const list = client.getQueryData<{ id: string; title: string; version: number }[]>(["documents"]);
      expect(list?.find((d) => d.id === "d1")).toMatchObject({ title: "Renamed A", version: 2 });
    });
  }, 30_000);
});
