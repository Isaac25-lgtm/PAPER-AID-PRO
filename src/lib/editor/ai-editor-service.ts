import { getModelRouter, ModelRouter } from "../ai/router";
import { prisma } from "../prisma";
import { assertPaperAccess } from "./document-service";

export type RewriteMode = "academic_tone" | "rewrite" | "concise" | "expand";

export interface AutocompleteParams {
  documentId: string;
  prefixText: string;
  suffixText?: string;
  selectedSourceIds?: string[];
}

export interface RewriteParams {
  documentId: string;
  selectedText: string;
  mode: RewriteMode;
  surroundingContext?: string;
}

export interface SummarizeEvidenceParams {
  documentId: string;
  paperId: string;
  userPrompt?: string;
}

const ACADEMIC_WRITING_SYSTEM_PROMPT = `You are the AI Research Hub Academic Writing Engine.
You assist scholars, PhD candidates, and research scientists in drafting rigorous, empirical manuscripts.
RULES:
1. Scientific Tone: Use formal, precise academic vocabulary. Avoid conversational idioms or hyperbole.
2. Empirical Grounding: Never fabricate empirical figures, statistical tests, or DOIs.
3. Natural Flow: In autocomplete mode, produce only the direct continuation text without repeating prefix words or adding markdown meta-commentary.
4. Privacy: All user drafts are classified as strictly private research manuscripts.`;

/**
 * Generates an inline autocomplete completion (Jenni-style ghost text).
 * Routes to FAST_MODEL (gemini-3.5-flash-lite) with graceful fallback to gpt-4o-mini.
 */
export async function generateInlineAutocomplete(
  userId: string,
  params: AutocompleteParams,
  routerOverride?: ModelRouter
) {
  // 1. Verify document ownership
  const doc = await prisma.researchDocument.findUnique({
    where: { id: params.documentId },
    select: { id: true, userId: true, title: true },
  });
  if (!doc || doc.userId !== userId) {
    throw new Error(`Research document '${params.documentId}' not found.`);
  }

  // 2. Fetch context from selected sources if provided
  let sourceContext = "";
  if (params.selectedSourceIds && params.selectedSourceIds.length > 0) {
    const papers = await prisma.paper.findMany({
      where: { id: { in: params.selectedSourceIds } },
      select: { title: true, abstract: true },
      take: 3,
    });
    if (papers.length > 0) {
      sourceContext = `\n[REFERENCE RESEARCH PAPERS FOR CONTEXT]:\n` +
        papers.map((p) => `- "${p.title}": ${p.abstract.slice(0, 300)}...`).join("\n");
    }
  }

  // 3. Format prompt
  const prompt = `DOCUMENT TITLE: ${doc.title}
${sourceContext}
EXISTING TEXT BEFORE CURSOR:
"""${params.prefixText.slice(-1500)}"""
${params.suffixText ? `TEXT AFTER CURSOR:\n"""${params.suffixText.slice(0, 300)}"""\n` : ""}
INSTRUCTION: Continue drafting the next 1 to 2 cohesive academic sentences that logically follow the existing text. Output ONLY the continuation text with no preamble or quotes.`;

  const router = routerOverride || getModelRouter();
  const response = await router.route({
    task: "autocomplete",
    prompt,
    systemPrompt: ACADEMIC_WRITING_SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 128, // Fast, low-latency completion
    privacyClassification: "PRIVATE",
    allowFallback: true,
  });

  // Clean suggestion: strip leading/trailing quotes or markdown backticks if returned
  let suggestion = response.text.trim();
  if (suggestion.startsWith('"') && suggestion.endsWith('"')) {
    suggestion = suggestion.slice(1, -1).trim();
  }
  if (suggestion.startsWith("```") && suggestion.endsWith("```")) {
    suggestion = suggestion.replace(/```[a-z]*\n?/gi, "").trim();
  }

  return {
    suggestion,
    provider: response.provider,
    model: response.model,
    cost: response.cost,
    metrics: response.metrics,
  };
}

/**
 * Rewrites selected academic text based on the desired scholarly mode.
 * Routes to SMART_MODEL (claude-sonnet-5) with graceful fallback to gpt-4o.
 */
export async function rewriteSelectedText(
  userId: string,
  params: RewriteParams,
  routerOverride?: ModelRouter
) {
  // 1. Verify document ownership
  const doc = await prisma.researchDocument.findUnique({
    where: { id: params.documentId },
    select: { id: true, userId: true, title: true },
  });
  if (!doc || doc.userId !== userId) {
    throw new Error(`Research document '${params.documentId}' not found.`);
  }

  // 2. Select instruction prompt
  let instructionText = "";
  switch (params.mode) {
    case "academic_tone":
      instructionText =
        "Rewrite the selected passage to enhance scholarly rigor, formal academic syntax, and objective phrasing. Eliminate conversational phrasing and weak verbs while faithfully preserving the empirical and conceptual meaning.";
      break;
    case "rewrite":
      instructionText =
        "Paraphrase the selected academic passage to improve prose flow, syntactic clarity, and sentence variety.";
      break;
    case "concise":
      instructionText =
        "Tighten the selected academic text by eliminating redundancy, passive fluff, and unnecessary adjectives while preserving all substantive scientific claims.";
      break;
    case "expand":
      instructionText =
        "Elaborate on the conceptual and theoretical depth of the selected passage, providing scholarly nuance and analytical framing without inventing ungrounded empirical measurements.";
      break;
  }

  const prompt = `DOCUMENT TITLE: ${doc.title}
${params.surroundingContext ? `SURROUNDING PARAGRAPH CONTEXT:\n"""${params.surroundingContext.slice(-800)}"""\n` : ""}
SELECTED TEXT TO REVISE:
"""${params.selectedText}"""

TASK: ${instructionText}
Output ONLY the revised academic text with no commentary, quotation marks, or explanations.`;

  const router = routerOverride || getModelRouter();
  const response = await router.route({
    task: params.mode === "expand" ? "drafting" : "rewriting",
    prompt,
    systemPrompt: ACADEMIC_WRITING_SYSTEM_PROMPT,
    temperature: 0.3,
    maxTokens: params.mode === "expand" ? 1024 : 512,
    privacyClassification: "PRIVATE",
    allowFallback: true,
  });

  let replacementText = response.text.trim();
  if (replacementText.startsWith('"') && replacementText.endsWith('"')) {
    replacementText = replacementText.slice(1, -1).trim();
  }

  return {
    replacementText,
    originalText: params.selectedText,
    mode: params.mode,
    provider: response.provider,
    model: response.model,
    cost: response.cost,
    metrics: response.metrics,
  };
}

/**
 * Summarizes verifiable evidence from an attached library paper for 1-click insertion into the editor.
 */
export async function summarizeEvidenceForEditor(
  userId: string,
  params: SummarizeEvidenceParams,
  routerOverride?: ModelRouter
) {
  // 1. Verify document ownership
  const doc = await prisma.researchDocument.findUnique({
    where: { id: params.documentId },
    select: { id: true, userId: true },
  });
  if (!doc || doc.userId !== userId) {
    throw new Error(`Research document '${params.documentId}' not found.`);
  }

  // 2. Verify paper access
  await assertPaperAccess(userId, params.paperId);

  // 3. Fetch paper metadata and representative chunks
  const paper = await prisma.paper.findUnique({
    where: { id: params.paperId },
    include: {
      authors: {
        include: { author: true },
        orderBy: { orderIndex: "asc" },
      },
      chunks: {
        take: 4,
        select: { id: true, text: true, section: true, pageNumber: true },
      },
    },
  });

  if (!paper) {
    throw new Error(`Paper '${params.paperId}' not found.`);
  }

  // Build standard in-text citation: e.g. (Vaswani et al., 2017)
  const firstAuthor = paper.authors[0]?.author?.name || "Unknown";
  const authorLastName = firstAuthor.split(" ").pop() || firstAuthor;
  const year = paper.publicationDate
    ? new Date(paper.publicationDate).getFullYear()
    : "n.d.";
  const citationText =
    paper.authors.length > 2
      ? `(${authorLastName} et al., ${year})`
      : paper.authors.length === 2
      ? `(${authorLastName} & ${paper.authors[1]?.author?.name.split(" ").pop()}, ${year})`
      : `(${authorLastName}, ${year})`;

  const evidenceChunks = paper.chunks.map((c) => c.text).join("\n\n");
  const representativeChunk = paper.chunks[0];

  const prompt = `RESEARCH PAPER TITLE: "${paper.title}"
AUTHORS: ${paper.authors.map((a) => a.author.name).join(", ")} (${year})
ABSTRACT:
${paper.abstract}

MANUSCRIPT EVIDENCE EXCERPTS:
${evidenceChunks || paper.abstract}

USER FOCUS: ${params.userPrompt || "Summarize the primary contribution and methodology."}

INSTRUCTION:
Write a single concise, academic paragraph summarizing this paper's core findings or methodology in an evidence-grounded manner suitable for direct insertion into a literature review.
Integrate the in-text citation ${citationText} naturally into the text.
Output ONLY the synthesized paragraph.`;

  const router = routerOverride || getModelRouter();
  const response = await router.route({
    task: "drafting",
    prompt,
    systemPrompt: ACADEMIC_WRITING_SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 512,
    privacyClassification: "PRIVATE",
    allowFallback: true,
  });

  return {
    synthesizedText: response.text.trim(),
    citationText,
    paperId: paper.id,
    paperTitle: paper.title,
    chunkId: representativeChunk?.id,
    pageNumber: representativeChunk?.pageNumber,
    section: representativeChunk?.section,
    provider: response.provider,
    model: response.model,
    cost: response.cost,
  };
}
