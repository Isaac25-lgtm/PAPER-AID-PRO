"use client";

import { BUNDLED_STYLES } from "./styles/bundled-styles";
import { EN_US_LOCALE_XML } from "./locales/en-US";
import {
  CslItem,
  CslCitationCluster,
  CslCitationItem,
  CslCitationFormat,
} from "./types";
import {
  createCiteprocEngine,
  processSequentialCitationClusters,
  renderBibliography,
  stripHtmlTags,
  decodeHtmlEntities,
} from "./csl-engine";
import { mapReferenceToCslJson } from "./csl-mapper";

// In-memory client cache for fetched style XMLs
const clientStyleCache = new Map<
  string,
  { xml: string; title: string; format: CslCitationFormat }
>();

// Pre-fill cache with bundled styles
for (const [id, def] of Object.entries(BUNDLED_STYLES)) {
  clientStyleCache.set(id, {
    xml: def.xml,
    title: def.title,
    format: def.format,
  });
}

/**
 * Loads CSL style XML on the client. Returns instantly from memory if bundled or previously fetched.
 */
export async function loadStyleXmlClient(styleId: string): Promise<{
  xml: string;
  title: string;
  format: CslCitationFormat;
}> {
  const cleanId = (styleId || "apa").toLowerCase().trim();

  if (clientStyleCache.has(cleanId)) {
    return clientStyleCache.get(cleanId)!;
  }

  try {
    const res = await fetch(`/api/citations/styles/${encodeURIComponent(cleanId)}`);
    if (!res.ok) {
      throw new Error(`Failed to load style '${cleanId}' (HTTP ${res.status})`);
    }
    const data = await res.json();
    if (data.success && data.style?.xml) {
      const entry = {
        xml: data.style.xml,
        title: data.style.title || cleanId,
        format: (data.style.format || "numeric") as CslCitationFormat,
      };
      clientStyleCache.set(cleanId, entry);
      return entry;
    }
    throw new Error(data.error || `Invalid style response for '${cleanId}'`);
  } catch (err: any) {
    throw new Error(`CSL style '${cleanId}' could not be loaded: ${err.message}`);
  }
}

export interface FormatDocumentParams {
  styleId: string;
  linkedPapers: any[];
  clusters: Array<{ citationId: string; items: CslCitationItem[] }>;
}

export interface FormatDocumentResult {
  renderedClusters: Map<string, string>;
  bibliographyEntries: string[];
  styleTitle: string;
  format: CslCitationFormat;
}

/**
 * Formats all citations and bibliography entries for an active document in one pass.
 */
export async function formatDocumentCsl({
  styleId,
  linkedPapers,
  clusters,
}: FormatDocumentParams): Promise<FormatDocumentResult> {
  const styleDef = await loadStyleXmlClient(styleId);

  // Map all linked papers and cited references to CslItems
  const cslItems: CslItem[] = [];
  const itemsMap: Record<string, CslItem> = {};

  for (const lp of linkedPapers) {
    const paperObj = lp.paper || lp;
    if (paperObj && paperObj.id) {
      const item = mapReferenceToCslJson(paperObj);
      cslItems.push(item);
      itemsMap[item.id] = item;
    }
  }

  // Normalize cluster item IDs so citeproc can resolve them whether keyed by .id or .paperId
  const normalizedClusters = clusters.map((c) => ({
    citationId: c.citationId,
    items: (c.items || [])
      .map((it: any) => ({
        ...it,
        id: it?.id || it?.paperId || "",
      }))
      .filter((it: any) => Boolean(it.id) && it.id !== "unknown-ref"),
  }));

  // If there are cluster items referencing a paper not in linkedPapers, create a stub item
  for (const cluster of normalizedClusters) {
    for (const it of cluster.items) {
      const itemId = it.id;
      if (itemId && !itemsMap[itemId]) {
        const stub: CslItem = {
          id: itemId,
          type: "article-journal",
          title: `Reference [${String(itemId).slice(0, 8)}]`,
        };
        cslItems.push(stub);
        itemsMap[itemId] = stub;
      }
    }
  }

  if (clusters.length === 0 && cslItems.length === 0) {
    return {
      renderedClusters: new Map(),
      bibliographyEntries: [],
      styleTitle: styleDef.title,
      format: styleDef.format,
    };
  }

  try {
    const engine = createCiteprocEngine(
      styleDef.xml,
      itemsMap,
      EN_US_LOCALE_XML,
      "en-US"
    );

    // Render sequential in-text citations
    const renderedClusters = processSequentialCitationClusters(engine, normalizedClusters);

    // Render bibliography
    const bib = renderBibliography(
      engine,
      styleId,
      styleDef.title,
      styleDef.format
    );

    const cleanEntries = bib.entries.map((e) =>
      decodeHtmlEntities(stripHtmlTags(e))
    );

    return {
      renderedClusters,
      bibliographyEntries: cleanEntries,
      styleTitle: styleDef.title,
      format: styleDef.format,
    };
  } catch (err: any) {
    console.warn("CSL document formatting error:", err);
    // Fallback: simple numeric rendering
    const fallbackMap = new Map<string, string>();
    clusters.forEach((c, idx) => {
      fallbackMap.set(c.citationId, `[${idx + 1}]`);
    });
    return {
      renderedClusters: fallbackMap,
      bibliographyEntries: cslItems.map((it) => it.title || it.id),
      styleTitle: styleDef.title,
      format: styleDef.format,
    };
  }
}
