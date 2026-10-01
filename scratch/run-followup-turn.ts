import "./load-env";
import { prisma } from "../src/lib/prisma";
import { synthesizeResearchQuestion } from "../src/lib/synthesis/synthesis-orchestrator";
import * as fs from "fs";

async function main() {
  const conversationId = "cmunyibra0001vrtsh5jqwxhb";
  const user = await prisma.user.findFirst({
    where: { role: "ADMIN" }
  }) || await prisma.user.findFirst();

  if (!user) throw new Error("No user found");

  const followupQuestion = "What limitations across these studies should be considered when interpreting those findings?";

  console.log(`\n==================================================`);
  console.log(`RUNNING TURN 2: FOLLOW-UP LIMITATIONS QUESTION`);
  console.log(`Conversation ID: ${conversationId}`);
  console.log(`Question: "${followupQuestion}"`);
  console.log(`==================================================`);

  const result = await synthesizeResearchQuestion({
    question: followupQuestion,
    userId: user.id,
    conversationId,
    isNewThread: false,
  });

  fs.writeFileSync("scratch/turn2-followup-result.json", JSON.stringify(result, null, 2));

  console.log(`\nTurn 2 completed!`);
  console.log(`Insufficient evidence: ${result.insufficientEvidence}`);
  console.log(`Selected Papers: ${result.selectedPapers.length}`);
  console.log(`Retained Claims: ${result.claims.length}`);
  console.log(`Limitations: ${result.limitations.length}`);

  for (let i = 0; i < result.claims.length; i++) {
    const cl = result.claims[i];
    console.log(`\nClaim ${i + 1} (${cl.supportingPaperCount} papers): "${cl.text}"`);
    for (const cit of cl.citations) {
      console.log(`  - [${cit.paperId}] p.${cit.pageNumber} (${cit.section}) [${cit.chunkId}]: "${cit.snippet.slice(0, 70)}..."`);
    }
  }

  for (let i = 0; i < result.limitations.length; i++) {
    const lim = result.limitations[i];
    console.log(`\nLimitation ${i + 1} (${lim.supportingPaperIds.length} papers): "${lim.text}"`);
    for (const cit of lim.citations) {
      console.log(`  - [${cit.paperId}] p.${cit.pageNumber} (${cit.section}) [${cit.chunkId}]: "${cit.snippet.slice(0, 70)}..."`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
