// Reference checker screen (Deep Research audit F02, F03, F10): the badge names the actual problem, a registered
// DOI is not a mismatch, and oversized input is explained before anything is sent.
import { describe, expect, it } from "vitest";

import { MAX_REFERENCE_CHARS, referenceProblem, splitReferences, verdictLabel } from "@/lib/referenceChecks";
import type { VerifyResult } from "@/lib/types";

const fields = (title: string, year: string, first_author: string) => ({ title_similarity: 1, year_matches: null, first_author_matches: null, fields: { title, year, first_author } });
const result = (over: Partial<VerifyResult>): VerifyResult => ({ reference: "r", verdict: "verified", explanation: "", match: null, ...over });

describe("reference checker badges", () => {
  it("says a DOI points elsewhere only when the reference's own title disagrees", () => {
    expect(verdictLabel(result({ verdict: "mismatch", via_doi: true, checks: fields("does not match", "matched", "matched") }))).toBe("DOI points to a different work");
    expect(verdictLabel(result({ verdict: "mismatch", via_doi: false, checks: fields("matched", "does not match", "matched") }))).toBe("Wrong year");
    expect(verdictLabel(result({ verdict: "mismatch", via_doi: true, checks: fields("matched", "matched", "does not match") }))).toBe("Wrong first author");
  });

  it("calls a bare, resolving DOI registered", () => {
    expect(verdictLabel(result({ verdict: "registered", via_doi: true, checks: fields("not checked", "not checked", "not checked") }))).toBe("DOI is registered");
  });
});

describe("reference list limits", () => {
  it("names the reference that is too long", () => {
    const refs = splitReferences(`Smith A. A fine title. 2017.\n\n${"x".repeat(MAX_REFERENCE_CHARS + 1)}`);
    expect(referenceProblem(refs)).toBe("Reference 2 is longer than 1,500 characters. Separate references with a blank line.");
    expect(referenceProblem(splitReferences("Smith A. A fine title. 2017."))).toBeNull();
  });
});
