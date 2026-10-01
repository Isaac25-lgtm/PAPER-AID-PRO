import { OpenAI } from "openai";

export const AI_CONFIG = {
  summaryModel: process.env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini",
  qaModel: process.env.OPENAI_QA_MODEL || "gpt-4o-mini",
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  embeddingDimensions: parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS || "1536", 10),
  embeddingBatchSize: 50,
  promptVersion: "paper-summary-v1",
  qaPromptVersion: "paper-qa-v2",
  maxContextTokens: 60000, // Safe chunk token budget per synthesis call
  temperature: 0.1, // Low temperature for maximum factual fidelity and deterministic output
};

let cachedOpenAIClient: OpenAI | null = null;

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
