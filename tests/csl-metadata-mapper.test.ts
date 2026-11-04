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

import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  assertDisposableDatabaseMarker,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  mapReferenceToCslJson,
  parseAuthorName,
} from "../src/lib/citations/csl/csl-mapper";
import { CslItem } from "../src/lib/citations/csl/types";
import {
  createCiteprocEngine,
  renderBibliography,
  stripHtmlTags,
  decodeHtmlEntities,
} from "../src/lib/citations/csl/csl-engine";
import { BUNDLED_STYLES } from "../src/lib/citations/csl/styles/bundled-styles";
import { EN_US_LOCALE_XML } from "../src/lib/citations/csl/locales/en-US";
import { CrossrefProvider } from "../src/lib/discovery/providers/crossref";
import { PubMedProvider } from "../src/lib/discovery/providers/pubmed";
import { mergePaperRecords } from "../src/lib/discovery/deduplicate";
import { executePaperMetadataImport } from "../src/lib/discovery/import-service";
import {
  lookupPaperByIdentifier,
  importPaperByIdentifier,
} from "../src/lib/library/identifier-lookup-service";
import { prisma } from "../src/lib/prisma";

function formatApaEntry(csl: CslItem): string {
  const engine = createCiteprocEngine(
    BUNDLED_STYLES.apa.xml,
    [csl],
    EN_US_LOCALE_XML,
    "en-US"
  );
  const bib = renderBibliography(engine, "apa", "APA 7th", "author-date");
  return decodeHtmlEntities(stripHtmlTags(bib.entries[0] || ""));
}

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

  test("9. SourceProvenance & Provider rawMetadata volume, issue, and pages mapping (present vs absent issue)", () => {
    const paperFromCrossrefProvenance = {
      id: "paper-morales-prov",
      title:
        "Diagnostic accuracy of transvaginal ultrasound for adenomyosis using consensus-based direct and indirect sonographic signs: prospective cohort study",
      doi: "10.1002/uog.70315",
      journal: "Ultrasound in Obstetrics & Gynecology",
      publicationDate: new Date("2026-03-01T00:00:00.000Z"),
      authors: [
        { author: { name: "C. Morales" } },
        { author: { name: "E. Crovo" } },
        { author: { name: "P. Ebner" } },
        { author: { name: "P. Joublan" } },
        { author: { name: "P. Concha" } },
        { author: { name: "R. Assar" } },
        { author: { name: "J. L. Alcazar" } },
      ],
      sourceProvenance: {
        volume: "68",
        issue: "3",
        pages: "426-433",
        rawMetadata: {
          crossref: {
            volume: "68",
            issue: "3",
            page: "426-433",
          },
        },
      },
    };

    const cslWithIssue = mapReferenceToCslJson(paperFromCrossrefProvenance);
    assert.equal(cslWithIssue.volume, "68");
    assert.equal(cslWithIssue.issue, "3");
    assert.equal(cslWithIssue.page, "426-433");

    // Nested provider rawMetadata fallback when top-level sourceProvenance fields are omitted
    const paperNestedProviderOnly = {
      id: "paper-pubmed-nested",
      title: "Diagnostic accuracy of transvaginal ultrasound for adenomyosis",
      journal: "Ultrasound Obstet Gynecol",
      publicationDate: "2026-03-01",
      sourceProvenance: {
        rawMetadata: {
          pubmed: {
            volume: "68",
            issue: "3",
            pages: "426-433",
          },
        },
      },
    };
    const cslNested = mapReferenceToCslJson(paperNestedProviderOnly);
    assert.equal(cslNested.volume, "68");
    assert.equal(cslNested.issue, "3");
    assert.equal(cslNested.page, "426-433");

    // Source with no issue: issue must be undefined (never fabricated)
    const paperWithoutIssue = {
      ...paperFromCrossrefProvenance,
      id: "paper-morales-no-issue",
      sourceProvenance: {
        volume: "68",
        pages: "426-433",
      },
    };
    const cslWithoutIssue = mapReferenceToCslJson(paperWithoutIssue);
    assert.equal(cslWithoutIssue.volume, "68");
    assert.equal(cslWithoutIssue.issue, undefined);
    assert.equal(cslWithoutIssue.page, "426-433");

    // Empty direct fields and whitespace provenance fields falling back to populated provider metadata
    const paperEmptyDirectWhitespaceProv = {
      id: "paper-empty-whitespace-fallback",
      title: "Diagnostic accuracy of transvaginal ultrasound for adenomyosis",
      journal: "Ultrasound Obstet Gynecol",
      publicationDate: "2026-03-01",
      volume: "", // Empty direct field
      issue: "   ", // Whitespace direct field
      pages: "", // Empty direct field
      sourceProvenance: {
        volume: "   ", // Whitespace provenance field
        issue: "", // Empty provenance field
        pages: "  ", // Whitespace provenance field
        rawMetadata: {
          volume: "", // Empty rawMetadata
          issue: "   ", // Whitespace rawMetadata
          crossref: {
            volume: "68",
            issue: "3",
            page: "426-433",
          },
        },
      },
    };
    const cslFallback = mapReferenceToCslJson(paperEmptyDirectWhitespaceProv);
    assert.equal(cslFallback.volume, "68", "Volume falls back through blank direct/prov fields to provider metadata");
    assert.equal(cslFallback.issue, "3", "Issue falls back through blank direct/prov fields to provider metadata");
    assert.equal(cslFallback.page, "426-433", "Page falls back through blank direct/prov fields to provider metadata");

    // Empty direct fields and whitespace provenance with genuinely absent issue leaves issue undefined
    const paperGenuinelyAbsentIssueWithBlanks = {
      id: "paper-absent-issue-with-blanks",
      title: "Diagnostic accuracy of transvaginal ultrasound for adenomyosis",
      journal: "Ultrasound Obstet Gynecol",
      publicationDate: "2026-03-01",
      volume: "68",
      issue: "   ", // Whitespace direct field
      pages: "426-433",
      sourceProvenance: {
        issue: "", // Empty provenance field
        rawMetadata: {
          crossref: {
            volume: "68",
            issue: "  ", // Whitespace provider issue
            page: "426-433",
          },
        },
      },
    };
    const cslAbsent = mapReferenceToCslJson(paperGenuinelyAbsentIssueWithBlanks);
    assert.equal(cslAbsent.volume, "68");
    assert.equal(cslAbsent.issue, undefined, "Genuinely absent issue must remain undefined even when blank candidates exist");
    assert.equal(cslAbsent.page, "426-433");
  });

  test("10. Provider-to-DB-to-APA end-to-end import: Crossref, PubMed, omitted issue, and partial re-import enrichment", async () => {
    await assertDisposableDatabaseMarker(prisma);
    const ts = Date.now();
    const testUser = await prisma.user.create({
      data: {
        email: `metadata-import-test-${ts}@test.local`,
        name: "Metadata Import Tester",
        role: "USER",
      },
    });

    const createdPaperIds: string[] = [];
    const originalFetch = globalThis.fetch;

    try {
      // 10a. CrossrefProvider -> executePaperMetadataImport -> DB readback -> APA 7th citation
      const crDoi = `10.1002/uog.70315.cr.${ts}`;
      let capturedCrossrefUrl = "";
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        capturedCrossrefUrl = String(input);
        return new Response(
          JSON.stringify({
            message: {
              items: [
                {
                  DOI: crDoi,
                  title: [
                    `Diagnostic accuracy of transvaginal ultrasound for adenomyosis using consensus-based direct and indirect sonographic signs: prospective cohort study [CR-${ts}]`,
                  ],
                  author: [
                    { given: "C.", family: "Morales" },
                    { given: "E.", family: "Crovo" },
                    { given: "P.", family: "Ebner" },
                    { given: "P.", family: "Joublan" },
                    { given: "P.", family: "Concha" },
                    { given: "R.", family: "Assar" },
                    { given: "J. L.", family: "Alcazar" },
                  ],
                  "published-print": { "date-parts": [[2026, 9, 1]] },
                  "container-title": ["Ultrasound in Obstetrics & Gynecology"],
                  volume: "68",
                  issue: "3",
                  page: "426-433",
                  "is-referenced-by-count": 4,
                  URL: `https://doi.org/${crDoi}`,
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const crProvider = new CrossrefProvider();
      const crResults = await crProvider.search("adenomyosis morales");
      assert.ok(
        capturedCrossrefUrl.includes("volume,issue,page"),
        "Crossref query select list must request volume,issue,page"
      );
      assert.equal(crResults.length, 1);
      assert.equal(crResults[0].volume, "68");
      assert.equal(crResults[0].issue, "3");
      assert.equal(crResults[0].pages, "426-433");

      const crImport = await executePaperMetadataImport(crResults[0], testUser.id, {
        attemptFullTextFetch: false,
      });
      assert.equal(crImport.success, true);
      assert.ok(crImport.paperId);
      createdPaperIds.push(crImport.paperId!);

      const crStored = await prisma.paper.findUniqueOrThrow({
        where: { id: crImport.paperId! },
        include: { authors: { include: { author: true }, orderBy: { orderIndex: "asc" } } },
      });
      const crCsl = mapReferenceToCslJson(crStored);
      assert.equal(crCsl.volume, "68");
      assert.equal(crCsl.issue, "3");
      assert.equal(crCsl.page, "426-433");

      const crApa = formatApaEntry(crCsl);
      assert.ok(
        crApa.includes("68(3), 426–433."),
        `Expected Crossref imported APA citation to contain "68(3), 426–433.", got: ${crApa}`
      );

      // 10b. PubMedProvider -> executePaperMetadataImport -> DB readback -> APA 7th citation
      const pmDoi = `10.1002/uog.70315.pm.${ts}`;
      const pmPmid = `99${String(ts).slice(-6)}`;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("esearch.fcgi")) {
          return new Response(
            JSON.stringify({ esearchresult: { idlist: [pmPmid] } }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            result: {
              uids: [pmPmid],
              [pmPmid]: {
                uid: pmPmid,
                title: `Diagnostic accuracy of transvaginal ultrasound for adenomyosis using consensus-based direct and indirect sonographic signs: prospective cohort study [PM-${ts}].`,
                authors: [
                  { name: "Morales C" },
                  { name: "Crovo E" },
                  { name: "Ebner P" },
                  { name: "Joublan P" },
                  { name: "Concha P" },
                  { name: "Assar R" },
                  { name: "Alcazar JL" },
                ],
                pubdate: "2026 Sep",
                fulljournalname: "Ultrasound in Obstetrics & Gynecology",
                source: "Ultrasound Obstet Gynecol",
                volume: "68",
                issue: "3",
                pages: "426-433",
                articleids: [
                  { idtype: "pubmed", value: pmPmid },
                  { idtype: "doi", value: pmDoi },
                ],
                pubtype: ["Journal Article"],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const pmProvider = new PubMedProvider();
      const pmResults = await pmProvider.search("adenomyosis morales");
      assert.equal(pmResults.length, 1);
      assert.equal(pmResults[0].volume, "68");
      assert.equal(pmResults[0].issue, "3");
      assert.equal(pmResults[0].pages, "426-433");

      const pmImport = await executePaperMetadataImport(pmResults[0], testUser.id, {
        attemptFullTextFetch: false,
      });
      assert.equal(pmImport.success, true);
      assert.ok(pmImport.paperId);
      createdPaperIds.push(pmImport.paperId!);

      const pmStored = await prisma.paper.findUniqueOrThrow({
        where: { id: pmImport.paperId! },
        include: { authors: { include: { author: true }, orderBy: { orderIndex: "asc" } } },
      });
      const pmCsl = mapReferenceToCslJson(pmStored);
      assert.equal(pmCsl.volume, "68");
      assert.equal(pmCsl.issue, "3");
      assert.equal(pmCsl.page, "426-433");

      const pmApa = formatApaEntry(pmCsl);
      assert.ok(
        pmApa.includes("68(3), 426–433."),
        `Expected PubMed imported APA citation to contain "68(3), 426–433.", got: ${pmApa}`
      );

      // 10c. Source with no issue + repeated import with partial metadata
      const reimportDoi = "10.1002/uog.70315.local." + ts;
      const initialNoIssuePaper = {
        ...pmResults[0],
        externalId: `no-issue-${ts}`,
        doi: reimportDoi,
        pmid: `88${String(ts).slice(-6)}`,
        title: `Diagnostic accuracy of transvaginal ultrasound for adenomyosis using consensus-based direct and indirect sonographic signs: prospective cohort study [LOCAL-FIXTURE-${ts}]`,
        volume: "68",
        issue: undefined,
        pages: "426-433",
        publisher: "Wiley",
        rawProviderMetadata: {
          publisher: "Wiley",
          pubmed: {
            uid: `88${String(ts).slice(-6)}`,
            volume: "68",
            pages: "426-433",
          },
        },
      };

      const firstImport = await executePaperMetadataImport(initialNoIssuePaper, testUser.id, {
        attemptFullTextFetch: false,
      });
      assert.equal(firstImport.success, true);
      assert.equal(firstImport.isExisting, false);
      if (firstImport.paperId && !firstImport.isExisting) {
        createdPaperIds.push(firstImport.paperId);
      }

      const storedBefore = await prisma.paper.findUniqueOrThrow({
        where: { id: firstImport.paperId! },
        include: { authors: { include: { author: true }, orderBy: { orderIndex: "asc" } } },
      });
      const cslBefore = mapReferenceToCslJson(storedBefore);
      assert.equal(cslBefore.volume, "68");
      assert.equal(cslBefore.issue, undefined);
      assert.equal(cslBefore.page, "426-433");

      const apaBefore = formatApaEntry(cslBefore);
      assert.ok(
        apaBefore.includes("68, 426–433.") && !apaBefore.includes("68("),
        `Expected APA citation without issue to contain "68, 426–433.", got: ${apaBefore}`
      );

      // Re-import 1: supplies issue "3", omits pages -> enriches issue and preserves pages
      const partialWithIssue = {
        ...initialNoIssuePaper,
        sourceProvider: "CROSSREF" as const,
        sourceProviders: ["CROSSREF" as const],
        volume: "68",
        issue: "3",
        pages: undefined,
        rawProviderMetadata: {
          crossref: {
            volume: "68",
            issue: "3",
          },
        },
      };
      const secondImport = await executePaperMetadataImport(partialWithIssue, testUser.id, {
        attemptFullTextFetch: false,
      });
      assert.equal(secondImport.success, true);
      assert.equal(secondImport.isExisting, true);
      assert.equal(secondImport.paperId, firstImport.paperId);

      const storedAfterEnrich = await prisma.paper.findUniqueOrThrow({
        where: { id: firstImport.paperId! },
        include: { authors: { include: { author: true }, orderBy: { orderIndex: "asc" } } },
      });
      const cslAfterEnrich = mapReferenceToCslJson(storedAfterEnrich);
      assert.equal(cslAfterEnrich.volume, "68");
      assert.equal(cslAfterEnrich.issue, "3");
      assert.equal(cslAfterEnrich.page, "426-433");

      const apaAfterEnrich = formatApaEntry(cslAfterEnrich);
      assert.ok(
        apaAfterEnrich.includes("68(3), 426–433."),
        `Expected enriched APA citation to contain "68(3), 426–433.", got: ${apaAfterEnrich}`
      );

      console.log("\n[DISCOVERY FIXTURE BEFORE ENRICHMENT / NO ISSUE]:", apaBefore);
      console.log("[DISCOVERY FIXTURE AFTER PROVIDER ISSUE IMPORT ]:", apaAfterEnrich);

      // Re-import 2: omits volume, issue, and pages -> preserves all existing populated values
      const sparseReimport = {
        ...initialNoIssuePaper,
        volume: undefined,
        issue: undefined,
        pages: undefined,
        rawProviderMetadata: {
          pubmed: { uid: initialNoIssuePaper.pmid },
        },
      };
      const thirdImport = await executePaperMetadataImport(sparseReimport, testUser.id, {
        attemptFullTextFetch: false,
      });
      assert.equal(thirdImport.success, true);
      assert.equal(thirdImport.isExisting, true);

      const storedAfterSparse = await prisma.paper.findUniqueOrThrow({
        where: { id: firstImport.paperId! },
        include: { authors: { include: { author: true }, orderBy: { orderIndex: "asc" } } },
      });
      const cslAfterSparse = mapReferenceToCslJson(storedAfterSparse);
      assert.equal(cslAfterSparse.volume, "68");
      assert.equal(cslAfterSparse.issue, "3");
      assert.equal(cslAfterSparse.page, "426-433");

      // 10d. Production-path discovery re-import regression:
      // Fresh fixture with issue initially absent, then add issue 3 alongside blank incoming metadata
      // and verify nested fields and provider siblings survive.
      const freshFixtureDoi = `10.1002/uog.70315.fresh.${ts}`;
      const freshFixturePmid = `87${String(ts).slice(-6)}`;
      const freshInitialPaper = {
        ...initialNoIssuePaper,
        id: `fresh-fixture-${ts}`,
        title: `Diagnostic accuracy of transvaginal ultrasound for adenomyosis [FRESH-FIXTURE-${ts}]`,
        doi: freshFixtureDoi,
        pmid: freshFixturePmid,
        volume: "68",
        issue: undefined, // Fresh fixture with issue initially absent!
        pages: "426-433",
        publisher: "Wiley",
        sourceProviders: ["CROSSREF" as const, "PUBMED" as const],
        rawProviderMetadata: {
          publisher: "Wiley",
          crossref: {
            DOI: freshFixtureDoi,
            volume: "68",
            page: "426-433",
            prefix: "10.1002",
            publisher: "Wiley",
          },
          pubmed: {
            uid: freshFixturePmid,
            volume: "68",
            pages: "426-433",
            journal: "Ultrasound in Obstetrics & Gynecology",
          },
        },
      };

      const freshFirstImport = await executePaperMetadataImport(freshInitialPaper as any, testUser.id, {
        attemptFullTextFetch: false,
      });
      assert.equal(freshFirstImport.success, true);
      assert.equal(freshFirstImport.isExisting, false);
      if (freshFirstImport.paperId) {
        createdPaperIds.push(freshFirstImport.paperId);
      }

      const storedFreshInitial = await prisma.paper.findUniqueOrThrow({
        where: { id: freshFirstImport.paperId! },
      });
      const provFreshInitial = storedFreshInitial.sourceProvenance as any;
      assert.equal(provFreshInitial.volume, "68");
      assert.equal(provFreshInitial.issue, undefined, "Fresh fixture must have issue initially absent");
      assert.equal(provFreshInitial.pages, "426-433");
      assert.equal(provFreshInitial.publisher, "Wiley");

      // Now add issue "3" alongside blank incoming metadata
      const freshBlankIncomingReimport = {
        ...freshInitialPaper,
        volume: "", // Blank incoming volume
        pages: "   ", // Whitespace incoming pages
        issue: "3", // Enriched issue
        publisher: null, // Null incoming publisher
        rawProviderMetadata: {
          volume: "",
          pages: " ",
          publisher: null,
          crossref: {
            issue: "3", // Enriched issue
            volume: "", // Blank incoming nested volume
            page: "  ", // Blank incoming nested page
            publisher: "   ", // Blank incoming nested publisher
          },
        },
      };

      const freshBlankResult = await executePaperMetadataImport(freshBlankIncomingReimport as any, testUser.id, {
        attemptFullTextFetch: false,
      });
      assert.equal(freshBlankResult.success, true);
      assert.equal(freshBlankResult.isExisting, true);
      assert.equal(freshBlankResult.paperId, freshFirstImport.paperId);

      const storedAfterFreshBlank = await prisma.paper.findUniqueOrThrow({
        where: { id: freshFirstImport.paperId! },
        include: { authors: { include: { author: true }, orderBy: { orderIndex: "asc" } } },
      });

      const cslAfterFreshBlank = mapReferenceToCslJson(storedAfterFreshBlank);
      assert.equal(cslAfterFreshBlank.volume, "68", "Existing volume survives blank incoming value");
      assert.equal(cslAfterFreshBlank.issue, "3", "Missing issue enriched to 3");
      assert.equal(cslAfterFreshBlank.page, "426-433", "Existing pages survive blank incoming value");
      assert.equal(cslAfterFreshBlank.publisher, "Wiley", "Existing publisher survives blank incoming value");

      const provAfterFreshBlank = storedAfterFreshBlank.sourceProvenance as any;
      const rawAfterFreshBlank = provAfterFreshBlank.rawMetadata as any;

      // Assert top-level fields survive
      assert.equal(provAfterFreshBlank.volume, "68", "Top-level volume preserved");
      assert.equal(provAfterFreshBlank.issue, "3", "Top-level issue enriched");
      assert.equal(provAfterFreshBlank.pages, "426-433", "Top-level pages preserved");
      assert.equal(provAfterFreshBlank.publisher, "Wiley", "Top-level publisher preserved");
      assert.equal(rawAfterFreshBlank.publisher, "Wiley", "Top-level rawMetadata.publisher preserved");

      // Assert nested fields survive (crossref)
      assert.ok(rawAfterFreshBlank.crossref, "Nested crossref object exists");
      assert.equal(rawAfterFreshBlank.crossref.issue, "3", "Nested crossref.issue enriched");
      assert.equal(rawAfterFreshBlank.crossref.volume, "68", "Nested crossref.volume preserved across blank incoming value");
      assert.equal(rawAfterFreshBlank.crossref.page, "426-433", "Nested crossref.page preserved across blank incoming value");
      assert.equal(rawAfterFreshBlank.crossref.prefix, "10.1002", "Nested crossref.prefix preserved");
      assert.equal(rawAfterFreshBlank.crossref.publisher, "Wiley", "Nested crossref.publisher preserved across blank incoming value");

      // Assert provider siblings survive (pubmed)
      assert.ok(rawAfterFreshBlank.pubmed, "Provider sibling pubmed preserved");
      assert.equal(rawAfterFreshBlank.pubmed.uid, freshFixturePmid, "pubmed.uid preserved");
      assert.equal(rawAfterFreshBlank.pubmed.volume, "68", "pubmed.volume preserved");
      assert.equal(rawAfterFreshBlank.pubmed.pages, "426-433", "pubmed.pages preserved");
      assert.equal(rawAfterFreshBlank.pubmed.journal, "Ultrasound in Obstetrics & Gynecology", "pubmed.journal preserved");

      const apaAfterFreshBlank = formatApaEntry(cslAfterFreshBlank);
      assert.ok(
        apaAfterFreshBlank.includes("68(3), 426–433."),
        `Expected fresh re-imported APA citation to contain "68(3), 426–433.", got: ${apaAfterFreshBlank}`
      );

      // Deduplication merge check: partial Crossref + PubMed preserves non-empty fields from either
      const merged = mergePaperRecords(
        { ...initialNoIssuePaper, volume: "68", issue: undefined, pages: "426-433" },
        { ...partialWithIssue, volume: undefined, issue: "3", pages: undefined }
      );
      assert.equal(merged.volume, "68");
      assert.equal(merged.issue, "3");
      assert.equal(merged.pages, "426-433");
    } finally {
      globalThis.fetch = originalFetch;
      const uniqueIds = Array.from(new Set(createdPaperIds));
      if (uniqueIds.length > 0) {
        await prisma.bookmark.deleteMany({ where: { paperId: { in: uniqueIds } } });
        await prisma.paperAuthor.deleteMany({ where: { paperId: { in: uniqueIds } } });
        await prisma.paper.deleteMany({ where: { id: { in: uniqueIds } } });
      }
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
  });

  test("11. Identifier-Lookup import path (lookupPaperByIdentifier & importPaperByIdentifier): Crossref DOI, PubMed PMID, omitted issue, and re-import enrichment", async () => {
    await assertDisposableDatabaseMarker(prisma);
    const ts = Date.now();
    const testUser = await prisma.user.create({
      data: {
        email: `identifier-lookup-test-${ts}@test.local`,
        name: "Identifier Lookup Tester",
        role: "USER",
      },
    });

    const createdPaperIds = new Set<string>();
    const originalFetch = globalThis.fetch;

    try {
      // 11a. DOI lookup & import via importPaperByIdentifier (Crossref)
      const lookupDoi = `10.1002/uog.70315.idlookup.cr.${ts}`;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.crossref.org")) {
          return new Response(
            JSON.stringify({
              message: {
                items: [
                  {
                    DOI: lookupDoi,
                    title: [
                      `Diagnostic accuracy of transvaginal ultrasound for adenomyosis [IDLOOKUP-CR-${ts}]`,
                    ],
                    author: [
                      { given: "C.", family: "Morales" },
                      { given: "E.", family: "Crovo" },
                      { given: "P.", family: "Ebner" },
                      { given: "P.", family: "Joublan" },
                      { given: "P.", family: "Concha" },
                      { given: "R.", family: "Assar" },
                      { given: "J. L.", family: "Alcazar" },
                    ],
                    "published-print": { "date-parts": [[2026, 9, 1]] },
                    "container-title": ["Ultrasound in Obstetrics & Gynecology"],
                    volume: "68",
                    issue: "3",
                    page: "426-433",
                    "is-referenced-by-count": 4,
                    URL: `https://doi.org/${lookupDoi}`,
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const crIdLookup = await lookupPaperByIdentifier(lookupDoi);
      assert.equal(crIdLookup.success, true);
      assert.equal(crIdLookup.metadata?.volume, "68");
      assert.equal(crIdLookup.metadata?.issue, "3");
      assert.equal(crIdLookup.metadata?.pages, "426-433");

      const crIdImport = await importPaperByIdentifier({
        userId: testUser.id,
        identifier: lookupDoi,
        attemptFullTextAcquisition: false,
      });
      assert.equal(crIdImport.success, true);
      assert.equal(crIdImport.isDuplicate, false);
      createdPaperIds.add(crIdImport.paperId);

      const crIdStored = await prisma.paper.findUniqueOrThrow({
        where: { id: crIdImport.paperId },
        include: { authors: { include: { author: true }, orderBy: { orderIndex: "asc" } } },
      });
      const crIdCsl = mapReferenceToCslJson(crIdStored);
      assert.equal(crIdCsl.volume, "68");
      assert.equal(crIdCsl.issue, "3");
      assert.equal(crIdCsl.page, "426-433");
      const crIdApa = formatApaEntry(crIdCsl);
      assert.ok(
        crIdApa.includes("68(3), 426–433."),
        `Expected Identifier-Lookup Crossref APA citation to contain "68(3), 426–433.", got: ${crIdApa}`
      );

      // 11b. PMID lookup & import via importPaperByIdentifier (PubMed)
      const lookupPmid = `97${String(ts).slice(-6)}`;
      const lookupPmDoi = `10.1002/uog.70315.idlookup.pm.${ts}`;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("esearch.fcgi")) {
          return new Response(
            JSON.stringify({ esearchresult: { idlist: [lookupPmid] } }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (url.includes("esummary.fcgi")) {
          return new Response(
            JSON.stringify({
              result: {
                uids: [lookupPmid],
                [lookupPmid]: {
                  uid: lookupPmid,
                  title: `Diagnostic accuracy of transvaginal ultrasound for adenomyosis [IDLOOKUP-PM-${ts}].`,
                  authors: [
                    { name: "Morales C" },
                    { name: "Crovo E" },
                    { name: "Ebner P" },
                    { name: "Joublan P" },
                    { name: "Concha P" },
                    { name: "Assar R" },
                    { name: "Alcazar JL" },
                  ],
                  pubdate: "2026 Sep",
                  fulljournalname: "Ultrasound in Obstetrics & Gynecology",
                  source: "Ultrasound Obstet Gynecol",
                  volume: "68",
                  issue: "3",
                  pages: "426-433",
                  articleids: [
                    { idtype: "pubmed", value: lookupPmid },
                    { idtype: "doi", value: lookupPmDoi },
                  ],
                  pubtype: ["Journal Article"],
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const pmIdImport = await importPaperByIdentifier({
        userId: testUser.id,
        identifier: `PMID:${lookupPmid}`,
        attemptFullTextAcquisition: false,
      });
      assert.equal(pmIdImport.success, true);
      assert.equal(pmIdImport.isDuplicate, false);
      createdPaperIds.add(pmIdImport.paperId);

      const pmIdStored = await prisma.paper.findUniqueOrThrow({
        where: { id: pmIdImport.paperId },
        include: { authors: { include: { author: true }, orderBy: { orderIndex: "asc" } } },
      });
      const pmIdCsl = mapReferenceToCslJson(pmIdStored);
      assert.equal(pmIdCsl.volume, "68");
      assert.equal(pmIdCsl.issue, "3");
      assert.equal(pmIdCsl.page, "426-433");
      const pmIdApa = formatApaEntry(pmIdCsl);
      assert.ok(
        pmIdApa.includes("68(3), 426–433."),
        `Expected Identifier-Lookup PubMed APA citation to contain "68(3), 426–433.", got: ${pmIdApa}`
      );

      // 11c. Identifier-Lookup with omitted issue -> re-import enriches issue -> sparse re-import preserves issue
      const enrichLookupDoi = `10.1002/uog.70315.idlookup.reimport.${ts}`;
      let providerPhase: "no-issue" | "with-issue" | "sparse" = "no-issue";

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("api.crossref.org")) {
          const item: Record<string, any> = {
            DOI: enrichLookupDoi,
            title: [
              `Diagnostic accuracy of transvaginal ultrasound for adenomyosis [IDLOOKUP-REIMPORT-${ts}]`,
            ],
            author: [{ given: "C.", family: "Morales" }],
            "published-print": { "date-parts": [[2026, 9, 1]] },
            "container-title": ["Ultrasound in Obstetrics & Gynecology"],
          };
          if (providerPhase === "no-issue") {
            item.volume = "68";
            item.page = "426-433";
          } else if (providerPhase === "with-issue") {
            item.volume = "68";
            item.issue = "3";
          }
          return new Response(JSON.stringify({ message: { items: [item] } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;

      const idFirst = await importPaperByIdentifier({
        userId: testUser.id,
        identifier: enrichLookupDoi,
        attemptFullTextAcquisition: false,
      });
      createdPaperIds.add(idFirst.paperId);

      const idBeforePaper = await prisma.paper.findUniqueOrThrow({
        where: { id: idFirst.paperId },
        include: { authors: { include: { author: true }, orderBy: { orderIndex: "asc" } } },
      });
      const idBeforeApa = formatApaEntry(mapReferenceToCslJson(idBeforePaper));
      assert.ok(
        idBeforeApa.includes("68, 426–433.") && !idBeforeApa.includes("68("),
        `Expected Identifier-Lookup no-issue APA citation to contain "68, 426–433.", got: ${idBeforeApa}`
      );

      // Re-import when provider supplies issue "3" and omits pages
      providerPhase = "with-issue";
      const idSecond = await importPaperByIdentifier({
        userId: testUser.id,
        identifier: enrichLookupDoi,
        attemptFullTextAcquisition: false,
      });
      assert.equal(idSecond.paperId, idFirst.paperId);
      assert.equal(idSecond.isDuplicate, true);

      const idAfterEnrichPaper = await prisma.paper.findUniqueOrThrow({
        where: { id: idFirst.paperId },
        include: { authors: { include: { author: true }, orderBy: { orderIndex: "asc" } } },
      });
      const idAfterEnrichCsl = mapReferenceToCslJson(idAfterEnrichPaper);
      assert.equal(idAfterEnrichCsl.volume, "68");
      assert.equal(idAfterEnrichCsl.issue, "3");
      assert.equal(idAfterEnrichCsl.page, "426-433");
      const idAfterEnrichApa = formatApaEntry(idAfterEnrichCsl);
      assert.ok(
        idAfterEnrichApa.includes("68(3), 426–433."),
        `Expected Identifier-Lookup enriched APA citation to contain "68(3), 426–433.", got: ${idAfterEnrichApa}`
      );

      // Sparse re-import when provider omits volume, issue, and pages -> preserves existing
      providerPhase = "sparse";
      await importPaperByIdentifier({
        userId: testUser.id,
        identifier: enrichLookupDoi,
        attemptFullTextAcquisition: false,
      });
      const idAfterSparsePaper = await prisma.paper.findUniqueOrThrow({
        where: { id: idFirst.paperId },
        include: { authors: { include: { author: true }, orderBy: { orderIndex: "asc" } } },
      });
      const idAfterSparseCsl = mapReferenceToCslJson(idAfterSparsePaper);
      assert.equal(idAfterSparseCsl.volume, "68");
      assert.equal(idAfterSparseCsl.issue, "3");
      assert.equal(idAfterSparseCsl.page, "426-433");
    } finally {
      globalThis.fetch = originalFetch;
      const ids = Array.from(createdPaperIds);
      if (ids.length > 0) {
        await prisma.bookmark.deleteMany({ where: { paperId: { in: ids } } });
        await prisma.paperAuthor.deleteMany({ where: { paperId: { in: ids } } });
        await prisma.paper.deleteMany({ where: { id: { in: ids } } });
      }
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
  });

  test("12. Same-title / different-DOI collision & cleanup preservation regression", async () => {
    await assertDisposableDatabaseMarker(prisma);
    const ts = Date.now();
    const testUser = await prisma.user.create({
      data: {
        email: `collision-guard-mapper-${ts}@test.local`,
        name: "Collision Guard Tester",
        role: "USER",
      },
    });

    const createdPaperIds = new Set<string>();
    const createdDocIds = new Set<string>();

    try {
      const sharedTitle = `Diagnostic accuracy of transvaginal ultrasound for adenomyosis cohort study [Mapper-Guard-${ts}]`;
      const existingDoi = `10.1002/uog.existing.${ts}`;
      const testFixtureDoi = `10.1002/uog.fixture.${ts}`;

      const existingPaper = await prisma.paper.create({
        data: {
          title: sharedTitle,
          abstract: "Existing baseline paper with citation links.",
          journal: "Ultrasound in Obstetrics & Gynecology",
          doi: existingDoi,
          status: "COMPLETED",
          isOpenAccess: true,
          sourceProvenance: {
            volume: "68",
            pages: "426-433",
          },
        },
      });
      createdPaperIds.add(existingPaper.id);

      const doc = await prisma.researchDocument.create({
        data: {
          userId: testUser.id,
          title: `Manuscript Linking Existing Paper ${ts}`,
          cslStyleId: "apa",
          content: { type: "doc", content: [] },
        },
      });
      createdDocIds.add(doc.id);

      await prisma.documentPaper.create({
        data: {
          documentId: doc.id,
          paperId: existingPaper.id,
        },
      });

      await prisma.documentCitation.create({
        data: {
          documentId: doc.id,
          paperId: existingPaper.id,
          citationKey: `csl-mapper-guard-${ts}`,
          citationText: "(Morales et al., 2026, p. 5)",
          pageNumber: 5,
        },
      });

      const fixtureImport = await executePaperMetadataImport(
        {
          id: `doi:${testFixtureDoi}`,
          title: sharedTitle,
          abstract: "Test fixture with identical title and different DOI.",
          authors: [{ name: "C. Morales" }],
          journal: "Ultrasound in Obstetrics & Gynecology",
          year: 2026,
          doi: testFixtureDoi,
          volume: "68",
          issue: "3",
          pages: "426-433",
          sourceProviders: ["CROSSREF"],
          isOpenAccess: false,
          fullTextAvailability: "METADATA_ONLY",
        },
        testUser.id,
        { attemptFullTextFetch: false }
      );

      assert.equal(fixtureImport.success, true);
      assert.equal(fixtureImport.isExisting, false);
      assert.ok(fixtureImport.paperId);
      assert.notEqual(fixtureImport.paperId, existingPaper.id);

      // Clean up the newly imported fixture paper
      await prisma.bookmark.deleteMany({ where: { paperId: fixtureImport.paperId! } });
      await prisma.paperAuthor.deleteMany({ where: { paperId: fixtureImport.paperId! } });
      await prisma.paper.delete({ where: { id: fixtureImport.paperId! } });

      // Assert the existing paper and its citation links remain intact
      const verifyExisting = await prisma.paper.findUnique({
        where: { id: existingPaper.id },
        include: {
          documentCitations: { where: { documentId: doc.id } },
          documentPapers: { where: { documentId: doc.id } },
        },
      });
      assert.ok(verifyExisting, "Existing paper must remain intact after fixture cleanup");
      assert.equal(verifyExisting!.doi, existingDoi);
      assert.equal((verifyExisting!.sourceProvenance as any)?.issue, undefined);
      assert.equal(verifyExisting!.documentCitations.length, 1);
      assert.equal(verifyExisting!.documentPapers.length, 1);
    } finally {
      const docIds = Array.from(createdDocIds);
      if (docIds.length > 0) {
        await prisma.documentCitation.deleteMany({ where: { documentId: { in: docIds } } });
        await prisma.documentPaper.deleteMany({ where: { documentId: { in: docIds } } });
        await prisma.researchDocument.deleteMany({ where: { id: { in: docIds } } });
      }
      const paperIds = Array.from(createdPaperIds);
      if (paperIds.length > 0) {
        await prisma.bookmark.deleteMany({ where: { paperId: { in: paperIds } } });
        await prisma.paperAuthor.deleteMany({ where: { paperId: { in: paperIds } } });
        await prisma.paper.deleteMany({ where: { id: { in: paperIds } } });
      }
      await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
    }
  });
});
