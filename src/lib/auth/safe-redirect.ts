/**
 * Safe callback URL sanitizer to prevent open redirect vulnerabilities.
 * Ensures the target destination is an internal relative path.
 */
export function getSafeCallbackUrl(
  rawUrl: string | null | undefined,
  fallback: string = "/"
): string {
  if (!rawUrl || typeof rawUrl !== "string") {
    return fallback;
  }

  const trimmed = rawUrl.trim();

  // Reject empty string or protocol-relative URLs (e.g. "//evil.com")
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallback;
  }

  // Reject absolute URLs with protocols (e.g. "http://", "https://", "javascript:")
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return fallback;
  }

  // Must begin with single forward slash
  if (trimmed.startsWith("/")) {
    return trimmed;
  }

  return fallback;
}

export const sanitizeCallbackUrl = getSafeCallbackUrl;
