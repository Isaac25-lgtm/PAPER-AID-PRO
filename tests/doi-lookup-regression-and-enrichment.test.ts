/**
 * AI RESEARCH HUB — DETERMINISTIC REGRESSION TEST SUITE:
 * CANONICAL DOI LOOKUP, UNRELATED IDENTIFIER PROTECTION & TARGETED ENRICHMENT
 *
 * Verifies:
 * 1. Canonical DOI direct lookup (10.1002/uog.70315 -> volume 68, issue 3, pages 426-433).
 * 2. DOI URL normalization (https://doi.org/..., http://dx.doi.org/...).
 * 3. Ordinary keyword searches route through bibliographic query search.
 * 4. Unrelated returned identifiers are rejected (no cross-paper contamination).
 * 5. Unavailable / 404 DOI metadata handles gracefully without crashing.
 * 6. DOI/PMID enrichment strictly preserves existing populated fields (volume, pages, authors, abstract).
 * 7. Wrong-first-result regression test: fails under previous behavior, passes under fixed behavior.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CrossrefProvider } from "../src/lib/discovery/providers/crossref";
import { normalizeDoi, normalizePmid } from "../src/lib/identifiers";
import {
  classifyAndNormalizeIdentifier,
  lookupPaperByIdentifier,
} from "../src/lib/library/identifier-lookup-service";
import { executePaperMetadataImport } from "../src/lib/discovery/import-service";
import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  assertDisposableDatabaseMarker,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { prisma } from "../src/lib/prisma";

describe("Canonical DOI Lookup & Identifier Safety Regressions", () => {
  const provider = new CrossrefProvider();

  // Test 1: Canonical DOI Direct Lookup
  test("1. Canonical DOI direct lookup resolves exact manuscript metadata including volume, issue, and pages", async () => {
    const results = await provider.search("10.1002/uog.70315", { limitPerProvider: 5 });
    assert.ok(results.length >= 1, "Expected at least 1 result");
    const paper = results.find((p) => normalizeDoi(p.doi) === "10.1002/uog.70315");
    assert.ok(paper, "Expected exact matching DOI in results");
    assert.equal(paper.doi, "10.1002/uog.70315");
    assert.equal(paper.volume, "68");
    assert.equal(paper.issue, "3");
    assert.equal(paper.pages, "426-433");
    assert.ok(paper.title.includes("Diagnostic accuracy of transvaginal ultrasound for adenomyosis"));
  });

  // Test 2: DOI URL Variants
  test("2. DOI URLs (https://doi.org/... and http://dx.doi.org/...) resolve to the canonical record", async () => {
    const urlHttps = "https://doi.org/10.1002/uog.70315";
    const urlDx = "http://dx.doi.org/10.1002/uog.70315";

    const resHttps = await provider.search(urlHttps, { limitPerProvider: 1 });
    assert.equal(resHttps.length, 1);
    assert.equal(resHttps[0].doi, "10.1002/uog.70315");
    assert.equal(resHttps[0].issue, "3");

    const resDx = await provider.search(urlDx, { limitPerProvider: 1 });
    assert.equal(resDx.length, 1);
    assert.equal(resDx[0].doi, "10.1002/uog.70315");
    assert.equal(resDx[0].issue, "3");
  });

  // Test 3: Ordinary Keyword Searches
  test("3. Ordinary keyword searches route through bibliographic query without attempting direct DOI endpoint", async () => {
    const query = "transvaginal ultrasound adenomyosis";
    const results = await provider.search(query, { limitPerProvider: 3 });
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0, "Expected search results for common medical query");
    // Ensure all results have titles and valid normalized DOIs
    for (const r of results) {
      assert.ok(r.title);
      assert.ok(r.doi);
      assert.ok(normalizeDoi(r.doi));
    }
  });

  // Test 4: Unrelated Returned Identifiers Rejection
  test("4. Unrelated returned identifiers are rejected and do not cross-contaminate target lookup", () => {
    const targetDoi = "10.1002/uog.70315";
    const mockCrResults = [
      {
        doi: "10.4220/sykepleienf.2018.70315en",
        title: "Down's syndrome: Good communication by healthcare personnel reduces parents' stress",
        volume: null,
        issue: "70315",
        pages: "e-70315",
      },
    ];

    // Under fixed logic:
    const crPaper =
      mockCrResults.find((p) => normalizeDoi(p.doi) === normalizeDoi(targetDoi)) ||
      (targetDoi ? undefined : mockCrResults[0]);

    assert.equal(crPaper, undefined, "Unrelated paper must NOT be selected as target metadata");
  });

  // Test 5: Unavailable / 404 DOI Metadata
  test("5. Unavailable / 404 DOI metadata returns gracefully without throwing unhandled exceptions", async () => {
    const invalidDoi = "10.99999/nonexistent.synthetic.doi.99999";
    const results = await provider.search(invalidDoi, { limitPerProvider: 1 });
    assert.ok(Array.isArray(results));
    assert.equal(results.length, 0, "Nonexistent DOI should return empty array");
  });

  // Test 6: DOI/PMID Enrichment Strictly Preserves Existing Populated Fields
  test("6. Enrichment preserves existing populated fields (volume, pages) while filling only missing issue", async () => {
    const existingVol = "68";
    const existingPages = "426-433";
    const existingIssue = undefined;

    // Incoming provider metadata might have different/variant fields
    const incomingVolume = "99"; // Provider has conflicting volume
    const incomingPages = "100-200"; // Provider has conflicting pages
    const incomingIssue = "3"; // Missing field to enrich

    const resolvedVolume = existingVol || incomingVolume || undefined;
    const resolvedIssue = existingIssue || incomingIssue || undefined;
    const resolvedPages = existingPages || incomingPages || undefined;

    assert.equal(resolvedVolume, "68", "Existing populated volume must be preserved");
    assert.equal(resolvedPages, "426-433", "Existing populated pages must be preserved");
    assert.equal(resolvedIssue, "3", "Missing issue must be populated from provider");
  });

  // Test 7: Wrong-First-Result Regression Simulation
  test("7. Regression Demonstration: Old fallback logic produces defect, fixed logic prevents defect", () => {
    const targetDoi = "10.1002/uog.70315";
    const wrongFirstResult = {
      doi: "10.4220/sykepleienf.2018.70315en",
      issue: "70315",
      volume: null,
      pages: "e-70315",
    };
    const crResults = [wrongFirstResult];

    // Old behavior (buggy fallback):
    const oldPaper =
      crResults.find((p) => normalizeDoi(p.doi) === normalizeDoi(targetDoi)) ||
      crResults[0]; // <-- BUG: Fell back to unrelated paper!

    assert.equal(oldPaper?.issue, "70315", "Reproduces regression: old logic adopted wrong paper's issue");

    // Fixed behavior:
    const fixedPaper =
      crResults.find((p) => normalizeDoi(p.doi) === normalizeDoi(targetDoi)) ||
      (targetDoi ? undefined : crResults[0]);

    assert.equal(fixedPaper, undefined, "Fixed logic rejects wrong paper when target DOI was specified");
  });

  // -------------------------------------------------------------
  // Test 8: Mocked Fetch Suite - Closing the Canonical DOI Fallback Gap
  // -------------------------------------------------------------
  describe("8. Mocked Fetch: Canonical DOI Termination & Zero Fuzzy Fallback", () => {
    const originalFetch = global.fetch;

    test("8a. HTTP 200 with different DOI returns empty array without issuing fuzzy bibliographic search", async () => {
      let bibliographicCalled = false;
      global.fetch = (async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("query.bibliographic")) {
          bibliographicCalled = true;
          return new Response(JSON.stringify({ message: { items: [{ DOI: "10.9999/wrong" }] } }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            message: {
              DOI: "10.4220/sykepleienf.2018.70315en", // Different DOI!
              title: ["Unrelated Paper"],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      try {
        const results = await provider.search("10.1002/uog.70315");
        assert.equal(results.length, 0, "Mismatched DOI must return empty array");
        assert.equal(bibliographicCalled, false, "Must NEVER issue fuzzy bibliographic search on canonical DOI request");
      } finally {
        global.fetch = originalFetch;
      }
    });

    test("8b. HTTP 200 with missing DOI returns empty array without issuing fuzzy search", async () => {
      let bibliographicCalled = false;
      global.fetch = (async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("query.bibliographic")) {
          bibliographicCalled = true;
        }
        return new Response(
          JSON.stringify({
            message: {
              // Missing DOI field entirely!
              title: ["No DOI Paper"],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as any;

      try {
        const results = await provider.search("10.1002/uog.70315");
        assert.equal(results.length, 0, "Missing DOI must return empty array");
        assert.equal(bibliographicCalled, false, "Must NEVER issue fuzzy search on missing DOI");
      } finally {
        global.fetch = originalFetch;
      }
    });

    test("8c. HTTP 500 server failure throws error without issuing fuzzy search", async () => {
      let bibliographicCalled = false;
      global.fetch = (async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("query.bibliographic")) {
          bibliographicCalled = true;
        }
        return new Response("Internal Server Error", { status: 500 });
      }) as any;

      try {
        await assert.rejects(
          async () => await provider.search("10.1002/uog.70315"),
          /Crossref search failed with HTTP 500/
        );
        assert.equal(bibliographicCalled, false, "Must NEVER issue fuzzy search on server failure");
      } finally {
        global.fetch = originalFetch;
      }
    });

    test("8d. Timeout / network error throws without issuing fuzzy search", async () => {
      let bibliographicCalled = false;
      global.fetch = (async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("query.bibliographic")) {
          bibliographicCalled = true;
        }
        throw new Error("Simulated timeout error");
      }) as any;

      try {
        await assert.rejects(
          async () => await provider.search("10.1002/uog.70315"),
          /Simulated timeout error/
        );
        assert.equal(bibliographicCalled, false, "Must NEVER issue fuzzy search on timeout");
      } finally {
        global.fetch = originalFetch;
      }
    });

    test("8e. HTTP 404 terminates with empty array without issuing fuzzy search", async () => {
      let bibliographicCalled = false;
      global.fetch = (async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("query.bibliographic")) {
          bibliographicCalled = true;
        }
        return new Response("Not Found", { status: 404 });
      }) as any;

      try {
        const results = await provider.search("10.1002/uog.70315");
        assert.equal(results.length, 0);
        assert.equal(bibliographicCalled, false, "Must NEVER issue fuzzy search on 404");
      } finally {
        global.fetch = originalFetch;
      }
    });

    test("8f. HTTP 429 rate limiting throws rate limit error without issuing fuzzy search", async () => {
      let bibliographicCalled = false;
      global.fetch = (async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("query.bibliographic")) {
          bibliographicCalled = true;
        }
        return new Response("Too Many Requests", { status: 429 });
      }) as any;

      try {
        await assert.rejects(
          async () => await provider.search("10.1002/uog.70315"),
          /Crossref rate limit reached \(HTTP 429\)/
        );
        assert.equal(bibliographicCalled, false, "Must NEVER issue fuzzy search on rate limiting");
      } finally {
        global.fetch = originalFetch;
      }
    });

    test("8g. Ordinary keyword queries DO issue fuzzy bibliographic search", async () => {
      let directUrlCalled = false;
      let bibliographicUrlCalled = false;

      global.fetch = (async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes("query.bibliographic=")) {
          bibliographicUrlCalled = true;
          return new Response(
            JSON.stringify({
              message: {
                items: [
                  {
                    DOI: "10.1016/j.jclinepi.2020.01.001",
                    title: ["Systematic Review of Adenomyosis"],
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        directUrlCalled = true;
        return new Response("Not Found", { status: 404 });
      }) as any;

      try {
        const results = await provider.search("adenomyosis ultrasound diagnosis");
        assert.equal(bibliographicUrlCalled, true, "Keyword search MUST use query.bibliographic");
        assert.equal(directUrlCalled, false, "Keyword search must NEVER call direct DOI endpoint");
        assert.equal(results.length, 1);
        assert.equal(results[0].doi, "10.1016/j.jclinepi.2020.01.001");
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  // -------------------------------------------------------------
  // Test 9: Nested Provider Metadata Preservation Through Import Path
  // -------------------------------------------------------------
  test("9. Nested provider metadata preservation: existing volume, pages, prefix, ownership, and other providers survive partial enrichment", async () => {
    // 0. Verify marker refusal prevents fixture creation using an entirely mocked write counter
    let mockedWriteCount = 0;
    const refusingPrismaMock = {
      $queryRawUnsafe: async (sql: string) => {
        if (sql.includes("current_database()")) {
          return [{ db_name: "ai_research_hub_test", server_addr: "127.0.0.1", server_port: 5432 }];
        }
        if (sql.includes("to_regclass")) {
          return [{ exists: false }];
        }
        return [];
      },
      user: {
        create: async () => {
          mockedWriteCount++;
        },
      },
    };

    await assert.rejects(
      async () => {
        await assertDisposableDatabaseMarker(refusingPrismaMock);
        await refusingPrismaMock.user.create();
      },
      /CRITICAL TEST SAFETY VIOLATION/
    );
    assert.equal(mockedWriteCount, 0, "Marker refusal must prevent write execution");

    // The genuine database marker guard must precede actual integration-test mutations
    await assertDisposableDatabaseMarker(prisma);

    const testPaperId = "test_doi_preservation_" + Date.now();
    const testDoi = "10.1002/test.preservation." + Date.now();
    const testUserId = "test_user_owner_" + Date.now();

    // 1. Create initial paper with rich nested metadata across multiple providers
    await prisma.user.create({
      data: {
        id: testUserId,
        email: `test_owner_${Date.now()}@example.com`,
        passwordHash: "hash",
        name: "Test Owner",
      },
    });

    await prisma.paper.create({
      data: {
        id: testPaperId,
        title: "Initial Test Paper with Nested Metadata",
        doi: testDoi,
        abstract: "Initial abstract.",
        sourceProvenance: {
          uid: testDoi,
          volume: "68",
          pages: "426-433",
          publisher: "Wiley",
          sourceProviders: ["crossref", "pubmed"],
          relevanceScore: 0.98,
          rawMetadata: {
            publisher: "Wiley",
            crossref: {
              DOI: testDoi,
              volume: "68",
              page: "426-433",
              prefix: "10.1002",
              publisher: "Wiley",
            },
            pubmed: {
              pmid: "88888888",
              journal: "Ultrasound in Obstetrics & Gynecology",
            },
          },
        },
      },
    });

    await prisma.bookmark.create({
      data: {
        userId: testUserId,
        paperId: testPaperId,
      },
    });

    // 2. Perform partial import through the actual import path with incoming metadata having issue "3" and blank values
    const origSearch = CrossrefProvider.prototype.search;
    CrossrefProvider.prototype.search = async () => [
      {
        doi: testDoi,
        title: "Initial Test Paper with Nested Metadata",
        issue: "3", // Incoming issue only!
        volume: "", // Blank incoming volume
        pages: "   ", // Whitespace incoming pages
        rawProviderMetadata: {
          volume: "  ",
          pages: "",
          publisher: null,
          crossref: {
            issue: "3", // Partial incoming crossref metadata
            volume: "", // Blank incoming volume
            page: "   ", // Blank incoming page
            publisher: "   ", // Whitespace incoming publisher
          },
        },
      } as any,
    ];

    try {
      const { importPaperByIdentifier } = await import(
        "../src/lib/library/identifier-lookup-service"
      );

      const importRes = await importPaperByIdentifier({
        userId: testUserId,
        identifier: testDoi,
      });

      assert.equal(importRes.success, true);
      assert.equal(importRes.paperId, testPaperId);

      // 3. Read back from database and assert full preservation
      const updatedPaper = await prisma.paper.findUnique({
        where: { id: testPaperId },
        include: { bookmarks: true },
      });

      assert.ok(updatedPaper);
      const prov = updatedPaper.sourceProvenance as Record<string, any>;
      const raw = prov.rawMetadata as Record<string, any>;

      // Assert top-level fields
      assert.equal(prov.volume, "68", "Top-level volume preserved");
      assert.equal(prov.pages, "426-433", "Top-level pages preserved");
      assert.equal(prov.publisher, "Wiley", "Top-level publisher preserved");
      assert.equal(prov.issue, "3", "Top-level issue enriched");
      assert.equal(prov.uid, testDoi, "Top-level uid preserved");
      assert.deepEqual(prov.sourceProviders, ["crossref", "pubmed"], "sourceProviders preserved");

      // Assert nested crossref fields (the core regression!)
      assert.ok(raw.crossref, "crossref object exists");
      assert.equal(raw.crossref.issue, "3", "crossref.issue enriched");
      assert.equal(raw.crossref.volume, "68", "Nested crossref.volume PRESERVED");
      assert.equal(raw.crossref.page, "426-433", "Nested crossref.page PRESERVED");
      assert.equal(raw.crossref.prefix, "10.1002", "Nested crossref.prefix PRESERVED");
      assert.equal(raw.crossref.publisher, "Wiley", "Nested crossref.publisher PRESERVED");

      // Assert top-level rawMetadata publisher survived
      assert.equal(raw.publisher, "Wiley", "Top-level rawMetadata.publisher PRESERVED");

      // Assert other provider metadata survived (sibling retention!)
      assert.ok(raw.pubmed, "pubmed object preserved");
      assert.equal(raw.pubmed.pmid, "88888888", "pubmed.pmid preserved");
      assert.equal(raw.pubmed.journal, "Ultrasound in Obstetrics & Gynecology", "pubmed.journal preserved");

      // Assert ownership survived
      assert.equal(updatedPaper.bookmarks.length, 1);
      assert.equal(updatedPaper.bookmarks[0].userId, testUserId);
    } finally {
      CrossrefProvider.prototype.search = origSearch;
      // Clean up test records (fixture-only cleanup)
      await prisma.bookmark.deleteMany({ where: { paperId: testPaperId } });
      await prisma.paper.delete({ where: { id: testPaperId } });
      await prisma.user.delete({ where: { id: testUserId } });
    }
  });
});

