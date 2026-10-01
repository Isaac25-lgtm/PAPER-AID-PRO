/**
 * AI RESEARCH HUB — STRUCTURED OBSERVABILITY LOGGER
 *
 * Lightweight, safe server-side structured logging.
 * NEVER logs passwords, secrets, OpenAI keys, or database URLs.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogContext {
  operation: string;
  paperId?: string;
  conversationId?: string;
  provider?: string;
  durationMs?: number;
  errorCategory?: string;
  userId?: string;
  [key: string]: unknown;
}

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "secret",
  "authorization",
  "apikey",
  "cookie",
  "database_url",
  "direct_url",
  "openai_api_key",
]);

function sanitizeLogData(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map(sanitizeLogData);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeLogData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function logEvent(
  level: LogLevel,
  message: string,
  context: LogContext
) {
  const timestamp = new Date().toISOString();
  const sanitizedContext = sanitizeLogData(context) as LogContext;

  const payload = {
    timestamp,
    level: level.toUpperCase(),
    message,
    ...sanitizedContext,
  };

  const line = `[${timestamp}] [${level.toUpperCase()}] [${context.operation}] ${message}`;

  if (level === "error") {
    console.error(line, JSON.stringify(payload));
  } else if (level === "warn") {
    console.warn(line, JSON.stringify(payload));
  } else {
    console.log(line, JSON.stringify(payload));
  }
}

export const logger = {
  info: (message: string, context: LogContext) => logEvent("info", message, context),
  warn: (message: string, context: LogContext) => logEvent("warn", message, context),
  error: (message: string, context: LogContext) => logEvent("error", message, context),
};
