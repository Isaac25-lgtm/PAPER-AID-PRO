import "./load-env";
import { prisma } from "../src/lib/prisma";
import { generateEmbedding } from "../src/lib/ai/embeddings";
import { searchPapersHybrid } from "../src/lib/search/hybrid-search";

interface EvalItem {
  type: string;
  query: string;
  expectedPaper: string;
  notes: string;
}

const BENCHMARK_QUERIES: EvalItem[] = [
  {
    type: "Exact Title Query",
    query: "Attention Is All You Need",
    expectedPaper: "Attention Is All You Need",
    notes: "Exact title match boosted by +10.0 exact match policy",
  },
  {
    type: "Exact DOI Query",
    query: "10.1038/s41586-024-07487-w",
    expectedPaper: "Accurate Structure Prediction of Biomolecular Interactions with AlphaFold 3",
    notes: "DOI exact match receives +100.0 absolute priority boost",
  },
  {
    type: "Author Query",
    query: "Ashish Vaswani",
    expectedPaper: "Attention Is All You Need",
    notes: "Author exact match boost ensures primary attribution ranking",
  },
  {
    type: "Keyword Query",
    query: "retrieval-augmented generation dense passage retrieval",
    expectedPaper: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
    notes: "Lexical & semantic overlap in NLP methodology",
  },
  {
    type: "Paraphrased Conceptual Query",
    query: "artificial intelligence detection of liver abnormalities on ultrasound",
    expectedPaper: "THE EFFICACY OF ARTIFICIAL INTELLIGENCE IN IDENTIFYING AND CLASSIFYING ABNORMAL LIVER FINDINGS ON ULTRASOUND IMAGES GENERATED AT MENGO HOSPITAL",
    notes: "High cosine similarity between clinical ultrasound text and query vector",
  },
  {
    type: "Domain Conceptual Query",
    query: "fault tolerant quantum error correction with planar 2D lattices",
    expectedPaper: "Fault-Tolerant Quantum Computation with Surface Codes",
    notes: "Semantic retrieval matches 2D planar array syndrome extraction",
  },
  {
    type: "Terminology Mismatch Query",
    query: "chronic gynecological condition with pelvic pain and endometrial lesions",
    expectedPaper: "ENDOMETRIOSIS",
    notes: "Keyword misses 'endometriosis' exact word, but vector maps clinical symptoms to paper",
  },
];

async function getKeywordOnlyRank(query: string, targetTitle: string): Promise<number | string> {
  const where: any = {
    OR: [
      { title: { contains: query, mode: "insensitive" } },
      { abstract: { contains: query, mode: "insensitive" } },
      { doi: { contains: query, mode: "insensitive" } },
      { keywords: { has: query } },
      { authors: { some: { author: { name: { contains: query, mode: "insensitive" } } } } },
    ],
  };

  const results = await prisma.paper.findMany({
    where,
    orderBy: [{ citationCount: "desc" }, { createdAt: "desc" }],
  });

  const idx = results.findIndex((p) => p.title.toLowerCase().includes(targetTitle.toLowerCase()));
  return idx >= 0 ? idx + 1 : "> 5 (No Match)";
}

async function getSemanticOnlyRank(query: string, targetTitle: string): Promise<number | string> {
  const queryVec = await generateEmbedding(query);
  const vectorString = `[${queryVec.join(",")}]`;

  const rawChunks: any[] = await prisma.$queryRaw`
    SELECT c."paperId", p.title, 1 - (c.embedding <=> ${vectorString}::vector) as similarity
    FROM "paper_chunks" c
    JOIN "papers" p ON c."paperId" = p.id
    WHERE c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${vectorString}::vector ASC;
  `;

  // Deduplicate papers in semantic ranking
  const seen = new Set<string>();
  const rankedPapers: string[] = [];
  for (const c of rawChunks) {
    if (!seen.has(c.paperId)) {
      seen.add(c.paperId);
      rankedPapers.push(c.title);
    }
  }

  const idx = rankedPapers.findIndex((t) => t.toLowerCase().includes(targetTitle.toLowerCase()));
  return idx >= 0 ? idx + 1 : "> 5 (No Match)";
}

async function main() {
  console.log("Generating Retrieval Evaluation Benchmark Table...\n");
  const rows: any[] = [];

  for (const item of BENCHMARK_QUERIES) {
    const kwRank = await getKeywordOnlyRank(item.query, item.expectedPaper);
    const semRank = await getSemanticOnlyRank(item.query, item.expectedPaper);
    const hybridRes = await searchPapersHybrid({ query: item.query, limit: 5 });

    let hybridRank: number | string = "> 5";
    for (let i = 0; i < hybridRes.papers.length; i++) {
      if (hybridRes.papers[i].paper.title.toLowerCase().includes(item.expectedPaper.toLowerCase())) {
        hybridRank = i + 1;
        break;
      }
    }

    rows.push({
      "Query": `"${item.query}"`,
      "Type": item.type,
      "Expected Paper": item.expectedPaper.slice(0, 35) + "...",
      "Keyword Rank": String(kwRank),
      "Semantic Rank": String(semRank),
      "Hybrid Rank": String(hybridRank),
      "In Top 1": hybridRank === 1 ? "✅ Yes" : "No",
      "Notes": item.notes,
    });
  }

  console.table(rows);

  console.log("\n### Markdown Formatted Table for Final Report:\n");
  console.log("| Query | Type | Expected Paper | Keyword Rank | Semantic Rank | Hybrid Rank | Notes |");
  console.log("| :--- | :--- | :--- | :---: | :---: | :---: | :--- |");
  for (const r of rows) {
    console.log(`| ${r.Query} | ${r.Type} | ${r["Expected Paper"]} | ${r["Keyword Rank"]} | ${r["Semantic Rank"]} | **${r["Hybrid Rank"]}** | ${r.Notes} |`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Benchmark error:", err);
  process.exit(1);
});
