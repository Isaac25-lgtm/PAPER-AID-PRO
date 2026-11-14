// Staging audit (low): while the terms must be re-accepted, autosave is parked instead of retried on a timer, and
// it saves exactly once when this account's consent is current again.
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: { id: "u1", needs_consent: false } as { id: string; needs_consent: boolean } | null }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: auth.user }) }));

const { useConsentParking } = await import("@/lib/consentParking");
const { ApiError } = await import("@/lib/api");

const consentError = new ApiError(403, "CONSENT_REQUIRED", "Accept the updated terms.");

describe("autosave during re-consent", () => {
  it("parks a refused save and flushes once after acceptance, with no retries in between", () => {
    const flush = vi.fn(async () => true);
    auth.user = { id: "u1", needs_consent: false };
    const view = renderHook(() => useConsentParking(flush));
    expect(view.result.current(consentError)).toBe(true); // parked
    auth.user = { id: "u1", needs_consent: true }; // the profile reload shows the consent screen
    view.rerender();
    view.rerender();
    expect(flush).not.toHaveBeenCalled(); // nothing is sent while the overlay is open
    auth.user = { id: "u1", needs_consent: false }; // accepted
    view.rerender();
    expect(flush).toHaveBeenCalledTimes(1);
    auth.user = { id: "u1", needs_consent: false };
    view.rerender();
    expect(flush).toHaveBeenCalledTimes(1); // exactly once
  });

  it("flushes straight away if the reloaded profile shows consent was already current", () => {
    const flush = vi.fn(async () => true);
    auth.user = { id: "u1", needs_consent: false };
    const view = renderHook(() => useConsentParking(flush));
    view.result.current(consentError);
    auth.user = { id: "u1", needs_consent: false }; // e.g. accepted in another tab meanwhile
    view.rerender();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("does not park other failures (network errors keep the ordinary retry)", () => {
    const view = renderHook(() => useConsentParking(vi.fn()));
    expect(view.result.current(new ApiError(0, "NETWORK", "offline"))).toBe(false);
    expect(view.result.current(new ApiError(409, "CONFLICT", "changed"))).toBe(false);
  });
});
