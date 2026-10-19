import { CslItem, CslAuthorName, CslItemType } from "./types";
import { normalizeDoi } from "@/lib/identifiers";

const SURNAME_PARTICLES = new Set([
  "van",
  "von",
  "de",
  "der",
  "den",
  "del",
  "della",
  "delle",
  "da",
  "di",
  "du",
  "la",
  "le",
  "al",
  "el",
  "ben",
  "ibn",
  "ter",
  "ten",
]);

const INSTITUTIONAL_KEYWORDS = [
  "team",
  "consortium",
  "group",
  "collaboration",
  "collaborative",
  "organization",
  "organisation",
  "institute",
  "institution",
  "agency",
  "committee",
  "commission",
  "department",
  "ministry",
  "society",
  "association",
  "corporation",
  "laboratory",
  "laboratories",
  "labs",
  "foundation",
  "foundations",
  "center",
  "centre",
  "council",
  "task force",
  "study group",
  "initiative",
  "network",
  "hospital",
  "clinic",
  "university",
  "college",
];

const KNOWN_INSTITUTION_ACRONYMS = new Set([
  "WHO",
  "CDC",
  "NIH",
  "CERN",
  "NASA",
  "FDA",
  "IEEE",
  "ACM",
  "UNESCO",
  "ICMJE",
  "ISO",
  "W3C",
]);

/**
 * Checks if a token matches the signature of academic name initials (e.g., "B", "M", "JA", "B.", "B.C.", "J-P").
 * Must NOT contain lowercase letters and must have 1-4 uppercase characters.
 */
export function isInitialsToken(str: string): boolean {
  if (!str) return false;
  // If string contains any lowercase letters, it cannot be initials
  if (/[a-z\u00E0-\u00FF]/.test(str)) return false;
  const clean = str.replace(/[.\-]/g, "");
  // 1 to 4 uppercase letters
  return /^[A-Z]{1,4}$/.test(clean);
}

/**
 * Splits a potentially combined author string (e.g. separated by semicolons, 'and', or multiple NLM authors).
 */
export function splitAuthorList(raw: string): string[] {
  const trimmed = (raw || "").trim();
  if (!trimmed) return [];

  // If separated by semicolons (standard multi-author delimiter)
  if (trimmed.includes(";")) {
    return trimmed.split(";").map((s) => s.trim()).filter(Boolean);
  }

  // If separated by " and " or " & "
  if (/\s+(?:and|&)\s+/i.test(trimmed)) {
    return trimmed.split(/\s+(?:and|&)\s+/i).map((s) => s.trim()).filter(Boolean);
  }

  // Check if comma-separated list of multiple NLM-style authors: e.g. "Fink B, Hoyka M"
  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    const allLookLikeNlm =
      parts.length > 1 &&
      parts.every((p) => {
        const tokens = p.split(/\s+/).filter(Boolean);
        return tokens.length >= 2 && isInitialsToken(tokens[tokens.length - 1]);
      });
    if (allLookLikeNlm) {
      return parts;
    }
  }

  return [trimmed];
}

/**
 * Splits an author name string or structured author object into family and given components, or literal name.
 * Correctly distinguishes NLM / PubMed name order ("Fink B" -> family: "Fink", given: "B")
 * from Western name order ("Benjamin Fink" -> family: "Fink", given: "Benjamin"),
 * multi-part surnames, suffixes, and institutional authors.
 */
export function parseAuthorName(rawInput: any): CslAuthorName {
  if (!rawInput) {
    return { literal: "Unknown Author" };
  }

  // 1. Structured objects: preserve authoritative structured author fields without destructive reparsing
  if (typeof rawInput === "object") {
    if ("literal" in rawInput && rawInput.literal) {
      return { literal: String(rawInput.literal).trim() };
    }
    if ("family" in rawInput || "given" in rawInput) {
      return {
        family: rawInput.family ? String(rawInput.family).trim() : undefined,
        given: rawInput.given ? String(rawInput.given).trim() : undefined,
        suffix: rawInput.suffix ? String(rawInput.suffix).trim() : undefined,
        "dropping-particle": rawInput["dropping-particle"],
        "non-dropping-particle": rawInput["non-dropping-particle"],
      };
    }
    if ("familyName" in rawInput || "givenName" in rawInput) {
      return {
        family: rawInput.familyName ? String(rawInput.familyName).trim() : undefined,
        given: rawInput.givenName ? String(rawInput.givenName).trim() : undefined,
      };
    }
    if ("lastName" in rawInput || "firstName" in rawInput) {
      return {
        family: rawInput.lastName ? String(rawInput.lastName).trim() : undefined,
        given: rawInput.firstName ? String(rawInput.firstName).trim() : undefined,
      };
    }
    if ("surname" in rawInput || "forename" in rawInput) {
      return {
        family: rawInput.surname ? String(rawInput.surname).trim() : undefined,
        given: rawInput.forename ? String(rawInput.forename).trim() : undefined,
      };
    }
    if ("name" in rawInput && typeof rawInput.name === "string") {
      return parseAuthorName(rawInput.name);
    }
    if ("author" in rawInput && rawInput.author && typeof rawInput.author.name === "string") {
      return parseAuthorName(rawInput.author.name);
    }
  }

  const trimmed = String(rawInput).trim();
  if (!trimmed) {
    return { literal: "Unknown Author" };
  }

  // 2. Check for institutional / consortium names (e.g., "The AlphaFold Team", "WHO", "CERN Collaboration")
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("the ") ||
    INSTITUTIONAL_KEYWORDS.some((kw) => lower.includes(kw)) ||
    KNOWN_INSTITUTION_ACRONYMS.has(trimmed.toUpperCase())
  ) {
    return { literal: trimmed };
  }

  // 3. Comma-separated format: "Family, Given" or "Family, Suffix, Given"
  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      let family = parts[0];
      let suffix: string | undefined = undefined;
      const suffixMatch = family.match(/\s+(Jr\.?|Sr\.?|III|IV|II)$/i);
      if (suffixMatch) {
        suffix = suffixMatch[1];
        family = family.replace(/\s+(Jr\.?|Sr\.?|III|IV|II)$/i, "").trim();
      }
      return {
        family: family || undefined,
        given: parts[1] || undefined,
        suffix,
      };
    } else if (parts.length >= 3) {
      const family = parts[0];
      const suffix = parts[1];
      const given = parts.slice(2).join(" ");
      return {
        family: family || undefined,
        given: given || undefined,
        suffix: suffix || undefined,
      };
    }
  }

  // 4. Space-separated tokens
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    return { family: tokens[0] };
  }

  // Extract trailing suffix if present (e.g., "John Smith Jr.")
  const SUFFIX_REGEX = /^(Jr\.?|Sr\.?|II|III|IV|V)$/i;
  let suffix: string | undefined = undefined;
  if (tokens.length > 2 && SUFFIX_REGEX.test(tokens[tokens.length - 1])) {
    suffix = tokens.pop()!;
  }

  // 5. NLM / PubMed format check: trailing token(s) are initials ("Fink B", "Hoyka M", "Smith JA", "van der Waals JD")
  if (isInitialsToken(tokens[tokens.length - 1])) {
    const initialsTokens: string[] = [];
    while (tokens.length > 1 && isInitialsToken(tokens[tokens.length - 1])) {
      initialsTokens.unshift(tokens.pop()!);
    }
    const family = tokens.join(" ");
    const given = initialsTokens.join(" ");
    return {
      family: family || undefined,
      given: given || undefined,
      suffix,
    };
  }

  // 6. Western format with initial at start ("B. Fink", "B Fink")
  if (isInitialsToken(tokens[0]) && tokens.length === 2) {
    return {
      family: tokens[1],
      given: tokens[0],
      suffix,
    };
  }

  // 7. Multi-part surnames with particles (e.g. "Ludwig van Beethoven", "Johannes Diderik van der Waals")
  if (tokens.length > 2) {
    let particleIdx = -1;
    for (let i = 1; i < tokens.length - 1; i++) {
      if (SURNAME_PARTICLES.has(tokens[i].toLowerCase())) {
        particleIdx = i;
        break;
      }
    }
    if (particleIdx > 0) {
      const given = tokens.slice(0, particleIdx).join(" ");
      const family = tokens.slice(particleIdx).join(" ");
      return {
        family,
        given,
        suffix,
      };
    }
  }

  // 8. Standard Western format ("Given Middle Family"): last token is family name
  const family = tokens.pop()!;
  const given = tokens.join(" ");

  return {
    family,
    given: given || undefined,
    suffix,
  };
}

/**
 * Maps document type strings to standard CSL item types.
 */
export function mapDocumentTypeToCsl(docType?: string | null, hasJournal?: boolean): CslItemType {
  const norm = (docType || "").toUpperCase().trim();

  switch (norm) {
    case "JOURNAL_ARTICLE":
    case "RESEARCH_ARTICLE":
    case "ARTICLE":
      return "article-journal";

    case "THESIS":
    case "MASTERS_THESIS":
    case "MASTER_THESIS":
    case "DISSERTATION":
    case "PHD_DISSERTATION":
    case "DOCTORAL_DISSERTATION":
      return "thesis";

    case "TECHNICAL_REPORT":
    case "BUSINESS_REPORT":
    case "INSTITUTIONAL_REPORT":
    case "REPORT":
      return "report";

    case "CONFERENCE_PAPER":
    case "PROCEEDINGS":
    case "INPROCEEDINGS":
      return "paper-conference";

    case "BOOK":
      return "book";

    case "CHAPTER":
    case "BOOK_CHAPTER":
      return "chapter";

    case "PROPOSAL":
    case "RESEARCH_PROPOSAL":
    case "DRAFT":
    case "MANUSCRIPT":
    case "UNPUBLISHED_MANUSCRIPT":
    case "STUDENT_PAPER":
    case "ESSAY_ASSIGNMENT":
      return "manuscript";

    case "WEBPAGE":
    case "WEB":
      return "webpage";

    default:
      return hasJournal ? "article-journal" : "manuscript";
  }
}

/**
 * Universal input interface for converting any bibliographic record to CSL-JSON.
 */
export interface GenericReferenceInput {
  id: string;
  title?: string | null;
  authors?: (string | { name?: string; author?: { name: string } } | CslAuthorName)[] | null;
  publicationDate?: Date | string | null;
  year?: number | string | null;
  journal?: string | null;
  doi?: string | null;
  arxivId?: string | null;
  pmid?: string | null;
  pmcid?: string | null;
  volume?: string | number | null;
  issue?: string | number | null;
  pages?: string | null;
  articleNumber?: string | number | null;
  publisher?: string | null;
  institution?: string | null;
  documentType?: string | null;
  pdfUrl?: string | null;
  url?: string | null;
  abstract?: string | null;
  issn?: string | null;
  isbn?: string | null;
  rawMetadata?: any;
}

/**
 * Reusable mapper converting existing paper, library item, or citation input into CSL-JSON.
 * Guarantee: Zero metadata fabrication. Missing fields are handled gracefully.
 */
export function mapReferenceToCslJson(input: GenericReferenceInput): CslItem {
  const id = String(input.id || "cite-" + Math.random().toString(36).substring(2, 9));
  const rawMeta = input.rawMetadata || {};

  // 1. Authors
  const authors: CslAuthorName[] = [];
  if (Array.isArray(input.authors)) {
    for (const a of input.authors) {
      if (!a) continue;
      if (typeof a === "string") {
        const list = splitAuthorList(a);
        for (const singleName of list) {
          authors.push(parseAuthorName(singleName));
        }
      } else {
        authors.push(parseAuthorName(a));
      }
    }
  }

  // 2. Publication Date & Year
  let issued: { "date-parts": (number | string)[][] } | undefined = undefined;
  if (input.publicationDate) {
    const d = new Date(input.publicationDate);
    if (!isNaN(d.getTime())) {
      const year = d.getUTCFullYear();
      const month = d.getUTCMonth() + 1;
      const day = d.getUTCDate();
      issued = { "date-parts": [[year, month, day]] };
    }
  } else if (input.year) {
    const parsedYear = parseInt(String(input.year), 10);
    if (!isNaN(parsedYear) && parsedYear > 1000 && parsedYear < 3000) {
      issued = { "date-parts": [[parsedYear]] };
    }
  } else if (rawMeta.year || rawMeta.publicationYear) {
    const parsedYear = parseInt(String(rawMeta.year || rawMeta.publicationYear), 10);
    if (!isNaN(parsedYear)) {
      issued = { "date-parts": [[parsedYear]] };
    }
  }

  // 3. DOI & URLs
  const cleanDoi = normalizeDoi(input.doi || rawMeta.doi || undefined);
  const url = input.url || input.pdfUrl || rawMeta.url || (cleanDoi ? `https://doi.org/${cleanDoi}` : undefined);

  // 4. Container & Journal
  const containerTitle = (input.journal || rawMeta.journal || rawMeta.containerTitle || rawMeta.booktitle || "").trim();

  // 5. Volume, Issue, Page
  const volume = input.volume || rawMeta.volume || undefined;
  const issue = input.issue || rawMeta.issue || undefined;
  const page = (input.pages || rawMeta.pages || rawMeta.page || "").trim() || undefined;
  const articleNumber = input.articleNumber || rawMeta.articleNumber || undefined;

  // 6. Publisher & Institution
  const publisher = (input.publisher || rawMeta.publisher || input.institution || "").trim() || undefined;

  // 7. Type
  const cslType = mapDocumentTypeToCsl(input.documentType || rawMeta.documentType, Boolean(containerTitle));

  const cslItem: CslItem = {
    id,
    type: cslType,
    title: (input.title || rawMeta.title || "Untitled Document").trim(),
    author: authors.length > 0 ? authors : undefined,
    issued,
    "container-title": containerTitle || undefined,
    volume,
    issue,
    page,
    number: articleNumber,
    publisher,
    DOI: cleanDoi || undefined,
    PMID: input.pmid || rawMeta.pmid || undefined,
    PMCID: input.pmcid || rawMeta.pmcid || undefined,
    URL: url || undefined,
    abstract: (input.abstract || rawMeta.abstract || "").trim() || undefined,
    ISSN: input.issn || rawMeta.issn || undefined,
    ISBN: input.isbn || rawMeta.isbn || undefined,
  };

  return cslItem;
}
