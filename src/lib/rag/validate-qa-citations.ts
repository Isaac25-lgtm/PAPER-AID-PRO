import { GroundedCitationAnchor, GroundedClaim, RetrievedEvidenceChunk } from "./types";
import { PaperQAAnswerOutput } from "./schemas";
import { INSUFFICIENT_EVIDENCE_FALLBACK } from "./prompts";

export interface ValidatedQAResult {
  answer: string;
  claims: GroundedClaim[];
  citations: GroundedCitationAnchor[];
  insufficientEvidence: boolean;
  rejectedCitationIds: string[];
  crossPaperRejectedIds: string[];
  rejectedClaimsCount: number;
}

/**
 * Truncates text safely at word boundaries for UI citation display.
 */
function formatSnippet(text: string, maxLength: number = 220): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  const truncated = cleaned.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 50 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

/**
 * Validates model-provided claims and chunk IDs with strict claim-level provenance:
 * 1. Each substantive claim is treated independently.
 * 2. Every claim must have at least one valid chunk ID.
 * 3. Chunks must exist in the retrieved evidence set provided to the model.
 * 4. Cross-Paper Protection: chunk.paperId must strictly equal requestedPaperId.
 * 5. Unsupported Claim Withholding:
 *    If a claim has ZERO valid evidence IDs after validation, DO NOT DISPLAY THAT CLAIM.
 *    Do not retain unsupported prose merely because another claim has a valid citation.
 * 6. If all claims are removed, or if insufficientEvidence is true:
 *    Withhold all prose and return the standard insufficient-evidence fallback:
 *    "The supplied manuscript evidence does not clearly answer this question."
 * 7. Hydrates citation metadata (snippet, pageNumber, section) strictly from PostgreSQL records.
 */
export function validateQACitations(
  modelOutput: PaperQAAnswerOutput | { answer: string; citations: { chunkId: string }[]; insufficientEvidence: boolean },
  retrievedChunks: RetrievedEvidenceChunk[],
  expectedPaperId: string
): ValidatedQAResult {
  // Map of retrieved chunks provided to the model
  const retrievedMap = new Map<string, RetrievedEvidenceChunk>();
  for (const chunk of retrievedChunks) {
    retrievedMap.set(chunk.id, chunk);
  }

  const rejectedCitationIds: string[] = [];
  const crossPaperRejectedIds: string[] = [];
  const validatedClaims: GroundedClaim[] = [];
  const allValidCitationsMap = new Map<string, GroundedCitationAnchor>();
  let rejectedClaimsCount = 0;

  // Normalize input: Support both new claim-level schema and legacy answer/citations schema
  let rawClaims: Array<{ text: string; evidenceChunkIds: string[] }> = [];

  if ("claims" in modelOutput && Array.isArray(modelOutput.claims)) {
    rawClaims = modelOutput.claims;
  } else if ("answer" in modelOutput && typeof modelOutput.answer === "string") {
    // Legacy fallback: Treat single answer as one claim with citations
    const legacyCitations = (modelOutput as any).citations || [];
    rawClaims = [
      {
        text: modelOutput.answer,
        evidenceChunkIds: legacyCitations.map((c: any) => c.chunkId).filter(Boolean),
      },
    ];
  }

  // If model explicitly marked evidence as insufficient, discard all claims
  if (modelOutput.insufficientEvidence) {
    return {
      answer: INSUFFICIENT_EVIDENCE_FALLBACK,
      claims: [],
      citations: [],
      insufficientEvidence: true,
      rejectedCitationIds,
      crossPaperRejectedIds,
      rejectedClaimsCount: rawClaims.length,
    };
  }

  // Validate each claim independently
  for (const claim of rawClaims) {
    const claimText = claim.text?.trim();
    if (!claimText) {
      continue;
    }

    const claimValidCitations: GroundedCitationAnchor[] = [];
    const seenChunkIdsInClaim = new Set<string>();

    for (const rawChunkId of claim.evidenceChunkIds || []) {
      const trimmedId = rawChunkId?.trim();
      if (!trimmedId || seenChunkIdsInClaim.has(trimmedId)) {
        continue;
      }
      seenChunkIdsInClaim.add(trimmedId);

      const chunk = retrievedMap.get(trimmedId);
      if (!chunk) {
        // Chunk ID does not exist in the retrieved evidence set for this paper
        rejectedCitationIds.push(trimmedId);
        continue;
      }

      // Cross-paper safety guarantee
      if (chunk.paperId !== expectedPaperId) {
        crossPaperRejectedIds.push(trimmedId);
        continue;
      }

      // Valid chunk -> Hydrate anchor strictly from source manuscript chunk
      const anchor: GroundedCitationAnchor = {
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber,
        section: chunk.section,
        snippet: formatSnippet(chunk.text),
      };

      claimValidCitations.push(anchor);
      allValidCitationsMap.set(chunk.id, anchor);
    }

    // STRICT WITHHOLDING RULE:
    // If a claim has ZERO valid evidence IDs after validation, DO NOT DISPLAY THAT CLAIM.
    if (claimValidCitations.length === 0) {
      rejectedClaimsCount++;
      continue;
    }

    // Claim is substantiated by at least one verified chunk
    validatedClaims.push({
      text: claimText,
      citations: claimValidCitations,
    });
  }

  // If all claims were rejected or none were valid, return insufficient evidence state
  if (validatedClaims.length === 0) {
    return {
      answer: INSUFFICIENT_EVIDENCE_FALLBACK,
      claims: [],
      citations: [],
      insufficientEvidence: true,
      rejectedCitationIds,
      crossPaperRejectedIds,
      rejectedClaimsCount,
    };
  }

  // Assemble verified answer strictly from validated claims
  const answer = validatedClaims.map((vc) => vc.text.trim()).join("\n\n");
  const citations = Array.from(allValidCitationsMap.values());

  return {
    answer,
    claims: validatedClaims,
    citations,
    insufficientEvidence: false,
    rejectedCitationIds,
    crossPaperRejectedIds,
    rejectedClaimsCount,
  };
}
