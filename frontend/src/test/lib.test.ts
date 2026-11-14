import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, beginSession, SESSION_CHANGED, setConsentRequiredHandler, setTokenGetter } from "@/lib/api";
import { authorLine, sanitizeHtml } from "@/lib/format";

describe("sanitizeHtml", () => {
  it("keeps citation formatting but strips scripts, handlers and unsafe links", () => {
    const html = '<i>Nature</i> <b>7</b> <script>alert(1)</script><a href="javascript:x" onclick="y">x</a><span style="font-variant:small-caps">Smith</span><img src=x onerror=z>';
    const out = sanitizeHtml(html);
    expect(out).toContain("<i>Nature</i>");
    expect(out).toContain('style="font-variant:small-caps"');
    expect(out).not.toMatch(/script|onclick|onerror|javascript|<img/);
  });
  it("adds safe target and rel to http links", () => {
    expect(sanitizeHtml('<a href="https://doi.org/10.1/x">doi</a>')).toBe('<a href="https://doi.org/10.1/x" target="_blank" rel="noreferrer">doi</a>');
  });
});

describe("authorLine", () => {
  it("abbreviates long author lists", () => {
    expect(authorLine([])).toBe("Unknown authors");
    expect(authorLine(["A", "B"])).toBe("A, B");
    expect(authorLine(["A", "B", "C", "D"])).toBe("A, B, C et al.");
  });
});

describe("api client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setTokenGetter(async () => null);
  });

  it("sends the bearer token and builds query strings (arrays repeat, empties dropped)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    setTokenGetter(async () => "tok-123");
    await api.get("/discovery/search", { q: "malaria", providers: ["crossref", "pubmed"], year_from: undefined, open: "" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/discovery/search?q=malaria&providers=crossref&providers=pubmed");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
  });

  it("turns the backend error envelope into a typed ApiError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "CONFLICT", message: "Changed elsewhere", details: { server_version: 4 } } }), { status: 409 }),
    );
    await expect(api.patch("/documents/1", {})).rejects.toMatchObject({ status: 409, code: "CONFLICT", details: { server_version: 4 } });
  });

  it("reports network failures clearly", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("failed"));
    const error = await api.get("/health").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("NETWORK");
  });

  it("returns undefined for 204 responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.delete("/library/1")).resolves.toBeUndefined();
  });
});

describe("api client sessions (staging audit: identity switch)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setTokenGetter(async () => null);
    setConsentRequiredHandler(() => undefined);
  });

  it("does not send a request whose token arrived after the account changed", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    let release: (token: string) => void = () => undefined;
    setTokenGetter(() => new Promise((resolve) => (release = resolve)));
    const pending = api.get("/library").catch((e: unknown) => e);
    await Promise.resolve();
    beginSession(); // account A signs out / B signs in while A's token is still being fetched
    release("token-of-A");
    expect(await pending).toMatchObject({ code: SESSION_CHANGED });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts an in-flight request and never delivers its answer or its consent prompt to the new account", async () => {
    let reply: (r: Response) => void = () => undefined;
    let aborted = false;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      init?.signal?.addEventListener("abort", () => (aborted = true));
      return new Promise((resolve) => (reply = resolve));
    });
    const consent = vi.fn();
    setConsentRequiredHandler(consent);
    setTokenGetter(async () => "token-of-A");
    const pending = api.get("/documents").catch((e: unknown) => e);
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    beginSession();
    reply(new Response(JSON.stringify({ error: { code: "CONSENT_REQUIRED", message: "x" } }), { status: 403 }));
    expect(await pending).toMatchObject({ code: SESSION_CHANGED });
    expect(aborted).toBe(true);
    expect(consent).not.toHaveBeenCalled();
  });

  it("leaves requests of the current session alone", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    beginSession();
    await expect(api.get("/me")).resolves.toEqual({ ok: 1 });
  });
});
