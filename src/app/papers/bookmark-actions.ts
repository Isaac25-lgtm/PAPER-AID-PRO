"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface BookmarkActionResult {
  success: boolean;
  isBookmarked: boolean;
  error?: string;
  unauthorized?: boolean;
}

/**
 * Toggles a bookmark for a research paper.
 * Derives userId exclusively from the verified server session.
 * Never trusts client-supplied user IDs or roles.
 */
export async function toggleBookmarkAction(paperId: string): Promise<BookmarkActionResult> {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }

  if (!session?.user?.id) {
    return {
      success: false,
      isBookmarked: false,
      unauthorized: true,
      error: "You must be signed in to save papers to your library.",
    };
  }

  const userId = session.user.id;

  try {
    const existing = await prisma.bookmark.findUnique({
      where: {
        userId_paperId: {
          userId,
          paperId,
        },
      },
    });

    if (existing) {
      await prisma.bookmark.delete({
        where: { id: existing.id },
      });

      revalidatePath("/saved");
      revalidatePath(`/papers/${paperId}`);

      return {
        success: true,
        isBookmarked: false,
      };
    } else {
      await prisma.bookmark.create({
        data: {
          userId,
          paperId,
        },
      });

      revalidatePath("/saved");
      revalidatePath(`/papers/${paperId}`);

      return {
        success: true,
        isBookmarked: true,
      };
    }
  } catch (err: any) {
    console.error("Failed to toggle bookmark:", err);
    return {
      success: false,
      isBookmarked: false,
      error: err.message || "Failed to update saved paper status.",
    };
  }
}
