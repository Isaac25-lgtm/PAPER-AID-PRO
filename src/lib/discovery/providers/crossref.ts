/**
 * Crossref Provider Adapter
 *
 * Sourced via official Crossref REST API using the polite pool.
 * Primary source for:
 * - Canonical DOI metadata
 * - Bibliographic normalization
 * - Published dates, container title (journal)
 * - Publisher and license metadata
 */

import {
  ScholarlyProvider,
  NormalizedExternalPaper,
  DiscoverySearchOptions,
  SourceProvider,
} from "../types";
import { normalizeDoi } from "@/lib/identifiers";

const CROSSREF_BASE = "https://api.crossref.org/works";

export class CrossrefProvider implements ScholarlyProvider {
  readonly name: SourceProvider = "CROSSREF";

  private getUserAgent(): string {
    const contact = process.env.CROSSREF_MAILTO?.trim() || "scholar@airesearchhub.org";
    return `AIResearchHub/1.0 (mailto:${contact})`;
  }

  async search(
    query: string,
    options: DiscoverySearchOptions = {}
  ): Promise<NormalizedExternalPaper[]> {
    const limit = options.limitPerProvider || 10;
    const timeoutMs = options.timeoutMs || 8000;

    const searchUrl = `${CROSSREF_BASE}?query=${encodeURIComponent(
      query
    )}&rows=${limit}&select=DOI,title,author,published-print,published-online,container-title,abstract,is-referenced-by-count,URL,link,license`;

    const res = await fetch(searchUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": this.getUserAgent(),
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      if (res.status === 429) {
        throw new Error("Crossref rate limit reached (HTTP 429).");
      }
      throw new Error(`Crossref search failed with HTTP ${res.status}.`);
    }

    const data = await res.json();
    const items = data?.message?.items || [];

    const papers: NormalizedExternalPaper[] = [];

    for (const item of items) {
      const doi = normalizeDoi(item.DOI);
      if (!doi) continue;

      // Title
      const titleRaw = Array.isArray(item.title) ? item.title[0] : item.title;
      const title = (titleRaw || "").replace(/<[^>]+>/g, "").trim();
      if (!title) continue;

      // Authors
      const authors = Array.isArray(item.author)
        ? item.author.map(
            (a: {
              given?: string;
              family?: string;
              name?: string;
              affiliation?: { name: string }[];
              ORCID?: string;
            }) => {
              const fullName = a.name || [a.given, a.family].filter(Boolean).join(" ");
              const institution =
                Array.isArray(a.affiliation) && a.affiliation[0]?.name
                  ? a.affiliation[0].name.trim()
                  : null;
              const orcid = a.ORCID ? a.ORCID.replace(/^https?:\/\/orcid\.org\//i, "") : null;
              return {
                name: fullName.trim() || "Unknown Author",
                institution,
                orcid,
              };
            }
          )
        : [];

      // Publication Date / Year
      const pubDateObj = item["published-print"] || item["published-online"];
      const dateParts = pubDateObj?.["date-parts"]?.[0];
      let year: number | null = null;
      let publicationDate: string | null = null;

      if (Array.isArray(dateParts) && dateParts.length > 0) {
        year = dateParts[0];
        const month = String(dateParts[1] || 1).padStart(2, "0");
        const day = String(dateParts[2] || 1).padStart(2, "0");
        publicationDate = `${year}-${month}-${day}`;
      }

      // Journal / Container
      const journal = Array.isArray(item["container-title"])
        ? item["container-title"][0] || null
        : item["container-title"] || null;

      // Abstract (often in JATS XML format)
      let abstract: string | null = null;
      if (item.abstract) {
        abstract = item.abstract
          .replace(/<jats:[^>]+>/gi, "")
          .replace(/<\/jats:[^>]+>/gi, "")
          .replace(/<[^>]+>/g, "")
          .trim();
      }

      // Citation Count
      const citationCount = typeof item["is-referenced-by-count"] === "number"
        ? item["is-referenced-by-count"]
        : null;

      // Open Access & Link inspection
      // Note: Crossref URLs are NOT proof of permission to ingest full-text PDF.
      // We inspect license for open access CC licenses.
      let isOpenAccess = false;
      if (Array.isArray(item.license)) {
        for (const lic of item.license) {
          const url = lic.URL?.toLowerCase() || "";
          if (
            url.includes("creativecommons") ||
            url.includes("/open-access") ||
            url.includes("publicdomain")
          ) {
            isOpenAccess = true;
            break;
          }
        }
      }

      papers.push({
        id: `doi:${doi}`,
        title,
        abstract,
        authors,
        publicationDate,
        year,
        journal,
        doi,
        pmid: null,
        pmcid: null,
        arxivId: null,
        semanticScholarId: null,
        externalUrl: item.URL || `https://doi.org/${doi}`,
        sourceProviders: ["CROSSREF"],
        citationCount,
        isOpenAccess,
        openAccessPdfUrl: null, // Crossref does not guarantee direct PDF endpoints
        fullTextAvailability: "METADATA_ONLY",
        fullTextSource: null,
        rawProviderMetadata: {
          crossref: {
            publisher: item.publisher,
            prefix: item.prefix,
            type: item.type,
          },
        },
      });
    }

    return papers;
  }
}
