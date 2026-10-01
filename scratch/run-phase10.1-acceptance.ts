import "./load-env";
import { prisma } from "../src/lib/prisma";
import { AgentOrchestrator } from "../src/lib/agent/agent-orchestrator";

async function main() {
  console.log("==========================================================");
  console.log("PHASE 10.1: REAL-CORPUS RESEARCH GAP ACCEPTANCE AUDIT");
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

  // Exact Phase 10 Breast Ultrasound Objective
  const objective =
    "Research the evidence currently available on AI-assisted breast ultrasound lesion classification. Compare the approaches used, reported diagnostic performance, validation strategies, major limitations, and identify evidence-supported research gaps.";

  console.log(`\nStarting Research Agent Run on Objective: "${objective}"\n`);
  const runStart = Date.now();
  const runState = await orchestrator.startRun(user.id, objective, {
    allowExternalDiscovery: false, // Local-first real corpus
    maxSteps: 12,
    maxEvidencePapers: 6,
    chunksPerPaper: 4,
    globalChunkCap: 24,
  });
  const duration = Date.now() - runStart;

  console.log(`\nRun completed in ${duration}ms with final state: ${runState.state}`);
  console.log(`Current Step: ${runState.currentStep} / ${runState.maxSteps}`);

  console.log("\n--- TRACE TELEMETRY ---");
  runState.trace.forEach((t) => {
    console.log(`[Step ${t.stepIndex}] [${t.state}] ${t.action}: ${t.description} ${t.durationMs ? `(${t.durationMs}ms)` : ""}`);
  });

  console.log("\n--- STUDY-LEVEL EVIDENCE & EXTERNAL VALIDATION STATUS ---");
  runState.studyEvidence.forEach((s, idx) => {
    console.log(`\n[Study ${idx + 1}] ${s.title}`);
    console.log(`  Paper ID: ${s.paperId}`);
    console.log(`  Validation Method: ${s.validationMethod ?? "Not reported"}`);
    console.log(`  External Validation Status: ${s.externalValidationStatus ?? "UNKNOWN"}`);
    console.log(`  Limitations: ${s.limitations.join("; ") || "None extracted"}`);
  });

  const brief = runState.researchBrief;
  if (!brief) {
    console.error("No research brief generated!");
    process.exit(1);
  }

  console.log("\n==========================================================");
  console.log("RESEARCH BRIEF RESEARCH GAPS & CORPUS ACCOUNTING AUDIT");
  console.log("==========================================================");

  console.log(`\n--- Research Gaps (${brief.researchGaps.length}) ---`);
  brief.researchGaps.forEach((g, i) => {
    console.log(`\n[GAP ${i + 1}] [${g.type}]`);
    console.log(`  Description: "${g.description}"`);
    console.log(`  Supporting Paper IDs (${g.supportingPaperIds.length}): [${g.supportingPaperIds.join(", ")}]`);
    console.log(`  Citation Anchors (${g.citations.length}):`);
    g.citations.slice(0, 3).forEach((c) => {
      console.log(`    - [${c.paperTitle}] Chunk ${c.chunkId} (P.${c.pageNumber}, ${c.section}): "${c.snippet.slice(0, 100)}..."`);
    });

    if (g.corpusEvidence) {
      console.log(`  Corpus Evidence Accounting:`);
      console.log(`    - Field: ${g.corpusEvidence.field}`);
      console.log(`    - Total Papers Assessed: ${g.corpusEvidence.totalPapersAssessed}`);
      console.log(`    - Coverage Complete: ${g.corpusEvidence.coverageComplete}`);
      console.log(`    - Papers Reporting Feature (${g.corpusEvidence.papersReportingFeature.length}): [${g.corpusEvidence.papersReportingFeature.join(", ")}]`);
      console.log(`    - Papers Not Reporting Feature (${g.corpusEvidence.papersNotReportingFeature.length}): [${g.corpusEvidence.papersNotReportingFeature.join(", ")}]`);
      console.log(`    - Papers Unknown (${g.corpusEvidence.papersUnknown.length}): [${g.corpusEvidence.papersUnknown.join(", ")}]`);
    } else {
      console.log(`  Corpus Evidence Accounting: None (Author-stated gap)`);
    }
  });

  console.log("\n==========================================================");
  console.log("REASSESSMENT OF PHASE 10 EXTERNAL VALIDATION GAP CLAIM");
  console.log("==========================================================");

  // Check how many studies have PRESENT, ABSENT, UNKNOWN
  const presentCount = runState.studyEvidence.filter((s) => s.externalValidationStatus === "PRESENT").length;
  const absentCount = runState.studyEvidence.filter((s) => s.externalValidationStatus === "ABSENT_IN_RETRIEVED_EVIDENCE").length;
  const unknownCount = runState.studyEvidence.filter((s) => s.externalValidationStatus === "UNKNOWN" || !s.externalValidationStatus).length;
  const totalCount = runState.studyEvidence.length;

  console.log(`Total Studies Assessed: ${totalCount}`);
  console.log(`  - PRESENT: ${presentCount}`);
  console.log(`  - ABSENT_IN_RETRIEVED_EVIDENCE: ${absentCount}`);
  console.log(`  - UNKNOWN: ${unknownCount}`);

  let verdict: "SUPPORTED" | "PARTIALLY SUPPORTED" | "WITHHELD";
  if (presentCount === 0 && unknownCount === 0 && absentCount === totalCount && totalCount > 0) {
    verdict = "SUPPORTED";
  } else if (presentCount === 0 && absentCount > 0 && unknownCount > 0) {
    verdict = "PARTIALLY SUPPORTED";
  } else if (presentCount > 0) {
    verdict = "WITHHELD";
  } else {
    verdict = "WITHHELD";
  }

  console.log(`\nVERDICT ON CLAIM: "Among the studies included in this research run, none reported external validation of AI models in diverse clinical settings."`);
  console.log(`STATUS: >>> ${verdict} <<<`);
  if (verdict === "SUPPORTED") {
    console.log("Reason: All assessed studies in the real corpus confirmed absence of external validation, with 0 studies unknown and 0 studies reporting external validation.");
  } else if (verdict === "PARTIALLY SUPPORTED") {
    console.log(`Reason: External validation was absent in ${absentCount} of ${totalCount} studies, but ${unknownCount} study/studies had insufficient retrieved evidence to definitively confirm absence. Claim was safely weakened by the server.`);
  } else {
    console.log(`Reason: ${presentCount} study/studies reported external validation. Total absence claim is withheld/rejected.`);
  }

  console.log("\n==========================================================");
  console.log("PHASE 10.1 REAL-CORPUS ACCEPTANCE RUN FINISHED");
  console.log("==========================================================");
}

main().catch((e) => {
  console.error("Acceptance run failed:", e);
  process.exit(1);
});
