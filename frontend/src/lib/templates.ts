// Guided document templates: study-design-specific outlines, objectives and section guidance.
// Ported from the original PaperAid editor (guided-templates.ts) and adapted to the v2 document types.
import type { DocumentType, JSONContent } from "./types";

export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  manuscript: "Original research manuscript",
  proposal: "Research / grant proposal",
  literature_review: "Literature review",
  thesis: "Thesis / dissertation",
  report: "Report",
  draft: "Blank draft",
};

/** Designs grouped by research approach, so every discipline finds its own (not only health and STEM). */
export const DESIGN_GROUPS: Record<DocumentType, { group: string; designs: string[] }[]> = {
  manuscript: [
    {
      group: "Quantitative",
      designs: [
        "Survey / Questionnaire Study",
        "Quasi-Experimental Study",
        "Randomized Controlled Trial (RCT)",
        "Prospective Cohort Study",
        "Retrospective Observational Study",
        "Cross-Sectional Investigation",
        "Correlational / Secondary Data Analysis",
        "Experimental / Laboratory Study",
      ],
    },
    {
      group: "Qualitative",
      designs: [
        "Qualitative Interview / Focus-Group Study",
        "Case Study",
        "Ethnography",
        "Phenomenological Study",
        "Grounded Theory Study",
        "Discourse / Document Analysis",
      ],
    },
    { group: "Mixed & participatory", designs: ["Mixed-Methods Study", "Action Research"] },
    {
      group: "Humanities & law",
      designs: ["Argumentative / Critical Essay", "Historical / Archival Study", "Doctrinal Legal Research", "Comparative Law / Policy Analysis"],
    },
    {
      group: "Engineering & computing",
      designs: ["Design & Evaluation Study", "Deep Learning Benchmark / Algorithmic Evaluation", "Simulation / Modelling Study"],
    },
    { group: "Business & management", designs: ["Business Case Study", "Organisational / Management Study"] },
  ],
  proposal: [
    {
      group: "Proposals",
      designs: [
        "Research Proposal (thesis or degree)",
        "Concept Note",
        "Grant Proposal",
        "Exploratory Pilot Grant Framework",
        "Mixed-Methods Research Proposal",
        "Qualitative Research Proposal",
        "Prospective Clinical Trial Protocol",
        "Longitudinal Multi-Center Cohort Proposal",
        "Translational Technology Validation Plan",
      ],
    },
  ],
  literature_review: [
    {
      group: "Reviews",
      designs: [
        "Critical Thematic Narrative Review",
        "PRISMA-Compliant Systematic Literature Review",
        "Scoping Review Protocol",
        "Integrative Review",
        "Meta-Analysis & Quantitative Synthesis",
      ],
    },
  ],
  thesis: [
    {
      group: "Theses",
      designs: ["Undergraduate Research Project", "Master's Thesis", "Doctoral Dissertation (Monograph)", "Cumulative / Article-Based Dissertation"],
    },
  ],
  report: [
    {
      group: "Reports",
      designs: ["Technical Report", "Policy Brief", "Program Evaluation Report", "Baseline / Situation Analysis Report", "Feasibility Study"],
    },
  ],
  draft: [],
};

/** All designs per document type (flat). */
export const STUDY_DESIGNS: Record<DocumentType, string[]> = Object.fromEntries(
  Object.entries(DESIGN_GROUPS).map(([type, groups]) => [type, groups.flatMap((g) => g.designs)]),
) as Record<DocumentType, string[]>;

/** Outlines for designs whose structure differs from the generic research article. Matched by keyword. */
const DESIGN_OUTLINES: [string[], string[]][] = [
  [["survey", "questionnaire"], ["Abstract", "Introduction & Research Problem", "Research Questions & Hypotheses", "Methods: Population, Sampling & Instrument", "Data Collection & Analysis", "Results", "Discussion", "Limitations & Ethical Considerations", "Conclusion"]],
  [["quasi-experimental"], ["Abstract", "Introduction & Rationale", "Hypotheses", "Design, Groups & Assignment", "Intervention & Outcome Measures", "Analysis (including control of confounders)", "Results", "Discussion & Threats to Validity", "Conclusion"]],
  [["case study"], ["Abstract", "Introduction & Case Selection", "Theoretical Lens", "Methods: Data Sources & Analysis", "Case Description", "Findings", "Discussion & Transferability", "Limitations", "Conclusion"]],
  [["ethnograph"], ["Abstract", "Introduction & Setting", "Theoretical Framework", "Fieldwork, Access & Positionality", "Data Collection & Analysis", "Findings", "Discussion", "Reflexivity & Ethics", "Conclusion"]],
  [["phenomenolog", "grounded theory", "interview", "focus-group", "qualitative"], ["Abstract", "Introduction & Research Problem", "Theoretical Framework", "Methodology: Sampling, Data Collection & Reflexivity", "Analysis Approach", "Findings & Themes", "Discussion & Implications", "Limitations & Trustworthiness"]],
  [["discourse", "document analysis"], ["Abstract", "Introduction", "Analytical Framework", "Corpus / Documents & Selection", "Analysis", "Findings", "Discussion", "Conclusion"]],
  [["mixed-methods"], ["Abstract", "Introduction & Research Problem", "Research Questions", "Mixed-Methods Design & Rationale", "Quantitative Strand: Methods & Results", "Qualitative Strand: Methods & Findings", "Integration of Findings", "Discussion", "Limitations", "Conclusion"]],
  [["action research"], ["Abstract", "Introduction & Context", "Participants & Partnership", "Cycle 1: Plan, Act, Observe, Reflect", "Cycle 2: Plan, Act, Observe, Reflect", "Outcomes & Learning", "Discussion", "Ethics & Limitations", "Conclusion"]],
  [["argumentative", "critical essay"], ["Introduction & Thesis Statement", "Context & Key Concepts", "Argument 1", "Argument 2", "Counter-Arguments & Rebuttal", "Conclusion"]],
  [["historical", "archival"], ["Introduction & Historiography", "Sources & Archives", "Historical Context", "Analysis", "Interpretation & Significance", "Conclusion"]],
  [["doctrinal legal"], ["Introduction & Legal Question", "Legal Framework (Statutes & Instruments)", "Case Law Analysis", "Critical Evaluation", "Recommendations / Law Reform", "Conclusion"]],
  [["comparative law", "policy analysis"], ["Introduction & Problem", "Analytical Framework & Comparators", "Jurisdiction / Policy A", "Jurisdiction / Policy B", "Comparative Analysis", "Recommendations", "Conclusion"]],
  [["design & evaluation", "simulation", "modelling"], ["Abstract", "Introduction & Requirements", "Related Work", "System / Model Design", "Implementation", "Evaluation Method", "Results", "Discussion & Limitations", "Conclusion & Future Work"]],
  [["business case", "organisational", "management study"], ["Executive Summary", "Introduction & Organisation Background", "Problem / Opportunity", "Analysis (Market, Financial, Operational)", "Options & Evaluation", "Recommendations", "Implementation Plan", "Conclusion"]],
  [["concept note"], ["Title & Summary", "Problem Statement", "Objectives", "Proposed Approach", "Expected Outcomes", "Partners & Capacity", "Budget Summary"]],
  [["research proposal (thesis", "qualitative research proposal", "mixed-methods research proposal"], ["Title & Abstract", "Background & Problem Statement", "Objectives & Research Questions", "Significance & Justification", "Literature Review", "Methodology", "Ethical Considerations", "Work Plan & Timeline", "Budget", "Expected Outcomes & Dissemination"]],
  [["integrative review"], ["Abstract", "Introduction & Review Purpose", "Methods: Search, Selection & Appraisal", "Data Analysis & Integration", "Results", "Discussion", "Conclusion"]],
  [["baseline", "situation analysis"], ["Executive Summary", "Introduction & Objectives", "Methodology", "Context & Baseline Findings", "Key Indicators", "Conclusions & Recommendations", "Annexes"]],
  [["feasibility study"], ["Executive Summary", "Background", "Technical Feasibility", "Economic / Financial Feasibility", "Social & Environmental Considerations", "Risks", "Recommendation"]],
];

export function defaultHeadings(docType: DocumentType, design = ""): string[] {
  const d = design.toLowerCase();
  if (d && !(d.includes("randomized") || d.includes("rct"))) {
    const outline = DESIGN_OUTLINES.find(([keys]) => keys.some((k) => d.includes(k)));
    if (outline) return outline[1];
  }
  switch (docType) {
    case "manuscript":
      if (d.includes("randomized") || d.includes("rct"))
        return [
          "Structured Abstract", "Introduction & Clinical Rationale", "Trial Design, Participant Eligibility & Randomization",
          "Intervention Protocols & Outcome Measures", "Statistical Analysis & Baseline Characteristics",
          "Primary & Secondary Trial Results", "Discussion, Adverse Events & Generalizability",
        ];
      if (d.includes("qualitative"))
        return [
          "Abstract", "Introduction & Research Problem", "Theoretical Framework", "Methodology: Sampling, Data Collection & Reflexivity",
          "Analysis Approach", "Findings & Themes", "Discussion & Implications", "Limitations & Trustworthiness",
        ];
      return [
        "Abstract", "Introduction & Theoretical Background", "Research Objectives & Hypotheses", "Materials & Methods",
        "Results & Empirical Findings", "Discussion & Scholarly Implications", "Study Limitations & Ethical Considerations",
      ];
    case "proposal":
      return [
        "Project Summary & Specific Aims", "Background, Significance & Innovation", "Preliminary Data & Methodological Feasibility",
        "Research Design & Experimental Protocol", "Ethical Considerations", "Timeline, Milestones & Deliverables",
        "Budget & Justification", "Potential Pitfalls & Alternative Strategies",
      ];
    case "literature_review":
      if (d.includes("prisma") || d.includes("systematic"))
        return [
          "Structured Abstract", "Introduction & Review Rationale", "Eligibility Criteria & Information Sources",
          "Search Strategy, Study Selection & Data Extraction (PRISMA Flow)", "Risk of Bias Assessment & Critical Appraisal",
          "Synthesis of Results & Study Characteristics", "Discussion, Limitations & Evidentiary Gaps",
        ];
      if (d.includes("meta-analysis"))
        return [
          "Abstract & Quantitative Objectives", "Introduction & Theoretical Framing", "Search Strategy & Inclusion Criteria",
          "Statistical Methods & Effect Size Estimation", "Meta-Analytic Findings & Heterogeneity Analysis",
          "Publication Bias & Sensitivity Analyses", "Discussion & Practice Implications",
        ];
      if (d.includes("scoping"))
        return [
          "Abstract & Review Scope", "Introduction & Background", "Review Questions & Conceptual Framework",
          "Inclusion Criteria & Evidence Mapping Methodology", "Charted Results & Evidence Distribution",
          "Discussion & Implications for Future Research",
        ];
      return [
        "Abstract & Topic Scope", "Introduction & Theoretical Background", "Literature Search Strategy & Conceptual Framework",
        "Thematic Synthesis of Published Evidence", "Methodological Evaluation & Critical Perspectives",
        "Unresolved Questions & Future Directions",
      ];
    case "thesis":
      return [
        "Abstract", "Chapter 1: Introduction & Research Problem", "Chapter 2: Literature Review & Theoretical Framework",
        "Chapter 3: Methodology & Research Design", "Chapter 4: Results & Empirical Findings",
        "Chapter 5: Discussion & Scholarly Contributions", "Chapter 6: Conclusions & Future Research Directions", "Appendices",
      ];
    case "report":
      return ["Executive Summary", "Background", "Methods", "Findings", "Recommendations", "Appendices"];
    default:
      return [];
  }
}

export function defaultObjectives(topic: string, docType: DocumentType, design = ""): { general: string; specific: string[] } {
  const t = topic.trim() || "the research problem";
  const d = design.toLowerCase();
  if (docType === "proposal")
    return {
      general: `To design and carry out a rigorous study of ${t}.`,
      specific: [
        `Establish baseline measures and evaluation criteria for ${t}.`,
        `Test the study hypotheses using ${design || "an appropriate, pre-specified protocol"}.`,
        "Assess feasibility and define reproducible deliverables.",
      ],
    };
  if (docType === "literature_review") {
    if (d.includes("prisma") || d.includes("systematic"))
      return {
        general: `To systematically review the peer-reviewed evidence on ${t} following PRISMA reporting standards.`,
        specific: [
          `Search academic databases with pre-defined eligibility criteria for ${t}.`,
          "Appraise risk of bias and methodological quality of included studies.",
          "Synthesise findings narratively and, where appropriate, quantitatively.",
        ],
      };
    if (d.includes("meta-analysis"))
      return {
        general: `To quantitatively synthesise effect sizes across studies of ${t}.`,
        specific: [
          `Extract outcome data and calculate pooled effect sizes for ${t}.`,
          "Evaluate heterogeneity across study populations and designs.",
          "Perform sensitivity and publication-bias analyses.",
        ],
      };
    if (d.includes("scoping"))
      return {
        general: `To map the key concepts, evidence types and gaps in the literature on ${t}.`,
        specific: [
          `Identify the scope and nature of existing research on ${t}.`,
          "Chart conceptual frameworks and methodological approaches.",
          "Identify gaps that warrant future research.",
        ],
      };
    return {
      general: `To critically synthesise the scholarly literature on ${t}.`,
      specific: [
        `Identify the main conceptual approaches used in research on ${t}.`,
        "Compare and contrast findings and perspectives across studies.",
        "Identify methodological limitations and directions for future research.",
      ],
    };
  }
  if (docType === "thesis")
    return {
      general: `To make an original contribution to knowledge on ${t}.`,
      specific: [
        `Review the foundational literature and establish a theoretical framework for ${t}.`,
        `Design and carry out a methodologically sound investigation of ${t}.`,
        "Interpret the findings and discuss their implications for the field.",
      ],
    };
  return {
    general: `To investigate and characterise ${t}.`,
    specific: [
      `Design and carry out a ${design || "well-controlled"} evaluation of ${t}.`,
      "Compare the results with existing evidence.",
      "Identify limitations and implications for practice and research.",
    ],
  };
}

export function sectionGuidance(heading: string, design = ""): string {
  const h = heading.toLowerCase();
  if (h.includes("abstract") || h.includes("summary"))
    return "Summarise the background, objectives, methods, main findings and their significance (usually 150–300 words).";
  if (h.includes("intro") || h.includes("background") || h.includes("rationale"))
    return "Establish the context and the gap in existing research, and explain why this work is needed. Cite sources from your library with “Cite at cursor”.";
  if (h.includes("objective") || h.includes("aims") || h.includes("hypothes"))
    return "State the primary and secondary objectives or hypotheses, aligned with the study design.";
  if (h.includes("method") || h.includes("protocol") || h.includes("design") || h.includes("strategy") || h.includes("criteria"))
    return `Describe the methodology${design ? ` (${design})` : ""}: setting, participants or sources, sampling, instruments, data collection and analysis.`;
  if (h.includes("ethic")) return "Describe ethical approval, consent, data protection and risk mitigation.";
  if (h.includes("budget")) return "Itemise costs and justify each line against the aims.";
  if (h.includes("timeline") || h.includes("milestone")) return "Set out the work plan, milestones and deliverables over time.";
  if (h.includes("theme") || (h.includes("finding") && /qualitative|interview|ethnograph|case study|phenomenolog|grounded/i.test(design)))
    return "Present each theme with a clear explanation and illustrative quotations or observations from your data.";
  if (h.includes("result") || h.includes("finding") || h.includes("synthesis") || h.includes("charted") || h.includes("indicator"))
    return "Report what you found objectively (statistics, observations or evidence, as fits your design), before interpreting it.";
  if (h.includes("argument") || h.includes("analysis") || h.includes("interpretation") || h.includes("evaluation"))
    return "Develop the argument step by step, supporting each point with evidence or sources from your library.";
  if (h.includes("thesis statement")) return "State the claim the essay will defend, in one or two sentences.";
  if (h.includes("case law") || h.includes("legal framework") || h.includes("statute"))
    return "Set out the relevant statutes, instruments and cases, and analyse how they apply. Add cases and statutes with “Enter manually”.";
  if (h.includes("sources & archives")) return "Describe the archives and primary sources you used and how you selected and read them.";
  if (h.includes("discussion") || h.includes("implication") || h.includes("recommendation"))
    return "Interpret the findings against prior studies, explain what they mean and what should follow from them.";
  if (h.includes("limitation") || h.includes("bias") || h.includes("pitfall") || h.includes("trustworth"))
    return "Acknowledge limitations, possible biases and how they were addressed.";
  if (h.includes("conclusion")) return "Summarise the main contribution and future directions.";
  if (h.includes("theor") || h.includes("framework") || h.includes("literature"))
    return "Present the theories and prior work that frame the study, citing sources from your library.";
  return "Write this section here.";
}

export interface GuidedConfig {
  topic: string;
  docType: DocumentType;
  design: string;
  generalObjective: string;
  specificObjectives: string[];
  headings: string[];
}

/** Builds the editor content: title, design/objectives block and a guided section scaffold. */
export function guidedContent(config: GuidedConfig): JSONContent {
  const text = (value: string, bold = false): JSONContent => ({ type: "text", text: value, ...(bold ? { marks: [{ type: "bold" }] } : {}) });
  const italic = (value: string): JSONContent => ({ type: "text", text: value, marks: [{ type: "italic" }] });
  const content: JSONContent[] = [];
  if (config.docType === "draft" && !config.headings.length) return { type: "doc", content: [{ type: "paragraph" }] };
  if (config.design) content.push({ type: "paragraph", content: [text("Study design: ", true), text(config.design)] });
  if (config.generalObjective.trim()) content.push({ type: "paragraph", content: [text("General objective: ", true), text(config.generalObjective.trim())] });
  const specific = config.specificObjectives.map((s) => s.trim()).filter(Boolean);
  if (specific.length) {
    content.push({ type: "paragraph", content: [text("Specific objectives:", true)] });
    content.push({
      type: "orderedList",
      content: specific.map((s) => ({ type: "listItem", content: [{ type: "paragraph", content: [text(s)] }] })),
    });
  }
  for (const heading of config.headings.map((h) => h.trim()).filter(Boolean)) {
    content.push({ type: "heading", attrs: { level: 2 }, content: [text(heading)] });
    content.push({ type: "paragraph", content: [italic(sectionGuidance(heading, config.design))] });
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/** Joins an AI continuation to the text before the cursor: removes repeated words and fixes spacing/case. */
export function normalizeSuggestion(prefix: string, raw: string): string {
  let suggestion = raw.trim();
  if (!suggestion) return "";
  const prefixWords = prefix.trim().split(/\s+/).filter(Boolean);
  const suggestionWords = suggestion.split(/\s+/).filter(Boolean);
  const clean = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/gi, "");
  for (let k = Math.min(6, prefixWords.length, suggestionWords.length); k >= 1; k--) {
    const end = prefixWords.slice(-k).map(clean);
    const start = suggestionWords.slice(0, k).map(clean);
    if (end.every((w, i) => w && w === start[i])) {
      suggestion = suggestionWords.slice(k).join(" ");
      break;
    }
  }
  if (!suggestion) return "";
  const tail = prefix.trimEnd();
  if (/[.!?]$/.test(tail)) suggestion = suggestion.charAt(0).toUpperCase() + suggestion.slice(1);
  else if (/[,;:]$/.test(tail) && !/^[A-Z]{2,}\b/.test(suggestion) && !suggestion.startsWith("I "))
    suggestion = suggestion.charAt(0).toLowerCase() + suggestion.slice(1);
  const needsSpace = tail.length > 0 && !/\s$/.test(prefix) && !/^[.,;:!?)]/.test(suggestion);
  return (needsSpace ? " " : "") + suggestion;
}
