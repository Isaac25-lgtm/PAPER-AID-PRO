import { DocumentType } from "@prisma/client";

export interface GuidedDocumentConfig {
  topic: string;
  docType: DocumentType;
  studyDesign?: string;
  generalObjective?: string;
  specificObjectives?: string[];
  headings: string[];
}

export const STUDY_DESIGN_OPTIONS: Record<DocumentType, string[]> = {
  MANUSCRIPT: [
    "Randomized Controlled Trial (RCT)",
    "Prospective Cohort Study",
    "Retrospective Observational Study",
    "Experimental / Laboratory Study",
    "Cross-Sectional Investigation",
    "Deep Learning Benchmark / Algorithmic Evaluation",
  ],
  PROPOSAL: [
    "Prospective Clinical Trial Protocol",
    "Longitudinal Multi-Center Cohort Proposal",
    "Exploratory Pilot Grant Framework",
    "Translational Technology Validation Plan",
  ],
  LITERATURE_REVIEW: [
    "Critical Thematic Narrative Review",
    "PRISMA-Compliant Systematic Literature Review",
    "Scoping Review Protocol",
    "Meta-Analysis & Quantitative Synthesis",
  ],
  DRAFT: [
    "Doctoral Dissertation (Monograph)",
    "Master's Thesis",
    "Cumulative / Article-Based Dissertation Framework",
    "Exploratory Academic Research Thesis",
  ],
};

/**
 * Returns canonical academic headings tailored to document type and optional study design.
 */
export function getDefaultHeadings(docType: DocumentType, studyDesign?: string): string[] {
  const designLower = (studyDesign || "").toLowerCase();

  switch (docType) {
    case DocumentType.MANUSCRIPT:
      if (designLower.includes("randomized") || designLower.includes("rct")) {
        return [
          "Structured Abstract",
          "Introduction & Clinical Rationale",
          "Trial Design, Participant Eligibility & Randomization",
          "Intervention Protocols & Outcome Measures",
          "Statistical Analysis & Baseline Characteristics",
          "Primary & Secondary Trial Results",
          "Discussion, Adverse Events & Generalizability",
          "References",
        ];
      }
      return [
        "Abstract",
        "Introduction & Theoretical Background",
        "Research Objectives & Hypotheses",
        "Materials & Methods",
        "Results & Empirical Findings",
        "Discussion & Scholarly Implications",
        "Study Limitations & Ethical Considerations",
        "References",
      ];
    case DocumentType.PROPOSAL:
      return [
        "Project Summary & Specific Aims",
        "Background, Significance & Innovation",
        "Preliminary Data & Methodological Feasibility",
        "Research Design & Experimental Protocol",
        "Timeline, Milestones & Deliverables",
        "Potential Pitfalls & Alternative Strategies",
        "References",
      ];
    case DocumentType.LITERATURE_REVIEW:
      // PRISMA headings apply ONLY when a PRISMA systematic review design is explicitly chosen
      if (designLower.includes("prisma") || designLower.includes("systematic")) {
        return [
          "Structured Abstract (PRISMA Scope)",
          "Introduction & Review Rationale",
          "Eligibility Criteria & Information Sources",
          "Search Strategy, Study Selection & Data Extraction (PRISMA Flow)",
          "Risk of Bias Assessment & Critical Appraisal",
          "Synthesis of Results & Study Characteristics",
          "Discussion, Limitations & Evidentiary Gaps",
          "References",
        ];
      }
      if (designLower.includes("meta-analysis")) {
        return [
          "Abstract & Quantitative Objectives",
          "Introduction & Theoretical Framing",
          "Search Strategy & Inclusion Criteria",
          "Statistical Methods & Effect Size Estimation",
          "Meta-Analytic Findings & Heterogeneity Analysis",
          "Publication Bias & Sensitivity Analyses",
          "Discussion & Practice Implications",
          "References",
        ];
      }
      if (designLower.includes("scoping")) {
        return [
          "Abstract & Review Scope",
          "Introduction & Background",
          "Review Questions & Conceptual Framework",
          "Inclusion Criteria & Evidence Mapping Methodology",
          "Charted Results & Evidence Distribution",
          "Discussion & Implications for Future Research",
          "References",
        ];
      }
      // Standard / Critical Thematic Narrative Review (Default - NOT PRISMA)
      return [
        "Abstract & Topic Scope",
        "Introduction & Theoretical Background",
        "Literature Search Strategy & Conceptual Framework",
        "Thematic Synthesis of Published Evidence",
        "Methodological Evaluation & Critical Perspectives",
        "Unresolved Scientific Questions & Future Directions",
        "References",
      ];
    case DocumentType.DRAFT:
      if (designLower.includes("dissertation") || designLower.includes("thesis")) {
        return [
          "Abstract",
          "Chapter 1: Introduction & Research Problem",
          "Chapter 2: Literature Review & Theoretical Framework",
          "Chapter 3: Methodology & Experimental Design",
          "Chapter 4: Results & Empirical Findings",
          "Chapter 5: Discussion & Scholarly Contributions",
          "Chapter 6: Conclusions & Future Research Directions",
          "References",
          "Appendices",
        ];
      }
      return [
        "Abstract",
        "Introduction & Research Problem",
        "Literature Review",
        "Methodological Approach",
        "Findings & Empirical Observations",
        "Discussion & Scholarly Implications",
        "Conclusions",
        "References",
      ];
    default:
      return [
        "Introduction",
        "Methodological Approach",
        "Findings & Observations",
        "Discussion",
        "References",
      ];
  }
}

/**
 * Generates initial general and specific objectives tailored to topic, document type, and study design.
 */
export function getDefaultObjectives(
  topic: string,
  docType: DocumentType,
  studyDesign?: string
): { general: string; specific: string[] } {
  const cleanTopic = (topic || "").trim() || "the specified research problem";
  const designLower = (studyDesign || "").toLowerCase();

  if (docType === DocumentType.PROPOSAL) {
    return {
      general: `To formulate, validate, and experimentally execute a rigorous protocol investigating ${cleanTopic}.`,
      specific: [
        `Establish standardized baseline metrics and evaluation benchmarks for ${cleanTopic}.`,
        `Validate experimental hypotheses across controlled cohorts using ${studyDesign || "robust scientific protocols"}.`,
        `Quantify protocol sensitivity, assess methodological feasibility, and establish reproducible research deliverables.`,
      ],
    };
  }

  if (docType === DocumentType.LITERATURE_REVIEW) {
    if (designLower.includes("prisma") || designLower.includes("systematic")) {
      return {
        general: `To conduct a PRISMA-compliant systematic review of peer-reviewed empirical evidence regarding ${cleanTopic}.`,
        specific: [
          `Execute a protocol-driven search across academic databases with predefined eligibility criteria for ${cleanTopic}.`,
          `Appraise risk of bias and methodological quality across all included empirical studies.`,
          `Synthesize findings quantitatively and narratively according to PRISMA reporting standards.`,
        ],
      };
    }
    if (designLower.includes("meta-analysis")) {
      return {
        general: `To quantitatively synthesize effect sizes and evaluate heterogeneity across empirical investigations of ${cleanTopic}.`,
        specific: [
          `Extract quantitative outcome metrics and calculate pooled effect sizes for ${cleanTopic}.`,
          `Evaluate statistical heterogeneity across diverse study cohorts and trial designs.`,
          `Perform sensitivity analysis and publication bias assessment to test synthesized robustness.`,
        ],
      };
    }
    if (designLower.includes("scoping")) {
      return {
        general: `To map key concepts, evidence types, and knowledge boundaries across scholarly literature concerning ${cleanTopic}.`,
        specific: [
          `Identify the scope, range, and nature of existing research on ${cleanTopic}.`,
          `Chart and categorize conceptual frameworks and methodological approaches in the literature.`,
          `Clarify working definitions and identify unaddressed evidentiary gaps for subsequent research.`,
        ],
      };
    }
    // Default Narrative Literature Review - No PRISMA claim
    return {
      general: `To synthesize, contextualize, and critically evaluate theoretical paradigms and scholarly discussions surrounding ${cleanTopic}.`,
      specific: [
        `Identify and categorize primary conceptual paradigms deployed in research on ${cleanTopic}.`,
        `Synthesize thematic insights and contrasting perspectives across published literature.`,
        `Explicate persistent evidentiary gaps, methodological limitations, and future research opportunities.`,
      ],
    };
  }

  if (docType === DocumentType.DRAFT) {
    return {
      general: `To make an original scholarly contribution by systematically investigating the theoretical foundations and empirical dynamics of ${cleanTopic}.`,
      specific: [
        `Critically synthesize foundational scholarship and establish the theoretical framework governing ${cleanTopic}.`,
        `Design, validate, and execute an advanced methodological investigation of ${cleanTopic}.`,
        `Formulate novel empirical insights, defend scholarly contributions, and discuss implications for the academic field.`,
      ],
    };
  }

  // Default / MANUSCRIPT
  return {
    general: `To investigate, quantify, and empirically characterize the dynamics of ${cleanTopic}.`,
    specific: [
      `Formulate and execute a controlled experimental evaluation of ${cleanTopic}.`,
      `Evaluate empirical outcomes against state-of-the-art benchmarks and multi-cohort data.`,
      `Identify boundary conditions, delineate systematic limitations, and discuss theoretical implications.`,
    ],
  };
}

/**
 * Returns placeholder guidance text for a given outline section.
 */
export function getSectionGuidance(
  heading: string,
  docType: DocumentType,
  studyDesign?: string
): string {
  const lower = heading.toLowerCase();

  if (lower.includes("abstract")) {
    return "Provide a concise synthesis outlining the scientific background, core objectives, methodology, primary findings, and broader impact of this work.";
  }
  if (lower.includes("intro") || lower.includes("background")) {
    return "Establish the empirical rationale and scholarly context. Articulate existing gaps in the literature and justify why this investigation is necessary.";
  }
  if (lower.includes("objective") || lower.includes("aims") || lower.includes("hypothes")) {
    return "State the primary and secondary hypotheses. Ensure alignment with the pre-specified research objectives and experimental design.";
  }
  if (lower.includes("method") || lower.includes("protocol") || lower.includes("design") || lower.includes("strategy")) {
    return `Detail the operational methodology${studyDesign ? ` (${studyDesign})` : ""}, including sampling criteria, measurement instruments, data validation procedures, and statistical protocols.`;
  }
  if (lower.includes("result") || lower.includes("finding") || lower.includes("synthesis")) {
    return "Present findings with strict objective neutrality. Report empirical observations, effect estimates, and statistical confidence intervals without premature speculative interpretation.";
  }
  if (lower.includes("discussion") || lower.includes("implication") || lower.includes("significance")) {
    return "Interpret the observations within the broader theoretical literature. Discuss how the findings address the stated research question and contrast with prior studies.";
  }
  if (lower.includes("limitation") || lower.includes("ethical") || lower.includes("pitfall")) {
    return "Candidly articulate methodological boundaries, potential selection or measurement biases, cohort constraints, and ethical safeguards.";
  }
  if (lower.includes("reference") || lower.includes("bibliograph")) {
    return REFERENCES_GUIDANCE_TEXT;
  }

  return "Draft section content here. Press Ctrl+J at any point to summon on-demand AI autocomplete grounded in your topic and approved objectives.";
}

export const REFERENCES_GUIDANCE_TEXT =
  "Insert citations directly from My Library or search Crossref/PubMed using the citation tools in the right-hand drawer.";

/**
 * Converts a GuidedDocumentConfig into a structured TipTap document schema with metadata.
 */
export function createGuidedTipTapContent(config: GuidedDocumentConfig) {
  const topicTitle = config.topic.trim() || "Untitled Guided Research Document";
  const docTypeLabel =
    config.docType === DocumentType.MANUSCRIPT
      ? "Original Research Manuscript"
      : config.docType === DocumentType.PROPOSAL
      ? "Research Grant Proposal"
      : config.docType === DocumentType.LITERATURE_REVIEW
      ? "Literature Review"
      : "Thesis / Dissertation";

  const content: any[] = [];

  // Title (Heading 1)
  content.push({
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text: topicTitle }],
  });

  // Metadata block (Paragraph)
  const metaRuns: any[] = [
    { type: "text", marks: [{ type: "bold" }], text: "Document Mode: " },
    { type: "text", text: `Guided (${docTypeLabel})` },
  ];

  if (config.studyDesign) {
    metaRuns.push(
      { type: "text", text: "  |  " },
      { type: "text", marks: [{ type: "bold" }], text: "Study Design: " },
      { type: "text", text: config.studyDesign }
    );
  }

  content.push({
    type: "paragraph",
    content: metaRuns,
  });

  // Primary Objective (if provided)
  if (config.generalObjective && config.generalObjective.trim()) {
    content.push({
      type: "paragraph",
      content: [
        { type: "text", marks: [{ type: "bold" }], text: "Primary Research Objective: " },
        { type: "text", text: config.generalObjective.trim() },
      ],
    });
  }

  // Approved Specific Objectives (Bullet List)
  const validSpecific = (config.specificObjectives || []).filter(
    (obj) => obj && obj.trim().length > 0
  );
  if (validSpecific.length > 0) {
    content.push({
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Approved Specific Objectives" }],
    });

    content.push({
      type: "bulletList",
      content: validSpecific.map((obj) => ({
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: obj.trim() }],
          },
        ],
      })),
    });
  }

  // Section Scaffold
  const headings = config.headings && config.headings.length > 0
    ? config.headings
    : getDefaultHeadings(config.docType, config.studyDesign);

  for (const heading of headings) {
    const trimmedHeading = heading.trim();
    if (!trimmedHeading) continue;

    content.push({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: trimmedHeading }],
    });

    content.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: getSectionGuidance(trimmedHeading, config.docType, config.studyDesign),
        },
      ],
    });
  }

  return {
    type: "doc",
    meta: {
      researchTopic: topicTitle,
      docType: config.docType,
      studyDesign: config.studyDesign || "",
      objectives: {
        general: config.generalObjective?.trim() || "",
        specific: validSpecific.map((o) => o.trim()),
      },
      headings: headings.map((h) => h.trim()),
    },
    content,
  };
}

/**
 * Normalizes suggestion text against preceding prefix to eliminate:
 * 1. Missing or duplicated whitespace between prefix and suggestion.
 * 2. Duplicate word overlaps (e.g. prefix ends with 'we evaluate' and suggestion starts with 'we evaluate').
 * 3. Misaligned sentence punctuation and capitalization.
 */
export function normalizeSuggestionSpacingAndDeduplication(
  prefix: string,
  rawSuggestion: string
): string {
  if (!rawSuggestion) return "";

  let suggestion = rawSuggestion.trim();
  const cleanPrefix = prefix || "";

  // 1. Detect duplicate overlapping words (from 1 to 6 words)
  const prefixWords = cleanPrefix.trim().split(/\s+/).filter(Boolean);
  const suggestionWords = suggestion.split(/\s+/).filter(Boolean);

  const maxOverlap = Math.min(6, prefixWords.length, suggestionWords.length);
  let overlapCount = 0;

  for (let k = maxOverlap; k >= 1; k--) {
    const endWords = prefixWords
      .slice(-k)
      .map((w) => w.toLowerCase().replace(/[^a-z0-9]/gi, ""));
    const startWords = suggestionWords
      .slice(0, k)
      .map((w) => w.toLowerCase().replace(/[^a-z0-9]/gi, ""));

    if (
      endWords.length === startWords.length &&
      endWords.every((w, idx) => w === startWords[idx] && w.length > 0)
    ) {
      overlapCount = k;
      break;
    }
  }

  if (overlapCount > 0) {
    suggestion = suggestionWords.slice(overlapCount).join(" ");
  }

  if (!suggestion) return "";

  // 2. Adjust capitalization based on prefix boundary
  const trimmedPrefixEnd = cleanPrefix.trimEnd();
  const endsWithSentenceBoundary = /[.!?]$/.test(trimmedPrefixEnd);
  const endsWithClauseBoundary = /[,;:]$/.test(trimmedPrefixEnd);

  if (endsWithSentenceBoundary) {
    suggestion = suggestion.charAt(0).toUpperCase() + suggestion.slice(1);
  } else if (endsWithClauseBoundary) {
    if (!/^[A-Z]{2,}\b/.test(suggestion) && !suggestion.startsWith("I ")) {
      suggestion = suggestion.charAt(0).toLowerCase() + suggestion.slice(1);
    }
  }

  return suggestion;
}
