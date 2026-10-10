/**
 * AI Research Hub — Structured Metric Provenance Types
 *
 * Strongly typed records representing verified empirical measurements
 * extracted directly from original peer-reviewed manuscript tables and text.
 */

import { ClinicalTaskType } from "./types";

export type MetricVerificationStatus = "EXTRACTED" | "VERIFIED" | "AMBIGUOUS" | "REJECTED";

export type MetricName =
  | "AUC"
  | "ROC_AUC"
  | "PR_AUC"
  | "SENSITIVITY"
  | "SPECIFICITY"
  | "ACCURACY"
  | "PRECISION"
  | "RECALL"
  | "F1_SCORE"
  | "PPV"
  | "NPV"
  | "MAP"
  | "IOU"
  | "DICE_COEFFICIENT"
  | "PEARSON_CORRELATION"
  | "SPEARMAN_CORRELATION"
  | "MSE"
  | "RMSE"
  | "MAE"
  | "R2_SCORE"
  | "CUSTOM";

export type MetricUnit = "RATIO" | "PERCENT" | "COUNT" | "INDEX" | "HERTZ";

export type MetricValueNature = "REPORTED" | "MATHEMATICALLY_DERIVED";

export type MetricAbsenceReason = "NOT_REPORTED" | "NOT_IDENTIFIED_IN_EXAMINED_EVIDENCE";

export interface MetricRecord {
  /** Stable identity distinguishing model configuration, metric, dataset, cohort, subgroup, and validation protocol */
  id: string;
  paperId: string;
  paperTitle: string;
  modelOrMethod: string;
  clinicalTask: ClinicalTaskType;
  imagingModality: string;
  metricName: MetricName;
  /** Primary numeric point estimate, e.g. 0.946 or 94.7 */
  value: number;
  /** Human-readable representation, e.g. "0.946" or "94.7%" */
  formattedValue: string;
  unit: MetricUnit;
  valueNature: MetricValueNature;
  ciLower?: number | null;
  ciUpper?: number | null;
  std?: number | null;
  datasetName?: string | null;
  cohort: "OVERALL" | "SUBGROUP";
  subgroup?: string | null;
  /** Benchmark-specific conditions, e.g. "IoU=0.7", "Difficulty: Mod", "Passage-level" */
  benchmarkCondition?: string | null;
  /** Explicit absence classification when a metric is missing */
  absenceReason?: MetricAbsenceReason | null;
  sampleSizeTotal?: number | null;
  sampleSizePositive?: number | null;
  sampleSizeNegative?: number | null;
  validationProtocol?: string | null;
  referenceStandard?: string | null;
  sourceTableOrFigure: string;
  sourceChunkIds: string[];
  pdfPages: number[];
  supportingExcerpts: string[];
  verificationStatus: MetricVerificationStatus;
  rejectionReason?: string | null;
}

export interface CandidateMetricRecord {
  id: string;
  paperId: string;
  paperTitle: string;
  modelOrMethod: string;
  clinicalTask: ClinicalTaskType;
  imagingModality: string;
  metricName: MetricName;
  value: number;
  formattedValue: string;
  unit: MetricUnit;
  valueNature: MetricValueNature;
  ciLower?: number | null;
  ciUpper?: number | null;
  std?: number | null;
  datasetName?: string | null;
  cohort: "OVERALL" | "SUBGROUP";
  subgroup?: string | null;
  benchmarkCondition?: string | null;
  absenceReason?: MetricAbsenceReason | null;
  sampleSizeTotal?: number | null;
  validationProtocol?: string | null;
  referenceStandard?: string | null;
  sourceTableOrFigure: string;
  sourceChunkIds: string[];
  pdfPages: number[];
  supportingExcerpts: string[];
  uncertainGeometry?: boolean;
}

/**
 * Computes a stable, deterministic identifier for a MetricRecord.
 */
export function computeMetricRecordId(params: {
  paperId: string;
  modelOrMethod: string;
  metricName: string;
  datasetName?: string | null;
  cohort: string;
  subgroup?: string | null;
  benchmarkCondition?: string | null;
  validationProtocol?: string | null;
  sourceTableOrFigure?: string;
}): string {
  const norm = (s?: string | null) =>
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  return [
    norm(params.paperId),
    norm(params.modelOrMethod),
    norm(params.metricName),
    norm(params.datasetName || "default"),
    norm(params.cohort),
    norm(params.subgroup || "all"),
    norm(params.benchmarkCondition || "standard"),
    norm(params.validationProtocol || "standard"),
    norm(params.sourceTableOrFigure || "text"),
  ].join("__");
}
