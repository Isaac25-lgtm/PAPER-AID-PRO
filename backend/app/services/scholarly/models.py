"""Provider-neutral representation of a scholarly work."""

from __future__ import annotations

import re
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

ProviderName = Literal["crossref", "pubmed", "semantic_scholar", "openalex", "arxiv", "doaj", "europe_pmc", "core"]
ALL_PROVIDERS: tuple[ProviderName, ...] = (
    "openalex",
    "crossref",
    "semantic_scholar",
    "doaj",
    "core",
    "pubmed",
    "europe_pmc",
    "arxiv",
)
Subject = Literal["all", "health", "life", "physical", "social", "humanities"]
SUBJECTS: tuple[Subject, ...] = ("all", "health", "life", "physical", "social", "humanities")


class WorkAuthor(BaseModel):
    name: str
    family: str | None = None
    given: str | None = None
    orcid: str | None = None


class ScholarlyWork(BaseModel):
    title: str
    abstract: str | None = None
    authors: list[WorkAuthor] = Field(default_factory=list)
    year: int | None = None
    publication_date: date | None = None
    journal: str | None = None
    publisher: str | None = None
    volume: str | None = None
    issue: str | None = None
    pages: str | None = None
    work_type: str = "article-journal"
    url: str | None = None
    doi: str | None = None
    pmid: str | None = None
    pmcid: str | None = None
    arxiv_id: str | None = None
    s2_id: str | None = None
    openalex_id: str | None = None
    is_open_access: bool = False
    oa_pdf_url: str | None = None
    oa_license: str | None = None
    citation_count: int = 0
    keywords: list[str] = Field(default_factory=list)
    sources: list[ProviderName] = Field(default_factory=list)


class ProviderStatus(BaseModel):
    provider: ProviderName
    ok: bool
    count: int = 0
    error: str | None = None


_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")


def clean_text(value: str | None) -> str | None:
    """Strip JATS/HTML markup and collapse whitespace."""
    if not value:
        return None
    text = _SPACE.sub(" ", _TAG.sub(" ", value)).strip()
    for prefix in ("Abstract ", "ABSTRACT "):
        if text.startswith(prefix):
            text = text[len(prefix) :]
    return text or None


def split_name(full: str) -> WorkAuthor:
    full = _SPACE.sub(" ", full).strip()
    if "," in full:
        family, given = (p.strip() for p in full.split(",", 1))
        return WorkAuthor(name=f"{given} {family}".strip(), family=family or None, given=given or None)
    parts = full.split(" ")
    if len(parts) == 1:
        return WorkAuthor(name=full, family=full)
    return WorkAuthor(name=full, family=parts[-1], given=" ".join(parts[:-1]))
