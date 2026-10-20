/**
 * AI RESEARCH HUB — PHASE 8B: UPSTREAM CSL GITHUB CLIENT
 *
 * Provides rate-limit-aware, conditional-cached communication with official CSL repositories:
 * - https://github.com/citation-style-language/styles
 * - https://github.com/citation-style-language/locales
 *
 * Guarantees:
 * 1. Uses pinned releases/branches (default: "v1.0.2") and records immutable Git commit SHAs.
 * 2. Employs conditional HTTP requests (ETag / If-None-Match) to conserve rate limits.
 * 3. Inspects Git trees to diff additions/modifications without downloading 10,000 files.
 * 4. Pinned style XML downloads reference exact Git commit SHAs (never floating master branch URLs).
 */

import { UpstreamGitCommit, UpstreamTreeEntry, CatalogDiff } from "./types";

export interface GitHubClientOptions {
  owner?: string;
  repo?: string;
  branch?: string;
  token?: string;
  userAgent?: string;
}

export class CslGitHubClient {
  private owner: string;
  private repo: string;
  private branch: string;
  private token?: string;
  private userAgent: string;

  constructor(options: GitHubClientOptions = {}) {
    this.owner = options.owner || process.env.CSL_UPSTREAM_OWNER || "citation-style-language";
    this.repo = options.repo || process.env.CSL_UPSTREAM_REPO || "styles";
    this.branch = options.branch || process.env.CSL_UPSTREAM_BRANCH || "v1.0.2";
    this.token = options.token || process.env.GITHUB_TOKEN;
    this.userAgent = options.userAgent || "AI-Research-Hub-CSL-Updater/1.0";
  }

  private getHeaders(etag?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": this.userAgent,
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    if (etag) {
      headers["If-None-Match"] = etag;
    }
    return headers;
  }

  /**
   * Checks the latest commit SHA of the target branch with ETag conditional caching.
   */
  async checkLatestCommit(etag?: string): Promise<{
    changed: boolean;
    commit?: UpstreamGitCommit;
    etag?: string;
    rateLimitRemaining?: number;
  }> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/commits/${this.branch}`;

    try {
      const res = await fetch(url, {
        headers: this.getHeaders(etag),
        next: { revalidate: 3600 },
      });

      const rateLimitRemaining = res.headers.get("x-ratelimit-remaining")
        ? parseInt(res.headers.get("x-ratelimit-remaining")!, 10)
        : undefined;

      if (res.status === 304) {
        return { changed: false, etag, rateLimitRemaining };
      }

      if (!res.ok) {
        if (res.status === 403 || res.status === 429) {
          throw new Error(`GitHub API rate limit exceeded while querying upstream CSL revision.`);
        }
        throw new Error(`Failed to fetch upstream commit for ${this.owner}/${this.repo}@${this.branch}: HTTP ${res.status}`);
      }

      const data = await res.json();
      const newEtag = res.headers.get("etag") || undefined;

      return {
        changed: true,
        commit: {
          sha: data.sha,
          date: data.commit?.committer?.date || new Date().toISOString(),
          message: data.commit?.message?.split("\n")[0] || "Upstream CSL revision update",
          branch: this.branch,
          etag: newEtag,
        },
        etag: newEtag,
        rateLimitRemaining,
      };
    } catch (err: any) {
      console.warn("CslGitHubClient.checkLatestCommit failed:", err.message);
      throw err;
    }
  }

  /**
   * Fetches the full Git tree for a commit SHA recursively and extracts all .csl files.
   */
  async fetchStyleTree(commitSha: string): Promise<Map<string, UpstreamTreeEntry>> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/git/trees/${commitSha}?recursive=1`;

    const res = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch Git tree for commit ${commitSha}: HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.tree || !Array.isArray(data.tree)) {
      throw new Error(`Invalid Git tree response from GitHub for commit ${commitSha}.`);
    }

    const stylesMap = new Map<string, UpstreamTreeEntry>();

    for (const item of data.tree) {
      if (item.type !== "blob" || !item.path.endsWith(".csl")) {
        continue;
      }

      const isDependent = item.path.startsWith("dependent/");
      const filename = item.path.split("/").pop() || "";
      const styleId = filename.replace(/\.csl$/i, "");

      stylesMap.set(styleId, {
        path: item.path,
        mode: item.mode,
        type: item.type,
        sha: item.sha,
        size: item.size,
        url: item.url,
        styleId,
        isDependent,
      });
    }

    return stylesMap;
  }

  /**
   * Diffs two Git trees to identify added, modified, and removed styles without downloading XML.
   */
  diffTrees(
    activeTree: Map<string, { sha: string; path: string }>,
    upstreamTree: Map<string, UpstreamTreeEntry>,
    upstreamSha: string,
    activeSha: string | null
  ): CatalogDiff {
    const added: UpstreamTreeEntry[] = [];
    const modified: UpstreamTreeEntry[] = [];
    const removed: string[] = [];
    let unchangedCount = 0;

    for (const [styleId, entry] of Array.from(upstreamTree.entries())) {
      if (!activeTree.has(styleId)) {
        added.push(entry);
      } else {
        const existing = activeTree.get(styleId)!;
        if (existing.sha !== entry.sha) {
          modified.push(entry);
        } else {
          unchangedCount++;
        }
      }
    }

    for (const styleId of Array.from(activeTree.keys())) {
      if (!upstreamTree.has(styleId)) {
        removed.push(styleId);
      }
    }

    const hasChanges = added.length > 0 || modified.length > 0 || removed.length > 0;

    return {
      upstreamSha,
      activeSha,
      hasChanges,
      added,
      modified,
      removed,
      unchangedCount,
    };
  }

  /**
   * Fetches raw CSL XML pinned strictly to the specific Git commit SHA.
   */
  async fetchStyleXml(commitSha: string, filePath: string): Promise<string> {
    const rawUrl = `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${commitSha}/${filePath}`;

    const res = await fetch(rawUrl, {
      headers: {
        "User-Agent": this.userAgent,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch CSL XML from ${rawUrl}: HTTP ${res.status}`);
    }

    return await res.text();
  }
}
