/**
 * AI RESEARCH HUB — PHASE 8: DISPOSABLE MANUSCRIPT CSL ACCEPTANCE SUITE
 *
 * Verifies Priority 2 Requirements on a disposable academic manuscript:
 * 1. Insert three structured citations with locators.
 * 2. Generate an APA bibliography and verify author-date format.
 * 3. Switch to Vancouver and confirm correct citation numbering (1, 2, 3).
 * 4. Switch to IEEE and confirm in-text brackets [1], [2], [3] and IEEE bibliography format.
 * 5. Insert a repeated citation and verify deduplication (single bibliography entry).
 * 6. Insert a citation cluster containing multiple papers.
 * 7. Move and delete citations; verify renumbering and zero orphaned bibliography entries.
 * 8. Save and refresh the manuscript; verify citation identities, locators, style, and bibliography survive reopening.
 * 9. Confirm TipTap serialization passes RSC safety checks.
 * 10. Clean up disposable document and papers without modifying existing researcher manuscripts.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  loadIsolatedTestEnvironment,
  assertIsolatedTestEnvironment,
  enableMockStorage,
} from "../src/lib/test-guard";

loadIsolatedTestEnvironment();
assertIsolatedTestEnvironment();
enableMockStorage();

import { prisma } from "../src/lib/prisma";
import { DocumentType, CitationType, UserRole } from "@prisma/client";
import { toPlainTipTapJson, isRscSerializable } from "../src/lib/editor/content-sanitizer";
import {
  createResearchDocument,
  getResearchDocument,
  updateResearchDocument,
  insertDocumentCitation,
  deleteDocumentCitation,
  attachDocumentPaper,
} from "../src/lib/editor/document-service";
import {
  formatDocumentCsl,
  loadStyleXmlClient,
} from "../src/lib/citations/csl/csl-client-formatter";
import {
  createCiteprocEngine,
  renderBibliography,
  processSequentialCitationClusters,
} from "../src/lib/citations/csl/csl-engine";
import { mapReferenceToCslJson } from "../src/lib/citations/csl/csl-mapper";
import { BUNDLED_STYLES } from "../src/lib/citations/csl/styles/bundled-styles";

describe("Disposable Academic Manuscript CSL Verification Suite", () => {
  let testUserId: string;
  let disposableDocId: string;
  let paper1Id: string;
  let paper2Id: string;
  let paper3Id: string;

  const paper1Data = {
    title: "Attention is All You Need",
    abstract: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
    publicationDate: new Date("2017-06-12"),
    journal: "Advances in Neural Information Processing Systems",
    doi: "10.5555/3295222.3295349",
    volume: "30",
  };

  const paper2Data = {
    title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
    abstract: "Large pre-trained language models store factual knowledge in their parameters, but their ability to access precise knowledge is limited.",
    authors: ["Patrick Lewis", "Ethan Perez", "Aleksandra Piktus"],
    publicationDate: new Date("2020-09-15"),
    journal: "Advances in Neural Information Processing Systems",
    doi: "10.5555/3495724.3496502",
    volume: "33",
  };

  const paper3Data = {
    title: "Highly accurate protein structure prediction with AlphaFold",
    abstract: "Proteins are essential to life, and understanding their structure can facilitate a mechanistic understanding of their function.",
    authors: ["John Jumper", "Richard Evans", "Alexander Pritzel", "Demis Hassabis"],
    publicationDate: new Date("2021-07-15"),
    journal: "Nature",
    doi: "10.1038/s41586-021-03819-2",
    volume: "596",
    issue: "7873",
    pages: "583-589",
  };

  async function createPaperWithAuthors(paperData: any, authorNames: string[]) {
    const paper = await prisma.paper.create({
      data: {
        title: paperData.title,
        abstract: paperData.abstract,
        journal: paperData.journal,
        publicationDate: paperData.publicationDate,
        doi: paperData.doi ? `${paperData.doi}.test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` : null,
        rawMetadata: {
          volume: paperData.volume,
          issue: paperData.issue,
          pages: paperData.pages,
        },
        status: "COMPLETED",
      },
    });

    for (let i = 0; i < authorNames.length; i++) {
      const name = authorNames[i];
      let author = await prisma.author.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
      });
      if (!author) {
        author = await prisma.author.create({ data: { name } });
      }
      await prisma.paperAuthor.create({
        data: {
          paperId: paper.id,
          authorId: author.id,
          orderIndex: i,
        },
      });
    }

    return paper;
  }

  before(async () => {
    // 1. Create a dedicated test researcher
    const user = await prisma.user.create({
      data: {
        email: `csl-acceptance-${Date.now()}@test.ai`,
        passwordHash: "hash123",
        name: "Dr. CSL Acceptance",
        role: UserRole.USER,
      },
    });
    testUserId = user.id;

    // 2. Create the three test papers with authors
    const p1 = await createPaperWithAuthors(paper1Data, paper1Data.authors);
    const p2 = await createPaperWithAuthors(paper2Data, paper2Data.authors);
    const p3 = await createPaperWithAuthors(paper3Data, paper3Data.authors);
    paper1Id = p1.id;
    paper2Id = p2.id;
    paper3Id = p3.id;

    // 3. Create disposable academic manuscript
    const doc = await createResearchDocument(testUserId, {
      title: "Disposable Manuscript: Empirical Transformer and Retrieval Architectures",
      docType: DocumentType.MANUSCRIPT,
    });
    disposableDocId = doc.id;

    // 4. Attach the 3 papers to the manuscript
    await attachDocumentPaper(testUserId, disposableDocId, paper1Id);
    await attachDocumentPaper(testUserId, disposableDocId, paper2Id);
    await attachDocumentPaper(testUserId, disposableDocId, paper3Id);
  });

  after(async () => {
    // Clean up disposable records strictly, preserving researcher manuscripts
    try {
      if (disposableDocId) {
        await prisma.documentCitation.deleteMany({ where: { documentId: disposableDocId } });
        await prisma.documentPaper.deleteMany({ where: { documentId: disposableDocId } });
        await prisma.researchDocument.delete({ where: { id: disposableDocId } });
      }
      const paperIds = [paper1Id, paper2Id, paper3Id].filter(Boolean);
      if (paperIds.length > 0) {
        await prisma.paperAuthor.deleteMany({ where: { paperId: { in: paperIds } } });
        await prisma.paper.deleteMany({ where: { id: { in: paperIds } } });
      }
      if (testUserId) await prisma.user.delete({ where: { id: testUserId } });
    } catch (cleanupErr) {
      console.warn("Cleanup warning:", cleanupErr);
    }
  });

  test("1. Insert three structured citations with locators and verify APA bibliography", async () => {
    const doc = await getResearchDocument(testUserId, disposableDocId);
    const linkedPapers = doc.linkedPapers.map((lp: any) => lp.paper);

    const clusters = [
      { citationId: "cit-1", items: [{ id: paper1Id, locator: "14", label: "page" }] },
      { citationId: "cit-2", items: [{ id: paper2Id, locator: "5", label: "page" }] },
      { citationId: "cit-3", items: [{ id: paper3Id }] },
    ];

    const apaRes = await formatDocumentCsl({
      styleId: "apa",
      linkedPapers,
      clusters,
    });

    // Verify in-text APA citations
    assert.equal(apaRes.renderedClusters.get("cit-1"), "(Vaswani et al., 2017, p. 14)");
    assert.equal(apaRes.renderedClusters.get("cit-2"), "(Lewis et al., 2020, p. 5)");
    assert.equal(apaRes.renderedClusters.get("cit-3"), "(Jumper et al., 2021)");

    // Verify bibliography contains all 3 entries sorted by author in APA
    assert.equal(apaRes.bibliographyEntries.length, 3);
    assert.ok(apaRes.bibliographyEntries[0].includes("Jumper"));
    assert.ok(apaRes.bibliographyEntries[1].includes("Lewis"));
    assert.ok(apaRes.bibliographyEntries[2].includes("Vaswani"));
  });

  test("2. Switch to Vancouver and confirm correct citation numbering (1, 2, 3)", async () => {
    const doc = await getResearchDocument(testUserId, disposableDocId);
    const linkedPapers = doc.linkedPapers.map((lp: any) => lp.paper);

    const clusters = [
      { citationId: "cit-1", items: [{ id: paper1Id }] },
      { citationId: "cit-2", items: [{ id: paper2Id }] },
      { citationId: "cit-3", items: [{ id: paper3Id }] },
    ];

    const vancouverRes = await formatDocumentCsl({
      styleId: "vancouver",
      linkedPapers,
      clusters,
    });

    // In Vancouver, citations are formatted as sequential numbers
    assert.equal(vancouverRes.renderedClusters.get("cit-1"), "(1)");
    assert.equal(vancouverRes.renderedClusters.get("cit-2"), "(2)");
    assert.equal(vancouverRes.renderedClusters.get("cit-3"), "(3)");

    // Bibliography in citation order
    assert.equal(vancouverRes.bibliographyEntries.length, 3);
    assert.ok(vancouverRes.bibliographyEntries[0].includes("Vaswani"));
    assert.ok(vancouverRes.bibliographyEntries[1].includes("Lewis"));
    assert.ok(vancouverRes.bibliographyEntries[2].includes("Jumper"));
  });

  test("3. Switch to IEEE and confirm bracketed in-text [1], [2], [3] and IEEE bibliography", async () => {
    const doc = await getResearchDocument(testUserId, disposableDocId);
    const linkedPapers = doc.linkedPapers.map((lp: any) => lp.paper);

    const clusters = [
      { citationId: "cit-1", items: [{ id: paper1Id }] },
      { citationId: "cit-2", items: [{ id: paper2Id }] },
      { citationId: "cit-3", items: [{ id: paper3Id }] },
    ];

    const ieeeRes = await formatDocumentCsl({
      styleId: "ieee",
      linkedPapers,
      clusters,
    });

    // In IEEE, bracketed numbers
    assert.equal(ieeeRes.renderedClusters.get("cit-1"), "[1]");
    assert.equal(ieeeRes.renderedClusters.get("cit-2"), "[2]");
    assert.equal(ieeeRes.renderedClusters.get("cit-3"), "[3]");

    assert.equal(ieeeRes.bibliographyEntries.length, 3);
    assert.ok(ieeeRes.bibliographyEntries[0].includes("A. Vaswani"));
  });

  test("4. Repeated citation to same paper: deduplicated bibliography and consistent number", async () => {
    const doc = await getResearchDocument(testUserId, disposableDocId);
    const linkedPapers = doc.linkedPapers.map((lp: any) => lp.paper);

    // Cit-4 is a repeated citation to Paper 1 (same as Cit-1)
    const clusters = [
      { citationId: "cit-1", items: [{ id: paper1Id }] },
      { citationId: "cit-2", items: [{ id: paper2Id }] },
      { citationId: "cit-3", items: [{ id: paper3Id }] },
      { citationId: "cit-4", items: [{ id: paper1Id }] }, // Repeated citation
    ];

    const ieeeRes = await formatDocumentCsl({
      styleId: "ieee",
      linkedPapers,
      clusters,
    });

    // In-text citation 4 must reuse reference number [1]
    assert.equal(ieeeRes.renderedClusters.get("cit-1"), "[1]");
    assert.equal(ieeeRes.renderedClusters.get("cit-4"), "[1]");

    // Bibliography MUST be deduplicated to exactly 3 entries
    assert.equal(ieeeRes.bibliographyEntries.length, 3);
  });

  test("5. Multi-paper citation cluster: properly sorted and formatted together", async () => {
    const doc = await getResearchDocument(testUserId, disposableDocId);
    const linkedPapers = doc.linkedPapers.map((lp: any) => lp.paper);

    // Cluster with Paper 2 and Paper 3 together
    const clusters = [
      { citationId: "cit-1", items: [{ id: paper1Id }] },
      { citationId: "cit-cluster", items: [{ id: paper2Id }, { id: paper3Id }] },
    ];

    const ieeeRes = await formatDocumentCsl({
      styleId: "ieee",
      linkedPapers,
      clusters,
    });

    // In IEEE, multi-source cluster renders as [2], [3] or [2, 3]
    const clusterText = ieeeRes.renderedClusters.get("cit-cluster");
    assert.ok(clusterText?.includes("2") && clusterText?.includes("3"));

    // In APA, multi-source cluster combines authors with semicolon
    const apaRes = await formatDocumentCsl({
      styleId: "apa",
      linkedPapers,
      clusters,
    });
    const apaCluster = apaRes.renderedClusters.get("cit-cluster");
    assert.equal(apaCluster, "(Jumper et al., 2021; Lewis et al., 2020)");
  });

  test("6. Move and delete citations: dynamic renumbering and no orphaned references", async () => {
    const doc = await getResearchDocument(testUserId, disposableDocId);
    const linkedPapers = doc.linkedPapers.map((lp: any) => lp.paper);

    // Initial 3 citations
    let clusters = [
      { citationId: "cit-1", items: [{ id: paper1Id }] },
      { citationId: "cit-2", items: [{ id: paper2Id }] },
      { citationId: "cit-3", items: [{ id: paper3Id }] },
    ];

    let res = await formatDocumentCsl({ styleId: "ieee", linkedPapers, clusters });
    assert.equal(res.renderedClusters.get("cit-1"), "[1]");
    assert.equal(res.renderedClusters.get("cit-2"), "[2]");
    assert.equal(res.renderedClusters.get("cit-3"), "[3]");
    assert.equal(res.bibliographyEntries.length, 3);

    // Delete Citation 1 (Paper 1 removed from manuscript body)
    clusters = [
      { citationId: "cit-2", items: [{ id: paper2Id }] },
      { citationId: "cit-3", items: [{ id: paper3Id }] },
    ];

    res = await formatDocumentCsl({ styleId: "ieee", linkedPapers, clusters });

    // Citation 2 and Citation 3 must renumber to [1] and [2]
    assert.equal(res.renderedClusters.get("cit-2"), "[1]");
    assert.equal(res.renderedClusters.get("cit-3"), "[2]");

    // Bibliography must drop Paper 1: exactly 2 entries remain
    assert.equal(res.bibliographyEntries.length, 2);
    assert.ok(!res.bibliographyEntries.some((e) => e.includes("Vaswani")));
    assert.ok(res.bibliographyEntries.some((e) => e.includes("Lewis")));
    assert.ok(res.bibliographyEntries.some((e) => e.includes("Jumper")));
  });

  test("7. Persistence and reload: citation nodes, style, and bibliography survive save and reopen", async () => {
    // Construct structured TipTap document tree with citations and bibliography
    const tipTapTree = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Recent advances in transformer networks " },
            {
              type: "citation",
              attrs: {
                citationId: "cit-perm-1",
                items: [{ paperId: paper1Id, locator: "14", label: "page" }],
                renderedText: "[1]",
                styleId: "ieee",
              },
            },
            { type: "text", text: " demonstrated superior empirical performance." },
          ],
        },
        {
          type: "bibliography",
          attrs: {
            styleId: "ieee",
            styleTitle: "IEEE",
            entries: ["[1] A. Vaswani et al., 'Attention is All You Need', 2017."],
          },
        },
      ],
      meta: {
        citationStyle: "ieee",
      },
    };

    // Sanitize with toPlainTipTapJson
    const sanitized = toPlainTipTapJson(tipTapTree);
    assert.ok(isRscSerializable(sanitized));

    // Update research document in database
    const saved = await updateResearchDocument(testUserId, disposableDocId, {
      content: sanitized,
      textContent: "Recent advances in transformer networks [1] demonstrated superior empirical performance.",
      expectedVersion: 1,
    });

    assert.equal(saved.version, 2);

    // Also persist database citation record
    await insertDocumentCitation(testUserId, disposableDocId, {
      paperId: paper1Id,
      citationText: "[1]",
      citationType: CitationType.BIBLIOGRAPHIC,
      pageNumber: 14,
    });

    // Reopen manuscript from database
    const reopened = await getResearchDocument(testUserId, disposableDocId);
    assert.equal(reopened.version, 2);
    assert.equal((reopened.content as any).meta?.citationStyle, "ieee");

    const content = (reopened.content as any).content;
    assert.equal(content[0].content[1].type, "citation");
    assert.equal(content[0].content[1].attrs.citationId, "cit-perm-1");
    assert.equal(content[0].content[1].attrs.items[0].paperId, paper1Id);
    assert.equal(content[0].content[1].attrs.items[0].locator, "14");
    assert.equal(content[1].type, "bibliography");
    assert.equal(content[1].attrs.styleId, "ieee");
    assert.equal(reopened.citations.length, 1);
    assert.equal(reopened.citations[0].pageNumber, 14);
  });

  test("8. Empty manuscript style persistence: retains selected style with zero citations or text", async () => {
    // 1. Create a brand new completely empty manuscript
    const emptyDoc = await createResearchDocument(testUserId, {
      title: "Completely Empty Manuscript",
      docType: DocumentType.DRAFT,
    });

    assert.ok(emptyDoc.id);

    // 2. Researcher switches style to Vancouver on the empty manuscript
    const updatedEmpty = await updateResearchDocument(testUserId, emptyDoc.id, {
      content: {
        type: "doc",
        content: [{ type: "paragraph" }],
        meta: { citationStyle: "vancouver" },
      },
      expectedVersion: 1,
    });

    assert.equal(updatedEmpty.version, 2);
    assert.equal((updatedEmpty.content as any).meta?.citationStyle, "vancouver");

    // 3. Reopen manuscript from database
    const reopenedEmpty = await getResearchDocument(testUserId, emptyDoc.id);
    assert.equal((reopenedEmpty.content as any).meta?.citationStyle, "vancouver");
    assert.equal(reopenedEmpty.citations.length, 0);

    // 4. Clean up empty document
    await prisma.researchDocument.delete({ where: { id: emptyDoc.id } });
  });
});

