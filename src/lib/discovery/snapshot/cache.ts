/**
 * In-Memory Query & Evidence Cache for AI Research Snapshot
 *
 * Prevents redundant AI generation calls on identical queries and filters.
 * Default TTL: 5 minutes (300,000 ms).
 * Bounded capacity (max 500 entries) with LRU eviction.
 */

import { ResearchSnapshot } from "./types";

interface CacheEntry {
  snapshot: ResearchSnapshot;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 500;

class SnapshotCache {
  private cache = new Map<string, CacheEntry>();

  public get(key: string): ResearchSnapshot | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return {
      ...entry.snapshot,
      cached: true,
    };
  }

  public set(key: string, snapshot: ResearchSnapshot, ttlMs: number = CACHE_TTL_MS): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      // Evict oldest 50 entries
      const keysToDelete = Array.from(this.cache.keys()).slice(0, 50);
      for (const k of keysToDelete) {
        this.cache.delete(k);
      }
    }

    this.cache.set(key, {
      snapshot: { ...snapshot, cached: false },
      expiresAt: Date.now() + ttlMs,
    });
  }

  public clear(): void {
    this.cache.clear();
  }

  public size(): number {
    return this.cache.size;
  }
}

export const snapshotCache = new SnapshotCache();

export function buildSnapshotCacheKey(
  query: string,
  paperIds: string[],
  evidenceMode: string = "ABSTRACT_EVIDENCE"
): string {
  const normQuery = query.trim().toLowerCase();
  const sortedIds = [...paperIds].slice(0, 8).sort().join(",");
  return `${normQuery}::${evidenceMode}::${sortedIds}`;
}
