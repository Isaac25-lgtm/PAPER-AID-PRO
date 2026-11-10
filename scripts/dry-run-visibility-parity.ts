try {
  const serverOnlyPath = require.resolve("server-only");
  (require.cache as any)[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  };
} catch {}

import { PrismaClient, Prisma } from "@prisma/client";
import { ADMIN_TEST_FIXTURE_IDS, getPublicPaperWhereInput } from "../src/lib/auth/paper-authorization";

async function main() {
  const localDbUrl = process.env.LOCAL_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/ai_research_hub?schema=public";
  console.log(`[VisibilityParity] Connecting to local DB: ${localDbUrl.split("@")[1]}...`);

  const prisma = new PrismaClient({
    datasources: { db: { url: localDbUrl } },
  });

  try {
    const oldWhere = {
      id: { notIn: Array.from(ADMIN_TEST_FIXTURE_IDS) },
      OR: [
        { doi: { not: null } },
        { arxivId: { not: null } },
        { pmid: { not: null } },
        { pmcid: { not: null } },
        { semanticScholarId: { not: null } },
      ],
      NOT: [
        {
          AND: [
            { storagePath: { not: null } },
            { isOpenAccess: false },
          ],
        },
      ],
    };

    const newWhere = getPublicPaperWhereInput();

    const oldPapers = await prisma.paper.findMany({
      where: oldWhere,
      select: {
        id: true,
        title: true,
        storagePath: true,
        sourceProvenance: true,
        isOpenAccess: true,
      },
    });

    const newPapers = await prisma.paper.findMany({
      where: newWhere,
      select: {
        id: true,
        title: true,
        storagePath: true,
        sourceProvenance: true,
        isOpenAccess: true,
      },
    });

    const newPaperIds = new Set(newPapers.map((p) => p.id));
    const oldPaperIds = new Set(oldPapers.map((p) => p.id));

    // Papers that were visible under old where, but excluded under new where
    const excludedUnderNew = oldPapers.filter((p) => !newPaperIds.has(p.id));
    // Papers that were NOT visible under old where, but included under new where
    const includedUnderNew = newPapers.filter((p) => !oldPaperIds.has(p.id));

    console.log("\n========================================================");
    console.log("  ANONYMOUS VISIBILITY PARITY DRY-RUN (ai_research_hub)");
    console.log("========================================================");
    console.log(`Total papers under OLD filter: ${oldPapers.length}`);
    console.log(`Total papers under NEW filter: ${newPapers.length}`);
    console.log(`Papers newly excluded (restricted): ${excludedUnderNew.length}`);
    console.log(`Papers newly included:               ${includedUnderNew.length}`);
    console.log("--------------------------------------------------------");

    if (excludedUnderNew.length > 0) {
      console.log("\nPapers newly excluded (quarantined from anonymous view):");
      for (const p of excludedUnderNew) {
        const prov: any = p.sourceProvenance;
        const ownerKeys = {
          ownerId: prov?.ownerId,
          ownerUserId: prov?.ownerUserId,
          uploadedByUserId: prov?.uploadedByUserId,
          attachedByUserId: prov?.attachedByUserId,
          userId: prov?.userId,
          isPrivate: prov?.isPrivate,
        };
        console.log({
          id: p.id,
          title: p.title,
          storagePath: p.storagePath,
          ownerKeys,
          isFixture: ADMIN_TEST_FIXTURE_IDS.has(p.id),
        });
      }
    } else {
      console.log("\nZero papers changed visibility between old and new filter.");
    }

    if (includedUnderNew.length > 0) {
      console.log("\nPapers newly included:");
      for (const p of includedUnderNew) {
        console.log({ id: p.id, title: p.title, storagePath: p.storagePath });
      }
    }

    console.log("========================================================\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
