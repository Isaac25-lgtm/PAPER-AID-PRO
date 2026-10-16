"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  uploadUserPrivateDocument,
  attachPdfToExistingPaper,
  deleteUserLibraryItem,
  processUserDocumentPipeline,
  getUserLibraryItems,
  UserLibraryItem,
  UserDocumentType,
} from "@/lib/library/user-library-service";
import {
  getUserCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  addPaperToCollection,
  removePaperFromCollection,
  setPaperCollections,
  UserCollection,
} from "@/lib/library/collections-service";
import {
  lookupPaperByIdentifier,
  importPaperByIdentifier,
  discoverAndProcessPaperOpenAccess,
  LookupPaperMetadata,
} from "@/lib/library/identifier-lookup-service";
import {
  previewReferenceImport,
  executeReferenceImport,
  ImportPreviewSummary,
  ReferencePreviewItem,
} from "@/lib/library/citation-import-service";
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

    const targetPaperId = (formData.get("targetPaperId") as string)?.trim() || "";
    const title = (formData.get("title") as string)?.trim() || "";
    const documentType = (formData.get("documentType") as string)?.trim() || "OTHER_DOCUMENT";
    const authors = (formData.get("authors") as string)?.trim() || "";
    const institution = (formData.get("institution") as string)?.trim() || "";
    const researchCategory = (formData.get("researchCategory") as string)?.trim() || "";
    const description = (formData.get("description") as string)?.trim() || "";

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // If attaching full-text PDF to an existing saved reference:
    if (targetPaperId) {
      const attachResult = await attachPdfToExistingPaper({
        userId: session.user.id,
        paperId: targetPaperId,
        fileBuffer,
        filename: file.name,
        autoProcess: true,
      });

      revalidatePath("/library");
      revalidatePath("/saved");
      revalidatePath(`/papers/${attachResult.paperId}`);
      revalidatePath(`/papers/${targetPaperId}`);
      revalidatePath("/");

      return {
        success: true,
        paperId: attachResult.paperId,
        message: "Full-text PDF successfully attached to saved reference and processed for AI analysis.",
      };
    }

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

// ============================================================================
// PHASE 5B: COLLECTIONS SERVER ACTIONS
// ============================================================================

export async function getUserCollectionsAction(): Promise<{
  success: boolean;
  collections: UserCollection[];
  error?: string;
}> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, collections: [], error: "Authentication required." };
  }
  try {
    const collections = await getUserCollections(session.user.id);
    return { success: true, collections };
  } catch (err: any) {
    console.error("[getUserCollectionsAction] Error:", err);
    return { success: false, collections: [], error: err?.message || "Failed to load collections." };
  }
}

export async function createCollectionAction(
  name: string,
  options?: { description?: string; color?: string }
): Promise<{
  success: boolean;
  collection?: UserCollection;
  error?: string;
}> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: "Authentication required." };
  }
  try {
    const collection = await createCollection(session.user.id, name, options);
    revalidatePath("/library");
    return { success: true, collection };
  } catch (err: any) {
    console.error("[createCollectionAction] Error:", err);
    return { success: false, error: err?.message || "Failed to create collection." };
  }
}

export async function renameCollectionAction(
  oldName: string,
  newName: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: "Authentication required." };
  }
  try {
    await renameCollection(session.user.id, oldName, newName);
    revalidatePath("/library");
    return { success: true };
  } catch (err: any) {
    console.error("[renameCollectionAction] Error:", err);
    return { success: false, error: err?.message || "Failed to rename collection." };
  }
}

export async function deleteCollectionAction(
  name: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: "Authentication required." };
  }
  try {
    await deleteCollection(session.user.id, name);
    revalidatePath("/library");
    return { success: true };
  } catch (err: any) {
    console.error("[deleteCollectionAction] Error:", err);
    return { success: false, error: err?.message || "Failed to delete collection." };
  }
}

export async function addPaperToCollectionAction(
  paperId: string,
  collectionName: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: "Authentication required." };
  }
  try {
    await addPaperToCollection(session.user.id, paperId, collectionName);
    revalidatePath("/library");
    return { success: true };
  } catch (err: any) {
    console.error("[addPaperToCollectionAction] Error:", err);
    return { success: false, error: err?.message || "Failed to add paper to collection." };
  }
}

export async function removePaperFromCollectionAction(
  paperId: string,
  collectionName: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: "Authentication required." };
  }
  try {
    await removePaperFromCollection(session.user.id, paperId, collectionName);
    revalidatePath("/library");
    return { success: true };
  } catch (err: any) {
    console.error("[removePaperFromCollectionAction] Error:", err);
    return { success: false, error: err?.message || "Failed to remove paper from collection." };
  }
}

export async function setPaperCollectionsAction(
  paperId: string,
  collections: string[]
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: "Authentication required." };
  }
  try {
    await setPaperCollections(session.user.id, paperId, collections);
    revalidatePath("/library");
    return { success: true };
  } catch (err: any) {
    console.error("[setPaperCollectionsAction] Error:", err);
    return { success: false, error: err?.message || "Failed to update collections." };
  }
}

// ============================================================================
// PHASE 5B: IDENTIFIER LOOKUP SERVER ACTIONS
// ============================================================================

export async function lookupIdentifierAction(rawInput: string): Promise<{
  success: boolean;
  metadata?: LookupPaperMetadata;
  existingPaperId?: string;
  error?: string;
}> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: "Authentication required." };
  }
  try {
    return await lookupPaperByIdentifier(rawInput);
  } catch (err: any) {
    console.error("[lookupIdentifierAction] Error:", err);
    return { success: false, error: err?.message || "Failed to lookup identifier." };
  }
}

export async function importPaperByIdentifierAction(
  identifier: string,
  collectionName?: string
): Promise<{
  success: boolean;
  paperId?: string;
  isDuplicate?: boolean;
  message?: string;
  error?: string;
}> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: "Authentication required." };
  }
  try {
    const result = await importPaperByIdentifier({
      userId: session.user.id,
      identifier,
      collectionName,
    });
    revalidatePath("/library");
    revalidatePath("/saved");
    return {
      success: true,
      paperId: result.paperId,
      isDuplicate: result.isDuplicate,
      message: result.message,
    };
  } catch (err: any) {
    console.error("[importPaperByIdentifierAction] Error:", err);
    return { success: false, error: err?.message || "Failed to import paper." };
  }
}

export async function discoverPaperOpenAccessAction(paperId: string): Promise<{
  success: boolean;
  status: string;
  message: string;
  hasFullText: boolean;
  error?: string;
}> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return {
      success: false,
      status: "NO_OPEN_ACCESS_LOCATED",
      message: "Authentication required to discover open-access full text.",
      hasFullText: false,
      error: "Authentication required.",
    };
  }

  try {
    const result = await discoverAndProcessPaperOpenAccess(paperId, session.user.id);
    return result;
  } catch (err: any) {
    console.error("[discoverPaperOpenAccessAction] Error:", err);
    return {
      success: false,
      status: "IMPORT_FAILED",
      message: err?.message || "Open-access discovery failed.",
      hasFullText: false,
      error: err?.message,
    };
  }
}

// ============================================================================
// PHASE 5B: CITATION IMPORT (BIBTEX / RIS) SERVER ACTIONS
// ============================================================================

export async function previewReferenceImportAction(rawContent: string): Promise<{
  success: boolean;
  summary?: ImportPreviewSummary;
  error?: string;
}> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: "Authentication required." };
  }
  try {
    const summary = await previewReferenceImport(session.user.id, rawContent);
    return { success: true, summary };
  } catch (err: any) {
    console.error("[previewReferenceImportAction] Error:", err);
    return { success: false, error: err?.message || "Failed to preview references." };
  }
}

export async function executeReferenceImportAction(params: {
  items: ReferencePreviewItem[];
  collectionName?: string;
  importDuplicates?: boolean;
}): Promise<{
  success: boolean;
  importedCount?: number;
  skippedCount?: number;
  error?: string;
}> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { success: false, error: "Authentication required." };
  }
  try {
    const result = await executeReferenceImport({
      userId: session.user.id,
      items: params.items,
      collectionName: params.collectionName,
      importDuplicates: params.importDuplicates,
    });
    revalidatePath("/library");
    revalidatePath("/saved");
    return {
      success: true,
      importedCount: result.importedCount,
      skippedCount: result.skippedCount,
    };
  } catch (err: any) {
    console.error("[executeReferenceImportAction] Error:", err);
    return { success: false, error: err?.message || "Failed to import references." };
  }
}
