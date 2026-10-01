/**
 * Semantic Scholar Provider Adapter
 *
 * Sourced via official Semantic Scholar Academic Graph API.
 * Provides:
 * - Semantic Scholar paper ID
 * - External identifiers (DOI, ArXiv, PubMed, PMCID)
 * - Author lists
 * - Descriptive bibliometric citation counts
 * - Open Access indicators and openAccessPdf URLs
 *
 * Gracefully isolates rate limiting (HTTP 429).
 */

import {
  ScholarlyProvider,
  NormalizedExternalPaper,
  DiscoverySearchOptions,
  SourceProvider,
} from "../types";
import {
  normalizeDoi,
  normalizeArxivId,
  normalizePmid,
  normalizePmcid,
  normalizeSemanticScholarId,
} from "@/lib/identifiers";

const S2_BASE = "https://api.semanticscholar.org/graph/v1/paper/search";

export class SemanticScholarProvider implements ScholarlyProvider {
  readonly name: SourceProvider = "SEMANTIC_SCHOLAR";

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": "AIResearchHub/1.0 (academic-intelligence-platform)",
      Accept: "application/json",
    };

    const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY?.trim();
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    return headers;
  }

  async search(
    query: string,
    options: DiscoverySearchOptions = {}
  ): Promise<NormalizedExternalPaper[]> {
    const limit = options.limitPerProvider || 10;
    const timeoutMs = options.timeoutMs || 8000;

    const fields =
      "paperId,title,abstract,authors,year,publicationDate,venue,externalIds,citationCount,isOpenAccess,openAccessPdf";
    const searchUrl = `${S2_BASE}?query=${encodeURIComponent(
      query
    )}&limit=${limit}&fields=${fields}`;

    const res = await fetch(searchUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error("Semantic Scholar rate limit reached (HTTP 429).");
      }
      throw new Error(`Semantic Scholar search failed with HTTP ${res.status}.`);
    }

    const data = await res.json();
    const items = data?.data || [];

    const papers: NormalizedExternalPaper[] = [];

    for (const item of items) {
      const s2Id = normalizeSemanticScholarId(item.paperId);
      const title = (item.title || "").trim();
      if (!title) continue;

      const extIds = item.externalIds || {};
      const doi = normalizeDoi(extIds.DOI);
      const arxivId = normalizeArxivId(extIds.ArXiv);
      const pmid = normalizePmid(extIds.PubMed);
      const pmcid = normalizePmcid(extIds.PubMedCentral);

      // Authors
      const authors = Array.isArray(item.authors)
        ? item.authors.map((a: { name: string }) => ({
            name: a.name || "Unknown Author",
          }))
        : [];

      // Open access & PDF resolution
      const isOpenAccess = Boolean(item.isOpenAccess);
      let openAccessPdfUrl: string | null = null;
      let fullTextAvailability: NormalizedExternalPaper["fullTextAvailability"] = "METADATA_ONLY";
      let fullTextSource: string | null = null;

      if (pmcid) {
        isOpenAccess && (fullTextAvailability = "FULL_TEXT_AVAILABLE");
        openAccessPdfUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/pdf/`;
        fullTextSource = "PMC_OPEN_ACCESS";
      } else if (item.openAccessPdf?.url) {
        openAccessPdfUrl = item.openAccessPdf.url;
        fullTextSource = "SEMANTIC_SCHOLAR_OA";
        fullTextAvailability = "FULL_TEXT_AVAILABLE";
      }

      const id = doi
        ? `doi:${doi}`
        : pmid
        ? `pmid:${pmid}`
        : s2Id
        ? `s2:${s2Id}`
        : `ext:${Buffer.from(title.slice(0, 30)).toString("hex")}`;

      papers.push({
        id,
        title,
        abstract: item.abstract || null,
        authors,
        publicationDate: item.publicationDate || null,
        year: item.year || null,
        journal: item.venue || null,
        doi,
        pmid,
        pmcid,
        arxivId,
        semanticScholarId: s2Id,
        externalUrl: s2Id ? `https://www.semanticscholar.org/paper/${s2Id}` : null,
        sourceProviders: ["SEMANTIC_SCHOLAR"],
        citationCount: typeof item.citationCount === "number" ? item.citationCount : null,
        isOpenAccess,
        openAccessPdfUrl,
        fullTextAvailability,
        fullTextSource,
        rawProviderMetadata: {
          semanticScholar: {
            paperId: item.paperId,
            externalIds: item.externalIds,
          },
        },
      });
    }

    return papers;
  }
}
