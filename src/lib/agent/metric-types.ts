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
  | "SENSITIVITY"
  | "SPECIFICITY"
  | "ACCURACY"
  | "PRECISION"
  | "F1_SCORE"
  | "PPV"
  | "NPV";

export type MetricUnit = "RATIO" | "PERCENT";

export type MetricValueNature = "REPORTED" | "MATHEMATICALLY_DERIVED";

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
    norm(params.validationProtocol || "standard"),
    norm(params.sourceTableOrFigure || "text"),
  ].join("__");
}
