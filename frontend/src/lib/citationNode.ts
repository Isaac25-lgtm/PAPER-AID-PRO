import { mergeAttributes, Node } from "@tiptap/react";

/**
 * Inline, atomic citation node. The document stores only `citationIds` (server citation records);
 * the visible `label` is formatted server-side by citeproc-js in the document's style and applied
 * after each render without becoming part of the saved content.
 */
export const CitationNode = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

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
    return ["span", mergeAttributes(HTMLAttributes, { class: "citation-chip", title: "Citation" }), node.attrs.label as string];
  },

  renderText({ node }) {
    return node.attrs.label as string;
  },
});

export const LABEL_META = "citationLabels";
