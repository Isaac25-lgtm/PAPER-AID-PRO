/**
 * AI Research Hub — Phase 10: Evidence-Grounded Research Agent Orchestrator
 *
 * Bounded, deterministic state machine orchestrator that executes a multi-step
 * research workflow:
 *
 * PLANNING -> LOCAL_DISCOVERY -> EVIDENCE_ASSESSMENT -> (EXTERNAL_DISCOVERY ->
 * CANDIDATE_CLASSIFICATION -> WAITING_FOR_USER)? -> EVIDENCE_RETRIEVAL ->
 * STUDY_EXTRACTION -> SYNTHESIS -> VALIDATION -> COMPLETED
 *
 * Core Guarantees:
 * 1. Bounded execution: Hard maximum steps (10-12). Loop unconditionally terminates.
 * 2. Local-first: If local library has sufficient coverage (>= 3 completed papers),
 *    external discovery is skipped and justified.
 * 3. Evidence Eligibility: Only Paper.status === 'COMPLETED' with processed full text
 *    and embeddings can enter evidence retrieval. Metadata/abstracts are strictly excluded.
 * 4. Human Approval: Full-text acquisition requires explicit user approval or small strict cap.
 * 5. Scientific Validation: All claims validated server-side. Uncited claims dropped.
 * 6. Auditability: High-level actions and decisions recorded in inspectable trace.
 */

import { prisma } from "@/lib/prisma";
import { AIMessageRole } from "@prisma/client";
import { getOpenAIClient, AI_CONFIG } from "@/lib/ai/config";
import { zodTextFormat } from "openai/helpers/zod";
import {
  AgentState,
  AgentRunState,
  AgentRunOptions,
  ResearchPlan,
  AgentTraceStep,
  StudyEvidence,
  ResearchBrief,
} from "./types";
import { AgentToolRegistry, DefaultAgentToolRegistry } from "./tool-registry";
import { AGENT_PLANNER_SYSTEM_PROMPT, buildPlannerPrompt } from "./prompts";
import { ResearchPlanSchema, RawResearchPlan } from "./schemas";
import { extractStudyEvidence } from "./study-extractor";
import { synthesizeResearchBrief } from "./brief-synthesizer";
import { RetrievedEvidenceChunk } from "@/lib/synthesis/types";
import { NormalizedExternalPaper } from "@/lib/discovery/types";

export const DEFAULT_MAX_AGENT_STEPS = 10;
export const HARD_MAX_AGENT_STEPS = 12;

export class AgentOrchestrator {
  private toolRegistry: AgentToolRegistry;

  constructor(toolRegistry?: AgentToolRegistry) {
    this.toolRegistry = toolRegistry || new DefaultAgentToolRegistry();
  }

  /**
   * Starts a new bounded research agent run.
   */
  async startRun(
    userId: string,
    objective: string,
    options: AgentRunOptions = {}
  ): Promise<AgentRunState> {
    const cleanObjective = objective.trim().slice(0, 2000);
    if (!cleanObjective) {
      throw new Error("Research objective cannot be empty.");
    }

    const maxSteps = Math.min(
      options.maxSteps || DEFAULT_MAX_AGENT_STEPS,
      HARD_MAX_AGENT_STEPS
    );

    // 1. Create or initialize AIConversation thread
    const title = cleanObjective.length > 55
      ? cleanObjective.slice(0, 52) + "..."
      : cleanObjective;

    const conversation = await prisma.aIConversation.create({
      data: {
        userId,
        paperId: null,
        title: `[Agent] ${title}`,
      },
    });

    // 2. Persist user prompt message
    await prisma.aIMessage.create({
      data: {
        conversationId: conversation.id,
        role: AIMessageRole.USER,
        content: cleanObjective,
      },
    });

    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const initialState: AgentRunState = {
      conversationId: conversation.id,
      runId,
      userId,
      objective: cleanObjective,
      state: "PLANNING",
      currentStep: 0,
      maxSteps,
      trace: [],
      selectedPaperIds: [],
      candidateExternalPapers: [],
      evidenceChunks: [],
      studyEvidence: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return this.executeStateMachine(initialState, options);
  }

  /**
   * Resumes an existing run from WAITING_FOR_USER state.
   */
  async continueRun(
    runState: AgentRunState,
    action: "APPROVE_IMPORT" | "SKIP_AND_CONTINUE",
    approvedCandidateIds: string[] = [],
    options: AgentRunOptions = {}
  ): Promise<AgentRunState> {
    if (runState.state !== "WAITING_FOR_USER") {
      throw new Error(`Cannot continue run from state ${runState.state}`);
    }

    let state = { ...runState, updatedAt: new Date().toISOString() };

    this.addTrace(state, "WAITING_FOR_USER", "USER_DECISION", `User selected: ${action} (${approvedCandidateIds.length} approved candidates).`);

    if (action === "APPROVE_IMPORT" && approvedCandidateIds.length > 0) {
      // Process approved candidate papers (up to small limit <= 3)
      const allowedToAcquire = approvedCandidateIds.slice(0, 3);
      for (const candidateId of allowedToAcquire) {
        const candidate = state.candidateExternalPapers.find((c) => c.id === candidateId);
        if (candidate && candidate.openAccessPdfUrl) {
          try {
            const result = await this.toolRegistry.acquireOpenAccessFullText(
              candidate.id,
              candidate.openAccessPdfUrl
            );
            if (result.success) {
              state.selectedPaperIds.push(candidate.id);
              this.addTrace(
                state,
                "CANDIDATE_CLASSIFICATION",
                "OA_FULL_TEXT_ACQUIRED",
                `Successfully acquired full text for candidate "${candidate.title}". Added to evidence papers.`
              );
            }
          } catch (acquireErr: any) {
            this.addTrace(
              state,
              "CANDIDATE_CLASSIFICATION",
              "OA_ACQUISITION_FAILED",
              `Could not acquire full text for candidate "${candidate.title}": ${acquireErr?.message || "Error"}`
            );
          }
        }
      }
    }

    state.state = "EVIDENCE_RETRIEVAL";
    state.waitingForUserReason = undefined;
    state.pendingImportCandidateIds = undefined;

    return this.executeStateMachine(state, options);
  }

  /**
   * Bounded State Machine Loop
   */
  private async executeStateMachine(
    state: AgentRunState,
    options: AgentRunOptions
  ): Promise<AgentRunState> {
    try {
      while (
        state.state !== "COMPLETED" &&
        state.state !== "FAILED" &&
        state.state !== "WAITING_FOR_USER" &&
        state.currentStep < state.maxSteps
      ) {
        state.currentStep++;

        switch (state.state) {
          case "PLANNING":
            await this.stepPlanning(state);
            break;

          case "LOCAL_DISCOVERY":
            await this.stepLocalDiscovery(state);
            break;

          case "EVIDENCE_ASSESSMENT":
            await this.stepEvidenceAssessment(state, options);
            break;

          case "EXTERNAL_DISCOVERY":
            await this.stepExternalDiscovery(state, options);
            break;

          case "CANDIDATE_CLASSIFICATION":
            await this.stepCandidateClassification(state, options);
            break;

          case "EVIDENCE_RETRIEVAL":
            await this.stepEvidenceRetrieval(state, options);
            break;

          case "STUDY_EXTRACTION":
            await this.stepStudyExtraction(state);
            break;

          case "SYNTHESIS":
            await this.stepSynthesis(state);
            break;

          case "VALIDATION":
            await this.stepValidation(state);
            break;

          default:
            throw new Error(`Unexpected state encountered: ${state.state}`);
        }
      }

      // Check step limit
      if (
        state.currentStep >= state.maxSteps &&
        state.state !== "COMPLETED" &&
        state.state !== "WAITING_FOR_USER"
      ) {
        this.addTrace(
          state,
          state.state,
          "STEP_BUDGET_REACHED",
          `Agent reached maximum allowed step budget (${state.maxSteps}). Halting safely.`
        );
        state.state = "COMPLETED";
      }

      // Persist state in database
      await this.persistRun(state);
      return state;
    } catch (err: any) {
      console.error("[AgentOrchestrator] Run failed:", err?.message || err);
      state.state = "FAILED";
      state.error = err?.message || "Internal orchestrator error";
      this.addTrace(state, "FAILED", "RUN_ERROR", `Run encountered fatal error: ${state.error}`);
      await this.persistRun(state);
      return state;
    }
  }

  // 1. Planning Step
  private async stepPlanning(state: AgentRunState): Promise<void> {
    const startTime = Date.now();

    // Check existing completed papers in local library to provide context to planner
    const localPapers = await prisma.paper.findMany({
      where: { status: "COMPLETED" },
      select: { id: true, title: true },
      take: 8,
    });

    const openai = getOpenAIClient();
    const prompt = buildPlannerPrompt(
      state.objective,
      localPapers.length,
      localPapers.map((p) => p.title)
    );

    const response = await openai.responses.parse({
      model: AI_CONFIG.summaryModel,
      instructions: AGENT_PLANNER_SYSTEM_PROMPT,
      input: prompt,
      text: {
        format: zodTextFormat(ResearchPlanSchema, "research_plan"),
      },
      max_output_tokens: 1500,
      temperature: 0.1,
      store: false,
    });

    let plan: ResearchPlan;
    if (response.output_parsed) {
      plan = response.output_parsed as ResearchPlan;
    } else if (response.output_text) {
      plan = ResearchPlanSchema.parse(JSON.parse(response.output_text));
    } else {
      throw new Error("Planner model returned empty response.");
    }

    // Hard bounds enforcement server-side
    state.plan = {
      objective: plan.objective,
      researchQuestions: plan.researchQuestions.slice(0, 5),
      searchQueries: plan.searchQueries.slice(0, 5),
      desiredEvidenceTypes: plan.desiredEvidenceTypes || [],
      comparisonDimensions: (plan.comparisonDimensions || []).slice(0, 12),
      requiresExternalDiscovery: Boolean(plan.requiresExternalDiscovery),
      externalDiscoveryReason: plan.externalDiscoveryReason || null,
    };

    this.addTrace(
      state,
      "PLANNING",
      "CREATE_RESEARCH_PLAN",
      `Formulated research plan with ${state.plan.researchQuestions.length} questions, ${state.plan.searchQueries.length} search queries, and ${state.plan.comparisonDimensions.length} comparison axes.`,
      { durationMs: Date.now() - startTime }
    );

    state.state = "LOCAL_DISCOVERY";
  }

  // 2. Local Discovery Step
  private async stepLocalDiscovery(state: AgentRunState): Promise<void> {
    const startTime = Date.now();
    const queries = state.plan?.searchQueries || [state.objective];

    const discoveredIds = new Set<string>();

    for (const q of queries.slice(0, 2)) {
      const candidates = await this.toolRegistry.searchLocalLibrary(q, { limit: 6 });
      for (const c of candidates) {
        discoveredIds.add(c.paperId);
      }
    }

    // Strictly verify status === 'COMPLETED'
    const validPapers = await prisma.paper.findMany({
      where: {
        id: { in: Array.from(discoveredIds) },
        status: "COMPLETED",
      },
      select: { id: true, title: true },
    });

    state.selectedPaperIds = validPapers.map((p) => p.id);

    this.addTrace(
      state,
      "LOCAL_DISCOVERY",
      "SEARCH_LOCAL_LIBRARY",
      `Searched local library across queries. Identified ${validPapers.length} eligible completed manuscripts with full text.`,
      {
        durationMs: Date.now() - startTime,
        counts: {
          papersConsidered: discoveredIds.size,
          evidenceReady: validPapers.length,
        },
      }
    );

    state.state = "EVIDENCE_ASSESSMENT";
  }

  // 3. Evidence Assessment Step (Local-First Policy)
  private async stepEvidenceAssessment(
    state: AgentRunState,
    options: AgentRunOptions
  ): Promise<void> {
    const localCount = state.selectedPaperIds.length;
    const allowExternal = options.allowExternalDiscovery ?? true;

    // Local-First Rule: If local library has >= 3 relevant completed papers, proceed locally
    if (localCount >= 3 && !state.plan?.requiresExternalDiscovery) {
      this.addTrace(
        state,
        "EVIDENCE_ASSESSMENT",
        "LOCAL_EVIDENCE_SUFFICIENT",
        `Local evidence library contains ${localCount} relevant completed manuscripts. External discovery skipped in accordance with local-first policy.`
      );
      state.state = "EVIDENCE_RETRIEVAL";
      return;
    }

    if (!allowExternal) {
      this.addTrace(
        state,
        "EVIDENCE_ASSESSMENT",
        "EXTERNAL_DISCOVERY_DISABLED",
        `Local evidence count is ${localCount}, but external discovery is disabled by run options. Proceeding with available local evidence.`
      );
      state.state = "EVIDENCE_RETRIEVAL";
      return;
    }

    this.addTrace(
      state,
      "EVIDENCE_ASSESSMENT",
      "TRIGGER_EXTERNAL_DISCOVERY",
      `Local evidence library is insufficient (${localCount} completed papers found). Triggering external discovery via Phase 9 aggregator.`
    );
    state.state = "EXTERNAL_DISCOVERY";
  }

  // 4. External Discovery Step
  private async stepExternalDiscovery(
    state: AgentRunState,
    options: AgentRunOptions
  ): Promise<void> {
    const startTime = Date.now();
    const queries = state.plan?.searchQueries || [state.objective];
    const maxQueries = Math.min(options.maxExternalQueries || 2, 5);

    const mergedCandidates: NormalizedExternalPaper[] = [];
    const seenDois = new Set<string>();

    for (const q of queries.slice(0, maxQueries)) {
      try {
        const searchResult = await this.toolRegistry.searchExternalLiterature(q, {
          limitPerProvider: 4,
        });

        for (const p of searchResult.papers) {
          const doiKey = p.doi ? p.doi.toLowerCase().trim() : p.title.toLowerCase().trim();
          if (!seenDois.has(doiKey)) {
            seenDois.add(doiKey);
            mergedCandidates.push(p);
          }
        }
      } catch (err: any) {
        this.addTrace(
          state,
          "EXTERNAL_DISCOVERY",
          "PROVIDER_PARTIAL_FAILURE",
          `External query "${q}" encountered provider error: ${err?.message || "Search failed"}. Continuing with other sources.`
        );
      }
    }

    state.candidateExternalPapers = mergedCandidates;

    this.addTrace(
      state,
      "EXTERNAL_DISCOVERY",
      "EXTERNAL_SEARCH_COMPLETED",
      `Retrieved and deduplicated ${mergedCandidates.length} candidate papers from external scholarly sources.`,
      {
        durationMs: Date.now() - startTime,
        counts: { papersConsidered: mergedCandidates.length },
      }
    );

    state.state = "CANDIDATE_CLASSIFICATION";
  }

  // 5. Candidate Classification Step
  private async stepCandidateClassification(
    state: AgentRunState,
    options: AgentRunOptions
  ): Promise<void> {
    const startTime = Date.now();
    const candidates = state.candidateExternalPapers;

    const oaCandidates: NormalizedExternalPaper[] = [];
    let metadataOnlyCount = 0;

    for (const c of candidates) {
      if (c.localStatus?.inLibrary) {
        // Already local
        continue;
      }

      const fullText = this.toolRegistry.resolveFullTextStatus(c);
      if (fullText.status === "FULL_TEXT_AVAILABLE" && fullText.url) {
        c.openAccessPdfUrl = fullText.url;
        oaCandidates.push(c);
      } else {
        metadataOnlyCount++;
      }
    }

    this.addTrace(
      state,
      "CANDIDATE_CLASSIFICATION",
      "CLASSIFY_CANDIDATES",
      `Classified external candidates: ${oaCandidates.length} open-access with full text, ${metadataOnlyCount} metadata-only / paywalled.`,
      {
        durationMs: Date.now() - startTime,
        counts: {
          papersConsidered: candidates.length,
          metadataOnly: metadataOnlyCount,
        },
      }
    );

    // Human Approval Check: If OA candidates exist, pause for user approval unless auto-acquire configured
    const autoAcquireLimit = options.autoAcquireOaLimit || 0;
    if (oaCandidates.length > 0 && autoAcquireLimit === 0) {
      state.state = "WAITING_FOR_USER";
      state.waitingForUserReason = `Discovered ${oaCandidates.length} potential open-access papers. User approval required before importing into local library.`;
      state.pendingImportCandidateIds = oaCandidates.map((c) => c.id);
      this.addTrace(
        state,
        "WAITING_FOR_USER",
        "AWAIT_USER_IMPORT_APPROVAL",
        state.waitingForUserReason
      );
      return;
    }

    state.state = "EVIDENCE_RETRIEVAL";
  }

  // 6. Evidence Retrieval Step
  private async stepEvidenceRetrieval(
    state: AgentRunState,
    options: AgentRunOptions
  ): Promise<void> {
    const startTime = Date.now();
    const maxPapers = Math.min(options.maxEvidencePapers || 6, 8);
    const paperIds = state.selectedPaperIds.slice(0, maxPapers);

    if (paperIds.length === 0) {
      this.addTrace(
        state,
        "EVIDENCE_RETRIEVAL",
        "NO_ELIGIBLE_PAPERS",
        "No completed papers with full text available. Proceeding with insufficient evidence synthesis."
      );
      state.evidenceChunks = [];
      state.state = "STUDY_EXTRACTION";
      return;
    }

    const primaryResult = await this.toolRegistry.retrievePaperEvidence(
      paperIds,
      state.objective,
      {
        chunksPerPaper: options.chunksPerPaper || 4,
        globalChunkCap: options.globalChunkCap || 24,
      }
    );

    const mergedChunks = [...primaryResult.allChunks];
    const seenChunkIds = new Set(mergedChunks.map((c) => c.id));
    let targetedChunksAdded = 0;

    // Targeted validation methodology retrieval (bounded: <= 2 chunks per paper)
    // Ensures coverage for validation cohorts so absence is not falsely asserted
    try {
      const targetedResult = await this.toolRegistry.retrievePaperEvidence(
        paperIds,
        "external validation validation cohort independent cohort multicenter prospective test set",
        {
          chunksPerPaper: 2,
          globalChunkCap: 12,
        }
      );

      for (const chunk of targetedResult.allChunks) {
        if (!seenChunkIds.has(chunk.id)) {
          mergedChunks.push(chunk);
          seenChunkIds.add(chunk.id);
          targetedChunksAdded++;
        }
      }
    } catch (targetedErr: any) {
      console.warn(
        "[AgentOrchestrator] Targeted validation retrieval skipped or failed:",
        targetedErr?.message || targetedErr
      );
    }

    state.evidenceChunks = mergedChunks;

    this.addTrace(
      state,
      "EVIDENCE_RETRIEVAL",
      "RETRIEVE_EVIDENCE_CHUNKS",
      `Retrieved ${mergedChunks.length} evidence chunks (${primaryResult.allChunks.length} primary + ${targetedChunksAdded} targeted validation chunks) across ${primaryResult.evidenceSets.length} completed manuscripts.`,
      {
        durationMs: Date.now() - startTime,
        counts: {
          evidenceReady: primaryResult.evidenceSets.length,
          chunksRetrieved: mergedChunks.length,
        },
      }
    );

    state.state = "STUDY_EXTRACTION";
  }

  // 7. Study Extraction Step
  private async stepStudyExtraction(state: AgentRunState): Promise<void> {
    const startTime = Date.now();
    const chunksByPaper = new Map<string, RetrievedEvidenceChunk[]>();

    for (const c of state.evidenceChunks) {
      if (!chunksByPaper.has(c.paperId)) {
        chunksByPaper.set(c.paperId, []);
      }
      chunksByPaper.get(c.paperId)!.push(c);
    }

    const studies: StudyEvidence[] = [];

    // Extract study dimensions paper by paper for studies with retrieved chunks
    for (const paperId of state.selectedPaperIds) {
      const chunks = chunksByPaper.get(paperId) || [];
      // PART 4.1: Exclude zero-chunk studies from evidence-ready counts and comparison tables
      if (chunks.length === 0) {
        continue;
      }

      const paper = await prisma.paper.findUnique({
        where: { id: paperId },
        include: {
          authors: {
            include: { author: true },
            orderBy: { orderIndex: "asc" },
          },
        },
      });

      if (!paper) continue;

      const study = await extractStudyEvidence(
        {
          id: paper.id,
          title: paper.title,
          authors: paper.authors.map((a) => a.author.name),
          year: paper.publicationDate ? new Date(paper.publicationDate).getFullYear() : null,
          journal: paper.journal,
          doi: paper.doi,
        },
        chunks,
        {
          researchObjective: state.objective,
          researchPlan: state.plan,
        }
      );

      // Exclude studies flagged INELIGIBLE
      if (study.studyCategory === "INELIGIBLE") {
        continue;
      }

      studies.push(study);
    }

    state.studyEvidence = studies;

    this.addTrace(
      state,
      "STUDY_EXTRACTION",
      "EXTRACT_STUDY_EVIDENCE",
      `Extracted structured empirical study dimensions for ${studies.length} studies with retrieved manuscript evidence.`,
      {
        durationMs: Date.now() - startTime,
        counts: { evidenceReady: studies.length },
      }
    );

    state.state = "SYNTHESIS";
  }

  // 8. Synthesis Step
  private async stepSynthesis(state: AgentRunState): Promise<void> {
    const startTime = Date.now();
    const plan = state.plan || {
      objective: state.objective,
      researchQuestions: [state.objective],
      searchQueries: [state.objective],
      desiredEvidenceTypes: [],
      comparisonDimensions: [],
      requiresExternalDiscovery: false,
    };

    const brief = await synthesizeResearchBrief(
      state.objective,
      plan,
      state.studyEvidence,
      state.evidenceChunks,
      state.candidateExternalPapers.length,
      state.selectedPaperIds.length
    );

    state.researchBrief = brief;

    this.addTrace(
      state,
      "SYNTHESIS",
      "SYNTHESIZE_RESEARCH_BRIEF",
      `Synthesized research brief. Generated ${brief.keyFindings.length} key findings, ${brief.corroboratedFindings.length} corroborated findings, and ${brief.researchGaps.length} research gaps.`,
      {
        durationMs: Date.now() - startTime,
        counts: {
          claimsValidated:
            brief.keyFindings.length +
            brief.corroboratedFindings.length +
            brief.evidenceSupportedLimitations.length,
        },
      }
    );

    state.state = "VALIDATION";
  }

  // 9. Validation Step
  private async stepValidation(state: AgentRunState): Promise<void> {
    const brief = state.researchBrief;
    if (!brief) {
      throw new Error("No research brief available for validation.");
    }

    this.addTrace(
      state,
      "VALIDATION",
      "SERVER_CLAIM_VALIDATION",
      `Validated claim provenance: ${brief.totalEvidenceChunksUsed} unique chunks verified. Rejected citations: ${brief.rejectedCitationsCount}. Dropped unsupported claims: ${brief.rejectedClaimsCount}.`,
      {
        counts: {
          claimsValidated:
            brief.keyFindings.length +
            brief.corroboratedFindings.length +
            brief.evidenceSupportedLimitations.length,
        },
      }
    );

    state.state = "COMPLETED";
  }

  // Helper to record trace items
  private addTrace(
    state: AgentRunState,
    stepState: AgentState,
    action: string,
    description: string,
    metadata?: { durationMs?: number; counts?: AgentTraceStep["counts"] }
  ): void {
    const traceStep: AgentTraceStep = {
      stepIndex: state.trace.length + 1,
      timestamp: new Date().toISOString(),
      state: stepState,
      action,
      description,
      counts: metadata?.counts,
      durationMs: metadata?.durationMs,
    };
    state.trace.push(traceStep);
  }

  // Helper to persist state in conversation
  private async persistRun(state: AgentRunState): Promise<void> {
    const conversation = await prisma.aIConversation.findUnique({
      where: { id: state.conversationId },
    });

    if (!conversation) return;

    // Check if an assistant message already exists for this run
    const existingAssistant = await prisma.aIMessage.findFirst({
      where: {
        conversationId: conversation.id,
        role: AIMessageRole.ASSISTANT,
      },
      orderBy: { createdAt: "desc" },
    });

    const content =
      state.researchBrief?.executiveSummary ||
      (state.state === "WAITING_FOR_USER"
        ? state.waitingForUserReason || "Waiting for user approval to proceed."
        : state.state === "FAILED"
        ? `Research run failed: ${state.error || "Unknown error"}`
        : "Research run in progress...");

    const payload = {
      type: "PHASE_10_RESEARCH_AGENT_RUN",
      runId: state.runId,
      state: state.state,
      currentStep: state.currentStep,
      maxSteps: state.maxSteps,
      plan: state.plan,
      trace: state.trace,
      selectedPaperIds: state.selectedPaperIds,
      candidateExternalPapers: state.candidateExternalPapers,
      studyEvidence: state.studyEvidence,
      researchBrief: state.researchBrief,
      waitingForUserReason: state.waitingForUserReason,
      pendingImportCandidateIds: state.pendingImportCandidateIds,
      error: state.error,
      updatedAt: state.updatedAt,
    };

    if (existingAssistant) {
      await prisma.aIMessage.update({
        where: { id: existingAssistant.id },
        data: {
          content,
          citations: payload as any,
        },
      });
    } else {
      await prisma.aIMessage.create({
        data: {
          conversationId: conversation.id,
          role: AIMessageRole.ASSISTANT,
          content,
          citations: payload as any,
        },
      });
    }
  }
}
