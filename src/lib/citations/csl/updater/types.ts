/**
 * AI RESEARCH HUB — PHASE 8B: CSL CATALOG UPDATE & VERSIONING TYPES
 */

import { CslCitationFormat, CslStyleMetadata } from "../types";

export type CatalogRevisionStatus =
  | "ACTIVE"
  | "PREVIOUS"
  | "STAGED"
  | "FAILED"
  | "ROLLED_BACK";

export interface CslCatalogRevision {
  id: string; // Revision ID or SHA
  gitSha: string; // Upstream Git commit SHA
  branch: string; // Upstream Git branch (e.g. "v1.0.2")
  status: CatalogRevisionStatus;
  totalStyles: number;
  independentCount: number;
  dependentCount: number;
  newStylesCount: number;
  updatedStylesCount: number;
  deletedStylesCount: number;
  validationErrors: Array<{ styleId: string; error: string }>;
  createdAt: string; // ISO date
  activatedAt?: string | null; // ISO date
}

export interface CslStyleRecord {
  styleId: string;
  revisionSha: string;
  title: string;
  isDependent: boolean;
  parentId?: string;
  format: CslCitationFormat;
  checksum: string; // SHA-256 of XML content
  xml?: string;
  sourceUrl: string;
  updatedAt: string; // ISO date
}

export interface UpstreamGitCommit {
  sha: string;
  date: string;
  message: string;
  branch: string;
  etag?: string;
}

export interface UpstreamTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
  styleId: string;
  isDependent: boolean;
}

export interface CatalogDiff {
  upstreamSha: string;
  activeSha: string | null;
  hasChanges: boolean;
  added: UpstreamTreeEntry[];
  modified: UpstreamTreeEntry[];
  removed: string[]; // styleIds
  unchangedCount: number;
}

export interface StyleValidationResult {
  valid: boolean;
  styleId: string;
  title?: string;
  format?: CslCitationFormat;
  isDependent?: boolean;
  parentId?: string;
  checksum?: string;
  errors: string[];
}

export interface SyncOutcome {
  success: boolean;
  status: "SKIPPED_NO_CHANGES" | "ACTIVATED" | "VALIDATION_FAILED" | "DRY_RUN_COMPLETED" | "ERROR";
  activeSha: string;
  upstreamSha?: string;
  inspectedCount: number;
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
  validationErrors: Array<{ styleId: string; error: string }>;
  durationMs: number;
  message: string;
}
