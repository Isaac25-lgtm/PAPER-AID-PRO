/**
 * AI Research Hub — Scholarly Search Relevance Ranking Engine
 *
 * Deterministic, explainable, multi-factor cross-provider ranking layer
 * applied after multi-source deduplication and identity resolution.
 *
 * Ranking Factors:
 * 1. Substantive Query Term & Concept Coverage in Title (up to 35 pts)
 * 2. Exact Phrase and Multiword N-Gram Matches (up to 25 pts)
 * 3. Abstract Query Term Coverage & Concept Presence (up to 15 pts)
 * 4. Multi-Concept Intent Alignment (+15 pts full title alignment, +8 pts cross-text)
 * 5. Research Modality / Method Alignment & Distractor Penalty (+10 pts or -15 to -25 pts)
 * 6. Multi-Provider Consensus & Canonical DOI Provenance (up to 7 pts)
 * 7. Damped Citation Signal (log-scaled prior, capped at 3 pts)
 * 8. Stable Deterministic Tie-Breaking (score -> title coverage -> year -> id)
 */

import { NormalizedExternalPaper } from "./types";

/**
 * Standard English & academic boilerplate stopwords.
 */
const STOPWORDS = new Set<string>([
  "a", "about", "above", "across", "after", "afterwards", "again", "against",
  "all", "almost", "alone", "along", "already", "also", "although", "always",
  "am", "among", "amongst", "an", "and", "another", "any", "anyhow", "anyone",
  "anything", "anyway", "anywhere", "are", "around", "as", "at", "back", "be",
  "became", "because", "become", "becomes", "becoming", "been", "before",
  "beforehand", "behind", "being", "below", "beside", "besides", "between",
  "beyond", "both", "bottom", "but", "by", "call", "can", "cannot", "co",
  "con", "could", "couldnt", "cry", "de", "describe", "detail", "do", "done",
  "down", "due", "during", "each", "eg", "eight", "either", "eleven", "else",
  "elsewhere", "empty", "enough", "etc", "even", "ever", "every", "everyone",
  "everything", "everywhere", "except", "few", "fifteen", "fifty", "fill",
  "find", "fire", "first", "five", "for", "former", "formerly", "forty", "found",
  "four", "from", "front", "full", "further", "get", "give", "go", "had", "has",
  "hasnt", "have", "he", "hence", "her", "here", "hereafter", "hereby", "herein",
  "hereupon", "hers", "herself", "him", "himself", "his", "how", "however",
  "hundred", "ie", "if", "in", "inc", "indeed", "interest", "into", "is", "it",
  "its", "itself", "keep", "last", "latter", "latterly", "least", "less", "ltd",
  "made", "many", "may", "me", "meanwhile", "might", "mill", "mine", "more",
  "moreover", "most", "mostly", "move", "much", "must", "my", "myself", "name",
  "namely", "neither", "never", "nevertheless", "next", "nine", "no", "nobody",
  "none", "noone", "nor", "not", "nothing", "now", "nowhere", "of", "off", "often",
  "on", "once", "one", "only", "onto", "or", "other", "others", "otherwise",
  "our", "ours", "ourselves", "out", "over", "own", "part", "per", "perhaps",
  "please", "put", "rather", "re", "same", "see", "seem", "seemed", "seeming",
  "seems", "serious", "several", "she", "should", "show", "side", "since",
  "sincere", "six", "sixty", "so", "some", "somehow", "someone", "something",
  "sometime", "sometimes", "somewhere", "still", "such", "system", "take", "ten",
  "than", "that", "the", "their", "them", "themselves", "then", "thence",
  "there", "thereafter", "thereby", "therefore", "therein", "thereupon", "these",
  "they", "thickv", "thin", "third", "this", "those", "though", "three",
  "through", "throughout", "thru", "thus", "to", "together", "too", "top",
  "toward", "towards", "twelve", "twenty", "two", "un", "under", "until", "up",
  "upon", "us", "very", "via", "was", "we", "well", "were", "what", "whatever",
  "when", "whence", "whenever", "where", "whereafter", "whereas", "whereby",
  "wherein", "whereupon", "wherever", "whether", "which", "while", "whither",
  "who", "whoever", "whole", "whom", "whose", "why", "will", "with", "within",
  "without", "would", "yet", "you", "your", "yours", "yourself", "yourselves",
  // Academic generic boilerplate stopwords
  "using", "based", "approach", "novel", "study", "studies", "paper", "papers",
  "method", "methods", "analysis", "investigation", "results", "role", "effects",
  "comparison", "evaluation", "recent", "advances", "perspective", "review",
]);

/**
 * Modality & Technical Methodology Clusters across disciplines.
 * Used for generalized modality alignment and cross-modality distractor penalties.
 */
interface ModalityCluster {
  family: string;
  modalities: {
    name: string;
    aliases: string[];
  }[];
}

export const MODALITY_CLUSTERS: ModalityCluster[] = [
  {
    family: "medical_imaging",
    modalities: [
      {
        name: "ultrasound",
        aliases: [
          "ultrasound",
          "ultrasonography",
          "sonography",
          "echocardiography",
          "echography",
          "endosonography",
          "doppler",
          "pocus",
          "point of care ultrasound",
        ],
      },
      {
        name: "mri",
        aliases: [
          "mri",
          "magnetic resonance",
          "nmr",
          "multiparametric mri",
          "mp mri",
          "dwi",
          "fmri",
        ],
      },
      {
        name: "ct",
        aliases: [
          "computed tomography",
          "ct scan",
          "ct imaging",
          "multidetector ct",
          "mdct",
          "hrct",
        ],
      },
      {
        name: "retinal_ophthalmic",
        aliases: [
          "retina",
          "retinal",
          "choroid",
          "choroidal",
          "fundus",
          "optical coherence tomography",
          "oct imaging",
          "ophthalmology",
          "ophthalmic",
        ],
      },
      {
        name: "molecular_optical",
        aliases: [
          "molecular imaging",
          "fluorescence imaging",
          "bioluminescence",
          "optical imaging",
          "fluorogenic",
          "spectroscopy",
        ],
      },
      {
        name: "endoscopy",
        aliases: [
          "endoscopy",
          "colonoscopy",
          "gastroscopy",
          "bronchoscopy",
          "laparoscopy",
        ],
      },
      {
        name: "mammography",
        aliases: [
          "mammography",
          "mammogram",
          "digital breast tomosynthesis",
          "dbt",
          "breast screening",
        ],
      },
      {
        name: "xray",
        aliases: [
          "x ray",
          "xray",
          "radiography",
          "chest radiograph",
          "radiograph",
        ],
      },
      {
        name: "pet_spect",
        aliases: [
          "positron emission tomography",
          "pet scan",
          "pet ct",
          "spect",
          "scintigraphy",
        ],
      },
      {
        name: "pathology",
        aliases: [
          "histopathology",
          "whole slide imaging",
          "wsi",
          "biopsy histology",
          "histological",
          "pathological",
        ],
      },
      {
        name: "dermoscopy",
        aliases: [
          "dermoscopy",
          "dermatoscopy",
          "skin lesion imaging",
        ],
      },
    ],
  },
  {
    family: "computational_biology",
    modalities: [
      {
        name: "protein_folding",
        aliases: [
          "protein folding",
          "structure prediction",
          "alphafold",
          "esmfold",
          "rosettafold",
          "tertiary structure",
        ],
      },
      {
        name: "gene_editing",
        aliases: [
          "crispr",
          "cas9",
          "cas12",
          "base editing",
          "prime editing",
          "guide rna",
        ],
      },
      {
        name: "single_cell",
        aliases: [
          "single cell",
          "scrna",
          "snrna",
          "scrna seq",
          "single nucleus",
        ],
      },
      {
        name: "sequence_alignment",
        aliases: [
          "multiple sequence alignment",
          "msa",
          "blast",
          "homology search",
        ],
      },
    ],
  },
  {
    family: "ai_architectures",
    modalities: [
      {
        name: "transformer",
        aliases: [
          "transformer",
          "transformers",
          "self attention",
          "multi head attention",
          "attention mechanism",
        ],
      },
      {
        name: "cnn",
        aliases: [
          "convolutional neural",
          "cnn",
          "convnet",
          "u net",
          "resnet",
        ],
      },
      {
        name: "diffusion",
        aliases: [
          "diffusion model",
          "diffusion models",
          "denoising diffusion",
          "score based generative",
        ],
      },
      {
        name: "reinforcement_learning",
        aliases: [
          "reinforcement learning",
          "q learning",
          "policy gradient",
          "actor critic",
          "ppo",
          "dqn",
          "mcts",
        ],
      },
      {
        name: "graph_neural_networks",
        aliases: [
          "graph neural",
          "gnn",
          "graph convolutional",
          "gat",
          "message passing neural",
        ],
      },
    ],
  },
  {
    family: "quantum_computing",
    modalities: [
      {
        name: "surface_codes",
        aliases: [
          "surface code",
          "surface codes",
          "quantum error correction",
          "qec",
          "topological code",
          "toric code",
          "fault tolerant quantum",
        ],
      },
      {
        name: "classical_error_correction",
        aliases: [
          "reed solomon",
          "ldpc code",
          "turbo code",
          "classical error correction",
          "hamming code",
          "bch code",
        ],
      },
    ],
  },
];

/**
 * Generalized Cross-Discipline Concept Equivalence Sets
 * Used to detect multi-concept queries and cross-synonym matching.
 */
export interface ConceptEquivalenceSet {
  id: string;
  category: "methodology" | "domain_target" | "clinical_task";
  terms: string[];
}

export const CONCEPT_EQUIVALENCE_SETS: ConceptEquivalenceSet[] = [
  {
    id: "ai_machine_learning",
    category: "methodology",
    terms: [
      "artificial intelligence",
      "ai",
      "machine learning",
      "deep learning",
      "deep neural",
      "neural network",
      "neural networks",
      "convolutional neural",
      "computer aided diagnosis",
      "computer assisted",
      "cad",
      "radiomics",
    ],
  },
  {
    id: "ultrasound_imaging",
    category: "domain_target",
    terms: [
      "ultrasound",
      "ultrasonography",
      "sonography",
      "echocardiography",
      "echography",
      "endosonography",
      "doppler",
      "sonographic",
      "pocus",
    ],
  },
  {
    id: "clinical_tasks",
    category: "clinical_task",
    terms: [
      "diagnosis",
      "diagnostic",
      "classification",
      "detection",
      "segmentation",
      "interpretation",
      "screening",
      "radiomics",
    ],
  },
  {
    id: "quantum_error_correction",
    category: "methodology",
    terms: [
      "quantum error correction",
      "qec",
      "surface code",
      "surface codes",
      "topological code",
      "fault tolerant quantum",
    ],
  },
  {
    id: "protein_structure",
    category: "domain_target",
    terms: [
      "protein structure",
      "protein folding",
      "structure prediction",
      "tertiary structure",
      "alphafold",
      "esmfold",
    ],
  },
];

/**
 * Normalizes text to lowercase, removes non-alphanumeric punctuation.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokenizes text into individual words.
 */
export function tokenizeWords(text: string): string[] {
  const norm = normalizeText(text);
  if (!norm) return [];
  return norm.split(" ").filter((w) => w.length >= 2);
}

/**
 * Extracts substantive, non-stopword query tokens.
 */
export function getSubstantiveQueryTokens(query: string): string[] {
  const words = tokenizeWords(query);
  const substantive = words.filter((w) => !STOPWORDS.has(w));
  return substantive.length > 0 ? substantive : words;
}

/**
 * Generates substantive bigrams and trigrams from substantive tokens.
 */
export function getSubstantiveNGrams(tokens: string[]): string[] {
  const ngrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    ngrams.push(`${tokens[i]} ${tokens[i + 1]}`);
    if (i < tokens.length - 2) {
      ngrams.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
    }
  }
  return ngrams;
}

/**
 * Detects whether the query matches any known modality cluster.
 */
export function detectQueryModalities(query: string): {
  family: string;
  matchedModality: string;
  matchedAlias: string;
  competingModalities: { name: string; aliases: string[] }[];
}[] {
  const normQuery = normalizeText(query);
  const detections: {
    family: string;
    matchedModality: string;
    matchedAlias: string;
    competingModalities: { name: string; aliases: string[] }[];
  }[] = [];

  for (const cluster of MODALITY_CLUSTERS) {
    for (const mod of cluster.modalities) {
      for (const alias of mod.aliases) {
        const regex = new RegExp(`(?:^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`, "i");
        if (regex.test(normQuery)) {
          const competing = cluster.modalities.filter((m) => m.name !== mod.name);
          detections.push({
            family: cluster.family,
            matchedModality: mod.name,
            matchedAlias: alias,
            competingModalities: competing,
          });
          break;
        }
      }
    }
  }

  return detections;
}

/**
 * Detects core concepts present in the search query.
 */
export function detectQueryConcepts(query: string): ConceptEquivalenceSet[] {
  const normQuery = normalizeText(query);
  const matched: ConceptEquivalenceSet[] = [];

  for (const set of CONCEPT_EQUIVALENCE_SETS) {
    for (const term of set.terms) {
      const regex = new RegExp(`(?:^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`, "i");
      if (regex.test(normQuery)) {
        matched.push(set);
        break;
      }
    }
  }

  return matched;
}

/**
 * Checks if a piece of text matches any term in a concept set.
 */
function textMatchesConcept(normText: string, conceptSet: ConceptEquivalenceSet): boolean {
  for (const term of conceptSet.terms) {
    const regex = new RegExp(`(?:^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`, "i");
    if (regex.test(normText)) return true;
  }
  return false;
}

/**
 * Relevance Breakdown for explainability and telemetry.
 */
export interface RelevanceScoreDetails {
  totalScore: number;
  titleScore: number;
  phraseScore: number;
  abstractScore: number;
  conceptScore: number;
  modalityScore: number;
  consensusScore: number;
  authorityScore: number;
  matchedTitleTerms: string[];
  matchedAbstractTerms: string[];
  matchedConcepts: string[];
  modalityAlignment: "ALIGNED" | "COMPETING_PENALTY" | "NEUTRAL";
}

/**
 * Calculates deterministic relevance score for a paper given a search query.
 */
export function scoreScholarlyPaperRelevance(
  paper: NormalizedExternalPaper,
  query: string
): RelevanceScoreDetails {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      totalScore: 0,
      titleScore: 0,
      phraseScore: 0,
      abstractScore: 0,
      conceptScore: 0,
      modalityScore: 0,
      consensusScore: 0,
      authorityScore: 0,
      matchedTitleTerms: [],
      matchedAbstractTerms: [],
      matchedConcepts: [],
      modalityAlignment: "NEUTRAL",
    };
  }

  const normQuery = normalizeText(trimmedQuery);
  const queryTokens = getSubstantiveQueryTokens(trimmedQuery);
  const queryNGrams = getSubstantiveNGrams(queryTokens);

  const normTitle = normalizeText(paper.title || "");
  const titleTokens = tokenizeWords(paper.title || "");
  const titleTokenSet = new Set(titleTokens);

  const normAbstract = normalizeText(paper.abstract || "");
  const abstractTokens = tokenizeWords(paper.abstract || "");
  const abstractTokenSet = new Set(abstractTokens);

  // Concept Detection
  const queryConcepts = detectQueryConcepts(trimmedQuery);
  const queryModalityDetections = detectQueryModalities(trimmedQuery);

  // 1. Title Query Term & Synonym Coverage (up to 35 points)
  let matchedTitleTerms: string[] = [];
  if (queryTokens.length > 0) {
    matchedTitleTerms = queryTokens.filter((qt) => {
      if (titleTokenSet.has(qt)) return true;
      // Synonym fallback: check if title matches a concept alias for this query token
      for (const concept of queryConcepts) {
        if (concept.terms.some((t) => t.includes(qt)) && textMatchesConcept(normTitle, concept)) {
          return true;
        }
      }
      return false;
    });
  }
  const titleCoverageRatio = queryTokens.length > 0 ? matchedTitleTerms.length / queryTokens.length : 0;
  let titleScore = titleCoverageRatio * 30;
  if (titleCoverageRatio === 1 && queryTokens.length >= 2) {
    titleScore += 5; // Full query term coverage in title bonus
  }

  // 2. Exact Phrase and Multiword N-Gram Matches (up to 25 points)
  let phraseScore = 0;
  if (normQuery.length >= 5 && normTitle.includes(normQuery)) {
    phraseScore += 25;
  } else {
    let titleNgramMatches = 0;
    for (const ngram of queryNGrams) {
      if (normTitle.includes(ngram)) {
        titleNgramMatches++;
      }
    }
    phraseScore += Math.min(20, titleNgramMatches * 10);

    if (normQuery.length >= 5 && normAbstract.includes(normQuery)) {
      phraseScore += 8;
    } else {
      let abstractNgramMatches = 0;
      for (const ngram of queryNGrams) {
        if (normAbstract.includes(ngram)) {
          abstractNgramMatches++;
        }
      }
      phraseScore += Math.min(8, abstractNgramMatches * 4);
    }
  }
  phraseScore = Math.min(25, phraseScore);

  // 3. Abstract Query Term Coverage (up to 15 points)
  let matchedAbstractTerms: string[] = [];
  if (queryTokens.length > 0) {
    matchedAbstractTerms = queryTokens.filter((qt) => {
      if (abstractTokenSet.has(qt)) return true;
      for (const concept of queryConcepts) {
        if (concept.terms.some((t) => t.includes(qt)) && textMatchesConcept(normAbstract, concept)) {
          return true;
        }
      }
      return false;
    });
  }
  const abstractCoverageRatio = queryTokens.length > 0 ? matchedAbstractTerms.length / queryTokens.length : 0;
  const abstractScore = abstractCoverageRatio * 15;

  // 4. Multi-Concept Coverage & Intent Alignment (up to +15 pts or -25 pts demotion)
  let conceptScore = 0;
  const matchedConcepts: string[] = [];

  if (queryConcepts.length >= 2) {
    let conceptsInTitle = 0;
    let conceptsInAbstract = 0;

    for (const concept of queryConcepts) {
      const inTitle = textMatchesConcept(normTitle, concept);
      const inAbstract = textMatchesConcept(normAbstract, concept);
      if (inTitle || inAbstract) {
        matchedConcepts.push(concept.id);
      }
      if (inTitle) conceptsInTitle++;
      if (inAbstract) conceptsInAbstract++;
    }

    if (conceptsInTitle === queryConcepts.length) {
      conceptScore += 15; // Full multi-concept title alignment
    } else if (matchedConcepts.length === queryConcepts.length) {
      conceptScore += 8; // Full multi-concept coverage across title & abstract
    }

    // Target Domain Absence Guard:
    // If the query specifies both a methodology (e.g. AI) and a domain target (e.g. ultrasound),
    // and candidate paper COMPLETELY LACKS the domain target in both title and abstract,
    // apply a severe intent mismatch demotion.
    const domainConcept = queryConcepts.find((c) => c.category === "domain_target");
    if (domainConcept) {
      const hasDomainInTitle = textMatchesConcept(normTitle, domainConcept);
      const hasDomainInAbstract = textMatchesConcept(normAbstract, domainConcept);
      if (!hasDomainInTitle && !hasDomainInAbstract) {
        conceptScore -= 25; // Severe penalty: missing queried domain entirely!
      }
    }
  }

  // 5. Modality / Domain Technique Alignment (Boost or Distractor Penalty)
  let modalityScore = 0;
  let modalityAlignment: "ALIGNED" | "COMPETING_PENALTY" | "NEUTRAL" = "NEUTRAL";

  if (queryModalityDetections.length > 0) {
    for (const detection of queryModalityDetections) {
      // Check if candidate paper contains queried modality alias
      const titleHasQueriedModality = detection.matchedAlias.length > 0 &&
        new RegExp(`(?:^|\\s)${detection.matchedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`, "i").test(normTitle);

      const abstractHasQueriedModality = detection.matchedAlias.length > 0 &&
        new RegExp(`(?:^|\\s)${detection.matchedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`, "i").test(normAbstract);

      if (titleHasQueriedModality) {
        modalityScore += 10;
        modalityAlignment = "ALIGNED";
      } else if (abstractHasQueriedModality) {
        modalityScore += 3;
      }

      // Check if title features an ALTERNATE / COMPETING modality from the same family
      // while lacking the queried modality in its title.
      // Example: Query is "Ultrasound", candidate title is "Choroidal imaging..." or "MRI-based..."
      if (!titleHasQueriedModality) {
        let hasCompetingModalityInTitle = false;
        for (const comp of detection.competingModalities) {
          for (const compAlias of comp.aliases) {
            const compRegex = new RegExp(`(?:^|\\s)${compAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`, "i");
            if (compRegex.test(normTitle)) {
              hasCompetingModalityInTitle = true;
              break;
            }
          }
          if (hasCompetingModalityInTitle) break;
        }

        if (hasCompetingModalityInTitle) {
          // Significant distractor penalty: The paper's primary focus is an alternate modality!
          modalityScore -= 15;
          modalityAlignment = "COMPETING_PENALTY";
        }
      }
    }
  }

  // 6. Multi-Provider Consensus & Verified Provenance (up to 7 points)
  let consensusScore = 0;
  if (paper.sourceProviders && paper.sourceProviders.length >= 3) {
    consensusScore += 5;
  } else if (paper.sourceProviders && paper.sourceProviders.length >= 2) {
    consensusScore += 3;
  }
  if (paper.doi) {
    consensusScore += 2;
  }
  consensusScore = Math.min(7, consensusScore);

  // 7. Damped Citation Signal (up to 3 points prior)
  let authorityScore = 0;
  if (paper.citationCount && paper.citationCount > 0) {
    authorityScore = Math.min(3.0, Math.log10(1 + paper.citationCount) * 0.6);
  }

  // Raw Total Calculation
  const rawTotal =
    titleScore +
    phraseScore +
    abstractScore +
    conceptScore +
    modalityScore +
    consensusScore +
    authorityScore;
  const totalScore = Math.max(0, Math.round(rawTotal * 1000) / 1000);

  return {
    totalScore,
    titleScore: Math.round(titleScore * 100) / 100,
    phraseScore: Math.round(phraseScore * 100) / 100,
    abstractScore: Math.round(abstractScore * 100) / 100,
    conceptScore: Math.round(conceptScore * 100) / 100,
    modalityScore: Math.round(modalityScore * 100) / 100,
    consensusScore: Math.round(consensusScore * 100) / 100,
    authorityScore: Math.round(authorityScore * 100) / 100,
    matchedTitleTerms,
    matchedAbstractTerms,
    matchedConcepts,
    modalityAlignment,
  };
}

/**
 * Ranks an array of deduplicated scholarly search results deterministically.
 */
export function rankScholarlySearchResults(
  papers: NormalizedExternalPaper[],
  query: string
): NormalizedExternalPaper[] {
  if (!papers || papers.length <= 1 || !query.trim()) {
    return papers;
  }

  // Score each paper and attach details
  const scoredPapers = papers.map((paper) => {
    const details = scoreScholarlyPaperRelevance(paper, query);
    return {
      paper,
      score: details.totalScore,
      titleMatchCount: details.matchedTitleTerms.length,
      year: paper.year || 0,
      id: paper.id,
      details,
    };
  });

  // Sort with stable deterministic tie-breaking:
  // 1. Total relevance score (descending)
  // 2. Title term match count (descending)
  // 3. Year (descending, newer preferred if scores equal)
  // 4. Identifier (ascending, stable string sort)
  scoredPapers.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.0001) {
      return b.score - a.score;
    }
    if (b.titleMatchCount !== a.titleMatchCount) {
      return b.titleMatchCount - a.titleMatchCount;
    }
    if (b.year !== a.year) {
      return b.year - a.year;
    }
    return a.id.localeCompare(b.id);
  });

  return scoredPapers.map((sp) => ({
    ...sp.paper,
    rawProviderMetadata: {
      ...(sp.paper.rawProviderMetadata || {}),
      relevanceScore: sp.score,
      relevanceAlignment: sp.details.modalityAlignment,
      relevanceConcepts: sp.details.matchedConcepts,
    },
  }));
}
