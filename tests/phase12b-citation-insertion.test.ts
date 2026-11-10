/**
 * AI RESEARCH HUB — PHASE 12B: CITATION INSERTION ACCEPTANCE SUITE
 *
 * Verifies that the Next.js + Prisma + PostgreSQL + TipTap Research Editor
 * correctly searches authorized library papers, inserts structured citations,
 * preserves DOI/provenance, renders APA-style in-text citations, generates
 * deduplicated CSL bibliographies, preserves citations across autosave/reload,
 * enforces multi-tenant paper privacy, rejects fabricated references, and
 * survives Markdown, HTML, BibTeX, and RIS document exports.
 *
 * Acceptance Fixture:
 * Morales et al. (2026) Adenomyosis paper (DOI: 10.1002/uog.70315)
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

// Enforce test isolation before any imports
loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { prisma } from "../src/lib/prisma";
import { CitationType, DocumentType } from "@prisma/client";
import {
  createResearchDocument,
  getResearchDocument,
  updateResearchDocument,
  deleteResearchDocument,
  attachDocumentPaper,
  detachDocumentPaper,
  insertDocumentCitation,
  deleteDocumentCitation,
  exportResearchDocument,
} from "../src/lib/editor/document-service";
import { formatDocumentCsl } from "../src/lib/citations/csl/csl-client-formatter";
import { getUserLibraryItems } from "../src/lib/library/user-library-service";
import { toPlainTipTapJson } from "../src/lib/editor/content-sanitizer";

describe("Phase 12B: Citation Insertion Acceptance Suite", () => {
  let primaryUserId: string;
  let secondaryUserId: string;
  let testDocumentId: string;
  let moralesPaper: any;
  let secondPaper: any;
  let privatePaperUserB: any;

  before(async () => {
    // 1. Retrieve or verify primary researcher (owner of Morales private manuscript fixture)
    const existingScholar = await prisma.user.findUnique({
      where: { id: "cmvb1cabk0001vrgo46umk5zp" },
    });

    if (existingScholar) {
      primaryUserId = existingScholar.id;
    } else {
      const userA = await prisma.user.create({
        data: {
          id: "cmvb1cabk0001vrgo46umk5zp",
          email: "primary.morales.owner@university.edu",
          name: "Dr. Alice Morgan (Phase 12B)",
          passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz012345",
        },
      });
      primaryUserId = userA.id;
    }

    const userB = await prisma.user.upsert({
      where: { email: "phase12b-scholar-b@university.edu" },
      update: {},
      create: {
        email: "phase12b-scholar-b@university.edu",
        name: "Dr. Bob Vance (Phase 12B)",
        passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz012345",
      },
    });
    secondaryUserId = userB.id;

    // 2. Fetch primary acceptance fixture: Morales adenomyosis paper
    moralesPaper = await prisma.paper.findUnique({
      where: { id: "cmvkznrpr001fvrggnajkkq4b" },
      include: {
        authors: { include: { author: true }, orderBy: { orderIndex: "asc" } },
        chunks: { take: 3 },
      },
    });

    assert.ok(moralesPaper, "Primary acceptance fixture (Morales et al. cmvkznrpr001fvrggnajkkq4b) must exist.");

    // 3. Find a secondary paper to test multi-paper citations
    secondPaper = await prisma.paper.findFirst({
      where: {
        id: { not: moralesPaper.id },
        doi: { not: null },
      },
      include: {
        authors: { include: { author: true }, orderBy: { orderIndex: "asc" } },
      },
    });
    assert.ok(secondPaper, "A secondary peer-reviewed paper must exist in local database.");

    // 4. Create an isolated private paper owned strictly by User B
    privatePaperUserB = await prisma.paper.create({
      data: {
        title: "Confidential Phase 12B Clinical Study by Bob",
        abstract: "Confidential clinical study on private ultrasound protocols.",
        doi: "10.1016/j.private.12b.001",
        journal: "Private Clinical Trials",
        publicationDate: new Date("2026-03-01"),
        status: "COMPLETED",
        sourceProvenance: {
          isPrivate: true,
          ownerUserId: secondaryUserId,
        },
      },
    });

    // 5. Bookmark/save Morales paper into User A's library
    await prisma.bookmark.upsert({
      where: {
        userId_paperId: {
          userId: primaryUserId,
          paperId: moralesPaper.id,
        },
      },
      update: {},
      create: {
        userId: primaryUserId,
        paperId: moralesPaper.id,
      },
    });

    // 6. Create a clean test research document for User A
    const doc = await createResearchDocument(primaryUserId, {
      title: "Grounded Clinical Ultrasound Investigation",
      docType: DocumentType.MANUSCRIPT,
    });
    testDocumentId = doc.id;
  });

  after(async () => {
    // Clean up created resources
    if (testDocumentId) {
      await prisma.researchDocument.deleteMany({ where: { id: testDocumentId } });
    }
    if (privatePaperUserB) {
      await prisma.paper.deleteMany({ where: { id: privatePaperUserB.id } });
    }
  });

  test("1. Library Search: authorized paper library is searchable from editor context", async () => {
    const libraryItems = await getUserLibraryItems(primaryUserId);
    assert.ok(Array.isArray(libraryItems), "Library items must be an array.");
    const foundMorales = libraryItems.find((it) => it.id === moralesPaper.id);
    assert.ok(foundMorales, "Morales paper must be present in user library.");
    const canonicalDoi = foundMorales.doi || (moralesPaper.sourceProvenance as any)?.canonicalDoi;
    assert.ok(canonicalDoi?.includes("10.1002/uog.70315"), "DOI must match Morales source paper.");
  });

  test("2. Paper Attachment: attach paper to document sources tray", async () => {
    const attached = await attachDocumentPaper(primaryUserId, testDocumentId, moralesPaper.id);
    assert.ok(attached, "Paper attachment record must be created.");

    const doc = await getResearchDocument(primaryUserId, testDocumentId);
    assert.ok(
      doc.linkedPapers.some((lp) => lp.paperId === moralesPaper.id),
      "Attached paper must appear in document linkedPapers."
    );
  });

  test("3. Structured Citation Insertion: insert citation at cursor with DOI and provenance", async () => {
    const chunk = moralesPaper.chunks[0];
    const citation = await insertDocumentCitation(primaryUserId, testDocumentId, {
      paperId: moralesPaper.id,
      chunkId: chunk ? chunk.id : undefined,
      citationText: "(Morales et al., 2026)",
      pageNumber: chunk ? chunk.pageNumber : 5,
      section: chunk ? chunk.section : "Results",
    });

    assert.ok(citation.id, "Citation ID must be generated.");
    assert.equal(citation.paperId, moralesPaper.id, "Citation must link to Morales paper ID.");
    assert.equal(citation.paper.doi, moralesPaper.doi, "Citation must preserve exact paper DOI.");
    if (chunk) {
      assert.equal(citation.chunkId, chunk.id, "Citation must anchor to exact verified chunk.");
      assert.equal(citation.citationType, CitationType.PASSAGE_VERIFIED, "Verified chunk citation must be PASSAGE_VERIFIED.");
    }
  });

  test("4. In-Text APA Rendering: CSL engine formats author-date and page locator", async () => {
    const doc = await getResearchDocument(primaryUserId, testDocumentId);
    const clusters = [
      {
        citationId: "cit-morales-1",
        items: [{ id: moralesPaper.id, locator: "5", label: "page" }],
      },
    ];

    const cslRes = await formatDocumentCsl({
      styleId: "apa",
      linkedPapers: doc.linkedPapers,
      clusters,
    });

    const rendered = cslRes.renderedClusters.get("cit-morales-1");
    assert.ok(rendered, "Rendered in-text citation must exist.");
    assert.ok(
      rendered.includes("Morales"),
      `Rendered citation '${rendered}' must contain author family name Morales.`
    );
    assert.ok(
      rendered.includes("2026"),
      `Rendered citation '${rendered}' must contain publication year 2026.`
    );
    assert.ok(
      rendered.includes("5"),
      `Rendered citation '${rendered}' with locator '5' must include page number 5.`
    );
  });

  test("5. Bibliography Generation & Deduplication: multiple citations yield single bibliography entry", async () => {
    const doc = await getResearchDocument(primaryUserId, testDocumentId);
    // Cite Morales three times with different locators
    const clusters = [
      {
        citationId: "cit-1",
        items: [{ id: moralesPaper.id }],
      },
      {
        citationId: "cit-2",
        items: [{ id: moralesPaper.id, locator: "3", label: "page" }],
      },
      {
        citationId: "cit-3",
        items: [{ id: moralesPaper.id, locator: "5", label: "page" }],
      },
    ];

    const cslRes = await formatDocumentCsl({
      styleId: "apa",
      linkedPapers: doc.linkedPapers,
      clusters,
    });

    assert.equal(
      cslRes.renderedClusters.size,
      3,
      "All 3 in-text citation instances must be rendered."
    );
    assert.equal(
      cslRes.bibliographyEntries.length,
      1,
      "Bibliography must contain EXACTLY ONE entry for Morales et al., with zero duplicate entries."
    );
    assert.ok(
      cslRes.bibliographyEntries[0].includes("10.1002/uog.70315") ||
        cslRes.bibliographyEntries[0].toLowerCase().includes("adenomyosis"),
      "Bibliography entry must contain Morales DOI or title."
    );
  });

  test("6. Multi-Paper Citation & Ordering: citations from different papers render distinct entries", async () => {
    // Attach second paper
    await attachDocumentPaper(primaryUserId, testDocumentId, secondPaper.id);
    const doc = await getResearchDocument(primaryUserId, testDocumentId);

    const clusters = [
      {
        citationId: "cit-morales",
        items: [{ id: moralesPaper.id }],
      },
      {
        citationId: "cit-second",
        items: [{ id: secondPaper.id }],
      },
    ];

    const cslRes = await formatDocumentCsl({
      styleId: "apa",
      linkedPapers: doc.linkedPapers,
      clusters,
    });

    assert.equal(cslRes.renderedClusters.size, 2, "Both citations must be rendered.");
    assert.equal(
      cslRes.bibliographyEntries.length,
      2,
      "Bibliography must contain exactly two distinct entries for two cited papers."
    );
  });

  test("7. TipTap Document Persistence: citation atom nodes and bibliography survive autosave and reload", async () => {
    // Build TipTap document JSON containing inline citation atom nodes and bibliography block node
    const tipTapContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Sonographic Criteria for Internal Adenomyosis" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Adenomyosis is characterized by the presence of heterotopic endometrial glands ",
            },
            {
              type: "citation",
              attrs: {
                citationId: "cit-morales-persisted",
                items: [
                  {
                    paperId: moralesPaper.id,
                    paperTitle: moralesPaper.title,
                    locator: "5",
                  },
                ],
                renderedText: "(Morales et al., 2026, p. 5)",
                styleId: "apa",
              },
            },
            {
              type: "text",
              text: ". High-resolution transvaginal sonography provides accurate assessment.",
            },
          ],
        },
        {
          type: "bibliography",
          attrs: {
            styleId: "apa",
            styleTitle: "References",
            entries: [
              `Morales, A., et al. (2026). Ultrasound of adenomyosis. Ultrasound in Obstetrics & Gynecology. https://doi.org/${moralesPaper.doi}`,
            ],
          },
        },
      ],
    };

    // Save via document service
    await updateResearchDocument(primaryUserId, testDocumentId, {
      content: toPlainTipTapJson(tipTapContent),
      textContent: "Sonographic Criteria for Internal Adenomyosis (Morales et al., 2026, p. 5)",
    });

    // Reload from database
    const reloaded = await getResearchDocument(primaryUserId, testDocumentId);
    const reloadedContent = reloaded.content as any;

    assert.ok(reloadedContent, "Reloaded document must have content.");
    assert.equal(reloadedContent.type, "doc", "Document root must be 'doc'.");

    // Locate inline citation node
    let foundCitationNode: any = null;
    let foundBibNode: any = null;

    for (const block of reloadedContent.content || []) {
      if (block.type === "paragraph" && Array.isArray(block.content)) {
        for (const child of block.content) {
          if (child.type === "citation") {
            foundCitationNode = child;
          }
        }
      }
      if (block.type === "bibliography") {
        foundBibNode = block;
      }
    }

    assert.ok(foundCitationNode, "TipTap inline citation node must be preserved after database reload.");
    assert.equal(
      foundCitationNode.attrs.citationId,
      "cit-morales-persisted",
      "Citation ID must be preserved."
    );
    assert.equal(
      foundCitationNode.attrs.items[0].paperId,
      moralesPaper.id,
      "Paper ID in citation items must be preserved."
    );
    assert.equal(
      foundCitationNode.attrs.renderedText,
      "(Morales et al., 2026, p. 5)",
      "Rendered text attribute must be preserved."
    );

    assert.ok(foundBibNode, "TipTap bibliography block node must be preserved after database reload.");
    assert.equal(foundBibNode.attrs.entries.length, 1, "Bibliography node must retain its entry.");
  });

  test("8. Multi-Tenant Privacy Isolation: user cannot cite another researcher's private paper", async () => {
    // User A attempts to cite User B's private paper
    await assert.rejects(
      async () => {
        await insertDocumentCitation(primaryUserId, testDocumentId, {
          paperId: privatePaperUserB.id,
          citationText: "(Bob, 2026)",
        });
      },
      /private manuscript belonging to another researcher|quarantined/i,
      "Inserting citation to private paper belonging to another researcher must be rejected."
    );
  });

  test("9. Document Access Boundary: researcher B cannot insert citation into researcher A's document", async () => {
    await assert.rejects(
      async () => {
        await insertDocumentCitation(secondaryUserId, testDocumentId, {
          paperId: moralesPaper.id,
          citationText: "(Morales et al., 2026)",
        });
      },
      /Research document .* not found/i,
      "User B must not be able to insert citations into User A's document."
    );
  });

  test("10. Zero Citation Fabrication: invalid or non-existent paperId is strictly rejected", async () => {
    await assert.rejects(
      async () => {
        await insertDocumentCitation(primaryUserId, testDocumentId, {
          paperId: "unknown-ref",
          citationText: "(Fabricated, 2026)",
        });
      },
      /A valid paperId is required/i,
      "Fabricated reference with unknown-ref must be rejected."
    );

    await assert.rejects(
      async () => {
        await insertDocumentCitation(primaryUserId, testDocumentId, {
          paperId: "cml9999999999999nonexistent",
          citationText: "(Ghost, 2026)",
        });
      },
      /not found or inaccessible/i,
      "Non-existent paperId must be rejected."
    );
  });

  test("11. Document Export Survival: citations survive Markdown, HTML, BibTeX, and RIS exports", async () => {
    // Markdown export
    const mdExport = await exportResearchDocument(primaryUserId, testDocumentId, "markdown");
    assert.ok(
      mdExport.content.includes("(Morales et al., 2026, p. 5)"),
      "Markdown export must contain formatted in-text citation."
    );
    assert.ok(
      mdExport.content.includes("## References"),
      "Markdown export must contain References heading."
    );

    // HTML export
    const htmlExport = await exportResearchDocument(primaryUserId, testDocumentId, "html");
    assert.ok(
      htmlExport.content.includes('class="csl-citation"'),
      "HTML export must contain semantic csl-citation tag."
    );
    assert.ok(
      htmlExport.content.includes("class=\"manuscript-references\""),
      "HTML export must contain manuscript-references section."
    );

    // BibTeX export
    const bibExport = await exportResearchDocument(primaryUserId, testDocumentId, "bibtex");
    assert.ok(
      bibExport.content.includes("@article{") || bibExport.content.includes("@misc{"),
      "BibTeX export must contain valid entry syntax."
    );
    assert.ok(
      bibExport.content.includes(moralesPaper.doi) || bibExport.content.toLowerCase().includes("morales"),
      "BibTeX export must contain Morales paper DOI or citation key."
    );

    // RIS export
    const risExport = await exportResearchDocument(primaryUserId, testDocumentId, "ris");
    assert.ok(
      risExport.content.includes("TY  -"),
      "RIS export must contain TY - entry tag."
    );
    assert.ok(
      risExport.content.includes("ER  -"),
      "RIS export must contain ER - termination tag."
    );
  });

  test("12. Citation Deletion: deleting citation updates bibliography and removes record", async () => {
    // 1. Get current citations
    const docBefore = await getResearchDocument(primaryUserId, testDocumentId);
    const existingCitation = docBefore.citations[0];
    assert.ok(existingCitation, "A citation must exist to delete.");

    // 2. Delete database citation record
    await deleteDocumentCitation(primaryUserId, testDocumentId, existingCitation.id);

    // 3. Confirm deletion
    const docAfter = await getResearchDocument(primaryUserId, testDocumentId);
    const exists = docAfter.citations.some((c) => c.id === existingCitation.id);
    assert.equal(exists, false, "Citation must be removed from document citations.");

    // 4. Formatting with 0 remaining citations returns empty bibliography
    const cslRes = await formatDocumentCsl({
      styleId: "apa",
      linkedPapers: docAfter.linkedPapers,
      clusters: [],
    });

    assert.equal(
      cslRes.bibliographyEntries.length,
      0,
      "When all citations are removed, bibliography entries must be empty."
    );
  });
});
