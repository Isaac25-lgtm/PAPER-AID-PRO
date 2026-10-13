"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  uploadUserPrivateDocument,
  deleteUserLibraryItem,
  processUserDocumentPipeline,
  getUserLibraryItems,
  UserLibraryItem,
  UserDocumentType,
} from "@/lib/library/user-library-service";
import { revalidatePath } from "next/cache";

export interface LibraryActionResponse {
  success: boolean;
  message?: string;
  paperId?: string;
  action?: string;
  error?: string;
}

/**
 * Server Action: Upload an unpublished or personal PDF to the authenticated user's library.
 * Derives user identity strictly from the verified server session.
 */
export async function uploadUserDocumentAction(
  formData: FormData
): Promise<LibraryActionResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return {
      success: false,
      error: "Authentication required. Please sign in to upload research documents.",
    };
  }

  try {
    const file = formData.get("pdfFile") as File | null;
    if (!file || file.size === 0) {
      return {
        success: false,
        error: "No PDF file provided. Please select a valid document.",
      };
    }

    const title = (formData.get("title") as string)?.trim() || "";
    const documentType = (formData.get("documentType") as string)?.trim() || "THESIS";
    const authors = (formData.get("authors") as string)?.trim() || "";
    const institution = (formData.get("institution") as string)?.trim() || "";
    const researchCategory = (formData.get("researchCategory") as string)?.trim() || "";
    const description = (formData.get("description") as string)?.trim() || "";

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    const result = await uploadUserPrivateDocument({
      userId: session.user.id,
      fileBuffer,
      filename: file.name,
      metadata: {
        title: title || undefined,
        documentType: documentType as UserDocumentType,
        authors: authors || undefined,
        institution: institution || undefined,
        researchCategory: researchCategory || undefined,
        description: description || undefined,
      },
      autoProcess: true,
    });

    revalidatePath("/library");
    revalidatePath("/saved");

    return {
      success: true,
      paperId: result.paperId,
      message: "Document uploaded and processed successfully.",
    };
  } catch (err: any) {
    console.error("[uploadUserDocumentAction] Error:", err);
    return {
      success: false,
      error: err?.message || "Failed to upload document.",
    };
  }
}

/**
 * Server Action: Remove an item from the user's research library.
 * Correctly distinguishes between removing a saved public paper bookmark
 * and completely deleting an owned private document.
 */
export async function deleteLibraryItemAction(
  paperId: string
): Promise<LibraryActionResponse> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return {
      success: false,
      error: "Authentication required.",
    };
  }

  try {
    const result = await deleteUserLibraryItem(session.user.id, paperId);
    revalidatePath("/library");
    revalidatePath("/saved");

    return {
      success: true,
      action: result.action,
      message: result.message,
    };
  } catch (err: any) {
    console.error("[deleteLibraryItemAction] Error:", err);
    return {
      success: false,
      error: err?.message || "Failed to remove item from library.",
    };
  }
}

/**
 * Server Action: Reprocess an uploaded document.
 */
export async function reprocessUserDocumentAction(
  paperId: string
): Promise<{
  success: boolean;
  chunkCount?: number;
  pageCount?: number;
  isEmbedded?: boolean;
  error?: string;
}> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return {
      success: false,
      error: "Authentication required.",
    };
  }

  try {
    const result = await processUserDocumentPipeline(paperId, session.user.id);
    revalidatePath("/library");
    revalidatePath("/saved");
    revalidatePath(`/papers/${paperId}`);

    return result;
  } catch (err: any) {
    console.error("[reprocessUserDocumentAction] Error:", err);
    return {
      success: false,
      error: err?.message || "Reprocessing failed.",
    };
  }
}

/**
 * Server Action: Fetch user library items.
 */
export async function fetchUserLibraryItemsAction(): Promise<{
  success: boolean;
  items: UserLibraryItem[];
  error?: string;
}> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return {
      success: false,
      items: [],
      error: "Authentication required.",
    };
  }

  try {
    const items = await getUserLibraryItems(session.user.id);
    return {
      success: true,
      items,
    };
  } catch (err: any) {
    console.error("[fetchUserLibraryItemsAction] Error:", err);
    return {
      success: false,
      items: [],
      error: err?.message || "Failed to load library items.",
    };
  }
}
