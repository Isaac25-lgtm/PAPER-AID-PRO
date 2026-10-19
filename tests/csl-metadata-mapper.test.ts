/**
 * AI RESEARCH HUB — PHASE 8: CSL METADATA MAPPER TEST SUITE
 *
 * Verifies:
 * 1. Complete paper metadata mapping to CSL-JSON.
 * 2. Missing DOI handled gracefully (no fabricated DOI).
 * 3. Author parsing: single author, two authors, multiple authors (et al.), missing author.
 * 4. Missing publication date ("n.d.") and partial date (year only).
 * 5. Metadata-only paper mapping (no chunks or PDF attached).
 * 6. UserLibraryItem to CSL-JSON mapping.
 * 7. Zero data loss and strict non-fabrication guarantee.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  mapReferenceToCslJson,
  parseAuthorName,
} from "../src/lib/citations/csl/csl-mapper";
import { CslItem } from "../src/lib/citations/csl/types";

describe("CSL-JSON Metadata Mapper Suite", () => {
  test("1. parseAuthorName: handles single, multiple, and complex names", () => {
    // Standard First Last
    const a1 = parseAuthorName("Ashish Vaswani");
    assert.equal(a1.family, "Vaswani");
    assert.equal(a1.given, "Ashish");

    // Multi-part given name
    const a2 = parseAuthorName("John Michael Smith");
    assert.equal(a2.family, "Smith");
    assert.equal(a2.given, "John Michael");

    // Institutional / Consortium / Organization
    const a3 = parseAuthorName("World Health Organization");
    assert.equal(a3.literal, "World Health Organization");

    // Single word name
    const a4 = parseAuthorName("Aristotle");
    assert.equal(a4.family, "Aristotle");

    // Empty name fallback
    const a5 = parseAuthorName("");
    assert.equal(a5.literal, "Unknown Author");
  });

  test("2. Complete Paper mapping: all bibliographic fields mapped accurately", () => {
    const rawPaper = {
      id: "paper-transformer-001",
      title: "Attention Is All You Need",
      doi: "10.48550/arXiv.1706.03762",
      journal: "Advances in Neural Information Processing Systems",
      publicationDate: new Date("2017-06-12T00:00:00.000Z"),
      authors: [
        { author: { name: "Ashish Vaswani" } },
        { author: { name: "Noam Shazeer" } },
        { author: { name: "Niki Parmar" } },
      ],
      rawMetadata: {
        volume: "30",
        issue: "1",
        page: "5998-6008",
        publisher: "Curran Associates, Inc.",
        issn: "1049-5258",
      },
    };

    const csl = mapReferenceToCslJson(rawPaper);

    assert.equal(csl.id, "paper-transformer-001");
    assert.equal(csl.title, "Attention Is All You Need");
    assert.equal(csl.type, "article-journal");
    assert.equal(csl.DOI, "10.48550/arxiv.1706.03762");
    assert.equal(csl["container-title"], "Advances in Neural Information Processing Systems");
    assert.equal(csl.volume, "30");
    assert.equal(csl.issue, "1");
    assert.equal(csl.page, "5998-6008");
    assert.equal(csl.publisher, "Curran Associates, Inc.");
    assert.equal(csl.ISSN, "1049-5258");
    assert.deepEqual(csl.issued, { "date-parts": [[2017, 6, 12]] });

    assert.equal(csl.author?.length, 3);
    assert.equal(csl.author?.[0].family, "Vaswani");
    assert.equal(csl.author?.[0].given, "Ashish");
    assert.equal(csl.author?.[1].family, "Shazeer");
    assert.equal(csl.author?.[2].family, "Parmar");
  });

  test("3. Missing DOI: preserves absence without hallucinating or fabricating", () => {
    const rawPaper = {
      id: "paper-nodoi-002",
      title: "Historical Analysis of Medical Literature",
      journal: "Journal of Medical Humanities",
      publicationDate: new Date("2020-01-01"),
      authors: [{ author: { name: "Sarah Connor" } }],
    };

    const csl = mapReferenceToCslJson(rawPaper);
    assert.equal(csl.id, "paper-nodoi-002");
    assert.equal(csl.DOI, undefined);
    assert.equal(csl.title, "Historical Analysis of Medical Literature");
    assert.equal(csl["container-title"], "Journal of Medical Humanities");
  });

  test("4. Missing Authors: defaults to undefined author without crashing", () => {
    const rawPaper = {
      id: "paper-noauthor-003",
      title: "Anonymous Government Report on Energy",
      publicationDate: new Date("2021-05-10"),
      authors: [],
    };

    const csl = mapReferenceToCslJson(rawPaper);
    assert.equal(csl.id, "paper-noauthor-003");
    assert.equal(csl.author, undefined);
  });

  test("5. Missing Publication Date: handled without date parts", () => {
    const rawPaper = {
      id: "paper-nodate-004",
      title: "Undated Manuscript on Topology",
      authors: [{ author: { name: "Leonhard Euler" } }],
    };

    const csl = mapReferenceToCslJson(rawPaper);
    assert.equal(csl.id, "paper-nodate-004");
    assert.equal(csl.issued, undefined);
  });

  test("6. Metadata-Only Paper: works without requiring PDF or chunks", () => {
    const metaOnly = {
      id: "paper-meta-005",
      title: "Pure Theory of Elastic Moduli",
      doi: "10.1000/182",
      journal: "Physical Review B",
      publicationDate: "2019-11-20",
      authors: [{ author: { name: "Richard Feynman" } }],
      status: "PENDING",
      _count: { chunks: 0 },
    };

    const csl = mapReferenceToCslJson(metaOnly);
    assert.equal(csl.id, "paper-meta-005");
    assert.equal(csl.title, "Pure Theory of Elastic Moduli");
    assert.equal(csl.DOI, "10.1000/182");
    assert.equal(csl.author?.[0].family, "Feynman");
  });

  test("7. UserLibraryItem to CSL mapping: string authors and direct properties", () => {
    const libraryItem = {
      id: "lib-item-777",
      title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
      authors: ["Patrick Lewis", "Ethan Perez", "Aleksandra Piktus"],
      year: 2020,
      journal: "NeurIPS 2020",
      doi: "10.48550/arXiv.2005.11401",
      documentType: "PREPRINT",
      hasPdf: false,
    };

    const csl = mapReferenceToCslJson(libraryItem);
    assert.equal(csl.id, "lib-item-777");
    assert.equal(csl.title, "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks");
    assert.equal(csl.author?.length, 3);
    assert.equal(csl.author?.[0].family, "Lewis");
    assert.equal(csl.author?.[0].given, "Patrick");
    assert.deepEqual(csl.issued, { "date-parts": [[2020]] });
    assert.equal(csl["container-title"], "NeurIPS 2020");
    assert.equal(csl.DOI, "10.48550/arxiv.2005.11401");
  });

  test("8. Author Name Parsing & Inversion Regression: NLM/PubMed initials, Western names, and compound strings", () => {
    // Exact user failure strings: "Fink B, Hoyka M"
    const p1 = parseAuthorName("Fink B");
    assert.equal(p1.family, "Fink");
    assert.equal(p1.given, "B");

    const p2 = parseAuthorName("Hoyka M");
    assert.equal(p2.family, "Hoyka");
    assert.equal(p2.given, "M");

    // Inverted comma format: "Fink, B"
    const p3 = parseAuthorName("Fink, B");
    assert.equal(p3.family, "Fink");
    assert.equal(p3.given, "B");

    // Standard Western format: "Benjamin Fink"
    const p4 = parseAuthorName("Benjamin Fink");
    assert.equal(p4.family, "Fink");
    assert.equal(p4.given, "Benjamin");

    // Western with initial: "B. Fink"
    const p5 = parseAuthorName("B. Fink");
    assert.equal(p5.family, "Fink");
    assert.equal(p5.given, "B.");

    // Structured author object pass-through
    const p6 = parseAuthorName({ family: "Fink", given: "B" } as any);
    assert.equal(p6.family, "Fink");
    assert.equal(p6.given, "B");

    // Multi-part surname with particle
    const p7 = parseAuthorName("Ludwig van Beethoven");
    assert.equal(p7.family, "van Beethoven");
    assert.equal(p7.given, "Ludwig");

    // Institutional author
    const p8 = parseAuthorName("World Health Organization");
    assert.equal(p8.literal, "World Health Organization");

    // Combined author string mapping from Paper record
    const paperWithCombinedAuthors = {
      id: "paper-vancouver-b3",
      title: "Vancouver B3 periprosthetic fractures of the femur: options for treatment",
      authors: ["Fink B, Hoyka M"],
      journal: "Der Unfallchirurg",
      publicationDate: "2026-01-01",
    };

    const csl = mapReferenceToCslJson(paperWithCombinedAuthors);
    assert.equal(csl.author?.length, 2);
    assert.equal(csl.author?.[0].family, "Fink");
    assert.equal(csl.author?.[0].given, "B");
    assert.equal(csl.author?.[1].family, "Hoyka");
    assert.equal(csl.author?.[1].given, "M");
  });
});
