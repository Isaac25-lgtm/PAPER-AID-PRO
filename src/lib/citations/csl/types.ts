/**
 * Citation Style Language (CSL) Type Definitions & CSL-JSON Schema
 * Based on official Citation Style Language specification:
 * https://citeproc-js.readthedocs.io/
 */

export type CslCitationFormat = "author-date" | "numeric" | "note" | "label";

export interface CslAuthorName {
  family?: string;
  given?: string;
  literal?: string;
  "dropping-particle"?: string;
  "non-dropping-particle"?: string;
  suffix?: string;
}

export interface CslDate {
  "date-parts"?: (number | string)[][];
  raw?: string;
  literal?: string;
  season?: string | number;
  circa?: boolean;
}

export type CslItemType =
  | "article"
  | "article-journal"
  | "article-magazine"
  | "article-newspaper"
  | "bill"
  | "book"
  | "broadcast"
  | "chapter"
  | "classic"
  | "collection"
  | "dataset"
  | "document"
  | "entry"
  | "entry-dictionary"
  | "entry-encyclopedia"
  | "event"
  | "figure"
  | "graphic"
  | "hearing"
  | "interview"
  | "legal_case"
  | "legislation"
  | "manuscript"
  | "map"
  | "motion_picture"
  | "musical_score"
  | "pamphlet"
  | "paper-conference"
  | "patent"
  | "performance"
  | "periodical"
  | "personal_communication"
  | "post"
  | "post-weblog"
  | "regulation"
  | "report"
  | "review"
  | "review-book"
  | "software"
  | "song"
  | "speech"
  | "standard"
  | "treaty"
  | "thesis"
  | "webpage";

export interface CslItem {
  id: string;
  type: CslItemType;
  title?: string;
  "title-short"?: string;
  author?: CslAuthorName[];
  editor?: CslAuthorName[];
  translator?: CslAuthorName[];
  issued?: CslDate;
  "container-title"?: string;
  "container-title-short"?: string;
  "collection-title"?: string;
  volume?: string | number;
  issue?: string | number;
  page?: string;
  "page-first"?: string;
  number?: string | number;
  publisher?: string;
  "publisher-place"?: string;
  DOI?: string;
  ISBN?: string;
  ISSN?: string;
  PMID?: string;
  PMCID?: string;
  URL?: string;
  abstract?: string;
  note?: string;
  genre?: string;
  status?: string;
  language?: string;
  license?: string;
}

export interface CslCitationItem {
  id: string;
  locator?: string;
  label?: string; // e.g. "page", "chapter", "section"
  prefix?: string;
  suffix?: string;
  "suppress-author"?: boolean;
  "author-only"?: boolean;
}

export interface CslCitationCluster {
  citationID?: string;
  citationItems: CslCitationItem[];
  properties?: {
    noteIndex?: number;
  };
}

export interface CslStyleMetadata {
  id: string;
  title: string;
  format: CslCitationFormat;
  dependent: boolean;
  parent?: string;
  prominent?: boolean;
  categories?: string[];
  fields?: string[];
  updated?: string;
  license?: string;
}

export interface FormattedBibliography {
  styleId: string;
  styleTitle: string;
  format: CslCitationFormat;
  entries: string[]; // HTML or clean text entries
  rawEntries: string[];
  bibStart?: string;
  bibEnd?: string;
  hangingIndent?: boolean;
}
