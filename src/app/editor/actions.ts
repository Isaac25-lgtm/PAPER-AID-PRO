"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { DocumentType } from "@prisma/client";
import {
  createResearchDocument,
  getResearchDocument,
  listResearchDocuments,
  updateResearchDocument,
  renameResearchDocument,
  deleteResearchDocument,
  attachDocumentPaper,
  detachDocumentPaper,
  insertDocumentCitation,
  deleteDocumentCitation,
  exportResearchDocument,
  ManuscriptExportFormat,
  InsertCitationInput,
  UpdateDocumentInput,
  CreateDocumentInput,
} from "@/lib/editor/document-service";
import { toPlainTipTapJson } from "@/lib/editor/content-sanitizer";
import {
  generateInlineAutocomplete,
  rewriteSelectedText,
  summarizeEvidenceForEditor,
  RewriteMode,
  AutocompleteParams,
} from "@/lib/editor/ai-editor-service";
import { getUserLibraryItems } from "@/lib/library/user-library-service";

/**
 * Ensures authenticated session and returns user ID.
 */
async function requireAuthUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error("Authentication required. Please sign in to access your research documents.");
  }
  return session.user.id;
}

export async function createDocumentAction(data?: CreateDocumentInput) {
  try {
    const userId = await requireAuthUserId();
    const doc = await createResearchDocument(userId, data);
    revalidatePath("/editor");
    return { success: true, document: doc };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to create document." };
  }
}

export async function getDocumentAction(documentId: string) {
  try {
    const userId = await requireAuthUserId();
    const doc = await getResearchDocument(userId, documentId);
    return { success: true, document: doc };
  } catch (err: any) {
    return { success: false, error: err.message || "Document not found or inaccessible." };
  }
}

export async function listDocumentsAction() {
  try {
    const userId = await requireAuthUserId();
    const docs = await listResearchDocuments(userId);
    return { success: true, documents: docs };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to list documents." };
  }
}

export async function saveDocumentAction(
  documentId: string,
  updates: UpdateDocumentInput
) {
  try {
    const userId = await requireAuthUserId();
    const sanitizedUpdates: UpdateDocumentInput = {
      ...updates,
      content: updates.content ? toPlainTipTapJson(updates.content) : undefined,
    };
    const updated = await updateResearchDocument(userId, documentId, sanitizedUpdates);
    return {
      success: true,
      document: {
        id: updated.id,
        title: updated.title,
        version: updated.version,
        updatedAt: updated.updatedAt.toISOString(),
      },
      version: updated.version,
      updatedAt: updated.updatedAt.toISOString(),
    };
  } catch (err: any) {
    const isConflict = err.message?.includes("CONCURRENT_SAVE_CONFLICT");
    return {
      success: false,
      isConflict: Boolean(isConflict),
      error: err.message || "Failed to save document changes.",
    };
  }
}

export async function renameDocumentAction(
  documentId: string,
  newTitle: string
) {
  try {
    const userId = await requireAuthUserId();
    const updated = await renameResearchDocument(userId, documentId, newTitle);
    revalidatePath("/editor");
    revalidatePath(`/editor/${documentId}`);
    return { success: true, document: updated };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to rename document." };
  }
}

export async function deleteDocumentAction(documentId: string) {
  try {
    const userId = await requireAuthUserId();
    await deleteResearchDocument(userId, documentId);
    revalidatePath("/editor");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to delete document." };
  }
}

export async function getUserLibrarySourcesAction() {
  try {
    const userId = await requireAuthUserId();
    const items = await getUserLibraryItems(userId);
    return { success: true, items };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to load library items." };
  }
}

export async function attachSourcePaperAction(
  documentId: string,
  paperId: string
) {
  try {
    const userId = await requireAuthUserId();
    const attached = await attachDocumentPaper(userId, documentId, paperId);
    revalidatePath(`/editor/${documentId}`);
    return { success: true, attached };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to attach paper." };
  }
}

export async function detachSourcePaperAction(
  documentId: string,
  paperId: string
) {
  try {
    const userId = await requireAuthUserId();
    await detachDocumentPaper(userId, documentId, paperId);
    revalidatePath(`/editor/${documentId}`);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to detach paper." };
  }
}

export async function insertCitationAction(
  documentId: string,
  citationData: InsertCitationInput
) {
  try {
    const userId = await requireAuthUserId();
    const citation = await insertDocumentCitation(userId, documentId, citationData);
    revalidatePath(`/editor/${documentId}`);
    return { success: true, citation };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to insert citation." };
  }
}

export async function deleteCitationAction(
  documentId: string,
  citationId: string
) {
  try {
    const userId = await requireAuthUserId();
    await deleteDocumentCitation(userId, documentId, citationId);
    revalidatePath(`/editor/${documentId}`);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to delete citation." };
  }
}

export type AutocompleteActionResult =
  | {
      success: true;
      suggestion: string;
      outcome?: "SUCCESS" | "INTENTIONAL_ABSTENTION" | "TOKEN_LIMIT_REACHED" | "MISSING_CONTEXT";
      provider: string;
      model: string;
      cost: any;
      metrics: any;
    }
  | {
      success: false;
      error: string;
      outcome?: "PROVIDER_ERROR" | "MISSING_CONTEXT";
      suggestion?: undefined;
      provider?: undefined;
      model?: undefined;
      cost?: undefined;
      metrics?: undefined;
    };

export type RewriteActionResult =
  | {
      success: true;
      replacementText: string;
      originalText: string;
      mode: RewriteMode;
      provider: string;
      model: string;
      cost: any;
      metrics: any;
    }
  | {
      success: false;
      error: string;
      replacementText?: undefined;
      originalText?: undefined;
      mode?: undefined;
      provider?: undefined;
      model?: undefined;
      cost?: undefined;
      metrics?: undefined;
    };

export type SummarizeEvidenceActionResult =
  | {
      success: true;
      synthesizedText: string;
      citationText: string;
      paperId: string;
      paperTitle: string;
      chunkId?: string;
      pageNumber?: number | null;
      section?: string | null;
      provider: string;
      model: string;
      cost: any;
    }
  | {
      success: false;
      error: string;
      synthesizedText?: undefined;
      citationText?: undefined;
      paperId?: undefined;
      paperTitle?: undefined;
      chunkId?: undefined;
      pageNumber?: undefined;
      section?: undefined;
      provider?: undefined;
      model?: undefined;
      cost?: undefined;
    };

export async function generateAutocompleteAction(
  params: AutocompleteParams
): Promise<AutocompleteActionResult> {
  try {
    const userId = await requireAuthUserId();
    const result = await generateInlineAutocomplete(userId, params);
    return { success: true, ...result };
  } catch (err: any) {
    return { success: false, error: err.message || "Autocomplete generation failed." };
  }
}

export async function rewriteTextAction(params: {
  documentId: string;
  selectedText: string;
  mode: RewriteMode;
  surroundingContext?: string;
}): Promise<RewriteActionResult> {
  try {
    const userId = await requireAuthUserId();
    const result = await rewriteSelectedText(userId, params);
    return { success: true, ...result };
  } catch (err: any) {
    return { success: false, error: err.message || "Rewrite generation failed." };
  }
}

export async function summarizeEvidenceAction(params: {
  documentId: string;
  paperId: string;
  userPrompt?: string;
}): Promise<SummarizeEvidenceActionResult> {
  try {
    const userId = await requireAuthUserId();
    const result = await summarizeEvidenceForEditor(userId, params);
    return { success: true, ...result };
  } catch (err: any) {
    return { success: false, error: err.message || "Evidence summarization failed." };
  }
}

export async function exportDocumentAction(
  documentId: string,
  format: ManuscriptExportFormat = "markdown"
) {
  try {
    const userId = await requireAuthUserId();
    const result = await exportResearchDocument(userId, documentId, format);
    return { success: true, export: result };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to export document." };
  }
}

