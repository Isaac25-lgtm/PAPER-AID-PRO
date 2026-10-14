/**
 * CitedEvidence Scholar Client
 *
 * Provides authenticated access to:
 * 1. Scholar Metadata API (/v1/oa/works)
 * 2. CEDOA Files API (/v1/research-corpus/...)
 * 3. Research MCP & Approved Read-Only Tools (/api/v1/research/tools/...)
 *
 * Configured via canonical CITEDEVIDENCE_API_KEY in .env.
 * Protected by CitedEvidenceSafeguards (rate limiting, bounded concurrency,
 * exponential backoff, circuit breaker, and LRU caching).
 */

import {
  OpenAlexWork,
  OpenAlexListResponse,
  ResearchToolInfo,
  ResearchToolCallResponse,
  SmartSearchResponse,
} from "./types";
import { citedEvidenceSafeguards } from "./safeguards";

export class CitedEvidenceClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = (
      apiKey ||
      process.env.CITEDEVIDENCE_API_KEY ||
      process.env.CE_API_KEY ||
      ""
    ).trim();
    this.baseUrl = (
      baseUrl ||
      process.env.CITEDEVIDENCE_BASE_URL ||
      "https://scholar.citedevidence.com"
    ).replace(/\/$/, "");
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": "AIResearchHub/1.0 (academic-intelligence-platform)",
      Accept: "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  /**
   * Reconstructs human-readable abstract text from OpenAlex abstract_inverted_index.
   */
  public static reconstructAbstract(
    invertedIndex?: Record<string, number[]> | null
  ): string | null {
    if (!invertedIndex || typeof invertedIndex !== "object") return null;
    const words: [number, string][] = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
      if (!Array.isArray(positions)) continue;
      for (const pos of positions) {
        words.push([pos, word]);
      }
    }
    if (words.length === 0) return null;
    words.sort((a, b) => a[0] - b[0]);
    return words.map((w) => w[1]).join(" ");
  }

  /**
   * Search academic literature using OpenAlex Scholar Metadata endpoint (/v1/oa/works).
   * Guarded by rate limiting, concurrency semaphore, and 5-min caching.
   */
  async searchWorks(
    query: string,
    options: { perPage?: number; page?: number; timeoutMs?: number; userId?: string } = {}
  ): Promise<OpenAlexListResponse<OpenAlexWork>> {
    const perPage = options.perPage || 10;
    const page = options.page || 1;
    const timeoutMs = options.timeoutMs || 10000;
    const cacheKey = `oa_works:${query.trim().toLowerCase()}:${perPage}:${page}`;

    return citedEvidenceSafeguards.executeGuarded<OpenAlexListResponse<OpenAlexWork>>(
      "metadata",
      async () => {
        const url = `${this.baseUrl}/v1/oa/works?search=${encodeURIComponent(
          query
        )}&per_page=${perPage}&page=${page}`;

        const res = await fetch(url, {
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          if (res.status === 401) {
            throw new Error("CitedEvidence authentication failed (HTTP 401). Check API key.");
          }
          if (res.status === 429) {
            const retryHeader = res.headers.get("retry-after");
            const parsedSec = retryHeader ? parseInt(retryHeader, 10) : NaN;
            const retryAfter = !isNaN(parsedSec) && parsedSec > 0 ? parsedSec : 60;
            const err = new Error(`CitedEvidence rate limit exceeded (HTTP 429). Retry in ${retryAfter}s.`);
            (err as any).status = 429;
            (err as any).retryAfterSeconds = retryAfter;
            throw err;
          }
          if (res.status >= 500) {
            const err = new Error(`CitedEvidence upstream error: HTTP ${res.status}`);
            (err as any).status = res.status;
            throw err;
          }
          throw new Error(`CitedEvidence Scholar search failed: HTTP ${res.status}`);
        }

        return (await res.json()) as OpenAlexListResponse<OpenAlexWork>;
      },
      { userId: options.userId, cacheKey }
    );
  }

  /**
   * Retrieve a single work by OpenAlex ID or DOI.
   */
  async getWork(
    idOrDoi: string,
    timeoutMs: number = 8000
  ): Promise<OpenAlexWork | null> {
    const cleanId = idOrDoi.replace(/^https:\/\/openalex\.org\//, "");
    const cacheKey = `oa_work_single:${cleanId.toLowerCase()}`;

    return citedEvidenceSafeguards.executeGuarded<OpenAlexWork | null>(
      "metadata",
      async () => {
        const url = `${this.baseUrl}/v1/oa/works/${encodeURIComponent(cleanId)}`;

        const res = await fetch(url, {
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (res.status === 404) return null;
        if (!res.ok) {
          if (res.status === 429 || res.status >= 500) {
            const err = new Error(`CitedEvidence work lookup failed: HTTP ${res.status}`);
            (err as any).status = res.status;
            throw err;
          }
          throw new Error(`CitedEvidence work lookup failed: HTTP ${res.status}`);
        }

        return (await res.json()) as OpenAlexWork;
      },
      { cacheKey }
    );
  }

  /**
   * Execute an approved CitedEvidence research tool (/api/v1/research/tools/:toolName).
   * Guarded by per-user limits, concurrency semaphore, circuit breaker, and retry backoff.
   */
  async executeTool<T = any>(
    toolName: string,
    args: Record<string, unknown> = {},
    options: { timeoutMs?: number; userId?: string } = {}
  ): Promise<ResearchToolCallResponse<T>> {
    const timeoutMs = options.timeoutMs || 30000;
    const cacheKey = `ce_tool:${toolName}:${JSON.stringify(args)}`;

    return citedEvidenceSafeguards.executeGuarded<ResearchToolCallResponse<T>>(
      "tool",
      async () => {
        const url = `${this.baseUrl}/api/v1/research/tools/${encodeURIComponent(toolName)}`;

        const res = await fetch(url, {
          method: "POST",
          headers: {
            ...this.getHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          if (res.status === 401) {
            throw new Error("CitedEvidence tool authentication failed (HTTP 401).");
          }
          if (res.status === 429) {
            const retryHeader = res.headers.get("retry-after");
            const parsedSec = retryHeader ? parseInt(retryHeader, 10) : NaN;
            const retryAfter = !isNaN(parsedSec) && parsedSec > 0 ? parsedSec : 60;
            const err = new Error(`CitedEvidence tool rate limit reached (HTTP 429). Retry in ${retryAfter}s.`);
            (err as any).status = 429;
            (err as any).retryAfterSeconds = retryAfter;
            throw err;
          }
          if (res.status >= 500) {
            const err = new Error(`CitedEvidence tool upstream error: HTTP ${res.status}`);
            (err as any).status = res.status;
            throw err;
          }
          throw new Error(`CitedEvidence tool "${toolName}" failed: HTTP ${res.status}`);
        }

        return (await res.json()) as ResearchToolCallResponse<T>;
      },
      { userId: options.userId, cacheKey }
    );
  }

  /**
   * List all available research tools and their schemas.
   */
  async listTools(timeoutMs: number = 10000): Promise<ResearchToolInfo[]> {
    const cacheKey = "ce_tools_catalog";

    return citedEvidenceSafeguards.executeGuarded<ResearchToolInfo[]>(
      "tool",
      async () => {
        const url = `${this.baseUrl}/api/v1/research/tools`;
        const res = await fetch(url, {
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          throw new Error(`Failed to list CitedEvidence tools: HTTP ${res.status}`);
        }

        const data = await res.json();
        return data.tools || [];
      },
      { cacheKey }
    );
  }

  /**
   * Run smart_search tool for multi-source academic discovery across Scholar, CEDOA, S2, and Crossref.
   */
  async smartSearch(
    query: string,
    options: { numResults?: number; sources?: string[]; userId?: string } = {}
  ): Promise<SmartSearchResponse> {
    const response = await this.executeTool<SmartSearchResponse>(
      "smart_search",
      {
        query,
        num_results: options.numResults || 10,
        sources: options.sources,
      },
      { userId: options.userId }
    );

    if (response.isError) {
      throw new Error("CitedEvidence smart_search returned an error.");
    }

    if (response.structuredContent?.result) {
      return response.structuredContent.result;
    }

    const textChunk = response.content?.find((c) => c.type === "text")?.text;
    if (textChunk) {
      try {
        return JSON.parse(textChunk);
      } catch {
        // Fallback
      }
    }

    return { results: [] };
  }

  /**
   * Validate citations and identifiers (DOIs, PMIDs) against verifiable sources.
   */
  async validateCitations(
    identifiers: string[],
    options: { userId?: string } = {}
  ): Promise<{ valid: string[]; invalid: string[]; results: Record<string, unknown> }> {
    const res = await this.executeTool("validate_citations", { identifiers }, options);
    const text = res.content?.find((c) => c.type === "text")?.text;
    if (text) {
      try {
        return JSON.parse(text);
      } catch {
        // Fallback
      }
    }
    return res.structuredContent?.result || { valid: [], invalid: [], results: {} };
  }

  /**
   * Get the citation network around a paper (forward and backward citations).
   */
  async getPaperNetwork(
    paperId: string,
    options: { userId?: string } = {}
  ): Promise<{ citations: unknown[]; references: unknown[] }> {
    const res = await this.executeTool("get_paper_network", { paper_id: paperId }, options);
    const text = res.content?.find((c) => c.type === "text")?.text;
    if (text) {
      try {
        return JSON.parse(text);
      } catch {
        // Fallback
      }
    }
    return res.structuredContent?.result || { citations: [], references: [] };
  }

  /**
   * Resolve legal open access PDFs for a given DOI.
   */
  async getOpenAccessPdf(
    doi: string,
    options: { userId?: string } = {}
  ): Promise<{ url: string | null; isOa: boolean }> {
    const res = await this.executeTool("open_access", { doi }, options);
    const text = res.content?.find((c) => c.type === "text")?.text;
    if (text) {
      try {
        const parsed = JSON.parse(text);
        return {
          url: parsed.pdf_url || parsed.open_access_pdf_url || parsed.url || null,
          isOa: Boolean(parsed.is_oa || parsed.isOpenAccess || parsed.pdf_url),
        };
      } catch {
        // Fallback
      }
    }
    return { url: null, isOa: false };
  }
}

// Global Singleton for Server-Side Usage
export const citedEvidenceClient = new CitedEvidenceClient();
export const reconstructAbstract = CitedEvidenceClient.reconstructAbstract;
