// Citations and references open their source (Silver, 25 November 2026): DOI and web addresses in reference lists
// are links in a new tab, and an in-text citation shows its source with "Open paper" and "Open DOI".
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { linkifyReferences } from "@/lib/format";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: {
    get: (path: string) => {
      if (path === "/documents/d1/citations") return Promise.resolve([{ id: "c1", paper_id: "p1", chunk_id: null, locator: "p. 12", label: "(Suri & Jack, 2016)", prefix: null, suffix: null }]);
      if (path === "/papers/p1") return Promise.resolve({ id: "p1", title: "The long-run poverty and gender impacts of mobile money", authors: ["Tavneet Suri", "William Jack"], year: 2016, doi: "10.1126/science.aah5309" });
      return Promise.resolve(null);
    },
  },
}));

const { CitationPopover, pageLabel } = await import("@/components/editor/CitationPopover");

describe("page locators", () => {
  it("read as pages, and anything else is shown as written", () => {
    expect(pageLabel("1")).toBe("p. 1");
    expect(pageLabel("12-14")).toBe("pp. 12-14");
    expect(pageLabel("p. 12")).toBe("p. 12");
    expect(pageLabel("chapter 3")).toBe("chapter 3");
  });
});

describe("reference lists", () => {
  it("make DOI addresses clickable, opening in a new tab", () => {
    const html = linkifyReferences("Suri, T., &amp; Jack, W. (2016). <i>Science</i>, 354, 1288. https://doi.org/10.1126/science.aah5309.");
    const box = document.createElement("div");
    box.innerHTML = html;
    const link = box.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://doi.org/10.1126/science.aah5309"); // the sentence's full stop is not part of it
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.className).toBe("reference-link"); // styled as a link (the CSS reset would make it look like text)
    expect(box.querySelector("i")?.textContent).toBe("Science"); // formatting is kept
  });

  it("keep a closing bracket that belongs to the address, and never link anything but http(s)", () => {
    const box = document.createElement("div");
    box.innerHTML = linkifyReferences("See https://doi.org/10.1234/example(2020) and javascript:alert(1)");
    expect([...box.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["https://doi.org/10.1234/example(2020)"]);
  });

  it("agree with the Word/PDF exporter on the shared cases (backend test_sf03_shared_link_fixtures)", () => {
    const cases: Record<string, string> = {
      "See <https://example.org/a>.": "https://example.org/a",
      "(https://doi.org/10.1/x)": "https://doi.org/10.1/x",
      "https://doi.org/10.1002/(SICI)1097-0258(19980815)17:15<1661::AID-SIM968>3.0.CO;2-2.": "https://doi.org/10.1002/(SICI)1097-0258(19980815)17:15<1661::AID-SIM968>3.0.CO;2-2",
      "https://example.org/a?x=1&y=2,": "https://example.org/a?x=1&y=2",
      "[https://example.org/b]": "https://example.org/b",
    };
    for (const [text, url] of Object.entries(cases)) {
      const box = document.createElement("div");
      box.innerHTML = linkifyReferences(text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")); // as CSL escapes it
      expect([...box.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([url]);
      expect(box.textContent).toBe(text); // nothing added or lost around the link
    }
  });
});

describe("in-text citations", () => {
  it("show the cited source with links to its paper page and DOI, in new tabs", async () => {
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CitationPopover documentId="d1" target={{ ids: ["c1"], rect: { left: 10, top: 4, bottom: 20 } }} onClose={onClose} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("The long-run poverty and gender impacts of mobile money")).toBeInTheDocument();
    expect(screen.getByText(/Tavneet Suri, William Jack · 2016 · p\. 12/)).toBeInTheDocument();
    const paper = screen.getByRole("link", { name: /Open paper/ });
    expect(paper).toHaveAttribute("href", "/papers/p1");
    expect(paper).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: /Open DOI/ })).toHaveAttribute("href", "https://doi.org/10.1126/science.aah5309");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
