"use server";

import { verifyAdminSession } from "@/lib/auth/admin-guard";
import { processPaperDocument } from "@/lib/pdf/pipeline";
import { revalidatePath } from "next/cache";

export interface ReprocessResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Server Action for retrying/reprocessing an ingested academic paper.
 * Strictly verifies ADMIN role via authoritative database re-check.
 */
export async function reprocessPaper(paperId: string): Promise<ReprocessResponse> {
  const auth = await verifyAdminSession();

  if (!auth.authorized) {
    return { success: false, error: auth.error || "Unauthorized. Admin privileges required." };
  }

  try {
    const result = await processPaperDocument(paperId, { forceReprocess: true });

    revalidatePath("/admin/processing");
    revalidatePath("/admin/papers");
    revalidatePath(`/papers/${paperId}`);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Processing failed during ingestion pipeline.",
      };
    }

    return {
      success: true,
      message: `Document processed successfully: ${result.chunkCount} chunks generated across ${result.pageCount} pages.`,
    };
  } catch (err: any) {
    console.error("Failed to reprocess paper:", err);
    return {
      success: false,
      error: err.message || "An unexpected error occurred during reprocessing.",
    };
  }
}
