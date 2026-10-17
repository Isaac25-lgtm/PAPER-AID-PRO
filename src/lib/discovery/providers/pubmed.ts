/**
 * PubMed / NCBI Provider Adapter
 *
 * Sourced via official NCBI E-utilities:
 * 1. esearch.fcgi -> fetches matching PMIDs
 * 2. esummary.fcgi -> fetches structured bibliographic metadata
 * 3. efetch.fcgi (bounded) -> fetches verbatim abstracts
 *
 * Strictly server-side; supports optional NCBI_API_KEY.
 */

import {
  ScholarlyProvider,
  NormalizedExternalPaper,
  DiscoverySearchOptions,
  SourceProvider,
} from "../types";
import { normalizeDoi, normalizePmid, normalizePmcid } from "@/lib/identifiers";

const NCBI_EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export class PubMedProvider implements ScholarlyProvider {
  readonly name: SourceProvider = "PUBMED";

  private getApiKeyParam(): string {
    const key = process.env.NCBI_API_KEY?.trim();
    return key ? `&api_key=${encodeURIComponent(key)}` : "";
  }

  async search(
    query: string,
    options: DiscoverySearchOptions = {}
  ): Promise<NormalizedExternalPaper[]> {
    const limit = options.limitPerProvider || 10;
    const timeoutMs = options.timeoutMs || 8000;
    const apiKeyParam = this.getApiKeyParam();

    // 1. ESearch: Discover PMIDs with relevance sorting
    const searchUrl = `${NCBI_EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(
      query
    )}&retmode=json&retmax=${limit}&sort=relevance${apiKeyParam}`;

    const searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "AIResearchHub/1.0 (academic-intelligence-platform)",
      },
    });

    if (!searchRes.ok) {
      if (searchRes.status === 429) {
        throw new Error("PubMed rate limit reached (HTTP 429).");
      }
      throw new Error(`PubMed ESearch failed with HTTP ${searchRes.status}.`);
    }

    const searchData = await searchRes.json();
    const idList: string[] = searchData?.esearchresult?.idlist || [];

    if (idList.length === 0) {
      return [];
    }

    // 2. ESummary: Retrieve Bibliographic Metadata
    const summaryUrl = `${NCBI_EUTILS_BASE}/esummary.fcgi?db=pubmed&id=${idList.join(
      ","
    )}&retmode=json${apiKeyParam}`;

    const summaryRes = await fetch(summaryUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "AIResearchHub/1.0 (academic-intelligence-platform)",
      },
    });

    if (!summaryRes.ok) {
      throw new Error(`PubMed ESummary failed with HTTP ${summaryRes.status}.`);
    }

    const summaryData = await summaryRes.json();
    const resultObj = summaryData?.result || {};

    // 3. EFetch for abstracts (best-effort, non-blocking on failure)
    const abstractMap = new Map<string, string>();
    try {
      const fetchUrl = `${NCBI_EUTILS_BASE}/efetch.fcgi?db=pubmed&id=${idList
        .slice(0, 15)
        .join(",")}&retmode=xml${apiKeyParam}`;
      const fetchRes = await fetch(fetchUrl, {
        signal: AbortSignal.timeout(Math.min(timeoutMs, 5000)),
        headers: {
          "User-Agent": "AIResearchHub/1.0 (academic-intelligence-platform)",
        },
      });

      if (fetchRes.ok) {
        const xmlText = await fetchRes.text();
        this.extractAbstractsFromXml(xmlText, abstractMap);
      }
    } catch {
      // Best-effort: abstract retrieval failures never fail the discovery search
    }

    // 4. Map to NormalizedExternalPaper
    const papers: NormalizedExternalPaper[] = [];

    for (const pmid of idList) {
      const item = resultObj[pmid];
      if (!item || item.error) continue;

      let doi: string | null = null;
      let pmcid: string | null = null;

      if (Array.isArray(item.articleids)) {
        for (const aid of item.articleids) {
          if (aid.idtype === "doi") {
            doi = normalizeDoi(aid.value);
          } else if (aid.idtype === "pmc" || aid.idtype === "pmcid") {
            pmcid = normalizePmcid(aid.value);
          }
        }
      }

      // Authors
      const authors = Array.isArray(item.authors)
        ? item.authors.map((a: { name: string }) => ({
            name: a.name || "Unknown Author",
          }))
        : [];

      // Clean title (remove trailing periods often in PubMed data)
      let title = (item.title || "").replace(/\[|\]/g, "").replace(/\.$/, "").trim();
      if (!title) title = `PubMed Document ${pmid}`;

      // Publication Year
      let year: number | null = null;
      if (item.pubdate) {
        const yearMatch = item.pubdate.match(/\b(19\d\d|20\d\d)\b/);
        if (yearMatch) {
          year = parseInt(yearMatch[1], 10);
        }
      }

      const abstract = abstractMap.get(pmid) || null;
      const normalizedPmid = normalizePmid(pmid);

      const hasPmc = Boolean(pmcid);

      papers.push({
        id: doi ? `doi:${doi}` : normalizedPmid ? `pmid:${normalizedPmid}` : `pm:${pmid}`,
        title,
        abstract,
        authors,
        publicationDate: item.pubdate || null,
        year,
        journal: item.source || item.fulljournalname || null,
        doi,
        pmid: normalizedPmid,
        pmcid,
        arxivId: null,
        semanticScholarId: null,
        externalUrl: normalizedPmid ? `https://pubmed.ncbi.nlm.nih.gov/${normalizedPmid}/` : null,
        sourceProviders: ["PUBMED"],
        citationCount: null, // PubMed does not reliably provide external citation counts via ESummary
        isOpenAccess: hasPmc,
        openAccessPdfUrl: hasPmc
          ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/pdf/`
          : null,
        fullTextAvailability: hasPmc ? "FULL_TEXT_AVAILABLE" : "METADATA_ONLY",
        fullTextSource: hasPmc ? "PMC_OPEN_ACCESS" : null,
        rawProviderMetadata: {
          pubmed: {
            uid: item.uid,
            pubtype: item.pubtype,
            recordStatus: item.recordstatus,
          },
        },
      });
    }

    return papers;
  }

  /**
   * Helper extracting PMIDs and corresponding <AbstractText> contents from PubMed XML.
   */
  private extractAbstractsFromXml(xml: string, map: Map<string, string>): void {
    const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/gi;
    let match: RegExpExecArray | null;

    while ((match = articleRegex.exec(xml)) !== null) {
      const articleBlock = match[1];
      const pmidMatch = /<PMID[^>]*>(\d+)<\/PMID>/i.exec(articleBlock);
      if (!pmidMatch) continue;

      const pmid = pmidMatch[1];
      const abstractParts: string[] = [];
      const abstractRegex = /<AbstractText(?:\s+Label="([^"]*)")?[^>]*>([\s\S]*?)<\/AbstractText>/gi;
      let absMatch: RegExpExecArray | null;

      while ((absMatch = abstractRegex.exec(articleBlock)) !== null) {
        const label = absMatch[1];
        const content = absMatch[2].replace(/<[^>]+>/g, "").trim();
        if (label) {
          abstractParts.push(`${label}: ${content}`);
        } else {
          abstractParts.push(content);
        }
      }

      if (abstractParts.length > 0) {
        map.set(pmid, abstractParts.join("\n\n"));
      }
    }
  }
}
