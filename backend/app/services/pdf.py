"""PDF text extraction (page-aware), section detection and chunking for retrieval."""

from __future__ import annotations

import io
import re
from dataclasses import dataclass

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from app.errors import ValidationFailed

MAX_PAGES = 400
CHUNK_TARGET_CHARS = 1400
CHUNK_OVERLAP_CHARS = 200
MIN_TEXT_CHARS = 200

_SECTION_NAMES = {
    "abstract": "Abstract",
    "introduction": "Introduction",
    "background": "Background",
    "related work": "Related Work",
    "literature review": "Literature Review",
    "methods": "Methods",
    "methodology": "Methods",
    "materials and methods": "Methods",
    "patients and methods": "Methods",
    "study design": "Methods",
    "experiments": "Experiments",
    "experimental setup": "Experiments",
    "results": "Results",
    "findings": "Results",
    "results and discussion": "Results and Discussion",
    "discussion": "Discussion",
    "limitations": "Limitations",
    "conclusion": "Conclusion",
    "conclusions": "Conclusion",
    "acknowledgements": "Acknowledgements",
    "acknowledgments": "Acknowledgements",
    "references": "References",
    "bibliography": "References",
    "appendix": "Appendix",
    "supplementary material": "Appendix",
}
_HEADING = re.compile(r"^\s*(?:\d{1,2}(?:\.\d{1,2})*\.?\s+|[IVX]{1,4}\.\s+)?([A-Za-z][A-Za-z &]{2,40}?)\s*:?\s*$")
_HYPHEN_BREAK = re.compile(r"(\w)-\n(\w)")
_MULTISPACE = re.compile(r"[ \t]+")
NON_EVIDENCE_SECTIONS = {"References", "Acknowledgements"}


@dataclass
class PageText:
    number: int  # 1-based
    text: str


@dataclass
class Chunk:
    index: int
    text: str
    section: str | None
    page_start: int
    page_end: int

    @property
    def token_estimate(self) -> int:
        return max(1, len(self.text) // 4)


def extract_pages(data: bytes) -> list[PageText]:
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as exc:
                raise ValidationFailed("This PDF is password-protected and cannot be processed.") from exc
        if len(reader.pages) > MAX_PAGES:
            raise ValidationFailed(f"PDFs longer than {MAX_PAGES} pages are not supported.")
        pages = []
        for number, page in enumerate(reader.pages, start=1):
            raw = page.extract_text() or ""
            text = _HYPHEN_BREAK.sub(r"\1\2", raw)
            text = _MULTISPACE.sub(" ", text).replace("\x00", "").strip()
            pages.append(PageText(number=number, text=text))
    except PdfReadError as exc:
        raise ValidationFailed("The file is not a readable PDF.") from exc
    total = sum(len(p.text) for p in pages)
    if total < MIN_TEXT_CHARS:
        raise ValidationFailed(
            "No extractable text was found. The PDF is probably a scanned image (OCR is not supported yet)."
        )
    return pages


def detect_heading(line: str) -> str | None:
    if len(line) > 60:
        return None
    match = _HEADING.match(line)
    if not match:
        return None
    return _SECTION_NAMES.get(match.group(1).strip().lower())


def chunk_pages(pages: list[PageText]) -> list[Chunk]:
    """Split text into ~1.4k-char chunks on paragraph/sentence boundaries, tracking section and page span."""
    chunks: list[Chunk] = []
    section: str | None = None
    buffer = ""
    buf_section: str | None = None
    buf_start = 1
    buf_end = 1

    def flush() -> None:
        nonlocal buffer
        text = buffer.strip()
        if len(text) >= 40:
            chunks.append(Chunk(len(chunks), text, buf_section, buf_start, buf_end))
        buffer = ""

    for page in pages:
        for line in page.text.split("\n"):
            stripped = line.strip()
            if not stripped:
                continue
            heading = detect_heading(stripped)
            if heading:
                if buffer:
                    flush()
                section = heading
                buf_section, buf_start, buf_end = section, page.number, page.number
                continue
            if not buffer:
                buf_section, buf_start = section, page.number
            buffer = f"{buffer} {stripped}" if buffer else stripped
            buf_end = page.number
            if len(buffer) >= CHUNK_TARGET_CHARS:
                cut = max(buffer.rfind(". ", 0, CHUNK_TARGET_CHARS + 200), CHUNK_TARGET_CHARS // 2)
                head, tail = buffer[: cut + 1], buffer[cut + 1 :]
                overlap = head[-CHUNK_OVERLAP_CHARS:]
                buffer = head
                flush()
                buffer = (overlap.split(" ", 1)[-1] + " " + tail).strip()
                buf_section, buf_start = section, page.number
    if buffer:
        flush()
    return chunks
