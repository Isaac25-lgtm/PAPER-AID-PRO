import "server-only";
import { prisma } from "../prisma";
import { DiscoveredPaper, PaperEvidenceSet } from "./types";
import { ChunkMetadata, RetrievedEvidenceChunk, StructuredChunkMetadata } from "../rag/types";

export interface RetrieveMultiPaperEvidenceOptions {
  chunksPerPaper?: number; // Target chunks per paper (default: 4, max: 5)
  maxTotalChunks?: number; // Global evidence cap across all papers (default: 20)
  queryVector: number[];   // Reused from discovery
}

export const DEFAULT_CHUNKS_PER_PAPER = 4;
export const DEFAULT_MAX_TOTAL_CHUNKS = 20;

/**
 * Identifies chunks that merely review or summarize third-party external studies
 * (e.g. "In the study presented in [17]...", "The study [32] proposed...").
 * These should not be retrieved as the current paper's own empirical results.
 */
export function isThirdPartyLiteratureChunk(section: string | null, text: string): boolean {
  const trimmed = text.trim();
  const thirdPartyPattern =
    /\b(in\s+the\s+study\s+presented\s+in\s+\[\d+\]|the\s+study\s+\[\d+\]\s+proposed|the\s+study\s+conducted\s+by\s+\[\d+\]|in\s+this\s+article,\s+we\s+cite\s+the\s+relevant\s+content\s+from\s+this\s+literature|according\s+to\s+\[\d+\]|studies\s+in\s+\[\d+\]|prior\s+studies\s+in\s+\[\d+\]|in\s+\[\d+\],\s*(various|several|authors|researchers|a\s+transfer|deep-learning|a\s+vector))/i;
  return thirdPartyPattern.test(trimmed);
}

/**
 * Robustly identifies bibliographic references, citation indices, and literature lists
 * so they are never presented as primary empirical findings.
 */
export function isReferenceChunk(section: string | null, text: string): boolean {
  if (section && /reference|bibliography|citation|literature\s+cited/i.test(section)) {
    return true;
  }
  const trimmed = text.trim();
  // Detect chunks that are predominantly numbered bibliographic entries
  const citationPatternCount = (trimmed.match(/(\[\d+\]|\b\d+\.)\s+[A-Z][a-z]+/g) || []).length;
  if (citationPatternCount >= 3 && /journal|proceedings|doi\.org|vol\.|pp\.|et\s+al\./i.test(trimmed)) {
    return true;
  }
  return false;
}

function isTableChunk(
  section: string | null,
  text: string,
  metadata?: StructuredChunkMetadata | Record<string, unknown> | null
): boolean {
  if (section && /table/i.test(section)) return true;
  if (text.includes("Structured Cell Data:")) return true;
  if (metadata && typeof metadata === "object") {
    return (metadata as StructuredChunkMetadata).isTable === true;
  }
  return false;
}

/**
 * Retrieves evidence independently from EACH selected paper with strict paper scoping
 * and anti-dominance evidence balancing.
 *
 * Guarantees:
 * 1. Strictly scopes each query: WHERE "paperId" = $paperId.
 * 2. Reuses precomputed query vector (zero redundant OpenAI API calls).
 * 3. Enforces per-paper quota (max 4 chunks per paper).
 * 4. Enforces global evidence cap (max 20 chunks total across all papers).
 */
export async function retrieveMultiPaperEvidence(
  selectedPapers: DiscoveredPaper[],
  question: string,
  options: RetrieveMultiPaperEvidenceOptions
): Promise<{
  evidenceSets: PaperEvidenceSet[];
  totalChunks: number;
  allChunks: RetrievedEvidenceChunk[];
}> {
  const chunksPerPaper = Math.min(Math.max(options.chunksPerPaper || DEFAULT_CHUNKS_PER_PAPER, 1), 5);
  const maxTotalChunks = options.maxTotalChunks || DEFAULT_MAX_TOTAL_CHUNKS;
  const vectorString = `[${options.queryVector.join(",")}]`;

  const evidenceSets: PaperEvidenceSet[] = [];
  const allChunks: RetrievedEvidenceChunk[] = [];
  let cumulativeChunks = 0;

  // Retrieve evidence independently for each selected paper
  for (const paper of selectedPapers) {
    if (cumulativeChunks >= maxTotalChunks) {
      break;
    }

    const remainingGlobalQuota = maxTotalChunks - cumulativeChunks;
    const paperLimit = Math.min(chunksPerPaper, remainingGlobalQuota);

    const candidateLimit = Math.min(paperLimit * 4, 16);

    // Inspect chunk embedding state for this paper:
    const embeddingStats: Array<{
      genuineCount: bigint;
      mockCount: bigint;
      totalChunks: bigint;
    }> = await prisma.$queryRaw`
      SELECT 
        COUNT(*) FILTER (WHERE embedding IS NOT NULL AND ("embeddingModel" IS NULL OR "embeddingModel" != 'mock-sha256')) as "genuineCount",
        COUNT(*) FILTER (WHERE "embeddingModel" = 'mock-sha256') as "mockCount",
        COUNT(*) as "totalChunks"
      FROM "paper_chunks"
      WHERE "paperId" = ${paper.paperId};
    `;

    const genuineCount = Number(embeddingStats[0]?.genuineCount ?? 0);
    const mockCount = Number(embeddingStats[0]?.mockCount ?? 0);
    const totalChunks = Number(embeddingStats[0]?.totalChunks ?? 0);

    let selectedRows: Array<{
      id: string;
      paperId: string;
      chunkIndex: number;
      section: string | null;
      pageNumber: number | null;
      text: string;
      metadata?: ChunkMetadata;
      similarity: number;
      isLexical: boolean;
    }> = [];

    // Extract query keywords for lexical matching (>= 3 chars, not common stopwords)
    const queryWords = question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(
        (w) =>
          w.length >= 3 &&
          !["what", "were", "with", "this", "that", "from", "have", "about", "which", "there", "does", "when", "their", "these"].includes(w)
      );

    if (totalChunks > 0 && genuineCount === 0) {
      // FIX 3: LEXICAL FALLBACK for mock-sha256 or unindexed chunks
      // Never compute vector distance on mock hashes or missing vectors.
      let lexicalDbRows: Array<{
        id: string;
        paperId: string;
        chunkIndex: number;
        section: string | null;
        pageNumber: number | null;
        text: string;
        metadata?: ChunkMetadata;
      }> = [];

      if (queryWords.length > 0) {
        const primaryTerm = queryWords.slice(0, 3).join(" ");
        const singleTerm = queryWords[0];
        const secondaryTerm = queryWords[1] || singleTerm;

        lexicalDbRows = await prisma.$queryRaw`
          SELECT 
            c.id,
            c."paperId",
            c."chunkIndex",
            c.section,
            c."pageNumber",
            c.text,
            c.metadata
          FROM "paper_chunks" c
          WHERE c."paperId" = ${paper.paperId}
            AND (
              c.text ILIKE ${'%' + primaryTerm + '%'}
              OR c.text ILIKE ${'%' + singleTerm + '%'}
              OR c.text ILIKE ${'%' + secondaryTerm + '%'}
              OR c.section ILIKE ${'%' + singleTerm + '%'}
            )
            AND (c.section IS NULL OR (
              c.section NOT ILIKE '%reference%' 
              AND c.section NOT ILIKE '%bibliography%' 
              AND c.section NOT ILIKE '%citation%'
            ))
          ORDER BY c."chunkIndex" ASC
          LIMIT ${candidateLimit};
        `;
      }

      // If matches are fewer than candidateLimit, backfill with remaining candidate chunks from this paper
      if (lexicalDbRows.length < candidateLimit) {
        const existingIds = new Set(lexicalDbRows.map((r) => r.id));
        const backfillRows: Array<{
          id: string;
          paperId: string;
          chunkIndex: number;
          section: string | null;
          pageNumber: number | null;
          text: string;
          metadata?: ChunkMetadata;
        }> = await prisma.$queryRaw`
          SELECT 
            c.id,
            c."paperId",
            c."chunkIndex",
            c.section,
            c."pageNumber",
            c.text,
            c.metadata
          FROM "paper_chunks" c
          WHERE c."paperId" = ${paper.paperId}
            AND (c.section IS NULL OR (
              c.section NOT ILIKE '%reference%' 
              AND c.section NOT ILIKE '%bibliography%' 
              AND c.section NOT ILIKE '%citation%'
            ))
          ORDER BY c."chunkIndex" ASC
          LIMIT ${candidateLimit};
        `;
        for (const row of backfillRows) {
          if (!existingIds.has(row.id)) {
            lexicalDbRows.push(row);
            existingIds.add(row.id);
            if (lexicalDbRows.length >= candidateLimit) break;
          }
        }
      }

      // Filter out reference-like and third-party literature survey chunks
      const filteredLexical = lexicalDbRows.filter(
        (r) => !isReferenceChunk(r.section, r.text) && !isThirdPartyLiteratureChunk(r.section, r.text)
      );

      // Prioritize empirical rows (including structured scientific tables, results, methods, advancements)
      const empiricalRows = filteredLexical.filter(
        (r) =>
          (r.section && /result|discussion|method|conclusion|abstract|table|advancement|limitation|finding/i.test(r.section)) ||
          isTableChunk(r.section, r.text, r.metadata as StructuredChunkMetadata | null)
      );
      const backgroundRows = filteredLexical.filter(
        (r) =>
          (!r.section || /background|intro/i.test(r.section)) &&
          !isTableChunk(r.section, r.text, r.metadata as StructuredChunkMetadata | null)
      );

      if (empiricalRows.length > 0) {
        selectedRows.push(
          ...empiricalRows.slice(0, paperLimit).map((r, idx) => ({
            ...r,
            similarity: 0.85 - idx * 0.05,
            isLexical: true,
          }))
        );
      }

      const remainingSlots = paperLimit - selectedRows.length;
      if (remainingSlots > 0 && backgroundRows.length > 0) {
        selectedRows.push(
          ...backgroundRows.slice(0, Math.min(remainingSlots, 2)).map((r, idx) => ({
            ...r,
            similarity: 0.75 - idx * 0.05,
            isLexical: true,
          }))
        );
      }

      for (const r of filteredLexical) {
        if (selectedRows.length >= paperLimit) break;
        if (!selectedRows.some((s) => s.id === r.id)) {
          selectedRows.push({
            ...r,
            similarity: 0.7 - selectedRows.length * 0.05,
            isLexical: true,
          });
        }
      }
    } else if (genuineCount > 0) {
      // GENUINE SEMANTIC RETRIEVAL with pgvector
      const semanticDbRows: Array<{
        id: string;
        paperId: string;
        chunkIndex: number;
        section: string | null;
        pageNumber: number | null;
        text: string;
        metadata?: StructuredChunkMetadata | Record<string, unknown> | null;
        similarity: number;
      }> = await prisma.$queryRaw`
        SELECT 
          c.id,
          c."paperId",
          c."chunkIndex",
          c.section,
          c."pageNumber",
          c.text,
          c.metadata,
          1 - (c.embedding <=> ${vectorString}::vector) AS similarity
        FROM "paper_chunks" c
        WHERE c."paperId" = ${paper.paperId}
          AND c.embedding IS NOT NULL
          AND (c."embeddingModel" IS NULL OR c."embeddingModel" != 'mock-sha256')
          AND (c.section IS NULL OR (
            c.section NOT ILIKE '%reference%' 
            AND c.section NOT ILIKE '%bibliography%' 
            AND c.section NOT ILIKE '%citation%'
          ))
        ORDER BY c.embedding <=> ${vectorString}::vector ASC
        LIMIT ${candidateLimit};
      `;

      // Filter out reference-like content and third-party literature reviews
      const nonRefRows = semanticDbRows.filter(
        (r) => !isReferenceChunk(r.section, r.text) && !isThirdPartyLiteratureChunk(r.section, r.text)
      );

      const empiricalRows = nonRefRows.filter(
        (r) =>
          (r.section && /result|discussion|method|conclusion|abstract|table/i.test(r.section)) ||
          isTableChunk(r.section, r.text, r.metadata as StructuredChunkMetadata | null)
      );
      const backgroundRows = nonRefRows.filter(
        (r) =>
          (!r.section || /background|intro/i.test(r.section)) &&
          !isTableChunk(r.section, r.text, r.metadata as StructuredChunkMetadata | null)
      );

      if (empiricalRows.length > 0) {
        selectedRows.push(
          ...empiricalRows.slice(0, paperLimit).map((r) => ({ ...r, isLexical: false }))
        );
      }

      const remainingSlots = paperLimit - selectedRows.length;
      if (remainingSlots > 0 && backgroundRows.length > 0) {
        selectedRows.push(
          ...backgroundRows.slice(0, Math.min(remainingSlots, 1)).map((r) => ({ ...r, isLexical: false }))
        );
      }

      for (const r of nonRefRows) {
        if (selectedRows.length >= paperLimit) break;
        if (!selectedRows.some((s) => s.id === r.id)) {
          selectedRows.push({ ...r, isLexical: false });
        }
      }

      selectedRows.sort((a, b) => b.similarity - a.similarity);
    }

    // Tag selected chunks with full evidence provenance and structured table metadata
    const paperChunks: RetrievedEvidenceChunk[] = selectedRows.map((r, idx) => {
      const meta = (r.metadata as any) || {};
      const isTable = meta.isTable === true || (r.section === "Table") || r.text.includes("Structured Cell Data:");
      const tableCaption = meta.caption || (meta.tableIndex !== undefined ? `Table ${meta.tableIndex + 1}` : null);
      const tableIndex = typeof meta.tableIndex === "number" ? meta.tableIndex : null;

      return {
        id: r.id,
        paperId: r.paperId,
        chunkIndex: r.chunkIndex,
        section: r.section,
        pageNumber: r.pageNumber,
        text: r.text,
        evidenceType: "FULL_TEXT",
        sourceTitle: paper.title,
        doi: paper.doi,
        retrievalMethod: r.isLexical ? "LEXICAL" : "SEMANTIC",
        similarity: Number(r.similarity),
        semanticRank: r.isLexical ? null : idx + 1,
        lexicalRank: r.isLexical ? idx + 1 : null,
        isMockEmbedding: r.isLexical || mockCount > 0,
        isTable,
        tableCaption,
        tableIndex,
        metadata: r.metadata,
      };
    });

    let isMetadataOnly = false;
    let abstractText: string | undefined = undefined;

    // Abstract-only fallback: When no full-text chunks could be retrieved for this selected paper
    if (paperChunks.length === 0) {
      const paperRecord = await prisma.paper.findUnique({
        where: { id: paper.paperId },
        select: { abstract: true, doi: true, title: true },
      });
      const rawAbstract = paperRecord?.abstract?.trim();
      if (rawAbstract && rawAbstract.length > 0) {
        abstractText = rawAbstract;
        isMetadataOnly = true;
        const abstractChunk: RetrievedEvidenceChunk = {
          id: `abstract-${paper.paperId}`,
          paperId: paper.paperId,
          chunkIndex: 0,
          section: "Abstract",
          pageNumber: null, // Accurately unrecorded, never synthetic
          text: rawAbstract,
          evidenceType: "ABSTRACT",
          sourceTitle: paper.title,
          doi: paper.doi,
          retrievalMethod: "ABSTRACT_FALLBACK",
          similarity: 0.75,
        };
        paperChunks.push(abstractChunk);
      }
    }

    evidenceSets.push({
      paperId: paper.paperId,
      paperTitle: paper.title,
      authors: paper.authors,
      publicationDate: paper.publicationDate,
      doi: paper.doi,
      journal: paper.journal,
      citationCount: paper.citationCount,
      chunks: paperChunks,
      abstract: abstractText,
      isMetadataOnly,
    });

    for (const c of paperChunks) {
      allChunks.push(c);
    }

    cumulativeChunks += paperChunks.length;
  }

  return {
    evidenceSets,
    totalChunks: allChunks.length,
    allChunks,
  };
}

