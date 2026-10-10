/**
 * AI Research Hub — Phase 10: Evidence-Grounded Research Agent Types
 *
 * Core interfaces for:
 * - Controlled State Machine & Step Telemetry
 * - Bounded Research Plans & Study-Level Evidence Extraction
 * - Cross-Study Comparison & Research Brief
 * - Claim Validation & Provenance
 */

import { RetrievedEvidenceChunk, HydratedMultiPaperAnchor } from "../synthesis/types";
export type { RetrievedEvidenceChunk, HydratedMultiPaperAnchor };
import { NormalizedExternalPaper, SourceProvider, FullTextAvailabilityStatus } from "../discovery/types";

export type AgentState =
  | "PLANNING"
  | "LOCAL_DISCOVERY"
  | "EVIDENCE_ASSESSMENT"
  | "EXTERNAL_DISCOVERY"
  | "CANDIDATE_CLASSIFICATION"
  | "WAITING_FOR_USER"
  | "EVIDENCE_RETRIEVAL"
  | "STUDY_EXTRACTION"
  | "SYNTHESIS"
  | "VALIDATION"
  | "COMPLETED"
  | "FAILED";

export interface ResearchPlan {
  objective: string;
  researchQuestions: string[];
  searchQueries: string[];
  desiredEvidenceTypes: string[];
  comparisonDimensions: string[];
  requiresExternalDiscovery: boolean;
  externalDiscoveryReason?: string | null;
}

export interface AgentTraceStep {
  stepIndex: number;
  timestamp: string;
  state: AgentState;
  action: string;
  description: string;
  counts?: {
    papersConsidered?: number;
    evidenceReady?: number;
    metadataOnly?: number;
    chunksRetrieved?: number;
    claimsValidated?: number;
  };
  durationMs?: number;
}

export type FeatureReportingStatus =
  | "PRESENT"
  | "PRESENT_INSUFFICIENTLY_DESCRIBED"
  | "NOT_PERFORMED"
  | "NOT_REPORTED"
  | "NOT_IDENTIFIED_IN_RETRIEVED_EVIDENCE"
  | "UNKNOWN"
  | "ABSENT_IN_RETRIEVED_EVIDENCE";
export type ClinicalTaskType =
  | "CLASSIFICATION"
  | "SEGMENTATION"
  | "DETECTION"
  | "OBJECT_DETECTION"
  | "REGRESSION"
  | "CORRELATION"
  | "OTHER";
export type StudyCategory = "AI_MODEL" | "CLINICAL_COMPARATOR" | "INELIGIBLE";

export interface CorpusGapEvidence {
  field: string;
  assessedPaperIds: string[];
  papersReportingFeature: string[];
  papersNotReportingFeature: string[];
  papersUnknown: string[];
  totalPapersAssessed: number;
  coverageComplete: boolean;
}

export interface StudyEvidence {
  paperId: string;
  title: string;
  authors: string[];
  year?: number | null;
  journal?: string | null;
  doi?: string | null;
  studyDesign?: string | null;
  population?: string | null;
  sampleSize?: string | null;
  imagingModality?: string | null;
  imagingProtocol?: string | null;
  aiMethod?: string | null;
  comparator?: string | null;
  referenceStandard?: string | null;
  validationMethod?: string | null;
  externalValidationStatus?: FeatureReportingStatus | null;
  sensitivity?: string | null;
  specificity?: string | null;
  auc?: string | null;
  accuracy?: string | null;
  segmentationMetrics?: string | null;
  majorFindings: string[];
  limitations: string[];
  evidenceAnchors: HydratedMultiPaperAnchor[];
  isAiStudy?: boolean;
  clinicalTask?: ClinicalTaskType | null;
  studyCategory?: StudyCategory;
  isSubgroupMetric?: boolean;
  metricRecords?: import("./metric-types").MetricRecord[];
}

export * from "./metric-types";

export type LimitationType =
  | "AUTHOR_REPORTED"
  | "METHODOLOGICAL_INFERENCE"
  | "CROSS_STUDY_GAP";

export interface ValidatedAgentClaim {
  text: string;
  category: "PERFORMANCE" | "METHODOLOGY" | "VALIDATION" | "LIMITATION" | "GENERAL";
  limitationType?: LimitationType;
  supportingPaperIds: string[];
  supportingPaperCount: number;
  citations: HydratedMultiPaperAnchor[];
}

export interface ValidatedAgentCorroboration {
  claim: string;
  supportingPaperIds: string[];
  supportingPaperCount: number;
  citations: HydratedMultiPaperAnchor[];
  synthesisNote: string;
}

export interface ValidatedAgentDisagreement {
  topic: string;
  type: "DIRECT_CONTRADICTION" | "METHODOLOGICAL_HETEROGENEITY" | "NUMERICAL_VARIATION";
  description: string;
  participatingPaperIds: string[];
  citations: HydratedMultiPaperAnchor[];
}

export interface ValidatedAgentResearchGap {
  description: string;
  type: "EXPLICITLY_STATED_BY_AUTHORS" | "SCOPED_CURRENT_SET_OBSERVATION";
  supportingPaperIds: string[];
  citations: HydratedMultiPaperAnchor[];
  corpusEvidence?: CorpusGapEvidence;
}

export interface ResearchBrief {
  objective: string;
  executiveSummary: string;
  scopeDisclosure: string;
  papersConsideredCount: number;
  eligibleStudiesCount?: number;
  evidenceReadyPapersCount: number;
  studiesWithEvidenceCount?: number;
  studiesContributingFindingsCount?: number;
  metadataOnlyCandidatesCount: number;
  keyFindings: ValidatedAgentClaim[];
  studyComparison: StudyEvidence[];
  clinicalComparators?: StudyEvidence[];
  corroboratedFindings: ValidatedAgentCorroboration[];
  disagreementsAndHeterogeneity: ValidatedAgentDisagreement[];
  evidenceSupportedLimitations: ValidatedAgentClaim[];
  researchGaps: ValidatedAgentResearchGap[];
  unansweredQuestions: string[];
  totalEvidenceChunksUsed: number;
  rejectedCitationsCount: number;
  rejectedClaimsCount: number;
  insufficientEvidence: boolean;
}

export interface AgentRunState {
  conversationId: string;
  runId: string;
  userId: string;
  objective: string;
  state: AgentState;
  currentStep: number;
  maxSteps: number;
  plan?: ResearchPlan;
  trace: AgentTraceStep[];
  selectedPaperIds: string[];
  candidateExternalPapers: NormalizedExternalPaper[];
  evidenceChunks: RetrievedEvidenceChunk[];
  studyEvidence: StudyEvidence[];
  researchBrief?: ResearchBrief;
  waitingForUserReason?: string;
  pendingImportCandidateIds?: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRunOptions {
  maxSteps?: number;
  maxEvidencePapers?: number;
  allowExternalDiscovery?: boolean;
  maxExternalQueries?: number;
  chunksPerPaper?: number;
  globalChunkCap?: number;
  autoAcquireOaLimit?: number;
}
