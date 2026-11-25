import { NodeSelection } from "@tiptap/pm/state";
import { mergeAttributes, Node } from "@tiptap/react";

/**
 * Inline, atomic citation node. The document stores only `citationIds` (server citation records);
 * the visible `label` is formatted server-side by citeproc-js in the document's style and applied
 * after each render without becoming part of the saved content.
 */
export interface CitationNodeOptions {
  /** Open the source(s) of a citation: by click (the editor page) or, with the citation selected, Enter. */
  onOpen: (ids: string[], element: HTMLElement | null) => void;
}

export const CitationNode = Node.create<CitationNodeOptions>({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { onOpen: () => undefined };
  },

  /** Enter on a selected citation opens its source instead of replacing it with a new line (audit SF13). */
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const selection = editor.state.selection;
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name) return false;
        const ids = (selection.node.attrs.citationIds as string[]) ?? [];
        if (!ids.length) return false;
        this.options.onOpen(ids, editor.view.nodeDOM(selection.from) as HTMLElement | null);
        return true;
      },
    };
  },

  addAttributes() {
    return {
      citationIds: {
        default: [],
        parseHTML: (el) => (el.getAttribute("data-citation-ids") ?? "").split(",").filter(Boolean),
        renderHTML: (attrs) => ({ "data-citation-ids": (attrs.citationIds as string[]).join(",") }),
      },
      label: { default: "[…]", rendered: false },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-citation-ids]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "citation-chip", title: "Click (or select it and press Enter) to see the cited source" }), node.attrs.label as string];
  },

  renderText({ node }) {
    return node.attrs.label as string;
  },
});

export const LABEL_META = "citationLabels";
