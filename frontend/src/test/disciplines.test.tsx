import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DESIGN_GROUPS, STUDY_DESIGNS, defaultHeadings, sectionGuidance } from "@/lib/templates";

const posted = vi.hoisted(() => ({ calls: [] as { path: string; body: unknown }[] }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: {
    post: (path: string, body: unknown) => {
      posted.calls.push({ path, body });
      return Promise.resolve({ id: "p1", title: "x" });
    },
    get: () => Promise.resolve({}),
  },
}));
const { ManualSourceForm } = await import("@/components/ManualSource");
const { UserSuppliedBadge } = await import("@/components/papers");

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  posted.calls = [];
});

describe("Templates for every discipline", () => {
  it("offers designs beyond health and STEM, grouped by approach", () => {
    const groups = DESIGN_GROUPS.manuscript.map((g) => g.group);
    expect(groups).toEqual(expect.arrayContaining(["Quantitative", "Qualitative", "Humanities & law", "Business & management"]));
    expect(STUDY_DESIGNS.proposal).toContain("Concept Note");
  });

  it("gives each approach its own outline", () => {
    expect(defaultHeadings("manuscript", "Doctrinal Legal Research")).toContain("Case Law Analysis");
    expect(defaultHeadings("manuscript", "Historical / Archival Study")).toContain("Sources & Archives");
    expect(defaultHeadings("manuscript", "Mixed-Methods Study")).toContain("Integration of Findings");
    expect(defaultHeadings("proposal", "Concept Note")).toContain("Problem Statement");
    expect(defaultHeadings("manuscript", "Randomized Controlled Trial (RCT)")[0]).toBe("Structured Abstract");
  });

  it("writes guidance that fits the design (themes, not effect sizes, for qualitative work)", () => {
    expect(sectionGuidance("Findings & Themes", "Ethnography")).toMatch(/theme/i);
    expect(sectionGuidance("Results", "Survey / Questionnaire Study")).not.toMatch(/confidence interval/i);
  });
});

describe("Manual sources", () => {
  it("shows the fields for the chosen type and sends a user-supplied record", async () => {
    wrap(<ManualSourceForm onSaved={() => undefined} />);
    await userEvent.selectOptions(screen.getByLabelText("Type of source"), "legal_case");
    expect(screen.getByLabelText("Court or issuing body")).toBeInTheDocument();
    expect(screen.queryByLabelText(/ISBN/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Title"), "Mifumi (U) Ltd v Attorney General");
    await userEvent.type(screen.getByLabelText("Court or issuing body"), "Supreme Court of Uganda");
    await userEvent.type(screen.getByLabelText("Year"), "2015");
    await userEvent.click(screen.getByRole("button", { name: "Add to my library" }));
    expect(posted.calls.at(-1)).toMatchObject({
      path: "/papers/manual",
      body: { type: "legal_case", title: "Mifumi (U) Ltd v Attorney General", authority: "Supreme Court of Uganda", year: 2015 },
    });
  });

  it("labels user-supplied details", () => {
    render(<UserSuppliedBadge paper={{ metadata_source: "user" }} />);
    expect(screen.getByText("User-supplied details")).toBeInTheDocument();
    const { container } = render(<UserSuppliedBadge paper={{ metadata_source: "registry" }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
