import "./load-env";
import { prisma } from "../src/lib/prisma";
import { AgentOrchestrator } from "../src/lib/agent/agent-orchestrator";

async function main() {
  console.log("==========================================================");
  console.log("PHASE 10: REAL-CORPUS AGENT ACCEPTANCE RUN");
  console.log("==========================================================\n");

  const user = await prisma.user.findFirst();
  if (!user) throw new Error("No user in database.");

  // Check available completed papers
  const completedPapers = await prisma.paper.findMany({
    where: { status: "COMPLETED" },
    select: { id: true, title: true, doi: true, status: true },
  });
  console.log(`Available completed papers in database: ${completedPapers.length}`);
  completedPapers.forEach((p, i) => console.log(`  ${i + 1}. [${p.id}] ${p.title} (${p.doi})`));

  const orchestrator = new AgentOrchestrator();

  // Part 1: Real-Corpus Run on Breast Ultrasound
  const objective =
    "Research the evidence currently available on AI-assisted breast ultrasound lesion classification. Compare the approaches used, reported diagnostic performance, validation strategies, major limitations, and identify evidence-supported research gaps.";

  console.log(`\nStarting Research Agent Run on Objective: "${objective}"\n`);
  const runStart = Date.now();
  const runState = await orchestrator.startRun(user.id, objective, {
    allowExternalDiscovery: true,
    maxSteps: 12,
    maxEvidencePapers: 6,
    chunksPerPaper: 4,
    globalChunkCap: 24,
  });
  const duration = Date.now() - runStart;

  console.log(`\nRun completed in ${duration}ms with final state: ${runState.state}`);
  console.log(`Current Step: ${runState.currentStep} / ${runState.maxSteps}`);

  console.log("\n--- RESEARCH PLAN ---");
  console.log("Objective:", runState.plan?.objective);
  console.log("Research Questions:", runState.plan?.researchQuestions);
  console.log("Search Queries:", runState.plan?.searchQueries);
  console.log("Comparison Dimensions:", runState.plan?.comparisonDimensions);
  console.log("Requires External Discovery:", runState.plan?.requiresExternalDiscovery);
  console.log("External Discovery Reason:", runState.plan?.externalDiscoveryReason);

  console.log("\n--- TRACE TELEMETRY ---");
  runState.trace.forEach((t) => {
    console.log(`[Step ${t.stepIndex}] [${t.state}] ${t.action}: ${t.description} ${t.durationMs ? `(${t.durationMs}ms)` : ""}`);
  });

  console.log("\n--- SELECTED EVIDENCE PAPERS ---");
  console.log(`Count: ${runState.selectedPaperIds.length}`);
  runState.selectedPaperIds.forEach((id) => console.log(`  - Paper ID: ${id}`));

  console.log("\n--- STUDY-LEVEL EVIDENCE EXTRACTION ---");
  runState.studyEvidence.forEach((s, idx) => {
    console.log(`\n[Study ${idx + 1}] ${s.title}`);
    console.log(`  Authors: ${s.authors.slice(0, 3).join(", ")} | Year: ${s.year}`);
    console.log(`  Modality: ${s.imagingModality}`);
    console.log(`  Sample Size: ${s.sampleSize}`);
    console.log(`  AI Architecture: ${s.aiMethod}`);
    console.log(`  Validation Method: ${s.validationMethod}`);
    console.log(`  Sensitivity: ${s.sensitivity} | Specificity: ${s.specificity} | AUC: ${s.auc} | Accuracy: ${s.accuracy}`);
    console.log(`  Findings (${s.majorFindings.length}): ${s.majorFindings.join("; ")}`);
    console.log(`  Limitations (${s.limitations.length}): ${s.limitations.join("; ")}`);
    console.log(`  Evidence Anchors: ${s.evidenceAnchors.length}`);
  });

  const brief = runState.researchBrief;
  if (!brief) {
    console.error("No research brief generated!");
    process.exit(1);
  }

  console.log("\n==========================================================");
  console.log("RESEARCH BRIEF");
  console.log("==========================================================");
  console.log("\n--- Executive Summary ---");
  console.log(brief.executiveSummary);

  console.log("\n--- Scope Disclosure ---");
  console.log(brief.scopeDisclosure);

  console.log(`\n--- Key Findings (${brief.keyFindings.length}) ---`);
  brief.keyFindings.forEach((f, i) => {
    console.log(`[KF ${i + 1}] [${f.category}] ${f.text}`);
    console.log(`     Supported by ${f.supportingPaperCount} papers (${f.citations.length} anchors):`);
    f.citations.forEach((c) => {
      console.log(`       - [Chunk ${c.chunkId}] P.${c.pageNumber} (${c.section}): "${c.snippet}"`);
    });
  });

  console.log(`\n--- Corroborated Findings (${brief.corroboratedFindings.length}) ---`);
  brief.corroboratedFindings.forEach((cf, i) => {
    console.log(`[CF ${i + 1}] ${cf.claim}`);
    console.log(`     Supported by ${cf.supportingPaperCount} unique papers (${cf.citations.length} anchors)`);
    console.log(`     Synthesis note: ${cf.synthesisNote}`);
    cf.citations.forEach((c) => {
      console.log(`       - [${c.paperTitle}] Chunk ${c.chunkId}, P.${c.pageNumber}`);
    });
  });

  console.log(`\n--- Disagreements & Methodological Heterogeneity (${brief.disagreementsAndHeterogeneity.length}) ---`);
  brief.disagreementsAndHeterogeneity.forEach((d, i) => {
    console.log(`[DH ${i + 1}] [${d.type}] ${d.topic}: ${d.description}`);
    d.citations.forEach((c) => {
      console.log(`       - [${c.paperTitle}] Chunk ${c.chunkId}, P.${c.pageNumber}`);
    });
  });

  console.log(`\n--- Evidence-Supported Limitations (${brief.evidenceSupportedLimitations.length}) ---`);
  brief.evidenceSupportedLimitations.forEach((l, i) => {
    console.log(`[LIM ${i + 1}] ${l.text}`);
    l.citations.forEach((c) => {
      console.log(`       - [${c.paperTitle}] Chunk ${c.chunkId}, P.${c.pageNumber}`);
    });
  });

  console.log(`\n--- Research Gaps (${brief.researchGaps.length}) ---`);
  brief.researchGaps.forEach((g, i) => {
    console.log(`[GAP ${i + 1}] [${g.type}] ${g.description}`);
    g.citations.forEach((c) => {
      console.log(`       - [${c.paperTitle}] Chunk ${c.chunkId}, P.${c.pageNumber}`);
    });
  });

  console.log(`\n--- Unanswered Questions (${brief.unansweredQuestions.length}) ---`);
  brief.unansweredQuestions.forEach((uq, i) => console.log(`  ${i + 1}. ${uq}`));

  console.log("\n--- Validation Metrics ---");
  console.log(`Evidence Chunks Used: ${brief.totalEvidenceChunksUsed}`);
  console.log(`Rejected Citations Count: ${brief.rejectedCitationsCount}`);
  console.log(`Rejected Claims Count: ${brief.rejectedClaimsCount}`);
  console.log(`Insufficient Evidence Flag: ${brief.insufficientEvidence}`);

  // Part 2: Controlled External Discovery Test
  console.log("\n==========================================================");
  console.log("CONTROLLED EXTERNAL DISCOVERY TEST");
  console.log("==========================================================");
  const extObjective =
    "Evaluate CRISPR-Cas13 RNA editing efficacy in primary non-small cell lung cancer models";
  console.log(`Running agent on novel/absent topic: "${extObjective}"`);

  const extRun = await orchestrator.startRun(user.id, extObjective, {
    allowExternalDiscovery: true,
    maxSteps: 6,
  });

  console.log(`External Discovery Run State: ${extRun.state}`);
  console.log("Trace:");
  extRun.trace.forEach((t) => {
    console.log(`  [${t.state}] ${t.action}: ${t.description}`);
  });
  console.log(`Candidates Discovered: ${extRun.candidateExternalPapers.length}`);
}

main().catch((e) => {
  console.error("Acceptance run failed:", e);
  process.exit(1);
});
