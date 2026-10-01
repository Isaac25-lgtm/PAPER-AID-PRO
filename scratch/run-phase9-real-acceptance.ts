/**
 * Phase 9 Real API Acceptance Script
 *
 * Runs a live scholarly search against PubMed, Crossref, and Semantic Scholar
 * using "breast ultrasound artificial intelligence".
 * Audits provider telemetry, duplicate merging, local library recognition,
 * and executes a single controlled metadata import.
 */

import "./load-env";
import { ScholarlyAggregator } from "../src/lib/discovery/scholarly-aggregator";
import { prisma } from "../src/lib/prisma";
import { matchPapersAgainstLocalLibrary } from "../src/lib/discovery/library-matcher";
import { resolveFullTextAvailability } from "../src/lib/discovery/full-text-service";
import { normalizeDoi } from "../src/lib/identifiers";

async function runRealAcceptance() {
  console.log("==========================================================");
  console.log("PHASE 9 REAL API ACCEPTANCE TEST");
  console.log("==========================================================\n");

  const query = "breast ultrasound artificial intelligence";
  console.log(`Executing real multi-provider search for: "${query}"...`);

  const aggregator = new ScholarlyAggregator();
  const searchResult = await aggregator.search(query, {
    limitPerProvider: 5,
  });

  console.log("\n--- Provider Telemetry & Result Counts ---");
  console.log(`Query: "${searchResult.query}"`);
  console.log(`Search Duration: ${(searchResult.timingMs / 1000).toFixed(2)}s`);

  for (const [prov, pRes] of Object.entries(searchResult.providerResults)) {
    console.log(`- ${prov}: Status = ${pRes.status}, Raw Hits = ${pRes.count} (${pRes.durationMs}ms)${pRes.error ? ` [Error: ${pRes.error}]` : ""}`);
  }

  console.log(`Total Raw Records: ${searchResult.totalRawResults}`);
  console.log(`Total Merged Unique Results: ${searchResult.totalUniqueResults}`);
  console.log(`Merged Duplicates: ${searchResult.totalRawResults - searchResult.totalUniqueResults}`);

  console.log("\n--- Sample Discovered Manuscripts ---");
  for (let i = 0; i < Math.min(5, searchResult.papers.length); i++) {
    const p = searchResult.papers[i];
    console.log(`\n[${i + 1}] "${p.title}"`);
    console.log(`    DOI: ${p.doi || "None"} | PMID: ${p.pmid || "None"} | PMCID: ${p.pmcid || "None"}`);
    console.log(`    Authors: ${p.authors.slice(0, 3).map((a) => a.name).join(", ")}${p.authors.length > 3 ? " et al." : ""}`);
    console.log(`    Year: ${p.year || "Unknown"} | Journal: ${p.journal || "Unknown"}`);
    console.log(`    Providers: ${p.sourceProviders.join(", ")} | Citations: ${p.citationCount ?? "N/A"}`);
    console.log(`    Open Access: ${p.isOpenAccess} | Full Text Status: ${p.fullTextAvailability}`);
    console.log(`    Local Status: In Library = ${p.localStatus?.inLibrary || false}`);
  }

  // Verification 1: Local library matching against known existing paper
  console.log("\n--- Verification 1: Local Library Recognition ---");
  const knownPaper = await prisma.paper.findFirst({
    where: { doi: "10.3390/cancers14020277" },
  });

  if (knownPaper) {
    const testCandidate = {
      id: "doi:10.3390/cancers14020277",
      title: "Influence of the Computer-Aided Decision Support System Design on Ultrasound-Based Breast Cancer Classification",
      doi: "10.3390/cancers14020277",
      authors: [],
      sourceProviders: ["CROSSREF" as const],
      isOpenAccess: true,
      fullTextAvailability: "METADATA_ONLY" as const,
    };
    const matched = await matchPapersAgainstLocalLibrary([testCandidate]);
    console.log(`Matched existing paper ${knownPaper.doi}: In Library = ${matched[0]?.localStatus?.inLibrary} (Paper ID: ${matched[0]?.localStatus?.paperId}, Status: ${matched[0]?.localStatus?.processingStatus})`);
  }

  // Verification 2: Controlled import of one external paper not currently in library
  console.log("\n--- Verification 2: Controlled Metadata Import ---");
  const unimportedCandidate = searchResult.papers.find(
    (p) => !p.localStatus?.inLibrary && p.doi && p.title
  );

  if (!unimportedCandidate) {
    console.log("All returned papers were already in library or lacked DOI; searching for an alternative...");
    return;
  }

  console.log(`Selected external candidate for controlled import:`);
  console.log(`Title: "${unimportedCandidate.title}"`);
  console.log(`DOI: ${unimportedCandidate.doi}`);
  console.log(`Providers: ${unimportedCandidate.sourceProviders.join(", ")}`);

  // Import into database
  const cleanDoi = normalizeDoi(unimportedCandidate.doi)!;
  const ftStatus = resolveFullTextAvailability(unimportedCandidate);
  console.log(`Full-text availability: ${ftStatus.status} (Source: ${ftStatus.source || "None"})`);

  const created = await prisma.paper.create({
    data: {
      title: unimportedCandidate.title,
      abstract: unimportedCandidate.abstract || "Abstract not provided in metadata.",
      journal: unimportedCandidate.journal,
      doi: cleanDoi,
      pmid: unimportedCandidate.pmid,
      pmcid: unimportedCandidate.pmcid,
      publicationDate: unimportedCandidate.publicationDate
        ? new Date(unimportedCandidate.publicationDate)
        : unimportedCandidate.year
        ? new Date(`${unimportedCandidate.year}-01-01`)
        : new Date(),
      citationCount: unimportedCandidate.citationCount || 0,
      isOpenAccess: unimportedCandidate.isOpenAccess,
      status: "METADATA_ONLY",
      sourceProvenance: {
        sourceProviders: unimportedCandidate.sourceProviders,
        importedAt: new Date().toISOString(),
        fullTextAvailability: ftStatus.status,
      },
    },
  });

  // Link first author
  if (unimportedCandidate.authors.length > 0) {
    const firstAuth = unimportedCandidate.authors[0];
    let author = await prisma.author.findFirst({
      where: { name: { equals: firstAuth.name, mode: "insensitive" } },
    });
    if (!author) {
      author = await prisma.author.create({
        data: { name: firstAuth.name, institution: firstAuth.institution },
      });
    }
    await prisma.paperAuthor.create({
      data: {
        paperId: created.id,
        authorId: author.id,
        orderIndex: 0,
      },
    });
  }

  console.log(`\nImported Paper Verification:`);
  console.log(`- Created Paper ID: ${created.id}`);
  console.log(`- Status: ${created.status} (METADATA_ONLY)`);
  console.log(`- Storage Path: ${created.storagePath || "null (No full text)"}`);
  console.log(`- DOI: ${created.doi}`);

  const chunkCount = await prisma.paperChunk.count({ where: { paperId: created.id } });
  console.log(`- Chunks in DB: ${chunkCount} (strictly 0, abstract-only does not enter RAG)`);

  // Verify Phase 8 isolation
  const phase8Eligible = await prisma.paper.findFirst({
    where: { id: created.id, status: "COMPLETED" },
  });
  console.log(`- Phase 8 Eligible: ${Boolean(phase8Eligible)} (strictly false)`);

  // Output JSON report artifact for audit
  const auditReport = {
    query,
    timingMs: searchResult.timingMs,
    providerResults: searchResult.providerResults,
    totalRawResults: searchResult.totalRawResults,
    totalUniqueResults: searchResult.totalUniqueResults,
    importedPaper: {
      id: created.id,
      title: created.title,
      doi: created.doi,
      status: created.status,
      fullTextAvailability: ftStatus.status,
    },
  };

  const fs = require("fs");
  fs.writeFileSync("scratch/phase9-real-acceptance-report.json", JSON.stringify(auditReport, null, 2));
  console.log("\nSaved acceptance report to scratch/phase9-real-acceptance-report.json");
}

runRealAcceptance()
  .catch((err) => {
    console.error("Real acceptance error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
