"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { processPaperDocument } from "@/lib/pdf/pipeline";
import { revalidatePath } from "next/cache";

export interface ReprocessResponse {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Server Action for retrying/reprocessing an ingested academic paper.
 * Strictly verifies ADMIN session.
 */
export async function reprocessPaper(paperId: string): Promise<ReprocessResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "ADMIN") {
    return { success: false, error: "Unauthorized. Admin privileges required." };
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
