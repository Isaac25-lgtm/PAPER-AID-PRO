/**
 * In-app guidance: what each section is for and how to use it. Shown as a guide panel on each section (open until
 * the person hides it), in the Help centre, and in the welcome tour.
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

export interface GuideStep {
  /** A few words: what to do. */
  title: string;
  /** One or two sentences: how. */
  detail: string;
  /** Optional link that takes the person straight to doing it. */
  action?: { label: string; to: string };
}

export interface SectionGuide {
  key: SectionKey;
  title: string;
  path: string;
  /** One sentence: what this section is for. */
  summary: string;
  /** Ordered how-to steps (shown as numbered cards). */
  steps: GuideStep[];
  tips: string[];
}

export const GUIDES: Record<SectionKey, SectionGuide> = {
  dashboard: {
    key: "dashboard",
    title: "Home",
    path: "/dashboard",
    summary: "Your starting point: progress, recent documents and quick links to every part of PaperAid Pro.",
    steps: [
      { title: "Find your first papers", detail: "Search every scholarly index at once and save what you need to your library.", action: { label: "Open Discover", to: "/discover" } },
      { title: "Start a document", detail: "Pick a document type and study design; you get an outline you can edit.", action: { label: "New document", to: "/documents" } },
      { title: "Cite while you write", detail: "In a document, type /cite where a citation belongs and pick the source." },
      { title: "Follow the checklist", detail: "The getting-started checklist below ticks itself off as you go. Help (?) is always at the top." },
    ],
    tips: ["You can hide the checklist once you are comfortable; it can be shown again from Help."],
  },
  discover: {
    key: "discover",
    title: "Discover",
    path: "/discover",
    summary: "Search major scholarly databases in every field at once, with duplicates merged.",
    steps: [
      { title: "Choose a subject", detail: "Pick your field (or All subjects) so the right indexes are searched: OpenAlex, Crossref, Semantic Scholar, DOAJ, and PubMed and Europe PMC for health." },
      { title: "Search", detail: "Type a topic, a title or a question. Narrow with a start year or “Open access only”." },
      { title: "Save to your library", detail: "Read the abstract, then choose Save to library. Its details come from the official registry record." },
      { title: "Cite or read it", detail: "Open the paper to copy its citation in any style or retrieve its open-access PDF." },
    ],
    tips: [
      "If one source is slow or unavailable, results from the others still appear.",
      "Generate overview writes a short summary of the top results from their abstracts, with each statement linked to its paper.",
    ],
  },
  catalog: {
    key: "catalog",
    title: "Catalog",
    path: "/papers",
    summary: "Every paper already imported into PaperAid Pro, plus your own private uploads.",
    steps: [
      { title: "Search the catalog", detail: "Find papers by words in the title, journal or abstract." },
      { title: "Sort", detail: "By relevance, newest, publication year or citation count." },
      { title: "Open a paper", detail: "See its details, full-text status, citation and research tools." },
    ],
    tips: ["Your private uploads appear only to you; other people never see them."],
  },
  paper: {
    key: "paper",
    title: "Paper page",
    path: "/papers",
    summary: "Everything about one paper: details, citation, full text, passages and questions.",
    steps: [
      { title: "Save or cite it", detail: "Add the paper to your library, or copy its citation in any of the 18 styles." },
      { title: "Get the full text", detail: "Choose Retrieve open-access PDF, or Upload your copy (private) if you have the PDF." },
      { title: "Search inside it", detail: "Once the text is ready, find exact passages with their page numbers." },
      { title: "Ask about it", detail: "Every statement in the answer links to the passage it came from (when AI is on)." },
    ],
    tips: ["Scanned (image-only) PDFs cannot be read; upload a text-based PDF instead."],
  },
  library: {
    key: "library",
    title: "Library",
    path: "/library",
    summary: "Your personal research library: saved papers, uploads, collections, notes and exports.",
    steps: [
      { title: "Add papers", detail: "Save them from Discover, add one by DOI, PubMed ID or arXiv ID, upload a PDF, or enter a book, report or case by hand.", action: { label: "Search for papers", to: "/discover" } },
      { title: "Bring your old library", detail: "Import a BibTeX or RIS export from Zotero, Mendeley or EndNote; identifiers are checked against the registries." },
      { title: "Organise", detail: "Group papers into collections (a chapter, a review, a course) and add tags and notes." },
      { title: "Use them", detail: "Cite them in your documents with /cite, ask questions in Research, or export as BibTeX, RIS or CSL-JSON." },
    ],
    tips: [
      "Uploaded PDFs are private and processed automatically so you can search and cite their passages.",
      "Entries no registry knows stay private to you and are marked “User-supplied details”.",
    ],
  },
  documents: {
    key: "documents",
    title: "Documents",
    path: "/documents",
    summary: "Your manuscripts, proposals, literature reviews and thesis chapters.",
    steps: [
      { title: "Choose New document", detail: "Enter your topic, the document type, your research approach and a citation style." },
      { title: "Review the outline", detail: "Edit the suggested objectives and sections before creating the document." },
      { title: "Write and cite", detail: "Open the document to write; type /cite to add citations. It saves automatically with version history." },
    ],
    tips: ["Each suggested section comes with short writing guidance you can replace with your own text."],
  },
  editor: {
    key: "editor",
    title: "Writing a document",
    path: "/documents",
    summary: "Write with correctly formatted in-text citations and an automatic reference list.",
    steps: [
      { title: "Type /cite", detail: "Where a citation belongs, type /cite (or press Cite). Search your library and every index, add a page if you like, press Enter." },
      { title: "Select text for actions", detail: "Select words to find a source for them; with AI on you can also rewrite, shorten or check them against your sources." },
      { title: "Read the PDF beside it", detail: "Open PDF, select words on a page, then cite that page or quote the words." },
      { title: "Export", detail: "The reference list builds itself in your chosen style. Export to Word or PDF when ready." },
    ],
    tips: [
      "Changes save automatically; History lets you restore an earlier version (your current text is kept).",
      "With AI on, grey suggestions appear when you pause at the end of a paragraph. Tab accepts, Esc dismisses; turn them off with Suggestions in the toolbar.",
      "AI rewrites are proposals: nothing changes until you choose Replace, and citations in the passage are kept.",
    ],
  },
  research: {
    key: "research",
    title: "Research assistant",
    path: "/research",
    summary: "Ask a question across papers you choose and get an answer in which every statement shows its source.",
    steps: [
      { title: "Choose papers", detail: "Tick the papers to use in the list (papers with full text give the most detailed answers)." },
      { title: "Ask", detail: "Type your question and choose Ask." },
      { title: "Check the evidence", detail: "Click a numbered marker to see the exact passage it came from, with the supporting words highlighted." },
      { title: "Follow up", detail: "Ask more in the same conversation; earlier conversations are kept in History." },
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
      { title: "Format references", detail: "Paste DOIs, PubMed IDs or arXiv IDs (one per line), pick a style, choose Format, then Copy." },
      { title: "Check a reference list", detail: "Paste your list and choose Check references. Each entry is compared with Crossref by title, first author and year." },
      { title: "Read each verdict", detail: "Verified, Likely match (something could not be checked), Mismatch or Not found." },
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
  { keys: "/cite", action: "Cite a source at the cursor" },
  { keys: "Tab  /  Esc", action: "Accept / dismiss a grey suggestion" },
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
