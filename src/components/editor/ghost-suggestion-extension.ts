import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface GhostSuggestionState {
  pos: number;
  text: string;
}

export const ghostSuggestionPluginKey = new PluginKey<GhostSuggestionState | null>(
  "ghostSuggestion"
);

export interface GhostSuggestionOptions {
  onAccept?: (text: string) => void;
  onDismiss?: () => void;
  onTrigger?: () => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    ghostSuggestion: {
      setGhostSuggestion: (suggestion: { pos: number; text: string }) => ReturnType;
      clearGhostSuggestion: () => ReturnType;
      acceptGhostSuggestion: () => ReturnType;
    };
  }
}

export const GhostSuggestion = Extension.create<GhostSuggestionOptions>({
  name: "ghostSuggestion",

  addOptions() {
    return {
      onAccept: undefined,
      onDismiss: undefined,
      onTrigger: undefined,
    };
  },

  addCommands() {
    return {
      setGhostSuggestion:
        (suggestion) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(ghostSuggestionPluginKey, suggestion);
          }
          return true;
        },
      clearGhostSuggestion:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(ghostSuggestionPluginKey, null);
          }
          return true;
        },
      acceptGhostSuggestion:
        () =>
        ({ editor, tr, dispatch }) => {
          const state = ghostSuggestionPluginKey.getState(editor.state);
          if (state && state.text) {
            const { pos, text } = state;
            let insertText = text;
            try {
              const charBefore = editor.state.doc.textBetween(Math.max(0, pos - 1), pos);
              if (charBefore && !/\s/.test(charBefore) && !insertText.startsWith(" ") && !/^[.,;:!?]/.test(insertText)) {
                insertText = " " + insertText;
              } else if (charBefore && /\s/.test(charBefore) && insertText.startsWith(" ")) {
                insertText = insertText.trimStart();
              }
            } catch {
              if (!insertText.startsWith(" ") && !/^[.,;:!?]/.test(insertText)) {
                insertText = " " + insertText;
              }
            }

            if (dispatch) {
              tr.setMeta(ghostSuggestionPluginKey, null);
              tr.insertText(insertText, pos);
              const newPos = pos + insertText.length;
              tr.setSelection(TextSelection.create(tr.doc, newPos));
            }
            return true;
          }
          return false;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ghostSuggestionPluginKey,
        state: {
          init: () => null,
          apply: (tr, prev: GhostSuggestionState | null) => {
            const meta = tr.getMeta(ghostSuggestionPluginKey);
            if (meta !== undefined) {
              return meta;
            }
            if (!prev) return null;

            // Invalidate if document text changed
            if (tr.docChanged) {
              return null;
            }

            // Invalidate if cursor moved away from suggestion position
            const { from, to } = tr.selection;
            if (from !== prev.pos || to !== prev.pos) {
              return null;
            }

            return prev;
          },
        },
        props: {
          decorations: (state) => {
            const pluginState = ghostSuggestionPluginKey.getState(state);
            if (!pluginState || !pluginState.text) {
              return DecorationSet.empty;
            }

            const { pos, text } = pluginState;
            if (pos < 0 || pos > state.doc.content.size) {
              return DecorationSet.empty;
            }

            // Format insertion text: prefix with a space if not already present and if preceding character is not whitespace
            let displayText = text;
            try {
              const charBefore = state.doc.textBetween(Math.max(0, pos - 1), pos);
              if (charBefore && !/\s/.test(charBefore) && !displayText.startsWith(" ") && !/^[.,;:!?]/.test(displayText)) {
                displayText = " " + displayText;
              } else if (charBefore && /\s/.test(charBefore) && displayText.startsWith(" ")) {
                displayText = displayText.trimStart();
              }
            } catch {
              if (!displayText.startsWith(" ") && !/^[.,;:!?]/.test(displayText)) {
                displayText = " " + displayText;
              }
            }

            const widget = Decoration.widget(
              pos,
              () => {
                const span = document.createElement("span");
                span.className =
                  "inline-ghost-text select-none pointer-events-none text-slate-400 font-serif opacity-75 italic inline";
                span.setAttribute("data-ghost-suggestion", "true");
                span.setAttribute("data-testid", "ghost-suggestion-inline");

                const textSpan = document.createElement("span");
                textSpan.className = "inline-ghost-text-content";
                textSpan.textContent = displayText;
                span.appendChild(textSpan);

                const badge = document.createElement("span");
                badge.className =
                  "inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 text-[10px] font-sans font-medium text-slate-500 bg-slate-100/90 border border-slate-200 rounded shadow-2xs select-none not-italic align-middle whitespace-nowrap";

                const kbdTab = document.createElement("kbd");
                kbdTab.className =
                  "px-1 py-0.2 bg-white border border-slate-300 rounded font-semibold text-slate-600 text-[9px]";
                kbdTab.textContent = "Tab";
                badge.appendChild(kbdTab);

                const tabLabel = document.createElement("span");
                tabLabel.textContent = "accept";
                badge.appendChild(tabLabel);

                const divider = document.createElement("span");
                divider.className = "text-slate-300 mx-0.5";
                divider.textContent = "·";
                badge.appendChild(divider);

                const kbdEsc = document.createElement("kbd");
                kbdEsc.className =
                  "px-1 py-0.2 bg-white border border-slate-300 rounded text-slate-500 text-[9px]";
                kbdEsc.textContent = "Esc";
                badge.appendChild(kbdEsc);

                span.appendChild(badge);

                return span;
              },
              { side: 1, key: "ai-inline-ghost-suggestion" }
            );

            return DecorationSet.create(state.doc, [widget]);
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const state = ghostSuggestionPluginKey.getState(this.editor.state);
        if (state && state.text) {
          const text = state.text;
          const handled = this.editor.commands.acceptGhostSuggestion();
          if (handled) {
            this.options.onAccept?.(text);
            return true; // Handled, prevent tab indent
          }
        }
        return false;
      },
      Escape: () => {
        const state = ghostSuggestionPluginKey.getState(this.editor.state);
        if (state && state.text) {
          this.editor.commands.clearGhostSuggestion();
          this.options.onDismiss?.();
          return true; // Handled
        }
        return false;
      },
      "Mod-j": () => {
        this.options.onTrigger?.();
        return true;
      },
      "Mod-J": () => {
        this.options.onTrigger?.();
        return true;
      },
    };
  },
});
