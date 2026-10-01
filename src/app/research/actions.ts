"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { synthesizeResearchQuestion } from "@/lib/synthesis/synthesis-orchestrator";
import { MultiPaperSynthesisResult } from "@/lib/synthesis/types";

export interface ResearchActionResult {
  success: boolean;
  data?: MultiPaperSynthesisResult;
  error?: string;
}

export async function synthesizeResearchAction(params: {
  question: string;
  conversationId?: string;
  isNewThread?: boolean;
}): Promise<ResearchActionResult> {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }

  if (!session?.user?.id) {
    return {
      success: false,
      error: "Authentication required. Please sign in to run research synthesis.",
    };
  }

  try {
    const result = await synthesizeResearchQuestion({
      question: params.question,
      userId: session.user.id,
      conversationId: params.conversationId,
      isNewThread: params.isNewThread,
    });

    return {
      success: true,
      data: result,
    };
  } catch (error: any) {
    console.error("[ResearchAction] Synthesis error:", error?.message || error);
    return {
      success: false,
      error: error?.message || "An unexpected error occurred during literature synthesis.",
    };
  }
}

export async function getResearchThreadsAction(): Promise<{
  threads: Array<{
    id: string;
    title: string;
    updatedAt: string;
    messageCount: number;
  }>;
}> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { threads: [] };
  }

  const conversations = await prisma.aIConversation.findMany({
    where: {
      userId: session.user.id,
      paperId: null, // multi-paper research threads
    },
    include: {
      _count: {
        select: { messages: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });

  return {
    threads: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt.toISOString(),
      messageCount: c._count.messages,
    })),
  };
}

export async function getResearchThreadMessagesAction(conversationId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error("Authentication required.");
  }

  const conversation = await prisma.aIConversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  if (conversation.userId !== session.user.id) {
    throw new Error("Unauthorized to access this conversation.");
  }

  return {
    conversationId: conversation.id,
    title: conversation.title,
    messages: conversation.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      citations: m.citations as any,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}
