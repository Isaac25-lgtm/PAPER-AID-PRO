import { getOpenAIClient, AI_CONFIG } from "../ai/config";
import { zodTextFormat } from "openai/helpers/zod";
import {
  AGENT_BRIEF_SYNTHESIS_SYSTEM_PROMPT,
  buildBriefSynthesisPrompt,
} from "./prompts";
import { BriefSynthesisSchema, RawBriefSynthesis } from "./schemas";
import {
  StudyEvidence,
  ResearchPlan,
  ResearchBrief,
  ValidatedAgentClaim,
  ValidatedAgentCorroboration,
  ValidatedAgentDisagreement,
  ValidatedAgentResearchGap,
  CorpusGapEvidence,
  FeatureReportingStatus,
} from "./types";
import { RetrievedEvidenceChunk, HydratedMultiPaperAnchor } from "../synthesis/types";

function formatSnippet(text: string, maxLength: number = 240): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  const truncated = cleaned.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 50 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

/**
 * Computes deterministic study-set accounting for a specific scientific dimension across all assessed studies.
 *
 * Guarantees:
 * - Every assessed paper ID is explicitly tracked.
 * - UNKNOWN is strictly distinguished from ABSENT. UNKNOWN is NEVER collapsed into ABSENT.
 * - Server computes all arithmetic.
 */
export function computeCorpusGapEvidence(
  field: string,
  studies: StudyEvidence[],
  featureExtractor: (study: StudyEvidence) => FeatureReportingStatus
): CorpusGapEvidence {
  const assessedPaperIds: string[] = [];
  const papersReportingFeature: string[] = [];
  const papersNotReportingFeature: string[] = [];
  const papersUnknown: string[] = [];

  for (const s of studies) {
    assessedPaperIds.push(s.paperId);
    const status = featureExtractor(s);
    if (status === "PRESENT") {
      papersReportingFeature.push(s.paperId);
    } else if (status === "ABSENT_IN_RETRIEVED_EVIDENCE") {
      papersNotReportingFeature.push(s.paperId);
    } else {
      papersUnknown.push(s.paperId);
    }
  }

  return {
    field,
    assessedPaperIds,
    papersReportingFeature,
    papersNotReportingFeature,
    papersUnknown,
    totalPapersAssessed: assessedPaperIds.length,
    coverageComplete: assessedPaperIds.length === studies.length && studies.length > 0,
  };
}

export interface ValidateCorpusGapResult {
  accepted: boolean;
  reason?: string;
  validatedGap?: ValidatedAgentResearchGap;
}

/**
 * Validates research gaps according to scientific integrity rules:
 *
 * A. EXPLICITLY_STATED_BY_AUTHORS:
 *    Retained if valid manuscript citation anchors exist from the authoring paper.
 *
 * B. SCOPED_CURRENT_SET_OBSERVATION:
 *    Corpus-level assertion requiring whole-study-set accounting.
 *    - An absolute "none" / absence claim is ONLY allowed when:
 *      1. All studies relevant to comparison are assessed (coverageComplete === true)
 *      2. papersReportingFeature.length === 0
 *      3. papersUnknown.length === 0 (no study is UNKNOWN)
 *    - If 1 or more studies are UNKNOWN, the absolute "none" claim is rejected and weakened to:
 *      "External validation was not identified in the retrieved evidence from X of the Y studies; evidence was insufficient to determine this for the remaining Z."
 *    - If 1 or more studies are PRESENT, any "none" claim is rejected outright.
 *    - If the model fabricated counts (e.g. "5 of 5" when true counts are different), the server replaces/rejects the model count.
 */
export function validateCorpusGap(
  rawGap: {
    description: string;
    type: "EXPLICITLY_STATED_BY_AUTHORS" | "SCOPED_CURRENT_SET_OBSERVATION";
    evidence?: Array<{ paperId: string; chunkIds: string[] }>;
  },
  studies: StudyEvidence[],
  validAnchors: HydratedMultiPaperAnchor[],
  uniquePaperIds: string[]
): ValidateCorpusGapResult {
  // A. Author-stated gaps: normal citation validation
  if (rawGap.type === "EXPLICITLY_STATED_BY_AUTHORS") {
    if (validAnchors.length === 0) {
      return {
        accepted: false,
        reason: "Author-stated gap lacks valid manuscript citation anchors.",
      };
    }
    return {
      accepted: true,
      validatedGap: {
        description: rawGap.description.trim(),
        type: "EXPLICITLY_STATED_BY_AUTHORS",
        supportingPaperIds: uniquePaperIds,
        citations: validAnchors,
      },
    };
  }

  // B. SCOPED_CURRENT_SET_OBSERVATION: Corpus-level assertion
  let field = "externalValidation";
  let featureExtractor = (s: StudyEvidence): FeatureReportingStatus =>
    s.externalValidationStatus ?? "UNKNOWN";

  if (
    /prospective\s+(validation|study|clinical|evaluation)/i.test(
      rawGap.description
    )
  ) {
    field = "prospectiveValidation";
    featureExtractor = (s: StudyEvidence): FeatureReportingStatus => {
      const design = s.studyDesign?.toLowerCase() || "";
      if (design.includes("prospective")) return "PRESENT";
      if (design.includes("retrospective")) return "ABSENT_IN_RETRIEVED_EVIDENCE";
      return "UNKNOWN";
    };
  }

  const corpusEvidence = computeCorpusGapEvidence(field, studies, featureExtractor);

  // Combine citations: anchors from valid citations + anchors from assessed studies
  const combinedAnchors: HydratedMultiPaperAnchor[] = [...validAnchors];
  const seenAnchorChunks = new Set(validAnchors.map((a) => a.chunkId));
  for (const s of studies) {
    for (const a of s.evidenceAnchors) {
      if (!seenAnchorChunks.has(a.chunkId)) {
        combinedAnchors.push(a);
        seenAnchorChunks.add(a.chunkId);
      }
    }
  }

  let description = rawGap.description.trim();

  // Detect absence claims
  const isNoneOrAbsenceClaim =
    /\b(none\b|no\s+study|no\s+studies|neither|zero|absent|lacked\b|lacking\b|did\s+not\s+perform|did\s+not\s+report)/i.test(
      description
    );

  // Detect quantified fractions "X of Y"
  const fractionMatch = description.match(/(\d+)\s+of\s+(\d+)/i);

  // 1. If model claims "none" or absence, but feature is reported as PRESENT in >= 1 study: REJECT
  if (isNoneOrAbsenceClaim && corpusEvidence.papersReportingFeature.length > 0) {
    return {
      accepted: false,
      reason: `Validator rejected 'none' claim: ${corpusEvidence.field} is present in ${corpusEvidence.papersReportingFeature.length} of ${corpusEvidence.totalPapersAssessed} assessed studies.`,
    };
  }

  // 2. If model claims "none" or absence, but some studies are UNKNOWN: WEAKEN to safe alternative
  if (isNoneOrAbsenceClaim && corpusEvidence.papersUnknown.length > 0) {
    const weakenedDescription = `Among the studies included in this research run, external validation was not identified in the retrieved evidence from ${corpusEvidence.papersNotReportingFeature.length} of the ${corpusEvidence.totalPapersAssessed} studies; evidence was insufficient to determine this for the remaining ${corpusEvidence.papersUnknown.length}.`;
    return {
      accepted: true,
      validatedGap: {
        description: weakenedDescription,
        type: "SCOPED_CURRENT_SET_OBSERVATION",
        supportingPaperIds: corpusEvidence.assessedPaperIds,
        citations: combinedAnchors,
        corpusEvidence,
      },
    };
  }

  // 3. If model states "X of Y", server validates and corrects/replaces count
  if (fractionMatch) {
    const statedNum = parseInt(fractionMatch[1], 10);
    const statedTotal = parseInt(fractionMatch[2], 10);
    const trueAbsent = corpusEvidence.papersNotReportingFeature.length;
    const trueTotal = corpusEvidence.totalPapersAssessed;

    if (statedNum !== trueAbsent || statedTotal !== trueTotal) {
      if (corpusEvidence.papersReportingFeature.length > 0 && isNoneOrAbsenceClaim) {
        return {
          accepted: false,
          reason: `Validator rejected fabricated model count '${statedNum} of ${statedTotal}': feature is present in ${corpusEvidence.papersReportingFeature.length} studies.`,
        };
      }

      description = description.replace(
        fractionMatch[0],
        `${trueAbsent} of ${trueTotal}`
      );
      if (corpusEvidence.papersUnknown.length > 0 && !description.includes("insufficient")) {
        description += ` (evidence was insufficient for ${corpusEvidence.papersUnknown.length} of ${trueTotal} studies)`;
      }
    }
  }

  // 4. Complete verified absence: scoped "none" claim allowed
  const lower = description.toLowerCase();
  const hasProperScope =
    lower.includes("among the studies included") ||
    lower.includes("in the papers included") ||
    lower.includes("in this evidence set") ||
    lower.includes("in the analyzed studies") ||
    lower.includes("in the current research run");

  if (!hasProperScope) {
    description = `Among the studies included in this research run, ${description.charAt(0).toLowerCase()}${description.slice(1)}`;
  }

  return {
    accepted: true,
    validatedGap: {
      description,
      type: "SCOPED_CURRENT_SET_OBSERVATION",
      supportingPaperIds: corpusEvidence.assessedPaperIds,
      citations: combinedAnchors,
      corpusEvidence,
    },
  };
}

/**
 * Synthesizes a structured Research Brief and performs rigorous claim-level validation
 * and provenance hydration.
 *
 * Validation Guarantees:
 * 1. Paper and chunk existence strictly verified against retrieved chunks.
 * 2. Cross-paper mismatch prevention: chunk must belong to cited paper.
 * 3. Withholding: Claims that lose all valid citations are dropped completely.
 * 4. Corroboration verification: Requires >= 2 UNIQUE papers. Demoted if < 2.
 * 5. Research gap scoping & corpus-level accounting: Mandates study-set accounting for observed absences.
 * 6. Server hydration: Snippets, page numbers, sections, authors, DOIs hydrated server-side.
 */
export async function synthesizeResearchBrief(
  objective: string,
  plan: ResearchPlan,
  studies: StudyEvidence[],
  allChunks: RetrievedEvidenceChunk[],
  metadataOnlyCandidatesCount: number = 0
): Promise<ResearchBrief> {
  // If zero chunks retrieved, return early with insufficient evidence
  if (allChunks.length === 0 || studies.length === 0) {
    return {
      objective,
      executiveSummary:
        "Insufficient empirical evidence was available in the analyzed manuscripts to address the research objective.",
      scopeDisclosure: `Evaluated ${studies.length} papers (${allChunks.length} chunks). No evidence available.`,
      papersConsideredCount: studies.length + metadataOnlyCandidatesCount,
      evidenceReadyPapersCount: studies.length,
      metadataOnlyCandidatesCount,
      keyFindings: [],
      studyComparison: studies,
      corroboratedFindings: [],
      disagreementsAndHeterogeneity: [],
      evidenceSupportedLimitations: [],
      researchGaps: [],
      unansweredQuestions: plan.researchQuestions,
      totalEvidenceChunksUsed: 0,
      rejectedCitationsCount: 0,
      rejectedClaimsCount: 0,
      insufficientEvidence: true,
    };
  }

  // 1. Build Chunk & Paper Lookup
  interface PaperLookup {
    title: string;
    authors: string[];
    year?: number | null;
    journal?: string | null;
    doi?: string | null;
    chunks: Map<string, RetrievedEvidenceChunk>;
  }

  const paperLookup = new Map<string, PaperLookup>();

  for (const s of studies) {
    paperLookup.set(s.paperId, {
      title: s.title,
      authors: s.authors,
      year: s.year,
      journal: s.journal,
      doi: s.doi,
      chunks: new Map(),
    });
  }

  for (const c of allChunks) {
    const p = paperLookup.get(c.paperId);
    if (p) {
      p.chunks.set(c.id, c);
    }
  }

  // 2. Build synthesis prompt
  const userPrompt = buildBriefSynthesisPrompt(
    objective,
    plan.researchQuestions,
    studies.map((s) => ({
      paperId: s.paperId,
      title: s.title,
      year: s.year,
      sampleSize: s.sampleSize,
      aiMethod: s.aiMethod,
      validationMethod: s.validationMethod,
      externalValidationStatus: s.externalValidationStatus,
      sensitivity: s.sensitivity,
      specificity: s.specificity,
      auc: s.auc,
      majorFindings: s.majorFindings,
      limitations: s.limitations,
    })),
    allChunks.map((c) => ({
      id: c.id,
      paperId: c.paperId,
      pageNumber: c.pageNumber,
      section: c.section,
      text: c.text,
    }))
  );

  const openai = getOpenAIClient();
  let rawSynthesis: RawBriefSynthesis;

  try {
    const response = await openai.responses.parse({
      model: AI_CONFIG.summaryModel,
      instructions: AGENT_BRIEF_SYNTHESIS_SYSTEM_PROMPT,
      input: userPrompt,
      text: {
        format: zodTextFormat(BriefSynthesisSchema, "brief_synthesis"),
      },
      max_output_tokens: 3000,
      temperature: 0.1,
      store: false,
    });

    if (response.output_parsed) {
      rawSynthesis = response.output_parsed as RawBriefSynthesis;
    } else if (response.output_text) {
      rawSynthesis = BriefSynthesisSchema.parse(JSON.parse(response.output_text));
    } else {
      throw new Error("Empty structured response from synthesis model.");
    }
  } catch (err: any) {
    console.error("[BriefSynthesizer] Model synthesis failed:", err?.message || err);
    throw new Error(`Research brief synthesis failed: ${err?.message || "Inference error"}`);
  }

  let rejectedCitationsCount = 0;
  let rejectedClaimsCount = 0;
  const usedChunkIds = new Set<string>();

  // Helper to validate and hydrate evidence refs
  const validateEvidenceRefs = (
    refs: Array<{ paperId: string; chunkIds: string[] }>
  ): {
    validAnchors: HydratedMultiPaperAnchor[];
    uniquePaperIds: string[];
  } => {
    const validAnchors: HydratedMultiPaperAnchor[] = [];
    const uniquePaperIdsSet = new Set<string>();

    for (const ref of refs || []) {
      const p = paperLookup.get(ref.paperId);
      if (!p) {
        rejectedCitationsCount += (ref.chunkIds || []).length;
        continue;
      }

      for (const cid of ref.chunkIds || []) {
        const trimmed = cid.trim();
        const chunk = p.chunks.get(trimmed);
        if (!chunk) {
          rejectedCitationsCount++;
          continue;
        }

        uniquePaperIdsSet.add(ref.paperId);
        usedChunkIds.add(chunk.id);

        validAnchors.push({
          paperId: ref.paperId,
          paperTitle: p.title,
          authors: p.authors,
          doi: p.doi ?? null,
          publicationDate: p.year ? String(p.year) : null,
          journal: p.journal ?? null,
          chunkId: chunk.id,
          chunkIndex: chunk.chunkIndex,
          pageNumber: chunk.pageNumber,
          section: chunk.section,
          snippet: formatSnippet(chunk.text),
        });
      }
    }

    return {
      validAnchors,
      uniquePaperIds: Array.from(uniquePaperIdsSet),
    };
  };

  // 3. Validate Key Findings
  const validatedKeyFindings: ValidatedAgentClaim[] = [];
  for (const rawFinding of rawSynthesis.keyFindings || []) {
    const { validAnchors, uniquePaperIds } = validateEvidenceRefs(rawFinding.evidence);
    if (validAnchors.length === 0) {
      rejectedClaimsCount++;
      continue;
    }
    validatedKeyFindings.push({
      text: rawFinding.text.trim(),
      category: rawFinding.category,
      supportingPaperIds: uniquePaperIds,
      supportingPaperCount: uniquePaperIds.length,
      citations: validAnchors,
    });
  }

  // 4. Validate Corroborated Findings
  const validatedCorroborations: ValidatedAgentCorroboration[] = [];
  for (const rawCorroboration of rawSynthesis.corroboratedFindings || []) {
    const { validAnchors, uniquePaperIds } = validateEvidenceRefs(rawCorroboration.evidence);
    if (validAnchors.length === 0) {
      rejectedClaimsCount++;
      continue;
    }

    // Corroboration strictly requires >= 2 UNIQUE papers
    if (uniquePaperIds.length < 2) {
      // Demote to key finding rather than falsely reporting corroboration
      validatedKeyFindings.push({
        text: rawCorroboration.claim.trim(),
        category: "GENERAL",
        supportingPaperIds: uniquePaperIds,
        supportingPaperCount: uniquePaperIds.length,
        citations: validAnchors,
      });
      continue;
    }

    validatedCorroborations.push({
      claim: rawCorroboration.claim.trim(),
      supportingPaperIds: uniquePaperIds,
      supportingPaperCount: uniquePaperIds.length,
      citations: validAnchors,
      synthesisNote: rawCorroboration.synthesisNote.trim(),
    });
  }

  // 5. Validate Disagreements and Heterogeneity
  const validatedDisagreements: ValidatedAgentDisagreement[] = [];
  for (const rawDisagreement of rawSynthesis.disagreementsAndHeterogeneity || []) {
    const { validAnchors, uniquePaperIds } = validateEvidenceRefs(rawDisagreement.evidence);
    if (validAnchors.length === 0) {
      rejectedClaimsCount++;
      continue;
    }
    validatedDisagreements.push({
      topic: rawDisagreement.topic.trim(),
      type: rawDisagreement.type,
      description: rawDisagreement.description.trim(),
      participatingPaperIds: uniquePaperIds,
      citations: validAnchors,
    });
  }

  // 6. Validate Evidence Supported Limitations
  const validatedLimitations: ValidatedAgentClaim[] = [];
  for (const rawLim of rawSynthesis.evidenceSupportedLimitations || []) {
    const { validAnchors, uniquePaperIds } = validateEvidenceRefs(rawLim.evidence);
    if (validAnchors.length === 0) {
      rejectedClaimsCount++;
      continue;
    }
    validatedLimitations.push({
      text: rawLim.text.trim(),
      category: "LIMITATION",
      supportingPaperIds: uniquePaperIds,
      supportingPaperCount: uniquePaperIds.length,
      citations: validAnchors,
    });
  }

  // 7. Validate Research Gaps (Enforce Scoping & Corpus-Level Accounting Rules)
  const validatedGaps: ValidatedAgentResearchGap[] = [];
  for (const rawGap of rawSynthesis.researchGaps || []) {
    const { validAnchors, uniquePaperIds } = validateEvidenceRefs(rawGap.evidence);

    const validationResult = validateCorpusGap(
      rawGap,
      studies,
      validAnchors,
      uniquePaperIds
    );

    if (!validationResult.accepted || !validationResult.validatedGap) {
      rejectedClaimsCount++;
      continue;
    }

    validatedGaps.push(validationResult.validatedGap);
  }

  const isInsufficient =
    validatedKeyFindings.length === 0 &&
    validatedCorroborations.length === 0 &&
    validatedLimitations.length === 0;

  return {
    objective,
    executiveSummary: rawSynthesis.executiveSummary.trim(),
    scopeDisclosure: rawSynthesis.scopeDisclosure.trim(),
    papersConsideredCount: studies.length + metadataOnlyCandidatesCount,
    evidenceReadyPapersCount: studies.length,
    metadataOnlyCandidatesCount,
    keyFindings: validatedKeyFindings,
    studyComparison: studies,
    corroboratedFindings: validatedCorroborations,
    disagreementsAndHeterogeneity: validatedDisagreements,
    evidenceSupportedLimitations: validatedLimitations,
    researchGaps: validatedGaps,
    unansweredQuestions: rawSynthesis.unansweredQuestions || [],
    totalEvidenceChunksUsed: usedChunkIds.size,
    rejectedCitationsCount,
    rejectedClaimsCount,
    insufficientEvidence: isInsufficient || rawSynthesis.insufficientEvidence,
  };
}
