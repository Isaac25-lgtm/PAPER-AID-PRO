"""Manually entered sources: books, chapters, reports, theses, court cases, statutes, web pages, datasets,
interviews and anything else without a registry identifier.

These records are PRIVATE to the person who enters them and labelled "user-supplied" (metadata_source="user"):
they never enter the shared catalog, so the distinction between registry-verified and user-typed metadata is
kept everywhere. An ISBN can pre-fill a book from Open Library; the person still reviews and saves it.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.services.scholarly.http import get_json
from app.services.scholarly.models import ScholarlyWork, WorkAuthor, clean_text, split_name

ManualType = Literal[
    "book",
    "chapter",
    "article-journal",
    "article-newspaper",
    "report",
    "thesis",
    "paper-conference",
    "webpage",
    "legal_case",
    "legislation",
    "dataset",
    "interview",
    "manuscript",
]

MANUAL_TYPE_LABELS: dict[str, str] = {
    "book": "Book",
    "chapter": "Book chapter",
    "article-journal": "Journal article",
    "article-newspaper": "Newspaper or magazine article",
    "report": "Report or policy document",
    "thesis": "Thesis or dissertation",
    "paper-conference": "Conference paper",
    "webpage": "Web page",
    "legal_case": "Court case",
    "legislation": "Statute or legislation",
    "dataset": "Dataset",
    "interview": "Interview",
    "manuscript": "Unpublished manuscript or archive item",
}

# CSL fields stored in papers.csl_extra (everything not covered by a regular column).
EXTRA_FIELDS = (
    "edition",
    "publisher-place",
    "ISBN",
    "accessed",
    "authority",
    "number",
    "genre",
    "medium",
    "event-title",
    "container-title-short",
    "editor",
    "interviewer",
    "archive",
    "archive_location",
    "section",
)
_ISBN = re.compile(r"^(97[89])?\d{9}[\dX]$")


class PersonIn(BaseModel):
    family: str | None = Field(default=None, max_length=200)
    given: str | None = Field(default=None, max_length=200)
    literal: str | None = Field(default=None, max_length=300, description="Organisation or single-name author")

    @property
    def display(self) -> str:
        return self.literal or " ".join(p for p in (self.given, self.family) if p)


class ManualSourceIn(BaseModel):
    type: ManualType
    title: str = Field(min_length=1, max_length=1000)
    authors: list[PersonIn] = Field(default_factory=list, max_length=100)
    editors: list[PersonIn] = Field(default_factory=list, max_length=50)
    interviewer: list[PersonIn] = Field(default_factory=list, max_length=10)
    year: int | None = Field(default=None, ge=1000, le=2100)
    month: int | None = Field(default=None, ge=1, le=12)
    day: int | None = Field(default=None, ge=1, le=31)
    container_title: str | None = Field(default=None, max_length=1000, description="Book, journal, site or newspaper")
    publisher: str | None = Field(default=None, max_length=500)
    place: str | None = Field(default=None, max_length=300)
    edition: str | None = Field(default=None, max_length=50)
    volume: str | None = Field(default=None, max_length=50)
    issue: str | None = Field(default=None, max_length=50)
    pages: str | None = Field(default=None, max_length=50)
    url: str | None = Field(default=None, max_length=2000)
    isbn: str | None = Field(default=None, max_length=20)
    accessed: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$", description="YYYY-MM-DD")
    authority: str | None = Field(default=None, max_length=300, description="Court or legislative body")
    number: str | None = Field(default=None, max_length=100, description="Case number, report number, act number")
    genre: str | None = Field(default=None, max_length=200, description="e.g. PhD thesis, Policy brief")
    archive: str | None = Field(default=None, max_length=300)
    archive_location: str | None = Field(default=None, max_length=300)

    @field_validator("isbn")
    @classmethod
    def _isbn(cls, value: str | None) -> str | None:
        if not value:
            return None
        digits = re.sub(r"[^0-9Xx]", "", value).upper()
        if not _ISBN.match(digits):
            raise ValueError("Enter a 10- or 13-digit ISBN.")
        return digits

    @field_validator("url")
    @classmethod
    def _url(cls, value: str | None) -> str | None:
        if value and not re.match(r"^https?://", value, re.IGNORECASE):
            raise ValueError("Links must start with http:// or https://")
        return value or None


def _person_csl(person: PersonIn) -> dict[str, str]:
    if person.literal:
        return {"literal": person.literal}
    return {k: v for k, v in {"family": person.family, "given": person.given}.items() if v}


def to_work(body: ManualSourceIn) -> tuple[ScholarlyWork, dict[str, Any]]:
    """The regular columns (as a ScholarlyWork) plus the CSL extras for papers.csl_extra."""
    authors = [
        WorkAuthor(name=a.display, family=a.family or None, given=a.given or None) for a in body.authors if a.display
    ]
    work = ScholarlyWork(
        title=body.title.strip(),
        authors=authors,
        year=body.year,
        journal=(body.container_title or "").strip() or None,
        publisher=(body.publisher or "").strip() or None,
        volume=body.volume,
        issue=body.issue,
        pages=body.pages,
        work_type=body.type,
        url=body.url,
        doi=None,  # a DOI belongs in "import by identifier" (registry-verified), never in a typed record
    )
    extra: dict[str, Any] = {
        "edition": body.edition,
        "publisher-place": body.place,
        "ISBN": body.isbn,
        "authority": body.authority,
        "number": body.number,
        "genre": body.genre,
        "archive": body.archive,
        "archive_location": body.archive_location,
    }
    if body.accessed:
        y, m, d = (int(x) for x in body.accessed.split("-"))
        extra["accessed"] = {"date-parts": [[y, m, d]]}
    if body.editors:
        extra["editor"] = [_person_csl(e) for e in body.editors if e.display]
    if body.interviewer:
        extra["interviewer"] = [_person_csl(e) for e in body.interviewer if e.display]
    if body.year and body.month:
        extra["issued"] = {"date-parts": [[body.year, body.month, *([body.day] if body.day else [])]]}
    return work, {k: v for k, v in extra.items() if v}


async def lookup_isbn(isbn: str) -> dict[str, Any] | None:
    """Pre-fill a book from Open Library. Returns form fields (the person reviews them) or None."""
    data = await get_json(
        "https://openlibrary.org/api/books",
        params={"bibkeys": f"ISBN:{isbn}", "format": "json", "jscmd": "data"},
        retries=1,
    )
    record = (data or {}).get(f"ISBN:{isbn}")
    if not record or not record.get("title"):
        return None
    year_match = re.search(r"\b(1[5-9]\d\d|20\d\d)\b", record.get("publish_date") or "")
    title = clean_text(record["title"]) or ""
    if record.get("subtitle"):
        title = f"{title}: {clean_text(record['subtitle'])}"
    authors = []
    for author in record.get("authors") or []:
        if author.get("name"):
            parsed = split_name(author["name"])
            authors.append(
                {"family": parsed.family, "given": parsed.given} if parsed.family else {"literal": author["name"]}
            )
    return {
        "type": "book",
        "title": title,
        "authors": authors,
        "year": int(year_match.group(1)) if year_match else None,
        "publisher": ((record.get("publishers") or [{}])[0] or {}).get("name"),
        "place": ((record.get("publish_places") or [{}])[0] or {}).get("name"),
        "isbn": isbn,
        "source": "Open Library",
    }
