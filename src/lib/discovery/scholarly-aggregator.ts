/**
 * Resilient Multi-Provider Scholarly Aggregator
 *
 * Coordinates concurrent queries to PubMed, Crossref, and Semantic Scholar:
 * - Provider failure isolation via Promise.allSettled
 * - Per-provider bounded timeouts
 * - Rate-limit & error telemetry
 * - Deduplication & identity resolution
 * - Local library status hydration
 * - Lightweight in-memory query caching
 */

import {
  DiscoverySearchResult,
  DiscoverySearchOptions,
  NormalizedExternalPaper,
  ProviderExecutionResult,
  ScholarlyProvider,
  SourceProvider,
} from "./types";
import { PubMedProvider } from "./providers/pubmed";
import { CrossrefProvider } from "./providers/crossref";
import { SemanticScholarProvider } from "./providers/semantic-scholar";
import { CitedEvidenceProvider } from "./providers/cited-evidence";
import { deduplicateExternalPapers } from "./deduplicate";
import { rankScholarlySearchResults } from "./ranking";
import { matchPapersAgainstLocalLibrary } from "./library-matcher";

// In-memory LRU-like cache for identical recent queries (TTL: 60s)
interface CachedResult {
  timestamp: number;
  data: DiscoverySearchResult;
}
const SEARCH_CACHE = new Map<string, CachedResult>();
const CACHE_TTL_MS = 60 * 1000;

export class ScholarlyAggregator {
  private providers: ScholarlyProvider[];

  constructor(customProviders?: ScholarlyProvider[]) {
    this.providers = customProviders || [
      new PubMedProvider(),
      new CrossrefProvider(),
      new SemanticScholarProvider(),
      new CitedEvidenceProvider(),
    ];
  }

  async search(
    query: string,
    options: DiscoverySearchOptions = {}
  ): Promise<DiscoverySearchResult> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return {
        query: "",
        papers: [],
        totalUniqueResults: 0,
        totalRawResults: 0,
        providerResults: {
          PUBMED: { provider: "PUBMED", status: "SUCCESS", count: 0, durationMs: 0 },
          CROSSREF: { provider: "CROSSREF", status: "SUCCESS", count: 0, durationMs: 0 },
          SEMANTIC_SCHOLAR: { provider: "SEMANTIC_SCHOLAR", status: "SUCCESS", count: 0, durationMs: 0 },
          CITED_EVIDENCE: { provider: "CITED_EVIDENCE", status: "SUCCESS", count: 0, durationMs: 0 },
        },
        timingMs: 0,
      };
    }

    // Cache check
    const cacheKey = `${trimmedQuery.toLowerCase()}:${options.limitPerProvider || 10}:${(
      options.enabledProviders || []
    ).join(",")}`;
    const cached = SEARCH_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      // Re-hydrate local status in case database state changed since cache
      const rehydratedPapers = await matchPapersAgainstLocalLibrary(cached.data.papers);
      return {
        ...cached.data,
        papers: rehydratedPapers,
      };
    }

    const startTime = Date.now();

    // Filter providers if specified
    const activeProviders = options.enabledProviders
      ? this.providers.filter((p) => options.enabledProviders!.includes(p.name))
      : this.providers;

    // Concurrently invoke each provider with failure isolation
    const providerPromises = activeProviders.map(async (provider) => {
      const pStart = Date.now();
      try {
        const results = await provider.search(trimmedQuery, options);
        return {
          provider: provider.name,
          status: "SUCCESS" as const,
          papers: results,
          count: results.length,
          durationMs: Date.now() - pStart,
        };
      } catch (err: any) {
        const isRateLimit =
          err?.message?.includes("429") || err?.message?.toLowerCase().includes("rate limit");
        const isTimeout =
          err?.name === "TimeoutError" || err?.message?.toLowerCase().includes("timeout");

        return {
          provider: provider.name,
          status: (isRateLimit
            ? "RATE_LIMITED"
            : isTimeout
            ? "TIMEOUT"
            : "ERROR") as ProviderExecutionResult["status"],
          papers: [] as NormalizedExternalPaper[],
          count: 0,
          error: err?.message || "Unknown provider failure",
          durationMs: Date.now() - pStart,
        };
      }
    });

    const settled = await Promise.allSettled(providerPromises);

    const rawPapers: NormalizedExternalPaper[] = [];
    const providerResults: Record<SourceProvider, ProviderExecutionResult> = {
      PUBMED: { provider: "PUBMED", status: "ERROR", count: 0, durationMs: 0 },
      CROSSREF: { provider: "CROSSREF", status: "ERROR", count: 0, durationMs: 0 },
      SEMANTIC_SCHOLAR: { provider: "SEMANTIC_SCHOLAR", status: "ERROR", count: 0, durationMs: 0 },
      CITED_EVIDENCE: { provider: "CITED_EVIDENCE", status: "ERROR", count: 0, durationMs: 0 },
    };

    for (const res of settled) {
      if (res.status === "fulfilled") {
        const val = res.value;
        providerResults[val.provider] = {
          provider: val.provider,
          status: val.status,
          count: val.count,
          error: val.error,
          durationMs: val.durationMs,
        };
        rawPapers.push(...val.papers);
      }
    }

    // Deduplicate across providers
    const { papers: deduplicatedPapers } = deduplicateExternalPapers(rawPapers);

    // Deterministic generalized relevance ranking across providers
    const rankedPapers = rankScholarlySearchResults(deduplicatedPapers, trimmedQuery);

    // Hydrate local library status
    const finalPapers = await matchPapersAgainstLocalLibrary(rankedPapers, options.userId);

    const searchResult: DiscoverySearchResult = {
      query: trimmedQuery,
      papers: finalPapers,
      totalUniqueResults: finalPapers.length,
      totalRawResults: rawPapers.length,
      providerResults,
      timingMs: Date.now() - startTime,
    };

    // Update Cache
    SEARCH_CACHE.set(cacheKey, {
      timestamp: Date.now(),
      data: searchResult,
    });

    return searchResult;
  }
}
