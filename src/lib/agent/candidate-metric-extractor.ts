/**
 * AI Research Hub — Generic Candidate Metric Extractor
 *
 * Extracts structured CandidateMetricRecords from research papers across
 * diverse scientific domains and metric families:
 * - Classification: Accuracy, Sensitivity, Specificity, Precision, Recall, F1, PPV, NPV
 * - Discrimination / Threshold-Free: ROC-AUC, PR-AUC
 * - Correlation: Pearson, Spearman
 * - Object Detection / Localization: mAP, IoU, Dice
 * - Regression: MSE, RMSE, MAE, R2
 *
 * Preserves benchmark conditions (e.g. "Difficulty: Mod", "IoU=0.7", "NoFac")
 * and distinguishes NOT_REPORTED from NOT_IDENTIFIED_IN_EXAMINED_EVIDENCE.
 */

import { RetrievedEvidenceChunk } from "../synthesis/types";
import { ClinicalTaskType } from "./types";
import {
  CandidateMetricRecord,
  MetricName,
  MetricUnit,
  MetricAbsenceReason,
  computeMetricRecordId,
} from "./metric-types";
import { parseTabularStructuresFromChunk, ParsedTable, isInvalidModelName } from "./table-parser";

/**
 * Maps a column header token to a strongly-typed MetricName.
 */
export function mapHeaderToMetricName(headerStr: string): MetricName | null {
  const norm = headerStr.toLowerCase().trim().replace(/\s*\([^)]*\)/g, "").trim();

  // ROC-AUC
  if (norm === "auc" || norm === "auroc" || norm.includes("roc-auc") || norm.includes("area under")) {
    return "AUC";
  }

  // PR-AUC
  if (
    norm.includes("pr-auc") ||
    norm.includes("auc-pr") ||
    norm === "nofac" ||
    norm === "nofac*" ||
    norm === "fact"
  ) {
    return "PR_AUC";
  }

  // Correlations
  if (norm.startsWith("pear") || norm.includes("pearson")) {
    return "PEARSON_CORRELATION";
  }
  if (norm.startsWith("spear") || norm.includes("spearman")) {
    return "SPEARMAN_CORRELATION";
  }

  // Object Detection / Localization
  if (
    norm === "map" ||
    norm.startsWith("map_") ||
    norm.includes("map") ||
    norm.includes("mean average precision") ||
    norm.startsWith("car_") ||
    norm.startsWith("ped_") ||
    norm.startsWith("cyc_")
  ) {
    return "MAP";
  }
  if (norm === "iou" || norm.includes("miou")) {
    return "IOU";
  }
  if (norm === "dice" || norm.includes("dice")) {
    return "DICE_COEFFICIENT";
  }

  // Classification Metrics
  if (norm.startsWith("acc") || norm.includes("accuracy")) {
    return "ACCURACY";
  }
  if (norm.startsWith("sens") || norm.includes("sensitivity")) {
    return "SENSITIVITY";
  }
  if (norm.startsWith("spec") || norm.includes("specificity")) {
    return "SPECIFICITY";
  }
  if (norm.startsWith("prec") || norm.includes("precision") || norm === "ppv") {
    return "PRECISION";
  }
  if (norm.startsWith("rec") || norm.includes("recall")) {
    return "RECALL";
  }
  if (norm === "f1" || norm.includes("f1-score") || norm.includes("f-measure")) {
    return "F1_SCORE";
  }

  // Regression Metrics
  if (norm === "rmse" || norm.includes("root mean squared")) {
    return "RMSE";
  }
  if (norm === "mse" || norm.includes("mean squared error")) {
    return "MSE";
  }
  if (norm === "mae" || norm.includes("mean absolute error")) {
    return "MAE";
  }
  if (norm === "r2" || norm === "r^2" || norm.includes("r-squared")) {
    return "R2_SCORE";
  }

  if (norm === "loss" || norm.includes("loss")) {
    return null;
  }

  return null;
}

/**
 * Determines whether a metric's absence is because the authors explicitly stated it was NOT_REPORTED
 * vs simply NOT_IDENTIFIED_IN_EXAMINED_EVIDENCE.
 */
export function determineMetricAbsenceReason(
  metricName: MetricName,
  chunks: RetrievedEvidenceChunk[]
): MetricAbsenceReason {
  const allText = chunks.map((c) => c.text).join(" ").toLowerCase();
  const metricToken = metricName.toLowerCase().replace(/_/g, " ");

  const explicitOmissionPatterns = [
    new RegExp(`did not (report|evaluate|measure|calculate)\\s+${metricToken}`, "i"),
    new RegExp(`not (reported|evaluated|measured|available)\\s+for\\s+${metricToken}`, "i"),
    new RegExp(`omitted\\s+${metricToken}`, "i"),
    new RegExp(`due to (class imbalance|data limitations|lack of ground truth).*${metricToken}`, "i"),
  ];

  for (const pat of explicitOmissionPatterns) {
    if (pat.test(allText)) {
      return "NOT_REPORTED";
    }
  }

  return "NOT_IDENTIFIED_IN_EXAMINED_EVIDENCE";
}

/**
 * Formats a metric value with appropriate precision and unit.
 */
export function formatGenericMetricValue(val: number, unit: MetricUnit): string {
  if (unit === "PERCENT") {
    return `${val.toFixed(2).replace(/\.00$/, "")}%`;
  }
  if (unit === "HERTZ") {
    return `${val} Hz`;
  }
  if (unit === "COUNT") {
    return `${val}`;
  }
  return `${val}`;
}

/**
 * Generically extracts CandidateMetricRecords from evidence chunks of a research paper.
 */
export function extractCandidateMetricRecords(
  paper: { id: string; title: string },
  chunks: RetrievedEvidenceChunk[]
): CandidateMetricRecord[] {
  const candidates: CandidateMetricRecord[] = [];

  // Parse all structured tables in the chunks
  for (const chunk of chunks) {
    const tables = parseTabularStructuresFromChunk(chunk);

    for (const table of tables) {
      // For each cell in the table
      for (const cell of table.cells) {
        if (cell.numericValue === null) continue;
        if (isInvalidModelName(cell.rowLabel)) continue;

        const metricName = cell.metricName || mapHeaderToMetricName(cell.columnHeader);
        if (!metricName) continue;

        // Determine benchmark condition or subgroup from subHeaders or row context
        let benchmarkCondition: string | null = null;
        let cohort: "OVERALL" | "SUBGROUP" = "OVERALL";
        let subgroup: string | null = null;

        if (cell.subHeader) {
          benchmarkCondition = cell.subHeader;
          if (/\b(<|>|≤|≥|subgroup|age|stratif)/i.test(cell.subHeader)) {
            cohort = "SUBGROUP";
            subgroup = cell.subHeader;
          }
        }

        // Check if table caption or row contains subgroup indications
        if (/\b(<|>|≤|≥|\d+\s*-\s*\d+|subgroup|stratified|age)/i.test(table.caption)) {
          cohort = "SUBGROUP";
          subgroup = subgroup || table.caption;
        }

        // Check for difficulty or object class benchmark conditions (e.g. KITTI: Car Easy, Mod, Hard)
        if (cell.columnHeader.startsWith("Car_") || cell.columnHeader.startsWith("Ped_") || cell.columnHeader.startsWith("Cyc_")) {
          const parts = cell.columnHeader.split("_");
          const className = parts[0] === "Car" ? "Car" : parts[0] === "Ped" ? "Pedestrian" : "Cyclist";
          const diff = parts[1];
          benchmarkCondition = `Class: ${className}, Difficulty: ${diff}`;
        } else if (cell.columnHeader === "mAP_Mod") {
          benchmarkCondition = "Difficulty: Mod";
        } else if (cell.columnHeader === "NoFac" || cell.columnHeader === "NoFac*" || cell.columnHeader === "Fact") {
          benchmarkCondition = cell.columnHeader;
        } else if (/\b(easy|mod|hard)\b/i.test(cell.columnHeader) || /\b(easy|mod|hard)\b/i.test(cell.subHeader || "")) {
          const diffMatch = (cell.columnHeader + " " + (cell.subHeader || "")).match(/\b(easy|mod\.?|hard)\b/i);
          if (diffMatch) {
            benchmarkCondition = `Difficulty: ${diffMatch[1].replace(".", "")}`;
          }
        }

        // Infer clinical/scientific task
        let clinicalTask: ClinicalTaskType = "CLASSIFICATION";
        if (metricName === "MAP" || metricName === "IOU") {
          clinicalTask = "OBJECT_DETECTION";
        } else if (metricName === "DICE_COEFFICIENT") {
          clinicalTask = "SEGMENTATION";
        } else if (metricName === "MSE" || metricName === "RMSE" || metricName === "MAE" || metricName === "R2_SCORE") {
          clinicalTask = "REGRESSION";
        }

        const id = computeMetricRecordId({
          paperId: paper.id,
          modelOrMethod: cell.rowLabel,
          metricName,
          cohort,
          subgroup,
          benchmarkCondition,
          sourceTableOrFigure: table.tableIdentifier,
        });

        let formattedValue = formatGenericMetricValue(cell.numericValue, cell.unit);
        if (cell.std !== undefined && cell.std !== null) {
          formattedValue += ` ± ${cell.std}`;
        }

        candidates.push({
          id,
          paperId: paper.id,
          paperTitle: paper.title,
          modelOrMethod: cell.rowLabel,
          clinicalTask,
          imagingModality: "Scientific Benchmark / Manuscript Data",
          metricName,
          value: cell.numericValue,
          formattedValue,
          unit: cell.unit,
          std: cell.std ?? null,
          valueNature: "REPORTED",
          cohort,
          subgroup,
          benchmarkCondition,
          sourceTableOrFigure: table.tableIdentifier,
          sourceChunkIds: [chunk.id],
          pdfPages: [chunk.pageNumber ?? 1],
          supportingExcerpts: [chunk.text.slice(0, 350)],
          uncertainGeometry: !table.isGeometryCertain,
        });
      }
    }
  }

  return deduplicateCandidateMetricRecords(candidates);
}

/**
 * Deduplicates CandidateMetricRecords extracted from overlapping chunks.
 * One model-metric-experiment combination produces one canonical record,
 * merging and retaining all valid source anchors (sourceChunkIds, pdfPages, supportingExcerpts).
 */
export function deduplicateCandidateMetricRecords(
  candidates: CandidateMetricRecord[]
): CandidateMetricRecord[] {
  const map = new Map<string, CandidateMetricRecord>();

  for (const cand of candidates) {
    const key = `${cand.paperId}::${cand.modelOrMethod.toLowerCase().trim()}::${cand.metricName}::${(cand.benchmarkCondition || "").toLowerCase().trim()}::${cand.cohort}::${(cand.subgroup || "").toLowerCase().trim()}::${cand.sourceTableOrFigure || ""}::${cand.value}`;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...cand });
    } else {
      const mergedChunkIds = Array.from(new Set([...existing.sourceChunkIds, ...cand.sourceChunkIds]));
      const mergedPages = Array.from(new Set([...existing.pdfPages, ...cand.pdfPages])).sort((a, b) => a - b);
      const mergedExcerpts = Array.from(new Set([...existing.supportingExcerpts, ...cand.supportingExcerpts]));
      const uncertainGeometry = existing.uncertainGeometry && cand.uncertainGeometry;
      const std = existing.std ?? cand.std ?? null;

      map.set(key, {
        ...existing,
        sourceChunkIds: mergedChunkIds,
        pdfPages: mergedPages,
        supportingExcerpts: mergedExcerpts,
        uncertainGeometry,
        std,
      });
    }
  }

  return Array.from(map.values());
}
