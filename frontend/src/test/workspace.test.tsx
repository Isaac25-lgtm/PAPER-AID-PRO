// The signed-in workspace: a sidebar with New document, recent documents and the workspace sections; the
// signed-out header for visitors; a home page that continues and starts work; links that open the guided outline.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TestUser = { id: string; name: string; email: string; role: string; preferences?: Record<string, unknown>; needs_consent?: boolean };
const authState = vi.hoisted(() => ({ user: null as null | TestUser, loading: false, signOut: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: authState.user,
    firebaseUser: authState.user ? { emailVerified: true, email: authState.user.email } : null,
    loading: authState.loading,
    signOut: authState.signOut,
    refresh: vi.fn(),
  }),
}));
const apiData = vi.hoisted(() => ({ responses: {} as Record<string, unknown>, gets: [] as string[] }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: {
    get: (path: string) => {
      apiData.gets.push(path);
      return Promise.resolve(apiData.responses[path] ?? []);
    },
    page: () => Promise.resolve({ items: [], total: 0 }),
    post: () => Promise.resolve({}),
    patch: () => Promise.resolve({}),
  },
}));

const { Layout } = await import("@/components/Layout");
const { App } = await import("@/App");
const { default: DashboardPage } = await import("@/pages/Dashboard");
const { default: DocumentsPage } = await import("@/pages/Documents");

const now = new Date().toISOString();
const DOCS = [
  { id: "d1", title: "Chapter 2 · Literature review", doc_type: "literature_review", word_count: 1840, updated_at: now, created_at: now, csl_style: "apa", version: 3 },
  { id: "d2", title: "Proposal draft", doc_type: "proposal", word_count: 600, updated_at: "2026-01-01T00:00:00Z", created_at: now, csl_style: "apa", version: 1 },
];

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function wrap(ui: ReactNode, path = "/dashboard") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  authState.user = { id: "u1", name: "Grace Namaganda", email: "g@example.edu", role: "user", preferences: { tour_seen: true } };
  authState.loading = false;
  apiData.gets = [];
  apiData.responses = {
    "/documents": DOCS,
    "/me/progress": { library: 34, full_text: 12, collections: 3, documents: 2, conversations: 0 },
  };
});

function layoutAt(path: string) {
  return wrap(
    <Routes>
      <Route element={<Layout />}>
        <Route path="*" element={<Where />} />
      </Route>
    </Routes>,
    path,
  );
}

describe("workspace sidebar", () => {
  it("gives a signed-in person New document, their recent documents and the workspace sections", async () => {
    layoutAt("/library");
    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    expect(within(sidebar).getByRole("button", { name: "New document" })).toBeInTheDocument();
    expect(await within(sidebar).findByRole("link", { name: "Chapter 2 · Literature review" })).toHaveAttribute("href", "/documents/d1");
    const library = within(sidebar).getByRole("link", { name: /Library/ });
    expect(library).toHaveTextContent("34");
    for (const name of ["Home", "Documents", "Research", "Citations", "Discover", "Catalog"]) {
      expect(within(sidebar).getByRole("link", { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(within(sidebar).queryByRole("link", { name: /Admin/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create account" })).not.toBeInTheDocument(); // no public header
  });

  it("New document opens the guided outline", async () => {
    layoutAt("/library");
    await userEvent.click(within(screen.getByRole("complementary", { name: "Sidebar" })).getByRole("button", { name: "New document" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/documents?new=1");
  });

  it("folds to an icon rail and remembers it in this browser", async () => {
    const view = layoutAt("/library");
    await userEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.queryByText("Recent documents")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Library" })).toBeInTheDocument(); // still reachable by its label
    expect(window.localStorage.getItem("paperaid.sidebar.collapsed")).toBe("1");
    view.unmount();
    layoutAt("/library");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("shows the Admin section only to admins", () => {
    authState.user = { ...authState.user!, role: "admin" };
    layoutAt("/dashboard");
    expect(within(screen.getByRole("complementary", { name: "Sidebar" })).getByRole("link", { name: /Admin/ })).toHaveAttribute("href", "/admin");
  });

  it("fetches nothing private while the account must accept updated terms", () => {
    authState.user = { ...authState.user!, needs_consent: true };
    layoutAt("/dashboard");
    expect(apiData.gets).not.toContain("/documents");
    expect(apiData.gets).not.toContain("/me/progress");
  });

  it("the phone menu is a real modal: focus inside, Tab stays inside, Escape closes and returns focus (workspace audit)", async () => {
    layoutAt("/library");
    const opener = screen.getByRole("button", { name: "Open menu" });
    await userEvent.click(opener);
    const drawer = screen.getByRole("dialog", { name: "Menu" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(drawer.contains(document.activeElement)).toBe(true); // focus moved in
    expect(opener.closest("[inert]")).not.toBeNull(); // the page behind cannot be reached meanwhile
    for (let i = 0; i < 30; i++) {
      await userEvent.tab();
      expect(drawer.contains(document.activeElement)).toBe(true); // forward Tab never leaves the drawer
    }
    await userEvent.tab({ shift: true });
    expect(drawer.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Menu" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener); // back where the person was
    expect(opener.closest("[inert]")).toBeNull();
  });

  it("gives each sidebar copy its own heading ids, so section labels resolve uniquely", async () => {
    layoutAt("/library");
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    const drawer = screen.getByRole("dialog", { name: "Menu" });
    expect(within(drawer).getByRole("region", { name: "Recent documents" })).toBeInTheDocument();
  });

  it("keeps the public header for signed-out visitors", () => {
    authState.user = null;
    layoutAt("/discover");
    expect(screen.queryByRole("complementary", { name: "Sidebar" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create account" })).toBeInTheDocument();
  });
});

describe("landing", () => {
  it("sends a signed-in person from the landing page to their workspace", async () => {
    wrap(<App />, "/");
    expect(await screen.findByRole("heading", { level: 1, name: /Grace/ }, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe("home", () => {
  it("continues the most recent document and starts any kind of document", async () => {
    wrap(<DashboardPage />);
    const open = await screen.findByRole("link", { name: /Chapter 2 · Literature review/ });
    expect(open).toHaveAttribute("href", "/documents/d1");
    expect(open).toHaveTextContent("Literature review · 1,840 words");
    expect(screen.getByRole("link", { name: /Proposal draft/ })).toHaveAttribute("href", "/documents/d2");
    expect(screen.getByRole("link", { name: /Research proposal/ })).toHaveAttribute("href", "/documents?new=1&type=proposal");
    expect(screen.getByRole("link", { name: /Thesis chapter/ })).toHaveAttribute("href", "/documents?new=1&type=thesis");
    expect(await screen.findByText("34")).toBeInTheDocument(); // library at a glance
    expect(screen.getByText("with full text")).toBeInTheDocument();
  });

  it("offers a guided start when there are no documents yet", async () => {
    apiData.responses["/documents"] = [];
    wrap(<DashboardPage />);
    expect(await screen.findByText(/No documents yet/)).toBeInTheDocument();
  });
});

describe("guided outline from a link", () => {
  it("opens New document with the chosen kind of document", async () => {
    wrap(
      <Routes>
        <Route path="/documents" element={<DocumentsPage />} />
      </Routes>,
      "/documents?new=1&type=proposal",
    );
    const dialog = await screen.findByRole("dialog", { name: "New document" });
    expect(within(dialog).getByLabelText("Document type")).toHaveValue("proposal");
  });
});
