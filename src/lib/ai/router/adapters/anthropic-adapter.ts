/**
 * AI RESEARCH HUB — ANTHROPIC CLAUDE ADAPTER (@anthropic-ai/sdk)
 *
 * Implements native smart-tier academic drafting, rewriting, and synthesis
 * with rigorous token tracking and streaming via the official Anthropic SDK.
 */

import { Anthropic } from "@anthropic-ai/sdk";
import { AI_CONFIG, getAnthropicClient, hasAnthropicKey } from "../../config";
import { estimateCost, estimateTokenCount, logRouterTelemetry } from "../cost-tracker";
import { ModelRouterError, normalizeProviderError } from "../errors";
import {
  ModelRequest,
  ModelResponse,
  ModelStreamChunk,
  ProviderName,
  TokenUsage,
} from "../types";
import { ProviderAdapter } from "./base-adapter";

export class AnthropicAdapter implements ProviderAdapter {
  public readonly provider: ProviderName = "anthropic";

  public isConfigured(): boolean {
    return hasAnthropicKey();
  }

  public async validateModel(model: string): Promise<boolean> {
    if (!model || typeof model !== "string") return false;
    return model.startsWith("claude-");
  }

  public async generate(req: ModelRequest): Promise<ModelResponse> {
    if (!this.isConfigured()) {
      throw new ModelRouterError({
        message: "ANTHROPIC_API_KEY is not configured on the server.",
        code: "MISSING_API_KEY",
        provider: "anthropic",
        statusCode: 401,
      });
    }

    const client = getAnthropicClient();
    if (!client) {
      throw new ModelRouterError({
        message: "Failed to initialize Anthropic client.",
        code: "PROVIDER_ERROR",
        provider: "anthropic",
      });
    }

    const modelName = req.model || AI_CONFIG.smartModel;
    const startTime = Date.now();

    try {
      const response = await client.messages.create(
        {
          model: modelName,
          max_tokens: req.maxTokens || 4096,
          temperature: typeof req.temperature === "number" ? req.temperature : 0.2,
          system: req.systemPrompt,
          messages: [{ role: "user", content: req.prompt }],
        },
        req.signal ? { signal: req.signal } : undefined
      );

      const durationMs = Date.now() - startTime;
      const text = response.content
        .filter((c) => c.type === "text")
        .map((c) => (c as any).text)
        .join("");

      const promptTokens = response.usage?.input_tokens || estimateTokenCount(req.prompt);
      const completionTokens = response.usage?.output_tokens || estimateTokenCount(text);
      const usage: TokenUsage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };

      const cost = estimateCost(modelName, promptTokens, completionTokens);
      const metrics = { durationMs };

      const isPrivate = Boolean(
        req.isPrivateContext ||
        req.privacyClassification === "PRIVATE" ||
        !req.privacyClassification ||
        req.privacyClassification === "UNKNOWN"
      );

      logRouterTelemetry({
        timestamp: new Date().toISOString(),
        task: req.task,
        provider: "anthropic",
        model: modelName,
        isFallback: false,
        isPrivateContext: isPrivate,
        usage,
        metrics,
        cost,
        status: "SUCCESS",
      });

      return {
        text,
        provider: "anthropic",
        model: modelName,
        usage,
        metrics,
        cost,
        finishReason: response.stop_reason || undefined,
      };
    } catch (err: unknown) {
      const normalized = normalizeProviderError(err, "anthropic");
      const isPrivate = Boolean(
        req.isPrivateContext ||
        req.privacyClassification === "PRIVATE" ||
        !req.privacyClassification ||
        req.privacyClassification === "UNKNOWN"
      );
      logRouterTelemetry({
        timestamp: new Date().toISOString(),
        task: req.task,
        provider: "anthropic",
        model: modelName,
        isFallback: false,
        isPrivateContext: isPrivate,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        metrics: { durationMs: Date.now() - startTime },
        cost: estimateCost(modelName, 0, 0),
        status: "FAILED",
        errorCode: normalized.code,
      });
      throw normalized;
    }
  }

  public async *generateStream(
    req: ModelRequest
  ): AsyncIterable<ModelStreamChunk> {
    if (!this.isConfigured()) {
      throw new ModelRouterError({
        message: "ANTHROPIC_API_KEY is not configured on the server.",
        code: "MISSING_API_KEY",
        provider: "anthropic",
        statusCode: 401,
      });
    }

    const client = getAnthropicClient();
    if (!client) {
      throw new ModelRouterError({
        message: "Failed to initialize Anthropic client.",
        code: "PROVIDER_ERROR",
        provider: "anthropic",
      });
    }

    const modelName = req.model || AI_CONFIG.smartModel;
    const startTime = Date.now();
    let ttftMs: number | undefined = undefined;
    let accumulatedText = "";
    let isFirst = true;

    try {
      const stream = client.messages.stream(
        {
          model: modelName,
          max_tokens: req.maxTokens || 4096,
          temperature: typeof req.temperature === "number" ? req.temperature : 0.2,
          system: req.systemPrompt,
          messages: [{ role: "user", content: req.prompt }],
        },
        req.signal ? { signal: req.signal } : undefined
      );

      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && (chunk.delta as any)?.text) {
          const delta = (chunk.delta as any).text as string;
          if (isFirst) {
            ttftMs = Date.now() - startTime;
            isFirst = false;
          }
          accumulatedText += delta;
          yield {
            textDelta: delta,
            isFirstChunk: isFirst,
            metrics: { durationMs: Date.now() - startTime, ttftMs },
          };
        }
      }

      const finalMessage = await stream.finalMessage();
      const durationMs = Date.now() - startTime;
      const promptTokens = finalMessage.usage?.input_tokens || estimateTokenCount(req.prompt);
      const completionTokens = finalMessage.usage?.output_tokens || estimateTokenCount(accumulatedText);
      const usage: TokenUsage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };
      const cost = estimateCost(modelName, promptTokens, completionTokens);
      const metrics = { durationMs, ttftMs };

      yield {
        textDelta: "",
        isLastChunk: true,
        usage,
        metrics,
        cost,
      };

      const isPrivate = Boolean(
        req.isPrivateContext ||
        req.privacyClassification === "PRIVATE" ||
        !req.privacyClassification ||
        req.privacyClassification === "UNKNOWN"
      );

      logRouterTelemetry({
        timestamp: new Date().toISOString(),
        task: req.task,
        provider: "anthropic",
        model: modelName,
        isFallback: false,
        isPrivateContext: isPrivate,
        usage,
        metrics,
        cost,
        status: "SUCCESS",
      });
    } catch (err: unknown) {
      const normalized = normalizeProviderError(err, "anthropic");
      const isPrivate = Boolean(
        req.isPrivateContext ||
        req.privacyClassification === "PRIVATE" ||
        !req.privacyClassification ||
        req.privacyClassification === "UNKNOWN"
      );
      logRouterTelemetry({
        timestamp: new Date().toISOString(),
        task: req.task,
        provider: "anthropic",
        model: modelName,
        isFallback: false,
        isPrivateContext: isPrivate,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        metrics: { durationMs: Date.now() - startTime, ttftMs },
        cost: estimateCost(modelName, 0, 0),
        status: "FAILED",
        errorCode: normalized.code,
      });
      throw normalized;
    }
  }
}
