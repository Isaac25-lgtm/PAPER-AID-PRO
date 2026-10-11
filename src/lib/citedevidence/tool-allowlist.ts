/**
 * CitedEvidence Research Tool Security Allowlist & Argument Validation Schemas
 *
 * Enforces strict boundary controls:
 * - Only approved, read-only discovery and validation tools can be executed.
 * - Destructive tools (delete_review, cache_manage, set_active_review) are strictly rejected with 403.
 * - Every payload is validated against a strict Zod schema with bounded string/array lengths.
 */

import { z } from "zod";

export const APPROVED_RESEARCH_TOOLS = [
  "validate_citations",
  "smart_search",
  "find_paper",
  "get_paper_network",
  "recommend_papers",
  "open_access",
  "search_authors",
  "get_author",
  "get_author_works",
] as const;

export type ApprovedResearchTool = (typeof APPROVED_RESEARCH_TOOLS)[number];

// 1. validate_citations
export const ValidateCitationsSchema = z.object({
  identifiers: z
    .array(z.string().min(1).max(256))
    .min(1, "At least one identifier is required.")
    .max(50, "Maximum 50 identifiers per request."),
});

// 2. smart_search
export const SmartSearchSchema = z.object({
  query: z.string().trim().min(1, "Query cannot be empty.").max(500, "Query exceeds 500 characters."),
  num_results: z.number().int().min(1).max(25).optional(),
  sources: z.array(z.string().trim().min(1).max(50)).max(6).optional(),
  brief: z.boolean().optional(),
});

// 3. find_paper
export const FindPaperSchema = z.object({
  identifier: z.string().trim().min(1, "Identifier cannot be empty.").max(256),
});

// 4. get_paper_network
export const GetPaperNetworkSchema = z.object({
  paper_id: z.string().trim().min(1, "Paper ID cannot be empty.").max(256),
});

// 5. recommend_papers
export const RecommendPapersSchema = z.object({
  paper_id: z.string().trim().min(1, "Paper ID cannot be empty.").max(256),
  num_results: z.number().int().min(1).max(25).optional(),
});

// 6. open_access
export const OpenAccessSchema = z.object({
  doi: z.string().trim().min(1, "DOI cannot be empty.").max(256),
});

// 7. search_authors
export const SearchAuthorsSchema = z.object({
  query: z.string().trim().min(1, "Query cannot be empty.").max(200),
  limit: z.number().int().min(1).max(25).optional(),
});

// 8. get_author
export const GetAuthorSchema = z.object({
  identifier: z.string().trim().min(1, "Author identifier cannot be empty.").max(256),
});

// 9. get_author_works
export const GetAuthorWorksSchema = z.object({
  identifier: z.string().trim().min(1, "Author identifier cannot be empty.").max(256),
  limit: z.number().int().min(1).max(50).optional(),
});

const TOOL_SCHEMA_MAP: Record<ApprovedResearchTool, z.ZodTypeAny> = {
  validate_citations: ValidateCitationsSchema,
  smart_search: SmartSearchSchema,
  find_paper: FindPaperSchema,
  get_paper_network: GetPaperNetworkSchema,
  recommend_papers: RecommendPapersSchema,
  open_access: OpenAccessSchema,
  search_authors: SearchAuthorsSchema,
  get_author: GetAuthorSchema,
  get_author_works: GetAuthorWorksSchema,
};

export interface ToolValidationResult {
  valid: boolean;
  status: 200 | 400 | 403;
  sanitizedArgs?: Record<string, unknown>;
  error?: string;
}

/**
 * Validates tool name against strict allowlist and verifies arguments schema.
 */
export function validateToolRequest(
  toolName: string,
  rawArgs: unknown
): ToolValidationResult {
  // 1. Tool allowlist check
  if (!APPROVED_RESEARCH_TOOLS.includes(toolName as ApprovedResearchTool)) {
    return {
      valid: false,
      status: 403,
      error: `Tool "${toolName}" is not permitted. Only approved read-only discovery tools may be executed.`,
    };
  }

  // 2. Schema check
  const schema = TOOL_SCHEMA_MAP[toolName as ApprovedResearchTool];
  const parseResult = schema.safeParse(rawArgs || {});

  if (!parseResult.success) {
    const errorDetails = (parseResult.error.issues || [])
      .map((e: any) => `${(e.path || []).join(".") || "payload"}: ${e.message}`)
      .join("; ");
    return {
      valid: false,
      status: 400,
      error: `Invalid tool arguments: ${errorDetails}`,
    };
  }

  return {
    valid: true,
    status: 200,
    sanitizedArgs: parseResult.data as Record<string, unknown>,
  };
}
