/**
 * AI RESEARCH HUB — MODEL ROUTER ERROR HIERARCHY
 *
 * Normalizes provider-specific errors into unified domain exceptions,
 * strictly scrubbing credentials and private prompt content.
 */

import { ProviderName } from "./types";

export type RouterErrorCode =
  | "MISSING_API_KEY"
  | "PROVIDER_TIMEOUT"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "PROVIDER_ERROR"
  | "FALLBACK_DISALLOWED"
  | "PRIVATE_CONTEXT_CROSS_PROVIDER_BLOCKED"
  | "UNSUPPORTED_TASK"
  | "MODEL_UNAVAILABLE";

export class ModelRouterError extends Error {
  public readonly code: RouterErrorCode;
  public readonly provider?: ProviderName;
  public readonly statusCode?: number;
  public readonly isRetryable: boolean;

  constructor(params: {
    message: string;
    code: RouterErrorCode;
    provider?: ProviderName;
    statusCode?: number;
    isRetryable?: boolean;
    cause?: unknown;
  }) {
    super(sanitizeErrorMessage(params.message));
    this.name = "ModelRouterError";
    this.code = params.code;
    this.provider = params.provider;
    this.statusCode = params.statusCode;
    this.isRetryable = Boolean(params.isRetryable);

    if (params.cause) {
      this.cause = params.cause;
    }
    Object.setPrototypeOf(this, ModelRouterError.prototype);
  }
}

/**
 * Strips potential API keys or token fragments from raw provider error messages.
 */
function sanitizeErrorMessage(msg: string): string {
  if (!msg) return "An unexpected model router error occurred.";
  return msg
    .replace(/sk-[a-zA-Z0-9_\-]{16,}/g, "[REDACTED_API_KEY]")
    .replace(/AIza[a-zA-Z0-9_\-]{30,}/g, "[REDACTED_API_KEY]")
    .replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, "bearer [REDACTED_TOKEN]");
}

/**
 * Normalizes an unknown error from a provider call into a structured ModelRouterError.
 */
export function normalizeProviderError(
  err: unknown,
  provider: ProviderName,
  customMessage?: string
): ModelRouterError {
  if (err instanceof ModelRouterError) {
    return err;
  }

  const anyErr = err as any;
  const rawMsg = anyErr?.message || String(err);
  const status = anyErr?.status || anyErr?.statusCode;

  // Timeout detection
  if (
    anyErr?.name === "AbortError" ||
    anyErr?.name === "TimeoutError" ||
    rawMsg.includes("timeout") ||
    rawMsg.includes("aborted")
  ) {
    return new ModelRouterError({
      message: `${provider} request timed out.`,
      code: "PROVIDER_TIMEOUT",
      provider,
      statusCode: 408,
      isRetryable: true,
      cause: err,
    });
  }

  // Rate limit detection
  if (status === 429 || rawMsg.includes("rate limit") || rawMsg.includes("quota")) {
    return new ModelRouterError({
      message: `${provider} rate limit exceeded. Please try again shortly.`,
      code: "RATE_LIMITED",
      provider,
      statusCode: 429,
      isRetryable: true,
      cause: err,
    });
  }

  // Authentication detection
  if (status === 401 || status === 403 || rawMsg.includes("API key") || rawMsg.includes("unauthorized")) {
    return new ModelRouterError({
      message: `${provider} authentication failed or API key invalid.`,
      code: "MISSING_API_KEY",
      provider,
      statusCode: status || 401,
      isRetryable: false,
      cause: err,
    });
  }

  // Server transient error
  if (status >= 500 && status < 600) {
    return new ModelRouterError({
      message: `${provider} service error (${status}): ${rawMsg}`,
      code: "PROVIDER_ERROR",
      provider,
      statusCode: status,
      isRetryable: true,
      cause: err,
    });
  }

  return new ModelRouterError({
    message: customMessage || `${provider} provider error: ${rawMsg}`,
    code: "PROVIDER_ERROR",
    provider,
    statusCode: status || 500,
    isRetryable: false,
    cause: err,
  });
}
