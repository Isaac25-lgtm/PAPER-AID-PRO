import { getOpenAIClient, AI_CONFIG } from "../ai/config";
import { zodTextFormat } from "openai/helpers/zod";
import {
  AGENT_STUDY_EXTRACTOR_SYSTEM_PROMPT,
  buildStudyExtractionPrompt,
} from "./prompts";
import { StudyExtractionSchema, RawStudyExtraction } from "./schemas";
import { StudyEvidence } from "./types";
import { RetrievedEvidenceChunk, HydratedMultiPaperAnchor } from "../synthesis/types";

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
    };
  }

  // Create chunk lookup
  const chunkMap = new Map<string, RetrievedEvidenceChunk>();
  for (const c of chunks) {
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
    chunks.map((c) => ({
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
    // Safe graceful fallback: return null fields rather than aborting the entire run
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
    aiMethod: sanitizeMetric(rawExtraction.aiMethod),
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
    accuracy: sanitizeMetric(rawExtraction.accuracy),
    majorFindings: validatedFindings,
    limitations: validatedLimitations,
    evidenceAnchors: Array.from(anchorMap.values()),
  };
}
