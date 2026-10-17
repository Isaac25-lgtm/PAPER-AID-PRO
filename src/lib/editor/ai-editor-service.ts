import { getModelRouter, ModelRouter } from "../ai/router";
import { prisma } from "../prisma";
import { assertPaperAccess } from "./document-service";
import { normalizeSuggestionSpacingAndDeduplication } from "./guided-templates";

export type RewriteMode = "academic_tone" | "rewrite" | "concise" | "expand";

export interface AutocompleteParams {
  documentId: string;
  prefixText: string;
  suffixText?: string;
  selectedSourceIds?: string[];
  currentSection?: string;
  researchTopic?: string;
  docType?: string;
  studyDesign?: string;
  objectives?: {
    general?: string;
    specific?: string[];
  };
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
  // 1. Verify document ownership & retrieve metadata
  const doc = await prisma.researchDocument.findUnique({
    where: { id: params.documentId },
    select: { id: true, userId: true, title: true, docType: true, content: true },
  });
  if (!doc || doc.userId !== userId) {
    throw new Error(`Research document '${params.documentId}' not found.`);
  }

  const docMeta = ((doc.content as any)?.meta || {}) as {
    researchTopic?: string;
    docType?: string;
    studyDesign?: string;
    objectives?: { general?: string; specific?: string[] };
  };

  const topic = params.researchTopic || docMeta.researchTopic || doc.title || "the specified research problem";
  const docType = params.docType || docMeta.docType || doc.docType;
  const studyDesign = params.studyDesign || docMeta.studyDesign || "";
  const generalObjective = params.objectives?.general || docMeta.objectives?.general || "";
  const specificObjectives = params.objectives?.specific || docMeta.objectives?.specific || [];
  const currentSection = (params.currentSection || "").trim();

  // 2. Fetch context from selected sources if provided (strictly enforcing user access control)
  let sourceContext = "";
  if (params.selectedSourceIds && params.selectedSourceIds.length > 0) {
    const accessiblePapers: { title: string; abstract: string }[] = [];
    for (const paperId of params.selectedSourceIds.slice(0, 3)) {
      try {
        const allowed = await assertPaperAccess(userId, paperId);
        if (allowed) {
          const p = await prisma.paper.findUnique({
            where: { id: paperId },
            select: { title: true, abstract: true },
          });
          if (p && p.abstract) {
            accessiblePapers.push(p);
          }
        }
      } catch {
        // Skip inaccessible papers or quarantined benchmark fixtures
      }
    }

    if (accessiblePapers.length > 0) {
      sourceContext = `\n[REFERENCE RESEARCH PAPERS FOR CONTEXT]:\n` +
        accessiblePapers.map((p) => `- "${p.title}": ${p.abstract.slice(0, 300)}...`).join("\n");
    }
  }

  // 3. Format prompt
  const prompt = `DOCUMENT METADATA:
- Title / Topic: ${topic}
- Document Type: ${docType}
${studyDesign ? `- Study Design: ${studyDesign}\n` : ""}${generalObjective ? `- General Objective: ${generalObjective}\n` : ""}${specificObjectives.length > 0 ? `- Specific Objectives:\n${specificObjectives.map((o: string) => `  * ${o}`).join("\n")}\n` : ""}${currentSection ? `- Current Active Section Heading: "${currentSection}"\n` : ""}${sourceContext}
EXISTING TEXT BEFORE CURSOR:
"""${params.prefixText.slice(-1500)}"""
${params.suffixText ? `TEXT AFTER CURSOR:\n"""${params.suffixText.slice(0, 300)}"""\n` : ""}
INSTRUCTION: Continue drafting the next 1 to 2 cohesive academic sentences that logically follow the existing text under the active section "${currentSection || "manuscript"}".
CRITICAL SCIENTIFIC INTEGRITY RULES:
- Never invent patient numbers, sample sizes, empirical statistics, methods already executed, or unsupported citations.
- Output ONLY the direct continuation text without repeating prefix words or adding preamble.`;

  // 4. Autocomplete Safety & Environment Gate:
  // Deterministic mock autocomplete is available ONLY in explicitly isolated development and test environments.
  // In production, missing or unavailable AI providers must fail gracefully.
  // Never present mock suggestions as genuine AI-generated research assistance.
  const isProduction = process.env.NODE_ENV === "production";
  const isIsolatedMockEnv =
    !isProduction &&
    (process.env.ALLOW_MOCK_AUTOCOMPLETE === "true" ||
      process.env.NODE_ENV === "test" ||
      process.env.USE_MOCK_STORAGE === "true");

  if (!routerOverride && process.env.ENABLE_LIVE_AI_AUTOCOMPLETE !== "true") {
    if (isIsolatedMockEnv) {
      const cleanPrefix = params.prefixText.trim();
      const lowerSec = currentSection.toLowerCase();
      let mockContinuation = "";

      if (lowerSec.includes("intro") || lowerSec.includes("background")) {
        mockContinuation = `Previous investigations into ${topic} highlight substantial promise, yet establishing reproducible methodological consensus remains an ongoing priority across the research community.`;
      } else if (lowerSec.includes("objective") || lowerSec.includes("aims") || lowerSec.includes("hypothes")) {
        if (generalObjective) {
          mockContinuation = `Specifically, this inquiry aligns directly with the primary objective to systematically evaluate outcomes under pre-specified validation benchmarks.`;
        } else {
          mockContinuation = `Specifically, this work aims to evaluate primary and secondary outcome metrics across controlled reference cohorts.`;
        }
      } else if (lowerSec.includes("method") || lowerSec.includes("protocol") || lowerSec.includes("design") || lowerSec.includes("strategy")) {
        const designLabel = studyDesign ? `the ${studyDesign} protocol` : "the methodological framework";
        mockContinuation = `To ensure empirical validity, ${designLabel} establishes pre-registered observation protocols, standardized inclusion criteria, and reproducible analytical pipelines.`;
      } else if (lowerSec.includes("result") || lowerSec.includes("finding") || lowerSec.includes("synthesis")) {
        mockContinuation = `Comparative observations demonstrate consistent stability across validation iterations, maintaining alignment with theoretical expectations without systematic divergence.`;
      } else if (lowerSec.includes("discussion") || lowerSec.includes("implication") || lowerSec.includes("significance")) {
        mockContinuation = `These observations directly reinforce the stated study objectives by elucidating key contextual variables while identifying necessary parameters for subsequent prospective trials.`;
      } else if (lowerSec.includes("limitation") || lowerSec.includes("ethical") || lowerSec.includes("pitfall")) {
        mockContinuation = `Key methodological boundaries include observational horizon constraints and cohort distribution variability, indicating the necessity of prospective multi-center replication.`;
      } else {
        if (cleanPrefix.endsWith(".") || cleanPrefix.endsWith("!") || cleanPrefix.endsWith("?")) {
          mockContinuation = "Furthermore, ongoing comparative evaluations demonstrate consistent convergence across standardized benchmark environments.";
        } else if (cleanPrefix.endsWith(",")) {
          mockContinuation = "thereby mitigating systematic variance while preserving fine-grained feature representations.";
        } else if (cleanPrefix.toLowerCase().includes("method") || cleanPrefix.toLowerCase().includes("approach")) {
          mockContinuation = "incorporates rigorous cross-validation protocols to ensure replicability and minimize selection bias.";
        } else {
          mockContinuation = "which provides empirical grounding for subsequent comparative evaluations across diverse cohorts.";
        }
      }

      const normalizedSuggestion = normalizeSuggestionSpacingAndDeduplication(
        params.prefixText,
        mockContinuation
      );

      return {
        suggestion: normalizedSuggestion,
        provider: "mock" as any,
        model: "deterministic-academic-mock",
        cost: { estimatedCostUsd: 0, isEstimate: true, pricingTier: "local-mock" },
        metrics: { ttftMs: 25, durationMs: 40 },
      };
    }

    // In production, missing or unavailable AI providers must fail gracefully.
    // Never present mock suggestions as genuine AI-generated research assistance.
    throw new Error(
      "AI Autocomplete service is currently unavailable. Genuine AI assistance requires an active, authorized provider."
    );
  }

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

  suggestion = normalizeSuggestionSpacingAndDeduplication(params.prefixText, suggestion);

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
