/**
 * AI Research Hub — Scholarly Search Relevance Ranking Engine
 *
 * Deterministic, explainable, multi-factor cross-provider ranking layer
 * applied after multi-source deduplication and identity resolution.
 *
 * Ranking Factors:
 * 1. Substantive Query Term Coverage in Title (30 pts + 5 pt full coverage bonus)
 * 2. Exact Phrase and Multiword N-Gram Matches (up to 25 pts)
 * 3. Abstract Query Term Coverage & Concept Presence (up to 15 pts)
 * 4. Research Modality / Method Alignment & Distractor Penalty (+10 pts or -15 pts)
 * 5. Multi-Provider Consensus & Canonical DOI Provenance (up to 7 pts)
 * 6. Damped Citation Signal (log-scaled prior, capped at 3 pts)
 * 7. Stable Deterministic Tie-Breaking (score -> title coverage -> year -> id)
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

const MODALITY_CLUSTERS: ModalityCluster[] = [
  {
    family: "medical_imaging",
    modalities: [
      {
        name: "ultrasound",
        aliases: ["ultrasound", "ultrasonography", "sonography", "echocardiography", "echography", "endosonography", "doppler"],
      },
      {
        name: "mri",
        aliases: ["mri", "magnetic resonance", "nmr", "radiomics", "multiparametric mri", "mp mri", "dwi", "fmri"],
      },
      {
        name: "ct",
        aliases: ["computed tomography", "ct scan", "ct imaging", "multidetector ct", "mdct", "hrct"],
      },
      {
        name: "mammography",
        aliases: ["mammography", "mammogram", "digital breast tomosynthesis", "dbt", "breast screening"],
      },
      {
        name: "xray",
        aliases: ["x ray", "xray", "radiography", "chest radiograph", "radiograph"],
      },
      {
        name: "pet_spect",
        aliases: ["positron emission tomography", "pet scan", "pet ct", "spect", "scintigraphy"],
      },
      {
        name: "pathology",
        aliases: ["histopathology", "whole slide imaging", "wsi", "biopsy histology", "histological", "pathological"],
      },
      {
        name: "dermoscopy",
        aliases: ["dermoscopy", "dermatoscopy", "skin lesion imaging"],
      },
    ],
  },
  {
    family: "computational_biology",
    modalities: [
      {
        name: "protein_folding",
        aliases: ["protein folding", "structure prediction", "alphafold", "esmfold", "rosettafold", "tertiary structure"],
      },
      {
        name: "gene_editing",
        aliases: ["crispr", "cas9", "cas12", "base editing", "prime editing", "guide rna"],
      },
      {
        name: "single_cell",
        aliases: ["single cell", "scrna", "snrna", "scrna seq", "single nucleus"],
      },
      {
        name: "sequence_alignment",
        aliases: ["multiple sequence alignment", "msa", "blast", "homology search"],
      },
    ],
  },
  {
    family: "ai_architectures",
    modalities: [
      {
        name: "transformer",
        aliases: ["transformer", "transformers", "self attention", "multi head attention", "attention mechanism"],
      },
      {
        name: "cnn",
        aliases: ["convolutional neural", "cnn", "convnet", "u net", "resnet"],
      },
      {
        name: "diffusion",
        aliases: ["diffusion model", "diffusion models", "denoising diffusion", "score based generative"],
      },
      {
        name: "reinforcement_learning",
        aliases: ["reinforcement learning", "q learning", "policy gradient", "actor critic", "ppo", "dqn", "mcts"],
      },
      {
        name: "graph_neural_networks",
        aliases: ["graph neural", "gnn", "graph convolutional", "gat", "message passing neural"],
      },
    ],
  },
  {
    family: "quantum_computing",
    modalities: [
      {
        name: "surface_codes",
        aliases: ["surface code", "surface codes", "quantum error correction", "qec", "topological code", "toric code", "fault tolerant quantum"],
      },
      {
        name: "classical_error_correction",
        aliases: ["reed solomon", "ldpc code", "turbo code", "classical error correction", "hamming code", "bch code"],
      },
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
  // If all words were stopwords, fallback to all words of length >= 2
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
        // Word boundary match
        const regex = new RegExp(`(?:^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|\\s)`, "i");
        if (regex.test(normQuery)) {
          const competing = cluster.modalities.filter((m) => m.name !== mod.name);
          detections.push({
            family: cluster.family,
            matchedModality: mod.name,
            matchedAlias: alias,
            competingModalities: competing,
          });
          break; // Avoid duplicate detections for same modality
        }
      }
    }
  }

  return detections;
}

/**
 * Relevance Breakdown for explainability and telemetry.
 */
export interface RelevanceScoreDetails {
  totalScore: number;
  titleScore: number;
  phraseScore: number;
  abstractScore: number;
  modalityScore: number;
  consensusScore: number;
  authorityScore: number;
  matchedTitleTerms: string[];
  matchedAbstractTerms: string[];
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
      modalityScore: 0,
      consensusScore: 0,
      authorityScore: 0,
      matchedTitleTerms: [],
      matchedAbstractTerms: [],
      modalityAlignment: "NEUTRAL",
    };
  }

  const normQuery = normalizeText(trimmedQuery);
  const queryTokens = getSubstantiveQueryTokens(trimmedQuery);
  const queryTokenSet = new Set(queryTokens);
  const queryNGrams = getSubstantiveNGrams(queryTokens);

  const normTitle = normalizeText(paper.title || "");
  const titleTokens = tokenizeWords(paper.title || "");
  const titleTokenSet = new Set(titleTokens);

  const normAbstract = normalizeText(paper.abstract || "");
  const abstractTokens = tokenizeWords(paper.abstract || "");
  const abstractTokenSet = new Set(abstractTokens);

  // 1. Title Query Term Coverage (up to 35 points)
  let matchedTitleTerms: string[] = [];
  if (queryTokens.length > 0) {
    matchedTitleTerms = queryTokens.filter((qt) => titleTokenSet.has(qt));
  }
  const titleCoverageRatio = queryTokens.length > 0 ? matchedTitleTerms.length / queryTokens.length : 0;
  let titleScore = titleCoverageRatio * 30;
  if (titleCoverageRatio === 1 && queryTokens.length >= 2) {
    titleScore += 5; // Full query term coverage in title bonus
  }

  // 2. Exact Phrase and Multiword N-Gram Matches (up to 25 points)
  let phraseScore = 0;
  // Full query phrase in title
  if (normQuery.length >= 5 && normTitle.includes(normQuery)) {
    phraseScore += 25;
  } else {
    // Check substantive N-Grams in title
    let titleNgramMatches = 0;
    for (const ngram of queryNGrams) {
      if (normTitle.includes(ngram)) {
        titleNgramMatches++;
      }
    }
    phraseScore += Math.min(20, titleNgramMatches * 10);

    // Full query in abstract
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
    matchedAbstractTerms = queryTokens.filter((qt) => abstractTokenSet.has(qt));
  }
  const abstractCoverageRatio = queryTokens.length > 0 ? matchedAbstractTerms.length / queryTokens.length : 0;
  const abstractScore = abstractCoverageRatio * 15;

  // 4. Modality / Domain Technique Alignment (Boost or Distractor Penalty)
  const queryModalityDetections = detectQueryModalities(trimmedQuery);
  let modalityScore = 0;
  let modalityAlignment: "ALIGNED" | "COMPETING_PENALTY" | "NEUTRAL" = "NEUTRAL";

  if (queryModalityDetections.length > 0) {
    for (const detection of queryModalityDetections) {
      // Check if title contains the queried modality alias
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
      // Example: Query is "Ultrasound", candidate title is "MRI-based Radiomics..."
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

  // 5. Multi-Provider Consensus & Verified Provenance (up to 7 points)
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

  // 6. Damped Citation Signal (up to 3 points prior)
  let authorityScore = 0;
  if (paper.citationCount && paper.citationCount > 0) {
    authorityScore = Math.min(3.0, Math.log10(1 + paper.citationCount) * 0.6);
  }

  // Raw Total Calculation
  const rawTotal = titleScore + phraseScore + abstractScore + modalityScore + consensusScore + authorityScore;
  const totalScore = Math.max(0, Math.round(rawTotal * 1000) / 1000);

  return {
    totalScore,
    titleScore: Math.round(titleScore * 100) / 100,
    phraseScore: Math.round(phraseScore * 100) / 100,
    abstractScore: Math.round(abstractScore * 100) / 100,
    modalityScore: Math.round(modalityScore * 100) / 100,
    consensusScore: Math.round(consensusScore * 100) / 100,
    authorityScore: Math.round(authorityScore * 100) / 100,
    matchedTitleTerms,
    matchedAbstractTerms,
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
    },
  }));
}
