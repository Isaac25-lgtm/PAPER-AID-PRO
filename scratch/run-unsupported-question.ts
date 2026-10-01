import "./load-env";
import { prisma } from "../src/lib/prisma";
import { synthesizeResearchQuestion } from "../src/lib/synthesis/synthesis-orchestrator";
import * as fs from "fs";

async function main() {
  const user = await prisma.user.findFirst({
    where: { role: "ADMIN" }
  }) || await prisma.user.findFirst();

  if (!user) throw new Error("No user found");

  const unsupportedQuestion = "What was Nvidia's stock price performance during these studies?";

  console.log(`\n==================================================`);
  console.log(`RUNNING UNSUPPORTED QUESTION TEST`);
  console.log(`Question: "${unsupportedQuestion}"`);
  console.log(`==================================================`);

  const result = await synthesizeResearchQuestion({
    question: unsupportedQuestion,
    userId: user.id,
    isNewThread: true,
  });

  fs.writeFileSync("scratch/unsupported-result.json", JSON.stringify(result, null, 2));

  console.log(`Result:`);
  console.log(`  insufficientEvidence: ${result.insufficientEvidence}`);
  console.log(`  claims count: ${result.claims.length}`);
  console.log(`  disagreements count: ${result.disagreements.length}`);
  console.log(`  limitations count: ${result.limitations.length}`);
  console.log(`  selectedPapers: ${result.selectedPapers.length}`);
  console.log(`  libraryScopeNote: "${result.libraryScopeNote}"`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
