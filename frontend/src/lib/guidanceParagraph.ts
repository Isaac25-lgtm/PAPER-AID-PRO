import { Extension } from "@tiptap/react";

/**
 * Template writing guidance ("Summarise the background, objectives…") is a paragraph SETTING shown grey and
 * italic by style, not italic text. So pressing Enter after it starts an ordinary paragraph: the person's own
 * words never inherit italics from the guidance (browser test, 2026-11-21).
 */
export const GuidanceParagraph = Extension.create({
  name: "guidanceParagraph",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          guidance: {
            default: false,
            keepOnSplit: false,
            parseHTML: (element) => element.hasAttribute("data-guidance"),
            renderHTML: (attributes) => (attributes.guidance ? { "data-guidance": "" } : {}),
          },
        },
      },
    ];
  },
});
