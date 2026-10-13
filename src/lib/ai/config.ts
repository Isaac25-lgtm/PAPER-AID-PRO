import { OpenAI } from "openai";
import { Anthropic } from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

export const AI_CONFIG = {
  summaryModel: process.env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini",
  qaModel: process.env.OPENAI_QA_MODEL || "gpt-4o-mini",
  draftingModel: process.env.ANTHROPIC_DRAFTING_MODEL || "claude-3-5-sonnet-20241022",
  autocompleteModel: process.env.GEMINI_AUTOCOMPLETE_MODEL || "gemini-2.0-flash",
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  embeddingDimensions: parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS || "1536", 10),
  embeddingBatchSize: 50,
  promptVersion: "paper-summary-v1",
  qaPromptVersion: "paper-qa-v2",
  maxContextTokens: 60000, // Safe chunk token budget per synthesis call
  temperature: 0.1, // Low temperature for maximum factual fidelity and deterministic output
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

