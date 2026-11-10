/**
 * AI RESEARCH HUB — IDEMPOTENT DEV-DB TEST FIXTURE SEEDER
 *
 * Seeds the canonical development fixtures into the isolated test database:
 * 1. Morales paper (cmvkznrpr001fvrggnajkkq4b) with 53 chunks and processing jobs
 * 2. Attention Is All You Need (cmuwoj877000cvr288df6z92u)
 * 3. AlphaFold 3 (cmvm4wiwm000cvri8nmzxo48m)
 * 4. Retrieval-Augmented Generation (cmvm4wixp000lvri8agoxa86q)
 * 5. Superficial lymph node tuberculosis radiomics (cmunotrr10000vrusnqyv61ut) with embeddings
 * 6. Multimodal ultrasound of BI-RADS 4 breast lesions (cmunxw9il00dnvrus7w9mqij9)
 * 7. The 4 real Adenomyosis papers (cmvkuwtx10000vrkgzji2dta3, cmvkuwvv7000fvrkgon29vnk2, cmvkuwxdy0016vrkgmltugp5d, cmvkux8ho001cvrkgvgygi96s)
 * 8. Historical research documents (Hyperplasia and Adenomyosis) and citations
 *
 * This script runs completely offline and deterministically with zero remote dependencies.
 */

import * as fs from "fs";
import * as path from "path";

// Mock server-only for standalone tsx script execution
try {
  const serverOnlyPath = require.resolve("server-only");
  (require.cache as any)[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  };
} catch {
  // ignore
}

import { PrismaClient } from "@prisma/client";
import { generateDeterministicMockEmbedding, prepareChunkEmbeddingInput } from "../src/lib/ai/embeddings";
import { AI_CONFIG } from "../src/lib/ai/config";
import { assertDisposableDatabaseMarker } from "../src/lib/test-guard";

export async function seedDevFixtures(prismaClient?: PrismaClient) {
  const prisma =
    prismaClient ||
    new PrismaClient({
      datasources: {
        db: {
          url:
            process.env.DATABASE_URL ||
            "postgresql://postgres:postgres@127.0.0.1:5432/ai_research_hub_test?schema=public",
        },
      },
    });

  const fixturePath = path.resolve(__dirname, "fixtures", "dev-fixtures.json");
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Dev fixtures file not found at ${fixturePath}`);
  }

  const data = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
  console.log(`[FixtureSeeder] Seeding dev fixtures from ${fixturePath}...`);

  // Assert disposable test database marker is present. Seeder must NEVER create the marker itself.
  await assertDisposableDatabaseMarker(prisma);

  // 1. Seed Users
  for (const u of data.users || []) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: u.passwordHash,
      },
      create: {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: u.passwordHash,
      },
    });
  }

  // 2. Seed Papers and Relations
  for (const p of data.papers || []) {
    const isPrivate = Boolean(
      p.sourceProvenance?.isPrivate ||
      p.sourceProvenance?.ownerUserId ||
      p.sourceProvenance?.ownerId
    );
    const paperDoi = isPrivate ? null : (p.doi || null);

    if (paperDoi) {
      const existingWithDoi = await prisma.paper.findFirst({
        where: { doi: paperDoi, id: { not: p.id } },
      });
      if (existingWithDoi) {
        await prisma.paper.update({
          where: { id: existingWithDoi.id },
          data: { doi: null },
        });
      }
    }

    // Upsert Paper
    await prisma.paper.upsert({
      where: { id: p.id },
      update: {
        title: p.title,
        abstract: p.abstract,
        publicationDate: p.publicationDate ? new Date(p.publicationDate) : null,
        journal: p.journal,
        doi: paperDoi,
        arxivId: p.arxivId,
        pmid: p.pmid,
        pmcid: p.pmcid,
        semanticScholarId: p.semanticScholarId,
        isOpenAccess: p.isOpenAccess ?? false,
        pdfUrl: p.pdfUrl,
        storagePath: p.storagePath,
        status: p.status,
        sourceProvenance: p.sourceProvenance,
        researchQuestion: p.researchQuestion,
        methodology: p.methodology,
        results: p.results,
        limitations: p.limitations,
        conclusion: p.conclusion,
        keywords: p.keywords || [],
        citationCount: p.citationCount || 0,
      },
      create: {
        id: p.id,
        title: p.title,
        abstract: p.abstract,
        publicationDate: p.publicationDate ? new Date(p.publicationDate) : null,
        journal: p.journal,
        doi: paperDoi,
        arxivId: p.arxivId,
        pmid: p.pmid,
        pmcid: p.pmcid,
        semanticScholarId: p.semanticScholarId,
        isOpenAccess: p.isOpenAccess ?? false,
        pdfUrl: p.pdfUrl,
        storagePath: p.storagePath,
        status: p.status,
        sourceProvenance: p.sourceProvenance,
        researchQuestion: p.researchQuestion,
        methodology: p.methodology,
        results: p.results,
        limitations: p.limitations,
        conclusion: p.conclusion,
        keywords: p.keywords || [],
        citationCount: p.citationCount || 0,
      },
    });

    // Upsert Authors and PaperAuthors
    for (const pa of p.authors || []) {
      if (pa.author) {
        await prisma.author.upsert({
          where: { id: pa.author.id },
          update: {
            name: pa.author.name,
            orcid: pa.author.orcid,
            institution: pa.author.institution,
            citationCount: pa.author.citationCount || 0,
            hIndex: pa.author.hIndex || 0,
          },
          create: {
            id: pa.author.id,
            name: pa.author.name,
            orcid: pa.author.orcid,
            institution: pa.author.institution,
            citationCount: pa.author.citationCount || 0,
            hIndex: pa.author.hIndex || 0,
          },
        });

        await prisma.paperAuthor.upsert({
          where: {
            paperId_authorId: {
              paperId: p.id,
              authorId: pa.author.id,
            },
          },
          update: { orderIndex: pa.orderIndex },
          create: {
            paperId: p.id,
            authorId: pa.author.id,
            orderIndex: pa.orderIndex,
          },
        });
      }
    }

    // Upsert Categories and PaperCategories
    for (const pc of p.categories || []) {
      if (pc.category) {
        const existingCat = await prisma.category.findFirst({
          where: {
            OR: [
              { id: pc.category.id },
              { name: pc.category.name },
              { slug: pc.category.slug },
            ],
          },
        });
        const catId = existingCat ? existingCat.id : pc.category.id;
        if (!existingCat) {
          await prisma.category.create({
            data: {
              id: pc.category.id,
              name: pc.category.name,
              slug: pc.category.slug,
              description: pc.category.description,
            },
          });
        }

        await prisma.paperCategory.upsert({
          where: {
            paperId_categoryId: {
              paperId: p.id,
              categoryId: catId,
            },
          },
          update: {},
          create: {
            paperId: p.id,
            categoryId: catId,
          },
        });
      }
    }

    // Seed PaperChunks idempotently
    if (p.chunks && p.chunks.length > 0) {
      await prisma.paperChunk.deleteMany({ where: { paperId: p.id } });
      for (const c of p.chunks) {
        await prisma.paperChunk.create({
          data: {
            id: c.id,
            paperId: p.id,
            chunkIndex: c.chunkIndex,
            section: c.section,
            pageNumber: c.pageNumber,
            text: c.text,
            metadata: c.metadata,
            tokenCount: c.tokenCount,
            embeddingModel: c.embeddingModel,
            embeddingDimensions: c.embeddingDimensions,
            embeddingInputHash: c.embeddingInputHash,
          },
        });

      // Generate deterministic token-aware pgvector embeddings for search acceptance fixtures
      if (
        p.id === "cmunotrr10000vrusnqyv61ut" ||
        p.id === "cmuwoj877000cvr288df6z92u" ||
        p.id === "cmvm4wiwm000cvri8nmzxo48m" ||
        p.id === "cmvm4wixp000lvri8agoxa86q" ||
        p.id === "cmunxw9il00dnvrus7w9mqij9"
      ) {
        const embeddingInput = prepareChunkEmbeddingInput(p.title, c.section, c.text);
        const mockVec = generateDeterministicMockEmbedding(embeddingInput, AI_CONFIG.embeddingDimensions);
        const vecStr = `[${mockVec.join(",")}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE paper_chunks SET embedding = $1::vector, "embeddingModel" = $2 WHERE id = $3`,
          vecStr,
          AI_CONFIG.embeddingModel,
          c.id
        );
      }
    }
  }

    // Upsert ProcessingJobs
    for (const pj of p.processingJobs || []) {
      await prisma.processingJob.upsert({
        where: { id: pj.id },
        update: {
          stage: pj.stage,
          status: pj.status,
          attempt: pj.attempt,
          errorMessage: pj.errorMessage,
          errorStack: pj.errorStack,
          completedAt: pj.completedAt ? new Date(pj.completedAt) : null,
        },
        create: {
          id: pj.id,
          paperId: p.id,
          stage: pj.stage,
          status: pj.status,
          attempt: pj.attempt,
          errorMessage: pj.errorMessage,
          errorStack: pj.errorStack,
          completedAt: pj.completedAt ? new Date(pj.completedAt) : null,
        },
      });
    }
  }

  // 3. Seed Research Documents
  for (const doc of data.documents || []) {
    await prisma.researchDocument.upsert({
      where: { id: doc.id },
      update: {
        title: doc.title,
        content: doc.content,
        textContent: doc.textContent,
        version: doc.version,
        docType: (doc.docType || doc.documentType || "DRAFT") as any,
        userId: doc.userId,
      },
      create: {
        id: doc.id,
        title: doc.title,
        content: doc.content,
        textContent: doc.textContent,
        version: doc.version,
        docType: (doc.docType || doc.documentType || "DRAFT") as any,
        userId: doc.userId,
      },
    });

    for (const cite of doc.citations || []) {
      await prisma.documentCitation.upsert({
        where: { id: cite.id },
        update: {
          citationType: cite.citationType,
          citationText: cite.citationText,
          pageNumber: cite.pageNumber,
          section: cite.section,
        },
        create: {
          id: cite.id,
          documentId: doc.id,
          paperId: cite.paperId,
          chunkId: cite.chunkId,
          citationType: cite.citationType,
          citationText: cite.citationText,
          pageNumber: cite.pageNumber,
          section: cite.section,
        },
      });
    }

    for (const dp of doc.linkedPapers || []) {
      await prisma.documentPaper.upsert({
        where: {
          documentId_paperId: {
            documentId: doc.id,
            paperId: dp.paperId,
          },
        },
        update: {},
        create: {
          documentId: doc.id,
          paperId: dp.paperId,
        },
      });
    }
  }

  console.log(`[FixtureSeeder] Successfully seeded ${data.papers?.length || 0} papers and dependencies.`);
  if (!prismaClient) {
    await prisma.$disconnect();
  }
}

// Standalone execution
if (require.main === module || (process.argv[1] && process.argv[1].endsWith("seed-test-fixtures.ts"))) {
  seedDevFixtures()
    .then(() => {
      console.log("[FixtureSeeder] Done.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[FixtureSeeder] Failed:", err);
      process.exit(1);
    });
}
