"""DOCX and PDF export of research documents, with citations rendered in the document's CSL style."""

from __future__ import annotations

import html
import io
import re
from pathlib import Path
from typing import Any

from docx import Document as DocxDocument
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt
from fpdf import FPDF

from app.errors import UpstreamError

_TAG = re.compile(r"<[^>]+>")


def strip_html(value: str) -> str:
    return html.unescape(_TAG.sub("", value)).strip()


def _cluster_texts(rendered: dict[str, Any]) -> list[str]:
    return [strip_html(c["text"]) for c in rendered.get("clusters", [])]


# ------------------------------------------------------------------------------------------------------ DOCX
def to_docx(title: str, content: dict[str, Any], rendered: dict[str, Any]) -> bytes:
    citations = iter(_cluster_texts(rendered))
    doc = DocxDocument()
    style = doc.styles["Normal"]
    style.font.name = "Times New Roman"
    style.font.size = Pt(12)
    doc.add_heading(title, level=0)

    def add_runs(paragraph: Any, nodes: list[dict[str, Any]]) -> None:
        for node in nodes:
            if node.get("type") == "text":
                run = paragraph.add_run(node.get("text", ""))
                marks = {m["type"] for m in node.get("marks") or []}
                run.bold = "bold" in marks
                run.italic = "italic" in marks
                run.underline = "underline" in marks
                run.font.strike = "strike" in marks
                run.font.superscript = "superscript" in marks
                run.font.subscript = "subscript" in marks
            elif node.get("type") == "citation":
                paragraph.add_run(next(citations, "[citation]"))
            elif node.get("type") == "hardBreak":
                paragraph.add_run().add_break()

    def block(node: dict[str, Any], list_style: str | None = None) -> None:
        kind = node.get("type")
        children = node.get("content") or []
        if kind == "heading":
            add_runs(doc.add_heading(level=(node.get("attrs") or {}).get("level", 2)), children)
        elif kind == "paragraph":
            add_runs(doc.add_paragraph(style=list_style) if list_style else doc.add_paragraph(), children)
        elif kind in {"bulletList", "orderedList"}:
            for item in children:
                for sub in item.get("content") or []:
                    block(sub, "List Bullet" if kind == "bulletList" else "List Number")
        elif kind == "blockquote":
            for sub in children:
                block(sub, "Quote")
        elif kind == "codeBlock":
            add_runs(doc.add_paragraph(), children)
        elif kind == "horizontalRule":
            doc.add_paragraph("―" * 20).alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif kind == "table":
            rows = [r for r in children if r.get("type") == "tableRow"]
            if not rows:
                return
            cols = max(len(r.get("content") or []) for r in rows)
            table = doc.add_table(rows=len(rows), cols=cols)
            table.style = "Table Grid"
            for r_index, row in enumerate(rows):
                for c_index, cell in enumerate(row.get("content") or []):
                    target = table.cell(r_index, c_index).paragraphs[0]
                    for para in cell.get("content") or []:
                        add_runs(target, para.get("content") or [])

    for node in content.get("content") or []:
        block(node)
    bibliography = rendered.get("bibliography") or []
    if bibliography:
        doc.add_heading("References", level=1)
        for entry in bibliography:
            paragraph = doc.add_paragraph(strip_html(entry))
            paragraph.paragraph_format.left_indent = Pt(24)
            paragraph.paragraph_format.first_line_indent = Pt(-24)
    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


# ------------------------------------------------------------------------------------------------------- PDF
_FONT_CANDIDATES = [
    (
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-BoldItalic.ttf",
    ),
    (
        "C:/Windows/Fonts/times.ttf",
        "C:/Windows/Fonts/timesbd.ttf",
        "C:/Windows/Fonts/timesi.ttf",
        "C:/Windows/Fonts/timesbi.ttf",
    ),
]


def _register_font(pdf: FPDF) -> str:
    for regular, bold, italic, bold_italic in _FONT_CANDIDATES:
        if all(Path(p).exists() for p in (regular, bold, italic, bold_italic)):
            pdf.add_font("Body", "", regular)
            pdf.add_font("Body", "B", bold)
            pdf.add_font("Body", "I", italic)
            pdf.add_font("Body", "BI", bold_italic)
            return "Body"
    raise UpstreamError("PDF export is unavailable: no Unicode font installed on the server.")


def to_pdf(title: str, content: dict[str, Any], rendered: dict[str, Any]) -> bytes:
    citations = iter(_cluster_texts(rendered))
    pdf = FPDF(format="A4")
    pdf.set_margins(22, 20, 22)
    pdf.set_auto_page_break(True, margin=20)
    font = _register_font(pdf)
    pdf.add_page()
    pdf.set_title(title)
    pdf.set_font(font, "B", 18)
    pdf.multi_cell(0, 9, title, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    def inline_markdown(nodes: list[dict[str, Any]]) -> str:
        out = []
        for node in nodes:
            if node.get("type") == "text":
                text = node.get("text", "").replace("\\", "\\\\").replace("**", "\\*\\*").replace("__", "\\_\\_")
                marks = {m["type"] for m in node.get("marks") or []}
                if "bold" in marks:
                    text = f"**{text}**"
                if "italic" in marks:
                    text = f"__{text}__"
                out.append(text)
            elif node.get("type") == "citation":
                out.append(next(citations, "[citation]"))
            elif node.get("type") == "hardBreak":
                out.append("\n")
        return "".join(out)

    def paragraph(text: str, size: int = 11, style: str = "", indent: float = 0, prefix: str = "") -> None:
        pdf.set_font(font, style, size)
        pdf.set_x(pdf.l_margin + indent)
        pdf.multi_cell(0, size * 0.55, prefix + text, markdown=True, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(size * 0.25)

    def block(node: dict[str, Any], indent: float = 0, bullet: str = "") -> None:
        kind = node.get("type")
        children = node.get("content") or []
        if kind == "heading":
            level = (node.get("attrs") or {}).get("level", 2)
            pdf.ln(2)
            paragraph(inline_markdown(children), size={1: 16, 2: 14, 3: 12}.get(level, 12), style="B")
        elif kind == "paragraph":
            paragraph(inline_markdown(children), indent=indent, prefix=bullet)
        elif kind in {"bulletList", "orderedList"}:
            for number, item in enumerate(children, start=1):
                marker = "• " if kind == "bulletList" else f"{number}. "
                for i, sub in enumerate(item.get("content") or []):
                    block(sub, indent + 6, marker if i == 0 else "   ")
        elif kind == "blockquote":
            for sub in children:
                block(sub, indent + 8)
        elif kind == "codeBlock":
            paragraph(inline_markdown(children), size=9, indent=indent)
        elif kind == "table":
            for row in children:
                cells = [
                    inline_markdown([t for p in cell.get("content") or [] for t in p.get("content") or []])
                    for cell in row.get("content") or []
                ]
                paragraph(" | ".join(cells), size=10)
        elif kind == "horizontalRule":
            pdf.ln(2)
            pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
            pdf.ln(4)

    for node in content.get("content") or []:
        block(node)
    bibliography = rendered.get("bibliography") or []
    if bibliography:
        pdf.ln(4)
        paragraph("References", size=14, style="B")
        for entry in bibliography:
            paragraph(strip_html(entry).replace("**", "\\*\\*"), size=10, indent=4)
    return bytes(pdf.output())
