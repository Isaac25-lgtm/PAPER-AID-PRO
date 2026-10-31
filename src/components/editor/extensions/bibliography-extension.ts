import { Node, mergeAttributes } from "@tiptap/core";
import { cslToPlainText } from "@/lib/citations/csl";

export interface BibliographyNodeAttrs {
  styleId: string;
  styleTitle: string;
  entries: string[];
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    bibliography: {
      setBibliography: (attrs: BibliographyNodeAttrs) => ReturnType;
      removeBibliography: () => ReturnType;
    };
  }
}

import { REFERENCES_GUIDANCE_TEXT } from "@/lib/editor/guided-templates";

export function isReferencesHeading(node: any): boolean {
  if (!node || node.type?.name !== "heading") return false;
  const text = (node.textContent || "").trim();
  return /^(references|bibliography|works cited)$/i.test(text);
}

export function isPlaceholderParagraph(node: any): boolean {
  if (!node || node.type?.name !== "paragraph") return false;
  const text = (node.textContent || "").trim();
  if (!text) return true;
  return (
    text === REFERENCES_GUIDANCE_TEXT ||
    text.includes("Insert citations directly from My Library") ||
    text.includes("search Crossref/PubMed")
  );
}

/**
 * Searches the ProseMirror doc for an unreplaced template References placeholder.
 * A template placeholder consists of:
 * 1. A Heading (level 2) with title 'References' or 'Bibliography'.
 * 2. An immediately subsequent paragraph with template guidance text (or empty).
 * 3. Followed by no user-authored text in this section (i.e. up to next heading or end of doc).
 */
export function findTemplatePlaceholder(doc: any): { startPos: number; endPos: number } | null {
  let result: { startPos: number; endPos: number } | null = null;

  doc.forEach((node: any, offset: number) => {
    if (result) return;

    if (isReferencesHeading(node)) {
      const headingStart = offset;
      const headingEnd = offset + node.nodeSize;
      const nextNode = doc.resolve(headingEnd).nodeAfter;

      if (nextNode && isPlaceholderParagraph(nextNode)) {
        const paragraphEnd = headingEnd + nextNode.nodeSize;

        // Check if there are any subsequent user-authored paragraphs/blocks before the end of doc or next heading
        let hasSubsequentUserContent = false;
        doc.nodesBetween(paragraphEnd, doc.content.size, (subNode: any) => {
          if (subNode.type?.name === "heading" || subNode.type?.name === "bibliography") {
            return false; // Stop descending into subsequent sections
          }
          if (subNode.isText && subNode.text && subNode.text.trim()) {
            hasSubsequentUserContent = true;
          }
        });

        if (!hasSubsequentUserContent) {
          result = {
            startPos: headingStart,
            endPos: paragraphEnd,
          };
        }
      }
    }
  });

  return result;
}

import { decodeHtmlEntities } from "@/lib/citations/csl/csl-engine";

/**
 * Safely parses CSL HTML entries into a ProseMirror DOMOutputSpec array,
 * preserving academic formatting tags (e.g. <i>, <em>, <b>, <strong>) in the TipTap DOM.
 */
export function cslEntryToDOMSpec(entryHtml: string): any[] {
  if (!entryHtml || typeof entryHtml !== "string") {
    return [""];
  }

  // Split on allowed inline formatting tags: <i>, <em>, <b>, <strong>, <sup>, <sub>
  const tagRegex = /<\/?(i|em|b|strong|sup|sub)\b[^>]*>/gi;
  const parts: any[] = [];
  let lastIndex = 0;
  let currentTag: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(entryHtml)) !== null) {
    const textBefore = entryHtml.substring(lastIndex, match.index);
    if (textBefore) {
      const decoded = decodeHtmlEntities(textBefore);
      if (currentTag) {
        parts.push([currentTag, {}, decoded]);
      } else {
        parts.push(decoded);
      }
    }

    const isClosing = match[0].startsWith("</");
    if (isClosing) {
      currentTag = null;
    } else {
      currentTag = match[1].toLowerCase();
    }

    lastIndex = tagRegex.lastIndex;
  }

  const trailingText = entryHtml.substring(lastIndex);
  if (trailingText) {
    const decoded = decodeHtmlEntities(trailingText);
    if (currentTag) {
      parts.push([currentTag, {}, decoded]);
    } else {
      parts.push(decoded);
    }
  }

  return parts.length > 0 ? parts : [""];
}

export const BibliographyExtension = Node.create({
  name: "bibliography",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      styleId: {
        default: "apa",
        parseHTML: (el) => el.getAttribute("data-style-id") || "apa",
        renderHTML: (attrs) => ({
          "data-style-id": attrs.styleId || "apa",
        }),
      },
      styleTitle: {
        default: "References",
        parseHTML: (el) => el.getAttribute("data-style-title") || "References",
        renderHTML: (attrs) => ({
          "data-style-title": attrs.styleTitle || "References",
        }),
      },
      entries: {
        default: [],
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute("data-entries") || "[]");
          } catch {
            return [];
          }
        },
        renderHTML: (attrs) => ({
          "data-entries": JSON.stringify(attrs.entries || []),
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-csl-bibliography]",
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const entries: string[] = node.attrs.entries || [];
    const styleTitle = node.attrs.styleTitle || "References";

    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-csl-bibliography": "",
        class:
          "csl-bibliography-container my-10 pt-8 border-t-2 border-slate-200 font-sans select-none",
        contenteditable: "false",
      }),
      [
        "div",
        {
          class:
            "flex items-center justify-between pb-4 border-b border-slate-100 mb-6",
        },
        [
          "h2",
          {
            class:
              "text-lg font-bold font-serif text-slate-900 tracking-tight m-0",
          },
          "References",
        ],
        [
          "span",
          {
            class:
              "text-[11px] font-medium font-sans px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200",
          },
          `${styleTitle} (${entries.length})`,
        ],
      ],
      [
        "div",
        { class: "space-y-3 text-sm text-slate-700 leading-relaxed font-sans" },
        ...entries.map((entryHtml) => [
          "div",
          {
            class:
              "csl-entry-item p-2 rounded-lg bg-slate-50/60 hover:bg-slate-50 border border-slate-100 transition-colors",
            // TipTap prose DOM rendering
            "data-csl-entry": "",
          },
          ...cslEntryToDOMSpec(entryHtml),
        ]),
      ],
    ];
  },

  addCommands() {
    return {
      setBibliography:
        (attrs: BibliographyNodeAttrs) =>
        ({ tr, dispatch }) => {
          if (!dispatch) return false;

          let existingPos: number | null = null;
          tr.doc.descendants((node, pos) => {
            if (node.type.name === "bibliography") {
              existingPos = pos;
            }
          });

          if (existingPos !== null) {
            // Update existing bibliography node in-place
            tr.setNodeMarkup(existingPos, undefined, attrs);

            // If an obsolete template placeholder is still present directly above the bibliography node, remove it
            const placeholder = findTemplatePlaceholder(tr.doc);
            if (placeholder && placeholder.endPos <= existingPos) {
              tr.delete(placeholder.startPos, placeholder.endPos);
            }
          } else {
            // No bibliography node exists yet: search for generated template placeholder to replace
            const placeholder = findTemplatePlaceholder(tr.doc);
            const nodeType = (this as any)?.type || tr.doc.type.schema.nodes.bibliography;
            const node = nodeType.create(attrs);

            if (placeholder) {
              // Replace placeholder in-place so only one References section exists
              tr.replaceWith(placeholder.startPos, placeholder.endPos, node);
            } else {
              // Genuine user-written References content exists or custom layout: append without deleting
              tr.insert(tr.doc.content.size, node);
            }
          }

          if (dispatch) {
            dispatch(tr);
          }
          return true;
        },

      removeBibliography:
        () =>
        ({ tr, dispatch }) => {
          if (!dispatch) return false;

          let found = false;
          tr.doc.descendants((node, pos) => {
            if (node.type.name === "bibliography") {
              tr.delete(pos, pos + node.nodeSize);
              found = true;
            }
          });

          if (found && dispatch) {
            dispatch(tr);
          }
          return found;
        },
    };
  },
});
