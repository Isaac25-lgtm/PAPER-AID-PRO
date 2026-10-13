/**
 * AI RESEARCH HUB — DIRECT MULTI-SDK MODEL ROUTER
 *
 * Implements intelligent, cost-optimized, and privacy-hardened task routing across:
 * - Google Gemini 3.5 Flash Lite (@google/genai) — Fast-tier inline autocomplete
 * - Anthropic Claude Sonnet 5 (@anthropic-ai/sdk) — Smart-tier academic drafting & rewriting
 * - OpenAI (openai SDK) — Robust fallbacks, embeddings, and structured synthesis
 *
 * SAFETY GUARANTEES:
 * 1. Server-side only: Provider API keys are never leaked to client bundles.
 * 2. Privacy-hardened fallback: Private manuscripts NEVER cross providers silently.
 * 3. Bounded retries: Maximum 1 retry on transient 5xx errors to prevent runaway billing.
 * 4. Zero text logging: Private manuscript content is strictly excluded from telemetry.
 */

import { AI_CONFIG } from "../config";
import { AnthropicAdapter } from "./adapters/anthropic-adapter";
import { ProviderAdapter } from "./adapters/base-adapter";
import { GoogleAdapter } from "./adapters/google-adapter";
import { OpenAIAdapter } from "./adapters/openai-adapter";
import { logRouterTelemetry } from "./cost-tracker";
import { ModelRouterError, normalizeProviderError } from "./errors";
import {
  EmbeddingRequest,
  EmbeddingResponse,
  ModelRequest,
  ModelResponse,
  ModelStreamChunk,
  PrivacyClassification,
  ProviderName,
  ProviderStatus,
  RouterTask,
} from "./types";

export interface TaskRouteDefinition {
  primaryProvider: ProviderName;
  primaryModel: string;
  fallbackProvider: ProviderName;
  fallbackModel: string;
  defaultTimeoutMs: number;
}

export class ModelRouter {
  private adapters: Map<ProviderName, ProviderAdapter> = new Map();

  constructor() {
    this.adapters.set("google", new GoogleAdapter());
    this.adapters.set("anthropic", new AnthropicAdapter());
    this.adapters.set("openai", new OpenAIAdapter());
  }

  /**
   * Returns task routing table mapping tasks to primary & fallback models.
   */
  public getRouteDefinition(task: RouterTask): TaskRouteDefinition {
    switch (task) {
      case "autocomplete":
        return {
          primaryProvider: "google",
          primaryModel: AI_CONFIG.fastModel,
          fallbackProvider: "openai",
          fallbackModel: AI_CONFIG.fastFallbackModel,
          defaultTimeoutMs: AI_CONFIG.timeoutsMs.autocomplete,
        };

      case "drafting":
        return {
          primaryProvider: "anthropic",
          primaryModel: AI_CONFIG.smartModel,
          fallbackProvider: "openai",
          fallbackModel: AI_CONFIG.smartFallbackModel,
          defaultTimeoutMs: AI_CONFIG.timeoutsMs.drafting,
        };

      case "rewriting":
        return {
          primaryProvider: "anthropic",
          primaryModel: AI_CONFIG.smartModel,
          fallbackProvider: "openai",
          fallbackModel: AI_CONFIG.smartFallbackModel,
          defaultTimeoutMs: AI_CONFIG.timeoutsMs.rewriting,
        };

      case "synthesis":
        return {
          primaryProvider: "openai",
          primaryModel: AI_CONFIG.summaryModel,
          fallbackProvider: "openai",
          fallbackModel: AI_CONFIG.summaryModel,
          defaultTimeoutMs: AI_CONFIG.timeoutsMs.synthesis,
        };

      case "embedding":
        return {
          primaryProvider: "openai",
          primaryModel: AI_CONFIG.embeddingModel,
          fallbackProvider: "openai",
          fallbackModel: AI_CONFIG.embeddingModel,
          defaultTimeoutMs: 30000,
        };

      default:
        throw new ModelRouterError({
          message: `Unsupported router task: ${task}`,
          code: "UNSUPPORTED_TASK",
        });
    }
  }

  /**
   * Returns availability and configuration status for each registered provider.
   */
  public getProviderStatuses(): ProviderStatus[] {
    return [
      {
        provider: "google",
        available: this.adapters.get("google")?.isConfigured() ?? false,
        configuredModel: AI_CONFIG.fastModel,
        hasCredentials: this.adapters.get("google")?.isConfigured() ?? false,
      },
      {
        provider: "anthropic",
        available: this.adapters.get("anthropic")?.isConfigured() ?? false,
        configuredModel: AI_CONFIG.smartModel,
        hasCredentials: this.adapters.get("anthropic")?.isConfigured() ?? false,
      },
      {
        provider: "openai",
        available: this.adapters.get("openai")?.isConfigured() ?? false,
        configuredModel: AI_CONFIG.summaryModel,
        hasCredentials: this.adapters.get("openai")?.isConfigured() ?? false,
      },
    ];
  }

  /**
   * Evaluates the privacy classification of a request.
   * STRICT GUARANTEE: Fails closed.
   * If unspecified, UNKNOWN, or if isPrivateContext is true, resolves to PRIVATE.
   * Requests involving user manuscripts, unpublished research, retrieved private chunks,
   * or private editor content are classified as private by default.
   */
  public resolvePrivacyClassification(req: ModelRequest): PrivacyClassification {
    if (req.privacyClassification === "PUBLIC" && req.isPrivateContext !== true) {
      return "PUBLIC";
    }
    return "PRIVATE";
  }

  /**
   * Helper to retrieve configured maximum output tokens for a given task.
   */
  private getMaxTokensForTask(task: RouterTask, userMaxTokens?: number): number {
    if (typeof userMaxTokens === "number") return userMaxTokens;
    if (task === "autocomplete") return AI_CONFIG.maxOutputTokens.autocomplete;
    if (task === "drafting") return AI_CONFIG.maxOutputTokens.drafting;
    if (task === "rewriting") return AI_CONFIG.maxOutputTokens.rewriting;
    if (task === "synthesis") return AI_CONFIG.maxOutputTokens.synthesis;
    return 4096;
  }

  /**
   * Executes a non-streaming completion task with privacy-aware routing and explicit fallback.
   */
  public async route(req: ModelRequest): Promise<ModelResponse> {
    const routeDef = this.getRouteDefinition(req.task);
    const targetProviderName = req.preferredProvider || routeDef.primaryProvider;
    const targetModel = req.model || (targetProviderName === routeDef.primaryProvider ? routeDef.primaryModel : routeDef.fallbackModel);
    const maxTokens = this.getMaxTokensForTask(req.task, req.maxTokens);

    const primaryAdapter = this.adapters.get(targetProviderName);
    if (!primaryAdapter) {
      throw new ModelRouterError({
        message: `Provider '${targetProviderName}' is not registered in the ModelRouter.`,
        code: "PROVIDER_ERROR",
        provider: targetProviderName,
      });
    }

    // Step 1: Check primary adapter availability
    if (primaryAdapter.isConfigured()) {
      try {
        const timeoutMs = req.timeoutMs || routeDef.defaultTimeoutMs;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const chainedSignal = req.signal
          ? combineAbortSignals(req.signal, controller.signal)
          : controller.signal;

        try {
          return await this.executeWithBoundedRetry(primaryAdapter, {
            ...req,
            model: targetModel,
            maxTokens,
            signal: chainedSignal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (primaryErr: any) {
        // Step 2: Determine if fallback is permitted
        this.assertFallbackPermitted(primaryErr, req, routeDef);

        // Execute fallback
        return await this.executeFallback(req, routeDef, targetProviderName);
      }
    } else {
      // Primary is unconfigured: Attempt fallback if permitted
      this.assertFallbackPermitted(
        new ModelRouterError({
          message: `Primary provider ${targetProviderName} is unconfigured.`,
          code: "MISSING_API_KEY",
          provider: targetProviderName,
        }),
        req,
        routeDef
      );

      return await this.executeFallback(req, routeDef, targetProviderName);
    }
  }

  /**
   * Executes a streaming completion task with privacy-aware routing.
   * GUARANTEE: Streaming responses cannot silently switch providers after partial output.
   */
  public async *routeStream(req: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const routeDef = this.getRouteDefinition(req.task);
    const targetProviderName = req.preferredProvider || routeDef.primaryProvider;
    const targetModel = req.model || (targetProviderName === routeDef.primaryProvider ? routeDef.primaryModel : routeDef.fallbackModel);
    const maxTokens = this.getMaxTokensForTask(req.task, req.maxTokens);

    const primaryAdapter = this.adapters.get(targetProviderName);
    if (!primaryAdapter) {
      throw new ModelRouterError({
        message: `Provider '${targetProviderName}' is not registered.`,
        code: "PROVIDER_ERROR",
        provider: targetProviderName,
      });
    }

    let hasEmittedChunks = false;

    if (primaryAdapter.isConfigured()) {
      try {
        const timeoutMs = req.timeoutMs || routeDef.defaultTimeoutMs;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const chainedSignal = req.signal
          ? combineAbortSignals(req.signal, controller.signal)
          : controller.signal;

        try {
          for await (const chunk of primaryAdapter.generateStream({
            ...req,
            model: targetModel,
            maxTokens,
            signal: chainedSignal,
          })) {
            hasEmittedChunks = true;
            yield chunk;
          }
          return;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (streamErr: any) {
        // STRICT SAFETY GUARANTEE: Streaming responses cannot switch providers after partial output
        if (hasEmittedChunks) {
          throw normalizeProviderError(
            streamErr,
            targetProviderName,
            "Streaming interrupted after partial response was generated."
          );
        }

        this.assertFallbackPermitted(streamErr, req, routeDef);

        // Fallback stream execution (only if zero chunks have been emitted)
        const fallbackAdapter = this.adapters.get(routeDef.fallbackProvider)!;
        yield* fallbackAdapter.generateStream({
          ...req,
          model: routeDef.fallbackModel,
          maxTokens,
        });
        return;
      }
    } else {
      this.assertFallbackPermitted(
        new ModelRouterError({
          message: `Primary provider ${targetProviderName} is unconfigured.`,
          code: "MISSING_API_KEY",
          provider: targetProviderName,
        }),
        req,
        routeDef
      );

      const fallbackAdapter = this.adapters.get(routeDef.fallbackProvider)!;
      yield* fallbackAdapter.generateStream({
        ...req,
        model: routeDef.fallbackModel,
        maxTokens,
      });
    }
  }

  /**
   * Generates vector embeddings using the configured embedding adapter.
   */
  public async routeEmbedding(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const openaiAdapter = this.adapters.get("openai") as OpenAIAdapter;
    if (!openaiAdapter || !openaiAdapter.isConfigured()) {
      throw new ModelRouterError({
        message: "OpenAI embeddings adapter is not configured.",
        code: "MISSING_API_KEY",
        provider: "openai",
      });
    }

    return await openaiAdapter.generateEmbeddings(req);
  }

  /**
   * STRICT SAFETY GUARD: Asserts whether falling back to a secondary provider is authorized.
   * If the context contains private user documents or is classified PRIVATE, cross-provider
   * forwarding is BLOCKED unless explicitly authorized under a configured provider policy.
   * FAILS CLOSED by default.
   */
  public assertFallbackPermitted(
    originalError: any,
    req: ModelRequest,
    routeDef: TaskRouteDefinition
  ): void {
    if (req.allowFallback === false) {
      throw originalError;
    }

    const isCrossProvider = routeDef.primaryProvider !== routeDef.fallbackProvider;
    if (!isCrossProvider) {
      return;
    }

    const privacy = this.resolvePrivacyClassification(req);
    if (privacy === "PRIVATE") {
      const isExplicitlyAuthorized =
        req.crossProviderPolicy === "EXPLICIT_CROSS_PROVIDER_AUTHORIZED";

      if (!isExplicitlyAuthorized) {
        throw new ModelRouterError({
          message: `Cross-provider fallback is blocked for private manuscripts and unclassified contexts to prevent unauthorized external data transfer. Configure credentials for ${routeDef.primaryProvider} or explicitly authorize cross-provider fallback under policy.`,
          code: "PRIVATE_CONTEXT_CROSS_PROVIDER_BLOCKED",
          provider: routeDef.primaryProvider,
          cause: originalError,
        });
      }
    }
  }

  /**
   * Executes fallback provider with appropriate telemetry tagging.
   */
  private async executeFallback(
    req: ModelRequest,
    routeDef: TaskRouteDefinition,
    primaryProviderName: ProviderName
  ): Promise<ModelResponse> {
    const fallbackAdapter = this.adapters.get(routeDef.fallbackProvider);
    if (!fallbackAdapter || !fallbackAdapter.isConfigured()) {
      throw new ModelRouterError({
        message: `Primary provider '${primaryProviderName}' failed, and fallback provider '${routeDef.fallbackProvider}' is unconfigured.`,
        code: "MISSING_API_KEY",
        provider: routeDef.fallbackProvider,
      });
    }

    const maxTokens = this.getMaxTokensForTask(req.task, req.maxTokens);
    const fallbackResponse = await fallbackAdapter.generate({
      ...req,
      model: routeDef.fallbackModel,
      maxTokens,
    });

    const isPrivate = this.resolvePrivacyClassification(req) === "PRIVATE";

    // Tag telemetry indicating fallback occurred
    logRouterTelemetry({
      timestamp: new Date().toISOString(),
      task: req.task,
      provider: fallbackAdapter.provider,
      model: routeDef.fallbackModel,
      isFallback: true,
      fallbackFromProvider: primaryProviderName,
      isPrivateContext: isPrivate,
      usage: fallbackResponse.usage,
      metrics: fallbackResponse.metrics,
      cost: fallbackResponse.cost,
      status: "SUCCESS",
    });

    return fallbackResponse;
  }

  /**
   * Executes adapter with maximum 1 retry for transient 5xx or network errors.
   * Prevents uncontrolled loops and runaway billing.
   */
  private async executeWithBoundedRetry(
    adapter: ProviderAdapter,
    req: ModelRequest
  ): Promise<ModelResponse> {
    try {
      return await adapter.generate(req);
    } catch (err: any) {
      if (err instanceof ModelRouterError && err.isRetryable && !req.signal?.aborted) {
        // Exponential backoff pause (300ms) before 1 single retry
        await new Promise((resolve) => setTimeout(resolve, 300));
        return await adapter.generate(req);
      }
      throw err;
    }
  }
}

/**
 * Combines user-supplied AbortSignal with internal timeout AbortSignal.
 */
function combineAbortSignals(signalA: AbortSignal, signalB: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();

  if (signalA.aborted || signalB.aborted) {
    controller.abort();
    return controller.signal;
  }

  signalA.addEventListener("abort", abort, { once: true });
  signalB.addEventListener("abort", abort, { once: true });

  return controller.signal;
}

// Global router singleton
let modelRouterInstance: ModelRouter | null = null;

export function getModelRouter(): ModelRouter {
  if (!modelRouterInstance) {
    modelRouterInstance = new ModelRouter();
  }
  return modelRouterInstance;
}
