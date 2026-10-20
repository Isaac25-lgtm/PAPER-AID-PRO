/**
 * AI RESEARCH HUB — PHASE 8B: SAFE CSL XML VALIDATOR & SECURITY SANDBOX
 *
 * Security Requirements:
 * 1. Prohibits XML External Entity (XXE) vectors (DOCTYPE, ENTITY, SYSTEM, PUBLIC).
 * 2. Enforces maximum XML payload limit (512 KB).
 * 3. Verifies official CSL namespace (http://purl.org/net/xbiblio/csl) and schema version.
 * 4. Extracts metadata (title, format, parent link, author/contributor attribution).
 * 5. Generates SHA-256 checksum for cryptographic content integrity.
 */

import crypto from "crypto";
import { CslCitationFormat } from "../types";
import { StyleValidationResult } from "./types";

const MAX_XML_SIZE_BYTES = 512 * 1024; // 512 KB limit per style
const CSL_NAMESPACE = "http://purl.org/net/xbiblio/csl";

export function validateCslXmlSecurity(rawXml: string, expectedStyleId?: string): StyleValidationResult {
  const errors: string[] = [];

  if (!rawXml || typeof rawXml !== "string") {
    return {
      valid: false,
      styleId: expectedStyleId || "unknown",
      errors: ["XML content is empty or not a string."],
    };
  }

  // 1. Enforce payload size limit
  const byteLength = Buffer.byteLength(rawXml, "utf8");
  if (byteLength > MAX_XML_SIZE_BYTES) {
    errors.push(`XML payload exceeds maximum safe size (${byteLength} bytes > ${MAX_XML_SIZE_BYTES} bytes).`);
  }

  // 2. Strict XXE & DTD Prohibition
  const forbiddenPatterns = [
    /<!DOCTYPE/i,
    /<!ENTITY/i,
    /SYSTEM\s+["']/i,
    /PUBLIC\s+["']/i,
    /<script/i,
    /<iframe/i,
    /xmlns:xi=/i, // XInclude
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(rawXml)) {
      errors.push(`XML contains prohibited external entity or unsafe directive: ${pattern.toString()}`);
    }
  }

  // 3. Verify CSL Root Structure
  const styleTagMatch = rawXml.match(/<style\b([^>]*)>/i);
  if (!styleTagMatch) {
    errors.push("Missing required <style> root element.");
  } else {
    const styleAttrs = styleTagMatch[1];
    if (!styleAttrs.includes(CSL_NAMESPACE)) {
      errors.push(`Missing required CSL namespace declaration: '${CSL_NAMESPACE}'.`);
    }
    const versionMatch = styleAttrs.match(/version=["']([^"']+)["']/i);
    if (!versionMatch || !versionMatch[1].startsWith("1.")) {
      errors.push(`Unsupported or missing CSL version: '${versionMatch ? versionMatch[1] : "none"}'. Expected v1.0.x.`);
    }
  }

  if (!rawXml.includes("</style>")) {
    errors.push("Malformed XML: missing closing </style> tag.");
  }

  // 4. Extract Title
  const titleMatch = rawXml.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : undefined;
  if (!title) {
    errors.push("Missing required <title> element inside <info>.");
  }

  // 5. Extract Style ID / Canonical Link
  const idMatch = rawXml.match(/<id>([^<]+)<\/id>/i);
  let styleId = expectedStyleId || "";
  if (idMatch) {
    const idUri = idMatch[1].trim();
    const extractedId = idUri.split("/").pop();
    if (!styleId && extractedId) {
      styleId = extractedId;
    }
  }

  if (expectedStyleId && styleId && styleId !== expectedStyleId) {
    // Some CSL styles have slightly different IDs in <id> tag than filename. Warn if they differ drastically.
    if (!styleId.includes(expectedStyleId) && !expectedStyleId.includes(styleId)) {
      errors.push(`Style ID mismatch: expected '${expectedStyleId}', found '${styleId}'.`);
    }
  }

  // 6. Detect Independent vs. Dependent and Parent ID
  let isDependent = false;
  let parentId: string | undefined = undefined;

  const parentMatch =
    rawXml.match(/rel=["']independent-parent["'][^>]+href=["']https?:\/\/(?:www\.)?zotero\.org\/styles\/([^"'\s]+)["']/i) ||
    rawXml.match(/href=["']https?:\/\/(?:www\.)?zotero\.org\/styles\/([^"'\s]+)["'][^>]+rel=["']independent-parent["']/i);

  if (parentMatch && parentMatch[1]) {
    isDependent = true;
    parentId = parentMatch[1].trim();
  }

  // 7. Extract Citation Format
  let format: CslCitationFormat = "numeric";
  const formatMatch = rawXml.match(/<category[^>]+citation-format=["']([^"']+)["']/i);
  if (formatMatch) {
    const f = formatMatch[1].toLowerCase();
    if (f === "author-date" || f === "numeric" || f === "note" || f === "label") {
      format = f as CslCitationFormat;
    }
  }

  // 8. Compute Checksum
  const checksum = crypto.createHash("sha256").update(rawXml, "utf8").digest("hex");

  return {
    valid: errors.length === 0,
    styleId: styleId || expectedStyleId || "unknown",
    title,
    format,
    isDependent,
    parentId,
    checksum,
    errors,
  };
}

/**
 * Asserts XML security and schema compliance, throwing an Error if invalid.
 */
export function assertCslXmlSecurity(rawXml: string, expectedStyleId?: string): StyleValidationResult {
  const result = validateCslXmlSecurity(rawXml, expectedStyleId);
  if (!result.valid) {
    throw new Error(`CSL XML security validation failed: ${result.errors.join("; ")}`);
  }
  return result;
}

