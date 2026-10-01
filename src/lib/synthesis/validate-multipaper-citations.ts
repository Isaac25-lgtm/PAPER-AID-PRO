import {
  PaperEvidenceSet,
  HydratedMultiPaperAnchor,
  ValidatedMultiPaperClaim,
  ValidatedMultiPaperDisagreement,
  ValidatedMultiPaperLimitation,
} from "./types";
import { MultiPaperSynthesisOutput } from "./schemas";
import { MULTI_PAPER_INSUFFICIENT_EVIDENCE_FALLBACK } from "./prompts";

export interface MultiPaperValidationResult {
  claims: ValidatedMultiPaperClaim[];
  disagreements: ValidatedMultiPaperDisagreement[];
  limitations: ValidatedMultiPaperLimitation[];
  insufficientEvidence: boolean;
  rejectedCitationCount: number;
  rejectedClaimsCount: number;
  invalidCitationIds: string[];
}

function formatSnippet(text: string, maxLength: number = 240): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  const truncated = cleaned.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 50 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

/**
 * Validates multi-paper synthesis output with strict claim-level provenance and server hydration.
 *
 * Guarantees:
 * 1. Model identifiers (paperId, chunkId) are strictly verified against the supplied evidence sets.
 * 2. Cross-paper mismatch prevention: chunk.paperId must strictly match the claimed paperId.
 * 3. Chunks must have been supplied in the retrieved evidence set (not merely present elsewhere in DB).
 * 4. Unsupported claim dropping: If a claim loses ALL valid citations, it is completely dropped.
 * 5. Hydration: Paper titles, authors, DOIs, page numbers, sections, and snippets are hydrated server-side.
 * 6. Computes exact unique supporting paper count per claim ("Supported by X papers").
 */
export function validateMultiPaperSynthesis(
  modelOutput: MultiPaperSynthesisOutput,
  suppliedEvidenceSets: PaperEvidenceSet[]
): MultiPaperValidationResult {
  // Build lookup index: paperId -> paperMetadata & chunkMap
  interface PaperLookup {
    paperTitle: string;
    authors: string[];
    doi: string | null;
    publicationDate: string | null;
    journal: string | null;
    chunks: Map<string, {
      chunkIndex: number;
      pageNumber: number | null;
      section: string | null;
      text: string;
    }>;
  }

  const paperLookup = new Map<string, PaperLookup>();

  for (const set of suppliedEvidenceSets) {
    const chunkMap = new Map<string, {
      chunkIndex: number;
      pageNumber: number | null;
      section: string | null;
      text: string;
    }>();

    for (const chunk of set.chunks) {
      chunkMap.set(chunk.id, {
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber,
        section: chunk.section,
        text: chunk.text,
      });
    }

    paperLookup.set(set.paperId, {
      paperTitle: set.paperTitle,
      authors: set.authors,
      doi: set.doi,
      publicationDate: set.publicationDate,
      journal: set.journal,
      chunks: chunkMap,
    });
  }

  let rejectedCitationCount = 0;
  let rejectedClaimsCount = 0;
  const invalidCitationIds: string[] = [];

  // If model flagged insufficient evidence upfront
  if (modelOutput.insufficientEvidence) {
    return {
      claims: [],
      disagreements: [],
      limitations: [],
      insufficientEvidence: true,
      rejectedCitationCount: 0,
      rejectedClaimsCount: modelOutput.claims?.length || 0,
      invalidCitationIds: [],
    };
  }

  // 1. Validate Claims
  const validatedClaims: ValidatedMultiPaperClaim[] = [];

  for (const rawClaim of modelOutput.claims || []) {
    const claimText = rawClaim.text?.trim();
    if (!claimText) continue;

    const claimAnchors: HydratedMultiPaperAnchor[] = [];
    const supportingPaperIdsSet = new Set<string>();

    for (const ev of rawClaim.evidence || []) {
      const paperMeta = paperLookup.get(ev.paperId);
      if (!paperMeta) {
        // Claimed paper was not in selected evidence set
        rejectedCitationCount += ev.chunkIds.length;
        invalidCitationIds.push(...ev.chunkIds);
        continue;
      }

      for (const chunkId of ev.chunkIds || []) {
        const trimmedChunkId = chunkId?.trim();
        const chunkMeta = paperMeta.chunks.get(trimmedChunkId);

        if (!chunkMeta) {
          // Chunk was not in supplied evidence set for this paper
          rejectedCitationCount++;
          invalidCitationIds.push(trimmedChunkId);
          continue;
        }

        supportingPaperIdsSet.add(ev.paperId);
        claimAnchors.push({
          paperId: ev.paperId,
          paperTitle: paperMeta.paperTitle,
          authors: paperMeta.authors,
          doi: paperMeta.doi,
          publicationDate: paperMeta.publicationDate,
          journal: paperMeta.journal,
          chunkId: trimmedChunkId,
          chunkIndex: chunkMeta.chunkIndex,
          pageNumber: chunkMeta.pageNumber,
          section: chunkMeta.section,
          snippet: formatSnippet(chunkMeta.text),
        });
      }
    }

    // STRICT WITHHOLDING: If all citations were invalid, DROP CLAIM COMPLETELY
    if (claimAnchors.length === 0) {
      rejectedClaimsCount++;
      continue;
    }

    validatedClaims.push({
      text: claimText,
      supportingPaperIds: Array.from(supportingPaperIdsSet),
      supportingPaperCount: supportingPaperIdsSet.size,
      citations: claimAnchors,
    });
  }

  // 2. Validate Disagreements
  const validatedDisagreements: ValidatedMultiPaperDisagreement[] = [];

  for (const rawDisagreement of modelOutput.disagreements || []) {
    const desc = rawDisagreement.description?.trim();
    if (!desc) continue;

    const anchors: HydratedMultiPaperAnchor[] = [];
    const paperIdsSet = new Set<string>();

    for (const ev of rawDisagreement.evidence || []) {
      const paperMeta = paperLookup.get(ev.paperId);
      if (!paperMeta) continue;

      for (const chunkId of ev.chunkIds || []) {
        const chunkMeta = paperMeta.chunks.get(chunkId?.trim());
        if (!chunkMeta) continue;

        paperIdsSet.add(ev.paperId);
        anchors.push({
          paperId: ev.paperId,
          paperTitle: paperMeta.paperTitle,
          authors: paperMeta.authors,
          doi: paperMeta.doi,
          publicationDate: paperMeta.publicationDate,
          journal: paperMeta.journal,
          chunkId: chunkId.trim(),
          chunkIndex: chunkMeta.chunkIndex,
          pageNumber: chunkMeta.pageNumber,
          section: chunkMeta.section,
          snippet: formatSnippet(chunkMeta.text),
        });
      }
    }

    if (anchors.length > 0) {
      validatedDisagreements.push({
        description: desc,
        supportingPaperIds: Array.from(paperIdsSet),
        citations: anchors,
      });
    }
  }

  // 3. Validate Limitations
  const validatedLimitations: ValidatedMultiPaperLimitation[] = [];

  for (const rawLimitation of modelOutput.limitations || []) {
    const text = rawLimitation.text?.trim();
    if (!text) continue;

    const anchors: HydratedMultiPaperAnchor[] = [];
    const paperIdsSet = new Set<string>();

    for (const ev of rawLimitation.evidence || []) {
      const paperMeta = paperLookup.get(ev.paperId);
      if (!paperMeta) continue;

      for (const chunkId of ev.chunkIds || []) {
        const chunkMeta = paperMeta.chunks.get(chunkId?.trim());
        if (!chunkMeta) continue;

        paperIdsSet.add(ev.paperId);
        anchors.push({
          paperId: ev.paperId,
          paperTitle: paperMeta.paperTitle,
          authors: paperMeta.authors,
          doi: paperMeta.doi,
          publicationDate: paperMeta.publicationDate,
          journal: paperMeta.journal,
          chunkId: chunkId.trim(),
          chunkIndex: chunkMeta.chunkIndex,
          pageNumber: chunkMeta.pageNumber,
          section: chunkMeta.section,
          snippet: formatSnippet(chunkMeta.text),
        });
      }
    }

    if (anchors.length > 0) {
      validatedLimitations.push({
        text,
        supportingPaperIds: Array.from(paperIdsSet),
        citations: anchors,
      });
    }
  }

  // If zero valid claims remain after validation, return insufficient evidence state
  const isInsufficient = validatedClaims.length === 0;

  return {
    claims: validatedClaims,
    disagreements: validatedDisagreements,
    limitations: validatedLimitations,
    insufficientEvidence: isInsufficient,
    rejectedCitationCount,
    rejectedClaimsCount,
    invalidCitationIds,
  };
}
