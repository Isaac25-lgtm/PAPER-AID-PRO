/**
 * Deterministic Section Heading Detector for Academic Manuscripts.
 * Identifies standard peer-reviewed manuscript sections without invoking an LLM.
 */

export interface SectionMatch {
  canonicalName: string;
  matchedHeading: string;
}

// Canonical academic section patterns mapped to standard names
const SECTION_PATTERNS: Array<{ canonical: string; regex: RegExp }> = [
  {
    canonical: "Abstract",
    regex: /^(?:(?:\d+\.?\s*)?abstract|summary)\b/i,
  },
  {
    canonical: "Introduction",
    regex: /^(?:(?:\d+|[ivx]+)\.?\s*)?(?:introduction|motivation|problem statement)\b/i,
  },
  {
    canonical: "Background",
    regex: /^(?:(?:\d+|[ivx]+)\.?\s*)?(?:background|related work|prior work|literature review)\b/i,
  },
  {
    canonical: "Methods",
    regex: /^(?:(?:\d+|[ivx]+)\.?\s*)?(?:methods?|methodology|materials and methods|experimental setup|model architecture|system design|proposed approach)\b/i,
  },
  {
    canonical: "Results",
    regex: /^(?:(?:\d+|[ivx]+)\.?\s*)?(?:results?|experiments?|experimental results|evaluation|empirical analysis|findings)\b/i,
  },
  {
    canonical: "Discussion",
    regex: /^(?:(?:\d+|[ivx]+)\.?\s*)?(?:discussion|implications|interpretations)\b/i,
  },
  {
    canonical: "Limitations",
    regex: /^(?:(?:\d+|[ivx]+)\.?\s*)?(?:limitations?|failure modes|threats to validity)\b/i,
  },
  {
    canonical: "Conclusion",
    regex: /^(?:(?:\d+|[ivx]+)\.?\s*)?(?:conclusions?|concluding remarks|summary and outlook|future work)\b/i,
  },
  {
    canonical: "References",
    regex: /^(?:references|bibliography|works cited|citations)\b/i,
  },
  {
    canonical: "Appendix",
    regex: /^(?:appendix(?:\s+[a-z0-9]+)?|supplementary material|supplementary information)\b/i,
  },
];

/**
 * Checks if a specific text line constitutes an academic section heading.
 */
export function detectSectionHeading(line: string): SectionMatch | null {
  const trimmed = line.trim();

  // Headings are typically concise (less than 75 characters) and not full sentences ending in punctuation
  if (!trimmed || trimmed.length > 75 || trimmed.endsWith(".") && trimmed.length > 30) {
    return null;
  }

  // Strip common leading section numbering like "1. ", "1.1 ", "II. ", "Section 3: "
  const stripped = trimmed
    .replace(/^(?:section\s+)?(?:\d+(?:\.\d+)*|[ivx]+)\.?\s*[:\-–]?\s*/i, "")
    .trim();

  for (const { canonical, regex } of SECTION_PATTERNS) {
    if (regex.test(trimmed) || (stripped && regex.test(stripped))) {
      return {
        canonicalName: canonical,
        matchedHeading: trimmed,
      };
    }
  }

  return null;
}
