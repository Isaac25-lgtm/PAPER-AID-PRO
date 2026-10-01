import "./load-env";
import { prisma } from "../src/lib/prisma";
import { searchPapersHybrid } from "../src/lib/search/hybrid-search";

async function main() {
  console.log("=== Testing Single Hybrid Search Query ===");
  console.log("Query: 'Attention Is All You Need'");
  const t0 = Date.now();
  const res = await searchPapersHybrid({ query: "Attention Is All You Need", limit: 5 });
  console.log(`Execution time: ${Date.now() - t0}ms, Papers returned: ${res.papers.length}`);
  for (const item of res.papers) {
    console.log(`- [${item.matchType}] ${item.paper.title} (RRF: ${item.rrfScore.toFixed(4)}, Lex: ${item.lexicalRank}, Sem: ${item.semanticRank})`);
    if (item.matchedSnippet) {
      console.log(`  Snippet (${item.matchedSnippet.section}, p.${item.matchedSnippet.pageNumber}): "${item.matchedSnippet.text.slice(0, 80)}..."`);
    }
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
