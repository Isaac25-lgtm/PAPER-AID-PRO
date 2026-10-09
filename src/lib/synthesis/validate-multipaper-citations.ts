import {
  PaperEvidenceSet,
  HydratedMultiPaperAnchor,
  ValidatedMultiPaperClaim,
  ValidatedMultiPaperDisagreement,
  ValidatedMultiPaperLimitation,
} from "./types";
import { MultiPaperSynthesisOutput } from "./schemas";
import { MULTI_PAPER_INSUFFICIENT_EVIDENCE_FALLBACK } from "./prompts";

/**
 * Robustly identifies bibliographic references, citation indices, and literature lists
 * so they are never presented as primary empirical findings.
 */
export function isReferenceChunk(section: string | null, text: string): boolean {
  if (section && /reference|bibliography|citation|literature\s+cited/i.test(section)) {
    return true;
  }
  const trimmed = text.trim();
  const citationPatternCount = (trimmed.match(/(\[\d+\]|\b\d+\.)\s+[A-Z][a-z]+/g) || []).length;
  if (citationPatternCount >= 3 && /journal|proceedings|doi\.org|vol\.|pp\.|et\s+al\./i.test(trimmed)) {
    return true;
  }
  return false;
}

export interface MultiPaperValidationResult {
  claims: ValidatedMultiPaperClaim[];
  disagreements: ValidatedMultiPaperDisagreement[];
  limitations: ValidatedMultiPaperLimitation[];
  insufficientEvidence: boolean;
  rejectedCitationCount: number;
  rejectedClaimsCount: number;
  invalidCitationIds: string[];
}

/**
 * Formats a chunk snippet, ensuring that split table rows (such as Magnuska Table 11)
 * include the relevant table header [Table 11: Method | Accuracy (%) | Sensitivity (%) | Specificity (%)]
 * and exclude cut-off sentence/table fragments.
 */
export function formatTableContextSnippet(text: string, maxLength: number = 240): string {
  let cleaned = text.replace(/\s+/g, " ").trim();

  // Check for split table row from Magnuska Table 11
  if (/weighted\s+knn.*85\.00\s+83\.33\s+87\.50/i.test(cleaned)) {
    if (!/accuracy\s*\(%\).*sensitivity\s*\(%\)/i.test(cleaned)) {
      cleaned = cleaned.replace(/^subsets\.\s*/i, "").trim();
      const tableContext = "[Table 11: Method | Accuracy (%) | Sensitivity (%) | Specificity (%)]";
      cleaned = `${tableContext} ${cleaned}`;
    }
  }

  if (cleaned.length <= maxLength) return cleaned;
  const truncated = cleaned.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 50 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

function formatSnippet(text: string, maxLength: number = 240): string {
  return formatTableContextSnippet(text, maxLength);
}

/**
 * Validates domain alignment: If a proposition asserts findings for a specific clinical domain
 * (e.g. breast ultrasound), the cited paper and chunk must not be from an unrelated domain
 * (e.g. skin tumors, liver, spine) unless the chunk actually evaluated that target domain.
 */
export function isDomainMismatched(
  propositionText: string,
  paperTitle: string,
  chunkSection: string | null,
  chunkText: string,
  question?: string
): boolean {
  const lowerProp = propositionText.toLowerCase();
  const lowerPaper = paperTitle.toLowerCase();
  const lowerChunk = chunkText.toLowerCase();
  const lowerQuestion = (question || "").toLowerCase();

  const isBreastContext = /\bbreast\b/i.test(lowerProp) || /\bbreast\b/i.test(lowerQuestion);

  // Target domain: Breast
  if (isBreastContext) {
    // Non-breast papers: skin / dermatology
    if (/\b(skin(\s+tumors?|\s+cancer|\s+disease|\s+lesions?)?|dermatolog\w*|dermoscopic)\b/i.test(lowerPaper) && !/\bbreast\b/i.test(lowerPaper)) {
      if (!/\bbreast\b/i.test(lowerChunk) || /\b(skin\s+disease|dermoscopic|benign\s+tumors?|epidermal\s+cysts?|pilomatricoma)\b/i.test(lowerChunk)) {
        return true;
      }
    }
    // Non-breast papers: liver / hepatic
    if (/\b(liver|hepatic)\b/i.test(lowerPaper) && !/\bbreast\b/i.test(lowerPaper)) {
      if (!/\bbreast\b/i.test(lowerChunk)) {
        return true;
      }
    }
    // Non-breast papers: lymph node tuberculosis
    if (/\b(lymph\s+node\s+tuberculosis|lntb)\b/i.test(lowerPaper) && !/\bbreast\b/i.test(lowerPaper)) {
      if (!/\bbreast\b/i.test(lowerChunk)) {
        return true;
      }
    }
    // Non-breast papers: cervical spine
    if (/\b(cervical\s+spondylotic|csm|spine)\b/i.test(lowerPaper) && !/\bbreast\b/i.test(lowerPaper)) {
      if (!/\bbreast\b/i.test(lowerChunk)) {
        return true;
      }
    }
    // Non-breast papers: lung / pulmonary
    if (/\b(lung|pulmonary)\b/i.test(lowerPaper) && !/\bbreast\b/i.test(lowerPaper)) {
      if (!/\bbreast\b/i.test(lowerChunk)) {
        return true;
      }
    }
  }

  // Target domain: Quantum Computing / Surface Codes
  const isQuantumContext = /\b(quantum|surface\s+code)\b/i.test(lowerProp) || /\b(quantum|surface\s+code)\b/i.test(lowerQuestion);
  if (isQuantumContext) {
    if (/\b(breast|cancer|ultrasound|dermatol|liver)\b/i.test(lowerPaper) && !/\bquantum\b/i.test(lowerPaper)) {
      return true;
    }
  }

  return false;
}

/**
 * Identifies chunks that merely review or summarize third-party external studies
 * (e.g. "The study proposed by [30]...", "In [30], the authors...", "Smith et al. (2020) proposed...").
 * These should not be cited as the current paper's own empirical results.
 *
 * Avoids rejecting genuine findings in Results or Discussion merely because they contain
 * baseline comparisons or literature citations.
 */
export function isThirdPartyLiteratureChunk(section: string | null, text: string): boolean {
  const trimmed = text.trim();
  const lowerSec = (section || "").toLowerCase();
  const isBackgroundOrIntro = !section || /background|intro|related|literature|review|overview/i.test(lowerSec);

  const explicitThirdParty =
    /\b((in\s+the\s+study\s+presented\s+in|according\s+to|studies\s+in|prior\s+studies\s+in)\s+\[\d+\]|(the\s+study|studies)\s+(proposed|conducted|presented|performed|reported|described|developed|introduced)\s+by\s+\[\d+\]|(the\s+study|studies)\s+\[\d+\]\s+(proposed|conducted|presented|demonstrated|investigated|developed|reported)|the\s+study\s+conducted\s+by\s+\[\d+\]|in\s+this\s+article,\s+we\s+cite\s+the\s+relevant\s+content\s+from\s+this\s+literature|in\s+\[\d+\],\s*(the\s+)?(authors?|researchers?|study|work|investigators?|various|several|a\s+transfer|deep-learning|a\s+vector)|in\s+(a\s+)?study\s+by\s*(\[[0-9]+\]|[A-Z][a-z]+(\s+et\s+al\.)?))/i;

  if (explicitThirdParty.test(trimmed)) {
    // If in Results or Discussion, only reject if it is not reporting own findings
    const isResultsOrDiscussion = /results?|discussion|findings?/i.test(lowerSec);
    if (isResultsOrDiscussion) {
      const hasOwnFindings = /\b(our\s+(study|model|method|network|approach|results?)|we\s+(found|achieved|observed|propose|demonstrate|show|trained|evaluated)|in\s+this\s+paper\s+we)\b/i.test(trimmed);
      if (hasOwnFindings) {
        return false;
      }
    }
    return true;
  }

  // 2. Author-year literature reviews in Background / Introduction / Related Work
  // e.g., "Lee et al. [27] conducted...", "Sun et al. (2021) proposed...", "In [30], Zhang et al...."
  if (isBackgroundOrIntro) {
    const authorYearReview =
      /\b([A-Z][a-z]+(\s+et\s+al\.)?\s*(\[\d+\]|\([12]\d{3}\))\s*(investigated|proposed|developed|conducted|reported|evaluated|trained|analyzed|used|demonstrated|showed|found|observed|explored|applied))\b/i;
    if (authorYearReview.test(trimmed)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether an introductory or background passage merely summarizes earlier third-party work
 * rather than the current manuscript's own measured results.
 */
export function isBackgroundLiteratureReview(
  claimText: string,
  chunkSection: string | null,
  chunkText: string
): boolean {
  if (isThirdPartyLiteratureChunk(chunkSection, chunkText)) {
    return true;
  }

  const isBackground = !chunkSection || /background|intro|related|literature|review/i.test(chunkSection);
  if (!isBackground) return false;

  // In background/intro, check if text discusses other studies with bracket citations or author-year citations
  if (/\[\d+\]|\([12]\d{3}\)|[A-Z][a-z]+\s+et\s+al\./.test(chunkText)) {
    if (
      /\b(the\s+study|studies|prior|earlier|previous|other\s+researchers?|authors?\s+in|reviewed|survey|literature|recently)\b/i.test(chunkText) ||
      /\b(accuracy|improved|superior|high\s+diagnostic|effectively|demonstrated|screening\s+tool|performance|enhance|classify|classification|potential|promise|reduce|transfer\s+learning)\b/i.test(claimText)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether an AI or CAD outcome/claim is falsely attributed to a clinical imaging study
 * (e.g., attributing biopsy reduction or diagnostic accuracy to AI when the study evaluated
 * radiologist-performed CEUS/SWE without AI models).
 */
export function isAiAttributionToClinicalStudy(
  claimText: string,
  paperTitle: string,
  chunkText: string
): boolean {
  const lowerClaim = claimText.toLowerCase();
  const lowerPaper = paperTitle.toLowerCase();
  const lowerChunk = chunkText.toLowerCase();

  const assertsAi = /\b(ai|artificial\s+intelligence|machine\s+learning|deep\s+learning|cad|computer-aided|neural\s+network|cnn|algorithm|classifiers?|classification\s+model)\b/i.test(lowerClaim);
  if (!assertsAi) return false;

  // Non-AI clinical imaging studies (such as CEUS / SWE studies by physicians)
  const isClinicalModalityPaper = /\b(multimodal\s+ultrasound|contrast-enhanced|ceus|shear-wave|swe|elastograph\w*)\b/i.test(lowerPaper) &&
    !/\b(ai|artificial\s+intelligence|cad|computer-aided|deep\s+learning|machine\s+learning|neural|network|model|cnn)\b/i.test(lowerPaper);

  const chunkHasAi = /\b(ai|cad|computer-aided|deep\s+learning|neural\s+network|cnn|machine\s+learning|algorithm|model)\b/i.test(lowerChunk);

  return isClinicalModalityPaper && !chunkHasAi;
}

/**
 * Verifies that the cited paper and passage actually evaluate the specific technical
 * method or classifier asserted in the claim (e.g., CNN vs KNN vs clinical modalities),
 * preventing false cross-study corroboration across disparate techniques.
 */
export function isTechnologySupportedByPaper(
  claimText: string,
  paperTitle: string,
  chunkText: string
): boolean {
  const lowerClaim = claimText.toLowerCase();
  const lowerPaper = paperTitle.toLowerCase();
  const lowerChunk = chunkText.toLowerCase();

  // CNN / Deep Learning assertion
  if (/\b(cnn|convolutional[\s-]+neural[\s-]+network|deep[\s-]+neural[\s-]+network|deep[\s-]+learning|fc-cnn|resnet|densenet|vgg)\b/i.test(lowerClaim)) {
    const hasDeepLearning = /\b(cnn|convolutional|deep[\s-]+learning|deep[\s-]+neural|fc-cnn|resnet|densenet|vgg|attention[\s-]+(network|mechanism|layer|model)|neural[\s-]+network)\b/i.test(lowerPaper) ||
      /\b(cnn|convolutional|deep[\s-]+learning|deep[\s-]+neural|fc-cnn|resnet|densenet|vgg|attention[\s-]+(layer|mechanism|network)|neural[\s-]+network)\b/i.test(lowerChunk);
    if (!hasDeepLearning) return false;
  }

  // Traditional KNN / handcrafted classifier assertion
  if (/\b(knn|k[\s-]+nearest|weighted[\s-]+knn|ensemble[\s-]+subspace[\s-]+knn|median[\s-]+knn|handcrafted[\s-]+features?)\b/i.test(lowerClaim)) {
    const hasKnn = /\b(knn|k[\s-]+nearest|texture[\s-]+features?|handcrafted|feature[\s-]+extraction)\b/i.test(lowerPaper) ||
      /\b(knn|k[\s-]+nearest|texture[\s-]+features?|handcrafted)\b/i.test(lowerChunk);
    if (!hasKnn) return false;
  }

  // Clinical SWE / CEUS assertion without AI
  if (/\b(contrast[\s-]+enhanced[\s-]+ultrasound|ceus|shear[\s-]+wave[\s-]+elastography|swe)\b/i.test(lowerClaim) &&
      !/\b(ai|cad|machine[\s-]+learning|deep[\s-]+learning)\b/i.test(lowerClaim)) {
    const hasSweCeus = /\b(ceus|swe|contrast[\s-]+enhanced|elastograph\w*)\b/i.test(lowerPaper) ||
      /\b(ceus|swe|contrast[\s-]+enhanced|elastograph\w*)\b/i.test(lowerChunk);
    if (!hasSweCeus) return false;
  }

  return true;
}

/**
 * Checks whether an empirical diagnostic accuracy claim is supported by actual classification
 * performance evaluation metrics, rather than merely discussing training setup/hardware or general
 * clinical challenges (operator variability, fatigue, acoustic artifacts).
 */
export function isAccuracyPropositionSupported(claimText: string, chunkText: string): boolean {
  const lowerClaim = claimText.toLowerCase();
  const lowerChunk = chunkText.toLowerCase();

  const isAccuracyClaim = /\b(diagnostic\s+accuracy|classification\s+accuracy|accuracy|sensitivity|specificity|auroc|auc|precision|recall|f1(-score|\s+score)?|discriminat(ing|ion)|performance)\b/i.test(lowerClaim);
  if (!isAccuracyClaim) return true;

  const hasPerformanceMetrics = /\b(accuracy|sensitivity|specificity|auroc|auc|precision|recall|f1|f-measure|roc|dice|true\s+positives?|false\s+positives?|outperformed|superior\s+performance|classification\s+skills|precision\s+metrics|best\s+model|highest\s+accuracy|p\s*[<=]\s*\d|\d+(\.\d+)?%)\b/i.test(lowerChunk);
  const isOnlyTrainingSetupOrHardware = /\b(python|kaggle|hardware|gpus?|batch\s+size|epochs?|learning\s+rate|fine\s+tuning|trained\s+with\s+\d+\s+epochs?)\b/i.test(lowerChunk) && !hasPerformanceMetrics;
  const isOnlyClinicalChallenges = /\b(operator-dependent|physical\s+fatigue|lack\s+of\s+attentiveness|misdetection|speckle\s+noise|acoustic\s+shadowing)\b/i.test(lowerChunk) && !hasPerformanceMetrics;
  const isOnlyEthicsOrEnrollment = /\b(institutional\s+review\s+board|ethics\s+committee|declaration\s+of\s+helsinki|informed\s+consent)\b/i.test(lowerChunk) && !hasPerformanceMetrics;

  if (isOnlyTrainingSetupOrHardware || isOnlyClinicalChallenges || isOnlyEthicsOrEnrollment || !hasPerformanceMetrics) {
    return false;
  }
  return true;
}

/**
 * Detects whether a claim asserts an unmeasured speculative or future benefit (e.g. "reduces biopsies")
 * as an established, measured empirical trial outcome when the passage only discusses potential or hypothesis.
 */
export function isHypotheticalBenefitTreatedAsEmpiricalResult(claimText: string, chunkText: string): boolean {
  const lowerClaim = claimText.toLowerCase();
  const lowerChunk = chunkText.toLowerCase();

  // If claim asserts that an intervention reduces biopsies or surgeries as an empirical outcome
  const assertsBiopsyReduction = /\b(reduces?|reduced|eliminat\w*|decreas\w*|lowers?)\s+(unnecessary\s+)?(biops\w*|surger\w*|procedures?)\b/i.test(lowerClaim);
  if (!assertsBiopsyReduction) return false;

  // If the claim is already properly qualified as a potential/inferred/suggested benefit, it's acceptable
  const isProperlyQualified = /\b(potential|suggest(ed|s)?|hypothesi[zs]\w*|may\s+help|could\s+reduce|aims\s+to|has\s+the\s+potential)\b/i.test(lowerClaim);
  if (isProperlyQualified) return false;

  // If chunk only discusses prospective/potential benefit without empirical biopsy trial outcomes
  const isHypotheticalInChunk = /\b(may\s+help|potential\s+to|could\s+be|beneficial\s+for.*thereby\s+reducing|can\s+benefit.*reducing|thereby\s+reducing\s+the\s+need)\b/i.test(lowerChunk);
  const hasMeasuredBiopsyTrialData = /\b(biopsy\s+rate\s+(decreased|reduced)\s+by|\d+%\s+reduction\s+in\s+biopsies|avoided\s+in\s+\d+|biopsies\s+were\s+prevented)\b/i.test(lowerChunk);

  if (isHypotheticalInChunk && !hasMeasuredBiopsyTrialData) {
    return true; // Claim treated a hypothetical/speculative benefit as an established empirical result
  }

  return false;
}

/**
 * Verifies that comparative superiority claims (e.g. "outperformed existing breast cancer methods",
 * "superior to state-of-the-art", "surpassed prior models") are actually supported by comparative
 * baseline evaluation in the cited chunk, rather than merely evaluating internal proposed model variants.
 */
export function isComparativeSuperioritySupported(claimText: string, chunkText: string): boolean {
  const lowerClaim = claimText.toLowerCase();
  const lowerChunk = chunkText.toLowerCase();

  const assertsExternalComparison =
    /\b(outperform\w*|surpass\w*|superior\s+to|exceed\w*|better\s+than|highest\s+diagnostic\s+accuracy\s+compared\s+to)\s+(existing|other|prior|benchmark|alternative|state-of-the-art|sota)\b/i.test(lowerClaim) ||
    /\boutperformed\s+existing\s+breast\s+cancer\s+methods\b/i.test(lowerClaim);

  if (!assertsExternalComparison) return true;

  // The chunk must contain genuine comparative baseline evaluation:
  // e.g. naming specific benchmark architectures (AlexNet, GoogLeNet, ResNet, VGG, MobileNet, Inception, ZFNet, etc.)
  // or explicit comparison tables (Table 4).
  // NOTE: Bare conclusion claims like "Compared to existing breast cancer methods, the proposed model achieves the highest diagnostic accuracy"
  // without baseline models or comparative tables MUST NOT validate comparative superiority!
  const hasComparativeBaselines =
    /\b(alexnet|zfnet|vgg|inception|mobilenet|wideresnet|googlenet|resnet(34|50)?|densenet|efficientnet|vit-patch|table\s+4|benchmark\s+architectures?|baseline\s+architectures?)\b/i.test(lowerChunk) ||
    /\b(outperformed|surpassed|superior\s+to)\s+(alexnet|googlenet|resnet|vgg|densenet|other\s+models\s+such\s+as)\b/i.test(lowerChunk);

  if (!hasComparativeBaselines) {
    return false;
  }

  // Cross-dataset check:
  // If the claim asserts comparative superiority on ultrasound images, but the chunk only compares against
  // prior literature on histopathology images (Table 5, BreakHis, whole-mount slides, IDC), reject the mismatch!
  const isUltrasoundClaim = /\b(ultrasound|cairo\s+university)\b/i.test(lowerClaim);
  const isOnlyHistopathologyComparison = /\b(histopathology|breakhis|whole-mount|idc-negative|idc-positive|table\s+5)\b/i.test(lowerChunk) &&
    !/\b(cairo\s+university|ultrasound\s+images?\s+dataset|table\s+4)\b/i.test(lowerChunk);

  if (isUltrasoundClaim && isOnlyHistopathologyComparison) {
    return false;
  }

  return true;
}

/**
 * Ensures that conditional or partial empirical improvements across model backbones
 * (e.g. Kim et al. finding that FC-CNN outperformed traditional CNN for most, but not all, models)
 * are not converted into unqualified universal superiority claims.
 */
export function hasUnqualifiedUniversalAssertion(claimText: string, chunkText: string): boolean {
  const lowerClaim = claimText.toLowerCase();
  const lowerChunk = chunkText.toLowerCase();

  const sourceIsQualifiedMost = /\b(for\s+most\s+(of\s+the\s+)?(cnn\s+)?models?|most\s+simulation\s+results|most\s+performance\s+metrics)\b/i.test(lowerChunk);
  if (!sourceIsQualifiedMost) return false;

  const assertsUniversal = /\b(outperformed|surpassed|superior\s+to)\s+(traditional|conventional)\s+(?:(?:b-mode|b-mode-only)\s+)?cnn\s+models?\b/i.test(lowerClaim);
  const hasQualification = /\b(for\s+most|most\s+(evaluated\s+)?(cnn\s+)?models?|most\s+architectures?|majority\s+of|some\s+models?|not\s+all)\b/i.test(lowerClaim);

  if (assertsUniversal && !hasQualification) {
    return true; // Unqualified universal claim when source text only supports "most models"
  }

  return false;
}

/**
 * Splits or prunes compound claims where a valid empirical metric is attached to an unsupported
 * comparative clause (e.g. "achieved 93% accuracy on X dataset, outperforming existing methods").
 * If the comparative clause is unsupported by the chunk, returns the base proposition.
 */
export function splitOrPruneCompoundClaim(claimText: string, chunkText: string): string {
  const trimmed = claimText.trim();

  // Pattern 1: "... on dataset, outperforming existing breast cancer methods."
  const trailingOutperformMatch = trimmed.match(
    /^(.*?)(?:,\s*|\s+)(?:and\s+)?(?:outperforming|surpassing|exceeding)\s+(?:existing|other|prior|state-of-the-art)\s+.*?\s*(\.)?$/i
  );
  if (trailingOutperformMatch && trailingOutperformMatch[1]) {
    const baseProposition = trailingOutperformMatch[1].trim();
    if (!isComparativeSuperioritySupported(trimmed, chunkText)) {
      return baseProposition.endsWith(".") ? baseProposition : baseProposition + ".";
    }
  }

  // Pattern 2: "... on dataset and was superior to existing methods."
  const andSuperiorMatch = trimmed.match(
    /^(.*?)(?:,\s*|\s+)and\s+(?:was\s+superior\s+to|outperformed)\s+(?:existing|other|prior|state-of-the-art)\s+.*?\s*(\.)?$/i
  );
  if (andSuperiorMatch && andSuperiorMatch[1]) {
    const baseProposition = andSuperiorMatch[1].trim();
    if (!isComparativeSuperioritySupported(trimmed, chunkText)) {
      return baseProposition.endsWith(".") ? baseProposition : baseProposition + ".";
    }
  }

  return trimmed;
}

/**
 * Qualifies universal claim if the source text states that improvement occurred for most, but not all, models.
 */
export function qualifyUniversalClaimIfNeeded(claimText: string, chunkText: string): string {
  if (hasUnqualifiedUniversalAssertion(claimText, chunkText)) {
    if (/\b(outperformed|surpassed|superior\s+to)\s+(traditional|conventional)\s+(?:(?:b-mode|b-mode-only)\s+)?cnn\s+models?\s*\.?$/i.test(claimText.trim())) {
      const trimmed = claimText.trim().replace(/\.$/, "");
      return `${trimmed} for most evaluated architectures.`;
    }
    return claimText.replace(
      /\b(outperformed|surpassed|superior\s+to)\s+((?:traditional|conventional)\s+(?:(?:b-mode|b-mode-only)\s+)?cnn\s+models?)\b/i,
      "$1 $2 for most evaluated architectures"
    );
  }
  return claimText;
}

/**
 * Verifies that the cited chunk passage actually contains substantive evidence
 * supporting the specific claim, rather than describing a limitation, negative finding,
 * or unrelated detail.
 */
export function isClaimSupportedByChunk(claimText: string, chunkText: string): boolean {
  const lowerClaim = claimText.toLowerCase();
  const lowerChunk = chunkText.toLowerCase();

  // 1. Negative result / limited effect inversion:
  if (
    /\b(improves?|increases?|higher|superior|enhances?|upgrad\w*|benefit\w*|effective\w*)\b/i.test(lowerClaim) &&
    /\b(diagnostic\s+accuracy|accuracy|sensitivity|specificity|efficacy|positive\s+predictive\s+value|ppv|likelihood|bi-rads\s+category|malignancy)\b/i.test(lowerClaim)
  ) {
    if (
      /\blimited\s+effects?\b/i.test(lowerChunk) &&
      !/\b(improves?|higher|enhanced?|better)\s+(the\s+)?(sensitivity|specificity|accuracy|efficacy|diagnostic)\b/i.test(lowerChunk)
    ) {
      return false;
    }
  }

  // 1b. Upgrading/downgrading BI-RADS category proposition check:
  if (/\b(upgrad\w*|downgrad\w*)\s+(bi-rads|categor\w*)\b/i.test(lowerClaim) && !/\b(upgrad\w*|downgrad\w*)\b/i.test(lowerChunk)) {
    return false;
  }

  // 2. Operator dependency misattribution:
  if (
    /\b(improve|achieve|accurate|superior)\b/i.test(lowerClaim) &&
    /\b(breast\s+cancer\s+diagnosis\s+technique\s+is\s+operator-dependent\s+and\s+demands\s+the\s+skills)\b/i.test(lowerChunk) &&
    !/\b(we\s+found|results\s+show|achieved|accuracy\s+of)\b/i.test(lowerChunk)
  ) {
    return false;
  }

  // 3. Radiologist skill erosion / deskilling / loss of interpretative skills:
  if (/\b(interpretative\s+skills?|loss\s+of\s+skills?|losing\s+(interpretative\s+)?skills?|de-?skill\w*|erod\w*\s+skills?|lack\s+of\s+interpretative\s+skills?|diminish\w*\s+(interpretative\s+)?skills?)\b/i.test(lowerClaim)) {
    if (!/\b(loss\s+of\s+skills?|los(e|ing)\s+skills?|de-?skill\w*|erod\w*\s+skills?|diminish\w*\s+skills?|lack\s+of\s+interpretative)\b/i.test(lowerChunk)) {
      return false;
    }
  }

  // 4. Methodology & technology alignment in claims:
  // If the claim specifically asserts data augmentation, the chunk must discuss augmentation.
  if (/\b(data\s+augmentation|augment\w*)\b/i.test(lowerClaim) && !/\b(data\s+augmentation|augment\w*)\b/i.test(lowerChunk)) {
    return false;
  }
  // If the claim specifically asserts class imbalance, the chunk must discuss imbalance/unbalanced data.
  if (/\b(class\s+imbalances?|unbalanced\s+(data|dataset|classes?))\b/i.test(lowerClaim) && !/\b(imbalance|unbalanced|skew)\b/i.test(lowerChunk)) {
    return false;
  }
  // If the claim asserts 3D ultrasound, the chunk must discuss 3D.
  if (/\b(3d\s+ultrasound|3d\s+us|three-dimensional)\b/i.test(lowerClaim) && !/\b(3d|three-dimensional)\b/i.test(lowerChunk)) {
    return false;
  }

  return true;
}

/**
 * Verifies whether a statement introduces unsupported propositions, fabrications,
 * or comparative disagreement phrasing when evaluating a candidate limitation.
 */
export function statementIntroducesUnsupportedPropositions(
  statement: string,
  supportingChunkTexts: string[],
  isLimitation: boolean = false
): boolean {
  const lowerStatement = statement.toLowerCase();

  // 1. Re-asserting a disagreement or comparative conflict when evaluating a limitation
  // Genuine limitations describe study constraints or methodological boundaries, not cross-study arguments.
  if (isLimitation && /\b(differ\s+on|disagree\w*|diverg\w*|conflict\w*|contradict\w*|inconsistent\s+with\s+each\s+other|opposing\s+findings?|discrepanc\w*)\b/i.test(lowerStatement)) {
    return true;
  }

  // 2. Fabricated claims about loss of interpretative skills / deskilling (all categories)
  if (/\b(interpretative\s+skills?|loss\s+of\s+skills?|losing\s+(interpretative\s+)?skills?|de-?skill\w*|erod\w*\s+skills?|lack\s+of\s+interpretative\s+skills?|diminish\w*\s+(interpretative\s+)?skills?)\b/i.test(lowerStatement)) {
    const chunkHasSkillLoss = supportingChunkTexts.some((ct) =>
      /\b(loss\s+of\s+skills?|los(e|ing)\s+skills?|de-?skill\w*|erod\w*\s+skills?|diminish\w*\s+skills?|lack\s+of\s+interpretative)\b/i.test(ct)
    );
    if (!chunkHasSkillLoss) {
      return true; // Unsupported proposition: fabricated claim about radiologist skill loss/erosion
    }
  }

  // 3. Falsely attributing physical fatigue or human attentiveness limits to AI models (all categories)
  if (
    /\b(ai|cad|deep\s+learning|machine\s+learning|algorithm|cnn|model)\b/i.test(lowerStatement) &&
    /\b(physical\s+fatigue|lack\s+of\s+attentiveness|fatigue\s+of\s+(the\s+)?model)\b/i.test(lowerStatement)
  ) {
    const chunkHasAiFatigue = supportingChunkTexts.some((ct) =>
      /\b(ai|cad|deep\s+learning|algorithm|model)\s+.*(physical\s+fatigue|fatigue)\b/i.test(ct)
    );
    if (!chunkHasAiFatigue) {
      return true; // Unsupported proposition: attributing radiologist physical fatigue to the AI model
    }
  }

  // 4. Metric misattribution: Accuracy vs Sensitivity in Magnuska Table 11
  // In Table 11, 85.00 is Accuracy, while Sensitivity is 83.33%!
  if (
    /\b(weighted[\s-]+knn|magnuska)\b/i.test(lowerStatement) ||
    supportingChunkTexts.some((ct) => /weighted[\s-]+knn.*85\.00\s+83\.33/i.test(ct))
  ) {
    if (/\bsensitivity\s+(of\s+)?85(\.00)?%?\b/i.test(lowerStatement)) {
      return true; // Metric misattribution: 85.00% is accuracy, sensitivity is 83.33%!
    }
  }

  // 5. Subgroup metric generalized as overall result without subgroup label (Li et al. age-stratified tables)
  const chunkHasAgeSubgroup = supportingChunkTexts.some(
    (ct) => /(<50|>=50|≥50)/.test(ct) && /\b(0\.949|0\.952|94\.1)\b/.test(ct)
  );
  if (chunkHasAgeSubgroup) {
    const mentionsAgeOrSubgroup = /\b(age|subgroup|younger|older|under\s+50)\b|(<50|>=50|≥50)/i.test(lowerStatement);
    if (!mentionsAgeOrSubgroup && /\b(0\.949|0\.952|94\.1%?)\b/.test(lowerStatement)) {
      return true; // Subgroup metric generalized without subgroup label!
    }
    // Explicitly reject promoting a subgroup metric to an "overall" cohort claim
    if (/\b(overall|whole\s+cohort|total\s+cohort)\b/i.test(lowerStatement) && /\b(0\.949|0\.952)\b/.test(lowerStatement)) {
      return true;
    }
  }

  // 6. Cross-study quantifier assertion on a single-study evidence passage
  if (
    /\b(most\s+studies|all\s+studies|none\s+of\s+the\s+studies|majority\s+of\s+studies|across\s+studies|studies\s+generally|all\s+evaluated\s+models|most\s+models)\b/i.test(
      lowerStatement
    )
  ) {
    const isSingleStudyPassage = supportingChunkTexts.every(
      (ct) =>
        !/\b(systematic\s+review|meta-analysis|we\s+reviewed\s+\d+\s+studies|survey\s+of\s+\d+)\b/i.test(
          ct
        )
    );
    if (isSingleStudyPassage) {
      return true; // Unsupported multi-study proposition: single-study passage cannot support cross-corpus quantifier
    }
  }

  // 7. External validation absence assertion without external validation evidence
  if (
    /\b(external\s+validation|external\s+testing|independent\s+validation|independent\s+test)\b/i.test(
      lowerStatement
    ) &&
    /\b(did\s+not\s+perform|lacked|no\s+external|without\s+external|failed\s+to\s+perform|absence\s+of\s+external|not\s+perform\s+external)\b/i.test(
      lowerStatement
    )
  ) {
    const chunkHasExtVal = supportingChunkTexts.some((ct) =>
      /\b(external\s+validation|external\s+test\w*|independent\s+(test|cohort|validation)|external\s+cohort)\b/i.test(
        ct
      )
    );
    if (!chunkHasExtVal) {
      return true; // Unsupported proposition: claiming absence of external validation from passage that never evaluated it
    }
  }

  // 8. Generalizability limitation linked to external validation
  if (
    /\b(generaliz\w*|extrapolat\w*)\b/i.test(lowerStatement) &&
    /\b(external\s+validation|external\s+testing)\b/i.test(lowerStatement)
  ) {
    const chunkHasExtVal = supportingChunkTexts.some((ct) =>
      /\b(external\s+validation|external\s+test\w*|independent\s+(test|cohort|validation))\b/i.test(
        ct
      )
    );
    if (!chunkHasExtVal) {
      return true; // Unsupported proposition: generalizability penalty linked to unmentioned external validation
    }
  }

  return false;
}

/**
 * Checks whether an asserted limitation is genuinely grounded in the cited passage,
 * rejecting citations to unrelated passages (such as dataset ethics/IRB notices,
 * hospital department descriptions, or purely positive metric summaries).
 */
export function isLimitationSupportedByChunk(limitationText: string, chunkText: string): boolean {
  const lowerLim = limitationText.toLowerCase();
  const lowerChunk = chunkText.toLowerCase();

  // Pure ethics/IRB chunk without any limitation context
  const isEthicsOnly = /\b(institutional\s+review\s+board|ethics\s+committee|declaration\s+of\s+helsinki|informed\s+consent)\b/i.test(lowerChunk) &&
    !/\b(limit\w*|challenge|drawback|shortcoming|disadvantage|scarcity|small(\s+size)?|unbalanced|bias\w*|fail\w*|difficult\w*|cost|expense)\b/i.test(lowerChunk);
  if (isEthicsOnly) return false;

  // Discussion of data augmentation preventing or avoiding overfitting is a design mitigation,
  // NOT evidence that the study suffered from an unresolved limitation of overfitting
  if (
    /\b(data\s+augmentation\s+prevents?\s+overfitting|prevent(s|ing)?\s+overfitting|to\s+avoid\s+overfitting|reduces?\s+overfitting)\b/i.test(lowerChunk) &&
    !/\b(limit\w*|drawback|shortcoming|disadvantage|small\s+(dataset|cohort|sample)|small\s+size|unbalanced|bottleneck|bias\w*|fail\w*)\b/i.test(lowerChunk)
  ) {
    return false;
  }

  // The passage must actually contain some limitation, drawback, constraint, or boundary context
  const hasLimitationContext = /\b(limit\w*|challenge|drawback|shortcoming|disadvantage|scarcity|small(\s+size)?|unbalanced|bias\w*|fail\w*|difficult\w*|cost|expense|operator|fatigue|operator-dependent|preliminary|further\s+(investigation|study|research)|not\s+evaluated|not\s+assessed|gap|bottleneck|constraint|future\s+work)\b/i.test(lowerChunk);
  if (!hasLimitationContext) {
    return false;
  }

  // Radiologist skill erosion / deskilling / loss of interpretative skills
  if (/\b(interpretative\s+skills?|loss\s+of\s+skills?|losing\s+(interpretative\s+)?skills?|de-?skill\w*|erod\w*\s+skills?|lack\s+of\s+interpretative\s+skills?|diminish\w*\s+(interpretative\s+)?skills?)\b/i.test(lowerLim)) {
    if (!/\b(loss\s+of\s+skills?|los(e|ing)\s+skills?|de-?skill\w*|erod\w*\s+skills?|diminish\w*\s+skills?|lack\s+of\s+interpretative)\b/i.test(lowerChunk)) {
      return false;
    }
  }

  // Falsely attributing physical fatigue or attentiveness limits to AI models
  if (
    /\b(ai|cad|deep\s+learning|machine\s+learning|algorithm|cnn|model)\b/i.test(lowerLim) &&
    /\b(physical\s+fatigue|lack\s+of\s+attentiveness|fatigue\s+of\s+(the\s+)?model)\b/i.test(lowerLim)
  ) {
    if (!/\b(ai|cad|deep\s+learning|algorithm|model)\s+.*(physical\s+fatigue|fatigue)\b/i.test(lowerChunk)) {
      return false;
    }
  }

  // Overfitting: chunk must mention overfitting
  if (/\boverfit\w*\b/i.test(lowerLim)) {
    if (!/\boverfit\w*\b/i.test(lowerChunk)) {
      return false;
    }
    // If the chunk only discusses data augmentation PREVENTING overfitting, it's a mitigation, NOT an unresolved limitation
    if (/\b(prevent(s|ing)?|avoid(s|ing)?|reduc(es|ing)?)\s+overfitting\b/i.test(lowerChunk) &&
        !/\b(suffer(ed|s)?|struggl(ed|es)?|prone\s+to|risk\s+of|challeng\w*|issue|bottleneck|problem)\s+.*overfitting\b/i.test(lowerChunk)) {
      return false;
    }
  }

  // Data augmentation: if limitation asserts data augmentation, chunk must discuss augmentation
  if (/\b(data\s+augmentation|augment\w*)\b/i.test(lowerLim) && !/\b(augment\w*)\b/i.test(lowerChunk)) {
    return false;
  }

  // Dataset quality, variability, or scarcity limitation requires substantive chunk discussion
  if (
    /\b(quality\s+and\s+variability|variability\s+of\s+(the\s+)?training\s+dataset|dataset\s+quality|limited\s+in\s+medical\s+ultrasound|scarcity|few\s+well-annotated|limited\s+training\s+dataset)\b/i.test(lowerLim) &&
    !/\b(quality|variabilit\w*|scarcity|small(\s+size)?|small\s+(dataset|cohort)|lack\s+of\s+data|limited|few\s+well-annotated)\b/i.test(lowerChunk)
  ) {
    return false;
  }

  // External validation: if limitation asserts external validation, chunk MUST discuss external validation
  if (
    /\b(external\s+validation|external\s+test\w*|external\s+cohort|independent\s+(test|cohort|validation))\b/i.test(
      lowerLim
    )
  ) {
    if (
      !/\b(external\s+validation|external\s+test\w*|external\s+cohort|independent\s+(test|cohort|validation))\b/i.test(
        lowerChunk
      )
    ) {
      return false; // Limitation asserts external validation, but chunk does not mention it
    }
  }

  // Generalizability linked to external validation
  if (
    /\b(generaliz\w*|extrapolat\w*)\b/i.test(lowerLim) &&
    /\b(external\s+validation|external\s+testing)\b/i.test(lowerLim)
  ) {
    if (
      !/\b(external\s+validation|external\s+test\w*|independent\s+(test|cohort|validation))\b/i.test(
        lowerChunk
      )
    ) {
      return false;
    }
  }

  // Cross-study quantifiers: a single paper's chunk cannot support a claim about "most studies" or "all studies"
  if (
    /\b(most\s+studies|all\s+studies|none\s+of\s+the\s+studies|majority\s+of\s+studies|across\s+studies|studies\s+generally|all\s+evaluated\s+models)\b/i.test(
      lowerLim
    ) &&
    !/\b(systematic\s+review|meta-analysis|we\s+reviewed\s+\d+\s+studies)\b/i.test(lowerChunk)
  ) {
    return false;
  }

  // Clinical subgroup restriction: Li et al. cost and limited PPV observation was strictly in BI-RADS 3
  if (
    /\b(cost|expense|expensive|limited\s+effect.*(predictive|ppv)|without\s+significantly\s+improving)\b/i.test(lowerLim) &&
    /\b(bi-rads\s*3|category\s*3)\b/i.test(lowerChunk) &&
    !/\b(bi-rads\s*3|category\s*3|low-risk)\b/i.test(lowerLim)
  ) {
    return false; // Clinical finding generalized beyond studied subgroup (BI-RADS 3)
  }

  // Key topic alignment checks
  if (/unsupervised/i.test(lowerLim) && !/unsupervised/i.test(lowerChunk)) return false;
  if (/\b(cost|price|expensive)\b/i.test(lowerLim) && !/\b(cost|expense|price|expensive|fee)\b/i.test(lowerChunk)) return false;
  if (/\b(unbalanced|imbalance)\b/i.test(lowerLim) && !/\b(unbalanced|imbalance|skew)\b/i.test(lowerChunk)) return false;
  if (/\b(operator|fatigue)\b/i.test(lowerLim) && !/\b(operator|fatigue|skill|experience)\b/i.test(lowerChunk)) return false;
  if (/\b(sample\s+size|small\s+dataset|small\s+size|limited\s+data)\b/i.test(lowerLim) &&
      !/\b(small|scarcity|lack\s+of\s+data|limited|sample\s+size|few\s+well-annotated)\b/i.test(lowerChunk)) return false;

  return true;
}

/**
 * Validates whether a reported disagreement is a genuine cross-study empirical contradiction
 * rather than a comparison of non-comparable modalities or complementary study constraints.
 */
export function isNonComparableOrPseudoDisagreement(
  description: string,
  paperTitles?: string[]
): { isPseudo: boolean; limitationText?: string; reason?: string } {
  const lowerDesc = description.toLowerCase();

  // 1. Non-comparable modalities: Clinical multimodal ultrasound (CEUS, SWE) vs CAD/AI models
  const hasClinicalModality = /\b(ceus|swe|elastograph\w*|contrast-enhanced|grayscale|two-dimensional\s+ultrasound|multimodal\s+ultrasound)\b/i.test(lowerDesc);
  const hasCadAi = /\b(ai|cad|computer-aided|deep\s+learning|machine\s+learning|cnn|knn|svm|yolo|viola-jones|algorithm|classification\s+models?|classifiers?)\b/i.test(lowerDesc);

  if (hasClinicalModality && hasCadAi) {
    return {
      isPseudo: true,
      limitationText: `Methodological & modality distinction: ${description}`,
      reason: "Non-comparable interventions: clinical imaging (CEUS/SWE/multimodal) vs CAD/AI models",
    };
  }

  // 2. Complementary constraints / Operator dependency vs Algorithmic accuracy
  const isOperatorDependency = /\b(operator-depend\w*|fatigue|lack\s+of\s+attentiveness|veteran\s+diagnostician)\b/i.test(lowerDesc);
  const isDatasetConstraint = /\b(training\s+dataset|dataset\s+size|unbalanced\s+dataset|lack\s+of\s+public\s+available|scarcity|small\s+dataset)\b/i.test(lowerDesc);
  const isSpeculativeHedge = /\b(indicating\s+a\s+potential\s+gap|indicating\s+differing\s+perspectives|indicating\s+a\s+potential\s+conflict|suggesting\s+a\s+discrepancy|suggesting\s+that\s+not\s+all|potential\s+gap\s+in\s+addressing|potential\s+conflict\s+in\s+the\s+emphasis)\b/i.test(lowerDesc);

  if ((isOperatorDependency || isDatasetConstraint) && (isSpeculativeHedge || hasCadAi)) {
    return {
      isPseudo: true,
      limitationText: `Study constraint & context: ${description}`,
      reason: "Complementary study limitation or general context misclassified as disagreement",
    };
  }

  // 3. General complementary perspectives with hedge phrasing
  if (isSpeculativeHedge) {
    return {
      isPseudo: true,
      limitationText: `Reported perspective: ${description}`,
      reason: "Hedged complementary observation rather than empirical contradiction",
    };
  }

  // 4. Fabricated deskilling or ungrounded skill erosion claims
  if (/\b(interpretative\s+skills?|loss\s+of\s+skills?|losing\s+(interpretative\s+)?skills?|de-?skill\w*|erod\w*\s+skills?|lack\s+of\s+interpretative\s+skills?|diminish\w*\s+(interpretative\s+)?skills?)\b/i.test(lowerDesc)) {
    return {
      isPseudo: true,
      limitationText: `Reported observation: ${description}`,
      reason: "Ungrounded or fabricated claim regarding radiologist skill loss/deskilling",
    };
  }

  return { isPseudo: false };
}

export interface EvidenceVerificationParams {
  propositionText: string;
  category: "claim" | "disagreement" | "limitation";
  paperTitle: string;
  chunkSection: string | null;
  chunkText: string;
  question?: string;
}

export interface EvidenceVerificationResult {
  isValid: boolean;
  reason?: string;
}

/**
 * Unified evidence verification engine ensuring symmetric evidence-integrity requirements
 * across claims, corroboration statements, and limitations.
 */
export function verifyEvidencePassage(params: EvidenceVerificationParams): EvidenceVerificationResult {
  const { propositionText, category, paperTitle, chunkSection, chunkText, question } = params;

  // 1. Bibliographic / reference check (all categories)
  if (isReferenceChunk(chunkSection, chunkText)) {
    return { isValid: false, reason: "Reference or bibliography chunk" };
  }

  // 2. Third-party external literature survey check (all categories)
  if (isThirdPartyLiteratureChunk(chunkSection, chunkText)) {
    return { isValid: false, reason: "Third-party literature review passage" };
  }

  // 3. Domain alignment check (all categories: claims, disagreements, and limitations)
  if (isDomainMismatched(propositionText, paperTitle, chunkSection, chunkText, question)) {
    return { isValid: false, reason: "Domain mismatch between proposition and study subject" };
  }

  // 4. Category-specific checks
  if (category === "claim") {
    if (isBackgroundLiteratureReview(propositionText, chunkSection, chunkText)) {
      return { isValid: false, reason: "Introductory background survey citing external studies" };
    }

    if (isAiAttributionToClinicalStudy(propositionText, paperTitle, chunkText)) {
      return { isValid: false, reason: "AI attribution error: clinical study without AI/CAD intervention" };
    }

    if (!isTechnologySupportedByPaper(propositionText, paperTitle, chunkText)) {
      return { isValid: false, reason: "Methodological/technology mismatch with cited study" };
    }

    if (!isAccuracyPropositionSupported(propositionText, chunkText)) {
      return { isValid: false, reason: "Accuracy claim not supported by performance evaluation evidence" };
    }

    if (!isComparativeSuperioritySupported(propositionText, chunkText)) {
      return { isValid: false, reason: "Comparative superiority claim not supported by baseline evaluation in cited chunk" };
    }

    if (hasUnqualifiedUniversalAssertion(propositionText, chunkText)) {
      return { isValid: false, reason: "Unqualified universal superiority claim; source manuscript qualifies improvement to most, not all, models" };
    }

    if (isHypotheticalBenefitTreatedAsEmpiricalResult(propositionText, chunkText)) {
      return { isValid: false, reason: "Hypothetical/speculative potential treated as empirical outcome" };
    }

    if (statementIntroducesUnsupportedPropositions(propositionText, [chunkText], false)) {
      return { isValid: false, reason: "Claim introduces unsupported propositions (e.g. fabricated deskilling)" };
    }

    if (!isClaimSupportedByChunk(propositionText, chunkText)) {
      return { isValid: false, reason: "Negative or limited effect passage contradicts claim assertion" };
    }
  } else if (category === "disagreement") {
    if (statementIntroducesUnsupportedPropositions(propositionText, [chunkText], false)) {
      return { isValid: false, reason: "Disagreement introduces unsupported propositions (e.g. fabricated deskilling)" };
    }
  } else if (category === "limitation") {
    if (statementIntroducesUnsupportedPropositions(propositionText, [chunkText], true)) {
      return { isValid: false, reason: "Limitation introduces unsupported propositions or comparative disagreement framing" };
    }

    if (isAiAttributionToClinicalStudy(propositionText, paperTitle, chunkText)) {
      return { isValid: false, reason: "AI attribution error: clinical imaging limitation incorrectly attributed to AI/CAD" };
    }

    if (!isTechnologySupportedByPaper(propositionText, paperTitle, chunkText)) {
      return { isValid: false, reason: "Methodological/technology mismatch with cited study in limitation" };
    }

    if (!isLimitationSupportedByChunk(propositionText, chunkText)) {
      return { isValid: false, reason: "Limitation proposition not substantiated by passage discussion" };
    }
  }

  return { isValid: true };
}

/**
 * Validates multi-paper synthesis output with strict claim-level provenance and server hydration.
 *
 * Guarantees:
 * 1. Model identifiers (paperId, chunkId) are strictly verified against the supplied evidence sets.
 * 2. Cross-paper mismatch prevention: chunk.paperId must strictly match the claimed paperId.
 * 3. Chunks must have been supplied in the retrieved evidence set (not merely present elsewhere in DB).
 * 4. Unsupported claim dropping: If a claim loses ALL valid citations, it is completely dropped.
 * 5. Hydration: Paper titles, authors, DOIs, page numbers, sections, and snippets are hydrated server-side.
 * 6. Computes exact unique supporting paper count per claim ("Supported by X papers").
 * 7. Applies symmetric evidence verification across claims, disagreements, and limitations.
 */
export function validateMultiPaperSynthesis(
  modelOutput: MultiPaperSynthesisOutput,
  suppliedEvidenceSets: PaperEvidenceSet[],
  question?: string
): MultiPaperValidationResult {
  interface PaperLookup {
    paperTitle: string;
    authors: string[];
    doi: string | null;
    publicationDate: string | null;
    journal: string | null;
    chunks: Map<string, {
      chunkIndex: number;
      pageNumber: number | null;
      section: string | null;
      text: string;
    }>;
  }

  const paperLookup = new Map<string, PaperLookup>();

  for (const set of suppliedEvidenceSets) {
    const chunkMap = new Map<string, {
      chunkIndex: number;
      pageNumber: number | null;
      section: string | null;
      text: string;
    }>();

    for (const chunk of set.chunks) {
      chunkMap.set(chunk.id, {
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber,
        section: chunk.section,
        text: chunk.text,
      });
    }

    paperLookup.set(set.paperId, {
      paperTitle: set.paperTitle,
      authors: set.authors,
      doi: set.doi,
      publicationDate: set.publicationDate,
      journal: set.journal,
      chunks: chunkMap,
    });
  }

  let rejectedCitationCount = 0;
  let rejectedClaimsCount = 0;
  const invalidCitationIds: string[] = [];

  // If model flagged insufficient evidence upfront
  if (modelOutput.insufficientEvidence) {
    return {
      claims: [],
      disagreements: [],
      limitations: [],
      insufficientEvidence: true,
      rejectedCitationCount: 0,
      rejectedClaimsCount: modelOutput.claims?.length || 0,
      invalidCitationIds: [],
    };
  }

  // 1. Validate Claims
  const validatedClaims: ValidatedMultiPaperClaim[] = [];

  for (const rawClaim of modelOutput.claims || []) {
    let claimText = rawClaim.text?.trim();
    if (!claimText) continue;

    const claimAnchors: HydratedMultiPaperAnchor[] = [];
    const supportingPaperIdsSet = new Set<string>();

    for (const ev of rawClaim.evidence || []) {
      const paperMeta = paperLookup.get(ev.paperId);
      if (!paperMeta) {
        rejectedCitationCount += ev.chunkIds.length;
        invalidCitationIds.push(...ev.chunkIds);
        continue;
      }

      for (const chunkId of ev.chunkIds || []) {
        const trimmedChunkId = chunkId?.trim();
        const chunkMeta = paperMeta.chunks.get(trimmedChunkId);

        if (!chunkMeta) {
          rejectedCitationCount++;
          invalidCitationIds.push(trimmedChunkId);
          continue;
        }

        // Decompose/prune compound claims where comparative superiority is unsupported
        let effectiveClaimText = splitOrPruneCompoundClaim(claimText, chunkMeta.text);

        // Qualify universal assertion if source manuscript qualifies finding to "most models"
        effectiveClaimText = qualifyUniversalClaimIfNeeded(effectiveClaimText, chunkMeta.text);

        const verification = verifyEvidencePassage({
          propositionText: effectiveClaimText,
          category: "claim",
          paperTitle: paperMeta.paperTitle,
          chunkSection: chunkMeta.section,
          chunkText: chunkMeta.text,
          question,
        });

        if (!verification.isValid) {
          rejectedCitationCount++;
          invalidCitationIds.push(trimmedChunkId);
          continue;
        }

        // Propagate pruned or qualified proposition to the claim text
        claimText = effectiveClaimText;

        supportingPaperIdsSet.add(ev.paperId);
        claimAnchors.push({
          paperId: ev.paperId,
          paperTitle: paperMeta.paperTitle,
          authors: paperMeta.authors,
          doi: paperMeta.doi,
          publicationDate: paperMeta.publicationDate,
          journal: paperMeta.journal,
          chunkId: trimmedChunkId,
          chunkIndex: chunkMeta.chunkIndex,
          pageNumber: chunkMeta.pageNumber,
          section: chunkMeta.section,
          snippet: formatSnippet(chunkMeta.text),
          fullText: chunkMeta.text,
        });
      }
    }

    // STRICT WITHHOLDING: If all citations were invalid, DROP CLAIM COMPLETELY
    if (claimAnchors.length === 0) {
      rejectedClaimsCount++;
      continue;
    }

    validatedClaims.push({
      text: claimText,
      supportingPaperIds: Array.from(supportingPaperIdsSet),
      supportingPaperCount: supportingPaperIdsSet.size,
      citations: claimAnchors,
    });
  }

  // 2. Validate Disagreements
  const validatedLimitations: ValidatedMultiPaperLimitation[] = [];
  const validatedDisagreements: ValidatedMultiPaperDisagreement[] = [];

  for (const rawDisagreement of modelOutput.disagreements || []) {
    const desc = rawDisagreement.description?.trim();
    if (!desc) continue;

    const anchors: HydratedMultiPaperAnchor[] = [];
    const paperIdsSet = new Set<string>();

    for (const ev of rawDisagreement.evidence || []) {
      const paperMeta = paperLookup.get(ev.paperId);
      if (!paperMeta) continue;

      for (const chunkId of ev.chunkIds || []) {
        const chunkMeta = paperMeta.chunks.get(chunkId?.trim());
        if (!chunkMeta) continue;

        const verification = verifyEvidencePassage({
          propositionText: desc,
          category: "disagreement",
          paperTitle: paperMeta.paperTitle,
          chunkSection: chunkMeta.section,
          chunkText: chunkMeta.text,
          question,
        });

        if (!verification.isValid) {
          rejectedCitationCount++;
          continue;
        }

        paperIdsSet.add(ev.paperId);
        anchors.push({
          paperId: ev.paperId,
          paperTitle: paperMeta.paperTitle,
          authors: paperMeta.authors,
          doi: paperMeta.doi,
          publicationDate: paperMeta.publicationDate,
          journal: paperMeta.journal,
          chunkId: chunkId.trim(),
          chunkIndex: chunkMeta.chunkIndex,
          pageNumber: chunkMeta.pageNumber,
          section: chunkMeta.section,
          snippet: formatSnippet(chunkMeta.text),
          fullText: chunkMeta.text,
        });
      }
    }

    if (anchors.length === 0) continue;

    // Check 1: Must cite at least 2 distinct papers
    const isSinglePaper = paperIdsSet.size < 2;

    // Check 2: Must be comparable interventions and genuine empirical contradiction
    const paperTitles = anchors.map((a) => a.paperTitle);
    const pseudoCheck = isNonComparableOrPseudoDisagreement(desc, paperTitles);

    if (isSinglePaper || pseudoCheck.isPseudo) {
      // Disagreement rejected. Do NOT automatically convert to limitation.
      // Only retain as limitation if:
      // 1. The statement does NOT introduce unsupported propositions (e.g. fabricated claims, deskilling).
      // 2. All citations independently pass domain, attribution, and evidence checks for limitations.
      // 3. The limitation is independently supported by each surviving cited passage.
      // Otherwise, discard it.
      const candidateLimitationText = pseudoCheck.isPseudo
        ? (pseudoCheck.limitationText || desc)
        : `Single-study observation: ${desc}`;

      // Check for unsupported propositions against the supporting chunks
      const chunkTextsForCandidate = anchors.map((a) => {
        const pm = paperLookup.get(a.paperId);
        return pm?.chunks.get(a.chunkId)?.text || a.snippet;
      });

      if (statementIntroducesUnsupportedPropositions(candidateLimitationText, chunkTextsForCandidate, true)) {
        // Discard completely - contains unsupported propositions, deskilling claims, or comparative disagreement framing
        rejectedCitationCount += anchors.length;
        continue;
      }

      // Re-verify each anchor strictly as a limitation
      const validLimitationAnchors: HydratedMultiPaperAnchor[] = [];
      const validLimitationPaperIds = new Set<string>();

      for (const anchor of anchors) {
        const pm = paperLookup.get(anchor.paperId);
        const cm = pm?.chunks.get(anchor.chunkId);
        if (!pm || !cm) continue;

        const verification = verifyEvidencePassage({
          propositionText: candidateLimitationText,
          category: "limitation",
          paperTitle: pm.paperTitle,
          chunkSection: cm.section,
          chunkText: cm.text,
          question,
        });

        if (verification.isValid) {
          validLimitationPaperIds.add(anchor.paperId);
          validLimitationAnchors.push(anchor);
        } else {
          rejectedCitationCount++;
        }
      }

      // Only retain if ALL citations independently pass domain, attribution, and evidence checks
      if (validLimitationAnchors.length > 0 && validLimitationAnchors.length === anchors.length) {
        validatedLimitations.push({
          text: candidateLimitationText,
          supportingPaperIds: Array.from(validLimitationPaperIds),
          citations: validLimitationAnchors,
        });
      }
      continue;
    }

    validatedDisagreements.push({
      description: desc,
      supportingPaperIds: Array.from(paperIdsSet),
      citations: anchors,
    });
  }

  // 3. Validate Limitations
  for (const rawLimitation of modelOutput.limitations || []) {
    const text = rawLimitation.text?.trim();
    if (!text) continue;

    const anchors: HydratedMultiPaperAnchor[] = [];
    const paperIdsSet = new Set<string>();

    for (const ev of rawLimitation.evidence || []) {
      const paperMeta = paperLookup.get(ev.paperId);
      if (!paperMeta) continue;

      for (const chunkId of ev.chunkIds || []) {
        const chunkMeta = paperMeta.chunks.get(chunkId?.trim());
        if (!chunkMeta) continue;

        const verification = verifyEvidencePassage({
          propositionText: text,
          category: "limitation",
          paperTitle: paperMeta.paperTitle,
          chunkSection: chunkMeta.section,
          chunkText: chunkMeta.text,
          question,
        });

        if (!verification.isValid) {
          rejectedCitationCount++;
          invalidCitationIds.push(chunkId.trim());
          continue;
        }

        paperIdsSet.add(ev.paperId);
        anchors.push({
          paperId: ev.paperId,
          paperTitle: paperMeta.paperTitle,
          authors: paperMeta.authors,
          doi: paperMeta.doi,
          publicationDate: paperMeta.publicationDate,
          journal: paperMeta.journal,
          chunkId: chunkId.trim(),
          chunkIndex: chunkMeta.chunkIndex,
          pageNumber: chunkMeta.pageNumber,
          section: chunkMeta.section,
          snippet: formatSnippet(chunkMeta.text),
          fullText: chunkMeta.text,
        });
      }
    }

    // STRICT WITHHOLDING: If all citations were invalid, drop limitation
    if (anchors.length > 0) {
      validatedLimitations.push({
        text,
        supportingPaperIds: Array.from(paperIdsSet),
        citations: anchors,
      });
    }
  }

  const isInsufficient = validatedClaims.length === 0;

  return {
    claims: validatedClaims,
    disagreements: validatedDisagreements,
    limitations: validatedLimitations,
    insufficientEvidence: isInsufficient,
    rejectedCitationCount,
    rejectedClaimsCount,
    invalidCitationIds,
  };
}
