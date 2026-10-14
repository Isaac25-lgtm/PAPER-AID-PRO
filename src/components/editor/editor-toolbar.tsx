"use client";

import React from "react";
import { type Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  List,
  ListOrdered,
  Quote,
  Table as TableIcon,
  Undo2,
  Redo2,
  Sparkles,
} from "lucide-react";

interface EditorToolbarProps {
  editor: Editor | null;
  onTriggerAiAutocomplete?: () => void;
  isAiGenerating?: boolean;
}

export function EditorToolbar({
  editor,
  onTriggerAiAutocomplete,
  isAiGenerating = false,
}: EditorToolbarProps) {
  if (!editor) {
    return null;
  }

  const IconButton = ({
    active,
    onClick,
    title,
    children,
    disabled = false,
  }: {
    active?: boolean;
    onClick: () => void;
    title: string;
    children: React.ReactNode;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition-colors text-sm flex items-center justify-center ${
        active
          ? "bg-indigo-100 text-indigo-700 font-semibold"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      {children}
    </button>
  );

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1 px-3 py-2 bg-white/95 backdrop-blur border-b border-slate-200">
      {/* Undo / Redo */}
      <IconButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo (Ctrl+Z)"
      >
        <Undo2 className="w-4 h-4" />
      </IconButton>
      <IconButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo (Ctrl+Y)"
      >
        <Redo2 className="w-4 h-4" />
      </IconButton>

      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* Paragraph / Headings */}
      <IconButton
        active={editor.isActive("paragraph")}
        onClick={() => editor.chain().focus().setParagraph().run()}
        title="Paragraph"
      >
        <Pilcrow className="w-4 h-4" />
      </IconButton>
      <IconButton
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Heading 1"
      >
        <Heading1 className="w-4 h-4" />
      </IconButton>
      <IconButton
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading 2"
      >
        <Heading2 className="w-4 h-4" />
      </IconButton>
      <IconButton
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Heading 3"
      >
        <Heading3 className="w-4 h-4" />
      </IconButton>

      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* Formatting Marks */}
      <IconButton
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold (Ctrl+B)"
      >
        <Bold className="w-4 h-4" />
      </IconButton>
      <IconButton
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic (Ctrl+I)"
      >
        <Italic className="w-4 h-4" />
      </IconButton>
      <IconButton
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline (Ctrl+U)"
      >
        <Underline className="w-4 h-4" />
      </IconButton>

      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* Lists & Quotes */}
      <IconButton
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet List"
      >
        <List className="w-4 h-4" />
      </IconButton>
      <IconButton
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered List"
      >
        <ListOrdered className="w-4 h-4" />
      </IconButton>
      <IconButton
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Blockquote"
      >
        <Quote className="w-4 h-4" />
      </IconButton>

      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* Table */}
      <IconButton
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
        title="Insert 3x3 Academic Table"
      >
        <TableIcon className="w-4 h-4" />
      </IconButton>

      {/* AI Autocomplete Trigger */}
      {onTriggerAiAutocomplete && (
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onTriggerAiAutocomplete}
            disabled={isAiGenerating}
            title="Generate AI completion (or press Cmd/Ctrl + J)"
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-gradient-to-r from-indigo-50 to-indigo-100 border border-indigo-200 text-indigo-700 hover:from-indigo-100 hover:to-indigo-200 transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isAiGenerating ? "animate-spin text-indigo-500" : "text-indigo-600"}`} />
            <span>{isAiGenerating ? "Generating..." : "AI Complete"}</span>
            <kbd className="hidden sm:inline-block px-1 py-0.5 text-[10px] bg-white/80 rounded border border-indigo-200 text-indigo-600">
              Ctrl+J
            </kbd>
          </button>
        </div>
      )}
    </div>
  );
}
