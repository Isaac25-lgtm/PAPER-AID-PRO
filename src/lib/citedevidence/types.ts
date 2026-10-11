/**
 * CitedEvidence Scholar & CEDOA API Types
 *
 * Covers:
 * - OpenAlex-compatible Scholar Metadata API (/v1/oa/works)
 * - CEDOA Files API (/v1/research-corpus/list)
 * - Research MCP & Tools API (/api/v1/research/tools)
 */

export interface OpenAlexAuthor {
  id?: string;
  display_name: string;
  orcid?: string | null;
}

export interface OpenAlexInstitution {
  id?: string;
  display_name: string;
  country_code?: string | null;
  type?: string | null;
}

export interface OpenAlexAuthorship {
  author_position?: "first" | "middle" | "last";
  author: OpenAlexAuthor;
  institutions?: OpenAlexInstitution[];
  raw_affiliation_strings?: string[];
}

export interface OpenAlexLocation {
  is_oa?: boolean;
  landing_page_url?: string | null;
  pdf_url?: string | null;
  source?: {
    id?: string;
    display_name?: string;
    issn_l?: string | null;
    type?: string | null;
  } | null;
  license?: string | null;
}

export interface OpenAlexWork {
  id: string; // e.g. "https://openalex.org/W3199258042"
  doi?: string | null;
  title: string;
  display_name?: string;
  publication_year?: number | null;
  publication_date?: string | null;
  language?: string | null;
  type?: string | null;
  cited_by_count?: number | null;
  is_retracted?: boolean;
  is_paratext?: boolean;
  primary_location?: OpenAlexLocation | null;
  best_oa_location?: OpenAlexLocation | null;
  open_access?: {
    is_oa: boolean;
    oa_status?: string;
    oa_url?: string | null;
    any_repository_has_fulltext?: boolean;
  };
  authorships?: OpenAlexAuthorship[];
  abstract_inverted_index?: Record<string, number[]> | null;
  concepts?: Array<{ id: string; display_name: string; score: number }>;
  keywords?: Array<{ keyword: string; score: number }>;
  referenced_works?: string[];
  referenced_works_count?: number;
  has_fulltext?: boolean;
  has_content?: boolean;
}

export interface OpenAlexListResponse<T> {
  meta: {
    count: number;
    db_response_time_ms?: number;
    page: number;
    per_page: number;
  };
  results: T[];
}

export interface ResearchToolInfo {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface ResearchToolCallResponse<T = any> {
  isError: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent?: {
    result?: T;
    [key: string]: unknown;
  };
}

export interface SmartSearchResultItem {
  title: string;
  authors: string[];
  year?: number;
  cited_by?: number;
  doi?: string | null;
  abstract_snippet?: string;
  pdf_url?: string | null;
  openalex_id?: string;
  source?: string;
  source_name?: string;
  sources?: string[];
  content?: {
    source?: string;
    formats?: string[];
    links?: {
      fulltext?: string;
      xml?: string;
      pdf?: string;
      pdf_url?: string;
    };
    manifest?: string;
    authentication?: string;
  };
}

export interface SmartSearchResponse {
  results: SmartSearchResultItem[];
  total?: number;
  query?: string;
}
