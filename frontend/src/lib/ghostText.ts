import { Extension } from "@tiptap/react";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * Inline AI suggestion ("ghost text"): grey text shown after the cursor that is not part of the document until the
 * writer accepts it with Tab. Esc, typing, clicking elsewhere or any edit dismisses it. The suggestion lives only
 * in editor state (a widget decoration), so it is never saved, exported or sent anywhere.
 */
export interface Ghost {
  pos: number;
  text: string;
}

type GhostMeta = { set: Ghost } | { clear: true };

export const ghostKey = new PluginKey<Ghost | null>("ghostText");

export function currentGhost(state: EditorState): Ghost | null {
  return ghostKey.getState(state) ?? null;
}

/** Where a suggestion may appear: an empty cursor at the end of a non-empty, non-code text block. */
export function suggestionPoint(state: EditorState): number | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $head = selection.$head;
  const parent = $head.parent;
  if (!parent.isTextblock || parent.type.spec.code || parent.content.size === 0) return null;
  if ($head.parentOffset !== parent.content.size) return null;
  return $head.pos;
}

export function showGhost(view: EditorView, ghost: Ghost): void {
  view.dispatch(view.state.tr.setMeta(ghostKey, { set: ghost } satisfies GhostMeta).setMeta("addToHistory", false));
}

export function clearGhost(view: EditorView): void {
  if (currentGhost(view.state)) view.dispatch(view.state.tr.setMeta(ghostKey, { clear: true } satisfies GhostMeta));
}

/** Accept the visible suggestion. Returns false when there is none. */
export function acceptGhost(view: EditorView): boolean {
  const ghost = currentGhost(view.state);
  if (!ghost) return false;
  view.dispatch(view.state.tr.insertText(ghost.text, ghost.pos).setMeta(ghostKey, { clear: true } satisfies GhostMeta).scrollIntoView());
  return true;
}

export const GhostText = Extension.create({
  name: "ghostText",

  addProseMirrorPlugins() {
    return [
      new Plugin<Ghost | null>({
        key: ghostKey,
        state: {
          init: () => null,
          apply(tr, value, _old, next) {
            const meta = tr.getMeta(ghostKey) as GhostMeta | undefined;
            if (meta && "set" in meta) return meta.set;
            if (meta && "clear" in meta) return null;
            if (!value) return null;
            // Any edit, selection or cursor move invalidates the suggestion.
            if (tr.docChanged || !next.selection.empty || next.selection.head !== value.pos) return null;
            return value;
          },
        },
        props: {
          decorations(state) {
            const ghost = ghostKey.getState(state);
            if (!ghost) return null;
            const widget = Decoration.widget(
              ghost.pos,
              () => {
                const span = document.createElement("span");
                span.className = "ghost-text";
                span.setAttribute("data-ghost", "");
                span.setAttribute("aria-hidden", "true");
                span.textContent = ghost.text;
                return span;
              },
              { side: 1, key: `ghost:${ghost.pos}:${ghost.text}`, ignoreSelection: true },
            );
            return DecorationSet.create(state.doc, [widget]);
          },
          handleKeyDown(view, event) {
            if (!currentGhost(view.state)) return false;
            if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
              event.preventDefault();
              return acceptGhost(view);
            }
            if (event.key === "Escape") {
              clearGhost(view);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
