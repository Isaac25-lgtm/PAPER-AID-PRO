/**
 * AI RESEARCH HUB — MULTI-MODEL ROUTER TYPES
 *
 * Defines unified contracts for provider adapters, routing tasks,
 * token accounting, streaming, and telemetry metrics.
 */

export type RouterTask =
  | "autocomplete"
  | "drafting"
  | "rewriting"
  | "synthesis"
  | "embedding";

export type ProviderName = "google" | "anthropic" | "openai";

export type PrivacyClassification = "PRIVATE" | "PUBLIC" | "UNKNOWN";

export type CrossProviderPolicy = "DISALLOWED" | "EXPLICIT_CROSS_PROVIDER_AUTHORIZED";

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LatencyMetrics {
  durationMs: number;
  ttftMs?: number; // Time to First Token (critical for autocomplete)
}

export interface CostEstimate {
  estimatedCostUsd: number;
  isEstimate: true;
  pricingTier: string;
}

export interface ModelRequest {
  task: RouterTask;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  preferredProvider?: ProviderName;
  allowFallback?: boolean;
  /**
   * FAIL-CLOSED PRIVACY CLASSIFICATION:
   * If omitted or UNKNOWN, the router FAILS CLOSED and classifies the request as PRIVATE by default.
   * Requests involving user manuscripts, unpublished research, retrieved private chunks, or
   * editor content MUST remain PRIVATE.
   */
  privacyClassification?: PrivacyClassification;
  /**
   * Explicit authorization required to permit cross-provider forwarding for private content.
   * Defaults to DISALLOWED.
   */
  crossProviderPolicy?: CrossProviderPolicy;
  /**
   * Legacy flag for backwards compatibility (also maps to PRIVATE if true).
   */
  isPrivateContext?: boolean;
  stream?: boolean;
}

export interface ModelResponse {
  text: string;
  provider: ProviderName;
  model: string;
  usage: TokenUsage;
  metrics: LatencyMetrics;
  cost: CostEstimate;
  finishReason?: string;
}

export interface ModelStreamChunk {
  textDelta: string;
  isFirstChunk?: boolean;
  isLastChunk?: boolean;
  usage?: TokenUsage;
  metrics?: LatencyMetrics;
  cost?: CostEstimate;
}

export interface RouterTelemetryEntry {
  timestamp: string;
  task: RouterTask;
  provider: ProviderName;
  model: string;
  isFallback: boolean;
  fallbackFromProvider?: ProviderName;
  isPrivateContext: boolean;
  usage: TokenUsage;
  metrics: LatencyMetrics;
  cost: CostEstimate;
  status: "SUCCESS" | "FAILED";
  errorCode?: string;
}

export interface ProviderStatus {
  provider: ProviderName;
  available: boolean;
  configuredModel: string;
  hasCredentials: boolean;
}

export interface EmbeddingRequest {
  input: string | string[];
  model?: string;
  dimensions?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  provider: ProviderName;
  model: string;
  usage: TokenUsage;
  metrics: LatencyMetrics;
  cost: CostEstimate;
}
