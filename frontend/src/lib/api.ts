// Thin, typed client for the PaperAid Pro API. Every request carries the Firebase ID token when signed in.
// The browser never talks to the database or storage directly.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter = async () => null;

export function setTokenGetter(getter: TokenGetter): void {
  getToken = getter;
}

// Each signed-in identity is a session. When the account changes (sign-out, or another account in another tab),
// requests started under the old identity are aborted, and anything they return is discarded instead of reaching
// the page. Errors from them carry code SESSION_CHANGED.
let session = 0;
const inFlight = new Set<AbortController>();
export const SESSION_CHANGED = "SESSION_CHANGED";
const sessionChanged = () =>
  new ApiError(0, SESSION_CHANGED, "Your sign-in changed while this was running, so it was stopped. Nothing from the previous account was kept.");

/** Start a new session: call when the signed-in identity changes. Aborts every request of the previous one. */
export function beginSession(): void {
  session += 1;
  for (const controller of inFlight) controller.abort();
  inFlight.clear();
}

let onConsentRequired: () => void = () => undefined;
/** Called when the API says the current notices must be accepted (e.g. the policy changed while the page was open). */
export function setConsentRequiredHandler(handler: () => void): void {
  onConsentRequired = handler;
}

// Production builds call the Cloud Run API directly (VITE_API_BASE_URL); development uses the Vite proxy.
const BASE = `${import.meta.env.VITE_API_BASE_URL ?? ""}/api/v1`;

type Query = Record<string, string | number | boolean | string[] | null | undefined>;

function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else params.append(key, String(value));
  }
  const qs = params.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ""}`;
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
  form?: FormData;
  raw?: boolean;
  /** Return the X-Total-Count header alongside the JSON body (paged lists). */
  paged?: boolean;
  /** Abort the request (e.g. a newer keystroke superseded it). Aborts surface as ApiError code "ABORTED". */
  signal?: AbortSignal;
  /** Read the body as newline-delimited JSON, calling this for each event as it arrives (streaming endpoints). */
  onEvent?: (event: unknown) => void;
}

export interface Page<T> {
  items: T[];
  total: number;
  /** Set when a search matched nothing as typed and was corrected from the records' own words (X-Matched-Query). */
  matchedQuery?: string;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const started = session;
  const headers: Record<string, string> = {};
  const token = await getToken();
  if (started !== session) throw sessionChanged(); // the identity changed while the token was being fetched
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const controller = new AbortController();
  const forward = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener("abort", forward);
  inFlight.add(controller);
  try {
    return await send<T>(method, path, options, headers, body, controller.signal, started);
  } finally {
    inFlight.delete(controller);
    options.signal?.removeEventListener("abort", forward);
  }
}

async function send<T>(
  method: string,
  path: string,
  options: RequestOptions,
  headers: Record<string, string>,
  body: BodyInit | undefined,
  signal: AbortSignal,
  started: number,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), { method, headers, body, signal });
  } catch {
    if (started !== session) throw sessionChanged();
    if (signal.aborted) throw new ApiError(0, "ABORTED", "Request cancelled.");
    throw new ApiError(0, "NETWORK", "Could not reach PaperAid Pro. Check your connection and try again.");
  }
  if (started !== session) throw sessionChanged(); // never hand the old account's answer to the new page
  if (!response.ok) {
    let code = "HTTP_ERROR";
    let message = `Request failed (HTTP ${response.status}).`;
    let details: unknown;
    try {
      const payload = (await response.json()) as { error?: { code: string; message: string; details?: unknown } };
      if (payload.error) ({ code, message, details } = payload.error);
    } catch {
      /* non-JSON error body */
    }
    if (started !== session) throw sessionChanged();
    if (code === "CONSENT_REQUIRED") onConsentRequired(); // only for the identity that is still signed in
    throw new ApiError(response.status, code, message, details);
  }
  let result: T;
  if (options.onEvent) {
    await readEvents(response, options.onEvent, () => started !== session);
    result = undefined as T;
  } else if (options.raw) result = (await response.blob()) as T;
  else if (options.paged) {
    const items = (await response.json()) as unknown[];
    const total = Number(response.headers.get("X-Total-Count") ?? items.length);
    const matched = response.headers.get("X-Matched-Query");
    result = { items, total: Number.isFinite(total) ? total : items.length, ...(matched ? { matchedQuery: decodeURIComponent(matched) } : {}) } as T;
  } else if (response.status === 204) result = undefined as T;
  else result = (await response.json()) as T;
  if (started !== session) throw sessionChanged(); // the body arrived after the identity changed
  return result;
}

/** Hand each JSON line of a streamed body to `onEvent` as soon as it is complete. Stops (with SESSION_CHANGED) if
 * the signed-in identity changes mid-stream, so no event from the previous account reaches the page. */
const NEWLINE = String.fromCharCode(10);

async function readEvents(response: Response, onEvent: (event: unknown) => void, changed: () => boolean): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (changed()) {
      await reader.cancel();
      throw sessionChanged();
    }
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let newline = buffer.indexOf(NEWLINE);
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line));
      newline = buffer.indexOf(NEWLINE);
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>("GET", path, { query, signal }),
  post: <T>(path: string, body?: unknown, query?: Query, signal?: AbortSignal) => request<T>("POST", path, { body, query, signal }),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, { body }),
  page: <T>(path: string, query?: Query) => request<Page<T>>("GET", path, { query, paged: true }),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, { form }),
  blob: (path: string, query?: Query, signal?: AbortSignal) => request<Blob>("GET", path, { query, raw: true, signal }),
  stream: (path: string, query: Query, onEvent: (event: unknown) => void, signal?: AbortSignal) =>
    request<void>("GET", path, { query, onEvent, signal }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export async function downloadFile(path: string, filename: string, query?: Query): Promise<void> {
  const blob = await api.blob(path, query);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
