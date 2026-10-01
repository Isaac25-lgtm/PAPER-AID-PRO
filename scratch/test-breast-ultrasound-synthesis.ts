import "./load-env";
import { prisma } from "../src/lib/prisma";
import { synthesizeResearchQuestion } from "../src/lib/synthesis/synthesis-orchestrator";

async function runBreastUltrasoundQuery() {
  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN" },
  });

  if (!adminUser) throw new Error("Admin user missing");

  const question = "What methodology and findings does the literature report regarding computer-aided decision support in ultrasound-based breast cancer classification?";
  console.log(`Asking: "${question}"`);

  const result = await synthesizeResearchQuestion({
    question,
    userId: adminUser.id,
    isNewThread: true,
  });

  console.log(`Success: ${result.success}`);
  console.log(`Selected Papers Count: ${result.selectedPapers.length}`);
  for (const p of result.selectedPapers) {
    console.log(`  - [${p.paperId}] ${p.paperTitle} (${p.chunksContributed} chunks)`);
  }
  console.log(`Insufficient Evidence: ${result.insufficientEvidence}`);
  console.log(`Claims Count: ${result.claims.length}`);
  for (let i = 0; i < result.claims.length; i++) {
    const c = result.claims[i];
    console.log(`\nClaim ${i + 1}: "${c.text}" [Supported by ${c.supportingPaperCount} paper(s)]`);
    for (const cit of c.citations) {
      console.log(`  Anchor: Page ${cit.pageNumber}, §${cit.section}: "${cit.snippet.slice(0, 100)}..."`);
    }
  }

  if (result.limitations.length > 0) {
    console.log("\nLimitations:");
    for (const lim of result.limitations) {
      console.log(`  - ${lim.text}`);
    }
  }
}

runBreastUltrasoundQuery().finally(() => prisma.$disconnect());
