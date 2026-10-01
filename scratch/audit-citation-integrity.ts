import "./load-env";
import { prisma } from "../src/lib/prisma";
import { validateMultiPaperSynthesis } from "../src/lib/synthesis/validate-multipaper-citations";
import { DiscoveredPaper, RetrievedEvidenceChunk } from "../src/lib/synthesis/types";
import { MultiPaperSynthesisOutput } from "../src/lib/synthesis/schemas";
import * as fs from "fs";

async function main() {
  console.log("==================================================");
  console.log("SECTION 13: CITATION INTEGRITY AUDIT");
  console.log("==================================================");

  // Load results from Turn 1
  const turn1 = JSON.parse(fs.readFileSync("scratch/turn1-synthesis-result.json", "utf-8"));
  const turn2 = JSON.parse(fs.readFileSync("scratch/turn2-followup-result.json", "utf-8"));

  // 1. One claim supported by 1 paper: Turn 1 Claim 1
  const claim1Paper = turn1.claims[0];
  console.log(`\nAudit 1: Claim supported by 1 paper:`);
  console.log(`  Text: "${claim1Paper.text}"`);
  console.log(`  Supporting papers: ${claim1Paper.supportingPaperCount}`);
  for (const cit of claim1Paper.citations) {
    const dbChunk = await prisma.paperChunk.findUnique({
      where: { id: cit.chunkId },
      include: { paper: true }
    });
    console.log(`    Chunk: ${cit.chunkId}`);
    console.log(`    DB chunk exists: ${!!dbChunk}`);
    console.log(`    DB chunk.paperId === citation.paperId: ${dbChunk?.paperId === cit.paperId}`);
    console.log(`    DB page (${dbChunk?.pageNumber}) === cit page (${cit.pageNumber}): ${dbChunk?.pageNumber === cit.pageNumber}`);
    console.log(`    DB section (${dbChunk?.section}) === cit section (${cit.section}): ${dbChunk?.section === cit.section}`);
    console.log(`    DB snippet matches start of DB text: ${dbChunk?.text.startsWith(cit.snippet.slice(0, 30))}`);
  }

  // 2. One claim supported by >=2 papers: Turn 1 Claim 2
  const claimMultiPaper = turn1.claims.find((c: any) => c.supportingPaperCount >= 2) || turn1.claims[1];
  console.log(`\nAudit 2: Claim supported by >=2 papers:`);
  console.log(`  Text: "${claimMultiPaper.text}"`);
  console.log(`  Supporting papers: ${claimMultiPaper.supportingPaperCount}`);
  for (const cit of claimMultiPaper.citations) {
    const dbChunk = await prisma.paperChunk.findUnique({
      where: { id: cit.chunkId },
      include: { paper: true }
    });
    console.log(`    Chunk: ${cit.chunkId} (Paper: ${cit.paperId})`);
    console.log(`    DB chunk exists: ${!!dbChunk}`);
    console.log(`    DB chunk.paperId === citation.paperId: ${dbChunk?.paperId === cit.paperId}`);
    console.log(`    DB page (${dbChunk?.pageNumber}) === cit page (${cit.pageNumber}): ${dbChunk?.pageNumber === cit.pageNumber}`);
    console.log(`    DB section (${dbChunk?.section}) === cit section (${cit.section}): ${dbChunk?.section === cit.section}`);
    console.log(`    DB snippet matches DB text: ${dbChunk?.text.includes(cit.snippet.slice(0, 30))}`);
  }

  // 3. One limitations claim: Turn 1 limitation 1 or Turn 2 claim 2
  const limClaim = turn1.limitations[0] || turn2.claims[1];
  console.log(`\nAudit 3: Limitations claim:`);
  console.log(`  Text: "${limClaim.text}"`);
  for (const cit of limClaim.citations) {
    const dbChunk = await prisma.paperChunk.findUnique({
      where: { id: cit.chunkId },
      include: { paper: true }
    });
    console.log(`    Chunk: ${cit.chunkId}`);
    console.log(`    DB chunk exists: ${!!dbChunk}`);
    console.log(`    DB chunk.paperId === citation.paperId: ${dbChunk?.paperId === cit.paperId}`);
    console.log(`    DB page (${dbChunk?.pageNumber}) === cit page (${cit.pageNumber}): ${dbChunk?.pageNumber === cit.pageNumber}`);
    console.log(`    DB section (${dbChunk?.section}) === cit section (${cit.section}): ${dbChunk?.section === cit.section}`);
  }

  // 4. One follow-up claim: Turn 2 Claim 3
  const followupClaim = turn2.claims[2];
  console.log(`\nAudit 4: Follow-up claim:`);
  console.log(`  Text: "${followupClaim.text}"`);
  for (const cit of followupClaim.citations) {
    const dbChunk = await prisma.paperChunk.findUnique({
      where: { id: cit.chunkId },
      include: { paper: true }
    });
    console.log(`    Chunk: ${cit.chunkId}`);
    console.log(`    DB chunk exists: ${!!dbChunk}`);
    console.log(`    DB chunk.paperId === citation.paperId: ${dbChunk?.paperId === cit.paperId}`);
    console.log(`    DB page (${dbChunk?.pageNumber}) === cit page (${cit.pageNumber}): ${dbChunk?.pageNumber === cit.pageNumber}`);
    console.log(`    DB section (${dbChunk?.section}) === cit section (${cit.section}): ${dbChunk?.section === cit.section}`);
  }

  console.log(`\n==================================================`);
  console.log(`CONTROLLED VALIDATOR SECURITY TESTS`);
  console.log(`==================================================`);

  // Setup fixtures
  const selectedPaper: DiscoveredPaper = {
    paperId: "cmumgtiix0000vr445cn8ry7o",
    title: "Influence of the Computer-Aided Decision Support System Design",
    authors: ["Zuzanna Magnuska"],
    doi: "10.3390/cancers14020277",
    publicationDate: "2022-06-01",
    journal: "Cancers",
    citationCount: 10,
    relevanceScore: 0.70,
    bestChunkSimilarity: 0.70,
    matchingChunksCount: 4,
    bestChunkSnippet: "sample",
    bestChunkPage: 14,
    bestChunkSection: "Methods"
  };

  const retrievedChunk: RetrievedEvidenceChunk = {
    chunkId: "cmumgu5fb002pvr44qni8eswc",
    paperId: "cmumgtiix0000vr445cn8ry7o",
    paperTitle: "Influence of the Computer-Aided Decision Support System Design",
    chunkIndex: 52,
    section: "Methods",
    pageNumber: 14,
    text: "Cancers 2022, 14, 277 14 of 21 3.4. Breast Lesion Classification",
    tokenCount: 150,
    similarity: 0.7036
  };

  // Another real chunk from the same paper that is NOT in the retrieved set
  const nonRetrievedChunk = await prisma.paperChunk.findFirst({
    where: {
      paperId: "cmumgtiix0000vr445cn8ry7o",
      id: { not: retrievedChunk.chunkId }
    }
  });

  // Another real paper
  const otherPaperId = "cmunxw9il00dnvrus7w9mqij9";

  const evidenceSet = {
    paperId: selectedPaper.paperId,
    paperTitle: selectedPaper.title,
    authors: ["Author A"],
    doi: selectedPaper.doi,
    publicationDate: selectedPaper.publicationDate,
    journal: selectedPaper.journal,
    chunks: [
      {
        id: retrievedChunk.chunkId,
        chunkIndex: retrievedChunk.chunkIndex,
        section: retrievedChunk.section,
        pageNumber: retrievedChunk.pageNumber,
        text: retrievedChunk.text
      }
    ]
  };

  // Test A: Fabricated chunk ID
  console.log(`\nTest A: Model references fabricated chunk ID:`);
  const rawOutputA: MultiPaperSynthesisOutput = {
    claims: [
      {
        text: "Fabricated chunk claim",
        evidence: [{ paperId: selectedPaper.paperId, chunkIds: ["chunk_fabricated_99999"] }]
      }
    ],
    disagreements: [],
    limitations: [],
    insufficientEvidence: false
  };
  const valA = validateMultiPaperSynthesis(rawOutputA, [evidenceSet as any]);
  console.log(`  Retained claims: ${valA.claims.length} (expected 0)`);
  console.log(`  Rejected citations: ${valA.rejectedCitationCount} (expected 1)`);
  console.log(`  Claim dropped completely: ${valA.claims.length === 0 ? "PASSED" : "FAILED"}`);

  // Test B: Valid chunk ID assigned to WRONG paper
  console.log(`\nTest B: Model assigns valid chunk ID to wrong paperId:`);
  const rawOutputB: MultiPaperSynthesisOutput = {
    claims: [
      {
        text: "Cross-paper spoofing claim",
        evidence: [{ paperId: otherPaperId, chunkIds: [retrievedChunk.chunkId] }]
      }
    ],
    disagreements: [],
    limitations: [],
    insufficientEvidence: false
  };
  const valB = validateMultiPaperSynthesis(rawOutputB, [evidenceSet as any]);
  console.log(`  Retained claims: ${valB.claims.length} (expected 0)`);
  console.log(`  Rejected citations: ${valB.rejectedCitationCount} (expected 1)`);
  console.log(`  Cross-paper spoof rejected: ${valB.claims.length === 0 ? "PASSED" : "FAILED"}`);

  // Test C: Valid same-paper chunk that was NOT retrieved
  console.log(`\nTest C: Model cites valid DB chunk from same paper that was NOT in retrieved evidence:`);
  const rawOutputC: MultiPaperSynthesisOutput = {
    claims: [
      {
        text: "Non-retrieved chunk claim",
        evidence: [{ paperId: selectedPaper.paperId, chunkIds: [nonRetrievedChunk!.id] }]
      }
    ],
    disagreements: [],
    limitations: [],
    insufficientEvidence: false
  };
  const valC = validateMultiPaperSynthesis(rawOutputC, [evidenceSet as any]);
  console.log(`  Retained claims: ${valC.claims.length} (expected 0)`);
  console.log(`  Rejected citations: ${valC.rejectedCitationCount} (expected 1)`);
  console.log(`  Non-retrieved chunk rejected: ${valC.claims.length === 0 ? "PASSED" : "FAILED"}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
