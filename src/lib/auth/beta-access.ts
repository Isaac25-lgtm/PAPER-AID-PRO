/**
 * AI RESEARCH HUB — PRIVATE BETA REGISTRATION ACCESS CONTROL
 *
 * Implements server-side allowlisting for new user registrations during invite-only beta.
 * Does NOT restrict already-registered users or administrators from signing in.
 *
 * Configuration:
 * - BETA_REGISTRATION_MODE: "allowlist" to enforce invitation check.
 * - BETA_ALLOWED_EMAILS: Comma-separated list of invited email addresses (server-only).
 */

export interface BetaAccessCheckResult {
  allowed: boolean;
  reason?: string;
}

export const BETA_INVITE_ONLY_MESSAGE =
  "AI Research Hub is currently in private beta. This email has not yet been invited.";

/**
 * Checks whether a normalized email address is permitted to register a new account.
 * Fails closed if mode is "allowlist" but allowlist is empty or missing.
 */
export function isRegistrationAllowed(email: string): BetaAccessCheckResult {
  const rawMode = process.env.BETA_REGISTRATION_MODE;
  // Default to "open" for unrestricted registration (personal and university emails accepted equally)
  const mode = (rawMode || "open").toLowerCase().trim();

  // If registration is open
  if (mode !== "allowlist") {
    return { allowed: true };
  }

  const rawAllowlist = process.env.BETA_ALLOWED_EMAILS;
  if (!rawAllowlist || !rawAllowlist.trim()) {
    // Fail CLOSED if mode is allowlist but allowlist is empty or missing
    console.warn(
      "[BetaAccess] BETA_REGISTRATION_MODE is 'allowlist' but BETA_ALLOWED_EMAILS is empty or unset. Failing closed for new registrations."
    );
    return {
      allowed: false,
      reason: BETA_INVITE_ONLY_MESSAGE,
    };
  }

  const normalizedInput = email.toLowerCase().trim();
  const allowedSet = new Set(
    rawAllowlist
      .split(",")
      .map((e) => e.toLowerCase().trim())
      .filter((e) => Boolean(e) && e.includes("@"))
  );

  if (allowedSet.size === 0) {
    console.warn(
      "[BetaAccess] BETA_ALLOWED_EMAILS contains zero valid email entries. Failing closed for new registrations."
    );
    return {
      allowed: false,
      reason: BETA_INVITE_ONLY_MESSAGE,
    };
  }

  if (allowedSet.has(normalizedInput)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: BETA_INVITE_ONLY_MESSAGE,
  };
}
