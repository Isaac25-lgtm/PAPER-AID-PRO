/**
 * AI RESEARCH HUB — PHASE 8B: STYLE VALIDATOR & SMOKE TEST RUNNER
 *
 * Requirements:
 * 1. Validates XML syntax, schema compatibility, and security rules.
 * 2. Verifies dependent parent resolution (parent style must exist in catalog).
 * 3. Compiles style XML inside official citeproc-js engine to verify processor compatibility.
 * 4. Executes regression checks against core citation formats (APA, Vancouver, IEEE).
 */

import { validateCslXmlSecurity } from "./xml-validator";
import { StyleValidationResult } from "./types";
import { createCiteprocEngine, renderCitationCluster, renderBibliography } from "../csl-engine";
import { EN_US_LOCALE_XML } from "../locales/en-US";
import { BUNDLED_STYLES } from "../styles/bundled-styles";
import { CslItem } from "../types";

const SMOKE_TEST_ITEMS: Record<string, CslItem> = {
  "test-ref-1": {
    id: "test-ref-1",
    type: "article-journal",
    title: "Empirical Evaluation of Machine Learning Architectures",
    author: [
      { family: "Turing", given: "Alan M." },
      { family: "Lovelace", given: "Ada" },
    ],
    issued: { "date-parts": [[2024, 5, 12]] },
    "container-title": "Journal of AI Research",
    volume: "42",
    issue: "2",
    page: "101-118",
    DOI: "10.1000/182",
  },
};

export class CslStyleValidator {
  /**
   * Validates a single style XML string, checking XML security and Citeproc compilation.
   * If dependent, optionally verifies parent XML or parent existence.
   */
  static validateStyle(
    styleId: string,
    xml: string,
    parentXmlSupplier?: (parentId: string) => string | undefined,
    catalogIds?: Set<string>
  ): StyleValidationResult {
    // 1. Security & structural check
    const secResult = validateCslXmlSecurity(xml, styleId);
    if (!secResult.valid) {
      return secResult;
    }

    const errors: string[] = [...secResult.errors];

    // 2. Dependent Parent Resolution Check
    let effectiveXml = xml;
    if (secResult.isDependent) {
      if (!secResult.parentId) {
        errors.push(`Dependent style '${styleId}' is missing an independent-parent link.`);
      } else {
        const parentId = secResult.parentId;

        if (catalogIds && !catalogIds.has(parentId)) {
          errors.push(
            `Dependent style '${styleId}' references parent '${parentId}', which does not exist in catalog.`
          );
        }

        if (parentXmlSupplier) {
          const parentXml = parentXmlSupplier(parentId);
          if (!parentXml) {
            errors.push(`Could not resolve parent XML for '${parentId}' referenced by '${styleId}'.`);
          } else {
            effectiveXml = parentXml;
          }
        }
      }
    }

    // 3. Citeproc Engine Compilation & Smoke Test (Only for independent styles or resolved dependents)
    const canTestCiteproc = !secResult.isDependent || (secResult.isDependent && parentXmlSupplier && effectiveXml !== xml);
    if (errors.length === 0 && canTestCiteproc && effectiveXml) {
      try {
        const engine = createCiteprocEngine(
          effectiveXml,
          SMOKE_TEST_ITEMS,
          EN_US_LOCALE_XML,
          "en-US"
        );

        const cluster = {
          citationID: "smoke-cit-1",
          citationItems: [{ id: "test-ref-1" }],
          properties: { noteIndex: 0 },
        };

        const renderedCitation = renderCitationCluster(engine, cluster);
        if (!renderedCitation || typeof renderedCitation !== "string") {
          errors.push(`Citeproc failed to produce valid in-text citation string.`);
        }

        const bib = renderBibliography(engine, styleId, secResult.title || styleId, secResult.format || "numeric");
        if (secResult.format !== "note" && bib.entries.length === 0) {
          errors.push(`Citeproc produced empty bibliography for valid input reference.`);
        }
      } catch (err: any) {
        errors.push(`Citeproc compiler error for style '${styleId}': ${err.message}`);
      }
    }

    return {
      valid: errors.length === 0,
      styleId,
      title: secResult.title,
      format: secResult.format,
      isDependent: secResult.isDependent,
      parentId: secResult.parentId,
      checksum: secResult.checksum,
      errors,
    };
  }

  /**
   * Verifies that core styles have not suffered regressions.
   */
  static runCoreStyleRegressions(): { passed: boolean; failures: string[] } {
    const failures: string[] = [];

    const coreStyles = ["apa", "vancouver", "ieee"];
    for (const styleId of coreStyles) {
      const def = (BUNDLED_STYLES as any)[styleId];
      if (!def || !def.xml) {
        failures.push(`Bundled core style '${styleId}' is missing XML.`);
        continue;
      }

      const res = this.validateStyle(styleId, def.xml);
      if (!res.valid) {
        failures.push(`Core style regression failure for '${styleId}': ${res.errors.join("; ")}`);
      }
    }

    return {
      passed: failures.length === 0,
      failures,
    };
  }
}
