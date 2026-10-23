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

import fs from "fs";
import path from "path";

const MOCK_STORAGE_ROOT =
  process.env.MOCK_STORAGE_DIR || path.join(process.cwd(), ".mock-storage");

function getSafeMockDiskPath(bucketName: string, filePath: string): string {
  const cleanBucket = bucketName.replace(/[\\/]/g, "").trim();
  const cleanFilePath = filePath.replace(/^[\\/]+/, "");
  const targetDir = path.resolve(MOCK_STORAGE_ROOT, cleanBucket);
  const resolved = path.resolve(targetDir, cleanFilePath);
  if (resolved !== targetDir && !resolved.startsWith(targetDir + path.sep)) {
    throw new Error(`Path traversal attempt detected in mock storage: ${filePath}`);
  }
  return resolved;
}

let mockStorageBuckets = new Map<string, Map<string, Buffer>>();

/**
 * For test isolation: clears the in-memory mock storage cache.
 * Leaves disk persistence intact to verify cold-start retrieval.
 */
export function clearMockStorageMemoryCache(): void {
  if (process.env.NODE_ENV === "production") return;
  mockStorageBuckets.clear();
}

/**
 * For test isolation: resets both in-memory cache and persisted files in mock storage.
 */
export function resetMockStorage(): void {
  if (process.env.NODE_ENV === "production") return;
  mockStorageBuckets.clear();
  try {
    if (fs.existsSync(MOCK_STORAGE_ROOT)) {
      fs.rmSync(MOCK_STORAGE_ROOT, { recursive: true, force: true });
    }
  } catch {}
}

function getOrCreateMockStorageClient() {
  return {
    storage: {
      from(bucketName: string) {
        if (!mockStorageBuckets.has(bucketName)) {
          mockStorageBuckets.set(bucketName, new Map<string, Buffer>());
        }
        const bucket = mockStorageBuckets.get(bucketName)!;
        return {
          upload: async (
            filePath: string,
            fileBody: Buffer | Uint8Array | ArrayBuffer | string
          ) => {
            let buf: Buffer;
            if (Buffer.isBuffer(fileBody)) {
              buf = fileBody;
            } else if (fileBody instanceof ArrayBuffer) {
              buf = Buffer.from(fileBody);
            } else if (ArrayBuffer.isView(fileBody)) {
              buf = Buffer.from(fileBody.buffer, fileBody.byteOffset, fileBody.byteLength);
            } else if (typeof fileBody === "string") {
              buf = Buffer.from(fileBody, "utf-8");
            } else {
              buf = Buffer.from(fileBody as any);
            }

            const cleanPath = filePath.replace(/^[\\/]+/, "");
            bucket.set(cleanPath, buf);

            try {
              const diskPath = getSafeMockDiskPath(bucketName, cleanPath);
              const parentDir = path.dirname(diskPath);
              if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
              }
              fs.writeFileSync(diskPath, buf);
            } catch (err: any) {
              console.warn(`[mockStorage] Failed to persist ${cleanPath} to disk:`, err.message);
            }

            return { data: { path: filePath }, error: null };
          },
          download: async (filePath: string) => {
            const cleanPath = filePath.replace(/^[\\/]+/, "");
            let buf = bucket.get(cleanPath);

            if (!buf) {
              try {
                const diskPath = getSafeMockDiskPath(bucketName, cleanPath);
                if (fs.existsSync(diskPath)) {
                  buf = fs.readFileSync(diskPath);
                  bucket.set(cleanPath, buf);
                }
              } catch (err: any) {
                console.warn(`[mockStorage] Failed to read ${cleanPath} from disk:`, err.message);
              }
            }

            if (!buf) {
              return {
                data: null,
                error: { message: `Object not found in mock storage: ${filePath}` },
              };
            }

            return {
              data: {
                arrayBuffer: async () =>
                  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
              },
              error: null,
            };
          },
          remove: async (filePaths: string[]) => {
            for (const p of filePaths) {
              const cleanPath = p.replace(/^[\\/]+/, "");
              bucket.delete(cleanPath);
              try {
                const diskPath = getSafeMockDiskPath(bucketName, cleanPath);
                if (fs.existsSync(diskPath)) {
                  fs.unlinkSync(diskPath);
                }
              } catch (err: any) {
                console.warn(`[mockStorage] Failed to delete ${cleanPath} from disk:`, err.message);
              }
            }
            return { data: filePaths, error: null };
          },
          createSignedUrl: async (filePath: string) => {
            const cleanPath = filePath.replace(/^[\\/]+/, "");
            return { data: { signedUrl: `/mock-storage/${cleanPath}` }, error: null };
          },
        };
      },
    },
  };
}

/**
 * Returns a server-authorized Supabase storage client.
 * Strictly requires SUPABASE_SECRET_KEY (supporting newer sb_secret_... format)
 * for privileged server operations on stored manuscripts.
 * Fails closed without any silent fallback to NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */
export function getStorageClient() {
  if (process.env.NODE_ENV === "production") {
    if (process.env.USE_MOCK_STORAGE === "true") {
      throw new Error(
        "Security violation: USE_MOCK_STORAGE is strictly prohibited in production environments."
      );
    }
  } else {
    if (storageClientOverride) {
      return storageClientOverride;
    }
    if (process.env.USE_MOCK_STORAGE === "true") {
      storageClientOverride = getOrCreateMockStorageClient();
      return storageClientOverride;
    }
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

/**
 * Lightweight, synchronous check to determine whether a stored manuscript PDF
 * exists in local/mock storage (in-memory cache or local disk).
 *
 * IMPORTANT: In production Supabase Storage mode, this returns true if storagePath
 * is present, avoiding expensive synchronous network round-trips for library card lists.
 * For true asynchronous existence verification in Supabase Storage, use checkPaperPdfExists().
 * It NEVER checks the local filesystem in production Supabase mode.
 */
export function isLocalPdfAvailable(storagePath: string | null | undefined): boolean {
  if (!storagePath) return false;

  const isMockMode =
    process.env.USE_MOCK_STORAGE === "true" ||
    process.env.NODE_ENV === "test" ||
    (process.env.NODE_ENV !== "production" && !process.env.SUPABASE_SECRET_KEY);

  if (isMockMode) {
    const relativePath = normalizeStorageRelativePath(storagePath);
    const cleanPath = relativePath.replace(/^[\\/]+/, "");

    // 1. If storageClientOverride is present (e.g. test harness)
    if (storageClientOverride?.storage?.from) {
      try {
        const bucketObj = storageClientOverride.storage.from(BUCKET_NAME);
        if (typeof bucketObj?.has === "function") {
          return bucketObj.has(cleanPath);
        }
        if (bucketObj?._bucket instanceof Map) {
          return bucketObj._bucket.has(cleanPath) || bucketObj._bucket.has(relativePath);
        }
      } catch {}
    }

    // 2. Check in-memory mock map in storage.ts
    const bucket = mockStorageBuckets.get(BUCKET_NAME);
    if (bucket && (bucket.has(cleanPath) || bucket.has(relativePath))) return true;

    // 3. Check local disk mock storage
    try {
      const diskPath = getSafeMockDiskPath(BUCKET_NAME, cleanPath);
      return fs.existsSync(diskPath);
    } catch {
      return false;
    }
  }

  // In production Supabase mode, local disk is NEVER checked to determine existence.
  return Boolean(storagePath);
}

/**
 * Asynchronously verifies whether a stored manuscript PDF exists in the active storage provider.
 * - In local mock storage mode (USE_MOCK_STORAGE=true or development/test), checks in-memory cache and local disk.
 * - In production Supabase Storage mode, directly queries Supabase Storage via bucket.list() to verify object existence.
 *   NEVER checks only the local filesystem in production mode.
 */
export async function checkPaperPdfExists(storagePath: string): Promise<boolean> {
  if (!storagePath) return false;

  const isMockMode =
    process.env.USE_MOCK_STORAGE === "true" ||
    process.env.NODE_ENV === "test" ||
    (process.env.NODE_ENV !== "production" && !process.env.SUPABASE_SECRET_KEY);

  if (isMockMode) {
    return isLocalPdfAvailable(storagePath);
  }

  // Production Supabase Storage check: Query Supabase bucket directly
  try {
    const relativePath = normalizeStorageRelativePath(storagePath);
    const cleanPath = relativePath.replace(/^[\\/]+/, "");
    const parts = cleanPath.split("/");
    const filename = parts.pop();
    const folder = parts.join("/");

    if (!filename) return false;

    const { data, error } = await supabaseStorage.storage
      .from(BUCKET_NAME)
      .list(folder, {
        limit: 100,
        search: filename,
      });

    if (error || !data) {
      return false;
    }

    return data.some((item: { name: string }) => item.name === filename);
  } catch (err: any) {
    console.warn(`[storage] checkPaperPdfExists failed for ${storagePath}:`, err.message);
    return false;
  }
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
