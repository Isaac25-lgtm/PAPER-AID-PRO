import { z } from "zod";

/**
 * AI Research Hub — Phase 10: Agent Schemas
 *
 * Zod validation schemas for:
 * 1. Bounded Research Planning (hard limits: questions <= 5, search queries <= 5, dimensions <= 12)
 * 2. Study-Level Evidence Extraction
 * 3. Structured Research Brief Synthesis
 */

// 1. Research Plan Schema
export const ResearchPlanSchema = z.object({
  objective: z.string().describe("Refined research objective"),
  researchQuestions: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe("Specific scientific subquestions to address (maximum 5)"),
  searchQueries: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe("Targeted search queries for literature retrieval (maximum 5)"),
  desiredEvidenceTypes: z
    .array(z.string())
    .describe("Types of empirical evidence needed (e.g. diagnostic accuracy, external validation, dataset specifications)"),
  comparisonDimensions: z
    .array(z.string())
    .max(12)
    .describe("Standardized comparison axes across papers (e.g. sample size, modality, AI model, AUC, validation method)"),
  requiresExternalDiscovery: z
    .boolean()
    .describe("True if local library lacks sufficient depth or specific aspects of the research objective"),
  externalDiscoveryReason: z
    .string()
    .nullable()
    .describe("Scientific reason why external discovery is required, or null if local library is sufficient"),
});

export type RawResearchPlan = z.infer<typeof ResearchPlanSchema>;

// Evidence Reference Schema
export const EvidenceRefSchema = z.object({
  paperId: z.string().describe("Exact ID of the paper providing this evidence"),
  chunkIds: z
    .array(z.string())
    .min(1)
    .describe("Exact chunk IDs from the retrieved evidence set supporting this statement"),
});

// 2. Study-Level Evidence Extraction Schema (per paper)
export const StudyExtractionSchema = z.object({
  isAiStudy: z
    .boolean()
    .default(true)
    .describe(
      "True only if the manuscript develops, evaluates, or tests an AI, machine learning, deep learning, or computer-aided diagnosis (CAD) algorithm. False if this is a clinical, manual, or radiologist-only imaging evaluation without an AI algorithm."
    ),
  clinicalTask: z
    .enum(["CLASSIFICATION", "SEGMENTATION", "DETECTION", "OTHER"])
    .nullable()
    .default(null)
    .describe(
      "Primary computational/clinical task: CLASSIFICATION (e.g. benign vs malignant differentiation), SEGMENTATION (lesion boundary/mask delineation), DETECTION (lesion localization/bounding box), or OTHER"
    ),
  studyCategory: z
    .enum(["AI_MODEL", "CLINICAL_COMPARATOR", "INELIGIBLE"])
    .nullable()
    .default(null)
    .describe("Category of the study relative to AI research synthesis"),
  studyDesign: z.string().nullable().describe("e.g. Retrospective cohort, prospective reader study, or null if not reported"),
  population: z.string().nullable().describe("Patient or image cohort description, or null if not reported"),
  sampleSize: z.string().nullable().describe("Number of patients, lesions, or images, or null if not reported"),
  imagingModality: z.string().nullable().describe("e.g. B-mode ultrasound, color Doppler, elastography, or null if not reported"),
  imagingProtocol: z.string().nullable().describe("Acquisition details or equipment if reported, or null"),
  aiMethod: z.string().nullable().describe("AI architecture, algorithm, or deep learning model, or null if not an AI study or not reported"),
  comparator: z.string().nullable().describe("Radiologists, existing clinical standard (e.g. BI-RADS), or null"),
  referenceStandard: z.string().nullable().describe("Ground truth standard (e.g. histopathology, 2-year follow-up), or null"),
  validationMethod: z.string().nullable().describe("e.g. 5-fold cross-validation, independent external cohort, 80/20 split, or null"),
  externalValidationStatus: z
    .enum([
      "PRESENT",
      "PRESENT_INSUFFICIENTLY_DESCRIBED",
      "NOT_PERFORMED",
      "NOT_REPORTED",
      "NOT_IDENTIFIED_IN_RETRIEVED_EVIDENCE",
      "ABSENT_IN_RETRIEVED_EVIDENCE",
      "UNKNOWN",
    ])
    .nullable()
    .default("UNKNOWN")
    .describe(
      "Whether external/multicenter validation is: 'PRESENT' (explicit external/multicenter test set), 'PRESENT_INSUFFICIENTLY_DESCRIBED' (claimed but lacking dataset details), 'NOT_PERFORMED' (authors state not performed / limitation), 'NOT_REPORTED' (study describes only internal split without mentioning external testing), 'NOT_IDENTIFIED_IN_RETRIEVED_EVIDENCE' (retrieved chunks lack validation cohort text), or 'UNKNOWN'"
    ),
  sensitivity: z
    .string()
    .nullable()
    .describe(
      "Reported diagnostic sensitivity metric with CI if available, or null. MUST include population/subgroup if stratified (e.g. '94.1% (<50 age subgroup)'). NEVER promote a subgroup metric to an overall cohort result."
    ),
  specificity: z
    .string()
    .nullable()
    .describe(
      "Reported diagnostic specificity metric with CI if available, or null. MUST include population/subgroup if stratified (e.g. '95.7% (<50 age subgroup)'). NEVER promote a subgroup metric to an overall cohort result."
    ),
  auc: z
    .string()
    .nullable()
    .describe(
      "Reported AUC / ROC metric with CI if available, or null. MUST include population/subgroup if stratified (e.g. '0.949 (<50 age subgroup), 0.952 (>=50 age subgroup)'). NEVER report a subgroup AUC as an overall AUC."
    ),
  accuracy: z
    .string()
    .nullable()
    .describe(
      "Reported diagnostic classification accuracy metric, or null. For segmentation papers, keep distinct from pixel accuracy/mIoU."
    ),
  segmentationMetrics: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Reported semantic segmentation metrics (e.g. mIoU, IoU, Dice coefficient, F1-score, pixel accuracy, Precision, Recall) with dataset or cohort specified (e.g. 'mIoU 72.94%, F1 81.86%, Pixel Accuracy 96.74% (BUSI)'). Null if not a segmentation study."
    ),
  majorFindings: z
    .array(
      z.object({
        text: z.string().describe("Specific empirical finding"),
        citedChunkIds: z.array(z.string()).describe("Chunk IDs supporting this finding"),
      })
    )
    .describe("Key empirical findings supported by manuscript chunks"),
  limitations: z
    .array(
      z.object({
        text: z.string().describe("Author-acknowledged or evidence-backed limitation"),
        citedChunkIds: z.array(z.string()).describe("Chunk IDs supporting this limitation"),
      })
    )
    .describe("Study limitations explicitly mentioned in manuscript text"),
});

export type RawStudyExtraction = z.infer<typeof StudyExtractionSchema>;

// 3. Research Brief Synthesis Schema
export const BriefSynthesisSchema = z.object({
  executiveSummary: z
    .string()
    .describe("Synthesis summarizing the overall evidence state across all analyzed studies"),
  scopeDisclosure: z
    .string()
    .describe("Clear boundary disclosure stating which papers and evidence types were evaluated"),
  keyFindings: z
    .array(
      z.object({
        text: z.string().describe("Evidence-grounded scientific claim"),
        category: z.enum(["PERFORMANCE", "METHODOLOGY", "VALIDATION", "LIMITATION", "GENERAL"]),
        evidence: z.array(EvidenceRefSchema).min(1),
      })
    )
    .describe("Core empirical findings across studies, each anchored to valid chunk IDs"),
  corroboratedFindings: z
    .array(
      z.object({
        claim: z.string().describe("Finding supported across multiple distinct papers"),
        synthesisNote: z.string().describe("Note contextualizing the agreement and scope"),
        evidence: z.array(EvidenceRefSchema).min(1),
      })
    )
    .describe("Findings independently supported by 2 or more distinct papers"),
  disagreementsAndHeterogeneity: z
    .array(
      z.object({
        topic: z.string().describe("Subject of disagreement or heterogeneity"),
        type: z.enum([
          "DIRECT_CONTRADICTION",
          "METHODOLOGICAL_HETEROGENEITY",
          "NUMERICAL_VARIATION",
        ]),
        description: z
          .string()
          .describe(
            "Careful description explaining whether this is direct conflict or differences in population/methodology"
          ),
        evidence: z.array(EvidenceRefSchema).min(1),
      })
    )
    .describe("Variations, conflicting results, or methodological heterogeneity"),
  evidenceSupportedLimitations: z
    .array(
      z.object({
        text: z.string().describe("Notable limitation grounded in manuscript evidence"),
        limitationType: z
          .enum(["AUTHOR_REPORTED", "METHODOLOGICAL_INFERENCE", "CROSS_STUDY_GAP"])
          .nullable()
          .describe(
            "Distinguish: AUTHOR_REPORTED (explicitly acknowledged by authors in discussion/limitations), METHODOLOGICAL_INFERENCE (inferred directly from study methods e.g. single-center or retrospective), or CROSS_STUDY_GAP (systematic pattern across multiple studies supported by corpus accounting)"
          ),
        evidence: z.array(EvidenceRefSchema).min(1),
      })
    )
    .describe("Limitations documented in the retrieved evidence"),
  researchGaps: z
    .array(
      z.object({
        description: z.string().describe("Scoped research gap or unmet need"),
        type: z.enum([
          "EXPLICITLY_STATED_BY_AUTHORS",
          "SCOPED_CURRENT_SET_OBSERVATION",
        ]),
        evidence: z.array(EvidenceRefSchema).min(1),
      })
    )
    .describe(
      "Gaps either explicitly stated by authors or scoped strictly to the current evidence set"
    ),
  unansweredQuestions: z
    .array(z.string())
    .describe("Questions from the research plan that could not be answered from available evidence"),
  insufficientEvidence: z
    .boolean()
    .describe("True if retrieved evidence was fundamentally insufficient to synthesize meaningful findings"),
});

export type RawBriefSynthesis = z.infer<typeof BriefSynthesisSchema>;
