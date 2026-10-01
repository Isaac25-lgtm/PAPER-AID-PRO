export interface Author {
  id: string;
  name: string;
  institution?: string;
  bio?: string;
  paperCount?: number;
  citationCount?: number;
  hIndex?: number;
  orcid?: string;
  createdAt: string;
}
