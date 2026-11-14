import { Extension, InputRule } from "@tiptap/react";

/** Typing "/cite" at the start of a word removes the command text and opens the cite search at that point. */
export const CITE_COMMAND = /(^|\s)(\/cite)$/;

export const CiteTrigger = Extension.create<{ onTrigger: (pos: number) => void }>({
  name: "citeTrigger",

  addOptions() {
    return { onTrigger: () => undefined };
  },

  addInputRules() {
    return [
      new InputRule({
        find: CITE_COMMAND,
        handler: ({ state, range, match }) => {
          const from = range.from + (match[1]?.length ?? 0);
          state.tr.delete(from, range.to);
          const onTrigger = this.options.onTrigger;
          // Open after this transaction has been applied, so the palette reads the final cursor position.
          window.setTimeout(() => onTrigger(from), 0);
        },
        undoable: false,
      }),
    ];
  },
});
