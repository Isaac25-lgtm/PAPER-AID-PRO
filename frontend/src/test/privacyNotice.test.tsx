// The Privacy Notice states where each environment really stores data (Deep Research audit F11): staging's database
// is Neon in the United States; the public version's stays in the European Union, its wording unchanged.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The page only needs the layout's Container; the real layout module pulls in sign-in, which tests do not start.
vi.mock("@/components/Layout", () => ({ Container: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

async function renderPrivacy() {
  vi.resetModules();
  const { PrivacyPage } = await import("@/pages/Static");
  render(<MemoryRouter><PrivacyPage /></MemoryRouter>);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("privacy notice hosting facts", () => {
  it("names Neon in the United States on staging", async () => {
    vi.stubEnv("VITE_DEPLOYMENT", "staging");
    await renderPrivacy();
    expect(screen.getByText(/Neon in the United States \(Ohio\)/)).toBeInTheDocument();
    expect(screen.getByText(/staging \(test\) version/)).toBeInTheDocument();
  });

  it("keeps the public version's wording unchanged", async () => {
    vi.stubEnv("VITE_DEPLOYMENT", "");
    await renderPrivacy();
    expect(screen.getByText(/Data is stored in the European Union \(Netherlands\)\./)).toBeInTheDocument();
    expect(screen.queryByText(/Neon/)).toBeNull();
  });
});
