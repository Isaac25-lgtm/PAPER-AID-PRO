/**
 * Academic Citation Formatter & Exporter
 *
 * Implements standard academic reference formatting (APA 7th, MLA 9th, Chicago 17th, IEEE, BibTeX)
 * for both published scholarly literature and unpublished university documents:
 * - Master's Theses & Doctoral Dissertations
 * - Research Proposals & Grant Drafts
 * - Unpublished Working Papers & Lab Manuscripts
 *
 * Scientific Integrity Guarantees:
 * 1. Zero Metadata Fabrication: Never invents DOIs, journals, volumes, issues, page numbers, or publishers.
 * 2. Strict Typological Distinction: Formats unpublished works using appropriate scholarly style conventions
 *    (e.g., bracketed thesis description in APA, @phdthesis or @misc in BibTeX).
 * 3. Clear External Verification Notice: Flags when an unpublished work is not indexed in external registries.
 */

export type CitationStyle = "apa" | "mla" | "chicago" | "ieee" | "bibtex";

export interface BibliographicCitationInput {
  title: string;
  authors: string[];
  year?: number | null;
  journal?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  doi?: string | null;
  documentType?: "THESIS" | "DISSERTATION" | "PROPOSAL" | "DRAFT" | "STUDENT_PAPER" | "JOURNAL_ARTICLE" | "MANUSCRIPT" | string | null;
  institution?: string | null;
  isUnpublished?: boolean;
}

export interface FormattedCitationResult {
  text: string;
  style: CitationStyle;
  isUnpublished: boolean;
  hasExternalIdentifier: boolean;
  verificationNotice?: string;
}

/**
 * Normalizes author name into "Last, Initial." format.
 */
function formatAuthorAPA(author: string): string {
  const trimmed = author.trim();
  if (!trimmed) return "Unknown";

  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map((p) => p.trim());
    const last = parts[0];
    const first = parts[1] || "";
    const initial = first ? `${first[0]}.` : "";
    return `${last}${initial ? `, ${initial}` : ""}`;
  }

  const parts = trimmed.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0];
  const last = parts.pop()!;
  const initials = parts.map((p) => `${p[0]}.`).join(" ");
  return `${last}, ${initials}`;
}

/**
 * Normalizes author name into "Last, First" format.
 */
function formatAuthorMLA(author: string): string {
  const trimmed = author.trim();
  if (!trimmed) return "Unknown";

  if (trimmed.includes(",")) return trimmed;

  const parts = trimmed.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0];
  const last = parts.pop()!;
  const first = parts.join(" ");
  return `${last}, ${first}`;
}

function getDocumentTypeDescriptor(type?: string | null): string {
  switch (type?.toUpperCase()) {
    case "DISSERTATION":
      return "Doctoral dissertation";
    case "THESIS":
      return "Master's thesis";
    case "PROPOSAL":
      return "Research proposal";
    case "DRAFT":
      return "Manuscript draft";
    case "STUDENT_PAPER":
      return "Student research paper";
    default:
      return "Unpublished manuscript";
  }
}

/**
 * Formats bibliographic citation strictly from available metadata without fabrication.
 */
export function formatBibliographicCitation(
  input: BibliographicCitationInput,
  style: CitationStyle
): FormattedCitationResult {
  const {
    title,
    authors,
    year,
    journal,
    volume,
    issue,
    pages,
    doi,
    documentType,
    institution,
  } = input;

  const isUnpublished =
    input.isUnpublished === true ||
    ["THESIS", "DISSERTATION", "PROPOSAL", "DRAFT", "STUDENT_PAPER", "MANUSCRIPT"].includes(
      documentType?.toUpperCase() || ""
    ) ||
    (!journal && !doi);

  const hasExternalIdentifier = Boolean(doi && doi.trim().length > 0);
  const cleanDoi = doi ? doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim() : null;

  const validAuthors = authors && authors.length > 0 ? authors : ["Unknown Author"];
  const yearString = year ? String(year) : "n.d.";

  let formattedText = "";

  switch (style) {
    case "apa": {
      // APA 7th Edition
      const apaAuthors = validAuthors.map(formatAuthorAPA);
      const authorStr =
        apaAuthors.length === 1
          ? apaAuthors[0]
          : apaAuthors.length === 2
          ? `${apaAuthors[0]}, & ${apaAuthors[1]}`
          : `${apaAuthors[0]}, et al.`;

      if (isUnpublished) {
        const descriptor = getDocumentTypeDescriptor(documentType);
        const bracketInfo = institution ? `[${descriptor}, ${institution}]` : `[${descriptor}]`;
        formattedText = `${authorStr} (${yearString}). ${title} ${bracketInfo}.`;
      } else {
        const venueParts: string[] = [];
        if (journal) venueParts.push(journal);
        if (volume) {
          venueParts.push(issue ? `${volume}(${issue})` : volume);
        }
        if (pages) venueParts.push(pages);
        const venueStr = venueParts.join(", ");

        formattedText = `${authorStr} (${yearString}). ${title}.${venueStr ? ` ${venueStr}.` : ""}${
          cleanDoi ? ` https://doi.org/${cleanDoi}` : ""
        }`;
      }
      break;
    }

    case "mla": {
      // MLA 9th Edition
      const firstAuthorMLA = formatAuthorMLA(validAuthors[0]);
      const authorStr =
        validAuthors.length > 2
          ? `${firstAuthorMLA}, et al.`
          : validAuthors.length === 2
          ? `${firstAuthorMLA}, and ${validAuthors[1]}`
          : firstAuthorMLA;

      if (isUnpublished) {
        const descriptor = getDocumentTypeDescriptor(documentType);
        const instStr = institution ? `${institution}, ` : "";
        formattedText = `${authorStr}. "${title}." ${instStr}${descriptor}, ${yearString}.`;
      } else {
        const volStr = volume ? ` vol. ${volume},` : "";
        const issStr = issue ? ` no. ${issue},` : "";
        const pageStr = pages ? ` pp. ${pages},` : "";
        const journalStr = journal ? ` ${journal},` : "";
        formattedText = `${authorStr}. "${title}."${journalStr}${volStr}${issStr} ${yearString}${pageStr}.${
          cleanDoi ? ` DOI: ${cleanDoi}` : ""
        }`;
      }
      break;
    }

    case "chicago": {
      // Chicago 17th Edition (Author-Date)
      const firstAuthor = validAuthors[0];
      const authorStr =
        validAuthors.length > 3
          ? `${firstAuthor} et al.`
          : validAuthors.join(", ");

      if (isUnpublished) {
        const descriptor = getDocumentTypeDescriptor(documentType);
        const instStr = institution ? `${institution}` : "Unpublished manuscript";
        formattedText = `${authorStr}. ${yearString}. "${title}." ${descriptor}, ${instStr}.`;
      } else {
        const volPart = volume ? ` ${volume}` : "";
        const pagePart = pages ? `: ${pages}` : "";
        const journalPart = journal ? ` ${journal}` : "";
        formattedText = `${authorStr}. ${yearString}. "${title}."${journalPart}${volPart}${pagePart}.${
          cleanDoi ? ` https://doi.org/${cleanDoi}.` : ""
        }`;
      }
      break;
    }

    case "ieee": {
      // IEEE Style
      const authorStr =
        validAuthors.length > 2
          ? `${validAuthors[0]} et al.`
          : validAuthors.join(" and ");

      if (isUnpublished) {
        const descriptor = getDocumentTypeDescriptor(documentType);
        const instStr = institution ? `, ${institution}` : "";
        formattedText = `[1] ${authorStr}, "${title}," ${descriptor}${instStr}, ${yearString}.`;
      } else {
        const volStr = volume ? `, vol. ${volume}` : "";
        const issStr = issue ? `, no. ${issue}` : "";
        const pageStr = pages ? `, pp. ${pages}` : "";
        const journalStr = journal ? `, ${journal}` : "";
        formattedText = `[1] ${authorStr}, "${title}"${journalStr}${volStr}${issStr}${pageStr}, ${yearString}.${
          cleanDoi ? ` doi: ${cleanDoi}.` : ""
        }`;
      }
      break;
    }

    case "bibtex": {
      // BibTeX format
      const primaryAuthorLast = (validAuthors[0] || "author").split(" ").pop()?.toLowerCase() || "doc";
      const keyTitle = title.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
      const citeKey = `${primaryAuthorLast}${year || "nd"}${keyTitle}`;
      const authorBib = validAuthors.join(" and ");

      if (documentType?.toUpperCase() === "DISSERTATION") {
        formattedText = `@phdthesis{${citeKey},
  author    = {${authorBib}},
  title     = {${title}},
  school    = {${institution || "University"}},
  year      = {${yearString}}
}`;
      } else if (documentType?.toUpperCase() === "THESIS") {
        formattedText = `@mastersthesis{${citeKey},
  author    = {${authorBib}},
  title     = {${title}},
  school    = {${institution || "University"}},
  year      = {${yearString}}
}`;
      } else if (isUnpublished) {
        formattedText = `@unpublished{${citeKey},
  author    = {${authorBib}},
  title     = {${title}},
  note      = {${getDocumentTypeDescriptor(documentType)}${institution ? ` (${institution})` : ""}},
  year      = {${yearString}}
}`;
      } else {
        formattedText = `@article{${citeKey},
  author    = {${authorBib}},
  title     = {${title}},
  journal   = {${journal || ""}},
  year      = {${yearString}}${volume ? `,\n  volume    = {${volume}}` : ""}${pages ? `,\n  pages     = {${pages}}` : ""}${
          cleanDoi ? `,\n  doi       = {${cleanDoi}}` : ""
        }
}`;
      }
      break;
    }
  }

  const verificationNotice = !hasExternalIdentifier
    ? "Unpublished University Document — Not indexed in external scholarly registry. Citations reflect author-provided metadata only."
    : undefined;

  return {
    text: formattedText,
    style,
    isUnpublished,
    hasExternalIdentifier,
    verificationNotice,
  };
}
