import "./load-env";
import { prisma } from "../src/lib/prisma";
import { searchPapersHybrid } from "../src/lib/search/hybrid-search";

async function main() {
  console.log("Query 1: 'fault tolerant quantum error correction'");
  let t0 = Date.now();
  let res = await searchPapersHybrid({ query: "fault tolerant quantum error correction", limit: 3 });
  console.log(`Query 1 time: ${Date.now() - t0}ms, Top paper: ${res.papers[0]?.paper.title} (${res.papers[0]?.matchType}, RRF: ${res.papers[0]?.rrfScore.toFixed(4)})`);
  if (res.papers[0]?.matchedSnippet) {
    console.log(`  Snippet: [${res.papers[0]?.matchedSnippet.section}, p.${res.papers[0]?.matchedSnippet.pageNumber}] "${res.papers[0]?.matchedSnippet.text.slice(0, 80)}..."`);
  }

  console.log("\nQuery 2: 'ultrasound detection of liver abnormalities with deep learning'");
  t0 = Date.now();
  res = await searchPapersHybrid({ query: "ultrasound detection of liver abnormalities with deep learning", limit: 3 });
  console.log(`Query 2 time: ${Date.now() - t0}ms, Top paper: ${res.papers[0]?.paper.title} (${res.papers[0]?.matchType}, RRF: ${res.papers[0]?.rrfScore.toFixed(4)})`);
  if (res.papers[0]?.matchedSnippet) {
    console.log(`  Snippet: [${res.papers[0]?.matchedSnippet.section}, p.${res.papers[0]?.matchedSnippet.pageNumber}] "${res.papers[0]?.matchedSnippet.text.slice(0, 80)}..."`);
  }

  console.log("\nQuery 3: 'AlphaFold 3 molecular interactions'");
  t0 = Date.now();
  res = await searchPapersHybrid({ query: "AlphaFold 3 molecular interactions", limit: 3 });
  console.log(`Query 3 time: ${Date.now() - t0}ms, Top paper: ${res.papers[0]?.paper.title} (${res.papers[0]?.matchType}, RRF: ${res.papers[0]?.rrfScore.toFixed(4)})`);
  if (res.papers[0]?.matchedSnippet) {
    console.log(`  Snippet: [${res.papers[0]?.matchedSnippet.section}, p.${res.papers[0]?.matchedSnippet.pageNumber}] "${res.papers[0]?.matchedSnippet.text.slice(0, 80)}..."`);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
