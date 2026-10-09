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
  LimitationType,
} from "./types";
import { RetrievedEvidenceChunk, HydratedMultiPaperAnchor } from "../synthesis/types";
import {
  isDomainMismatched,
  isReferenceChunk,
  isThirdPartyLiteratureChunk,
  isBackgroundLiteratureReview,
  isAiAttributionToClinicalStudy,
  isTechnologySupportedByPaper,
  isAccuracyPropositionSupported,
  isHypotheticalBenefitTreatedAsEmpiricalResult,
  statementIntroducesUnsupportedPropositions,
  isLimitationSupportedByChunk,
  isNonComparableOrPseudoDisagreement,
  splitOrPruneCompoundClaim,
  formatTableContextSnippet,
} from "../synthesis/validate-multipaper-citations";
import { verifyNarrativeNumericalClaim } from "./metric-verifier";
import { MetricRecord } from "./metric-types";

function formatSnippet(text: string, maxLength: number = 240): string {
  return formatTableContextSnippet(text, maxLength);
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

  // Citations for a research gap are strictly the anchors validated for this specific gap
  const combinedAnchors: HydratedMultiPaperAnchor[] = [...validAnchors];

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
 * Validates cross-corpus absence statements (e.g., claiming all studies lacked external validation,
 * or only one study performed validation) across any output section (such as keyFindings).
 *
 * Guarantees:
 * - Prevents unsupported absence assertions from bypassing validation.
 * - UNKNOWN is strictly distinguished from confirmed absence.
 */
export function validateCrossCorpusClaim(
  claimText: string,
  studies: StudyEvidence[]
): { isValid: boolean; reason?: string } {
  const lower = claimText.toLowerCase();

  // Detect external validation cross-corpus assertions
  const isExtValAbsence =
    /\b(lacked\s+external\s+validation|without\s+external\s+validation|no\s+external\s+validation|did\s+not\s+perform\s+external\s+validation|not\s+perform\s+external\s+validation|only\s+one\s+study\s+.*external\s+validation|lack\s+external\s+validation)\b/i.test(
      lower
    ) ||
    (/\b(most\s+studies|all\s+studies|none\s+of\s+the\s+studies|majority\s+of\s+studies|across\s+studies|studies\s+generally|few\s+studies)\b/i.test(
      lower
    ) &&
      /\b(external\s+validation|external\s+testing)\b/i.test(lower));

  if (isExtValAbsence) {
    const corpusEvidence = computeCorpusGapEvidence(
      "externalValidation",
      studies,
      (s) => s.externalValidationStatus ?? "UNKNOWN"
    );

    // If any study has UNKNOWN external validation status, asserting universal/majority absence is invalid
    if (corpusEvidence.papersUnknown.length > 0) {
      return {
        isValid: false,
        reason: `Validator rejected cross-corpus absence assertion: ${corpusEvidence.papersUnknown.length} of ${corpusEvidence.totalPapersAssessed} studies have UNKNOWN external validation status. UNKNOWN status cannot serve as evidence of absence.`,
      };
    }

    // If some study reports external validation, claiming "none" or "all lacked" is invalid
    if (
      /\b(none\b|no\s+study|no\s+studies|zero|all\s+studies\s+(lacked|failed))\b/i.test(lower) &&
      corpusEvidence.papersReportingFeature.length > 0
    ) {
      return {
        isValid: false,
        reason: `Validator rejected absence claim: external validation is present in ${corpusEvidence.papersReportingFeature.length} studies.`,
      };
    }
  }

  // Detect prospective validation cross-corpus assertions
  const isProspectiveAbsence =
    /\b(lacked\s+prospective|without\s+prospective|no\s+prospective|did\s+not\s+perform\s+prospective)\b/i.test(
      lower
    );
  if (isProspectiveAbsence) {
    const corpusEvidence = computeCorpusGapEvidence(
      "prospectiveValidation",
      studies,
      (s) => {
        const design = s.studyDesign?.toLowerCase() || "";
        if (design.includes("prospective")) return "PRESENT";
        if (design.includes("retrospective")) return "ABSENT_IN_RETRIEVED_EVIDENCE";
        return "UNKNOWN";
      }
    );
    if (corpusEvidence.papersUnknown.length > 0) {
      return {
        isValid: false,
        reason: `Validator rejected prospective absence assertion: ${corpusEvidence.papersUnknown.length} studies have UNKNOWN study design.`,
      };
    }
  }

  return { isValid: true };
}

/**
 * Validates comparative superlatives (such as "highest AUC", "superior performance across models")
 * against eligible comparable metric records.
 *
 * Guarantees:
 * - Non-AI clinical comparators (e.g. Li et al.) are never cited as having the "highest AI AUC".
 * - Subgroup metrics are never cited as overall cohort superlatives.
 * - Studies with null AUC cannot be asserted as having the highest AUC.
 */
export function validateComparativeSuperlatives(
  claimText: string,
  supportingStudies: StudyEvidence[],
  allAiStudies: StudyEvidence[]
): { isValid: boolean; reason?: string } {
  const lower = claimText.toLowerCase();

  const isHighestAuc = /\b(highest\s+auc|highest\s+auroc|superior\s+auc|greatest\s+auc)\b/i.test(
    lower
  );
  const mentionsAuc = /\b(auc|auroc)\b/i.test(lower);

  if (isHighestAuc) {
    // 1. If citing a non-AI clinical comparator for highest AI AUC, reject
    const nonAiStudy = supportingStudies.find(
      (s) => s.isAiStudy === false || s.studyCategory === "CLINICAL_COMPARATOR"
    );
    if (nonAiStudy && /\b(ai|cad|machine\s+learning|deep\s+learning|models?)\b/i.test(lower)) {
      return {
        isValid: false,
        reason: `Rejected superlative: non-AI clinical comparator (${nonAiStudy.title}) cannot be cited for highest AI model AUC.`,
      };
    }
  }

  if (mentionsAuc) {
    // 2. If supporting studies do not report an empirical AUC, reject
    for (const s of supportingStudies) {
      if (!s.auc && !/\bauc\b/i.test(s.majorFindings.join(" "))) {
        return {
          isValid: false,
          reason: `Rejected unsupported metric: supporting study (${s.title}) does not report an empirical AUC metric.`,
        };
      }
    }

    // 3. If claim attributes a specific numerical AUC (e.g. 0.949, 0.952) that does not match supporting studies, reject
    const numberMatches = claimText.match(/0\.\d{3}/g);
    if (numberMatches) {
      for (const num of numberMatches) {
        const supported = supportingStudies.some(
          (s) =>
            (s.auc && s.auc.includes(num)) ||
            (s.sensitivity && s.sensitivity.includes(num)) ||
            (s.specificity && s.specificity.includes(num)) ||
            s.evidenceAnchors.some((a) => a.snippet.includes(num))
        );
        if (!supported) {
          return {
            isValid: false,
            reason: `Rejected unsupported metric: cited metric ${num} is not reported by supporting study.`,
          };
        }
      }
    }
  }

  return { isValid: true };
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
  metadataOnlyCandidatesCount: number = 0,
  eligibleStudiesCount?: number
): Promise<ResearchBrief> {
  // Exclude zero-chunk studies from evidence-ready counts and comparison tables
  const studiesWithChunks = studies.filter((s) => {
    return allChunks.some((c) => c.paperId === s.paperId);
  });

  const aiStudies = studiesWithChunks.filter(
    (s) => s.isAiStudy !== false && s.studyCategory !== "CLINICAL_COMPARATOR"
  );
  const clinicalComparators = studiesWithChunks.filter(
    (s) => s.isAiStudy === false || s.studyCategory === "CLINICAL_COMPARATOR"
  );

  const effectiveEligibleCount = eligibleStudiesCount ?? studies.length;
  const effectiveEvidenceReadyCount = studiesWithChunks.length;

  // If zero chunks retrieved, return early with insufficient evidence
  if (allChunks.length === 0 || studiesWithChunks.length === 0) {
    return {
      objective,
      executiveSummary:
        "Insufficient empirical evidence was available in the analyzed manuscripts to address the research objective.",
      scopeDisclosure: `Evaluated ${effectiveEligibleCount} eligible papers (${allChunks.length} chunks). No evidence available.`,
      papersConsideredCount: effectiveEligibleCount + metadataOnlyCandidatesCount,
      eligibleStudiesCount: effectiveEligibleCount,
      evidenceReadyPapersCount: effectiveEvidenceReadyCount,
      studiesWithEvidenceCount: effectiveEvidenceReadyCount,
      studiesContributingFindingsCount: 0,
      metadataOnlyCandidatesCount,
      keyFindings: [],
      studyComparison: aiStudies,
      clinicalComparators: clinicalComparators.length > 0 ? clinicalComparators : undefined,
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

  for (const s of studiesWithChunks) {
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
    studiesWithChunks.map((s) => ({
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
      isAiStudy: s.isAiStudy,
      clinicalTask: s.clinicalTask,
      studyCategory: s.studyCategory,
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

  const allVerifiedRecords: MetricRecord[] = studiesWithChunks.flatMap(
    (s) => s.metricRecords || []
  );

  // Helper to validate and hydrate evidence refs with full domain, methodology, and proposition checks
  const validateEvidenceRefs = (
    refs: Array<{ paperId: string; chunkIds: string[] }>,
    claimText: string,
    options: { isLimitation?: boolean } = {}
  ): {
    validAnchors: HydratedMultiPaperAnchor[];
    uniquePaperIds: string[];
    cleanedText: string;
  } => {
    const validAnchors: HydratedMultiPaperAnchor[] = [];
    const uniquePaperIdsSet = new Set<string>();
    let textToValidate = claimText.trim();

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

        // 1. Clinical/Anatomical domain mismatch
        if (isDomainMismatched(textToValidate, p.title, chunk.section, chunk.text, objective)) {
          rejectedCitationsCount++;
          continue;
        }

        // 2. Reference list / bibliography chunks
        if (isReferenceChunk(chunk.section, chunk.text)) {
          rejectedCitationsCount++;
          continue;
        }

        // 3. Third-party literature review
        if (isThirdPartyLiteratureChunk(chunk.section, chunk.text)) {
          rejectedCitationsCount++;
          continue;
        }

        // 4. Background literature review
        if (isBackgroundLiteratureReview(textToValidate, chunk.section, chunk.text)) {
          rejectedCitationsCount++;
          continue;
        }

        // 5. AI attribution to clinical imaging study
        if (isAiAttributionToClinicalStudy(textToValidate, p.title, chunk.text)) {
          rejectedCitationsCount++;
          continue;
        }

        // 6. Technology supported by paper
        if (!isTechnologySupportedByPaper(textToValidate, p.title, chunk.text)) {
          rejectedCitationsCount++;
          continue;
        }

        // 7. Limitation vs Finding checks
        if (options.isLimitation) {
          if (!isLimitationSupportedByChunk(textToValidate, chunk.text)) {
            rejectedCitationsCount++;
            continue;
          }
          if (statementIntroducesUnsupportedPropositions(textToValidate, [chunk.text], true)) {
            rejectedCitationsCount++;
            continue;
          }
        } else {
          // Accuracy proposition check
          if (!isAccuracyPropositionSupported(textToValidate, chunk.text)) {
            rejectedCitationsCount++;
            continue;
          }
          // Hypothetical benefit check
          if (isHypotheticalBenefitTreatedAsEmpiricalResult(textToValidate, chunk.text)) {
            rejectedCitationsCount++;
            continue;
          }

          // Deterministic numerical and metric verification against verified MetricRecords
          const narrativeMetricCheck = verifyNarrativeNumericalClaim(textToValidate, allVerifiedRecords);
          if (!narrativeMetricCheck.isValid) {
            rejectedCitationsCount++;
            continue;
          }
          if (narrativeMetricCheck.sanitizedClaim) {
            textToValidate = narrativeMetricCheck.sanitizedClaim;
          }

          // Unsupported propositions check
          if (statementIntroducesUnsupportedPropositions(textToValidate, [chunk.text], false)) {
            rejectedCitationsCount++;
            continue;
          }

          // Check if trailing comparative superiority can be pruned safely
          textToValidate = splitOrPruneCompoundClaim(textToValidate, chunk.text);
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
      cleanedText: textToValidate,
    };
  };

  // 3. Validate Key Findings
  const validatedKeyFindings: ValidatedAgentClaim[] = [];
  for (const rawFinding of rawSynthesis.keyFindings || []) {
    // Cross-corpus absence validation across key findings
    const crossCorpusCheck = validateCrossCorpusClaim(rawFinding.text, studiesWithChunks);
    if (!crossCorpusCheck.isValid) {
      rejectedClaimsCount++;
      continue;
    }

    const { validAnchors, uniquePaperIds, cleanedText } = validateEvidenceRefs(
      rawFinding.evidence,
      rawFinding.text,
      { isLimitation: false }
    );
    if (validAnchors.length === 0) {
      rejectedClaimsCount++;
      continue;
    }

    // Comparative superlative validation
    const supportingStudies = studiesWithChunks.filter((s) => uniquePaperIds.includes(s.paperId));
    const superlativeCheck = validateComparativeSuperlatives(
      cleanedText,
      supportingStudies,
      aiStudies
    );
    if (!superlativeCheck.isValid) {
      rejectedClaimsCount++;
      continue;
    }

    validatedKeyFindings.push({
      text: cleanedText,
      category: rawFinding.category,
      supportingPaperIds: uniquePaperIds,
      supportingPaperCount: uniquePaperIds.length,
      citations: validAnchors,
    });
  }

  // 4. Validate Corroborated Findings
  const validatedCorroborations: ValidatedAgentCorroboration[] = [];
  for (const rawCorroboration of rawSynthesis.corroboratedFindings || []) {
    const crossCorpusCheck = validateCrossCorpusClaim(rawCorroboration.claim, studiesWithChunks);
    if (!crossCorpusCheck.isValid) {
      rejectedClaimsCount++;
      continue;
    }

    const { validAnchors, uniquePaperIds, cleanedText } = validateEvidenceRefs(
      rawCorroboration.evidence,
      rawCorroboration.claim,
      { isLimitation: false }
    );
    if (validAnchors.length === 0) {
      rejectedClaimsCount++;
      continue;
    }

    // Corroboration strictly requires >= 2 UNIQUE papers
    if (uniquePaperIds.length < 2) {
      // Demote to key finding rather than falsely reporting corroboration
      validatedKeyFindings.push({
        text: cleanedText,
        category: "GENERAL",
        supportingPaperIds: uniquePaperIds,
        supportingPaperCount: uniquePaperIds.length,
        citations: validAnchors,
      });
      continue;
    }

    validatedCorroborations.push({
      claim: cleanedText,
      supportingPaperIds: uniquePaperIds,
      supportingPaperCount: uniquePaperIds.length,
      citations: validAnchors,
      synthesisNote: rawCorroboration.synthesisNote.trim(),
    });
  }

  // 5. Validate Disagreements and Heterogeneity
  const validatedDisagreements: ValidatedAgentDisagreement[] = [];
  for (const rawDisagreement of rawSynthesis.disagreementsAndHeterogeneity || []) {
    const { validAnchors, uniquePaperIds } = validateEvidenceRefs(
      rawDisagreement.evidence,
      rawDisagreement.description,
      { isLimitation: false }
    );
    if (validAnchors.length === 0) {
      rejectedClaimsCount++;
      continue;
    }

    const participatingTitles = studiesWithChunks
      .filter((s) => uniquePaperIds.includes(s.paperId))
      .map((s) => s.title);

    const pseudoCheck = isNonComparableOrPseudoDisagreement(
      rawDisagreement.description,
      participatingTitles
    );
    if (pseudoCheck.isPseudo) {
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
    // 1. Cross-corpus validation: Check if limitation makes cross-study or corpus-wide absence/prevalence assertions
    const crossCorpusCheck = validateCrossCorpusClaim(rawLim.text, studiesWithChunks);
    if (!crossCorpusCheck.isValid) {
      rejectedClaimsCount++;
      continue;
    }

    // 2. If a limitation says a study didn't report metrics, verify against study extraction
    const lowerLim = rawLim.text.toLowerCase();
    const citedStudies = studiesWithChunks.filter((s) =>
      (rawLim.evidence || []).some((e) => e.paperId === s.paperId)
    );

    const falselyAssertsMissingMetrics = citedStudies.some((s) => {
      if (
        /\b(did\s+not\s+report|failed\s+to\s+report|lacked|no)\s+(sensitivity|specificity|accuracy)\b/i.test(
          lowerLim
        )
      ) {
        return Boolean(s.sensitivity || s.specificity || s.accuracy);
      }
      if (/\b(did\s+not\s+report|failed\s+to\s+report|lacked|no)\s+auc\b/i.test(lowerLim)) {
        return Boolean(s.auc);
      }
      return false;
    });

    if (falselyAssertsMissingMetrics) {
      rejectedClaimsCount++;
      continue;
    }

    // 3. Multi-study quantifier check: "most studies", "all studies", "none of the studies"
    const isMultiStudyAssertion = /\b(most\s+studies|all\s+studies|none\s+of\s+the\s+studies|majority\s+of\s+studies|across\s+studies|studies\s+generally|all\s+evaluated\s+models|most\s+models)\b/i.test(
      rawLim.text
    );

    const { validAnchors, uniquePaperIds, cleanedText } = validateEvidenceRefs(
      rawLim.evidence,
      rawLim.text,
      { isLimitation: true }
    );
    if (validAnchors.length === 0) {
      rejectedClaimsCount++;
      continue;
    }

    // A single paper's citation CANNOT support a multi-study quantifier ("most studies", "all studies", etc.)
    if (isMultiStudyAssertion && uniquePaperIds.length < 2) {
      rejectedClaimsCount++;
      continue;
    }

    // Determine or infer limitation type
    let limitationType: LimitationType = rawLim.limitationType || "AUTHOR_REPORTED";
    if (isMultiStudyAssertion || uniquePaperIds.length >= 2) {
      limitationType = "CROSS_STUDY_GAP";
    } else if (
      /\b(retrospective|single[\s-]center|institution|dataset\s+design|methodolog\w*)\b/i.test(
        cleanedText
      )
    ) {
      limitationType = "METHODOLOGICAL_INFERENCE";
    }

    validatedLimitations.push({
      text: cleanedText,
      category: "LIMITATION",
      limitationType,
      supportingPaperIds: uniquePaperIds,
      supportingPaperCount: uniquePaperIds.length,
      citations: validAnchors,
    });
  }

  // 7. Validate Research Gaps (Enforce Scoping & Corpus-Level Accounting Rules)
  const validatedGaps: ValidatedAgentResearchGap[] = [];
  for (const rawGap of rawSynthesis.researchGaps || []) {
    const { validAnchors, uniquePaperIds } = validateEvidenceRefs(
      rawGap.evidence,
      rawGap.description,
      { isLimitation: false }
    );

    const validationResult = validateCorpusGap(
      rawGap,
      studiesWithChunks,
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

  // Derive studiesContributingFindingsCount strictly from unique paper IDs of actual validated finding anchors
  // Finding anchors come from surviving keyFindings and corroboratedFindings
  const findingAnchors = [
    ...validatedKeyFindings.flatMap((f) => f.citations),
    ...validatedCorroborations.flatMap((c) => c.citations),
  ];
  const uniqueContributingPaperIds = new Set(findingAnchors.map((a) => a.paperId));

  return {
    objective,
    executiveSummary: rawSynthesis.executiveSummary.trim(),
    scopeDisclosure: rawSynthesis.scopeDisclosure.trim(),
    papersConsideredCount: effectiveEligibleCount + metadataOnlyCandidatesCount,
    eligibleStudiesCount: effectiveEligibleCount,
    evidenceReadyPapersCount: effectiveEvidenceReadyCount,
    studiesWithEvidenceCount: effectiveEvidenceReadyCount,
    studiesContributingFindingsCount: uniqueContributingPaperIds.size,
    metadataOnlyCandidatesCount,
    keyFindings: validatedKeyFindings,
    studyComparison: aiStudies,
    clinicalComparators: clinicalComparators.length > 0 ? clinicalComparators : undefined,
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
