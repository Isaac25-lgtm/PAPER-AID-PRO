// If the policy changes while the app is open, the first API call that is refused for consent re-loads the profile
// (so the consent screen appears) instead of leaving pages half-loaded.
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, setConsentRequiredHandler } from "@/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
  setConsentRequiredHandler(() => undefined);
});

describe("consent required", () => {
  it("notifies the app when the API asks for the current notices to be accepted", async () => {
    const handler = vi.fn();
    setConsentRequiredHandler(handler);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "CONSENT_REQUIRED", message: "Please accept" } }), { status: 403 }));
    await expect(api.get("/documents")).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores other refusals", async () => {
    const handler = vi.fn();
    setConsentRequiredHandler(handler);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "NOT_INVITED", message: "No" } }), { status: 403 }));
    await expect(api.get("/documents")).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });
});
