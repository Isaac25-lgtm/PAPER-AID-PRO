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

export const DOC_TYPES: { value: string; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "manuscript", label: "Manuscript" },
  { value: "proposal", label: "Research proposal" },
  { value: "literature_review", label: "Literature review" },
  { value: "thesis", label: "Thesis / dissertation" },
  { value: "report", label: "Report" },
];
