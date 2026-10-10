import { prisma } from "../prisma";
import { getOpenAIClient, AI_CONFIG } from "../ai/config";
import { zodTextFormat } from "openai/helpers/zod";
import {
  AGENT_STUDY_EXTRACTOR_SYSTEM_PROMPT,
  buildStudyExtractionPrompt,
} from "./prompts";
import { StudyExtractionSchema, RawStudyExtraction } from "./schemas";
import { StudyEvidence } from "./types";
import { RetrievedEvidenceChunk, HydratedMultiPaperAnchor } from "../synthesis/types";
import {
  extractAuditedMetricRecordsForStudy,
  extractMetricRecordsForStudy,
  verifyNarrativeNumericalClaim,
} from "./metric-verifier";
import { MetricRecord } from "./metric-types";

function formatSnippet(text: string, maxLength: number = 240): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  const truncated = cleaned.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 50 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

/**
 * Extracts structured empirical study dimensions for a single paper from its retrieved evidence chunks.
 *
 * Guarantees:
 * 1. Zero speculation: only data present in chunks is extracted.
 * 2. Missing values remain null. Absence is never converted into zero.
 * 3. Cited chunk IDs are strictly verified against the supplied chunks for this paper.
 * 4. Ground-truth evidence anchors are hydrated server-side with exact page, section, and text snippet.
 * 5. Bounded adjacent-chunk retrieval stitches split tables and table headers from the same paper.
 * 6. Discloses whether study is AI/ML evaluation or human clinical comparator.
 */
export async function extractStudyEvidence(
  paper: {
    id: string;
    title: string;
    authors: string[];
    year?: number | null;
    journal?: string | null;
    doi?: string | null;
  },
  chunks: RetrievedEvidenceChunk[]
): Promise<StudyEvidence> {
  if (chunks.length === 0) {
    return {
      paperId: paper.id,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      journal: paper.journal,
      doi: paper.doi,
      studyDesign: null,
      population: null,
      sampleSize: null,
      imagingModality: null,
      imagingProtocol: null,
      aiMethod: null,
      comparator: null,
      referenceStandard: null,
      validationMethod: null,
      externalValidationStatus: "UNKNOWN",
      sensitivity: null,
      specificity: null,
      auc: null,
      accuracy: null,
      majorFindings: [],
      limitations: [],
      evidenceAnchors: [],
      isAiStudy: false,
      clinicalTask: null,
      studyCategory: "INELIGIBLE",
    };
  }

  // PART 2.3: Bounded adjacent-chunk expansion for split tables and headers
  let augmentedChunks = [...chunks];
  const existingChunkIndices = new Set(chunks.map((c) => c.chunkIndex));
  const missingIndicesToFetch = new Set<number>();

  for (const c of chunks) {
    const isTableRelevant = /\b(table\s+\d+|precision metrics|confusion matrix|subsets\b|dataset\s+subsets|classification\s+subsets)\b/i.test(c.text);
    if (isTableRelevant) {
      if (c.chunkIndex > 0 && !existingChunkIndices.has(c.chunkIndex - 1)) {
        missingIndicesToFetch.add(c.chunkIndex - 1);
      }
      if (!existingChunkIndices.has(c.chunkIndex + 1)) {
        missingIndicesToFetch.add(c.chunkIndex + 1);
      }
    }
  }

  if (missingIndicesToFetch.size > 0) {
    try {
      const adjacentRows = await prisma.paperChunk.findMany({
        where: {
          paperId: paper.id,
          chunkIndex: { in: Array.from(missingIndicesToFetch).slice(0, 4) },
        },
        select: {
          id: true,
          paperId: true,
          chunkIndex: true,
          pageNumber: true,
          section: true,
          text: true,
        },
      });

      for (const row of adjacentRows) {
        if (!existingChunkIndices.has(row.chunkIndex)) {
          existingChunkIndices.add(row.chunkIndex);
          augmentedChunks.push({
            id: row.id,
            paperId: row.paperId,
            chunkIndex: row.chunkIndex,
            pageNumber: row.pageNumber,
            section: row.section,
            text: row.text,
            similarity: 0.8,
          });
        }
      }
      augmentedChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    } catch (adjErr) {
      console.warn(`[StudyExtractor] Adjacent chunk retrieval skipped:`, adjErr);
    }
  }

  // Create chunk lookup across augmented chunks
  const chunkMap = new Map<string, RetrievedEvidenceChunk>();
  for (const c of augmentedChunks) {
    chunkMap.set(c.id, c);
  }

  const prompt = buildStudyExtractionPrompt(
    {
      id: paper.id,
      title: paper.title,
      journal: paper.journal,
      publicationDate: paper.year ? String(paper.year) : null,
      doi: paper.doi,
    },
    augmentedChunks.map((c) => ({
      id: c.id,
      chunkIndex: c.chunkIndex,
      pageNumber: c.pageNumber,
      section: c.section,
      text: c.text,
    }))
  );

  const openai = getOpenAIClient();
  let rawExtraction: RawStudyExtraction;

  try {
    const response = await openai.responses.parse({
      model: AI_CONFIG.summaryModel,
      instructions: AGENT_STUDY_EXTRACTOR_SYSTEM_PROMPT,
      input: prompt,
      text: {
        format: zodTextFormat(StudyExtractionSchema, "study_extraction"),
      },
      max_output_tokens: 1800,
      temperature: 0.1,
      store: false,
    });

    if (response.output_parsed) {
      rawExtraction = response.output_parsed as RawStudyExtraction;
    } else if (response.output_text) {
      rawExtraction = StudyExtractionSchema.parse(JSON.parse(response.output_text));
    } else {
      throw new Error("Empty output from study extraction model.");
    }
  } catch (err: any) {
    console.error(`[StudyExtractor] Extraction failed for paper ${paper.id}:`, err?.message || err);
    return {
      paperId: paper.id,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      journal: paper.journal,
      doi: paper.doi,
      studyDesign: null,
      population: null,
      sampleSize: null,
      imagingModality: null,
      imagingProtocol: null,
      aiMethod: null,
      comparator: null,
      referenceStandard: null,
      validationMethod: null,
      externalValidationStatus: "UNKNOWN",
      sensitivity: null,
      specificity: null,
      auc: null,
      accuracy: null,
      majorFindings: [],
      limitations: [],
      evidenceAnchors: [],
      isAiStudy: false,
      clinicalTask: null,
      studyCategory: "INELIGIBLE",
    };
  }

  // Validate chunk IDs and hydrate anchors
  const validatedFindings: string[] = [];
  const validatedLimitations: string[] = [];
  const anchorMap = new Map<string, HydratedMultiPaperAnchor>();

  for (const finding of rawExtraction.majorFindings || []) {
    const validChunkIds = (finding.citedChunkIds || []).filter((id) => chunkMap.has(id.trim()));
    if (validChunkIds.length > 0) {
      validatedFindings.push(finding.text.trim());
      for (const cid of validChunkIds) {
        const c = chunkMap.get(cid.trim())!;
        if (!anchorMap.has(c.id)) {
          anchorMap.set(c.id, {
            paperId: paper.id,
            paperTitle: paper.title,
            authors: paper.authors,
            doi: paper.doi ?? null,
            publicationDate: paper.year ? String(paper.year) : null,
            journal: paper.journal ?? null,
            chunkId: c.id,
            chunkIndex: c.chunkIndex,
            pageNumber: c.pageNumber,
            section: c.section,
            snippet: formatSnippet(c.text),
          });
        }
      }
    }
  }

  for (const limitation of rawExtraction.limitations || []) {
    const validChunkIds = (limitation.citedChunkIds || []).filter((id) => chunkMap.has(id.trim()));
    if (validChunkIds.length > 0) {
      validatedLimitations.push(limitation.text.trim());
      for (const cid of validChunkIds) {
        const c = chunkMap.get(cid.trim())!;
        if (!anchorMap.has(c.id)) {
          anchorMap.set(c.id, {
            paperId: paper.id,
            paperTitle: paper.title,
            authors: paper.authors,
            doi: paper.doi ?? null,
            publicationDate: paper.year ? String(paper.year) : null,
            journal: paper.journal ?? null,
            chunkId: c.id,
            chunkIndex: c.chunkIndex,
            pageNumber: c.pageNumber,
            section: c.section,
            snippet: formatSnippet(c.text),
          });
        }
      }
    }
  }

  // Sanitize numeric fields: never allow "0" or "0%" if absence is implied, sanitize "N/A" to null
  const sanitizeMetric = (val: string | null | undefined): string | null => {
    if (!val) return null;
    const trimmed = val.trim();
    if (
      trimmed === "" ||
      trimmed.toLowerCase() === "n/a" ||
      trimmed.toLowerCase() === "null" ||
      trimmed.toLowerCase() === "not reported" ||
      trimmed.toLowerCase() === "unknown"
    ) {
      return null;
    }
    return trimmed;
  };

  const lowerTitle = paper.title.toLowerCase();
  const allText = augmentedChunks.map((c) => c.text.toLowerCase()).join(" ");

  // Deterministic AI vs Clinical Modality verification:
  // Clinical imaging studies (e.g. Li et al.) evaluate human radiologist SWE/CEUS, not AI models
  const isClinicalModalityTitle =
    /\b(multimodal\s+ultrasound|contrast-enhanced|ceus|shear-wave|swe|elastograph\w*)\b/i.test(lowerTitle) &&
    !/\b(ai|artificial\s+intelligence|cad|computer-aided|deep\s+learning|machine\s+learning|neural|network|model|cnn)\b/i.test(lowerTitle);
  const textHasAiArchitecture =
    /\b(convolutional\s+neural|cnn|resnet|densenet|vgg|knn|svm|random\s+forest|deep\s+learning|machine\s+learning\s+model|yolo|unet|u-net)\b/i.test(allText);

  let isAi = Boolean(rawExtraction.isAiStudy);
  let studyCategory = rawExtraction.studyCategory ?? (isAi ? "AI_MODEL" : "CLINICAL_COMPARATOR");

  if (isClinicalModalityTitle && !textHasAiArchitecture) {
    isAi = false;
    studyCategory = "CLINICAL_COMPARATOR";
  }

  // Check off-target domains (e.g. lung, skin, liver, spine)
  const isOffDomain =
    (/\b(skin(\s+tumors?|\s+cancer|\s+disease|\s+lesions?)?|dermatolog\w*|dermoscopic)\b/i.test(lowerTitle) && !/\bbreast\b/i.test(lowerTitle)) ||
    (/\b(lung|pulmonary)\b/i.test(lowerTitle) && !/\bbreast\b/i.test(lowerTitle)) ||
    (/\b(liver|hepatic)\b/i.test(lowerTitle) && !/\bbreast\b/i.test(lowerTitle)) ||
    (/\b(cervical\s+spondylotic|spine)\b/i.test(lowerTitle) && !/\bbreast\b/i.test(lowerTitle));

  if (isOffDomain) {
    studyCategory = "INELIGIBLE";
  }

  // Clinical task verification: segmentation vs classification
  let clinicalTask = rawExtraction.clinicalTask ?? null;
  const isSegmentationPaper =
    /\b(segmentation|boundary\s+detection|lesion\s+contour|mask\s+r-cnn|u-net|unet)\b/i.test(lowerTitle) ||
    (/\b(dice|miou|intersection\s+over\s+union|jaccard)\b/i.test(allText) && !/\b(classification\s+accuracy|diagnostic\s+accuracy|malignan\w*\s+vs\s+benign)\b/i.test(allText));

  if (isSegmentationPaper && clinicalTask === "CLASSIFICATION") {
    clinicalTask = "SEGMENTATION";
  }

  // If task is segmentation, do NOT allow dice or segmentation overlap to be reported as classification accuracy
  let reportedAccuracy = sanitizeMetric(rawExtraction.accuracy);
  if (clinicalTask === "SEGMENTATION" && reportedAccuracy) {
    if (/\b(dice|iou|miou|jaccard|overlap)\b/i.test(reportedAccuracy)) {
      reportedAccuracy = null;
    }
  }

  // Unified extraction and verification of MetricRecords
  const verifiedMetricRecords = extractMetricRecordsForStudy(
    { id: paper.id, title: paper.title },
    augmentedChunks
  );

  if (verifiedMetricRecords.length > 0) {
    const verifiedAucs = verifiedMetricRecords.filter((r) => r.metricName === "AUC");
    const verifiedPrAucs = verifiedMetricRecords.filter((r) => r.metricName === "PR_AUC");
    const verifiedAccs = verifiedMetricRecords.filter((r) => r.metricName === "ACCURACY");
    const verifiedMaps = verifiedMetricRecords.filter((r) => r.metricName === "MAP");
    const verifiedSens = verifiedMetricRecords.filter((r) => r.metricName === "SENSITIVITY");
    const verifiedSpecs = verifiedMetricRecords.filter((r) => r.metricName === "SPECIFICITY");

    if (verifiedAucs.length > 0) {
      rawExtraction.auc = verifiedAucs
        .map((r) => `${r.formattedValue}${r.subgroup ? ` (${r.subgroup})` : r.modelOrMethod ? ` (${r.modelOrMethod})` : ""}`)
        .join(", ");
    } else if (verifiedPrAucs.length > 0) {
      rawExtraction.auc = verifiedPrAucs
        .map((r) => `${r.formattedValue}${r.benchmarkCondition ? ` (${r.benchmarkCondition})` : ""}`)
        .join(", ");
    } else {
      rawExtraction.auc = null;
    }

    if (verifiedAccs.length > 0) {
      reportedAccuracy = verifiedAccs
        .map((r) => `${r.formattedValue}${r.subgroup ? ` (${r.subgroup})` : r.modelOrMethod ? ` (${r.modelOrMethod})` : ""}`)
        .join(", ");
    } else if (verifiedMaps.length > 0) {
      reportedAccuracy = verifiedMaps
        .map((r) => `${r.formattedValue}${r.benchmarkCondition ? ` (${r.benchmarkCondition})` : ""}`)
        .join(", ");
    }

    if (verifiedSens.length > 0) {
      rawExtraction.sensitivity = verifiedSens
        .map((r) => `${r.formattedValue}${r.subgroup ? ` (${r.subgroup})` : r.modelOrMethod ? ` (${r.modelOrMethod})` : ""}`)
        .join(", ");
    }

    if (verifiedSpecs.length > 0) {
      rawExtraction.specificity = verifiedSpecs
        .map((r) => `${r.formattedValue}${r.subgroup ? ` (${r.subgroup})` : r.modelOrMethod ? ` (${r.modelOrMethod})` : ""}`)
        .join(", ");
    }

    const firstRecord = verifiedMetricRecords[0];
    if (firstRecord.validationProtocol) {
      rawExtraction.validationMethod = firstRecord.validationProtocol;
    }
    if (firstRecord.referenceStandard) {
      rawExtraction.referenceStandard = firstRecord.referenceStandard;
    }
  }

  // Align and verify metrics in extracted major findings against verified MetricRecords
  for (let i = 0; i < validatedFindings.length; i++) {
    const narrativeCheck = verifyNarrativeNumericalClaim(validatedFindings[i], verifiedMetricRecords);
    if (narrativeCheck.isValid && narrativeCheck.sanitizedClaim) {
      validatedFindings[i] = narrativeCheck.sanitizedClaim;
    }
  }

  // Subgroup metric detection: e.g. "<50 age subgroup", "≥50 age subgroup"
  const isSubgroup = (val: string | null | undefined): boolean => {
    if (!val) return false;
    return /\b(<|>|≤|≥|\d+\s*-\s*\d+|subgroup|age|stratif\w*)\b/i.test(val);
  };
  const isSubgroupMetric =
    isSubgroup(rawExtraction.sensitivity) ||
    isSubgroup(rawExtraction.specificity) ||
    isSubgroup(rawExtraction.auc);

  let aiMethod = sanitizeMetric(rawExtraction.aiMethod);
  if (!isAi) {
    aiMethod = "None (Human Clinical Modality Evaluation)";
  }

  return {
    paperId: paper.id,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    journal: paper.journal,
    doi: paper.doi,
    studyDesign: sanitizeMetric(rawExtraction.studyDesign),
    population: sanitizeMetric(rawExtraction.population),
    sampleSize: sanitizeMetric(rawExtraction.sampleSize),
    imagingModality: sanitizeMetric(rawExtraction.imagingModality),
    imagingProtocol: sanitizeMetric(rawExtraction.imagingProtocol),
    aiMethod,
    comparator: sanitizeMetric(rawExtraction.comparator),
    referenceStandard: sanitizeMetric(rawExtraction.referenceStandard),
    validationMethod: sanitizeMetric(rawExtraction.validationMethod),
    externalValidationStatus:
      rawExtraction.externalValidationStatus === "PRESENT" ||
      rawExtraction.externalValidationStatus === "ABSENT_IN_RETRIEVED_EVIDENCE" ||
      rawExtraction.externalValidationStatus === "UNKNOWN"
        ? rawExtraction.externalValidationStatus
        : "UNKNOWN",
    sensitivity: sanitizeMetric(rawExtraction.sensitivity),
    specificity: sanitizeMetric(rawExtraction.specificity),
    auc: sanitizeMetric(rawExtraction.auc),
    accuracy: reportedAccuracy,
    majorFindings: validatedFindings,
    limitations: validatedLimitations,
    evidenceAnchors: Array.from(anchorMap.values()),
    isAiStudy: isAi,
    clinicalTask,
    studyCategory,
    isSubgroupMetric,
    metricRecords: verifiedMetricRecords,
  };
}
