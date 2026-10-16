"use server";

/**
 * Server Action: AI Research Snapshot
 *
 * Secure server boundary action allowing client discovery interfaces
 * to request an evidence-grounded research snapshot with rate limiting,
 * caching, and zero private-data contamination.
 */

import { NormalizedExternalPaper } from "../types";
import { ResearchSnapshot, SnapshotRequestOptions } from "./types";
import { generateResearchSnapshot } from "./snapshot-service";
import { headers } from "next/headers";
import { ADMIN_TEST_FIXTURE_IDS } from "@/lib/auth/paper-authorization";

export interface SnapshotActionResult {
  success: boolean;
  snapshot?: ResearchSnapshot;
  error?: string;
  isRateLimited?: boolean;
  retryAfterMs?: number;
}

export async function getResearchSnapshotAction(
  query: string,
  papers: NormalizedExternalPaper[],
  options: SnapshotRequestOptions = {}
): Promise<SnapshotActionResult> {
  const cleanQuery = query?.trim() || "";
  if (!cleanQuery || cleanQuery.length < 2) {
    return {
      success: false,
      error: "Search query must contain at least 2 characters.",
    };
  }

  if (cleanQuery.length > 500) {
    return {
      success: false,
      error: "Search query exceeds maximum length of 500 characters.",
    };
  }

  // Derive client IP for rate limiting
  let clientIp = "anonymous";
  try {
    const headersList = headers();
    clientIp =
      headersList.get("x-forwarded-for")?.split(",")[0].trim() ||
      headersList.get("x-real-ip") ||
      "anonymous";
  } catch {
    clientIp = "anonymous";
  }

  // Security Filter: Strictly filter out any potential private uploads or system fixtures
  const safePublicPapers = (papers || []).filter((p) => {
    if (!p || !p.id) return false;
    if (ADMIN_TEST_FIXTURE_IDS.has(p.id)) return false;
    // Omit any paper tagged as private in local status
    if (p.localStatus?.inLibrary && (p as any).isPrivate) return false;
    return true;
  });

  try {
    const snapshot = await generateResearchSnapshot(cleanQuery, safePublicPapers, {
      ...options,
      clientId: clientIp,
    });

    return {
      success: true,
      snapshot,
    };
  } catch (err: any) {
    const msg = err?.message || "Failed to generate research snapshot.";
    const isRateLimited = msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("please wait");

    return {
      success: false,
      error: msg,
      isRateLimited,
    };
  }
}
