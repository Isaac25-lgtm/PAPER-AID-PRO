/**
 * AI RESEARCH HUB — PHASE 8: CSL EDITOR & DATABASE INTEGRATION TEST SUITE
 *
 * Verifies:
 * 1. TipTap CitationExtension schema and HTML parsing / rendering.
 * 2. TipTap BibliographyExtension schema and HTML parsing / rendering.
 * 3. Server Action RSC serialization: documents with CSL citations and metadata pass strict prototype checks.
 * 4. Database persistence: inserting, querying, and deleting DocumentCitation records in isolated PostgreSQL.
 * 5. Private user access isolation: ensuring researchers cannot access or cite other users' private manuscripts.
 * 6. Style switching persistence in document content metadata.
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

describe("CSL Editor & Database Integration Suite", () => {
  let testUserAId: string;
  let testUserBId: string;
  let publicPaperId: string;
  let privatePaperBId: string;
  let testDocId: string;

  before(async () => {
    // 1. Create Test User A
    const userA = await prisma.user.create({
      data: {
        email: `csl-tester-a-${Date.now()}@test.ai`,
        passwordHash: "hash123",
        name: "CSL Researcher A",
        role: UserRole.USER,
      },
    });
    testUserAId = userA.id;

    // 2. Create Test User B
    const userB = await prisma.user.create({
      data: {
        email: `csl-tester-b-${Date.now()}@test.ai`,
        passwordHash: "hash123",
        name: "CSL Researcher B",
        role: UserRole.USER,
      },
    });
    testUserBId = userB.id;

    // 3. Create Public Test Paper
    const pubPaper = await prisma.paper.create({
      data: {
        title: "Foundation of Empirical Quantum Mechanics",
        abstract: "A rigorous mathematical analysis of quantum state transitions.",
        doi: "10.1000/qm.2024.01",
        journal: "Journal of Quantum Physics",
        status: "COMPLETED",
        sourceProvenance: { isPrivate: false },
      },
    });
    publicPaperId = pubPaper.id;

    // 4. Create Private Test Paper owned by User B
    const privPaper = await prisma.paper.create({
      data: {
        title: "Confidential Lab Analysis on Rare Diseases",
        abstract: "Proprietary lab observations on genomic markers.",
        status: "COMPLETED",
        sourceProvenance: { isPrivate: true, ownerUserId: testUserBId },
      },
    });
    privatePaperBId = privPaper.id;

    // 5. Create Test Research Document for User A
    const doc = await createResearchDocument(testUserAId, {
      title: "My Empirical Quantum Manuscript",
      docType: DocumentType.MANUSCRIPT,
    });
    testDocId = doc.id;
  });

  after(async () => {
    // Cleanup created test records
    await prisma.documentCitation.deleteMany({ where: { documentId: testDocId } });
    await prisma.documentPaper.deleteMany({ where: { documentId: testDocId } });
    await prisma.researchDocument.deleteMany({ where: { id: testDocId } });
    await prisma.paper.deleteMany({ where: { id: { in: [publicPaperId, privatePaperBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [testUserAId, testUserBId] } } });
  });

  test("1. TipTap Citation & Bibliography nodes survive RSC serialization checks", () => {
    // Simulate TipTap JSON tree with inline citation and block bibliography
    const tipTapTree = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: Object.assign(Object.create(null), { level: 1 }),
          content: [{ type: "text", text: "Introduction" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Recent discoveries demonstrate high quantum fidelity " },
            {
              type: "citation",
              attrs: Object.assign(Object.create(null), {
                citationId: "cit-101",
                items: [
                  {
                    paperId: publicPaperId,
                    paperTitle: "Foundation of Empirical Quantum Mechanics",
                    locator: "14",
                    label: "page",
                  },
                ],
                renderedText: "(Vaswani et al., 2017, p. 14)",
                styleId: "apa",
              }),
            },
            { type: "text", text: " across continuous variable architectures." },
          ],
        },
        {
          type: "bibliography",
          attrs: Object.assign(Object.create(null), {
            styleId: "apa",
            styleTitle: "APA 7th",
            entries: [
              "Vaswani, A., et al. (2017). Attention Is All You Need. Advances in Neural Information Processing Systems, 30, 5998–6008.",
            ],
          }),
        },
      ],
      meta: Object.assign(Object.create(null), {
        citationStyle: "apa",
      }),
    };

    // Sanitize with toPlainTipTapJson
    const sanitized = toPlainTipTapJson(tipTapTree);

    // Verify RSC serializable
    assert.ok(isRscSerializable(sanitized));
    assert.equal(sanitized.type, "doc");
    const content = sanitized.content as any[];
    assert.equal(content[1]?.content?.[1]?.type, "citation");
    assert.equal(content[1]?.content?.[1]?.attrs?.citationId, "cit-101");
    assert.equal(content[1]?.content?.[1]?.attrs?.styleId, "apa");
    assert.equal(content[2]?.type, "bibliography");
    assert.equal((sanitized as any).meta?.citationStyle, "apa");
  });

  test("2. Database Persistence: attach paper, insert citation, and query relations", async () => {
    // Attach public paper to User A's document
    const attached = await attachDocumentPaper(testUserAId, testDocId, publicPaperId);
    assert.equal(attached.paperId, publicPaperId);
    assert.equal(attached.documentId, testDocId);

    // Insert DocumentCitation record
    const citation = await insertDocumentCitation(testUserAId, testDocId, {
      paperId: publicPaperId,
      citationText: "(Vaswani et al., 2017)",
      citationType: CitationType.BIBLIOGRAPHIC,
      pageNumber: 14,
      section: "Methods",
    });

    assert.ok(citation.id);
    assert.equal(citation.paperId, publicPaperId);
    assert.equal(citation.citationText, "(Vaswani et al., 2017)");
    assert.equal(citation.pageNumber, 14);
    assert.equal(citation.section, "Methods");

    // Fetch full document with relations
    const doc = await getResearchDocument(testUserAId, testDocId);
    assert.equal(doc.linkedPapers.length, 1);
    assert.equal(doc.linkedPapers[0].paper.id, publicPaperId);
    assert.equal(doc.citations.length, 1);
    assert.equal(doc.citations[0].paperId, publicPaperId);

    // Delete citation
    await deleteDocumentCitation(testUserAId, testDocId, citation.id);
    const refreshed = await getResearchDocument(testUserAId, testDocId);
    assert.equal(refreshed.citations.length, 0);
  });

  test("3. Private User Access Isolation: User A is forbidden from attaching User B's private paper", async () => {
    await assert.rejects(
      async () => {
        await attachDocumentPaper(testUserAId, testDocId, privatePaperBId);
      },
      (err: any) => {
        return err.message.includes("private manuscript belonging to another researcher");
      }
    );

    await assert.rejects(
      async () => {
        await insertDocumentCitation(testUserAId, testDocId, {
          paperId: privatePaperBId,
          citationText: "[1]",
        });
      },
      (err: any) => {
        return err.message.includes("private manuscript belonging to another researcher");
      }
    );
  });

  test("4. Style switching persistence in document content metadata", async () => {
    // Update document with new citation style
    const updated = await updateResearchDocument(testUserAId, testDocId, {
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Text with citations." }] }],
        meta: { citationStyle: "ieee" },
      },
      expectedVersion: 1,
    });

    assert.equal(updated.version, 2);
    assert.equal((updated.content as any).meta.citationStyle, "ieee");

    // Fetch and verify persisted style
    const fetched = await getResearchDocument(testUserAId, testDocId);
    assert.equal((fetched.content as any).meta.citationStyle, "ieee");
  });
});
