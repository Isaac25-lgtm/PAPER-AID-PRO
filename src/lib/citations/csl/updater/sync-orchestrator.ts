/**
 * AI RESEARCH HUB — PHASE 8B: CSL SYNCHRONIZATION ORCHESTRATOR
 *
 * Coordinates:
 * 1. Upstream revision checking (commits, rate limits, conditional requests).
 * 2. Tree diffing (detects added, modified, deleted styles without downloading the entire catalog).
 * 3. XML download, XXE sanitization, CSL schema validation, and citeproc compilation.
 * 4. Dependent style parent resolution.
 * 5. Atomic snapshot activation (failed updates NEVER replace the active catalog).
 * 6. Dry-run preview mode.
 */

import { CslGitHubClient } from "./github-client";
import { CslStyleValidator } from "./style-validator";
import { CslCatalogManager } from "./catalog-storage";
import { CslCatalogRevision, CslStyleRecord, SyncOutcome } from "./types";
import { CslCitationFormat } from "../types";

export interface SyncOptions {
  branch?: string;
  dryRun?: boolean;
  forceCheck?: boolean;
  maxStylesToValidate?: number;
  githubClient?: CslGitHubClient;
}

export class CslSyncOrchestrator {
  /**
   * Executes a catalog synchronization check.
   */
  static async executeSync(options: SyncOptions = {}): Promise<SyncOutcome> {
    const startTime = Date.now();
    const dryRun = Boolean(options.dryRun);
    const maxValidate = options.maxStylesToValidate || 50;
    const workerId = `sync-worker-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const adapter = CslCatalogManager.getAdapter();

    // Acquire lock if supported
    if (adapter.acquireLock && !dryRun) {
      const locked = await adapter.acquireLock(workerId);
      if (!locked) {
        return {
          success: false,
          status: "ERROR",
          activeSha: (await adapter.getActiveRevision())?.gitSha || "v1.0.2-baseline-catalog",
          upstreamSha: (await adapter.getActiveRevision())?.gitSha || "v1.0.2-baseline-catalog",
          inspectedCount: 0,
          addedCount: 0,
          modifiedCount: 0,
          removedCount: 0,
          validationErrors: [{ styleId: "sync-lock", error: "Database lock held by another worker" }],
          durationMs: Date.now() - startTime,
          message: "Synchronization skipped: database lock is currently held by another worker.",
        };
      }
    }

    try {
      return await this.executeSyncInternal(options, startTime, workerId);
    } finally {
      if (adapter.releaseLock && !dryRun) {
        await adapter.releaseLock(workerId);
      }
    }
  }

  private static async executeSyncInternal(
    options: SyncOptions,
    startTime: number,
    workerId: string
  ): Promise<SyncOutcome> {
    const dryRun = Boolean(options.dryRun);
    const maxValidate = options.maxStylesToValidate || 50;

    // 1. Ensure baseline catalog exists
    const activeRevision = await CslCatalogManager.initializeBaselineCatalog();
    const activeSha = activeRevision.gitSha;

    const client = options.githubClient || new CslGitHubClient({ branch: options.branch });

    // 2. Query upstream Git commit with ETag conditional checking
    let commitCheck;
    try {
      commitCheck = await client.checkLatestCommit();
    } catch (err: any) {
      return {
        success: false,
        status: "ERROR",
        activeSha,
        inspectedCount: 0,
        addedCount: 0,
        modifiedCount: 0,
        removedCount: 0,
        validationErrors: [{ styleId: "upstream-git", error: err.message }],
        durationMs: Date.now() - startTime,
        message: `Failed to query upstream CSL repository: ${err.message}`,
      };
    }

    if (!commitCheck.changed || !commitCheck.commit) {
      return {
        success: true,
        status: "SKIPPED_NO_CHANGES",
        activeSha,
        upstreamSha: activeSha,
        inspectedCount: 0,
        addedCount: 0,
        modifiedCount: 0,
        removedCount: 0,
        validationErrors: [],
        durationMs: Date.now() - startTime,
        message: "Upstream CSL repository is up to date (ETag matched, no changes).",
      };
    }

    const upstreamSha = commitCheck.commit.sha;
    if (upstreamSha === activeSha && !options.forceCheck) {
      return {
        success: true,
        status: "SKIPPED_NO_CHANGES",
        activeSha,
        upstreamSha,
        inspectedCount: 0,
        addedCount: 0,
        modifiedCount: 0,
        removedCount: 0,
        validationErrors: [],
        durationMs: Date.now() - startTime,
        message: `Active catalog revision (${activeSha.slice(0, 7)}) matches upstream commit (${upstreamSha.slice(0, 7)}).`,
      };
    }

    // 3. Diff Git Trees
    let upstreamTree;
    try {
      upstreamTree = await client.fetchStyleTree(upstreamSha);
    } catch (err: any) {
      return {
        success: false,
        status: "ERROR",
        activeSha,
        upstreamSha,
        inspectedCount: 0,
        addedCount: 0,
        modifiedCount: 0,
        removedCount: 0,
        validationErrors: [{ styleId: "upstream-tree", error: err.message }],
        durationMs: Date.now() - startTime,
        message: `Failed to fetch upstream Git tree: ${err.message}`,
      };
    }

    // Map existing styles from active revision
    const existingStyles = await CslCatalogManager.getAdapter().getStylesForRevision(activeSha);
    const activeTreeMap = new Map<string, { sha: string; path: string }>();
    const catalogIds = new Set<string>();

    for (const s of existingStyles) {
      activeTreeMap.set(s.styleId, { sha: s.checksum, path: `${s.styleId}.csl` });
      catalogIds.add(s.styleId);
    }

    // Also add all upstream IDs so parent resolution knows they exist
    for (const [id] of Array.from(upstreamTree.entries())) {
      catalogIds.add(id);
    }

    const diff = client.diffTrees(activeTreeMap, upstreamTree, upstreamSha, activeSha);

    if (!diff.hasChanges) {
      return {
        success: true,
        status: "SKIPPED_NO_CHANGES",
        activeSha,
        upstreamSha,
        inspectedCount: upstreamTree.size,
        addedCount: 0,
        modifiedCount: 0,
        removedCount: 0,
        validationErrors: [],
        durationMs: Date.now() - startTime,
        message: "No style additions, modifications or deletions detected in upstream tree.",
      };
    }

    // 4. Download and Validate Changed Styles
    const validationErrors: Array<{ styleId: string; error: string }> = [];
    const validatedStyles: CslStyleRecord[] = [];
    const candidateEntries = [...diff.added, ...diff.modified].slice(0, maxValidate);

    // Staged XML cache for parent resolution
    const stagedXmls = new Map<string, string>();

    for (const entry of candidateEntries) {
      try {
        const rawXml = await client.fetchStyleXml(upstreamSha, entry.path);
        stagedXmls.set(entry.styleId, rawXml);

        const val = CslStyleValidator.validateStyle(
          entry.styleId,
          rawXml,
          (parentId) => stagedXmls.get(parentId),
          catalogIds
        );

        if (!val.valid) {
          validationErrors.push({
            styleId: entry.styleId,
            error: val.errors.join("; "),
          });
        } else {
          validatedStyles.push({
            styleId: entry.styleId,
            revisionSha: upstreamSha,
            title: val.title || entry.styleId,
            isDependent: Boolean(val.isDependent),
            parentId: val.parentId,
            format: (val.format || "numeric") as CslCitationFormat,
            checksum: val.checksum || entry.sha,
            xml: rawXml,
            sourceUrl: `https://raw.githubusercontent.com/citation-style-language/styles/${upstreamSha}/${entry.path}`,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch (err: any) {
        validationErrors.push({
          styleId: entry.styleId,
          error: `Download/processing error: ${err.message}`,
        });
      }
    }

    // 5. Run Core Style Regression Smoke Tests
    const regCheck = CslStyleValidator.runCoreStyleRegressions();
    if (!regCheck.passed) {
      for (const fail of regCheck.failures) {
        validationErrors.push({ styleId: "core-regression", error: fail });
      }
    }

    // 6. Handle Validation Outcome (All-or-Nothing Rule)
    if (validationErrors.length > 0) {
      // Record failed revision for admin inspection without activating
      const failedRevision: CslCatalogRevision = {
        id: `rev-${upstreamSha.slice(0, 8)}-failed`,
        gitSha: upstreamSha,
        branch: options.branch || "v1.0.2",
        status: "FAILED",
        totalStyles: upstreamTree.size,
        independentCount: Array.from(upstreamTree.values()).filter((e) => !e.isDependent).length,
        dependentCount: Array.from(upstreamTree.values()).filter((e) => e.isDependent).length,
        newStylesCount: diff.added.length,
        updatedStylesCount: diff.modified.length,
        deletedStylesCount: diff.removed.length,
        validationErrors,
        createdAt: new Date().toISOString(),
        activatedAt: null,
      };

      await CslCatalogManager.getAdapter().saveRevision(failedRevision);

      return {
        success: false,
        status: "VALIDATION_FAILED",
        activeSha,
        upstreamSha,
        inspectedCount: candidateEntries.length,
        addedCount: diff.added.length,
        modifiedCount: diff.modified.length,
        removedCount: diff.removed.length,
        validationErrors,
        durationMs: Date.now() - startTime,
        message: `Validation failed for ${validationErrors.length} style(s). Active catalog preserved without change.`,
      };
    }

    // 7. Dry-Run Check
    if (dryRun) {
      return {
        success: true,
        status: "DRY_RUN_COMPLETED",
        activeSha,
        upstreamSha,
        inspectedCount: candidateEntries.length,
        addedCount: diff.added.length,
        modifiedCount: diff.modified.length,
        removedCount: diff.removed.length,
        validationErrors: [],
        durationMs: Date.now() - startTime,
        message: `Dry-run completed successfully. ${diff.added.length} new, ${diff.modified.length} updated, and ${diff.removed.length} removed styles ready for activation.`,
      };
    }

    // 8. Atomic Activation
    const newRevision: CslCatalogRevision = {
      id: `rev-${upstreamSha.slice(0, 8)}`,
      gitSha: upstreamSha,
      branch: options.branch || "v1.0.2",
      status: "ACTIVE",
      totalStyles: upstreamTree.size,
      independentCount: Array.from(upstreamTree.values()).filter((e) => !e.isDependent).length,
      dependentCount: Array.from(upstreamTree.values()).filter((e) => e.isDependent).length,
      newStylesCount: diff.added.length,
      updatedStylesCount: diff.modified.length,
      deletedStylesCount: diff.removed.length,
      validationErrors: [],
      createdAt: new Date().toISOString(),
      activatedAt: new Date().toISOString(),
    };

    await CslCatalogManager.stageRevision(newRevision, validatedStyles);
    await CslCatalogManager.activateRevision(upstreamSha, workerId);

    return {
      success: true,
      status: "ACTIVATED",
      activeSha: upstreamSha,
      upstreamSha,
      inspectedCount: candidateEntries.length,
      addedCount: diff.added.length,
      modifiedCount: diff.modified.length,
      removedCount: diff.removed.length,
      validationErrors: [],
      durationMs: Date.now() - startTime,
      message: `Successfully synchronized and activated CSL revision '${upstreamSha.slice(0, 7)}'.`,
    };
  }
}
