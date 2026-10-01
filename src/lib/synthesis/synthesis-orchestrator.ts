import { prisma } from "../prisma";
import { getOpenAIClient, AI_CONFIG } from "../ai/config";
import { discoverRelevantPapers, DEFAULT_MAX_SELECTED_PAPERS } from "./discover-papers";
import { retrieveMultiPaperEvidence } from "./retrieve-multipaper-evidence";
import { validateMultiPaperSynthesis } from "./validate-multipaper-citations";
import {
  buildMultiPaperPrompt,
  MULTI_PAPER_SYSTEM_PROMPT,
  MULTI_PAPER_INSUFFICIENT_EVIDENCE_FALLBACK,
  LIBRARY_SCOPE_DISCLOSURE,
} from "./prompts";
import { MultiPaperSynthesisSchema, MultiPaperSynthesisOutput } from "./schemas";
import { ResearchSynthesisRequest, MultiPaperSynthesisResult } from "./types";
import { zodTextFormat } from "openai/helpers/zod";
import { AIMessageRole } from "@prisma/client";

/**
 * Orchestrates an end-to-end multi-paper research synthesis workflow:
 * 1. Validate inputs and rate/cost safeguards (max 2000 chars, 5s duplicate window).
 * 2. Manage multi-paper conversation thread (paperId = null).
 * 3. Discover and rank candidate papers across the library using pgvector embeddings.
 * 4. Select top relevant papers (up to 5) and retrieve evidence independently from each.
 * 5. Balance evidence across papers (max 4 chunks per paper, max 20 total chunks).
 * 6. Invoke OpenAI Responses API with structured output schema outside DB transactions.
 * 7. Validate claim-level provenance and server-hydrate citation metadata from PostgreSQL.
 * 8. Persist assistant message atomically with structured JSON citations.
 */
export async function synthesizeResearchQuestion(
  params: ResearchSynthesisRequest
): Promise<MultiPaperSynthesisResult> {
  const { question, userId, isNewThread, maxPapers } = params;

  // 1. Input Validation & Cost Safeguards
  const cleanQuestion = question?.trim() || "";
  if (cleanQuestion.length < 2) {
    throw new Error("Research question must contain at least 2 characters.");
  }
  if (cleanQuestion.length > 2000) {
    throw new Error("Research question exceeds maximum length of 2,000 characters.");
  }

  // 2. Resolve or Create Multi-Paper Conversation (paperId = null)
  let conversation: { id: string; userId: string; paperId: string | null; title: string } | null = null;

  if (params.conversationId) {
    const existing = await prisma.aIConversation.findUnique({
      where: { id: params.conversationId },
      select: { id: true, userId: true, paperId: true, title: true },
    });

    if (!existing) {
      throw new Error("Conversation not found.");
    }
    if (existing.userId !== userId) {
      throw new Error("Unauthorized: you do not have permission to access this conversation.");
    }
    if (existing.paperId !== null) {
      throw new Error("Invalid conversation: specified thread is for a single paper, not multi-paper research.");
    }
    conversation = existing;
  } else if (!isNewThread) {
    // Look up most recent multi-paper conversation for this user
    const recent = await prisma.aIConversation.findFirst({
      where: {
        userId,
        paperId: null,
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, userId: true, paperId: true, title: true },
    });
    conversation = recent;
  }

  // Rate & Cost Safeguard: Prevent duplicate rapid submissions in same conversation
  if (conversation) {
    const recentDuplicate = await prisma.aIMessage.findFirst({
      where: {
        conversationId: conversation.id,
        role: AIMessageRole.USER,
        content: cleanQuestion,
        createdAt: { gte: new Date(Date.now() - 5000) },
      },
    });

    if (recentDuplicate) {
      throw new Error("Duplicate submission detected. Please wait a moment before submitting again.");
    }
  }

  if (!conversation) {
    const initialTitle = cleanQuestion.length > 60
      ? cleanQuestion.slice(0, 57) + "..."
      : cleanQuestion;

    conversation = await prisma.aIConversation.create({
      data: {
        userId,
        paperId: null, // multi-paper synthesis thread
        title: initialTitle,
      },
      select: { id: true, userId: true, paperId: true, title: true },
    });
  }

  // Persist user question message
  const userMessage = await prisma.aIMessage.create({
    data: {
      conversationId: conversation.id,
      role: AIMessageRole.USER,
      content: cleanQuestion,
    },
  });

  // 3. Check Library Papers & Run Discovery
  const totalCompletedPapers = await prisma.paper.count({
    where: { status: "COMPLETED" },
  });

  if (totalCompletedPapers === 0) {
    const emptyMsg = "No research papers are currently available in the library for synthesis.";
    const assistantMessage = await prisma.aIMessage.create({
      data: {
        conversationId: conversation.id,
        role: AIMessageRole.ASSISTANT,
        content: emptyMsg,
        citations: {
          claims: [],
          disagreements: [],
          limitations: [],
          selectedPapers: [],
          libraryScopeNote: LIBRARY_SCOPE_DISCLOSURE,
          insufficientEvidence: true,
        },
      },
    });

    return {
      success: true,
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      question: cleanQuestion,
      claims: [],
      disagreements: [],
      limitations: [],
      selectedPapers: [],
      totalEvidenceChunks: 0,
      insufficientEvidence: true,
      libraryScopeNote: LIBRARY_SCOPE_DISCLOSURE,
      rejectedCitationCount: 0,
      rejectedClaimsCount: 0,
    };
  }

  // Discover candidate papers using pgvector semantic search & lexical fusion
  const discovery = await discoverRelevantPapers(cleanQuestion, {
    maxSelected: maxPapers || DEFAULT_MAX_SELECTED_PAPERS,
  });

  const selectedPapers = discovery.selectedPapers;

  if (selectedPapers.length === 0) {
    const fallbackMsg = "The available library does not contain enough relevant evidence to answer this research question.";
    const assistantMessage = await prisma.aIMessage.create({
      data: {
        conversationId: conversation.id,
        role: AIMessageRole.ASSISTANT,
        content: fallbackMsg,
        citations: {
          claims: [],
          disagreements: [],
          limitations: [],
          selectedPapers: [],
          libraryScopeNote: LIBRARY_SCOPE_DISCLOSURE,
          insufficientEvidence: true,
        },
      },
    });

    return {
      success: true,
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      question: cleanQuestion,
      claims: [],
      disagreements: [],
      limitations: [],
      selectedPapers: [],
      totalEvidenceChunks: 0,
      insufficientEvidence: true,
      libraryScopeNote: LIBRARY_SCOPE_DISCLOSURE,
      rejectedCitationCount: 0,
      rejectedClaimsCount: 0,
    };
  }

  // 4. Retrieve evidence independently from EACH selected paper (with anti-dominance caps)
  const evidenceResult = await retrieveMultiPaperEvidence(selectedPapers, cleanQuestion, {
    queryVector: discovery.queryVector,
    chunksPerPaper: 4,
    maxTotalChunks: 20,
  });

  if (evidenceResult.totalChunks === 0) {
    const assistantMessage = await prisma.aIMessage.create({
      data: {
        conversationId: conversation.id,
        role: AIMessageRole.ASSISTANT,
        content: MULTI_PAPER_INSUFFICIENT_EVIDENCE_FALLBACK,
        citations: {
          claims: [],
          disagreements: [],
          limitations: [],
          selectedPapers: selectedPapers.map((p) => ({
            paperId: p.paperId,
            paperTitle: p.title,
            authors: p.authors,
            doi: p.doi,
            publicationDate: p.publicationDate,
            journal: p.journal,
            chunksContributed: 0,
          })),
          libraryScopeNote: LIBRARY_SCOPE_DISCLOSURE,
          insufficientEvidence: true,
        },
      },
    });

    return {
      success: true,
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      question: cleanQuestion,
      claims: [],
      disagreements: [],
      limitations: [],
      selectedPapers: selectedPapers.map((p) => ({
        paperId: p.paperId,
        paperTitle: p.title,
        authors: p.authors,
        doi: p.doi,
        publicationDate: p.publicationDate,
        journal: p.journal,
        chunksContributed: 0,
      })),
      totalEvidenceChunks: 0,
      insufficientEvidence: true,
      libraryScopeNote: LIBRARY_SCOPE_DISCLOSURE,
      rejectedCitationCount: 0,
      rejectedClaimsCount: 0,
    };
  }

  // 5. Fetch bounded conversation history for follow-up question context (last 6 messages)
  const historyMessages = await prisma.aIMessage.findMany({
    where: {
      conversationId: conversation.id,
      id: { not: userMessage.id },
    },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: {
      role: true,
      content: true,
    },
  });

  const formattedHistory = historyMessages
    .reverse()
    .map((m) => ({
      role: m.role as "USER" | "ASSISTANT",
      content: m.content.slice(0, 300),
    }));

  // 6. Build Grouped Multi-Paper Prompt
  const { userPrompt } = buildMultiPaperPrompt(
    cleanQuestion,
    evidenceResult.evidenceSets,
    formattedHistory
  );

  // 7. Invoke OpenAI Responses API with MultiPaperSynthesisSchema outside transactions
  const openai = getOpenAIClient();
  let modelOutput: MultiPaperSynthesisOutput;

  try {
    const response = await openai.responses.parse({
      model: AI_CONFIG.summaryModel,
      instructions: MULTI_PAPER_SYSTEM_PROMPT,
      input: userPrompt,
      text: {
        format: zodTextFormat(MultiPaperSynthesisSchema, "multi_paper_synthesis"),
      },
      max_output_tokens: 2200,
      temperature: 0.1,
      store: false,
    });

    if (response.output_parsed) {
      modelOutput = response.output_parsed as MultiPaperSynthesisOutput;
    } else if (response.output_text) {
      try {
        const rawJson = JSON.parse(response.output_text);
        modelOutput = MultiPaperSynthesisSchema.parse(rawJson);
      } catch (parseErr: any) {
        throw new Error(`Failed to parse structured synthesis output: ${parseErr.message}`);
      }
    } else {
      throw new Error("No structured output received from OpenAI synthesis model.");
    }
  } catch (apiError: any) {
    console.error("[SynthesisOrchestrator] OpenAI API call failed:", apiError?.message || apiError);
    throw new Error(
      `Research synthesis generation failed: ${apiError?.message || "Internal inference error"}`
    );
  }

  // 8. Server-Side Validation and Hydration
  const validation = validateMultiPaperSynthesis(modelOutput, evidenceResult.evidenceSets);

  // Construct selected papers metadata summary
  const selectedPapersMeta = evidenceResult.evidenceSets.map((s) => ({
    paperId: s.paperId,
    paperTitle: s.paperTitle,
    authors: s.authors,
    doi: s.doi,
    publicationDate: s.publicationDate,
    journal: s.journal,
    chunksContributed: s.chunks.length,
  }));

  // Assemble human-readable content string for fallback/search display
  let contentText: string;
  if (validation.insufficientEvidence || validation.claims.length === 0) {
    contentText = MULTI_PAPER_INSUFFICIENT_EVIDENCE_FALLBACK;
  } else {
    const claimParas = validation.claims.map((c) => {
      const paperPlural = c.supportingPaperCount === 1 ? "1 paper" : `${c.supportingPaperCount} papers`;
      return `${c.text.trim()} (Supported by ${paperPlural} in library)`;
    });
    contentText = claimParas.join("\n\n");
  }

  // 9. Atomic Persistence of Assistant Message
  const assistantCitationsPayload = {
    claims: validation.claims,
    disagreements: validation.disagreements,
    limitations: validation.limitations,
    selectedPapers: selectedPapersMeta,
    libraryScopeNote: LIBRARY_SCOPE_DISCLOSURE,
    insufficientEvidence: validation.insufficientEvidence,
  };

  const assistantMessage = await prisma.aIMessage.create({
    data: {
      conversationId: conversation.id,
      role: AIMessageRole.ASSISTANT,
      content: contentText,
      citations: assistantCitationsPayload as any,
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
    question: cleanQuestion,
    claims: validation.claims,
    disagreements: validation.disagreements,
    limitations: validation.limitations,
    selectedPapers: selectedPapersMeta,
    totalEvidenceChunks: evidenceResult.totalChunks,
    insufficientEvidence: validation.insufficientEvidence,
    libraryScopeNote: LIBRARY_SCOPE_DISCLOSURE,
    rejectedCitationCount: validation.rejectedCitationCount,
    rejectedClaimsCount: validation.rejectedClaimsCount,
  };
}
