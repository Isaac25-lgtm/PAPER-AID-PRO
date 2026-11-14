import type { Editor } from "@tiptap/react";

import { LABEL_META } from "./citationNode";
import type { RenderedCitations } from "./types";

function labelOf(cluster: RenderedCitations["clusters"][number]): string {
  const html = cluster.text ? (cluster.missing_ids.length ? `${cluster.text} [missing source]` : cluster.text) : "[missing source]";
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? html;
}

/**
 * Apply server-formatted labels to the editor's citation nodes BY OCCURRENCE: the server returns one entry per
 * citation node in document order (depth-first, the same order as ProseMirror's traversal), so the n-th node
 * gets the n-th label. Two nodes citing the same source can legitimately differ (e.g. a full first note and a
 * shortened later one in note styles), so labels are never matched by source ids.
 *
 * If the editor's citations no longer match what was rendered (the writer changed them since that save), the
 * result is stale and is ignored; the next save renders again. Returns whether the labels were applied.
 */
export function applyCitationLabels(editor: Editor, rendered: RenderedCitations): boolean {
  const nodes: { pos: number; ids: string[]; label: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "citation") nodes.push({ pos, ids: node.attrs.citationIds as string[], label: node.attrs.label as string });
  });
  const clusters = rendered.clusters;
  const matches = nodes.length === clusters.length && nodes.every((n, i) => n.ids.join(",") === clusters[i]?.citation_ids.join(","));
  if (!matches) return false;
  const tr = editor.state.tr;
  let changed = false;
  nodes.forEach((n, i) => {
    const cluster = clusters[i];
    if (!cluster) return;
    const label = labelOf(cluster);
    if (n.label !== label) {
      const node = tr.doc.nodeAt(n.pos);
      if (node) tr.setNodeMarkup(n.pos, undefined, { ...node.attrs, label });
      changed = true;
    }
  });
  if (changed) editor.view.dispatch(tr.setMeta(LABEL_META, true).setMeta("addToHistory", false));
  return true;
}

/**
 * Apply a citation render to the editor only if it is still current: rendered in the style the document now uses,
 * and for exactly the citations now in the text. Returns whether it was applied (callers then show its reference
 * list); a stale render changes nothing and the next save renders again.
 */
export function applyRenderIfCurrent(editor: Editor, rendered: RenderedCitations, currentStyle: string): boolean {
  if (rendered.style !== currentStyle) return false;
  return applyCitationLabels(editor, rendered);
}
