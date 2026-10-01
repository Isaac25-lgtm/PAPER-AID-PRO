"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AgentOrchestrator } from "@/lib/agent/agent-orchestrator";
import { AgentRunState, AgentRunOptions } from "@/lib/agent/types";
import { AIMessageRole } from "@prisma/client";

export interface AgentActionResult {
  success: boolean;
  data?: AgentRunState;
  error?: string;
}

export async function startResearchAgentRunAction(params: {
  objective: string;
  options?: AgentRunOptions;
}): Promise<AgentActionResult> {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }

  if (!session?.user?.id) {
    return {
      success: false,
      error: "Authentication required. Please sign in to run the research agent.",
    };
  }

  const cleanObjective = params.objective?.trim();
  if (!cleanObjective) {
    return {
      success: false,
      error: "Research objective cannot be empty.",
    };
  }

  try {
    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.startRun(
      session.user.id,
      cleanObjective,
      params.options
    );

    return {
      success: true,
      data: result,
    };
  } catch (err: any) {
    console.error("[AgentAction] startRun failed:", err?.message || err);
    return {
      success: false,
      error: err?.message || "Failed to start research agent run.",
    };
  }
}

export async function continueAgentRunAction(params: {
  conversationId: string;
  action: "APPROVE_IMPORT" | "SKIP_AND_CONTINUE";
  approvedCandidateIds?: string[];
  options?: AgentRunOptions;
}): Promise<AgentActionResult> {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }

  if (!session?.user?.id) {
    return {
      success: false,
      error: "Authentication required. Please sign in to continue the research run.",
    };
  }

  try {
    const conversation = await prisma.aIConversation.findFirst({
      where: {
        id: params.conversationId,
        userId: session.user.id,
      },
      include: {
        messages: {
          where: { role: AIMessageRole.ASSISTANT },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!conversation || conversation.messages.length === 0) {
      return {
        success: false,
        error: "Research run conversation not found.",
      };
    }

    const citations = conversation.messages[0].citations as any;
    if (!citations || citations.type !== "PHASE_10_RESEARCH_AGENT_RUN") {
      return {
        success: false,
        error: "No active research agent state found in this conversation.",
      };
    }

    const runState: AgentRunState = {
      conversationId: conversation.id,
      runId: citations.runId,
      userId: session.user.id,
      objective: conversation.title.replace(/^\[Agent\]\s*/, ""),
      state: citations.state,
      currentStep: citations.currentStep || 0,
      maxSteps: citations.maxSteps || 10,
      plan: citations.plan,
      trace: citations.trace || [],
      selectedPaperIds: citations.selectedPaperIds || [],
      candidateExternalPapers: citations.candidateExternalPapers || [],
      evidenceChunks: [],
      studyEvidence: citations.studyEvidence || [],
      researchBrief: citations.researchBrief,
      waitingForUserReason: citations.waitingForUserReason,
      pendingImportCandidateIds: citations.pendingImportCandidateIds,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: citations.updatedAt || new Date().toISOString(),
    };

    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.continueRun(
      runState,
      params.action,
      params.approvedCandidateIds || [],
      params.options
    );

    return {
      success: true,
      data: result,
    };
  } catch (err: any) {
    console.error("[AgentAction] continueRun failed:", err?.message || err);
    return {
      success: false,
      error: err?.message || "Failed to continue research agent run.",
    };
  }
}

export async function getAgentRunAction(conversationId: string): Promise<AgentActionResult> {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }

  if (!session?.user?.id) {
    return {
      success: false,
      error: "Authentication required.",
    };
  }

  try {
    const conversation = await prisma.aIConversation.findFirst({
      where: {
        id: conversationId,
        userId: session.user.id,
      },
      include: {
        messages: {
          where: { role: AIMessageRole.ASSISTANT },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!conversation || conversation.messages.length === 0) {
      return {
        success: false,
        error: "Conversation not found.",
      };
    }

    const citations = conversation.messages[0].citations as any;
    if (!citations || citations.type !== "PHASE_10_RESEARCH_AGENT_RUN") {
      return {
        success: false,
        error: "No active research agent state found.",
      };
    }

    const runState: AgentRunState = {
      conversationId: conversation.id,
      runId: citations.runId,
      userId: session.user.id,
      objective: conversation.title.replace(/^\[Agent\]\s*/, ""),
      state: citations.state,
      currentStep: citations.currentStep || 0,
      maxSteps: citations.maxSteps || 10,
      plan: citations.plan,
      trace: citations.trace || [],
      selectedPaperIds: citations.selectedPaperIds || [],
      candidateExternalPapers: citations.candidateExternalPapers || [],
      evidenceChunks: [],
      studyEvidence: citations.studyEvidence || [],
      researchBrief: citations.researchBrief,
      waitingForUserReason: citations.waitingForUserReason,
      pendingImportCandidateIds: citations.pendingImportCandidateIds,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: citations.updatedAt || new Date().toISOString(),
    };

    return {
      success: true,
      data: runState,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || "Failed to fetch run state.",
    };
  }
}

export async function getAgentThreadsAction(): Promise<{
  threads: Array<{
    id: string;
    title: string;
    updatedAt: string;
    state?: string;
  }>;
}> {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }
  if (!session?.user?.id) {
    return { threads: [] };
  }

  const conversations = await prisma.aIConversation.findMany({
    where: {
      userId: session.user.id,
      title: { startsWith: "[Agent]" },
    },
    orderBy: { updatedAt: "desc" },
    take: 15,
    include: {
      messages: {
        where: { role: AIMessageRole.ASSISTANT },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return {
    threads: conversations.map((c) => {
      const citations = c.messages[0]?.citations as any;
      return {
        id: c.id,
        title: c.title.replace(/^\[Agent\]\s*/, ""),
        updatedAt: c.updatedAt.toISOString(),
        state: citations?.state,
      };
    }),
  };
}
