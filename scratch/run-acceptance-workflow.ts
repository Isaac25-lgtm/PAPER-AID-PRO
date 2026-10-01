import "./load-env";
import { prisma } from "../src/lib/prisma";
import { synthesizeResearchQuestion } from "../src/lib/synthesis/synthesis-orchestrator";
import { discoverRelevantPapers } from "../src/lib/synthesis/discover-papers";
import { retrieveMultiPaperEvidence } from "../src/lib/synthesis/retrieve-multipaper-evidence";
import { generateEmbeddingsBatch } from "../src/lib/ai/embeddings";
import * as fs from "fs";

async function main() {
  const user = await prisma.user.findFirst({
    where: { role: "ADMIN" }
  }) || await prisma.user.findFirst();

  if (!user) {
    throw new Error("No user found in database!");
  }

  console.log(`Using user [${user.id}] ${user.email} (${user.role}) for Phase 8.1 acceptance test.`);

  const question = "What does the available evidence in this library show about the performance and clinical value of artificial intelligence or computer-aided systems for classifying breast lesions on ultrasound?";

  console.log(`\n==================================================`);
  console.log(`RUNNING DISCOVERY AUDIT MANUALLY FIRST`);
  console.log(`Question: "${question}"`);
  console.log(`==================================================`);

  const discoveryResult = await discoverRelevantPapers(question, { candidateLimit: 20 });
  const candidates = discoveryResult.candidatePapers;
  const selected = discoveryResult.selectedPapers;

  console.log(`\nFound ${candidates.length} candidates from discoverRelevantPapers:`);
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    console.log(`  Rank ${i + 1}: [${c.paperId}] score=${c.relevanceScore.toFixed(4)} bestChunkSim=${c.bestChunkSimilarity.toFixed(4)} title="${c.title}"`);
  }

  console.log(`\n==================================================`);
  console.log(`RUNNING EVIDENCE RETRIEVAL AUDIT ON SELECTED PAPERS (${selected.length})`);
  console.log(`==================================================`);
  const evidence = await retrieveMultiPaperEvidence(selected, question, {
    queryVector: discoveryResult.queryVector,
    chunksPerPaper: 4,
    maxTotalChunks: 20
  });

  console.log(`Retrieved ${evidence.totalChunks} total evidence chunks across ${evidence.evidenceSets.length} papers:`);
  for (const es of evidence.evidenceSets) {
    console.log(`  Paper [${es.paperId}]: ${es.chunks.length} chunks | "${es.paperTitle}"`);
  }

  for (const ch of evidence.allChunks) {
    console.log(`    Chunk [${ch.id}] Paper=[${ch.paperId}] idx=${ch.chunkIndex} p.${ch.pageNumber} sec="${ch.section}" sim=${ch.similarity?.toFixed(4)}: "${ch.text.slice(0, 80).replace(/\n/g, ' ')}..."`);
  }

  console.log(`\n==================================================`);
  console.log(`RUNNING FULL SYNTHESIZE ORCHESTRATOR`);
  console.log(`==================================================`);

  const result = await synthesizeResearchQuestion({
    question,
    userId: user.id,
    isNewThread: true,
  });

  fs.writeFileSync("scratch/turn1-synthesis-result.json", JSON.stringify(result, null, 2));

  console.log(`Synthesis complete! Conversation ID: ${result.conversationId}`);
  console.log(`Insufficient Evidence: ${result.insufficientEvidence}`);
  console.log(`Selected Papers: ${result.selectedPapers.length}`);
  console.log(`Retained Claims: ${result.claims.length}`);
  console.log(`Disagreements: ${result.disagreements.length}`);
  console.log(`Limitations: ${result.limitations.length}`);

  for (let i = 0; i < result.claims.length; i++) {
    const cl = result.claims[i];
    console.log(`\nClaim ${i + 1} (${cl.supportingPaperCount} papers): "${cl.text}"`);
    console.log(`  Supporting Paper IDs: ${cl.supportingPaperIds.join(", ")}`);
    console.log(`  Citations (${cl.citations.length}):`);
    for (const cit of cl.citations) {
      console.log(`    - [${cit.paperId}] p.${cit.pageNumber} (${cit.section}) [${cit.chunkId}]: "${cit.snippet.slice(0, 70)}..."`);
    }
  }

  if (result.disagreements.length > 0) {
    console.log(`\nDisagreements:`);
    for (const d of result.disagreements) {
      console.log(`  - "${d.description}" (supported by ${d.supportingPaperIds.length} papers)`);
    }
  }

  if (result.limitations.length > 0) {
    console.log(`\nLimitations:`);
    for (const l of result.limitations) {
      console.log(`  - "${l.text}" (supported by ${l.supportingPaperIds.length} papers)`);
    }
  }

  return { conversationId: result.conversationId, userId: user.id };
}

main().catch(console.error).finally(() => prisma.$disconnect());
