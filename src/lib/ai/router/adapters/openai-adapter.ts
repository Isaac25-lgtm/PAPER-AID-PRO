/**
 * AI RESEARCH HUB — OPENAI ADAPTER (openai SDK)
 *
 * Implements native completions, streaming, embeddings, and reliable
 * fallback capabilities using the official OpenAI SDK.
 */

import { OpenAI } from "openai";
import { AI_CONFIG, getOpenAIClient } from "../../config";
import { estimateCost, estimateTokenCount, logRouterTelemetry } from "../cost-tracker";
import { ModelRouterError, normalizeProviderError } from "../errors";
import {
  EmbeddingRequest,
  EmbeddingResponse,
  ModelRequest,
  ModelResponse,
  ModelStreamChunk,
  ProviderName,
  TokenUsage,
} from "../types";
import { ProviderAdapter } from "./base-adapter";

export class OpenAIAdapter implements ProviderAdapter {
  public readonly provider: ProviderName = "openai";

  public isConfigured(): boolean {
    const key = process.env.OPENAI_API_KEY?.trim();
    return Boolean(key && key !== "your-openai-api-key-here" && key !== "");
  }

  public async validateModel(model: string): Promise<boolean> {
    if (!model || typeof model !== "string") return false;
    return model.startsWith("gpt-") || model.startsWith("text-embedding-");
  }

  public async generate(req: ModelRequest): Promise<ModelResponse> {
    if (!this.isConfigured()) {
      throw new ModelRouterError({
        message: "OPENAI_API_KEY is not configured on the server.",
        code: "MISSING_API_KEY",
        provider: "openai",
        statusCode: 401,
      });
    }

    const client = getOpenAIClient();
    const modelName = req.model || (req.task === "drafting" ? AI_CONFIG.smartFallbackModel : AI_CONFIG.fastFallbackModel);
    const startTime = Date.now();

    try {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (req.systemPrompt) {
        messages.push({ role: "system", content: req.systemPrompt });
      }
      messages.push({ role: "user", content: req.prompt });

      const response = await client.chat.completions.create(
        {
          model: modelName,
          messages,
          temperature: typeof req.temperature === "number" ? req.temperature : 0.2,
          max_tokens: req.maxTokens || 4096,
        },
        req.signal ? { signal: req.signal } : undefined
      );

      const durationMs = Date.now() - startTime;
      const text = response.choices[0]?.message?.content || "";

      const promptTokens = response.usage?.prompt_tokens || estimateTokenCount(req.prompt);
      const completionTokens = response.usage?.completion_tokens || estimateTokenCount(text);
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
        provider: "openai",
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
        provider: "openai",
        model: modelName,
        usage,
        metrics,
        cost,
        finishReason: response.choices[0]?.finish_reason || undefined,
      };
    } catch (err: unknown) {
      const normalized = normalizeProviderError(err, "openai");
      const isPrivate = Boolean(
        req.isPrivateContext ||
        req.privacyClassification === "PRIVATE" ||
        !req.privacyClassification ||
        req.privacyClassification === "UNKNOWN"
      );
      logRouterTelemetry({
        timestamp: new Date().toISOString(),
        task: req.task,
        provider: "openai",
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
        message: "OPENAI_API_KEY is not configured on the server.",
        code: "MISSING_API_KEY",
        provider: "openai",
        statusCode: 401,
      });
    }

    const client = getOpenAIClient();
    const modelName = req.model || (req.task === "drafting" ? AI_CONFIG.smartFallbackModel : AI_CONFIG.fastFallbackModel);
    const startTime = Date.now();
    let ttftMs: number | undefined = undefined;
    let accumulatedText = "";
    let isFirst = true;

    try {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (req.systemPrompt) {
        messages.push({ role: "system", content: req.systemPrompt });
      }
      messages.push({ role: "user", content: req.prompt });

      const stream = await client.chat.completions.create(
        {
          model: modelName,
          messages,
          temperature: typeof req.temperature === "number" ? req.temperature : 0.2,
          max_tokens: req.maxTokens || 4096,
          stream: true,
          stream_options: { include_usage: true },
        },
        req.signal ? { signal: req.signal } : undefined
      );

      let streamUsage: OpenAI.CompletionUsage | undefined = undefined;

      for await (const chunk of stream) {
        if (chunk.usage) {
          streamUsage = chunk.usage;
        }

        const delta = chunk.choices[0]?.delta?.content || "";
        if (!delta) continue;

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

      const durationMs = Date.now() - startTime;
      const promptTokens = streamUsage?.prompt_tokens || estimateTokenCount(req.prompt);
      const completionTokens = streamUsage?.completion_tokens || estimateTokenCount(accumulatedText);
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
        provider: "openai",
        model: modelName,
        isFallback: false,
        isPrivateContext: isPrivate,
        usage,
        metrics,
        cost,
        status: "SUCCESS",
      });
    } catch (err: unknown) {
      const normalized = normalizeProviderError(err, "openai");
      const isPrivate = Boolean(
        req.isPrivateContext ||
        req.privacyClassification === "PRIVATE" ||
        !req.privacyClassification ||
        req.privacyClassification === "UNKNOWN"
      );
      logRouterTelemetry({
        timestamp: new Date().toISOString(),
        task: req.task,
        provider: "openai",
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

  public async generateEmbeddings(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (!this.isConfigured()) {
      throw new ModelRouterError({
        message: "OPENAI_API_KEY is not configured for embeddings.",
        code: "MISSING_API_KEY",
        provider: "openai",
        statusCode: 401,
      });
    }

    const client = getOpenAIClient();
    const modelName = req.model || AI_CONFIG.embeddingModel;
    const startTime = Date.now();

    try {
      const response = await client.embeddings.create(
        {
          model: modelName,
          input: req.input,
          dimensions: req.dimensions || AI_CONFIG.embeddingDimensions,
        },
        req.signal ? { signal: req.signal } : undefined
      );

      const durationMs = Date.now() - startTime;
      const embeddings = response.data.map((d) => d.embedding);
      const promptTokens = response.usage.prompt_tokens;
      const usage: TokenUsage = {
        promptTokens,
        completionTokens: 0,
        totalTokens: promptTokens,
      };
      const cost = estimateCost(modelName, promptTokens, 0);

      return {
        embeddings,
        provider: "openai",
        model: modelName,
        usage,
        metrics: { durationMs },
        cost,
      };
    } catch (err: unknown) {
      throw normalizeProviderError(err, "openai", "Failed to generate vector embeddings.");
    }
  }
}
