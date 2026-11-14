"""DOCX and PDF export of research documents, with citations rendered in the document's CSL style.

Citations are attached by NODE IDENTITY, never by position: render_citations formats one entry per citation node
(walked by documents.citation_nodes), and the exporters look each node up in that mapping. A block an exporter
renders differently (or not at all) can therefore never shift a citation onto another claim.

Both exporters render every block the editor allows, at any depth (lists, quotes, code and nested tables inside
table cells). PDF export verifies, before drawing anything, that the installed fonts contain every character;
otherwise it refuses with a clear message instead of silently dropping text.
"""

from __future__ import annotations

import html
import io
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from docx import Document as DocxDocument
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt
from fontTools.ttLib import TTFont
from fpdf import FPDF

from app.errors import UpstreamError, ValidationFailed
from app.services.documents import citation_nodes

log = logging.getLogger(__name__)
_TAG = re.compile(r"<[^>]+>")
MISSING = "[missing source]"


def strip_html(value: str) -> str:
    return html.unescape(_TAG.sub("", value)).strip()


def citation_labels(content: dict[str, Any], rendered: dict[str, Any]) -> dict[int, str]:
    """id(citation node) -> formatted text. render_citations emits one cluster per node in citation_nodes order."""
    labels: dict[int, str] = {}
    for node, cluster in zip(citation_nodes(content), rendered.get("clusters", []), strict=False):
        text = strip_html(cluster["text"]) if cluster.get("text") else ""
        if not text:
            text = MISSING
        elif cluster.get("missing_ids"):
            text = f"{text} {MISSING}"
        labels[id(node)] = text
    return labels


def _marks(node: dict[str, Any]) -> set[str]:
    return {m.get("type") for m in node.get("marks") or [] if isinstance(m, dict)}


# ------------------------------------------------------------------------------------------------------ DOCX
def to_docx(title: str, content: dict[str, Any], rendered: dict[str, Any]) -> bytes:
    labels = citation_labels(content, rendered)
    doc = DocxDocument()
    style = doc.styles["Normal"]
    style.font.name = "Times New Roman"
    style.font.size = Pt(12)
    doc.add_heading(title, level=0)
    fresh_cells: set[int] = set()  # cells whose built-in empty first paragraph is still unused

    def new_paragraph(container: Any, style_name: str | None = None) -> Any:
        if id(container) in fresh_cells:
            fresh_cells.discard(id(container))
            paragraph = container.paragraphs[0]
            if style_name:
                paragraph.style = doc.styles[style_name]
            return paragraph
        return container.add_paragraph(style=style_name) if style_name else container.add_paragraph()

    def add_runs(paragraph: Any, nodes: list[dict[str, Any]]) -> None:
        for node in nodes:
            kind = node.get("type")
            if kind == "text":
                run = paragraph.add_run(node.get("text", ""))
                marks = _marks(node)
                run.bold = "bold" in marks
                run.italic = "italic" in marks
                run.underline = "underline" in marks
                run.font.strike = "strike" in marks
                run.font.superscript = "superscript" in marks
                run.font.subscript = "subscript" in marks
            elif kind == "citation":
                paragraph.add_run(labels.get(id(node), MISSING))
            elif kind == "hardBreak":
                paragraph.add_run().add_break()

    def block(node: dict[str, Any], container: Any, list_style: str | None = None) -> None:
        kind = node.get("type")
        children = node.get("content") or []
        if kind == "heading":
            level = min(max(int((node.get("attrs") or {}).get("level", 2)), 1), 4)
            add_runs(new_paragraph(container, f"Heading {level}"), children)
        elif kind in {"paragraph", "codeBlock"}:
            add_runs(new_paragraph(container, list_style), children)
        elif kind in {"bulletList", "orderedList"}:
            for item in children:
                for sub in item.get("content") or []:
                    block(sub, container, "List Bullet" if kind == "bulletList" else "List Number")
        elif kind == "blockquote":
            for sub in children:
                block(sub, container, list_style or "Quote")
        elif kind == "horizontalRule":
            new_paragraph(container).add_run("―" * 20)
            container.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif kind == "table":
            rows = [r for r in children if r.get("type") == "tableRow"]
            if not rows:
                return
            cols = max(len(r.get("content") or []) for r in rows) or 1
            fresh_cells.discard(id(container))
            table = container.add_table(rows=len(rows), cols=cols)
            table.style = "Table Grid"
            for r_index, row in enumerate(rows):
                for c_index, cell in enumerate(row.get("content") or []):
                    target = table.cell(r_index, c_index)
                    fresh_cells.add(id(target))
                    for sub in cell.get("content") or []:
                        block(sub, target)

    for node in content.get("content") or []:
        block(node, doc)
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
_FONT_DIRS = ["/usr/share/fonts/truetype/dejavu", "C:/Windows/Fonts"]
# (regular, bold, italic, bold italic) per family; missing italics fall back to the upright face.
_FAMILIES = [
    ("DejaVuSerif.ttf", "DejaVuSerif-Bold.ttf", "DejaVuSerif-Italic.ttf", "DejaVuSerif-BoldItalic.ttf"),
    ("times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"),
]
# Extra scripts (Arabic, Hebrew, Greek, Cyrillic, ...) when the body font lacks a glyph.
_FALLBACKS = ["DejaVuSans.ttf", "arial.ttf"]


def _find(name: str) -> str | None:
    for directory in _FONT_DIRS:
        path = Path(directory) / name
        if path.exists():
            return str(path)
    return None


@lru_cache(maxsize=1)
def _font_plan() -> tuple[dict[str, str], list[str], frozenset[int]]:
    """Resolve installed fonts once: style -> file, fallback files, and every code point they can draw."""
    for regular, bold, italic, bold_italic in _FAMILIES:
        base = _find(regular)
        if not base:
            continue
        bold_path = _find(bold) or base
        styles = {
            "": base,
            "B": bold_path,
            "I": _find(italic) or base,
            "BI": _find(bold_italic) or bold_path,
        }
        fallbacks = [path for name in _FALLBACKS if (path := _find(name))]
        covered: set[int] = set()
        for path in {*styles.values(), *fallbacks}:
            with TTFont(path, lazy=True) as font:
                covered.update(font.getBestCmap() or {})
        return styles, fallbacks, frozenset(covered)
    raise UpstreamError("PDF export is unavailable: no Unicode font is installed on the server.")


def _check_coverage(texts: list[str]) -> None:
    _, _, covered = _font_plan()
    missing = sorted(
        {ch for text in texts for ch in text if not ch.isspace() and ord(ch) >= 32 and ord(ch) not in covered}
    )
    if missing:
        sample = " ".join(missing[:8])
        raise ValidationFailed(
            f"PDF export cannot draw some characters in this document ({sample}), for example Chinese or Japanese "
            "script. Export to Word (.docx) instead, which supports every language.",
            code="PDF_UNSUPPORTED_CHARACTERS",
        )


def _all_text(content: dict[str, Any], labels: dict[int, str]) -> list[str]:
    out: list[str] = []

    def walk(node: dict[str, Any]) -> None:
        if node.get("type") == "text":
            out.append(node.get("text", ""))
        elif node.get("type") == "citation":
            out.append(labels.get(id(node), MISSING))
        for child in node.get("content") or []:
            walk(child)

    walk(content)
    return out


def to_pdf(title: str, content: dict[str, Any], rendered: dict[str, Any]) -> bytes:
    labels = citation_labels(content, rendered)
    bibliography = [strip_html(entry) for entry in rendered.get("bibliography") or []]
    _check_coverage([title, *_all_text(content, labels), *bibliography])
    styles, fallbacks, _ = _font_plan()

    pdf = FPDF(format="A4")
    pdf.set_margins(22, 20, 22)
    pdf.set_auto_page_break(True, margin=20)
    for style, path in styles.items():
        pdf.add_font("Body", style, path)
    names = []
    for index, path in enumerate(fallbacks):
        pdf.add_font(f"Fallback{index}", "", path)
        names.append(f"Fallback{index}")
    if names:
        pdf.set_fallback_fonts(names, exact_match=False)
    try:
        pdf.set_text_shaping(True)  # correct joining and right-to-left order (Arabic, Hebrew, ...)
    except Exception:  # shaping engine unavailable: Latin, Greek and Cyrillic still render correctly
        log.warning("export.text_shaping_unavailable", exc_info=True)
    pdf.add_page()
    pdf.set_title(title)
    pdf.set_font("Body", "B", 18)
    pdf.multi_cell(0, 9, title, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    def escape(text: str) -> str:
        return text.replace("\\", "\\\\").replace("**", "\\*\\*").replace("__", "\\_\\_")

    def inline_markdown(nodes: list[dict[str, Any]]) -> str:
        out = []
        for node in nodes:
            kind = node.get("type")
            if kind == "text":
                text = escape(node.get("text", ""))
                marks = _marks(node)
                if "bold" in marks:
                    text = f"**{text}**"
                if "italic" in marks:
                    text = f"__{text}__"
                out.append(text)
            elif kind == "citation":
                out.append(escape(labels.get(id(node), MISSING)))
            elif kind == "hardBreak":
                out.append("\n")
        return "".join(out)

    def flatten(node: dict[str, Any]) -> str:
        """All inline content of a block subtree (used for table cells), citations included."""
        if node.get("type") in {"paragraph", "heading", "codeBlock"}:
            return inline_markdown(node.get("content") or [])
        parts = [flatten(child) for child in node.get("content") or []]
        separator = "; " if node.get("type") in {"bulletList", "orderedList", "tableRow"} else " "
        return separator.join(p for p in parts if p)

    def paragraph(text: str, size: int = 11, style: str = "", indent: float = 0, prefix: str = "") -> None:
        pdf.set_font("Body", style, size)
        pdf.set_x(pdf.l_margin + indent)
        pdf.multi_cell(0, size * 0.55, prefix + text, markdown=True, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(size * 0.25)

    def block(node: dict[str, Any], indent: float = 0, bullet: str = "") -> None:
        kind = node.get("type")
        children = node.get("content") or []
        if kind == "heading":
            level = (node.get("attrs") or {}).get("level", 2)
            pdf.ln(2)
            paragraph(inline_markdown(children), size={1: 16, 2: 14, 3: 12}.get(level, 12), style="B", indent=indent)
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
                cells = [flatten(cell) for cell in row.get("content") or []]
                paragraph(" | ".join(cells), size=10, indent=indent)
        elif kind == "horizontalRule":
            pdf.ln(2)
            pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
            pdf.ln(4)

    for node in content.get("content") or []:
        block(node)
    if bibliography:
        pdf.ln(4)
        paragraph("References", size=14, style="B")
        for entry in bibliography:
            paragraph(escape(entry), size=10, indent=4)
    return bytes(pdf.output())
