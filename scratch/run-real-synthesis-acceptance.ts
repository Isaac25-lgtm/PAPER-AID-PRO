import "./load-env";
import { prisma } from "../src/lib/prisma";
import { synthesizeResearchQuestion } from "../src/lib/synthesis/synthesis-orchestrator";

async function runRealLibraryAcceptance() {
  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN" },
  });

  if (!adminUser) {
    throw new Error("Admin user not found");
  }

  console.log("==========================================================");
  console.log("PHASE 8: REAL LIBRARY MULTI-PAPER SYNTHESIS ACCEPTANCE");
  console.log("==========================================================\n");

  const question = "What does the available literature say about AI-assisted ultrasound imaging and classification?";
  console.log(`Asking Real Research Question:\n"${question}"\n`);

  const result = await synthesizeResearchQuestion({
    question,
    userId: adminUser.id,
    isNewThread: true,
  });

  console.log("\n--- Synthesis Result ---");
  console.log(`Success: ${result.success}`);
  console.log(`Conversation ID: ${result.conversationId}`);
  console.log(`Selected Papers Count: ${result.selectedPapers.length}`);
  console.log(`Total Evidence Chunks: ${result.totalEvidenceChunks}`);
  console.log(`Insufficient Evidence: ${result.insufficientEvidence}`);
  console.log(`Claims Count: ${result.claims.length}`);
  console.log(`Disagreements Count: ${result.disagreements.length}`);
  console.log(`Limitations Count: ${result.limitations.length}`);

  console.log("\nSelected Papers Distribution:");
  for (const p of result.selectedPapers) {
    console.log(`- [${p.paperId}] "${p.paperTitle}" -> ${p.chunksContributed} chunks contributed`);
  }

  console.log("\nSynthesized Claims:");
  for (let i = 0; i < result.claims.length; i++) {
    const c = result.claims[i];
    console.log(`\nClaim ${i + 1}:`);
    console.log(`Text: "${c.text}"`);
    console.log(`Supported by: ${c.supportingPaperCount} papers (${c.supportingPaperIds.join(", ")})`);
    console.log(`Citations (${c.citations.length}):`);
    for (const cit of c.citations) {
      console.log(`  - Paper: "${cit.paperTitle}" (Page ${cit.pageNumber}, §${cit.section})`);
      console.log(`    Excerpt: "${cit.snippet.slice(0, 140)}..."`);
    }
  }

  if (result.disagreements.length > 0) {
    console.log("\nDisagreements / Differences:");
    for (const d of result.disagreements) {
      console.log(`- ${d.description} (Papers: ${d.supportingPaperIds.join(", ")})`);
    }
  }

  if (result.limitations.length > 0) {
    console.log("\nLimitations in Available Evidence:");
    for (const lim of result.limitations) {
      console.log(`- ${lim.text} (Papers: ${lim.supportingPaperIds.join(", ")})`);
    }
  }

  return result;
}

runRealLibraryAcceptance()
  .catch((e) => {
    console.error("Error in real acceptance test:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
