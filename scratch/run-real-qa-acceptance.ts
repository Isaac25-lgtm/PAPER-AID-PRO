import "./load-env";
import { prisma } from "../src/lib/prisma";
import { askPaperQuestion } from "../src/lib/rag/qa-orchestrator";

async function runAcceptanceTests() {
  const paperId = "cmumgtiix0000vr445cn8ry7o";
  const userId = "cmugpaox00016vrlg4wnflfb0"; // Admin user

  console.log("==========================================================");
  console.log("PHASE 7.2: REAL MULTI-PAGE MANUSCRIPT Q&A ACCEPTANCE");
  console.log("==========================================================\n");

  const results: any = {};

  // 1. Question A: Methodology
  console.log("\n--- Question A: Methodology ---");
  console.log("Asking: 'What methodology did the researchers use?'");
  const qA = await askPaperQuestion({
    paperId,
    question: "What methodology did the researchers use?",
    userId,
    isNewThread: true,
  });
  console.log("Answer A (Methodology):", qA.answer);
  console.log("Insufficient Evidence:", qA.insufficientEvidence);
  console.log(`Claims (${qA.claims?.length || 0}):`);
  qA.claims?.forEach((c, i) => {
    console.log(`  Claim ${i + 1}: "${c.text}" [${c.citations.map((a) => `P.${a.pageNumber} §${a.section}`).join(", ")}]`);
  });
  console.log(`Citations (${qA.citations.length}):`);
  qA.citations.forEach((c, i) => {
    console.log(`  [${i + 1}] Chunk ${c.chunkIndex} (Page ${c.pageNumber}, §${c.section}): "${c.snippet.slice(0, 150)}..."`);
  });
  results.qA = qA;

  // 2. Question B: Results
  console.log("\n--- Question B: Results ---");
  console.log("Asking: 'What were the main findings of this study?'");
  const qB = await askPaperQuestion({
    paperId,
    question: "What were the main findings of this study?",
    userId,
    isNewThread: true,
  });
  console.log("Answer B (Results):", qB.answer);
  console.log("Insufficient Evidence:", qB.insufficientEvidence);
  console.log(`Claims (${qB.claims?.length || 0}):`);
  qB.claims?.forEach((c, i) => {
    console.log(`  Claim ${i + 1}: "${c.text}" [${c.citations.map((a) => `P.${a.pageNumber} §${a.section}`).join(", ")}]`);
  });
  console.log(`Citations (${qB.citations.length}):`);
  qB.citations.forEach((c, i) => {
    console.log(`  [${i + 1}] Chunk ${c.chunkIndex} (Page ${c.pageNumber}, §${c.section}): "${c.snippet.slice(0, 150)}..."`);
  });
  results.qB = qB;

  // 3. Question C: Limitations
  console.log("\n--- Question C: Limitations ---");
  console.log("Asking: 'What limitations did the authors report?'");
  const qC = await askPaperQuestion({
    paperId,
    question: "What limitations did the authors report?",
    userId,
    isNewThread: true,
  });
  console.log("Answer C (Limitations):", qC.answer);
  console.log("Insufficient Evidence:", qC.insufficientEvidence);
  console.log(`Claims (${qC.claims?.length || 0}):`);
  qC.claims?.forEach((c, i) => {
    console.log(`  Claim ${i + 1}: "${c.text}" [${c.citations.map((a) => `P.${a.pageNumber} §${a.section}`).join(", ")}]`);
  });
  console.log(`Citations (${qC.citations.length}):`);
  qC.citations.forEach((c, i) => {
    console.log(`  [${i + 1}] Chunk ${c.chunkIndex} (Page ${c.pageNumber}, §${c.section}): "${c.snippet.slice(0, 150)}..."`);
  });
  results.qC = qC;

  // 4. Question D: Unsupported
  console.log("\n--- Question D: Unsupported Question ---");
  console.log("Asking: 'What was the stock market performance of Nvidia during this clinical trial?'");
  const qD = await askPaperQuestion({
    paperId,
    question: "What was the stock market performance of Nvidia during this clinical trial?",
    userId,
    isNewThread: true,
  });
  console.log("Answer D (Unsupported):", qD.answer);
  console.log("Insufficient Evidence:", qD.insufficientEvidence);
  console.log("Citations count:", qD.citations.length);
  results.qD = qD;

  // 5. Follow-up Question
  console.log("\n--- Question 9: Conversational Follow-up ---");
  console.log("Asking follow-up to Question B in thread " + qB.conversationId + ": 'What limitations affect those findings?'");
  const qFollowup = await askPaperQuestion({
    paperId,
    question: "What limitations affect those findings?",
    userId,
    conversationId: qB.conversationId,
  });
  console.log("Follow-up Answer:", qFollowup.answer);
  console.log("Insufficient Evidence:", qFollowup.insufficientEvidence);
  console.log(`Claims (${qFollowup.claims?.length || 0}):`);
  qFollowup.claims?.forEach((c, i) => {
    console.log(`  Claim ${i + 1}: "${c.text}" [${c.citations.map((a) => `P.${a.pageNumber} §${a.section}`).join(", ")}]`);
  });
  console.log(`Citations (${qFollowup.citations.length}):`);
  qFollowup.citations.forEach((c, i) => {
    console.log(`  [${i + 1}] Chunk ${c.chunkIndex} (Page ${c.pageNumber}, §${c.section}): "${c.snippet.slice(0, 150)}..."`);
  });
  results.qFollowup = qFollowup;

  // 6. Persistence & Reload Verification
  console.log("\n--- Question 10: Persistence & Reload Verification ---");
  const threadMessages = await prisma.aIMessage.findMany({
    where: { conversationId: qB.conversationId },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Thread ${qB.conversationId} message count: ${threadMessages.length}`);
  threadMessages.forEach((m, idx) => {
    console.log(`  [${idx + 1}] Role: ${m.role}, Content: "${m.content.slice(0, 100)}...", Has Citations: ${m.citations ? "YES" : "NO"}`);
  });

  return results;
}

runAcceptanceTests()
  .catch((e) => {
    console.error("Error running acceptance tests:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
