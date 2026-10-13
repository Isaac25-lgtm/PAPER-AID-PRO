/**
 * AI RESEARCH HUB — GOOGLE GEMINI ADAPTER (@google/genai)
 *
 * Implements native fast-tier completions, streaming, TTFT tracking,
 * and cost estimation using the official @google/genai SDK.
 */

import { GoogleGenAI } from "@google/genai";
import { AI_CONFIG, getGeminiClient, hasGeminiKey } from "../../config";
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

export class GoogleAdapter implements ProviderAdapter {
  public readonly provider: ProviderName = "google";

  public isConfigured(): boolean {
    return hasGeminiKey();
  }

  public async validateModel(model: string): Promise<boolean> {
    if (!model || typeof model !== "string") return false;
    // Known valid Google Gemini families
    return model.startsWith("gemini-");
  }

  public async generate(req: ModelRequest): Promise<ModelResponse> {
    if (!this.isConfigured()) {
      throw new ModelRouterError({
        message: "GEMINI_API_KEY is not configured on the server.",
        code: "MISSING_API_KEY",
        provider: "google",
        statusCode: 401,
      });
    }

    const client = getGeminiClient();
    if (!client) {
      throw new ModelRouterError({
        message: "Failed to initialize GoogleGenAI client.",
        code: "PROVIDER_ERROR",
        provider: "google",
      });
    }

    const modelName = req.model || AI_CONFIG.fastModel;
    const startTime = Date.now();

    try {
      const config: any = {};
      if (req.systemPrompt) {
        config.systemInstruction = req.systemPrompt;
      }
      if (typeof req.temperature === "number") {
        config.temperature = req.temperature;
      }
      if (typeof req.maxTokens === "number") {
        config.maxOutputTokens = req.maxTokens;
      }
      if (req.signal) {
        config.abortSignal = req.signal;
      }

      const response = await client.models.generateContent({
        model: modelName,
        contents: req.prompt,
        config: Object.keys(config).length > 0 ? config : undefined,
      });

      const durationMs = Date.now() - startTime;
      const text = response.text || "";

      // Extract usage metadata if provided, otherwise compute heuristic
      const promptTokens =
        response.usageMetadata?.promptTokenCount ||
        estimateTokenCount(req.prompt + (req.systemPrompt || ""));
      const completionTokens =
        response.usageMetadata?.candidatesTokenCount || estimateTokenCount(text);
      const totalTokens = promptTokens + completionTokens;

      const usage: TokenUsage = {
        promptTokens,
        completionTokens,
        totalTokens,
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
        provider: "google",
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
        provider: "google",
        model: modelName,
        usage,
        metrics,
        cost,
      };
    } catch (err: unknown) {
      const normalized = normalizeProviderError(err, "google");
      const isPrivate = Boolean(
        req.isPrivateContext ||
        req.privacyClassification === "PRIVATE" ||
        !req.privacyClassification ||
        req.privacyClassification === "UNKNOWN"
      );
      logRouterTelemetry({
        timestamp: new Date().toISOString(),
        task: req.task,
        provider: "google",
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
        message: "GEMINI_API_KEY is not configured on the server.",
        code: "MISSING_API_KEY",
        provider: "google",
        statusCode: 401,
      });
    }

    const client = getGeminiClient();
    if (!client) {
      throw new ModelRouterError({
        message: "Failed to initialize GoogleGenAI client.",
        code: "PROVIDER_ERROR",
        provider: "google",
      });
    }

    const modelName = req.model || AI_CONFIG.fastModel;
    const startTime = Date.now();
    let ttftMs: number | undefined = undefined;
    let accumulatedText = "";
    let isFirst = true;

    try {
      const config: any = {};
      if (req.systemPrompt) {
        config.systemInstruction = req.systemPrompt;
      }
      if (typeof req.temperature === "number") {
        config.temperature = req.temperature;
      }
      if (typeof req.maxTokens === "number") {
        config.maxOutputTokens = req.maxTokens;
      }
      if (req.signal) {
        config.abortSignal = req.signal;
      }

      const stream = await client.models.generateContentStream({
        model: modelName,
        contents: req.prompt,
        config: Object.keys(config).length > 0 ? config : undefined,
      });

      for await (const chunk of stream) {
        const delta = chunk.text || "";
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
      const promptTokens = estimateTokenCount(req.prompt + (req.systemPrompt || ""));
      const completionTokens = estimateTokenCount(accumulatedText);
      const usage: TokenUsage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };
      const cost = estimateCost(modelName, promptTokens, completionTokens);
      const metrics = { durationMs, ttftMs };

      const isPrivate = Boolean(
        req.isPrivateContext ||
        req.privacyClassification === "PRIVATE" ||
        !req.privacyClassification ||
        req.privacyClassification === "UNKNOWN"
      );

      yield {
        textDelta: "",
        isLastChunk: true,
        usage,
        metrics,
        cost,
      };

      logRouterTelemetry({
        timestamp: new Date().toISOString(),
        task: req.task,
        provider: "google",
        model: modelName,
        isFallback: false,
        isPrivateContext: isPrivate,
        usage,
        metrics,
        cost,
        status: "SUCCESS",
      });
    } catch (err: unknown) {
      const normalized = normalizeProviderError(err, "google");
      const isPrivate = Boolean(
        req.isPrivateContext ||
        req.privacyClassification === "PRIVATE" ||
        !req.privacyClassification ||
        req.privacyClassification === "UNKNOWN"
      );
      logRouterTelemetry({
        timestamp: new Date().toISOString(),
        task: req.task,
        provider: "google",
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
