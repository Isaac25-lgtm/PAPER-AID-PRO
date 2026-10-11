/**
 * CitedEvidence Scholar Provider Adapter
 *
 * Connects to CitedEvidence Scholar & CEDOA (OpenAlex-compatible 250M+ catalog).
 * Provides:
 * - Canonical DOI & OpenAlex identifiers
 * - Verified author lists with institutional affiliations & ORCIDs
 * - Publication metrics & global citation counts
 * - Verified Open Access status and CEDOA full-text PDF links
 *
 * Gracefully handles rate limiting and authentication errors.
 */

import {
  ScholarlyProvider,
  NormalizedExternalPaper,
  DiscoverySearchOptions,
  SourceProvider,
} from "../types";
import { normalizeDoi } from "@/lib/identifiers";
import { CitedEvidenceClient } from "@/lib/citedevidence/client";
import { OpenAlexWork } from "@/lib/citedevidence/types";

export class CitedEvidenceProvider implements ScholarlyProvider {
  readonly name: SourceProvider = "CITED_EVIDENCE";
  private client: CitedEvidenceClient;

  constructor(client?: CitedEvidenceClient) {
    this.client = client || new CitedEvidenceClient();
  }

  async search(
    query: string,
    options: DiscoverySearchOptions = {}
  ): Promise<NormalizedExternalPaper[]> {
    if (!this.client.isConfigured()) {
      return [];
    }

    const limit = options.limitPerProvider || 10;
    const timeoutMs = options.timeoutMs || 8000;

    const data = await this.client.searchWorks(query, {
      perPage: limit,
      timeoutMs,
    });

    const items: OpenAlexWork[] = data?.results || [];
    const papers: NormalizedExternalPaper[] = [];

    for (const item of items) {
      const title = (item.title || item.display_name || "").trim();
      if (!title) continue;

      const doi = normalizeDoi(item.doi);
      const openAlexId = item.id ? item.id.replace(/^https:\/\/openalex\.org\//, "") : null;

      // Extract authors
      const authors = Array.isArray(item.authorships)
        ? item.authorships.map((auth) => ({
            name: auth.author?.display_name || "Unknown Author",
            orcid: auth.author?.orcid || null,
            institution: auth.institutions?.[0]?.display_name || null,
          }))
        : [];

      // Reconstruct abstract from inverted index
      const abstract = CitedEvidenceClient.reconstructAbstract(
        item.abstract_inverted_index
      );

      // Open access and CEDOA PDF URL
      const isOpenAccess = Boolean(
        item.open_access?.is_oa || item.has_fulltext || item.best_oa_location?.is_oa
      );

      let openAccessPdfUrl: string | null = null;
      let fullTextAvailability: NormalizedExternalPaper["fullTextAvailability"] = "METADATA_ONLY";
      let fullTextSource: string | null = null;

      if (item.best_oa_location?.pdf_url) {
        openAccessPdfUrl = item.best_oa_location.pdf_url;
        fullTextSource = "OPEN_ACCESS_REPOSITORY";
        fullTextAvailability = "FULL_TEXT_AVAILABLE";
      } else if (item.open_access?.oa_url && item.open_access.oa_url.endsWith(".pdf")) {
        openAccessPdfUrl = item.open_access.oa_url;
        fullTextSource = "PUBLISHER_OA_PDF";
        fullTextAvailability = "FULL_TEXT_AVAILABLE";
      } else if (item.has_fulltext && openAlexId) {
        openAccessPdfUrl = `https://scholar.citedevidence.com/api/v1/research-corpus/pdf/${openAlexId}`;
        fullTextSource = "CEDOA_FILES";
        fullTextAvailability = "FULL_TEXT_AVAILABLE";
      }

      const license = item.best_oa_location?.license || item.primary_location?.license || null;
      const accessStatus = item.open_access?.oa_status || (isOpenAccess ? "open_access" : "closed");

      const id = doi
        ? `doi:${doi}`
        : openAlexId
        ? `ce:${openAlexId}`
        : `ext:${Buffer.from(title.slice(0, 30)).toString("hex")}`;

      papers.push({
        id,
        title,
        abstract: abstract || null,
        authors,
        publicationDate: item.publication_date || null,
        year: item.publication_year || null,
        journal: item.primary_location?.source?.display_name || null,
        doi,
        pmid: null,
        pmcid: null,
        arxivId: null,
        externalUrl: item.doi || (openAlexId ? `https://openalex.org/${openAlexId}` : null),
        sourceProviders: ["CITED_EVIDENCE"],
        citationCount: typeof item.cited_by_count === "number" ? item.cited_by_count : null,
        isOpenAccess,
        license,
        accessStatus,
        openAccessPdfUrl,
        fullTextAvailability,
        fullTextSource,
        rawProviderMetadata: {
          citedEvidence: {
            openAlexId,
            citedByCount: item.cited_by_count,
            hasFulltext: item.has_fulltext,
            license,
            concepts: item.concepts?.slice(0, 5),
          },
        },
      });
    }

    return papers;
  }

  async getPaper(identifier: {
    doi?: string;
    openAlexId?: string;
  }): Promise<NormalizedExternalPaper | null> {
    if (!this.client.isConfigured()) return null;

    const lookupKey = identifier.doi || identifier.openAlexId;
    if (!lookupKey) return null;

    try {
      const item = await this.client.getWork(lookupKey);
      if (!item) return null;

      const title = (item.title || item.display_name || "").trim();
      const doi = normalizeDoi(item.doi);
      const openAlexId = item.id ? item.id.replace(/^https:\/\/openalex\.org\//, "") : null;

      const authors = Array.isArray(item.authorships)
        ? item.authorships.map((auth) => ({
            name: auth.author?.display_name || "Unknown Author",
            orcid: auth.author?.orcid || null,
            institution: auth.institutions?.[0]?.display_name || null,
          }))
        : [];

      const abstract = CitedEvidenceClient.reconstructAbstract(
        item.abstract_inverted_index
      );

      const isOpenAccess = Boolean(
        item.open_access?.is_oa || item.has_fulltext || item.best_oa_location?.is_oa
      );

      const openAccessPdfUrl =
        item.best_oa_location?.pdf_url ||
        (item.has_fulltext && openAlexId
          ? `https://scholar.citedevidence.com/api/v1/research-corpus/pdf/${openAlexId}`
          : null);

      return {
        id: doi ? `doi:${doi}` : openAlexId ? `ce:${openAlexId}` : `ext:${doi || lookupKey}`,
        title,
        abstract: abstract || null,
        authors,
        publicationDate: item.publication_date || null,
        year: item.publication_year || null,
        journal: item.primary_location?.source?.display_name || null,
        doi,
        sourceProviders: ["CITED_EVIDENCE"],
        citationCount: typeof item.cited_by_count === "number" ? item.cited_by_count : null,
        isOpenAccess,
        openAccessPdfUrl,
        fullTextAvailability: openAccessPdfUrl ? "FULL_TEXT_AVAILABLE" : "METADATA_ONLY",
        fullTextSource: "CITED_EVIDENCE",
      };
    } catch {
      return null;
    }
  }
}
