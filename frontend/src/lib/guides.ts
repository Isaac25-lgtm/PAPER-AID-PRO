/**
 * In-app guidance: what each section is for and how to use it. Shown as a "How to use this page" panel on each
 * section (expanded on a person's first visit), in the Help centre, and in the welcome tour.
 * Keep every statement true to what the product does today.
 */

export type SectionKey =
  | "dashboard"
  | "discover"
  | "catalog"
  | "paper"
  | "library"
  | "documents"
  | "editor"
  | "research"
  | "citations";

export interface SectionGuide {
  key: SectionKey;
  title: string;
  path: string;
  /** One sentence: what this section is for. */
  summary: string;
  /** Ordered how-to steps. */
  steps: string[];
  tips: string[];
}

export const GUIDES: Record<SectionKey, SectionGuide> = {
  dashboard: {
    key: "dashboard",
    title: "Home",
    path: "/dashboard",
    summary: "Your starting point: progress, recent documents and quick links to every part of PaperAid Pro.",
    steps: [
      "Follow the getting-started checklist; each item ticks itself off as you complete it.",
      "Jump back into a recent document, or start a new one.",
      "Open Help (the ? button at the top) at any time for guides to every section.",
    ],
    tips: ["You can hide the checklist once you are comfortable; it can be shown again from Help."],
  },
  discover: {
    key: "discover",
    title: "Discover",
    path: "/discover",
    summary: "Search major scholarly databases in every field at once (OpenAlex, Crossref, Semantic Scholar, DOAJ, plus PubMed and Europe PMC for health), with duplicates merged.",
    steps: [
      "Choose a subject (or All subjects), type a topic, title or question and press Search.",
      "Narrow results with a start year or “Open access only”.",
      "Read the abstract, then choose Save to library. Its details are fetched from the official registry and its page opens.",
      "Papers already in PaperAid show “Open in PaperAid”. From a paper's page you can cite it in any style.",
    ],
    tips: [
      "If one source is slow or unavailable, results from the others still appear.",
      "Generate overview writes a short summary of the top results from their abstracts, with each statement linked to its paper.",
      "Saved papers with an open-access PDF can have their full text retrieved from the paper page.",
    ],
  },
  catalog: {
    key: "catalog",
    title: "Catalog",
    path: "/papers",
    summary: "Every paper already imported into PaperAid Pro, plus your own private uploads.",
    steps: [
      "Search by words in the title, journal or abstract.",
      "Sort by relevance, newest, publication year or citation count.",
      "Open a paper to see its details, full-text status, citation and research tools.",
    ],
    tips: ["Your private uploads appear only to you; other people never see them."],
  },
  paper: {
    key: "paper",
    title: "Paper page",
    path: "/papers",
    summary: "Everything about one paper: details, citation, full text, passages and questions.",
    steps: [
      "Save the paper to your library, or copy its citation in any of the 18 styles.",
      "Choose Retrieve open-access PDF, or Upload your copy (private) if you have the PDF.",
      "Once the full text is ready, search inside it to find exact passages with page numbers.",
      "Ask a question about the paper; every statement in the answer links to the passage it came from.",
    ],
    tips: ["Scanned (image-only) PDFs cannot be read; upload a text-based PDF instead."],
  },
  library: {
    key: "library",
    title: "Library",
    path: "/library",
    summary: "Your personal research library: saved papers, uploads, collections, notes and exports.",
    steps: [
      "Add papers: Save to library from Discover; or choose Add paper to import by DOI / PubMed ID / arXiv ID, upload a PDF, or enter a book, chapter, report, court case or statute manually; or choose Import .bib/.ris to bring in a reference-manager export.",
      "Create collections (for a chapter, a review, a course) and add papers to them.",
      "Add tags and notes to remember why a paper matters.",
      "Export the whole library or a collection as BibTeX, RIS or CSL-JSON for other reference managers.",
    ],
    tips: [
      "Imported references with a DOI are checked against the registry; entries no registry knows stay private to you.",
      "Uploaded PDFs are private and processed automatically so you can search and cite their passages.",
    ],
  },
  documents: {
    key: "documents",
    title: "Documents",
    path: "/documents",
    summary: "Your manuscripts, proposals, literature reviews and thesis chapters.",
    steps: [
      "Choose New document, enter your topic, document type, study design and citation style.",
      "Review the suggested objectives and sections; edit any line before creating the document.",
      "Open a document to write. It saves automatically and keeps a version history.",
    ],
    tips: ["Each suggested section comes with short writing guidance you can replace with your own text."],
  },
  editor: {
    key: "editor",
    title: "Writing a document",
    path: "/documents",
    summary: "Write with correctly formatted in-text citations and an automatic reference list.",
    steps: [
      "Place the cursor where a citation belongs, open Sources, optionally type a page, and choose Cite at cursor.",
      "The reference list at the end updates itself and lists only works you actually cite.",
      "Change the citation style from the style menu; every citation and the reference list are reformatted.",
      "Use History to see earlier versions and restore one (your current text is kept in history).",
      "Export to Word (.docx) or PDF when you are ready.",
    ],
    tips: [
      "Changes save automatically. If the same document is edited in two tabs you are asked which version to keep.",
      "AI assist can rewrite a selected passage or suggest a next sentence; it is told not to add facts or citations.",
    ],
  },
  research: {
    key: "research",
    title: "Research assistant",
    path: "/research",
    summary: "Ask a question across papers you choose and get an answer in which every statement shows its source.",
    steps: [
      "Tick the papers to use in the list on the right (papers with full text give the most detailed answers).",
      "Type your question and choose Ask.",
      "Click a numbered marker in the answer to see the exact passage or abstract it came from.",
      "Ask follow-up questions in the same conversation; earlier conversations are kept in History.",
    ],
    tips: [
      "Statements that the sources do not support are removed, and the answer tells you when the evidence is insufficient.",
      "Always read the cited passages before relying on an answer in your own writing.",
    ],
  },
  citations: {
    key: "citations",
    title: "Citation tools",
    path: "/tools/citations",
    summary: "Format references from identifiers and check a reference list for errors, without signing in.",
    steps: [
      "Citation generator: paste DOIs, PubMed IDs or arXiv IDs (one per line), pick a style, choose Format, then Copy references.",
      "Reference checker: paste a reference list and choose Check references. Each entry is compared with Crossref by title, first author and year.",
      "Read each verdict: Verified, Likely match (something could not be checked), Mismatch or Not found.",
    ],
    tips: ["“Not found” does not always mean a reference is fake (books and reports are often missing from Crossref), so check those by hand."],
  },
};

export const SECTION_ORDER: SectionKey[] = ["discover", "library", "documents", "editor", "research", "citations", "catalog", "paper"];

export const EDITOR_SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "Ctrl/⌘ + B", action: "Bold" },
  { keys: "Ctrl/⌘ + I", action: "Italic" },
  { keys: "Ctrl/⌘ + U", action: "Underline" },
  { keys: "Ctrl/⌘ + Alt + 2 / 3", action: "Heading / subheading" },
  { keys: "Ctrl/⌘ + Shift + 8", action: "Bulleted list" },
  { keys: "Ctrl/⌘ + Shift + 7", action: "Numbered list" },
  { keys: "Ctrl/⌘ + Shift + B", action: "Quote" },
  { keys: "Ctrl/⌘ + Z  /  Ctrl/⌘ + Shift + Z", action: "Undo / redo" },
];

/** Per-person "seen" flags in this browser. Storage can be unavailable (private mode): fail open, quietly. */
export const guideStore = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(`paperaid.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(`paperaid.${key}`, value);
    } catch {
      /* ignore */
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(`paperaid.${key}`);
    } catch {
      /* ignore */
    }
  },
};
