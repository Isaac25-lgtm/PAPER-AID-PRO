import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const BUCKET_NAME = "research-papers";

let storageClientOverride: any = null;

/**
 * Allows isolated testing and mock harnesses to supply a mock storage client.
 * Strictly prohibited and blocked in production environments.
 */
export function setStorageClientOverride(client: any): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Security violation: Storage client overrides are strictly prohibited in production environments."
    );
  }
  storageClientOverride = client;
}

/**
 * Returns a server-authorized Supabase storage client.
 * Strictly requires SUPABASE_SECRET_KEY (supporting newer sb_secret_... format)
 * for privileged server operations on stored manuscripts.
 * Fails closed without any silent fallback to NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */
export function getStorageClient() {
  if (process.env.NODE_ENV !== "production" && storageClientOverride) {
    return storageClientOverride;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "Server storage configuration error: NEXT_PUBLIC_SUPABASE_URL is not configured."
    );
  }

  if (!secretKey) {
    throw new Error(
      "Server storage configuration error: SUPABASE_SECRET_KEY is required for server-authorized manuscript storage operations. " +
      "Silent fallback to NEXT_PUBLIC_SUPABASE_ANON_KEY is disabled to prevent unauthorized access or silent failure on private buckets."
    );
  }

  return createClient(supabaseUrl, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: { transport: WebSocket as any },
    global: {
      fetch: (url, options) => fetch(url, { ...options, cache: "no-store" }),
    },
  });
}

// Server-side Supabase client accessor enforcing service-role authorization
export const supabaseStorage = {
  get storage() {
    return getStorageClient().storage;
  },
};

export interface UploadResult {
  storagePath: string;
  publicUrl: string;
  relativePath: string;
}

/**
 * Normalizes a storage path to ensure it is relative to the bucket.
 * e.g., "research-papers/cuid123/original.pdf" -> "cuid123/original.pdf"
 */
export function normalizeStorageRelativePath(path: string): string {
  if (path.startsWith(`${BUCKET_NAME}/`)) {
    return path.substring(BUCKET_NAME.length + 1);
  }
  return path;
}

export interface UploadPaperOptions {
  userId?: string;
  customRelativePath?: string;
}

/**
 * Uploads a research manuscript PDF to Supabase Storage.
 * Default structured as: research-papers/<paperId>/original.pdf
 * User-scoped structured as: research-papers/users/<userId>/papers/<paperId>/original.pdf
 */
export async function uploadPaperPdf(
  paperId: string,
  fileBuffer: Buffer | Uint8Array,
  contentType: string = "application/pdf",
  options?: UploadPaperOptions
): Promise<UploadResult> {
  const relativePath = options?.customRelativePath
    ? options.customRelativePath
    : options?.userId
    ? `users/${options.userId}/papers/${paperId}/original.pdf`
    : `${paperId}/original.pdf`;
  const storagePath = `${BUCKET_NAME}/${relativePath}`;

  const { data, error } = await supabaseStorage.storage
    .from(BUCKET_NAME)
    .upload(relativePath, fileBuffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  // Phase 4B / 5A: Always route PDF requests through the authenticated endpoint
  // Do not expose direct unauthenticated public CDN URLs
  return {
    storagePath,
    publicUrl: `/api/papers/${paperId}/pdf`,
    relativePath,
  };
}

/**
 * Downloads a paper PDF from Supabase Storage by its canonical storagePath.
 */
export async function downloadPaperPdf(storagePath: string): Promise<Buffer> {
  const relativePath = normalizeStorageRelativePath(storagePath);

  const { data, error } = await supabaseStorage.storage
    .from(BUCKET_NAME)
    .download(relativePath);

  if (error || !data) {
    throw new Error(
      `Failed to download PDF from storage (${storagePath}): ${error?.message || "File not found"}`
    );
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Retrieves the canonical access URL for a stored PDF.
 * Routes to the authenticated Next.js streaming endpoint.
 */
export function getPaperPdfUrl(storagePath: string, paperId?: string): string {
  if (paperId) return `/api/papers/${paperId}/pdf`;
  const relativePath = normalizeStorageRelativePath(storagePath);
  const parts = relativePath.split("/");
  const papersIdx = parts.indexOf("papers");
  const extractedPaperId = papersIdx !== -1 && parts[papersIdx + 1] ? parts[papersIdx + 1] : parts[0];
  return `/api/papers/${extractedPaperId}/pdf`;
}

/**
 * Deletes a paper PDF from Supabase Storage.
 */
export async function deletePaperPdf(storagePath: string): Promise<void> {
  const relativePath = normalizeStorageRelativePath(storagePath);
  const { error } = await supabaseStorage.storage
    .from(BUCKET_NAME)
    .remove([relativePath]);

  if (error) {
    console.error(`Failed to remove file from Supabase storage (${storagePath}):`, error.message);
  }
}
