// Writing guidance from a template must never make the person's own text italic (browser test, 2026-11-21).
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { GuidanceParagraph } from "@/lib/guidanceParagraph";
import { guidedContent } from "@/lib/templates";

const content = guidedContent({ topic: "School feeding", docType: "manuscript", design: "", generalObjective: "", specificObjectives: [], headings: ["Introduction"] });

describe("template guidance", () => {
  it("is a paragraph setting, not italic text", () => {
    const guidance = content.content!.find((node) => node.type === "paragraph" && node.attrs?.guidance);
    expect(guidance).toBeDefined();
    expect(guidance!.content!.every((child) => !child.marks?.length)).toBe(true);
  });

  it("does not carry over when the person presses Enter after it and types", () => {
    const editor = new Editor({ extensions: [StarterKit, GuidanceParagraph], content });
    let end = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.attrs.guidance) end = pos + node.nodeSize - 1;
    });
    editor.chain().setTextSelection(end).splitBlock().insertContent("My own words").run();
    let mine: { guidance: unknown; marks: readonly unknown[] } | null = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "paragraph" && node.textContent === "My own words") {
        mine = { guidance: node.attrs.guidance, marks: node.firstChild?.marks ?? [] };
      }
    });
    expect(mine).toEqual({ guidance: false, marks: [] });
    expect(editor.getHTML()).toContain("data-guidance");
    editor.destroy();
  });
});
