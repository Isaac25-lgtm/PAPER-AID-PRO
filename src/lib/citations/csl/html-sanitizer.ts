import { decodeHtmlEntities } from "./csl-engine";

/**
 * AI RESEARCH HUB — CSL HTML OUTPUT SANITIZER
 *
 * Implements a strict, zero-dependency allowlist sanitization strategy
 * for Citation Style Language (CSL) and bibliographic HTML output.
 *
 * Guarantees:
 * 1. Absolute rejection of script, iframe, object, embed, svg, form, and link tags.
 * 2. Absolute stripping of all inline event handlers (onerror, onload, onclick, etc.).
 * 3. Strict allowlist for academic formatting tags: <i>, <em>, <b>, <strong>, <sup>, <sub>, <span>, <div>, <p>, <br>.
 * 4. Safe attribute allowlist: class (CSL layout) and safe typographic style properties.
 * 5. Safe conversion to plain text preserving mathematical symbols and whitespace.
 */

const ALLOWED_TAGS = new Set([
  "i",
  "em",
  "b",
  "strong",
  "sup",
  "sub",
  "span",
  "div",
  "p",
  "br",
  "ul",
  "ol",
  "li",
]);

const SAFE_STYLE_REGEX =
  /^(?:(?:font-style:\s*italic|font-weight:\s*(?:bold|[0-9]{3})|font-variant:\s*small-caps|display:\s*inline(?:-block)?|margin-left:\s*[-0-9.]+(?:em|px|rem)|padding-left:\s*[-0-9.]+(?:em|px|rem)|text-indent:\s*[-0-9.]+(?:em|px|rem)|line-height:\s*[-0-9.]+)(?:;\s*|$))+$/i;

/**
 * Sanitizes CSL HTML output to conform strictly to the safe academic formatting allowlist.
 */
export function sanitizeCslHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== "string") {
    return "";
  }

  // 1. Remove dangerous blocks and their contents entirely
  let clean = rawHtml
    .replace(/<(script|style|noscript|template|iframe|object|embed|svg|math|form|link|meta)[\s\S]*?(?:<\/\1>|$)/gi, "")
    // 2. Remove dangerous void tags
    .replace(/<(img|video|audio|input|source|track|base|frame|frameset|applet)[^>]*>/gi, "");

  // 3. Strip all inline event handlers (e.g. onclick, onerror, onload)
  clean = clean.replace(/\s+on[a-z0-9_-]+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, "");

  // 4. Strip dangerous URI schemes from any attribute
  clean = clean.replace(/\s+[a-z_-]+\s*=\s*(?:'[^']*(?:javascript|vbscript|data):[^']*'|"[^"]*(?:javascript|vbscript|data):[^"]*"|[^\s>]*(?:javascript|vbscript|data):[^\s>]*)/gi, "");

  // 5. Parse and filter tags against allowlist
  clean = clean.replace(/<\/?([a-zA-Z0-9]+)((?:\s+[^>]*?)?)\s*(\/?)>/g, (match, tagName, rawAttrs, selfClose) => {
    const lowerTag = tagName.toLowerCase();
    const isClosing = match.startsWith("</");

    // If tag is not in allowlist, strip the tag markers completely
    if (!ALLOWED_TAGS.has(lowerTag)) {
      return "";
    }

    if (isClosing) {
      return `</${lowerTag}>`;
    }

    // Inspect attributes
    const allowedAttrs: string[] = [];

    // Check class attribute
    const classMatch = rawAttrs.match(/\bclass=(["'])(.*?)\1/i);
    if (classMatch) {
      const classValue = classMatch[2].trim();
      // Allow only valid CSL and utility class names (alphanumeric, hyphen, underscore)
      if (/^[a-zA-Z0-9_\-\s]+$/.test(classValue)) {
        allowedAttrs.push(`class="${classValue}"`);
      }
    }

    // Check style attribute
    const styleMatch = rawAttrs.match(/\bstyle=(["'])(.*?)\1/i);
    if (styleMatch) {
      const styleValue = styleMatch[2].trim();
      if (SAFE_STYLE_REGEX.test(styleValue)) {
        allowedAttrs.push(`style="${styleValue}"`);
      }
    }

    // Check role attribute (e.g. role="doc-biblioentry")
    const roleMatch = rawAttrs.match(/\brole=(["'])(doc-[a-z]+|[a-z]+)\1/i);
    if (roleMatch) {
      allowedAttrs.push(`role="${roleMatch[2]}"`);
    }

    const attrsString = allowedAttrs.length > 0 ? " " + allowedAttrs.join(" ") : "";
    const isSelfClosing = selfClose === "/" || lowerTag === "br";

    return `<${lowerTag}${attrsString}${isSelfClosing ? " /" : ""}>`;
  });

  return clean.trim();
}

/**
 * Safely converts CSL HTML output to clean plain text.
 * Preserves mathematical symbols (<, >, &) and formatting whitespace.
 */
export function cslToPlainText(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== "string") {
    return "";
  }

  // Convert line breaks and margin dividers to spaces
  const spaced = rawHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>\s*<div class=["']csl-right-inline["']>/gi, " ")
    .replace(/<\/div>\s*<div/gi, "\n");

  // Strip all HTML tags
  const stripped = spaced.replace(/<[^>]+>/g, "");

  // Decode standard HTML entities
  return decodeHtmlEntities(stripped).trim();
}
