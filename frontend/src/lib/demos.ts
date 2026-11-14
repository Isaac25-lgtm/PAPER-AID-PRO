import type { SectionKey } from "./guides";

/*
 * Ghost-cursor walkthroughs for each section's guide. Each scene is a simplified, faithful sketch of that page:
 * elements are laid out in three areas (a top bar, the main column and a side column), and frames move a pointer
 * to an element, optionally type into it or click it, then reveal or change elements. `step` links a frame to the
 * guide step it illustrates (highlighted next to the animation).
 *
 * Only real papers with their real details appear (Suri & Jack 2016, Science; Jack & Suri 2014, American Economic
 * Review; Aker & Mbiti 2010, Journal of Economic Perspectives). No invented results or numbers.
 */

export type DemoKind = "input" | "button" | "accent" | "card" | "check" | "chip" | "note" | "label";

export interface DemoElement {
  id: string;
  kind: DemoKind;
  area: "bar" | "main" | "side";
  text: string;
  sub?: string;
  /** Hidden until a frame reveals it. */
  hidden?: boolean;
  /** Takes the remaining width in the top bar. */
  grow?: boolean;
}

export interface DemoFrame {
  step: number;
  to?: string;
  type?: string;
  click?: boolean;
  reveal?: string[];
  hide?: string[];
  set?: Record<string, string>;
  /** Ids to mark as selected/ticked. */
  select?: string[];
}

export interface DemoScene {
  title: string;
  elements: DemoElement[];
  frames: DemoFrame[];
}

const SURI = { title: "The long-run poverty and gender impacts of mobile money", sub: "Suri & Jack · 2016 · Science" };
const JACK = { title: "Risk sharing and transactions costs: evidence from Kenya's mobile money revolution", sub: "Jack & Suri · 2014 · American Economic Review" };
const AKER = { title: "Mobile phones and economic development in Africa", sub: "Aker & Mbiti · 2010 · Journal of Economic Perspectives" };

export const DEMOS: Record<SectionKey, DemoScene> = {
  dashboard: {
    title: "Home",
    elements: [
      { id: "discover", kind: "button", area: "bar", text: "Discover" },
      { id: "docs", kind: "button", area: "bar", text: "Documents" },
      { id: "help", kind: "button", area: "bar", text: "? Help" },
      { id: "c1", kind: "check", area: "main", text: "Save your first paper" },
      { id: "c2", kind: "check", area: "main", text: "Start a document" },
      { id: "c3", kind: "check", area: "main", text: "Cite a source while writing" },
      { id: "recent", kind: "label", area: "side", text: "Recent documents" },
      { id: "doc1", kind: "card", area: "side", text: "Chapter 2 · Literature review", sub: "edited just now", hidden: true },
    ],
    frames: [
      { step: 0, to: "discover", click: true, select: ["c1"] },
      { step: 1, to: "docs", click: true, select: ["c2"], reveal: ["doc1"] },
      { step: 2, to: "doc1", click: true, select: ["c3"] },
      { step: 3, to: "help", click: true },
    ],
  },
  discover: {
    title: "Discover",
    elements: [
      { id: "subject", kind: "button", area: "bar", text: "All subjects" },
      { id: "q", kind: "input", area: "bar", text: "Search topics, titles or questions", grow: true },
      { id: "go", kind: "accent", area: "bar", text: "Search" },
      { id: "r1", kind: "card", area: "main", text: SURI.title, sub: `${SURI.sub} · via OpenAlex, Crossref`, hidden: true },
      { id: "r2", kind: "card", area: "main", text: AKER.title, sub: `${AKER.sub} · via Crossref`, hidden: true },
      { id: "save", kind: "button", area: "side", text: "Save to library", hidden: true },
      { id: "cite", kind: "chip", area: "side", text: "Cite · APA 7", hidden: true },
    ],
    frames: [
      { step: 0, to: "subject", click: true, set: { subject: "Social sciences" } },
      { step: 1, to: "q", type: "mobile money Kenya" },
      { step: 1, to: "go", click: true, reveal: ["r1", "r2", "save"] },
      { step: 2, to: "save", click: true, set: { save: "Saved ✓" }, select: ["r1"] },
      { step: 3, to: "r1", click: true, reveal: ["cite"] },
    ],
  },
  catalog: {
    title: "Catalog",
    elements: [
      { id: "q", kind: "input", area: "bar", text: "Search the catalog", grow: true },
      { id: "sort", kind: "button", area: "bar", text: "Relevance" },
      { id: "r1", kind: "card", area: "main", text: JACK.title, sub: JACK.sub, hidden: true },
      { id: "r2", kind: "card", area: "main", text: SURI.title, sub: SURI.sub, hidden: true },
      { id: "open", kind: "note", area: "side", text: "Paper page: details, full text, citation, questions", hidden: true },
    ],
    frames: [
      { step: 0, to: "q", type: "mobile money", reveal: ["r1", "r2"] },
      { step: 1, to: "sort", click: true, set: { sort: "Newest" }, hide: ["r1"], reveal: ["r1"] },
      { step: 2, to: "r2", click: true, select: ["r2"], reveal: ["open"] },
    ],
  },
  paper: {
    title: "Paper page",
    elements: [
      { id: "save", kind: "button", area: "bar", text: "Save to library" },
      { id: "cite", kind: "button", area: "bar", text: "Cite · APA 7" },
      { id: "pdf", kind: "accent", area: "bar", text: "Retrieve open-access PDF" },
      { id: "title", kind: "card", area: "main", text: SURI.title, sub: SURI.sub },
      { id: "status", kind: "note", area: "main", text: "Full text ready · passages with page numbers", hidden: true },
      { id: "q", kind: "input", area: "side", text: "Search inside this paper" },
      { id: "hit", kind: "note", area: "side", text: "Matching passage · page shown", hidden: true },
    ],
    frames: [
      { step: 0, to: "save", click: true, set: { save: "Saved ✓" } },
      { step: 1, to: "pdf", click: true, reveal: ["status"], set: { pdf: "Full text ready" } },
      { step: 2, to: "q", type: "gender", reveal: ["hit"] },
      { step: 3, to: "hit", click: true, select: ["hit"] },
    ],
  },
  library: {
    title: "Library",
    elements: [
      { id: "add", kind: "button", area: "bar", text: "Add paper" },
      { id: "import", kind: "button", area: "bar", text: "Import .bib / .ris" },
      { id: "doi", kind: "input", area: "bar", text: "DOI, PubMed ID or arXiv ID", grow: true, hidden: true },
      { id: "p1", kind: "card", area: "main", text: SURI.title, sub: SURI.sub, hidden: true },
      { id: "p2", kind: "card", area: "main", text: JACK.title, sub: JACK.sub, hidden: true },
      { id: "p3", kind: "card", area: "main", text: AKER.title, sub: AKER.sub, hidden: true },
      { id: "newcol", kind: "button", area: "side", text: "+ New collection" },
      { id: "col", kind: "chip", area: "side", text: "Chapter 2", hidden: true },
      { id: "export", kind: "button", area: "side", text: "Export BibTeX" },
    ],
    frames: [
      { step: 0, to: "add", click: true, reveal: ["doi"] },
      { step: 0, to: "doi", type: "10.1126/science.aah5309", reveal: ["p1"] },
      { step: 1, to: "import", click: true, hide: ["doi"], reveal: ["p2", "p3"] },
      { step: 2, to: "newcol", click: true, reveal: ["col"] },
      { step: 2, to: "p1", click: true, select: ["p1", "col"] },
      { step: 3, to: "export", click: true },
    ],
  },
  documents: {
    title: "Documents",
    elements: [
      { id: "new", kind: "accent", area: "bar", text: "New document" },
      { id: "topic", kind: "input", area: "main", text: "Topic", hidden: true },
      { id: "type", kind: "button", area: "main", text: "Literature review · Qualitative · APA 7", hidden: true },
      { id: "o1", kind: "check", area: "side", text: "1. Introduction", hidden: true },
      { id: "o2", kind: "check", area: "side", text: "2. Themes in the literature", hidden: true },
      { id: "o3", kind: "check", area: "side", text: "3. Gaps and conclusions", hidden: true },
      { id: "create", kind: "accent", area: "side", text: "Create document", hidden: true },
      { id: "doc", kind: "card", area: "main", text: "Mobile money and household resilience", sub: "Literature review · saved", hidden: true },
    ],
    frames: [
      { step: 0, to: "new", click: true, reveal: ["topic", "type"] },
      { step: 0, to: "topic", type: "Mobile money and household resilience" },
      { step: 1, to: "type", click: true, reveal: ["o1", "o2", "o3", "create"] },
      { step: 1, to: "o2", click: true, select: ["o1", "o2", "o3"] },
      { step: 2, to: "create", click: true, hide: ["topic", "type"], reveal: ["doc"] },
    ],
  },
  editor: {
    title: "Writing a document",
    elements: [
      { id: "cite", kind: "button", area: "bar", text: "Cite" },
      { id: "pdf", kind: "button", area: "bar", text: "PDF" },
      { id: "export", kind: "accent", area: "bar", text: "Export" },
      { id: "text", kind: "input", area: "main", text: "Start writing…" },
      { id: "result", kind: "card", area: "main", text: AKER.title, sub: `${AKER.sub} · ↵ cite`, hidden: true },
      { id: "chip", kind: "chip", area: "main", text: "(Aker & Mbiti, 2010)", hidden: true },
      { id: "menu", kind: "note", area: "side", text: "Selected text: Find a source · Rewrite · Shorten · Check against my sources", hidden: true },
      { id: "page", kind: "note", area: "side", text: "PDF page 3 · Cite highlight, p. 3", hidden: true },
    ],
    frames: [
      { step: 0, to: "text", type: "Mobile phones lowered search costs /cite", reveal: ["result"] },
      { step: 0, to: "result", click: true, hide: ["result"], reveal: ["chip"] },
      { step: 1, to: "chip", click: true, reveal: ["menu"] },
      { step: 2, to: "pdf", click: true, reveal: ["page"] },
      { step: 3, to: "export", click: true, select: ["export"] },
    ],
  },
  research: {
    title: "Research assistant",
    elements: [
      { id: "q", kind: "input", area: "bar", text: "Ask a question across your papers", grow: true },
      { id: "ask", kind: "accent", area: "bar", text: "Ask" },
      { id: "s1", kind: "check", area: "side", text: "Suri & Jack (2016)" },
      { id: "s2", kind: "check", area: "side", text: "Jack & Suri (2014)" },
      { id: "answer", kind: "note", area: "main", text: "Each statement in the answer ends with a numbered marker [1] linked to its source.", hidden: true },
      { id: "evidence", kind: "card", area: "main", text: "Source 1 · the supporting words are highlighted", sub: "Suri & Jack · 2016 · Science", hidden: true },
    ],
    frames: [
      { step: 0, to: "s1", click: true, select: ["s1"] },
      { step: 0, to: "s2", click: true, select: ["s1", "s2"] },
      { step: 1, to: "q", type: "How did mobile money affect poverty?" },
      { step: 1, to: "ask", click: true, reveal: ["answer"] },
      { step: 2, to: "answer", click: true, reveal: ["evidence"] },
      { step: 3, to: "q", type: "And for female-headed households?" },
    ],
  },
  citations: {
    title: "Citation tools",
    elements: [
      { id: "ids", kind: "input", area: "main", text: "DOIs, PubMed IDs or arXiv IDs" },
      { id: "style", kind: "button", area: "bar", text: "APA 7th edition" },
      { id: "format", kind: "accent", area: "bar", text: "Format" },
      { id: "ref", kind: "card", area: "main", text: "Suri, T., & Jack, W. (2016). The long-run poverty and gender impacts of mobile money. Science, 354(6317), 1288–1292.", hidden: true },
      { id: "check", kind: "button", area: "side", text: "Check references" },
      { id: "v1", kind: "chip", area: "side", text: "Jack & Suri (2014) · Matched", hidden: true },
      { id: "v2", kind: "chip", area: "side", text: "Aker & Mbiti (2010) · Matched", hidden: true },
    ],
    frames: [
      { step: 0, to: "ids", type: "10.1126/science.aah5309" },
      { step: 0, to: "format", click: true, reveal: ["ref"] },
      { step: 1, to: "check", click: true, reveal: ["v1", "v2"] },
      { step: 2, to: "v1", click: true, select: ["v1", "v2"] },
    ],
  },
};
