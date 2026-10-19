import { Node, mergeAttributes } from "@tiptap/core";

export interface CitationItemAttr {
  paperId: string;
  paperTitle?: string;
  locator?: string;
  label?: string;
  prefix?: string;
  suffix?: string;
}

export interface CitationNodeAttrs {
  citationId: string;
  items: CitationItemAttr[];
  renderedText: string;
  styleId?: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (attrs: CitationNodeAttrs) => ReturnType;
      updateCitation: (citationId: string, updates: Partial<CitationNodeAttrs>) => ReturnType;
      updateAllCitations: (renderedMap: Record<string, string>, styleId?: string) => ReturnType;
    };
  }
}

export const CitationExtension = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      citationId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-citation-id"),
        renderHTML: (attrs) => ({
          "data-citation-id": attrs.citationId,
        }),
      },
      items: {
        default: [],
        parseHTML: (el) => {
          try {
            return JSON.parse(el.getAttribute("data-citation-items") || "[]");
          } catch {
            return [];
          }
        },
        renderHTML: (attrs) => ({
          "data-citation-items": JSON.stringify(attrs.items || []),
        }),
      },
      renderedText: {
        default: "(Citation)",
        parseHTML: (el) => el.textContent || "(Citation)",
        renderHTML: (attrs) => ({
          "data-rendered-text": attrs.renderedText,
        }),
      },
      styleId: {
        default: "apa",
        parseHTML: (el) => el.getAttribute("data-style-id") || "apa",
        renderHTML: (attrs) => ({
          "data-style-id": attrs.styleId || "apa",
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-citation]",
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const text = node.attrs.renderedText || "(Citation)";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-citation": "",
        class:
          "csl-citation-badge inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded font-sans text-xs font-semibold text-indigo-700 bg-indigo-50/90 border border-indigo-200/80 hover:bg-indigo-100 hover:border-indigo-300 transition-all cursor-pointer select-none align-baseline shadow-2xs",
        contenteditable: "false",
        title: "Click to view or edit citation locator",
      }),
      text,
    ];
  },

  addCommands() {
    return {
      insertCitation:
        (attrs: CitationNodeAttrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          });
        },

      updateCitation:
        (citationId: string, updates: Partial<CitationNodeAttrs>) =>
        ({ tr, dispatch }) => {
          if (!dispatch) return false;
          let updated = false;

          tr.doc.descendants((node, pos) => {
            if (node.type.name === "citation" && node.attrs.citationId === citationId) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                ...updates,
              });
              updated = true;
            }
          });

          return updated;
        },

      updateAllCitations:
        (renderedMap: Record<string, string>, styleId?: string) =>
        ({ tr, dispatch }) => {
          if (!dispatch) return false;
          let updated = false;

          tr.doc.descendants((node, pos) => {
            if (node.type.name === "citation") {
              const id = node.attrs.citationId;
              const newText = renderedMap[id];
              if (newText && newText !== node.attrs.renderedText) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  renderedText: newText,
                  styleId: styleId || node.attrs.styleId,
                });
                updated = true;
              } else if (styleId && node.attrs.styleId !== styleId) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  styleId,
                });
                updated = true;
              }
            }
          });

          return updated;
        },
    };
  },
});
