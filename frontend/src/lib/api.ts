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
}

export interface Page<T> {
  items: T[];
  total: number;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), { method, headers, body, signal: options.signal });
  } catch {
    if (options.signal?.aborted) throw new ApiError(0, "ABORTED", "Request cancelled.");
    throw new ApiError(0, "NETWORK", "Could not reach PaperAid Pro. Check your connection and try again.");
  }
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
    if (code === "CONSENT_REQUIRED") onConsentRequired();
    throw new ApiError(response.status, code, message, details);
  }
  if (options.raw) return (await response.blob()) as T;
  if (options.paged) {
    const items = (await response.json()) as unknown[];
    const total = Number(response.headers.get("X-Total-Count") ?? items.length);
    return { items, total: Number.isFinite(total) ? total : items.length } as T;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
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
