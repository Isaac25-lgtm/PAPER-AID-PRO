import CSL from "citeproc";
import { EN_US_LOCALE_XML } from "./locales/en-US";
import {
  CslItem,
  CslCitationCluster,
  CslCitationItem,
  FormattedBibliography,
  CslCitationFormat,
} from "./types";

export interface CiteprocSys {
  retrieveItem: (id: string) => CslItem | undefined;
  retrieveLocale: (lang: string) => string;
  variableWrapper?: (params: any, prePunc: string, str: string, postPunc: string) => string;
}

/**
 * Creates an instantiated Citeproc-JS engine configured with the given items and CSL XML.
 */
export function createCiteprocEngine(
  styleXml: string,
  items: CslItem[] | Record<string, CslItem>,
  localeXml: string = EN_US_LOCALE_XML,
  lang: string = "en-US"
): any {
  const itemsMap: Record<string, CslItem> = Array.isArray(items)
    ? items.reduce((acc, it) => {
        acc[it.id] = it;
        return acc;
      }, {} as Record<string, CslItem>)
    : items;

  const sys: CiteprocSys = {
    retrieveItem: (id: string) => itemsMap[id],
    retrieveLocale: () => localeXml,
  };

  // Instantiates CSL.Engine(sys, styleXml, lang, forceLang)
  const engine = new (CSL as any).Engine(sys, styleXml, lang, true);
  engine.setOutputFormat("html");

  // Pre-register item IDs so makeBibliography() can output them immediately
  const itemIds = Object.keys(itemsMap);
  if (itemIds.length > 0) {
    engine.updateItems(itemIds);
  }

  return engine;
}

/**
 * Renders a single citation cluster (in-text citation) using preview mode.
 */
export function renderCitationCluster(
  engine: any,
  cluster: CslCitationCluster | CslCitationItem[],
  format: "text" | "html" = "text"
): string {
  const clusterObj: CslCitationCluster = Array.isArray(cluster)
    ? {
        citationItems: cluster,
        properties: { noteIndex: 1 },
      }
    : {
        ...cluster,
        properties: { noteIndex: 1, ...(cluster.properties || {}) },
      };

  try {
    const rendered = engine.previewCitationCluster(
      clusterObj,
      [],
      [],
      format
    );
    return decodeHtmlEntities(rendered || "");
  } catch (err: any) {
    console.warn("CSL citation cluster preview warning:", err.message);
    // Fallback: simple parenthesized ID
    const items = clusterObj.citationItems || [];
    const ids = items.map((c) => c.id).join(", ");
    return `(${ids || "Citation"})`;
  }
}

/**
 * Processes multiple sequential citation clusters in document order.
 * This assigns sequential numeric indices (e.g. [1], [2], [1, 3]) in numeric styles
 * and proper disambiguated author-date references in author-date styles.
 */
export function processSequentialCitationClusters(
  engine: any,
  clusters: Array<{ citationId: string; items: CslCitationItem[] }>
): Map<string, string> {
  const results = new Map<string, string>();
  const citationsPre: [string, number][] = [];

  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const clusterObj: CslCitationCluster = {
      citationID: c.citationId,
      citationItems: c.items,
      properties: { noteIndex: i },
    };

    try {
      const res = engine.processCitationCluster(clusterObj, citationsPre, []);
      citationsPre.push([c.citationId, i]);

      // res is [ { bibchange: bool }, [ [index, text, id], ... ] ]
      if (Array.isArray(res) && Array.isArray(res[1])) {
        for (const entry of res[1]) {
          if (Array.isArray(entry) && entry.length >= 3) {
            const rendered = decodeHtmlEntities(stripHtmlTags(entry[1] || ""));
            results.set(entry[2], rendered);
          }
        }
      }
    } catch (err: any) {
      console.warn(`Error processing cluster ${c.citationId}:`, err.message);
      results.set(c.citationId, `[${i + 1}]`);
    }
  }

  return results;
}

/**
 * Extracts formatted bibliography entries from the Citeproc engine.
 */
export function renderBibliography(
  engine: any,
  styleId: string = "custom",
  styleTitle: string = "Custom Style",
  format: CslCitationFormat = "numeric"
): FormattedBibliography {
  try {
    const bib = engine.makeBibliography();
    if (!bib || !Array.isArray(bib) || bib.length < 2) {
      return {
        styleId,
        styleTitle,
        format,
        entries: [],
        rawEntries: [],
        hangingIndent: false,
      };
    }

    const meta = bib[0] || {};
    const rawEntries: string[] = bib[1] || [];

    // Clean formatted HTML entries
    const entries = rawEntries.map((entry: string) => {
      // Remove outer <div class="csl-entry"> wrapper while preserving inner <i>, <b>, <a>
      return entry
        .replace(/^\s*<div[^>]*>/i, "")
        .replace(/<\/div>\s*$/i, "")
        .trim();
    });

    return {
      styleId,
      styleTitle,
      format,
      entries,
      rawEntries,
      bibStart: meta.bibstart,
      bibEnd: meta.bibend,
      hangingIndent: Boolean(meta.hangingindent),
    };
  } catch (err: any) {
    console.warn("Failed to generate bibliography:", err.message);
    return {
      styleId,
      styleTitle,
      format,
      entries: [],
      rawEntries: [],
      hangingIndent: false,
    };
  }
}

/**
 * Strips HTML tags, leaving clean plain text.
 */
export function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

/**
 * Decodes standard HTML entities produced by Citeproc-JS.
 */
export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#38;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&#60;/g, "<")
    .replace(/&lt;/g, "<")
    .replace(/&#62;/g, ">")
    .replace(/&gt;/g, ">")
    .replace(/&#34;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&#8211;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&#8212;/g, "—");
}
