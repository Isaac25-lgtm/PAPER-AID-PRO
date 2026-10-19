import { CslItem, CslAuthorName } from "./types";

/**
 * Generates a clean, unique citation key for BibTeX (e.g. "vaswani2017attention").
 */
export function generateCiteKey(item: CslItem): string {
  let authorKey = "item";
  if (item.author && item.author.length > 0) {
    const first = item.author[0];
    const raw = first.family || first.literal || "item";
    authorKey = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  let yearKey = "nd";
  if (item.issued && item.issued["date-parts"] && item.issued["date-parts"][0]) {
    yearKey = String(item.issued["date-parts"][0][0]);
  }

  const titleKey = (item.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);

  return `${authorKey}${yearKey}${titleKey}`;
}

/**
 * Formats authors into standard BibTeX "Last, First and Last, First" format.
 */
function formatBibTeXAuthors(authors?: CslAuthorName[]): string {
  if (!authors || authors.length === 0) return "{Unknown Author}";
  return authors
    .map((a) => {
      if (a.literal) return `{${a.literal}}`;
      if (a.family && a.given) return `{${a.family}}, ${a.given}`;
      if (a.family) return `{${a.family}}`;
      return `{${a.given || "Unknown"}}`;
    })
    .join(" and ");
}

/**
 * Escapes special LaTeX characters in BibTeX text fields.
 */
export function escapeBibTeX(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_");
}

/**
 * Converts a single CslItem into a BibTeX entry.
 */
export function exportToBibTeX(item: CslItem): string {
  const key = generateCiteKey(item);
  const typeMap: Record<string, string> = {
    "article-journal": "article",
    article: "article",
    book: "book",
    chapter: "incollection",
    "paper-conference": "inproceedings",
    report: "techreport",
    thesis: "phdthesis",
    manuscript: "unpublished",
    webpage: "misc",
  };

  const entryType = typeMap[item.type] || "misc";
  const fields: string[] = [];

  // Title
  if (item.title) {
    fields.push(`  title     = {${escapeBibTeX(item.title)}}`);
  }

  // Author
  if (item.author && item.author.length > 0) {
    fields.push(`  author    = {${formatBibTeXAuthors(item.author)}}`);
  }

  // Journal / Container
  if (item["container-title"]) {
    const fieldName = entryType === "incollection" || entryType === "inproceedings" ? "booktitle" : "journal";
    fields.push(`  ${fieldName}   = {${escapeBibTeX(item["container-title"])}}`);
  }

  // Year
  if (item.issued && item.issued["date-parts"] && item.issued["date-parts"][0]) {
    const year = item.issued["date-parts"][0][0];
    fields.push(`  year      = {${year}}`);
  }

  // Volume
  if (item.volume) {
    fields.push(`  volume    = {${item.volume}}`);
  }

  // Number / Issue
  if (item.issue || item.number) {
    fields.push(`  number    = {${item.issue || item.number}}`);
  }

  // Pages
  if (item.page) {
    fields.push(`  pages     = {${item.page}}`);
  }

  // DOI
  if (item.DOI) {
    fields.push(`  doi       = {${item.DOI}}`);
  }

  // Publisher
  if (item.publisher) {
    fields.push(`  publisher = {${item.publisher}}`);
  }

  // URL
  if (item.URL) {
    fields.push(`  url       = {${item.URL}}`);
  }

  // Abstract
  if (item.abstract) {
    const sanitizedAbstract = item.abstract.replace(/[\r\n]+/g, " ").slice(0, 500);
    fields.push(`  abstract  = {${sanitizedAbstract}}`);
  }

  return `@${entryType}{${key},\n${fields.join(",\n")}\n}`;
}

/**
 * Converts multiple CSL items into a complete multi-entry BibTeX string.
 */
export function exportMultipleToBibTeX(items: CslItem[]): string {
  return items.map(exportToBibTeX).join("\n\n") + "\n";
}

/**
 * Converts a single CslItem into a standard RIS entry (Research Information Systems).
 */
export function exportToRIS(item: CslItem): string {
  const risTypeMap: Record<string, string> = {
    "article-journal": "JOUR",
    article: "JOUR",
    book: "BOOK",
    chapter: "CHAP",
    "paper-conference": "CONF",
    report: "RPRT",
    thesis: "THES",
    manuscript: "MANSCPT",
    webpage: "ELEC",
  };

  const lines: string[] = [];
  const type = risTypeMap[item.type] || "GEN";

  lines.push(`TY  - ${type}`);

  // Title
  if (item.title) {
    lines.push(`TI  - ${item.title}`);
  }

  // Authors (one AU per author)
  if (item.author) {
    for (const a of item.author) {
      if (a.literal) {
        lines.push(`AU  - ${a.literal}`);
      } else if (a.family && a.given) {
        lines.push(`AU  - ${a.family}, ${a.given}`);
      } else if (a.family) {
        lines.push(`AU  - ${a.family}`);
      }
    }
  }

  // Journal / Container Title
  if (item["container-title"]) {
    lines.push(`JO  - ${item["container-title"]}`);
    lines.push(`T2  - ${item["container-title"]}`);
  }

  // Publication Year & Date
  if (item.issued && item.issued["date-parts"] && item.issued["date-parts"][0]) {
    const dateParts = item.issued["date-parts"][0];
    const year = dateParts[0];
    const month = dateParts[1] ? String(dateParts[1]).padStart(2, "0") : "01";
    const day = dateParts[2] ? String(dateParts[2]).padStart(2, "0") : "01";
    lines.push(`PY  - ${year}/${month}/${day}/`);
    lines.push(`Y1  - ${year}///`);
  }

  // Volume
  if (item.volume) {
    lines.push(`VL  - ${item.volume}`);
  }

  // Issue
  if (item.issue) {
    lines.push(`IS  - ${item.issue}`);
  }

  // Pages
  if (item.page) {
    const parts = item.page.split(/[-–—]/);
    if (parts.length >= 2) {
      lines.push(`SP  - ${parts[0].trim()}`);
      lines.push(`EP  - ${parts[1].trim()}`);
    } else {
      lines.push(`SP  - ${item.page}`);
    }
  }

  // DOI
  if (item.DOI) {
    lines.push(`DO  - ${item.DOI}`);
  }

  // Publisher
  if (item.publisher) {
    lines.push(`PB  - ${item.publisher}`);
  }

  // URL
  if (item.URL) {
    lines.push(`UR  - ${item.URL}`);
  }

  // Abstract
  if (item.abstract) {
    lines.push(`AB  - ${item.abstract.replace(/[\r\n]+/g, " ")}`);
  }

  // ISSN / ISBN
  if (item.ISSN) {
    lines.push(`SN  - ${item.ISSN}`);
  } else if (item.ISBN) {
    lines.push(`SN  - ${item.ISBN}`);
  }

  lines.push("ER  - ");
  return lines.join("\n");
}

/**
 * Converts multiple CSL items into a complete multi-entry RIS string.
 */
export function exportMultipleToRIS(items: CslItem[]): string {
  return items.map(exportToRIS).join("\n\n") + "\n";
}
