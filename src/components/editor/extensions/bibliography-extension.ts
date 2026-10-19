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
          // Safe plain text entry rendering (HTML entities decoded, math preserved, zero XSS)
          cslToPlainText(entryHtml),
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
            // Update existing bibliography node
            tr.setNodeMarkup(existingPos, undefined, attrs);
          } else {
            // Insert at the end of the document
            const node = this.type.create(attrs);
            tr.insert(tr.doc.content.size, node);
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

          return found;
        },
    };
  },
});
