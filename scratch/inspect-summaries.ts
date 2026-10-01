import { prisma } from "../src/lib/prisma";

async function inspectSummaries() {
  const summaries = await prisma.aISummary.findMany({
    include: {
      paper: {
        select: { id: true, title: true },
      },
    },
  });

  console.log("Existing AISummary records count:", summaries.length);
  for (const s of summaries) {
    console.log("--- Summary ---");
    console.log("ID:", s.id);
    console.log("Paper:", s.paper.title, `(${s.paperId})`);
    console.log("Model:", s.modelUsed);
    console.log("Prompt:", s.promptVersion);
    console.log("Key Findings count:", s.keyFindings.length);
    console.log("Citations payload:", s.citations ? "PRESENT" : "NULL");
  }
}

inspectSummaries()
  .catch((err) => {
    console.error("Error inspecting summaries:", err);
  })
  .finally(() => prisma.$disconnect());
