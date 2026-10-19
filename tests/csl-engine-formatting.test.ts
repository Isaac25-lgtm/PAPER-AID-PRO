/**
 * AI RESEARCH HUB — PHASE 8: CSL ENGINE FORMATTING & STYLE PROCESSING SUITE
 *
 * Verifies official Citeproc-JS rendering against reference expectations:
 * 1. APA 7th: In-text author-date and bibliography.
 * 2. Vancouver: In-text sequential number and bibliography.
 * 3. IEEE: In-text bracketed number [1] and bibliography.
 * 4. MLA 9th: In-text author-page and bibliography.
 * 5. Multiple sources in one citation cluster.
 * 6. Repeated citation to the same paper preserves numbering.
 * 7. Style switching preserves citation IDs and updates formatting.
 * 8. Dependent CSL style parent resolution (e.g. nature-medicine -> nature).
 * 9. Empty bibliographies / incomplete metadata handled without throwing.
 * 10. Output sanitization & HTML entity decoding.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createCiteprocEngine,
  renderCitationCluster,
  processSequentialCitationClusters,
  renderBibliography,
  stripHtmlTags,
  decodeHtmlEntities,
} from "../src/lib/citations/csl/csl-engine";
import {
  sanitizeCslHtml,
  cslToPlainText,
} from "../src/lib/citations/csl/html-sanitizer";
import { BUNDLED_STYLES } from "../src/lib/citations/csl/styles/bundled-styles";
import { EN_US_LOCALE_XML } from "../src/lib/citations/csl/locales/en-US";
import { CslItem } from "../src/lib/citations/csl/types";
import { getStyleXml } from "../src/lib/citations/csl/style-registry";

// Standard Sample References for Academic Evaluation
const SAMPLE_ITEMS: Record<string, CslItem> = {
  "item-vaswani": {
    id: "item-vaswani",
    type: "article-journal",
    title: "Attention Is All You Need",
    author: [
      { family: "Vaswani", given: "Ashish" },
      { family: "Shazeer", given: "Noam" },
      { family: "Parmar", given: "Niki" },
      { family: "Uszkoreit", given: "Jakob" },
      { family: "Jones", given: "Llion" },
      { family: "Gomez", given: "Aidan N." },
      { family: "Kaiser", given: "Lukasz" },
      { family: "Polosukhin", given: "Illia" },
    ],
    issued: { "date-parts": [[2017]] },
    "container-title": "Advances in Neural Information Processing Systems",
    volume: "30",
    page: "5998-6008",
    DOI: "10.48550/arxiv.1706.03762",
  },
  "item-lewis": {
    id: "item-lewis",
    type: "article-journal",
    title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
    author: [
      { family: "Lewis", given: "Patrick" },
      { family: "Perez", given: "Ethan" },
      { family: "Piktus", given: "Aleksandra" },
      { family: "Petroni", given: "Fabio" },
    ],
    issued: { "date-parts": [[2020]] },
    "container-title": "Advances in Neural Information Processing Systems",
    volume: "33",
    page: "9459-9474",
    DOI: "10.48550/arxiv.2005.11401",
  },
  "item-jumper": {
    id: "item-jumper",
    type: "article-journal",
    title: "Highly accurate protein structure prediction with AlphaFold",
    author: [
      { family: "Jumper", given: "John" },
      { family: "Evans", given: "Richard" },
      { family: "Pritzel", given: "Alexander" },
      { family: "Hassabis", given: "Demis" },
    ],
    issued: { "date-parts": [[2021]] },
    "container-title": "Nature",
    volume: "596",
    issue: "7873",
    page: "583-589",
    DOI: "10.1038/s41586-021-03819-2",
  },
};

describe("CSL Engine Formatting & Official Processor Suite", () => {
  test("1. APA 7th: author-date citation and formatted bibliography", () => {
    const engine = createCiteprocEngine(
      BUNDLED_STYLES.apa.xml,
      SAMPLE_ITEMS,
      EN_US_LOCALE_XML,
      "en-US"
    );

    const cluster = {
      citationID: "cit-1",
      citationItems: [{ id: "item-vaswani" }],
      properties: { noteIndex: 0 },
    };

    const inText = renderCitationCluster(engine, cluster);
    assert.equal(inText, "(Vaswani et al., 2017)");

    const bib = renderBibliography(engine, "apa", "APA 7th", "author-date");
    assert.ok(bib.entries.length >= 1);
    const entry = decodeHtmlEntities(stripHtmlTags(bib.entries.find((e) => e.includes("Vaswani")) || ""));
    assert.ok(entry.includes("Vaswani, A."));
    assert.ok(entry.includes("(2017)"));
    assert.ok(entry.toLowerCase().includes("attention is all you need"));
    assert.ok(entry.includes("Advances in Neural Information Processing Systems"));
  });

  test("2. Vancouver: numeric citation (1) and ICMJE bibliography format", () => {
    const engine = createCiteprocEngine(
      BUNDLED_STYLES.vancouver.xml,
      SAMPLE_ITEMS,
      EN_US_LOCALE_XML,
      "en-US"
    );

    const cluster = {
      citationID: "cit-1",
      citationItems: [{ id: "item-jumper" }],
      properties: { noteIndex: 0 },
    };

    const inText = renderCitationCluster(engine, cluster);
    assert.ok(inText.includes("1"), `Expected inText to contain 1, got ${inText}`);

    const bib = renderBibliography(engine, "vancouver", "Vancouver", "numeric");
    assert.ok(bib.entries.length >= 1);
    const entry = decodeHtmlEntities(stripHtmlTags(bib.entries.find((e) => e.includes("Jumper")) || ""));
    assert.ok(entry.includes("Jumper J"));
    assert.ok(entry.includes("Nature"));
    assert.ok(entry.includes("2021"));
  });

  test("3. IEEE: bracketed numeric citation [1] and IEEE abbreviation rules", () => {
    const engine = createCiteprocEngine(
      BUNDLED_STYLES.ieee.xml,
      SAMPLE_ITEMS,
      EN_US_LOCALE_XML,
      "en-US"
    );

    const cluster = {
      citationID: "cit-1",
      citationItems: [{ id: "item-vaswani" }],
      properties: { noteIndex: 0 },
    };

    const inText = renderCitationCluster(engine, cluster);
    assert.equal(inText, "[1]");

    const bib = renderBibliography(engine, "ieee", "IEEE", "numeric");
    assert.ok(bib.entries.length >= 1);
    const entry = decodeHtmlEntities(stripHtmlTags(bib.entries.find((e) => e.includes("Vaswani")) || ""));
    assert.ok(entry.includes("[1]"));
    assert.ok(entry.includes("A. Vaswani et al."));
    assert.ok(entry.includes("Attention Is All You Need"));
    assert.ok(entry.includes("2017"));
  });

  test("4. MLA 9th: author-page citation format with locator", () => {
    const engine = createCiteprocEngine(
      BUNDLED_STYLES.mla.xml,
      SAMPLE_ITEMS,
      EN_US_LOCALE_XML,
      "en-US"
    );

    const cluster = {
      citationID: "cit-1",
      citationItems: [{ id: "item-vaswani", locator: "5999", label: "page" }],
      properties: { noteIndex: 0 },
    };

    const inText = renderCitationCluster(engine, cluster);
    assert.equal(inText, "(Vaswani et al. 5999)");

    const bib = renderBibliography(engine, "mla", "MLA 9th", "author-date");
    assert.ok(bib.entries.length >= 1);
    const entry = decodeHtmlEntities(stripHtmlTags(bib.entries.find((e) => e.includes("Vaswani")) || ""));
    assert.ok(entry.includes("Vaswani, Ashish, et al."));
  });

  test("5. Multiple sources in one cluster: sorted and formatted according to style rules", () => {
    const engine = createCiteprocEngine(
      BUNDLED_STYLES.apa.xml,
      SAMPLE_ITEMS,
      EN_US_LOCALE_XML,
      "en-US"
    );

    const cluster = {
      citationID: "cit-multi",
      citationItems: [{ id: "item-vaswani" }, { id: "item-lewis" }],
      properties: { noteIndex: 0 },
    };

    const inText = renderCitationCluster(engine, cluster);
    // In APA, multiple citations are alphabetized by first author: Lewis comes before Vaswani
    assert.equal(inText, "(Lewis et al., 2020; Vaswani et al., 2017)");
  });

  test("6. Repeated citation to same paper: retains consistent number in numeric styles", () => {
    const engine = createCiteprocEngine(
      BUNDLED_STYLES.ieee.xml,
      SAMPLE_ITEMS,
      EN_US_LOCALE_XML,
      "en-US"
    );

    const clusters = [
      { citationId: "cit-1", items: [{ id: "item-vaswani" }] },
      { citationId: "cit-2", items: [{ id: "item-lewis" }] },
      { citationId: "cit-3", items: [{ id: "item-vaswani" }] }, // Repeated reference to Vaswani
    ];

    const results = processSequentialCitationClusters(engine, clusters);

    assert.equal(results.get("cit-1"), "[1]");
    assert.equal(results.get("cit-2"), "[2]");
    assert.equal(results.get("cit-3"), "[1]"); // Vaswani remains [1]!
  });

  test("7. Style switching preserves citation IDs and updates rendered format", () => {
    const clusters = [
      { citationId: "c1", items: [{ id: "item-vaswani" }] },
      { citationId: "c2", items: [{ id: "item-jumper" }] },
    ];

    // Format in APA
    const engineApa = createCiteprocEngine(
      BUNDLED_STYLES.apa.xml,
      SAMPLE_ITEMS,
      EN_US_LOCALE_XML,
      "en-US"
    );
    const apaResults = processSequentialCitationClusters(engineApa, clusters);
    assert.equal(apaResults.get("c1"), "(Vaswani et al., 2017)");
    assert.equal(apaResults.get("c2"), "(Jumper et al., 2021)");

    // Switch to IEEE using same clusters and IDs
    const engineIeee = createCiteprocEngine(
      BUNDLED_STYLES.ieee.xml,
      SAMPLE_ITEMS,
      EN_US_LOCALE_XML,
      "en-US"
    );
    const ieeeResults = processSequentialCitationClusters(engineIeee, clusters);
    assert.equal(ieeeResults.get("c1"), "[1]");
    assert.equal(ieeeResults.get("c2"), "[2]");
  });

  test("8. Dependent CSL Style parent resolution: nature-medicine resolves to nature parent", async () => {
    // nature-medicine is a dependent style pointing to parent 'nature'
    const styleResult = await getStyleXml("nature-medicine");

    assert.equal(styleResult.id, "nature-medicine");
    assert.ok(styleResult.isDependent);
    assert.equal(styleResult.parentId, "nature");
    assert.ok(styleResult.xml.includes("<style"));

    // Render using resolved dependent style
    const engine = createCiteprocEngine(
      styleResult.xml,
      SAMPLE_ITEMS,
      EN_US_LOCALE_XML,
      "en-US"
    );

    const cluster = {
      citationID: "cit-natmed",
      citationItems: [{ id: "item-jumper" }],
      properties: { noteIndex: 0 },
    };

    const inText = renderCitationCluster(engine, cluster);
    // Nature uses superscript numeric citations
    assert.ok(inText.includes("1"));
  });

  test("9. Empty bibliography and unknown item handling", () => {
    const engine = createCiteprocEngine(
      BUNDLED_STYLES.apa.xml,
      {},
      EN_US_LOCALE_XML,
      "en-US"
    );

    const bib = renderBibliography(engine, "apa", "APA 7th", "author-date");
    assert.equal(bib.entries.length, 0);

    const unknownCluster = {
      citationID: "cit-unknown",
      citationItems: [{ id: "missing-paper-999" }],
      properties: { noteIndex: 0 },
    };

    // Citeproc handles missing items safely without uncaught exception
    const inText = renderCitationCluster(engine, unknownCluster);
    assert.ok(typeof inText === "string");
  });

  test("10. Sanitization: decodes HTML entities and strips unwanted markup", () => {
    const raw = "Smith &amp; Wesson&#39;s &quot;Theory&quot; &#60;test&#62; &nbsp; &ndash; &mdash;";
    const decoded = decodeHtmlEntities(raw);
    assert.equal(decoded, 'Smith & Wesson\'s "Theory" <test>   – —');

    const html = '<div class="csl-entry"><i>Journal of AI</i>, <b>42</b>, pp. 1-10.</div>';
    const plain = stripHtmlTags(html);
    assert.equal(plain, "Journal of AI, 42, pp. 1-10.");
  });

  test("11. Comprehensive Allowlist Sanitization: neutralizes XSS payloads and preserves academic formatting", () => {
    // 1. Script tag injection inside bibliography or title
    const maliciousScript = '<div class="csl-entry">Smith, J. (2024). <script>alert("pwned")</script><i>Quantum Computing</i>.</div>';
    const sanitizedScript = sanitizeCslHtml(maliciousScript);
    assert.ok(!sanitizedScript.includes("<script>"));
    assert.ok(!sanitizedScript.includes("alert("));
    assert.ok(sanitizedScript.includes("<i>Quantum Computing</i>"));

    // 2. Onerror / onload image payload
    const maliciousImg = '<div class="csl-entry"><img src="x" onerror="alert(1)">Doe, A. (2023). <b>AI Ethics</b>.</div>';
    const sanitizedImg = sanitizeCslHtml(maliciousImg);
    assert.ok(!sanitizedImg.includes("<img"));
    assert.ok(!sanitizedImg.includes("onerror"));
    assert.ok(sanitizedImg.includes("<b>AI Ethics</b>"));

    // 3. Iframe and javascript: URI schemes
    const maliciousIframe = '<div class="csl-entry"><iframe src="javascript:alert(1)"></iframe>Johnson, K. (2022).</div>';
    const sanitizedIframe = sanitizeCslHtml(maliciousIframe);
    assert.ok(!sanitizedIframe.includes("<iframe"));
    assert.ok(!sanitizedIframe.includes("javascript:"));

    // 4. Safe plain text conversion preserving mathematical symbols
    const mathHtml = '<div class="csl-entry">Inequalities for <i>p</i> &lt; <i>q</i> in <b>L<sup>2</sup></b> space.</div>';
    const plainText = cslToPlainText(mathHtml);
    assert.equal(plainText, "Inequalities for p < q in L2 space.");
  });

  test("12. Vancouver & APA Bibliography Author Ordering Regression (Fink B, Hoyka M)", () => {
    const vancouverB3Item: CslItem = {
      id: "paper-vancouver-b3",
      type: "article-journal",
      title: "Vancouver B3 periprosthetic fractures of the femur: options for treatment",
      author: [
        { family: "Fink", given: "B" },
        { family: "Hoyka", given: "M" },
      ],
      issued: { "date-parts": [[2026]] },
      "container-title": "Der Unfallchirurg",
    };

    // 1. Vancouver Engine
    const vancouverEngine = createCiteprocEngine(
      BUNDLED_STYLES.vancouver.xml,
      { "paper-vancouver-b3": vancouverB3Item },
      EN_US_LOCALE_XML,
      "en-US"
    );

    const vancouverCluster = {
      citationID: "cit-vb3",
      citationItems: [{ id: "paper-vancouver-b3" }],
      properties: { noteIndex: 0 },
    };
    renderCitationCluster(vancouverEngine, vancouverCluster);

    const vancouverBib = renderBibliography(vancouverEngine, "vancouver", "Vancouver", "numeric");
    assert.equal(vancouverBib.entries.length, 1);
    const vancouverEntry = stripHtmlTags(vancouverBib.entries[0]);
    // MUST render as "Fink B, Hoyka M" and NEVER as "B F, M H"
    assert.ok(
      vancouverEntry.includes("Fink B, Hoyka M") || vancouverEntry.includes("Fink B, Hoyka M."),
      `Expected 'Fink B, Hoyka M' but received: ${vancouverEntry}`
    );
    assert.ok(!vancouverEntry.includes("B F, M H"), "Author name order must not be inverted!");

    // 2. APA Engine
    const apaEngine = createCiteprocEngine(
      BUNDLED_STYLES.apa.xml,
      { "paper-vancouver-b3": vancouverB3Item },
      EN_US_LOCALE_XML,
      "en-US"
    );
    renderCitationCluster(apaEngine, vancouverCluster);
    const apaBib = renderBibliography(apaEngine, "apa", "APA 7th", "author-date");
    assert.equal(apaBib.entries.length, 1);
    const apaEntry = stripHtmlTags(apaBib.entries[0]);
    // APA renders as "Fink, B., & Hoyka, M."
    assert.ok(apaEntry.includes("Fink, B.") && apaEntry.includes("Hoyka, M."));
    assert.ok(!apaEntry.includes("B., F."), "APA must not invert surname and initials!");
  });
});
