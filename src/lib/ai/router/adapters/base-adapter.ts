/**
 * AI RESEARCH HUB — BASE PROVIDER ADAPTER INTERFACE
 *
 * Defines the unified contract that each native SDK adapter must fulfill.
 */

import {
  EmbeddingRequest,
  EmbeddingResponse,
  ModelRequest,
  ModelResponse,
  ModelStreamChunk,
  ProviderName,
} from "../types";

export interface ProviderAdapter {
  readonly provider: ProviderName;

  /**
   * Returns true if provider API key is present in environment.
   */
  isConfigured(): boolean;

  /**
   * Generates a non-streaming completion.
   */
  generate(req: ModelRequest): Promise<ModelResponse>;

  /**
   * Generates a streaming response, yielding delta chunks.
   */
  generateStream(req: ModelRequest): AsyncIterable<ModelStreamChunk>;

  /**
   * Validates if a model identifier is available / compatible.
   */
  validateModel(model: string): Promise<boolean>;

  /**
   * Generates embeddings (optional; implemented by OpenAI).
   */
  generateEmbeddings?(req: EmbeddingRequest): Promise<EmbeddingResponse>;
}
