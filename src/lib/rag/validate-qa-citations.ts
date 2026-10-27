import { GroundedCitationAnchor, GroundedClaim, RetrievedEvidenceChunk, EvidenceType, ClaimSupportStatus } from "./types";
import { PaperQAAnswerOutput } from "./schemas";
import { INSUFFICIENT_EVIDENCE_FALLBACK } from "./prompts";

export interface QuotationMismatch {
  claimText: string;
  quote: string;
  reason: string;
}

export interface ValidatedQAResult {
  answer: string;
  claims: GroundedClaim[];
  citations: GroundedCitationAnchor[];
  insufficientEvidence: boolean;
  unverifiedAspects?: string[];
  rejectedCitationIds: string[];
  crossPaperRejectedIds: string[];
  rejectedClaimsCount: number;
  quotationMismatches?: QuotationMismatch[];
  evidenceType?: EvidenceType;
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
 * Extracts explicit verbatim quotations ("..." or '...' or “...”) from claim text.
 */
export function extractQuotes(text: string): string[] {
  const quotes: string[] = [];
  const regex = /["“]([^"”]{3,})["”]|'([^']{3,})'/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const q = match[1] || match[2];
    if (q && q.trim().length >= 3) {
      quotes.push(q.trim());
    }
  }
  return quotes;
}

/**
 * Evaluates whether a cited evidence passage scientifically supports or contradicts a claim.
 * Implements deterministic checks to detect direct contradictions, numeric metric mismatches,
 * and completely ungrounded vocabulary without invoking external paid models.
 */
export function evaluateClaimSupport(
  claimText: string,
  chunks: RetrievedEvidenceChunk[]
): { status: ClaimSupportStatus; reason?: string } {
  const lowerClaim = claimText.toLowerCase();
  const allChunkText = chunks.map((c) => c.text.toLowerCase()).join(" ");

  // 1. Direct Negation / Contradiction Detection (Bidirectional)
  const claimHasNegation =
    lowerClaim.includes("was not superior") ||
    lowerClaim.includes("not superior") ||
    lowerClaim.includes("did not improve") ||
    lowerClaim.includes("no statistically significant") ||
    lowerClaim.includes("no significant difference");

  const chunkHasPositive =
    allChunkText.includes("demonstrate superior") ||
    allChunkText.includes("superior feature") ||
    allChunkText.includes("was superior") ||
    allChunkText.includes("improved performance") ||
    allChunkText.includes("statistically significant");

  const claimHasPositive =
    !claimHasNegation &&
    (lowerClaim.includes("was superior") ||
      lowerClaim.includes("improved performance") ||
      lowerClaim.includes("statistically significant"));

  const chunkHasNegation =
    allChunkText.includes("not superior") ||
    allChunkText.includes("was not superior") ||
    allChunkText.includes("did not improve") ||
    allChunkText.includes("no statistically significant") ||
    allChunkText.includes("no significant difference");

  if ((claimHasNegation && chunkHasPositive) || (claimHasPositive && chunkHasNegation)) {
    return { status: "CONTRADICTED", reason: "Direct empirical contradiction detected in source passage." };
  }

  // 2. Numerical metric conflict detection
  const claimPercentages = lowerClaim.match(/\b\d+(\.\d+)?%/g);
  if (claimPercentages && claimPercentages.length > 0) {
    for (const p of claimPercentages) {
      const numOnly = p.replace("%", "");
      if (!allChunkText.includes(p) && !allChunkText.includes(numOnly)) {
        const chunkPercentages = allChunkText.match(/\b\d+(\.\d+)?%/g);
        if (chunkPercentages && chunkPercentages.length > 0) {
          return {
            status: "CONTRADICTED",
            reason: `Claim asserted ${p} but cited passage reports ${chunkPercentages.slice(0, 3).join(", ")}.`,
          };
        }
      }
    }
  }

  // 3. Substantive keyword presence check
  const claimWords = lowerClaim
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 3 &&
        !["the", "and", "that", "this", "with", "from", "were", "what", "have", "showed", "found", "study", "also"].includes(w)
    );

  const matchingWords = claimWords.filter((w) => allChunkText.includes(w));
  if (claimWords.length >= 3 && matchingWords.length === 0) {
    return { status: "INSUFFICIENT", reason: "No relevant substantive keywords found in cited evidence." };
  }

  return { status: "SUPPORTED" };
}

/**
 * Validates model-provided claims and chunk IDs with strict claim-level provenance:
 * 1. Each substantive claim is treated independently.
 * 2. Every claim must have at least one valid chunk ID.
 * 3. Chunks must exist in the retrieved evidence set provided to the model.
 * 4. Cross-Paper Protection: chunk.paperId must strictly equal expectedPaperId.
 * 5. Quotation Verification: Quoted text must actually appear in the cited chunk text.
 * 6. Contradiction & Support Verification: Contradicted or unsupported claims are rejected.
 * 7. Unsupported Claim Withholding: If a claim has ZERO valid evidence IDs after validation,
 *    DO NOT DISPLAY THAT CLAIM.
 * 8. Hydrates citation metadata (snippet, pageNumber, section, DOI, evidenceType) strictly from PostgreSQL records.
 */
export function validateQACitations(
  modelOutput:
    | {
        claims: { text: string; evidenceChunkIds: string[] }[];
        unverifiedAspects?: string[];
        insufficientEvidence: boolean;
      }
    | { answer: string; citations: { chunkId: string }[]; insufficientEvidence: boolean },
  retrievedChunks: RetrievedEvidenceChunk[],
  expectedPaperId: string
): ValidatedQAResult {
  const retrievedMap = new Map<string, RetrievedEvidenceChunk>();
  for (const chunk of retrievedChunks) {
    retrievedMap.set(chunk.id, chunk);
  }

  const rejectedCitationIds: string[] = [];
  const crossPaperRejectedIds: string[] = [];
  const quotationMismatches: QuotationMismatch[] = [];
  const validatedClaims: GroundedClaim[] = [];
  const allValidCitationsMap = new Map<string, GroundedCitationAnchor>();
  let rejectedClaimsCount = 0;

  // Normalize input: Support both new claim-level schema and legacy answer/citations schema
  let rawClaims: Array<{ text: string; evidenceChunkIds: string[] }> = [];

  if ("claims" in modelOutput && Array.isArray(modelOutput.claims)) {
    rawClaims = modelOutput.claims;
  } else if ("answer" in modelOutput && typeof modelOutput.answer === "string") {
    const legacyCitations = (modelOutput as any).citations || [];
    rawClaims = [
      {
        text: modelOutput.answer,
        evidenceChunkIds: legacyCitations.map((c: any) => c.chunkId).filter(Boolean),
      },
    ];
  }

  // Extract unverified aspects reported by model (if any)
  const rawUnverified: string[] = Array.isArray((modelOutput as any).unverifiedAspects)
    ? (modelOutput as any).unverifiedAspects
    : [];
  const unverifiedAspects: string[] = rawUnverified
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0);

  // If model explicitly marked evidence as insufficient AND provided 0 raw claims, return fallback
  if (modelOutput.insufficientEvidence && rawClaims.length === 0) {
    return {
      answer: INSUFFICIENT_EVIDENCE_FALLBACK,
      claims: [],
      citations: [],
      insufficientEvidence: true,
      unverifiedAspects,
      rejectedCitationIds,
      crossPaperRejectedIds,
      rejectedClaimsCount: 0,
      quotationMismatches,
    };
  }

  // Determine dominant evidence type
  const hasFullText = retrievedChunks.some((c) => c.evidenceType === "FULL_TEXT");
  const dominantEvidenceType: EvidenceType = hasFullText ? "FULL_TEXT" : "ABSTRACT";

  // Validate each claim independently
  for (const claim of rawClaims) {
    const claimText = claim.text?.trim();
    if (!claimText) {
      continue;
    }

    const claimValidCitations: GroundedCitationAnchor[] = [];
    const claimChunks: RetrievedEvidenceChunk[] = [];
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

      claimChunks.push(chunk);

      // Valid chunk -> Hydrate anchor strictly from source manuscript chunk
      const anchor: GroundedCitationAnchor = {
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber, // Accurate page number, null if unrecorded
        section: chunk.section,
        snippet: formatSnippet(chunk.text),
        fullText: chunk.text,
        evidenceType: chunk.evidenceType || "FULL_TEXT",
        sourceTitle: chunk.sourceTitle,
        doi: chunk.doi,
        paperId: chunk.paperId,
        retrievalMethod: chunk.retrievalMethod,
        isInterpretation: false,
      };

      claimValidCitations.push(anchor);
      allValidCitationsMap.set(chunk.id, anchor);
    }

    // STRICT WITHHOLDING RULE 1:
    // If a claim has ZERO valid evidence IDs after validation, DO NOT DISPLAY THAT CLAIM.
    if (claimValidCitations.length === 0) {
      rejectedClaimsCount++;
      continue;
    }

    // STRICT WITHHOLDING RULE 2:
    // Quotation verification — if claim contains direct quotes, verify against cited chunks
    const quotes = extractQuotes(claimText);
    let hasQuoteMismatch = false;

    for (const quote of quotes) {
      const normQuote = quote.toLowerCase().replace(/\s+/g, " ");
      const foundInAny = claimChunks.some((chunk) =>
        chunk.text.toLowerCase().replace(/\s+/g, " ").includes(normQuote)
      );
      if (!foundInAny) {
        hasQuoteMismatch = true;
        quotationMismatches.push({
          claimText,
          quote,
          reason: `Quoted excerpt "${quote}" was not found in the cited evidence.`,
        });
        break;
      }
    }

    if (hasQuoteMismatch) {
      rejectedClaimsCount++;
      continue; // Withhold claim with fabricated/mismatched quotation
    }

    // STRICT WITHHOLDING RULE 3:
    // Contradiction and scientific support check
    const supportEval = evaluateClaimSupport(claimText, claimChunks);
    if (supportEval.status === "CONTRADICTED" || supportEval.status === "INSUFFICIENT") {
      rejectedClaimsCount++;
      continue; // Withhold contradicted or ungrounded claims
    }

    // Claim is substantiated by at least one verified chunk
    validatedClaims.push({
      text: claimText,
      citations: claimValidCitations,
      supportStatus: supportEval.status,
      evidenceType: claimValidCitations.some((c) => c.evidenceType === "FULL_TEXT") ? "FULL_TEXT" : "ABSTRACT",
      hasQuotationMismatch: false,
      isInterpretation: false,
    });
  }

  // If all claims were rejected or none were valid, return insufficient evidence state
  if (validatedClaims.length === 0) {
    return {
      answer: INSUFFICIENT_EVIDENCE_FALLBACK,
      claims: [],
      citations: [],
      insufficientEvidence: true,
      unverifiedAspects,
      rejectedCitationIds,
      crossPaperRejectedIds,
      rejectedClaimsCount,
      quotationMismatches,
      evidenceType: dominantEvidenceType,
    };
  }

  // Assemble verified answer strictly from validated claims
  let answer = validatedClaims.map((vc) => vc.text.trim()).join("\n\n");
  if (unverifiedAspects.length > 0) {
    const unverifiedSection = unverifiedAspects
      .map((u) => (u.endsWith(".") ? u : u + "."))
      .join(" ");
    answer += `\n\n${unverifiedSection}`;
  }

  const citations = Array.from(allValidCitationsMap.values());

  return {
    answer,
    claims: validatedClaims,
    citations,
    insufficientEvidence: false,
    unverifiedAspects,
    rejectedCitationIds,
    crossPaperRejectedIds,
    rejectedClaimsCount,
    quotationMismatches,
    evidenceType: dominantEvidenceType,
  };
}

