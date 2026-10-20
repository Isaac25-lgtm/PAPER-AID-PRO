/**
 * AI RESEARCH HUB — CSL Citation System Barrel Export
 *
 * Client-safe exports for formatting, mapping, exporting, and sanitizing.
 * Server-only updater and catalog synchronization logic is exported via
 * `@/lib/citations/csl/updater`.
 */

export * from "./types";
export * from "./csl-engine";
export * from "./csl-mapper";
export * from "./bibtex-ris-exporter";
export * from "./styles/bundled-styles";
export * from "./locales/en-US";
export * from "./html-sanitizer";

// Client-safe type declarations for catalog revisions
export type * from "./updater/types";
