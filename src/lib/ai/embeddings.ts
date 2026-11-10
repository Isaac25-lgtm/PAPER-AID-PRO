import "server-only";
import { createHash } from "crypto";
import { getOpenAIClient, AI_CONFIG } from "./config";

/**
 * Prepares the derived embedding text representation for a PaperChunk.
 * Incorporates paper title and section context to maximize retrieval accuracy
 * while preserving the original chunk text completely unaltered in storage.
 */
export function prepareChunkEmbeddingInput(
  paperTitle: string,
  section: string | null | undefined,
  chunkText: string
): string {
  const parts: string[] = [];
  if (paperTitle?.trim()) {
    parts.push(`Title: ${paperTitle.trim()}`);
  }
  if (section?.trim()) {
    parts.push(`Section: ${section.trim()}`);
  }
  parts.push("Content:");
  parts.push(chunkText.trim());

  return parts.join("\n");
}

/**
 * Computes a deterministic SHA-256 hash of the exact normalized text
 * sent to the OpenAI embeddings API.
 */
export function computeEmbeddingInputHash(normalizedInput: string): string {
  const textToHash = normalizedInput.replace(/\r\n/g, "\n").trim();
  return createHash("sha256").update(textToHash, "utf8").digest("hex");
}

/**
 * Generates an embedding vector for a single string using OpenAI's embeddings API.
 * Validates dimensions against AI_CONFIG.embeddingDimensions.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const results = await generateEmbeddingsBatch([text]);
  if (!results || results.length === 0) {
    throw new Error("Failed to generate embedding: empty response from OpenAI.");
  }
  return results[0];
}

/**
 * Generates a deterministic pseudo-embedding vector from text.
 * Used for isolated testing and local environments to guarantee zero paid AI calls.
 */
export function generateDeterministicMockEmbedding(
  text: string,
  dimensions: number = AI_CONFIG.embeddingDimensions
): number[] {
  const tokens = text.toLowerCase().match(/\b[a-z0-9_-]+\b/g) || [text];
  const vector: number[] = new Array(dimensions).fill(0);
  for (const token of tokens) {
    const hash = createHash("sha256").update(token, "utf8").digest();
    for (let i = 0; i < dimensions; i++) {
      const byte = hash[i % hash.length];
      const val = ((byte + (i % 31)) / 143.0) - 1.0;
      vector[i] += val;
    }
  }
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += vector[i] * vector[i];
  }
  const sqrtNorm = Math.sqrt(norm) || 1;
  return vector.map((v) => Number((v / sqrtNorm).toFixed(6)));
}

/**
 * Determines whether the system is in mock embedding mode.
 * Real embeddings require explicit server configuration: ENABLE_REAL_EMBEDDINGS === "true"
 * and not being in test or isolated mock storage mode.
 * In production, mock embeddings are strictly forbidden under all circumstances.
 */
export function isMockEmbeddingMode(): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  return (
    process.env.USE_MOCK_STORAGE === "true" ||
    process.env.NODE_ENV === "test" ||
    process.env.ENABLE_REAL_EMBEDDINGS !== "true"
  );
}

/**
 * Generates embeddings for a batch of strings using OpenAI's embeddings API.
 * In test, local, or unapproved environments, uses deterministic mock embeddings.
 * Validates returned vector count and dimensions.
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const normalizedTexts = texts.map((t) => t.replace(/\r\n/g, "\n").trim());

  // Fail-closed guard: Mock embeddings are strictly prohibited in production.
  // If NODE_ENV === "production" and OPENAI_API_KEY is missing, throw immediately.
  if (process.env.NODE_ENV === "production") {
    if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_API_KEY.trim()) {
      throw new Error(
        "[FATAL] Mock embeddings are strictly prohibited in production: OPENAI_API_KEY is missing or invalid."
      );
    }
  }

  // Execution boundary: In isolated tests or when real embeddings are not explicitly enabled,
  // use deterministic mock vectors to guarantee zero paid API calls.
  if (isMockEmbeddingMode()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[FATAL] Mock embeddings are strictly prohibited in production environments."
      );
    }
    return normalizedTexts.map((text) =>
      generateDeterministicMockEmbedding(text, AI_CONFIG.embeddingDimensions)
    );
  }

  const client = getOpenAIClient();

  try {
    const response = await client.embeddings.create({
      model: AI_CONFIG.embeddingModel,
      input: normalizedTexts,
      encoding_format: "float",
    });

    if (!response.data || response.data.length !== normalizedTexts.length) {
      throw new Error(
        `OpenAI embedding returned ${response.data?.length ?? 0} vectors, expected ${normalizedTexts.length}.`
      );
    }

    const vectors: number[][] = [];
    for (let i = 0; i < response.data.length; i++) {
      const item = response.data[i];
      if (!item.embedding || !Array.isArray(item.embedding)) {
        throw new Error(`Embedding at index ${i} is malformed or missing.`);
      }

      if (item.embedding.length !== AI_CONFIG.embeddingDimensions) {
        throw new Error(
          `Embedding vector dimension mismatch: received ${item.embedding.length}, expected ${AI_CONFIG.embeddingDimensions} (model: ${AI_CONFIG.embeddingModel}).`
        );
      }

      vectors.push(item.embedding);
    }

    return vectors;
  } catch (error: any) {
    // Sanitize error message to prevent leaking any sensitive information
    const rawMessage = error instanceof Error ? error.message : String(error);
    const sanitized = rawMessage.replace(/sk-[a-zA-Z0-9_\-]{20,}/g, "[REDACTED_API_KEY]");
    console.error("[Embeddings] Error generating embeddings:", sanitized);
    throw new Error(`Embedding generation failed: ${sanitized}`);
  }
}
