import {
  CitationAnchor,
  PaperAnalysisOutput,
  StructuredCitationsPayload,
} from "./schemas";
import { ChunkInput } from "./prompts";

export const FALLBACK_UNSUPPORTED_TEXT =
  "Not clearly supported by the supplied manuscript evidence.";

export interface ValidationStats {
  totalRequestedReferences: number;
  validatedCount: number;
  rejectedCount: number;
  rejectedIds: string[];
  crossPaperRejectedIds: string[];
  totalFindingsSubmitted: number;
  validatedFindingsCount: number;
  rejectedFindingsCount: number;
}

export interface ValidatedEvidenceResult {
  citations: StructuredCitationsPayload;
  validatedKeyFindings: Array<{
    finding: string;
    chunkIds: string[];
    citations: CitationAnchor[];
  }>;
  methodologyText: string;
  limitationsText: string;
  conclusionText: string;
  stats: ValidationStats;
}

/**
 * Validates model-referenced Chunk IDs against actual supplied PaperChunks.
 *
 * Strict Provenance Rules:
 * 1. Chunk ID must exist in the supplied chunk set.
 * 2. Cross-Paper Protection: chunk.paperId must match expectedPaperId (if specified).
 * 3. Key Findings: Must have at least ONE valid evidence reference (citations.length >= 1).
 *    Findings with 0 valid references are REJECTED and omitted from persistence.
 * 4. Grounded Sections: If 0 valid evidence references remain, substantive text is replaced
 *    with safe fallback text ("Not clearly supported by the supplied manuscript evidence.").
 */
export function validateAndResolveEvidence(
  analysis: PaperAnalysisOutput,
  chunks: ChunkInput[],
  expectedPaperId?: string
): ValidatedEvidenceResult {
  // Build lookup map for chunks belonging strictly to the expected paper
  const chunkMap = new Map<string, ChunkInput>();
  const allKnownChunkIds = new Map<string, ChunkInput>();

  for (const chunk of chunks) {
    allKnownChunkIds.set(chunk.id, chunk);
    // If expectedPaperId is provided, enforce that chunk belongs to this paper
    if (!expectedPaperId || !chunk.paperId || chunk.paperId === expectedPaperId) {
      chunkMap.set(chunk.id, chunk);
    }
  }

  const stats: ValidationStats = {
    totalRequestedReferences: 0,
    validatedCount: 0,
    rejectedCount: 0,
    rejectedIds: [],
    crossPaperRejectedIds: [],
    totalFindingsSubmitted: analysis.keyFindings.length,
    validatedFindingsCount: 0,
    rejectedFindingsCount: 0,
  };

  function resolveChunkIds(chunkIds: string[]): {
    validChunkIds: string[];
    citations: CitationAnchor[];
  } {
    const validChunkIds: string[] = [];
    const citations: CitationAnchor[] = [];

    for (const id of chunkIds) {
      stats.totalRequestedReferences++;
      const chunk = chunkMap.get(id);

      if (chunk) {
        stats.validatedCount++;
        validChunkIds.push(id);
        const cleanSnippet = chunk.text
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140);
        citations.push({
          chunkId: chunk.id,
          chunkIndex: chunk.chunkIndex,
          pageNumber: chunk.pageNumber,
          section: chunk.section,
          snippet: cleanSnippet.length >= 140 ? `${cleanSnippet}...` : cleanSnippet,
        });
      } else {
        stats.rejectedCount++;
        stats.rejectedIds.push(id);
        // Check if this ID belonged to a different paper (cross-paper attack/contamination)
        const crossPaperChunk = allKnownChunkIds.get(id);
        if (crossPaperChunk && expectedPaperId && crossPaperChunk.paperId !== expectedPaperId) {
          stats.crossPaperRejectedIds.push(id);
        }
      }
    }

    return { validChunkIds, citations };
  }

  // 1. Resolve Key Findings with Strict Evidence Rule
  // A finding survives ONLY if at least one valid supporting chunk remains!
  const validatedKeyFindings: Array<{
    finding: string;
    chunkIds: string[];
    citations: CitationAnchor[];
  }> = [];

  for (const kf of analysis.keyFindings) {
    const { validChunkIds, citations } = resolveChunkIds(kf.evidenceChunkIds || []);
    if (citations.length >= 1) {
      // Retain finding with its valid evidence only
      validatedKeyFindings.push({
        finding: kf.finding,
        chunkIds: validChunkIds,
        citations,
      });
      stats.validatedFindingsCount++;
    } else {
      // REJECT finding: 0 valid supporting evidence chunks
      stats.rejectedFindingsCount++;
    }
  }

  // 2. Resolve Methodology
  const resolvedMethodology = resolveChunkIds(
    analysis.methodologySummary.evidenceChunkIds || []
  );
  const methodologyText =
    resolvedMethodology.citations.length >= 1
      ? analysis.methodologySummary.text
      : FALLBACK_UNSUPPORTED_TEXT;

  // 3. Resolve Limitations
  const resolvedLimitations = resolveChunkIds(
    analysis.limitations.evidenceChunkIds || []
  );
  const limitationsText =
    resolvedLimitations.citations.length >= 1
      ? analysis.limitations.text
      : FALLBACK_UNSUPPORTED_TEXT;

  // 4. Resolve Conclusion
  const resolvedConclusion = resolveChunkIds(
    analysis.conclusion.evidenceChunkIds || []
  );
  const conclusionText =
    resolvedConclusion.citations.length >= 1
      ? analysis.conclusion.text
      : FALLBACK_UNSUPPORTED_TEXT;

  const citationsPayload: StructuredCitationsPayload = {
    keyFindings: validatedKeyFindings,
    methodology: {
      text: methodologyText,
      chunkIds: resolvedMethodology.citations.length >= 1 ? resolvedMethodology.validChunkIds : [],
      citations: resolvedMethodology.citations,
    },
    limitations: {
      text: limitationsText,
      chunkIds: resolvedLimitations.citations.length >= 1 ? resolvedLimitations.validChunkIds : [],
      citations: resolvedLimitations.citations,
    },
    conclusion: {
      text: conclusionText,
      chunkIds: resolvedConclusion.citations.length >= 1 ? resolvedConclusion.validChunkIds : [],
      citations: resolvedConclusion.citations,
    },
  };

  return {
    citations: citationsPayload,
    validatedKeyFindings,
    methodologyText,
    limitationsText,
    conclusionText,
    stats,
  };
}
