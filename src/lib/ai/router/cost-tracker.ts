/**
 * AI RESEARCH HUB — MODEL ROUTER COST & TELEMETRY TRACKER
 *
 * Implements strict per-request token counting and USD cost estimation.
 * ZERO-DATA-LEAKAGE GUARANTEE: Never logs private manuscript text,
 * user questions, or prompt bodies. Only structured operational telemetry.
 */

import { CostEstimate, RouterTelemetryEntry, TokenUsage } from "./types";

interface ModelPricing {
  promptCostPerMillion: number;
  completionCostPerMillion: number;
}

/**
 * Standard published pricing rates ($ / 1,000,000 tokens)
 */
const PRICING_TABLE: Record<string, ModelPricing> = {
  // Google Fast Tier
  "gemini-3.5-flash-lite": {
    promptCostPerMillion: 0.075,
    completionCostPerMillion: 0.30,
  },
  // Anthropic Smart Tier
  "claude-sonnet-5": {
    promptCostPerMillion: 3.00,
    completionCostPerMillion: 15.00,
  },
  // OpenAI Fallbacks & Baseline
  "gpt-4o-mini": {
    promptCostPerMillion: 0.15,
    completionCostPerMillion: 0.60,
  },
  "gpt-4o": {
    promptCostPerMillion: 2.50,
    completionCostPerMillion: 10.00,
  },
  // Embeddings
  "text-embedding-3-small": {
    promptCostPerMillion: 0.02,
    completionCostPerMillion: 0.00,
  },
};

/**
 * Calculates estimated USD cost for a given model and token count.
 */
export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): CostEstimate {
  const normalizedModel = model.toLowerCase().trim();
  const pricing = PRICING_TABLE[normalizedModel] || {
    // Conservative default pricing if model is unrecognized
    promptCostPerMillion: 1.0,
    completionCostPerMillion: 3.0,
  };

  const promptCost = (promptTokens / 1_000_000) * pricing.promptCostPerMillion;
  const completionCost = (completionTokens / 1_000_000) * pricing.completionCostPerMillion;
  const total = Number((promptCost + completionCost).toFixed(6));

  return {
    estimatedCostUsd: total,
    isEstimate: true,
    pricingTier: normalizedModel,
  };
}

/**
 * Heuristic token estimation when provider response omits explicit token telemetry.
 * Rough standard: ~4 characters per token in English academic prose.
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Emits sanitized operational telemetry.
 * GUARANTEE: Never logs prompt content or manuscript excerpts.
 */
export function logRouterTelemetry(entry: RouterTelemetryEntry): void {
  // Format clean single-line JSON log entry for production log aggregators
  const sanitizedLog = {
    event: "ai_model_router_telemetry",
    timestamp: entry.timestamp,
    task: entry.task,
    provider: entry.provider,
    model: entry.model,
    isFallback: entry.isFallback,
    fallbackFrom: entry.fallbackFromProvider || null,
    isPrivateContext: entry.isPrivateContext,
    tokens: {
      prompt: entry.usage.promptTokens,
      completion: entry.usage.completionTokens,
      total: entry.usage.totalTokens,
    },
    latencyMs: entry.metrics.durationMs,
    ttftMs: entry.metrics.ttftMs || null,
    cost: {
      estimatedUsd: entry.cost.estimatedCostUsd,
      isEstimate: true,
      pricingTier: entry.cost.pricingTier,
    },
    status: entry.status,
    errorCode: entry.errorCode || null,
  };

  // Structured operational log
  console.log(`[ModelRouter] ${JSON.stringify(sanitizedLog)}`);
}
