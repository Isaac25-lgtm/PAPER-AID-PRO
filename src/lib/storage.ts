import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const BUCKET_NAME = "research-papers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn("Supabase credentials missing in storage client initialization.");
}

// Server-side Supabase client singleton for storage operations
export const supabaseStorage = createClient(supabaseUrl || "", supabaseKey || "", {
  auth: { persistSession: false },
  realtime: { transport: WebSocket as any },
  global: {
    fetch: (url, options) => fetch(url, { ...options, cache: "no-store" }),
  },
});

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
 * Uploads a research manuscript PDF to Supabase Storage.
 * Structured as: research-papers/<paperId>/original.pdf
 */
export async function uploadPaperPdf(
  paperId: string,
  fileBuffer: Buffer | Uint8Array,
  contentType: string = "application/pdf"
): Promise<UploadResult> {
  const relativePath = `${paperId}/original.pdf`;
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

  const { data: urlData } = supabaseStorage.storage
    .from(BUCKET_NAME)
    .getPublicUrl(relativePath);

  return {
    storagePath,
    publicUrl: urlData.publicUrl,
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
 * Retrieves the public/canonical URL for a stored PDF.
 */
export function getPaperPdfUrl(storagePath: string): string {
  const relativePath = normalizeStorageRelativePath(storagePath);
  const { data } = supabaseStorage.storage
    .from(BUCKET_NAME)
    .getPublicUrl(relativePath);
  return data.publicUrl;
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
