export function authorLine(authors: string[], max = 3): string {
  if (authors.length === 0) return "Unknown authors";
  if (authors.length <= max) return authors.join(", ");
  return `${authors.slice(0, max).join(", ")} et al.`;
}

export function relativeTime(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const ALLOWED_TAGS = new Set(["I", "B", "EM", "STRONG", "SUP", "SUB", "SPAN", "DIV", "A", "SC"]);

/** Citation HTML from citeproc-js is trusted-shaped, but sanitise anyway (defence in depth). */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(document.createTextNode(child.textContent ?? ""));
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const keep = attr.name === "style" ? /^(font-variant|font-style|font-weight)[^;]*;?$/i.test(attr.value) : attr.name === "href" && /^https?:\/\//i.test(attr.value);
        if (!keep) child.removeAttribute(attr.name);
      }
      if (child.tagName === "A") {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noreferrer");
      }
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.firstElementChild?.innerHTML ?? "";
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/g;

/** Trailing punctuation belongs to the sentence, except a closing bracket that is part of the address. */
function trimUrl(url: string): string {
  let out = url;
  for (;;) {
    const last = out.at(-1);
    if (last && ".,;:'".includes(last)) out = out.slice(0, -1);
    else if (last === ")" && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0)) out = out.slice(0, -1);
    else return out;
  }
}

/**
 * A formatted reference list entry, sanitised, with every web address (DOI links included) made clickable,
 * opening in a new tab (Silver, 25 November 2026: references must open their article).
 */
export function linkifyReferences(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${sanitizeHtml(html)}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.parentElement?.closest("a"))) texts.push(node as Text);
  }
  for (const text of texts) {
    const value = text.data;
    const matches = [...value.matchAll(URL_IN_TEXT)];
    if (!matches.length) continue;
    const parts = doc.createDocumentFragment();
    let at = 0;
    for (const match of matches) {
      const url = trimUrl(match[0]);
      const start = match.index ?? 0;
      parts.append(value.slice(at, start));
      const link = doc.createElement("a");
      link.href = url;
      link.textContent = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      parts.append(link);
      at = start + url.length;
    }
    parts.append(value.slice(at));
    text.replaceWith(parts);
  }
  return root.innerHTML;
}

export const DOC_TYPES: { value: string; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "manuscript", label: "Manuscript" },
  { value: "proposal", label: "Research proposal" },
  { value: "literature_review", label: "Literature review" },
  { value: "thesis", label: "Thesis / dissertation" },
  { value: "report", label: "Report" },
];

/** An external address that is safe to put in a link: http(s) only, otherwise nothing. */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
