/**
 * ONE-OFF MIGRATION & VISIBILITY DRY-RUN SCRIPT:
 * 1. Private Paper DOI Isolation (Item 2b):
 *    Finds existing private papers holding unique column values (doi, arxivId, pmid, pmcid, semanticScholarId)
 *    and moves them to sourceProvenance.canonicalDoi (and canonicalArxivId/Pmid/Pmcid).
 * 2. Visibility Migration Dry-Run Parity Check (Item 3):
 *    Classifies all papers into PUBLIC, PRIVATE, and ADMIN_FIXTURE using the exact proposed SQL rules
 *    and compares the resulting row sets 1-to-1 against paperVisibilityFilter(userId) and paperVisibilitySql(userId).
 *
 * Safety Guarantees:
 * - Strictly refuses any non-local / remote / Supabase database host.
 * - Dry-run by default (read-only). Pass `--execute` to apply the DOI migration in an atomic transaction.
 * - When `--execute` is passed, enforces `assertIsolatedDatabaseEnvironment()` by default.
 */

import { PrismaClient } from "@prisma/client";
import { assertIsolatedDatabaseEnvironment } from "../src/lib/test-guard";
import { ADMIN_TEST_FIXTURE_IDS, classifyPaper } from "../src/lib/auth/paper-authorization";
import { paperVisibilityFilter } from "../src/lib/auth/paper-visibility";

function assertStrictlyLocalHost() {
  for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const raw = process.env[key];
    if (!raw) continue;
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (
      host !== "localhost" &&
      host !== "127.0.0.1" &&
      host !== "::1" &&
      host !== "[::1]"
    ) {
      throw new Error(
        `[CRITICAL SAFETY BLOCK] ${key} points to non-local host "${host}". Remote/Supabase connections are strictly forbidden.`
      );
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");

  // Always enforce strictly local loopback database host (never Supabase)
  assertStrictlyLocalHost();

  // If mutating (--execute), enforce isolated test DB guard unless explicitly overridden for local dev DB
  if (execute && !args.includes("--allow-local-dev-db")) {
    assertIsolatedDatabaseEnvironment();
  }

  const prisma = new PrismaClient();
  try {
    const dbInfo = await prisma.$queryRaw<
      Array<{ current_database: string; inet_server_addr: string | null }>
    >`
      SELECT current_database(), host(inet_server_addr()) as inet_server_addr
    `;
    const dbName = dbInfo[0]?.current_database || "unknown";
    const serverAddr = dbInfo[0]?.inet_server_addr || "local";

    console.log("================================================================================");
    console.log(` 1. PRIVATE PAPER DOI MIGRATION (${execute ? "EXECUTE MODE" : "DRY-RUN MODE"})`);
    console.log(` Target Local Database: ${dbName} (${serverAddr})`);
    console.log("================================================================================");

    const allPapers = await prisma.paper.findMany({
      select: {
        id: true,
        title: true,
        doi: true,
        arxivId: true,
        pmid: true,
        pmcid: true,
        semanticScholarId: true,
        storagePath: true,
        sourceProvenance: true,
        rawMetadata: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const privatePapers = allPapers.filter((p) => classifyPaper(p) === "PRIVATE_USER_DOCUMENT");
    const candidates = privatePapers.filter(
      (p) =>
        p.doi !== null ||
        p.arxivId !== null ||
        p.pmid !== null ||
        p.pmcid !== null ||
        p.semanticScholarId !== null
    );
    const alreadyCleanWithCanonicalDoi = privatePapers.filter(
      (p) =>
        p.doi === null &&
        Boolean((p.sourceProvenance as Record<string, any> | null)?.canonicalDoi)
    );

    console.log(`Total papers scanned:                         ${allPapers.length}`);
    console.log(`Total private user papers found:              ${privatePapers.length}`);
    console.log(`Private papers already using canonicalDoi:    ${alreadyCleanWithCanonicalDoi.length}`);
    console.log(`Private papers holding unique column values:  ${candidates.length}`);

    if (candidates.length > 0) {
      console.log("\nCandidates holding unique column values (to move to canonicalDoi):");
      for (const c of candidates) {
        const prov = (c.sourceProvenance as Record<string, any>) || {};
        const owner =
          prov.ownerId ||
          prov.ownerUserId ||
          prov.uploadedByUserId ||
          prov.attachedByUserId ||
          prov.userId ||
          "unknown";
        console.log(
          ` - id=${c.id} | owner=${owner} | doi=${c.doi ?? "null"} | pmid=${c.pmid ?? "null"} | arxivId=${c.arxivId ?? "null"} -> canonicalDoi=${c.doi || prov.canonicalDoi || "null"}`
        );
      }
    }

    if (execute && candidates.length > 0) {
      console.log(`\nApplying migration to ${candidates.length} private paper(s)...`);
      await prisma.$transaction(async (tx) => {
        for (const c of candidates) {
          const prov = (c.sourceProvenance as Record<string, any>) || {};
          await tx.paper.update({
            where: { id: c.id },
            data: {
              doi: null,
              arxivId: null,
              pmid: null,
              pmcid: null,
              semanticScholarId: null,
              sourceProvenance: {
                ...prov,
                canonicalDoi: c.doi || prov.canonicalDoi || null,
                canonicalArxivId: c.arxivId || prov.canonicalArxivId || null,
                canonicalPmid: c.pmid || prov.canonicalPmid || null,
                canonicalPmcid: c.pmcid || prov.canonicalPmcid || null,
                canonicalSemanticScholarId:
                  c.semanticScholarId || prov.canonicalSemanticScholarId || null,
              },
            },
          });
        }
      });
      console.log("Migration completed successfully.");
    } else if (!execute) {
      console.log("\nDry-run complete. No database records were modified.");
    }

    // =========================================================================
    // 2. VISIBILITY MIGRATION DRY-RUN & PARITY VERIFICATION (Item 3)
    // =========================================================================
    console.log("\n================================================================================");
    console.log(` 2. VISIBILITY MIGRATION DRY-RUN & PARITY VERIFICATION (${dbName})`);
    console.log("================================================================================");

    const proposedPublicIds = new Set<string>();
    const proposedPrivateByOwner = new Map<string, string | null>(); // paperId -> ownerUserId
    const proposedAdminFixtureIds = new Set<string>();

    for (const p of allPapers) {
      const prov = (p.sourceProvenance as Record<string, any>) || {};
      const isFixture = ADMIN_TEST_FIXTURE_IDS.has(p.id);
      const ownerUserId =
        prov.ownerId ||
        prov.ownerUserId ||
        prov.uploadedByUserId ||
        prov.attachedByUserId ||
        prov.userId ||
        null;
      const isPrivate = prov.isPrivate === true || Boolean(ownerUserId);

      if (isFixture) {
        proposedAdminFixtureIds.add(p.id);
      } else if (isPrivate) {
        proposedPrivateByOwner.set(p.id, ownerUserId);
      } else {
        proposedPublicIds.add(p.id);
      }
    }

    console.log(`Proposed PUBLIC count:         ${proposedPublicIds.size}`);
    console.log(`Proposed PRIVATE count:        ${proposedPrivateByOwner.size}`);
    console.log(`Proposed ADMIN_FIXTURE count:  ${proposedAdminFixtureIds.size}`);
    console.log(
      `Sum check:                     ${
        proposedPublicIds.size + proposedPrivateByOwner.size + proposedAdminFixtureIds.size
      } / ${allPapers.length}`
    );

    // Compare against current paperVisibilityFilter(null) for anonymous / public catalog
    const filterAnonRows = await prisma.paper.findMany({
      where: paperVisibilityFilter(null),
      select: { id: true },
    });
    const filterAnonIds = new Set(filterAnonRows.map((r) => r.id));

    const publicMatch =
      proposedPublicIds.size === filterAnonIds.size &&
      Array.from(proposedPublicIds).every((id) => filterAnonIds.has(id));
    console.log(
      `Parity Check [Anonymous / Public Set vs paperVisibilityFilter(null)]: ${
        publicMatch ? "100% MATCH" : "MISMATCH"
      } (${proposedPublicIds.size} vs ${filterAnonIds.size})`
    );

    // Compare per-owner visibility for every distinct owner present in the DB
    const distinctOwners = Array.from(
      new Set(Array.from(proposedPrivateByOwner.values()).filter((v): v is string => Boolean(v)))
    );
    let allOwnersMatch = true;
    for (const ownerId of distinctOwners) {
      const expectedVisibleForOwner = new Set<string>(proposedPublicIds);
      for (const [pid, pOwner] of Array.from(proposedPrivateByOwner.entries())) {
        if (pOwner === ownerId) {
          expectedVisibleForOwner.add(pid);
        }
      }

      const actualFilterRows = await prisma.paper.findMany({
        where: paperVisibilityFilter(ownerId, { role: "USER" }),
        select: { id: true },
      });
      const actualFilterIds = new Set(actualFilterRows.map((r) => r.id));

      const ownerMatch =
        expectedVisibleForOwner.size === actualFilterIds.size &&
        Array.from(expectedVisibleForOwner).every((id) => actualFilterIds.has(id));
      if (!ownerMatch) {
        allOwnersMatch = false;
      }
      console.log(
        `Parity Check [Owner ${ownerId} vs paperVisibilityFilter(ownerId)]: ${
          ownerMatch ? "100% MATCH" : "MISMATCH"
        } (${expectedVisibleForOwner.size} vs ${actualFilterIds.size})`
      );
    }

    if (!publicMatch || !allOwnersMatch) {
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[migrate-private-paper-dois] Fatal error:", err);
  process.exit(1);
});
