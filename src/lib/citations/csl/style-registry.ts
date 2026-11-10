import fs from "fs";
import path from "path";
import { BUNDLED_STYLES, BundledStyleDefinition } from "./styles/bundled-styles";
import { CslStyleMetadata, CslCitationFormat } from "./types";

// In-memory cache for loaded and resolved style XMLs
const styleXmlCache = new Map<string, { xml: string; title: string; format: CslCitationFormat }>();

// Pre-populate cache with bundled styles
for (const [id, def] of Object.entries(BUNDLED_STYLES)) {
  styleXmlCache.set(id, {
    xml: def.xml,
    title: def.title,
    format: def.format,
  });
}

// Load styles index lazily on server
let stylesIndexCache: CslStyleMetadata[] | null = null;
let knownStyleIdsSet: Set<string> | null = null;

export function getStylesIndex(): CslStyleMetadata[] {
  if (stylesIndexCache) return stylesIndexCache;

  try {
    const indexPath = path.join(process.cwd(), "src", "lib", "citations", "csl", "styles-index.json");
    if (fs.existsSync(indexPath)) {
      const data = fs.readFileSync(indexPath, "utf-8");
      stylesIndexCache = JSON.parse(data);
      return stylesIndexCache || [];
    }
  } catch (err: any) {
    console.warn("Failed to load styles-index.json:", err.message);
  }

  // Fallback to bundled styles list
  return Object.values(BUNDLED_STYLES).map((s) => ({
    id: s.id,
    title: s.title,
    format: s.format,
    dependent: false,
    prominent: true,
  }));
}

/**
 * Checks whether a style ID exists in the bundled styles or official styles-index.json allowlist.
 */
export function isKnownIndexedStyleId(styleId: string): boolean {
  if ((BUNDLED_STYLES as any)[styleId]) return true;
  if (!knownStyleIdsSet) {
    const index = getStylesIndex();
    knownStyleIdsSet = new Set(index.map((s) => s.id.toLowerCase()));
    for (const id of Object.keys(BUNDLED_STYLES)) {
      knownStyleIdsSet.add(id.toLowerCase());
    }
  }
  return knownStyleIdsSet.has(styleId.toLowerCase());
}

/**
 * Searches the 10,000+ style catalog by keyword, format, or prominent filter.
 */
export function searchStyles(query: {
  q?: string;
  format?: "all" | CslCitationFormat;
  limit?: number;
  offset?: number;
}): { styles: CslStyleMetadata[]; total: number } {
  const allStyles = getStylesIndex();
  const search = (query.q || "").toLowerCase().trim();
  const formatFilter = query.format && query.format !== "all" ? query.format : null;
  const limit = Math.min(query.limit || 30, 100);
  const offset = query.offset || 0;

  let filtered = allStyles;

  if (formatFilter) {
    filtered = filtered.filter((s) => s.format === formatFilter);
  }

  if (search) {
    const tokens = search.split(/\s+/).filter(Boolean);
    filtered = filtered.filter((s) => {
      const target = (s.title + " " + s.id).toLowerCase();
      return tokens.every((tok) => target.includes(tok));
    });

    // Score and rank matches: exact title match or prefix match first
    filtered.sort((a, b) => {
      const aTitle = a.title.toLowerCase();
      const bTitle = b.title.toLowerCase();
      const aExact = aTitle === search;
      const bExact = bTitle === search;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      const aStarts = aTitle.startsWith(search) || a.id.startsWith(search);
      const bStarts = bTitle.startsWith(search) || b.id.startsWith(search);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      // Prominent styles ranked higher
      if (a.prominent && !b.prominent) return -1;
      if (!a.prominent && b.prominent) return 1;

      return a.title.localeCompare(b.title);
    });
  } else {
    // If no search query, prominent styles first, then alphabetical
    filtered = [...filtered].sort((a, b) => {
      if (a.prominent && !b.prominent) return -1;
      if (!a.prominent && b.prominent) return 1;
      return a.title.localeCompare(b.title);
    });
  }

  const total = filtered.length;
  const paginated = filtered.slice(offset, offset + limit);

  return { styles: paginated, total };
}

/**
 * Validates style ID against strict [a-z0-9-]+ allowlist pattern to prevent path traversal or SSRF.
 */
export function sanitizeStyleId(rawId: string): string {
  const trimmed = (rawId || "").toLowerCase().trim();
  if (!trimmed || !/^[a-z0-9-]+$/.test(trimmed)) {
    throw new Error("Invalid style ID.");
  }
  return trimmed;
}

/**
 * Validates optional revision SHA/tag to prevent path traversal or SSRF.
 */
export function sanitizeRevisionSha(rawRev?: string): string | undefined {
  if (!rawRev) return undefined;
  const trimmed = rawRev.trim();
  if (!trimmed || trimmed.includes("..") || !/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new Error("Invalid revision identifier.");
  }
  return trimmed;
}

/**
 * Resolves and loads the CSL XML for any requested style (bundled, independent, or dependent).
 * Performs parent resolution automatically if the style is dependent on an independent parent.
 * Resolves from runtime persistent catalog manager, or falls back to pinned v1.0.2 upstream / bundled styles.
 */
export async function getStyleXml(
  styleId: string,
  rawRevisionSha?: string
): Promise<{
  xml: string;
  id: string;
  title: string;
  format: CslCitationFormat;
  isDependent: boolean;
  parentId?: string;
  revisionSha?: string;
}> {
  const cleanId = sanitizeStyleId(styleId);
  const revisionSha = sanitizeRevisionSha(rawRevisionSha);
  const cacheKey = revisionSha ? `${revisionSha}:${cleanId}` : cleanId;

  // 1. Check in-memory cache
  if (styleXmlCache.has(cacheKey)) {
    const cached = styleXmlCache.get(cacheKey)!;
    return {
      xml: cached.xml,
      id: cleanId,
      title: cached.title,
      format: cached.format,
      isDependent: false,
      revisionSha,
    };
  }

  // 2. Direct check for bundled styles when no historical revision is requested
  const bundled = (BUNDLED_STYLES as any)[cleanId];
  if (bundled && !revisionSha) {
    return {
      xml: bundled.xml,
      id: cleanId,
      title: bundled.title,
      format: bundled.format,
      isDependent: false,
      revisionSha: "bundled",
    };
  }

  // 3. Resolve from persistent catalog manager (Prisma or InMemory adapter)
  try {
    const { CslCatalogManager } = await import("./updater/catalog-storage");
    const catalogEntry = await CslCatalogManager.resolveStyleXml(cleanId, revisionSha);
    if (catalogEntry && catalogEntry.xml && catalogEntry.xml.includes("<style")) {
      const titleMatch = catalogEntry.xml.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : catalogEntry.title || cleanId;

      let format: CslCitationFormat = "numeric";
      const formatMatch = catalogEntry.xml.match(/<category[^>]+citation-format=["']([^"']+)["']/i);
      if (formatMatch) {
        const f = formatMatch[1].toLowerCase();
        if (f === "author-date" || f === "numeric" || f === "note" || f === "label") {
          format = f as CslCitationFormat;
        }
      }

      const isDependent = catalogEntry.xml.includes('rel="independent-parent"');
      let parentId: string | undefined = undefined;

      if (isDependent) {
        const parentMatch =
          catalogEntry.xml.match(/rel=["']independent-parent["'][^>]+href=["']https?:\/\/(?:www\.)?zotero\.org\/styles\/([^"'\s]+)["']/i) ||
          catalogEntry.xml.match(/href=["']https?:\/\/(?:www\.)?zotero\.org\/styles\/([^"'\s]+)["'][^>]+rel=["']independent-parent["']/i);

        if (parentMatch && parentMatch[1]) {
          parentId = parentMatch[1];
          const parentStyle = await getStyleXml(parentId, revisionSha || catalogEntry.revisionSha);
          styleXmlCache.set(cacheKey, {
            xml: parentStyle.xml,
            title,
            format: parentStyle.format,
          });

          return {
            xml: parentStyle.xml,
            id: cleanId,
            title,
            format: parentStyle.format,
            isDependent: true,
            parentId,
            revisionSha: catalogEntry.revisionSha,
          };
        }
      }

      styleXmlCache.set(cacheKey, {
        xml: catalogEntry.xml,
        title,
        format,
      });

      return {
        xml: catalogEntry.xml,
        id: cleanId,
        title,
        format,
        isDependent: false,
        revisionSha: catalogEntry.revisionSha,
      };
    }
  } catch (err: any) {
    // If catalog manager lookup fails, proceed to upstream/bundled fallback
  }

  // 4. Fetch from official GitHub repository pinned to branch v1.0.2 or specific commit SHA
  // Only fetch/cache if the style ID is in the bundled or indexed styles allowlist
  const isAllowedIndexedStyle = isKnownIndexedStyleId(cleanId);
  const branchOrSha = revisionSha || "v1.0.2";
  let rawXml = "";
  let isDependent = false;
  let resolvedParentId: string | undefined = undefined;

  if (isAllowedIndexedStyle) {
    try {
      const independentUrl = `https://raw.githubusercontent.com/citation-style-language/styles/${branchOrSha}/${cleanId}.csl`;
      let res = await fetch(independentUrl, { next: { revalidate: 86400 } });

      if (res.ok) {
        rawXml = await res.text();
      } else {
        const dependentUrl = `https://raw.githubusercontent.com/citation-style-language/styles/${branchOrSha}/dependent/${cleanId}.csl`;
        res = await fetch(dependentUrl, { next: { revalidate: 86400 } });
        if (res.ok) {
          rawXml = await res.text();
          isDependent = true;
        }
      }
    } catch (fetchErr: any) {
      // Network failure
    }
  }

  // 5. If fetch failed or yielded invalid XML:
  if (!rawXml || !rawXml.includes("<style") || !rawXml.includes("</style>")) {
    // If a specific historical revision was requested, NEVER return newer bundled styles
    if (revisionSha) {
      throw new Error(`CSL Style '${cleanId}' is unavailable in requested historical revision '${revisionSha}'.`);
    }

    if (bundled) {
      return {
        xml: bundled.xml,
        id: cleanId,
        title: bundled.title,
        format: bundled.format,
        isDependent: false,
        revisionSha: "bundled-fallback",
      };
    }

    // Emergency core fallback to APA 7th ONLY for unversioned live requests
    const fallbackApa = BUNDLED_STYLES["apa"];
    return {
      xml: fallbackApa.xml,
      id: "apa",
      title: "American Psychological Association 7th edition (Fallback)",
      format: "author-date",
      isDependent: false,
      revisionSha: "bundled-fallback",
    };
  }

  // Security validation: Prohibit XXE, SYSTEM/PUBLIC entities, oversized XML
  const { validateCslXmlSecurity } = await import("./updater/xml-validator");
  validateCslXmlSecurity(rawXml);

  // Extract title
  const titleMatch = rawXml.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : cleanId;

  // Extract format
  let format: CslCitationFormat = "numeric";
  const formatMatch = rawXml.match(/<category[^>]+citation-format=["']([^"']+)["']/i);
  if (formatMatch) {
    const f = formatMatch[1].toLowerCase();
    if (f === "author-date" || f === "numeric" || f === "note" || f === "label") {
      format = f as CslCitationFormat;
    }
  }

  // If dependent, resolve parent
  if (isDependent) {
    const parentMatch =
      rawXml.match(/rel=["']independent-parent["'][^>]+href=["']https?:\/\/(?:www\.)?zotero\.org\/styles\/([^"'\s]+)["']/i) ||
      rawXml.match(/href=["']https?:\/\/(?:www\.)?zotero\.org\/styles\/([^"'\s]+)["'][^>]+rel=["']independent-parent["']/i);

    if (parentMatch && parentMatch[1]) {
      resolvedParentId = parentMatch[1];
      const parentStyle = await getStyleXml(resolvedParentId, revisionSha);
      styleXmlCache.set(cacheKey, {
        xml: parentStyle.xml,
        title,
        format: parentStyle.format,
      });

      return {
        xml: parentStyle.xml,
        id: cleanId,
        title,
        format: parentStyle.format,
        isDependent: true,
        parentId: resolvedParentId,
        revisionSha,
      };
    }
  }

  // Cache independent style
  styleXmlCache.set(cacheKey, {
    xml: rawXml,
    title,
    format,
  });

  return {
    xml: rawXml,
    id: cleanId,
    title,
    format,
    isDependent: false,
    revisionSha,
  };
}
