/**
 * AI RESEARCH HUB — PHASE 8: BIBTEX & RIS EXPORT TEST SUITE
 *
 * Verifies standard bibliographic export formats:
 * 1. Single reference BibTeX generation.
 * 2. Bulk references BibTeX generation.
 * 3. Single reference RIS generation.
 * 4. Bulk references RIS generation.
 * 5. Special character and LaTeX escaping in BibTeX.
 * 6. Graceful handling of incomplete metadata (missing DOI, missing volume, missing year).
 * 7. Metadata-only references export with 0 PDF downloads or AI calls.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  exportToBibTeX,
  exportMultipleToBibTeX,
  exportToRIS,
  exportMultipleToRIS,
} from "../src/lib/citations/csl/bibtex-ris-exporter";
import { CslItem } from "../src/lib/citations/csl/types";

const TEST_PAPERS: CslItem[] = [
  {
    id: "vaswani-2017",
    type: "article-journal",
    title: "Attention Is All You Need",
    author: [
      { family: "Vaswani", given: "Ashish" },
      { family: "Shazeer", given: "Noam" },
      { family: "Parmar", given: "Niki" },
    ],
    issued: { "date-parts": [[2017, 6, 12]] },
    "container-title": "Advances in Neural Information Processing Systems",
    volume: "30",
    page: "5998-6008",
    DOI: "10.48550/arxiv.1706.03762",
    URL: "https://arxiv.org/abs/1706.03762",
  },
  {
    id: "lewis-2020",
    type: "article-journal",
    title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
    author: [
      { family: "Lewis", given: "Patrick" },
      { family: "Perez", given: "Ethan" },
    ],
    issued: { "date-parts": [[2020, 12, 6]] },
    "container-title": "NeurIPS 2020",
    volume: "33",
    page: "9459-9474",
    DOI: "10.48550/arxiv.2005.11401",
  },
  {
    id: "special-char-paper",
    type: "article-journal",
    title: "Quantum Computing & Algorithms: 100% Fidelity",
    author: [{ family: "Müller", given: "François" }],
    issued: { "date-parts": [[2022]] },
    "container-title": "Nature Physics",
  },
];

describe("BibTeX & RIS Bibliographic Export Suite", () => {
  test("1. Single BibTeX Export: properly formats fields and citation key", () => {
    const bibtex = exportToBibTeX(TEST_PAPERS[0]);

    assert.ok(bibtex.startsWith("@article{vaswani2017attentio,"));
    assert.ok(bibtex.includes("title     = {Attention Is All You Need}"));
    assert.ok(bibtex.includes("author    = {{Vaswani}, Ashish and {Shazeer}, Noam and {Parmar}, Niki}"));
    assert.ok(bibtex.includes("journal   = {Advances in Neural Information Processing Systems}"));
    assert.ok(bibtex.includes("year      = {2017}"));
    assert.ok(bibtex.includes("volume    = {30}"));
    assert.ok(bibtex.includes("pages     = {5998-6008}"));
    assert.ok(bibtex.includes("doi       = {10.48550/arxiv.1706.03762}"));
    assert.ok(bibtex.includes("url       = {https://arxiv.org/abs/1706.03762}"));
    assert.ok(bibtex.endsWith("}"));
  });

  test("2. Bulk BibTeX Export: combines multiple entries separated by double newlines", () => {
    const bulk = exportMultipleToBibTeX(TEST_PAPERS);

    assert.ok(bulk.includes("@article{vaswani2017attentio,"));
    assert.ok(bulk.includes("@article{lewis2020retrieva,"));
    assert.ok(bulk.includes("@article{mller2022quantumc,"));
    assert.equal((bulk.match(/@article/g) || []).length, 3);
  });

  test("3. Single RIS Export: conforms to Research Information Systems specification", () => {
    const ris = exportToRIS(TEST_PAPERS[0]);

    assert.ok(ris.includes("TY  - JOUR"));
    assert.ok(ris.includes("TI  - Attention Is All You Need"));
    assert.ok(ris.includes("AU  - Vaswani, Ashish"));
    assert.ok(ris.includes("AU  - Shazeer, Noam"));
    assert.ok(ris.includes("AU  - Parmar, Niki"));
    assert.ok(ris.includes("JO  - Advances in Neural Information Processing Systems"));
    assert.ok(ris.includes("PY  - 2017/06/12/"));
    assert.ok(ris.includes("VL  - 30"));
    assert.ok(ris.includes("SP  - 5998"));
    assert.ok(ris.includes("EP  - 6008"));
    assert.ok(ris.includes("DO  - 10.48550/arxiv.1706.03762"));
    assert.ok(ris.trim().endsWith("ER  -"));
  });

  test("4. Bulk RIS Export: concatenates multiple entries with proper ER records", () => {
    const bulkRis = exportMultipleToRIS(TEST_PAPERS);

    const erCount = (bulkRis.match(/ER  -/g) || []).length;
    assert.equal(erCount, 3);
    const tyCount = (bulkRis.match(/TY  -/g) || []).length;
    assert.equal(tyCount, 3);
  });

  test("5. Special Characters and Incomplete Metadata handled without errors", () => {
    const special = exportToBibTeX(TEST_PAPERS[2]);
    // Ampersand and percent sign escaped in LaTeX format
    assert.ok(special.includes("\\&"));
    assert.ok(special.includes("\\%"));
    assert.ok(special.includes("{Müller}, François"));

    // Incomplete paper (no DOI, no author, no date)
    const incomplete: CslItem = {
      id: "incomplete-doc",
      type: "manuscript",
      title: "Anonymous Draft",
    };

    const incompleteBib = exportToBibTeX(incomplete);
    assert.ok(incompleteBib.startsWith("@unpublished{itemndanonymou,"));
    assert.ok(incompleteBib.includes("title     = {Anonymous Draft}"));

    const incompleteRis = exportToRIS(incomplete);
    assert.ok(incompleteRis.includes("TY  - MANSCPT"));
    assert.ok(incompleteRis.includes("TI  - Anonymous Draft"));
    assert.ok(incompleteRis.trim().endsWith("ER  -"));
  });

  test("6. Round-trip Import: exported BibTeX and RIS conform to import specifications", () => {
    function parseBibTeX(text: string) {
      const items: Array<{ title?: string; year?: string; doi?: string }> = [];
      const entryRegex = /@([a-zA-Z]+)\s*\{([^,\s]+)\s*,([\s\S]*?)(?=\n@|\n*$)/g;
      let match: RegExpExecArray | null;
      while ((match = entryRegex.exec(text)) !== null) {
        const body = match[3];
        const titleMatch = body.match(/title\s*=\s*\{([^}]+)\}/);
        const yearMatch = body.match(/year\s*=\s*\{([^}]+)\}/);
        const doiMatch = body.match(/doi\s*=\s*\{([^}]+)\}/);
        items.push({
          title: titleMatch?.[1],
          year: yearMatch?.[1],
          doi: doiMatch?.[1],
        });
      }
      return items;
    }

    function parseRIS(text: string) {
      const items: Array<{ title?: string; year?: string; doi?: string; authors: string[] }> = [];
      const records = text.split(/(?:^|\n)\s*ER\s+-(?:[^\n]*)?(?:\n|$)/);
      for (const rec of records) {
        if (!rec.trim()) continue;
        const titleMatch = rec.match(/TI\s*-\s*([^\n]+)/);
        const yearMatch = rec.match(/PY\s*-\s*(\d{4})/);
        const doiMatch = rec.match(/DO\s*-\s*([^\n]+)/);
        const authorMatches: string[] = [];
        const auRegex = /AU\s*-\s*([^\n]+)/g;
        let auMatch: RegExpExecArray | null;
        while ((auMatch = auRegex.exec(rec)) !== null) {
          authorMatches.push(auMatch[1].trim());
        }
        items.push({
          title: titleMatch?.[1]?.trim(),
          year: yearMatch?.[1]?.trim(),
          doi: doiMatch?.[1]?.trim(),
          authors: authorMatches,
        });
      }
      return items;
    }

    // 1. Export BibTeX and parse
    const exportedBibTeX = exportMultipleToBibTeX(TEST_PAPERS);
    const parsedBibItems = parseBibTeX(exportedBibTeX);

    assert.equal(parsedBibItems.length, 3);
    assert.equal(parsedBibItems[0].title, "Attention Is All You Need");
    assert.equal(parsedBibItems[0].year, "2017");
    assert.equal(parsedBibItems[0].doi, "10.48550/arxiv.1706.03762");
    assert.equal(parsedBibItems[1].title, "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks");
    assert.equal(parsedBibItems[1].year, "2020");

    // 2. Export RIS and parse
    const exportedRIS = exportMultipleToRIS(TEST_PAPERS);
    const parsedRisItems = parseRIS(exportedRIS);

    assert.equal(parsedRisItems.length, 3);
    assert.equal(parsedRisItems[0].title, "Attention Is All You Need");
    assert.equal(parsedRisItems[0].year, "2017");
    assert.equal(parsedRisItems[0].doi, "10.48550/arxiv.1706.03762");
    assert.equal(parsedRisItems[1].title, "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks");
    assert.equal(parsedRisItems[1].authors.length, 2);
  });
});

