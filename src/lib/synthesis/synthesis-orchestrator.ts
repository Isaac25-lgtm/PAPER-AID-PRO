import { prisma } from "../prisma";
import { getOpenAIClient, AI_CONFIG } from "../ai/config";
import { generateEmbedding } from "../ai/embeddings";
import { authorizePaperAccess, UserContext } from "../auth/paper-authorization";
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
import {
  ResearchSynthesisRequest,
  MultiPaperSynthesisResult,
  DiscoveredPaper,
  PaperEvidenceSet,
  EvidenceAvailability,
  hasSubstantiveAbstract,
  getPaperEvidenceAvailability,
} from "./types";
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

  // 3. Resolve Selected Papers:
  // a) Explicit selectedPaperIds in request
  // b) Persistent selectedPaperIds from prior conversation turn
  // c) Semantic/lexical library discovery across authorized papers
  const userRecord = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  const userContext: UserContext = {
    id: userId,
    role: userRecord?.role || "USER",
  };

  let candidatePaperIds: string[] = [];
  if (Array.isArray(params.selectedPaperIds) && params.selectedPaperIds.length > 0) {
    candidatePaperIds = Array.from(new Set(params.selectedPaperIds.map((id) => id.trim()).filter(Boolean)));
  } else if (conversation) {
    // Check if the previous assistant message in this conversation had persistent selected papers
    const lastAssistantMessage = await prisma.aIMessage.findFirst({
      where: {
        conversationId: conversation.id,
        role: AIMessageRole.ASSISTANT,
      },
      orderBy: { createdAt: "desc" },
      select: { citations: true },
    });
    const priorCitations = lastAssistantMessage?.citations as any;
    if (Array.isArray(priorCitations?.selectedPapers) && priorCitations.selectedPapers.length > 0) {
      candidatePaperIds = priorCitations.selectedPapers.map((p: any) => p.paperId).filter(Boolean);
    }
  }

  let evidenceResult: { evidenceSets: PaperEvidenceSet[]; totalChunks: number };
  let omittedSourcesNotice: string | undefined = undefined;

  if (candidatePaperIds.length > 0) {
    // Explicit or inherited multi-paper selection: Authorize every paper on server
    const fetchedCandidatePapers = await prisma.paper.findMany({
      where: { id: { in: candidatePaperIds } },
      select: {
        id: true,
        title: true,
        abstract: true,
        doi: true,
        arxivId: true,
        pmid: true,
        pmcid: true,
        semanticScholarId: true,
        storagePath: true,
        sourceProvenance: true,
        status: true,
        publicationDate: true,
        journal: true,
        citationCount: true,
        authors: {
          include: { author: { select: { name: true } } },
          orderBy: { orderIndex: "asc" },
        },
        _count: {
          select: { chunks: true },
        },
      },
    });

    const authorizedCandidatePapers: typeof fetchedCandidatePapers = [];
    for (const cp of fetchedCandidatePapers) {
      const auth = await authorizePaperAccess(cp, userContext, "VIEW_METADATA");
      if (auth.allowed) {
        authorizedCandidatePapers.push(cp);
      }
    }

    const omittedCount = Math.max(0, candidatePaperIds.length - authorizedCandidatePapers.length);
    if (omittedCount > 0) {
      omittedSourcesNotice = `${omittedCount} requested source${omittedCount > 1 ? "s" : ""} could not be included in this synthesis (unauthorized or inaccessible).`;
    }

    if (authorizedCandidatePapers.length === 0) {
      const unauthorizedFallbackMsg = omittedSourcesNotice
        ? `${omittedSourcesNotice} None of the accessible documents could be reviewed for evidence.`
        : "None of the selected documents could be accessed or contain evidence for synthesis.";
      const assistantMessage = await prisma.aIMessage.create({
        data: {
          conversationId: conversation.id,
          role: AIMessageRole.ASSISTANT,
          content: unauthorizedFallbackMsg,
          citations: {
            claims: [],
            disagreements: [],
            limitations: [],
            selectedPapers: [],
            libraryScopeNote: LIBRARY_SCOPE_DISCLOSURE,
            insufficientEvidence: true,
            omittedSourcesNotice,
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
        omittedSourcesNotice,
      };
    }

    const fullTextPapers = authorizedCandidatePapers.filter(
      (p) => p.status === "COMPLETED" && p._count.chunks > 0
    );
    const metadataOnlyPapers = authorizedCandidatePapers.filter(
      (p) => p.status === "METADATA_ONLY" || p._count.chunks === 0
    );

    const queryVector = await generateEmbedding(cleanQuestion);

    const fullTextDiscovered: DiscoveredPaper[] = fullTextPapers.map((p) => ({
      paperId: p.id,
      title: p.title,
      authors: p.authors.map((a) => a.author.name),
      publicationDate: p.publicationDate ? p.publicationDate.toISOString() : null,
      doi: p.doi,
      journal: p.journal,
      citationCount: p.citationCount,
      relevanceScore: 1.0,
      bestChunkSimilarity: 1.0,
      matchingChunksCount: p._count.chunks,
      bestChunkSnippet: "",
      bestChunkPage: null,
      bestChunkSection: null,
    }));

    let fullTextResult = { evidenceSets: [] as PaperEvidenceSet[], totalChunks: 0 };
    if (fullTextDiscovered.length > 0) {
      fullTextResult = await retrieveMultiPaperEvidence(fullTextDiscovered, cleanQuestion, {
        queryVector,
        chunksPerPaper: 4,
        maxTotalChunks: 20,
      });
    }

    const combinedEvidenceSets: PaperEvidenceSet[] = [...fullTextResult.evidenceSets];

    for (const mp of metadataOnlyPapers) {
      const hasValidAbstract = hasSubstantiveAbstract(mp.abstract);
      const metaEvidenceSet: PaperEvidenceSet = {
        paperId: mp.id,
        paperTitle: mp.title,
        authors: mp.authors.map((a) => a.author.name),
        doi: mp.doi,
        publicationDate: mp.publicationDate ? mp.publicationDate.toISOString() : null,
        journal: mp.journal,
        citationCount: mp.citationCount,
        abstract: hasValidAbstract ? mp.abstract!.trim() : "No substantive abstract available in scholarly record.",
        isMetadataOnly: true,
        hasAbstract: hasValidAbstract,
        evidenceAvailability: hasValidAbstract ? "ABSTRACT_ONLY" : "METADATA_ONLY",
        chunks: hasValidAbstract
          ? [
              {
                id: `meta-abstract-${mp.id}`,
                paperId: mp.id,
                chunkIndex: 0,
                section: "Abstract (Metadata Only)",
                pageNumber: null,
                text: mp.abstract!.trim(),
                similarity: 0.8,
              },
            ]
          : [],
      };
      combinedEvidenceSets.push(metaEvidenceSet);
    }

    evidenceResult = {
      evidenceSets: combinedEvidenceSets,
      totalChunks: fullTextResult.totalChunks,
    };
  } else {
    // Default mode: Semantic & lexical library discovery across authorized papers
    const discovery = await discoverRelevantPapers(cleanQuestion, {
      maxSelected: maxPapers || DEFAULT_MAX_SELECTED_PAPERS,
      userId: userContext.id,
      userRole: userContext.role,
    });

    const selectedPapers = discovery.selectedPapers;

    if (selectedPapers.length === 0) {
      const fallbackMsg =
        "The available library does not contain enough relevant evidence to answer this research question.";
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

    evidenceResult = await retrieveMultiPaperEvidence(selectedPapers, cleanQuestion, {
      queryVector: discovery.queryVector,
      chunksPerPaper: 4,
      maxTotalChunks: 20,
    });
  }

  const hasAnyAccessibleChunks = evidenceResult.evidenceSets.some((e) => e.chunks.length > 0);
  if (!hasAnyAccessibleChunks) {
    const isExplicitSelection = Boolean(params.selectedPaperIds && params.selectedPaperIds.length > 0);
    const contentMessage = isExplicitSelection
      ? "The selected papers do not contain accessible empirical evidence to answer this research question. The selected references provide bibliographic metadata and titles only, without published abstracts or ingested full-text manuscripts. To synthesize empirical findings, please upload an authorized PDF in My Library, analyze an eligible open-access paper, or select references with available abstracts."
      : MULTI_PAPER_INSUFFICIENT_EVIDENCE_FALLBACK;

    const fallbackScopeNote = isExplicitSelection
      ? "Selected context contains bibliographic metadata only without published abstracts or ingested full-text manuscripts."
      : LIBRARY_SCOPE_DISCLOSURE;

    const emptySelectedMeta = evidenceResult.evidenceSets.map((s) => ({
      paperId: s.paperId,
      paperTitle: s.paperTitle,
      authors: s.authors,
      doi: s.doi,
      publicationDate: s.publicationDate,
      journal: s.journal,
      chunksContributed: 0,
      isMetadataOnly: Boolean(s.isMetadataOnly),
      hasAbstract: Boolean(s.hasAbstract),
      evidenceAvailability: s.evidenceAvailability || (s.isMetadataOnly ? (s.hasAbstract ? "ABSTRACT_ONLY" : "METADATA_ONLY") : "FULL_TEXT"),
      isSupporting: false,
    }));

    const assistantMessage = await prisma.aIMessage.create({
      data: {
        conversationId: conversation.id,
        role: AIMessageRole.ASSISTANT,
        content: contentMessage,
        citations: {
          claims: [],
          disagreements: [],
          limitations: [],
          selectedPapers: emptySelectedMeta,
          supportingPapers: [],
          candidatePapersCount: evidenceResult.evidenceSets.length,
          libraryScopeNote: fallbackScopeNote,
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
      selectedPapers: emptySelectedMeta,
      supportingPapers: [],
      candidatePapersCount: evidenceResult.evidenceSets.length,
      totalEvidenceChunks: 0,
      insufficientEvidence: true,
      libraryScopeNote: fallbackScopeNote,
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
  const validation = validateMultiPaperSynthesis(modelOutput, evidenceResult.evidenceSets, cleanQuestion);

  // FIX 1: Derive supporting-paper IDs strictly from retained, validated claims, disagreements, and limitations
  const citedSupportingPaperIds = new Set<string>();
  for (const c of validation.claims) {
    for (const a of c.citations) {
      if (a.paperId) citedSupportingPaperIds.add(a.paperId);
    }
  }
  for (const d of validation.disagreements) {
    for (const a of d.citations) {
      if (a.paperId) citedSupportingPaperIds.add(a.paperId);
    }
  }
  for (const l of validation.limitations) {
    for (const a of l.citations) {
      if (a.paperId) citedSupportingPaperIds.add(a.paperId);
    }
  }

  // Construct selected papers metadata summary distinguishing candidate context from supporting evidence
  const selectedPapersMeta = evidenceResult.evidenceSets.map((s) => ({
    paperId: s.paperId,
    paperTitle: s.paperTitle,
    authors: s.authors,
    doi: s.doi,
    publicationDate: s.publicationDate,
    journal: s.journal,
    chunksContributed: s.isMetadataOnly ? (s.hasAbstract ? 1 : 0) : s.chunks.length,
    isMetadataOnly: Boolean(s.isMetadataOnly),
    hasAbstract: Boolean(s.hasAbstract),
    evidenceAvailability: s.evidenceAvailability || (s.isMetadataOnly ? (s.hasAbstract ? "ABSTRACT_ONLY" : "METADATA_ONLY") : "FULL_TEXT"),
    isSupporting: citedSupportingPaperIds.has(s.paperId),
  }));

  const supportingPapersMeta = selectedPapersMeta.filter((p) => p.isSupporting);
  const isInsufficient = validation.insufficientEvidence || validation.claims.length === 0;

  // Determine truthful library scope disclosure based on candidate context composition
  const candidateFullText = evidenceResult.evidenceSets.filter((s) => !s.isMetadataOnly && s.chunks.length > 0).length;
  const candidateAbstract = evidenceResult.evidenceSets.filter((s) => s.isMetadataOnly && s.hasAbstract).length;
  const candidateTitleOnly = evidenceResult.evidenceSets.filter((s) => s.isMetadataOnly && !s.hasAbstract).length;

  let computedScopeNote = LIBRARY_SCOPE_DISCLOSURE;
  if (params.selectedPaperIds && params.selectedPaperIds.length > 0) {
    if (candidateFullText > 0 && candidateAbstract === 0 && candidateTitleOnly === 0) {
      computedScopeNote = "Selected context: Grounded strictly in peer-reviewed manuscripts currently ingested in your library.";
    } else if (candidateFullText === 0 && candidateAbstract > 0 && candidateTitleOnly === 0) {
      computedScopeNote = "Selected context: Grounded in peer-reviewed abstracts. Full-text manuscripts have not been ingested for these sources.";
    } else if (candidateFullText === 0 && candidateAbstract === 0) {
      computedScopeNote = "Selected context: Bibliographic metadata and titles only without published abstracts or full text.";
    } else {
      computedScopeNote = `Selected context: Mixed evidence sources (${candidateFullText} full-text, ${candidateAbstract} abstract, ${candidateTitleOnly} metadata-only).`;
    }
  }

  // Assemble human-readable content string for fallback/search display
  let contentText: string;
  if (isInsufficient) {
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
    supportingPapers: supportingPapersMeta,
    candidatePapersCount: evidenceResult.evidenceSets.length,
    libraryScopeNote: computedScopeNote,
    insufficientEvidence: isInsufficient,
    omittedSourcesNotice,
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
    supportingPapers: supportingPapersMeta,
    candidatePapersCount: evidenceResult.evidenceSets.length,
    totalEvidenceChunks: evidenceResult.totalChunks,
    insufficientEvidence: isInsufficient,
    libraryScopeNote: computedScopeNote,
    rejectedCitationCount: validation.rejectedCitationCount,
    rejectedClaimsCount: validation.rejectedClaimsCount,
    omittedSourcesNotice,
  };
}
