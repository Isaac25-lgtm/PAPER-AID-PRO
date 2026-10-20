/**
 * AI RESEARCH HUB — PHASE 8B: MANUSCRIPT STYLE VERSION POLICY & IMMUTABILITY
 *
 * Guarantees:
 * 1. Existing manuscripts remain 100% reproducible: they retain their pinned catalog revision
 *    and do NOT silently change bibliography formatting when an upstream catalog updates.
 * 2. New manuscripts bind to the newest approved catalog revision automatically.
 * 3. Deleted upstream styles remain accessible to existing manuscripts via archived revisions.
 * 4. Provides a user-controlled action to explicitly upgrade a manuscript to the latest approved style revision.
 * 5. Supports both persisted database model columns (`ResearchDocument.cslRevisionSha`) and TipTap content metadata.
 */

import { CslCatalogManager } from "./catalog-storage";

export interface ManuscriptStyleBinding {
  styleId: string;
  revisionSha: string;
  isPinned: boolean;
}

export class ManuscriptStylePolicy {
  /**
   * Resolves the effective style ID and catalog revision for a manuscript.
   * Checks database columns (cslStyleId, cslRevisionSha) first, then content.meta.
   */
  static async resolveManuscriptStyle(docOrContent: any): Promise<ManuscriptStyleBinding> {
    const isDocRow =
      docOrContent &&
      typeof docOrContent === "object" &&
      docOrContent.content &&
      typeof docOrContent.content === "object" &&
      !Array.isArray(docOrContent.content);

    const content = isDocRow ? docOrContent.content : docOrContent;
    const meta = content?.meta || docOrContent?.meta || {};

    const styleId = docOrContent?.cslStyleId || meta.citationStyle || "apa";
    const pinnedRevision = docOrContent?.cslRevisionSha || meta.citationStyleRevision;

    if (pinnedRevision) {
      return {
        styleId,
        revisionSha: pinnedRevision,
        isPinned: true,
      };
    }

    // Existing manuscripts with null/absent revision MUST NOT silently follow future catalog updates.
    // They are anchored to the stable immutable baseline catalog revision.
    const baselineSha = "v1.0.2-baseline-catalog";
    return {
      styleId,
      revisionSha: baselineSha,
      isPinned: true,
    };
  }

  /**
   * Binds a manuscript to the currently active catalog revision.
   * Returns updated document fields and content JSON.
   */
  static async bindManuscriptToActiveRevision(docOrContent: any, styleId?: string): Promise<any> {
    const activeRev = await CslCatalogManager.getAdapter().getActiveRevision();
    const effectiveRevision = activeRev?.gitSha || "v1.0.2-baseline-catalog";

    const isDocRow =
      docOrContent &&
      typeof docOrContent === "object" &&
      docOrContent.content &&
      typeof docOrContent.content === "object" &&
      !Array.isArray(docOrContent.content);

    const effectiveStyleId =
      styleId ||
      docOrContent?.cslStyleId ||
      docOrContent?.content?.meta?.citationStyle ||
      docOrContent?.meta?.citationStyle ||
      "apa";

    if (isDocRow) {
      return {
        ...docOrContent,
        cslStyleId: effectiveStyleId,
        cslRevisionSha: effectiveRevision,
        content: {
          ...(docOrContent.content || {}),
          meta: {
            ...(docOrContent.content?.meta || {}),
            citationStyle: effectiveStyleId,
            citationStyleRevision: effectiveRevision,
          },
        },
      };
    }

    // It's a raw content JSON or TipTap doc object
    return {
      ...docOrContent,
      meta: {
        ...(docOrContent?.meta || {}),
        citationStyle: effectiveStyleId,
        citationStyleRevision: effectiveRevision,
      },
    };
  }

  /**
   * Explicitly upgrades a manuscript to the latest active catalog revision.
   * Returns updated document/content and revision comparison.
   */
  static async upgradeManuscriptToLatestRevision(docOrContent: any): Promise<{
    updatedDocumentOrContent: any;
    updatedContent: any;
    previousRevision: string | null;
    newRevision: string;
    hasRevisionChanged: boolean;
  }> {
    const activeRev = await CslCatalogManager.getAdapter().getActiveRevision();
    const newRevision = activeRev?.gitSha || "v1.0.2-baseline-catalog";

    const isDocRow =
      docOrContent &&
      typeof docOrContent === "object" &&
      docOrContent.content &&
      typeof docOrContent.content === "object" &&
      !Array.isArray(docOrContent.content);

    const content = isDocRow ? docOrContent.content : docOrContent;
    const meta = content?.meta || docOrContent?.meta || {};
    const previousRevision = docOrContent?.cslRevisionSha || meta.citationStyleRevision || null;

    const updatedContent = {
      ...content,
      meta: {
        ...(meta || {}),
        citationStyleRevision: newRevision,
      },
    };

    let updatedDocumentOrContent = updatedContent;
    if (isDocRow) {
      updatedDocumentOrContent = {
        ...docOrContent,
        cslRevisionSha: newRevision,
        content: updatedContent,
      };
    }

    return {
      updatedDocumentOrContent,
      updatedContent,
      previousRevision,
      newRevision,
      hasRevisionChanged: previousRevision !== newRevision,
    };
  }
}
