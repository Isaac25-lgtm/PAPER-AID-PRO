// Library pickers say when a search was corrected ("fetal" is not "metal") and can search the exact words
// (Deep Research audit F09).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ pages: [] as Record<string, unknown>[] }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: {
    page: (_path: string, query: Record<string, unknown>) => {
      calls.pages.push(query);
      if (query.exact) return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve({ items: [{ paper: { id: "p1", title: "Metal exposure in miners" } }], total: 1, matchedQuery: "metal exposure" });
    },
  },
}));

const { LibraryMatchNote, useLibrarySearch } = await import("@/components/papers");

function Picker({ filter }: { filter: string }) {
  const library = useLibrarySearch(filter, 5);
  return (
    <div>
      <LibraryMatchNote matched={library.data?.matchedQuery} typed={library.typed} onExact={library.searchExactly} />
      <ul>{library.data?.items.map((i) => <li key={i.paper.id}>{i.paper.title}</li>)}</ul>
      <p data-testid="count">{library.data?.total ?? "-"}</p>
    </div>
  );
}

beforeEach(() => {
  calls.pages = [];
});

describe("library search corrections", () => {
  it("shows the substituted term and searches the exact words on request", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Picker filter="fetal exposure" /></QueryClientProvider>);
    const note = await screen.findByRole("status");
    expect(note).toHaveTextContent("No title has “fetal exposure”. Showing metal exposure.");
    expect(screen.getByText("Metal exposure in miners")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Search “fetal exposure” exactly" }));
    expect(await screen.findByTestId("count")).toHaveTextContent("0");
    expect(calls.pages.at(-1)).toMatchObject({ q: "fetal exposure", exact: true });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
