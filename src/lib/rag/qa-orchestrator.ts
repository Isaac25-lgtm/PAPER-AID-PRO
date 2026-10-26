import { prisma } from "../prisma";
import { getOpenAIClient, AI_CONFIG } from "../ai/config";
import { retrievePaperEvidence } from "./retrieve-paper-evidence";
import { validateQACitations } from "./validate-qa-citations";
import { buildPaperQAPrompt, RAG_SYSTEM_PROMPT, INSUFFICIENT_EVIDENCE_FALLBACK } from "./prompts";
import { PaperQAAnswerSchema, PaperQAAnswerOutput } from "./schemas";
import { PaperQAResponse } from "./types";
import { zodTextFormat } from "openai/helpers/zod";
import { AIMessageRole } from "@prisma/client";
import { authorizePaperAccess } from "../auth/paper-authorization";

export interface AskPaperParams {
  paperId: string;
  question: string;
  userId: string;
  conversationId?: string;
  isNewThread?: boolean;
}

/**
 * Orchestrates a single-paper grounded Q&A query with claim-level provenance.
 *
 * Sequence:
 * 1. Validate user inputs and conversation ownership (strictly paper-scoped).
 * 2. Rate & cost controls: check duplicate rapid submissions (5s window) and length limits (2-2000 chars).
 * 3. Persist user message.
 * 4. Retrieve relevant PaperChunks strictly filtered by paperId.
 * 5. Call OpenAI Responses API with structured output outside long DB transactions.
 * 6. Validate chunk provenance and withhold unsupported claims at the claim level.
 * 7. Persist assistant message with hydrated citation anchors.
 * 8. Safe failure handling: On generation failure, do not create fake assistant messages.
 */
export async function askPaperQuestion(params: AskPaperParams): Promise<PaperQAResponse> {
  const { paperId, question, userId, isNewThread } = params;

  // 1. Validate inputs (Rate & Cost Safeguards)
  const cleanQuestion = question?.trim() || "";
  if (cleanQuestion.length < 2) {
    throw new Error("Question must contain at least 2 characters.");
  }
  if (cleanQuestion.length > 2000) {
    throw new Error("Question exceeds maximum length of 2,000 characters.");
  }

  // 1B. Access Control: Verify user exists and has permission to query this paper
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) {
    throw new Error("User not found.");
  }

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
    throw new Error(`Paper with ID "${paperId}" not found in database.`);
  }

  const authResult = await authorizePaperAccess(paper, user, "INTERACT_AI");
  if (!authResult.allowed) {
    throw new Error("Unauthorized: You do not have permission to query this manuscript.");
  }

  // 2. Resolve or Create Conversation
  let conversation: { id: string; userId: string; paperId: string | null; title: string } | null = null;

  if (params.conversationId) {
    const existing = await prisma.aIConversation.findUnique({
      where: { id: params.conversationId },
      select: { id: true, userId: true, paperId: true, title: true },
    });

    if (!existing) {
      throw new Error("Conversation not found.");
    }

    // Security Verification: Conversation MUST belong to this user AND this paper
    if (existing.userId !== userId) {
      throw new Error("Unauthorized: you do not have permission to access this conversation.");
    }
    if (existing.paperId !== paperId) {
      throw new Error("Security violation: conversation belongs to a different paper.");
    }

    conversation = existing;
  } else if (!isNewThread) {
    // Look up most recent conversation for this user and paper
    const recent = await prisma.aIConversation.findFirst({
      where: {
        userId,
        paperId,
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, userId: true, paperId: true, title: true },
    });

    conversation = recent;
  }

  // Rate & Cost Safeguard: Prevent immediate duplicate submissions in the same conversation
  if (conversation) {
    const recentDuplicate = await prisma.aIMessage.findFirst({
      where: {
        conversationId: conversation.id,
        role: AIMessageRole.USER,
        content: cleanQuestion,
        createdAt: { gte: new Date(Date.now() - 5000) }, // 5-second duplicate window
      },
    });

    if (recentDuplicate) {
      throw new Error("Duplicate submission detected. Please wait a moment before asking the same question again.");
    }
  }

  if (!conversation) {
    // Generate simple title from question without calling LLM (cost protection)
    const initialTitle = cleanQuestion.length > 60
      ? cleanQuestion.slice(0, 57) + "..."
      : cleanQuestion;

    conversation = await prisma.aIConversation.create({
      data: {
        userId,
        paperId,
        title: initialTitle,
      },
      select: { id: true, userId: true, paperId: true, title: true },
    });
  }

  // 3. Persist User Message
  const userMessage = await prisma.aIMessage.create({
    data: {
      conversationId: conversation.id,
      role: AIMessageRole.USER,
      content: cleanQuestion,
    },
  });

  try {
    // 4. Retrieve Paper Evidence (Strictly paper-scoped and authorized)
    const evidenceResult = await retrievePaperEvidence(paperId, cleanQuestion, {
      limit: 8,
      user,
    });

    const { paperTitle, evidenceChunks, insufficientEvidence, evidenceType } = evidenceResult;

    // Short-circuit if no accessible evidence was found
    if (insufficientEvidence || evidenceChunks.length === 0) {
      const assistantMessage = await prisma.aIMessage.create({
        data: {
          conversationId: conversation.id,
          role: AIMessageRole.ASSISTANT,
          content: INSUFFICIENT_EVIDENCE_FALLBACK,
          citations: {
            claims: [],
            anchors: [],
            evidenceType: evidenceType || "ABSTRACT",
            insufficientEvidence: true,
          } as any,
        },
      });

      await prisma.aIConversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });

      return {
        success: true,
        conversationId: conversation.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        answer: INSUFFICIENT_EVIDENCE_FALLBACK,
        claims: [],
        citations: [],
        insufficientEvidence: true,
        evidenceType: evidenceType || "ABSTRACT",
      };
    }

    // 5. Load recent conversation history (last 4 messages prior to the current user message)
    const recentHistory = await prisma.aIMessage.findMany({
      where: {
        conversationId: conversation.id,
        id: { not: userMessage.id },
      },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { role: true, content: true },
    });

    const historyForPrompt = recentHistory
      .reverse()
      .map((m) => ({
        role: (m.role === "USER" ? "USER" : "ASSISTANT") as "USER" | "ASSISTANT",
        content: m.content,
      }));

    // 6. Build Structured Prompt
    const { userPrompt } = buildPaperQAPrompt(
      paperTitle,
      cleanQuestion,
      evidenceChunks,
      historyForPrompt
    );

    let parsedOutput: PaperQAAnswerOutput;

    if (process.env.ALLOW_MOCK_AUTOCOMPLETE === "true") {
      const stopwords = new Set([
        "what", "were", "with", "this", "that", "from", "have", "about", "which",
        "there", "for", "and", "the", "are", "was", "how", "did", "does", "been",
        "reported", "showed", "study", "paper"
      ]);
      const questionWords = cleanQuestion
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !stopwords.has(w));

      const hasRelevantEvidence = evidenceChunks.some((c) => {
        const lower = c.text.toLowerCase();
        return questionWords.some((w) => new RegExp(`\\b${w}\\b`, "i").test(lower));
      });

      if (!hasRelevantEvidence) {
        parsedOutput = {
          claims: [],
          unverifiedAspects: [cleanQuestion],
          insufficientEvidence: true,
        };
      } else {
        const topChunk = evidenceChunks[0];
        parsedOutput = {
          claims: [
            {
              text: `Based on the manuscript evidence in ${topChunk.section || "the text"}, ${topChunk.text.slice(0, 200).trim()}`,
              evidenceChunkIds: [topChunk.id],
            },
          ],
          unverifiedAspects: [],
          insufficientEvidence: false,
        };
      }
    } else {
      // 7. Invoke OpenAI Responses API with Structured Outputs (Claim-Level Provenance)
      const openai = getOpenAIClient();
      const response = await openai.responses.parse({
        model: AI_CONFIG.qaModel,
        instructions: RAG_SYSTEM_PROMPT,
        input: userPrompt,
        text: {
          format: zodTextFormat(PaperQAAnswerSchema, "paper_qa_answer"),
        },
        max_output_tokens: 1200, // Token output safeguard
        temperature: 0.1, // Low temperature for maximum scientific fidelity
        store: false,
      });

      if (response.output_parsed) {
        parsedOutput = response.output_parsed as PaperQAAnswerOutput;
      } else if (response.output_text) {
        try {
          const rawJson = JSON.parse(response.output_text);
          parsedOutput = PaperQAAnswerSchema.parse(rawJson);
        } catch (err: any) {
          throw new Error(`OpenAI response schema parsing failed: ${err.message}`);
        }
      } else {
        throw new Error("OpenAI Responses API returned an empty output.");
      }
    }

    // 8. Validate Claims and Enforce Unsupported Claim Withholding
    const validatedResult = validateQACitations(parsedOutput, evidenceChunks, paperId);

    // 9. Persist Assistant Message (with claim-level and anchor metadata)
    const assistantMessage = await prisma.aIMessage.create({
      data: {
        conversationId: conversation.id,
        role: AIMessageRole.ASSISTANT,
        content: validatedResult.answer,
        citations: {
          claims: validatedResult.claims,
          anchors: validatedResult.citations,
          unverifiedAspects: validatedResult.unverifiedAspects,
          evidenceType: validatedResult.evidenceType || evidenceType,
          insufficientEvidence: validatedResult.insufficientEvidence,
        } as any,
      },
    });

    // Update conversation timestamp
    await prisma.aIConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    return {
      success: true,
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      answer: validatedResult.answer,
      claims: validatedResult.claims,
      citations: validatedResult.citations,
      unverifiedAspects: validatedResult.unverifiedAspects,
      insufficientEvidence: validatedResult.insufficientEvidence,
      evidenceType: validatedResult.evidenceType || evidenceType,
    };
  } catch (err: any) {
    const rawError = err instanceof Error ? err.message : String(err);
    const sanitizedError = rawError
      .replace(/sk-[a-zA-Z0-9_\-]{20,}/g, "[REDACTED_API_KEY]")
      .replace(/postgres:\/\/[^@]+@/g, "postgresql://[REDACTED]@");

    console.error(`[PaperQAOrchestrator] Error processing question for paper ${paperId}:`, sanitizedError);

    // CRITICAL (Section 8): Do NOT create a fake successful assistant message in the database.
    // Return a safe retryable error to the UI without corrupting conversation state.
    return {
      success: false,
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      answer: "We were unable to generate an evidence-grounded answer due to a service error. Please try again.",
      citations: [],
      insufficientEvidence: false,
      error: sanitizedError,
    };
  }
}
