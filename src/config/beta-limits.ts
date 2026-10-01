/**
 * AI RESEARCH HUB — PRIVATE BETA USAGE LIMITS & CONTROLS
 *
 * Centralized configuration for resource bounds and protection during private beta.
 * Does not replace scientific architecture; provides sensible researcher guards.
 */

export const BETA_LIMITS = {
  // File uploads
  MAX_PDF_UPLOAD_SIZE_BYTES: 30 * 1024 * 1024, // 30 MB
  MAX_PDF_UPLOAD_SIZE_MB: 30,

  // Text inputs
  MAX_QUESTION_LENGTH: 500, // Single-paper and synthesis question limit
  MIN_QUESTION_LENGTH: 3,
  MAX_RESEARCH_OBJECTIVE_LENGTH: 1000, // Research agent objective limit
  MIN_RESEARCH_OBJECTIVE_LENGTH: 5,

  // Research scope bounds
  MAX_SYNTHESIS_PAPERS: 8, // Max papers simultaneously evaluated in multi-paper synthesis
  MAX_AGENT_STEPS: 10, // Max reasoning cycles for research agent
  MAX_AGENT_CANDIDATE_IMPORTS: 5, // Max external papers imported per research run
  MAX_DISCOVERY_RESULTS_PER_PROVIDER: 10, // Max records fetched per scholarly provider

  // Rate windows
  RATE_LIMITS: {
    DISCOVERY_QUERIES_PER_MINUTE: 30,
    PAPER_QA_PER_MINUTE: 20,
    RESEARCH_SYNTHESIS_PER_HOUR: 15,
    RESEARCH_AGENT_RUNS_PER_HOUR: 10,
    PDF_UPLOADS_PER_HOUR: 10,
  },
};

/**
 * Returns a human-friendly error message when a beta limit is exceeded.
 */
export function getBetaLimitExceededMessage(limitType: keyof typeof BETA_LIMITS.RATE_LIMITS | string): string {
  switch (limitType) {
    case "DISCOVERY_QUERIES_PER_MINUTE":
      return "You have submitted multiple searches quickly. Please wait a few seconds before searching again.";
    case "PAPER_QA_PER_MINUTE":
      return "Please wait a moment before asking another question about this manuscript.";
    case "RESEARCH_SYNTHESIS_PER_HOUR":
      return "Private beta synthesis limit reached for this hour. Please review your active research threads.";
    case "RESEARCH_AGENT_RUNS_PER_HOUR":
      return "Private beta research run limit reached for this hour. Please allow ongoing runs to finish.";
    case "PDF_UPLOADS_PER_HOUR":
      return "Upload limit reached for this session. Please wait before uploading additional manuscripts.";
    case "FILE_SIZE":
      return `File exceeds the maximum private beta limit of ${BETA_LIMITS.MAX_PDF_UPLOAD_SIZE_MB} MB.`;
    case "QUESTION_LENGTH":
      return `Question exceeds maximum length of ${BETA_LIMITS.MAX_QUESTION_LENGTH} characters.`;
    default:
      return "A private beta usage limit has been reached. Please try again shortly.";
  }
}
