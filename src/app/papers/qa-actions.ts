"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { askPaperQuestion } from "@/lib/rag/qa-orchestrator";
import { PaperQAResponse, ConversationMessageView, GroundedCitationAnchor } from "@/lib/rag/types";
import { revalidatePath } from "next/cache";
import { authorizePaperAccess } from "@/lib/auth/paper-authorization";

export interface AskPaperActionResult extends PaperQAResponse {
  requiresAuth?: boolean;
}

export interface ConversationHistoryResult {
  success: boolean;
  conversationId?: string;
  title?: string;
  messages: ConversationMessageView[];
  error?: string;
}

/**
 * Server Action: Submit a question to a specific paper.
 * Derives user identity strictly from the active NextAuth server session.
 */
export async function askPaperQuestionAction(params: {
  paperId: string;
  question: string;
  conversationId?: string;
  isNewThread?: boolean;
}): Promise<AskPaperActionResult> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return {
      success: false,
      answer: "You must be signed in to ask research questions about this manuscript.",
      citations: [],
      insufficientEvidence: false,
      requiresAuth: true,
      error: "Authentication required",
    };
  }

  // Authorize access to paper before proceeding
  const paper = await prisma.paper.findUnique({
    where: { id: params.paperId },
    select: {
      id: true,
      title: true,
      storagePath: true,
      pdfUrl: true,
      sourceProvenance: true,
      doi: true,
      arxivId: true,
      pmid: true,
      pmcid: true,
      semanticScholarId: true,
    },
  });

  if (!paper) {
    return {
      success: false,
      answer: "Paper not found.",
      citations: [],
      insufficientEvidence: true,
      error: "Paper not found",
    };
  }

  const auth = await authorizePaperAccess(paper, session.user, "INTERACT_AI");
  if (!auth.allowed) {
    return {
      success: false,
      answer: "You do not have permission to ask questions about this manuscript.",
      citations: [],
      insufficientEvidence: true,
      error: "Unauthorized",
    };
  }

  try {
    const result = await askPaperQuestion({
      paperId: params.paperId,
      question: params.question,
      userId: session.user.id,
      conversationId: params.conversationId,
      isNewThread: params.isNewThread,
    });

    revalidatePath(`/papers/${params.paperId}`);
    return result;
  } catch (err: any) {
    console.error("[askPaperQuestionAction] Error:", err);
    return {
      success: false,
      answer: "The research Q&A engine encountered an unexpected error. Please try again.",
      citations: [],
      insufficientEvidence: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Server Action: Loads the active Q&A conversation history for a paper.
 * Derives user identity strictly from the active NextAuth server session.
 */
export async function getPaperConversationAction(
  paperId: string,
  conversationId?: string
): Promise<ConversationHistoryResult> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return {
      success: true,
      messages: [],
    };
  }

  try {
    const paper = await prisma.paper.findUnique({
      where: { id: paperId },
      select: {
        id: true,
        title: true,
        storagePath: true,
        pdfUrl: true,
        sourceProvenance: true,
        doi: true,
        arxivId: true,
        pmid: true,
        pmcid: true,
        semanticScholarId: true,
      },
    });

    if (!paper) {
      return { success: false, messages: [], error: "Paper not found." };
    }

    const auth = await authorizePaperAccess(paper, session.user, "INTERACT_AI");
    if (!auth.allowed) {
      return { success: false, messages: [], error: "Unauthorized access to paper conversation." };
    }

    let conversation;

    if (conversationId) {
      conversation = await prisma.aIConversation.findUnique({
        where: { id: conversationId },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      // Verify user and paper ownership
      if (
        !conversation ||
        conversation.userId !== session.user.id ||
        conversation.paperId !== paperId
      ) {
        return {
          success: false,
          messages: [],
          error: "Conversation not found or unauthorized.",
        };
      }
    } else {
      // Find the most recent conversation for this user and paper
      conversation = await prisma.aIConversation.findFirst({
        where: {
          userId: session.user.id,
          paperId,
        },
        orderBy: { updatedAt: "desc" },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      });
    }

    if (!conversation) {
      return {
        success: true,
        messages: [],
      };
    }

    const messagesView: ConversationMessageView[] = conversation.messages.map((m) => {
      let citations: GroundedCitationAnchor[] = [];
      let claims: any[] | undefined = undefined;

      if (m.citations) {
        try {
          const parsed = typeof m.citations === "string" ? JSON.parse(m.citations) : (m.citations as any);
          if (Array.isArray(parsed)) {
            citations = parsed;
          } else if (parsed && typeof parsed === "object") {
            citations = parsed.anchors || [];
            claims = parsed.claims || undefined;
          }
        } catch {
          citations = [];
        }
      }

      return {
        id: m.id,
        role: m.role as "USER" | "ASSISTANT",
        content: m.content,
        claims,
        citations,
        createdAt: m.createdAt.toISOString(),
      };
    });

    return {
      success: true,
      conversationId: conversation.id,
      title: conversation.title,
      messages: messagesView,
    };
  } catch (err: any) {
    console.error("[getPaperConversationAction] Error:", err);
    return {
      success: false,
      messages: [],
      error: "Failed to load conversation history.",
    };
  }
}
