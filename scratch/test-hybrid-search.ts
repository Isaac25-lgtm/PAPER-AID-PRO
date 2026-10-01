import * as fs from "fs";
import * as path from "path";

// Load .env
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

import { prisma } from "../src/lib/prisma";
import { searchPapersHybrid } from "../src/lib/search/hybrid-search";

interface EvalQuery {
  query: string;
  expectedTitleSubstr: string;
  type: string;
}

const EVAL_QUERIES: EvalQuery[] = [
  {
    type: "Exact Title",
    query: "Attention Is All You Need",
    expectedTitleSubstr: "Attention Is All You Need",
  },
  {
    type: "Exact DOI",
    query: "10.1038/s41586-024-07487-w",
    expectedTitleSubstr: "AlphaFold 3",
  },
  {
    type: "Author Query",
    query: "Ashish Vaswani",
    expectedTitleSubstr: "Attention Is All You Need",
  },
  {
    type: "Keyword Search",
    query: "retrieval-augmented generation dense passage retrieval",
    expectedTitleSubstr: "Retrieval-Augmented Generation",
  },
  {
    type: "Conceptual / Paraphrased",
    query: "deep learning algorithms for detecting liver abnormalities in ultrasound",
    expectedTitleSubstr: "LIVER FINDINGS",
  },
  {
    type: "Conceptual / Domain",
    query: "fault tolerant quantum error correction with 2D lattices",
    expectedTitleSubstr: "Surface Codes",
  },
  {
    type: "Terminology Mismatch",
    query: "chronic gynecological condition with pelvic pain and endometrial lesions",
    expectedTitleSubstr: "ENDOMETRIOSIS",
  },
];

async function main() {
  console.log("=================================================");
  console.log("PHASE 6: HYBRID SEMANTIC SEARCH EVALUATION SUITE");
  console.log("=================================================\n");

  const resultsTable: any[] = [];

  for (const q of EVAL_QUERIES) {
    const res = await searchPapersHybrid({ query: q.query, limit: 5 });

    let matchRank: number | string = "Not in Top 5";
    let matchedPaperTitle = "None";
    let matchedSnippetDesc = "None";

    for (let i = 0; i < res.papers.length; i++) {
      const p = res.papers[i];
      if (p.paper.title.toLowerCase().includes(q.expectedTitleSubstr.toLowerCase())) {
        matchRank = i + 1;
        matchedPaperTitle = p.paper.title;
        if (p.matchedSnippet) {
          matchedSnippetDesc = `[${p.matchedSnippet.section}, p.${p.matchedSnippet.pageNumber}] "${p.matchedSnippet.text.slice(0, 70)}..." (sim: ${p.matchedSnippet.similarity.toFixed(3)})`;
        }
        break;
      }
    }

    const topResult = res.papers[0];
    resultsTable.push({
      Query: q.query,
      Type: q.type,
      "Expected Paper": q.expectedTitleSubstr,
      "Rank 1 Result": topResult ? topResult.paper.title.slice(0, 35) + "..." : "None",
      "Expected In Top 1": matchRank === 1 ? "✅ YES" : "❌ NO",
      "Match Rank": matchRank,
      "Match Type": topResult?.matchType,
      "RRF Score": topResult?.rrfScore.toFixed(4),
      Snippet: matchedSnippetDesc,
    });
  }

  console.table(resultsTable);

  console.log("\n--- Testing Graceful Fallback (OpenAI failure simulation) ---");
  const originalKey = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = "sk-invalid-key-for-testing-fallback";
    // Clear cached client if any
    const fallbackRes = await searchPapersHybrid({ query: "Attention", limit: 3 });
    console.log("Fallback search returned papers count:", fallbackRes.papers.length);
    console.log("Is fallback flagged:", fallbackRes.isFallback);
    console.log("Top paper on fallback:", fallbackRes.papers[0]?.paper.title);
    if (!fallbackRes.isFallback || fallbackRes.papers.length === 0) {
      throw new Error("Fallback mechanism did not engage properly.");
    }
    console.log("✅ Fallback successfully engaged and preserved search functionality!");
  } finally {
    process.env.OPENAI_API_KEY = originalKey;
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Evaluation error:", err);
  process.exit(1);
});
