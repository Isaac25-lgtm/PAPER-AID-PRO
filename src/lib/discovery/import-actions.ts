"use server";

/**
 * Server Actions for Scholarly Discovery & Controlled Metadata Import
 *
 * Implements:
 * - Server-side external discovery search across PubMed, Crossref, Semantic Scholar
 * - Idempotent, deduplicated metadata import into PostgreSQL
 * - Author entity linking
 * - Full-text acquisition trigger for PMC / open-access papers
 */

import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import {
  NormalizedExternalPaper,
  DiscoverySearchOptions,
  DiscoverySearchResult,
  ImportPaperResult,
} from "./types";
import { ScholarlyAggregator } from "./scholarly-aggregator";
import { executePaperMetadataImport } from "./import-service";

export type { ImportPaperResult };

const aggregator = new ScholarlyAggregator();

/**
 * Executes multi-provider scholarly discovery search from the server boundary.
 * Keeps provider API keys securely server-side.
 */
export async function searchScholarlyAction(
  query: string,
  options: DiscoverySearchOptions = {}
): Promise<DiscoverySearchResult> {
  const session = await getServerSession(authOptions);
  return aggregator.search(query, {
    ...options,
    userId: session?.user?.id,
  });
}

/**
 * Server Action: Imports external paper metadata into the local library.
 * Fully idempotent: Repeated calls for the same DOI/PMID/paper return the existing record.
 *
 * Security Guarantee:
 * - User identity is derived STRICTLY from the verified NextAuth server session.
 * - No client argument, URL query parameter, or API caller can supply or override user identity.
 */
export async function importPaperMetadataAction(
  externalPaper: NormalizedExternalPaper,
  options: { attemptFullTextFetch?: boolean } = {}
): Promise<ImportPaperResult> {
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    return { success: false, error: "Authentication required to import research papers." };
  }

  if (!session?.user?.id) {
    return { success: false, error: "Authentication required to import research papers." };
  }

  return executePaperMetadataImport(externalPaper, session.user.id, {
    attemptFullTextFetch: options.attemptFullTextFetch,
  });
}
