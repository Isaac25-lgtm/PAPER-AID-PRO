import { OpenAI } from "openai";
import { Anthropic } from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

export const AI_CONFIG = {
  fastModel: process.env.FAST_MODEL || "gemini-3.5-flash-lite",
  smartModel: process.env.SMART_MODEL || "claude-sonnet-5",
  fastFallbackModel: process.env.FAST_FALLBACK_MODEL || "gpt-4o-mini",
  smartFallbackModel: process.env.SMART_FALLBACK_MODEL || "gpt-4o",
  embeddingModel: process.env.EMBEDDING_MODEL || process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  embeddingDimensions: parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS || "1536", 10),
  embeddingBatchSize: 50,
  // Existing fields preserved for zero RAG regression
  summaryModel: process.env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini",
  qaModel: process.env.OPENAI_QA_MODEL || "gpt-4o-mini",
  draftingModel: process.env.SMART_MODEL || "claude-sonnet-5",
  autocompleteModel: process.env.FAST_MODEL || "gemini-3.5-flash-lite",
  promptVersion: "paper-summary-v1",
  qaPromptVersion: "paper-qa-v2",
  maxContextTokens: 60000, // Safe chunk token budget per synthesis call
  temperature: 0.1, // Low temperature for factual fidelity and deterministic output
  maxOutputTokens: {
    autocomplete: parseInt(process.env.ROUTER_MAX_TOKENS_AUTOCOMPLETE || "256", 10),
    drafting: parseInt(process.env.ROUTER_MAX_TOKENS_DRAFTING || "4096", 10),
    rewriting: parseInt(process.env.ROUTER_MAX_TOKENS_REWRITING || "2048", 10),
    synthesis: parseInt(process.env.ROUTER_MAX_TOKENS_SYNTHESIS || "2200", 10),
  },
  timeoutsMs: {
    autocomplete: parseInt(process.env.ROUTER_TIMEOUT_AUTOCOMPLETE_MS || "12000", 10),
    drafting: parseInt(process.env.ROUTER_TIMEOUT_DRAFTING_MS || "60000", 10),
    rewriting: parseInt(process.env.ROUTER_TIMEOUT_REWRITING_MS || "30000", 10),
    synthesis: parseInt(process.env.ROUTER_TIMEOUT_SYNTHESIS_MS || "90000", 10),
  },
};

let cachedOpenAIClient: OpenAI | null = null;
let cachedAnthropicClient: Anthropic | null = null;
let cachedGeminiClient: GoogleGenAI | null = null;

/**
 * Returns a server-side OpenAI client singleton.
 * Throws a descriptive error if the API key is unconfigured.
 */
export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey || apiKey === "your-openai-api-key-here" || apiKey === "") {
    throw new Error(
      "OPENAI_API_KEY is not configured on the server. Please add a valid OpenAI API key to your local .env file."
    );
  }

  if (!cachedOpenAIClient) {
    cachedOpenAIClient = new OpenAI({ apiKey });
  }

  return cachedOpenAIClient;
}

/**
 * Returns true if a valid Anthropic API key is configured.
 */
export function hasAnthropicKey(): boolean {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  return Boolean(apiKey && apiKey !== "your-anthropic-api-key-here" && apiKey !== "");
}

/**
 * Returns a server-side Anthropic client singleton (Claude 3.5 Sonnet Smart Tier).
 * Returns null if unconfigured (allowing graceful fallback to OpenAI).
 */
export function getAnthropicClient(): Anthropic | null {
  if (!hasAnthropicKey()) {
    return null;
  }

  if (!cachedAnthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY!.trim();
    cachedAnthropicClient = new Anthropic({ apiKey });
  }

  return cachedAnthropicClient;
}

/**
 * Returns true if a valid Google Gemini API key is configured.
 */
export function hasGeminiKey(): boolean {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return Boolean(apiKey && apiKey !== "your-gemini-api-key-here" && apiKey !== "");
}

/**
 * Returns a server-side Google GenAI client singleton (Gemini 2.0 Flash Fast Tier).
 * Returns null if unconfigured (allowing graceful fallback to OpenAI).
 */
export function getGeminiClient(): GoogleGenAI | null {
  if (!hasGeminiKey()) {
    return null;
  }

  if (!cachedGeminiClient) {
    const apiKey = process.env.GEMINI_API_KEY!.trim();
    cachedGeminiClient = new GoogleGenAI({ apiKey });
  }

  return cachedGeminiClient;
}

