"""Parsing and normalisation of scholarly identifiers (DOI, PMID, PMCID, arXiv)."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal
from urllib.parse import unquote

IdentifierKind = Literal["doi", "pmid", "pmcid", "arxiv"]

_DOI_RE = re.compile(r"(10\.\d{4,9}/[^\s\"<>]+)", re.IGNORECASE)
# Prefixes as people type them: "PMID: 1", "PMID 1", "pmid#1", "PMCID PMC1", "arXiv 1706.03762".
_SEP = r"[\s:#=\-]*"
_PMCID_RE = re.compile(rf"^(?:pmcid{_SEP})?(PMC)\s*(\d{{4,10}})$", re.IGNORECASE)
_PMID_RE = re.compile(rf"^(?:pmid{_SEP})?(\d{{1,9}})$", re.IGNORECASE)
_ARXIV_NEW_RE = re.compile(rf"^(?:arxiv{_SEP})?(\d{{4}}\.\d{{4,5}})(v\d+)?$", re.IGNORECASE)
_ARXIV_OLD_RE = re.compile(rf"^(?:arxiv{_SEP})?([a-z\-]+(?:\.[A-Z]{{2}})?/\d{{7}})(v\d+)?$", re.IGNORECASE)
_ARXIV_URL_RE = re.compile(r"arxiv\.org/(?:abs|pdf)/([^\s?#]+?)(?:v\d+)?(?:\.pdf)?(?:[?#].*)?$", re.IGNORECASE)
_PUBMED_URL_RE = re.compile(
    r"(?:pubmed\.ncbi\.nlm\.nih\.gov/|europepmc\.org/(?:abstract|article)/MED/)(\d{1,9})", re.IGNORECASE
)
_PMC_URL_RE = re.compile(
    r"(?:/pmc/articles/|pmc\.ncbi\.nlm\.nih\.gov/articles/|europepmc\.org/articles?/(?:PMC/)?)(PMC\d+)", re.IGNORECASE
)


@dataclass(frozen=True)
class Identifier:
    kind: IdentifierKind
    value: str


def normalize_doi(raw: str | None) -> str | None:
    if not raw:
        return None
    text = unquote(raw.strip())
    match = _DOI_RE.search(text)
    if not match:
        return None
    return _trim_doi(match.group(1)).lower()


_CLOSERS = {")": "(", "]": "[", "}": "{"}


def _trim_doi(doi: str) -> str:
    """Remove punctuation that belongs to the surrounding prose, keeping a balanced closing bracket that is part of
    the DOI: "10.1234/example(2020)" stays whole, "(see 10.1234/abc)." loses ")." (audit F12)."""
    while doi:
        last = doi[-1]
        if last in ".,;:'\">":
            doi = doi[:-1]
        elif last in _CLOSERS and doi.count(_CLOSERS[last]) < doi.count(last):
            doi = doi[:-1]  # more closers than openers: the bracket wraps the DOI, it is not part of it
        else:
            return doi
    return doi


def normalize_pmcid(raw: str | None) -> str | None:
    if not raw:
        return None
    match = _PMCID_RE.match(raw.strip())
    return f"PMC{match.group(2)}" if match else None


def normalize_arxiv(raw: str | None) -> str | None:
    if not raw:
        return None
    text = raw.strip()
    for regex in (_ARXIV_NEW_RE, _ARXIV_OLD_RE):
        match = regex.match(text)
        if match:
            return match.group(1)
    url_match = _ARXIV_URL_RE.search(text)
    return url_match.group(1) if url_match else None


def parse_identifier(raw: str) -> Identifier | None:
    """Detect the identifier type from free text such as '10.1/x', 'https://doi.org/..', 'PMC123', '2301.00001'."""
    text = raw.strip()
    if not text:
        return None
    if pmc_url := _PMC_URL_RE.search(text):
        return Identifier("pmcid", pmc_url.group(1).upper())
    if pubmed_url := _PUBMED_URL_RE.search(text):
        return Identifier("pmid", pubmed_url.group(1))
    if "arxiv" in text.lower() or _ARXIV_NEW_RE.match(text) or _ARXIV_OLD_RE.match(text):
        if arxiv := normalize_arxiv(text):
            return Identifier("arxiv", arxiv)
    if doi := normalize_doi(text):
        return Identifier("doi", doi)
    if pmcid := normalize_pmcid(text):
        return Identifier("pmcid", pmcid)
    if pmid := _PMID_RE.match(text):
        return Identifier("pmid", pmid.group(1))
    return None


_WS = re.compile(r"\s+")
_NON_WORD = re.compile(r"[\W_]+")


def normalize_title(title: str | None) -> str:
    """Case/diacritic/punctuation-insensitive form that keeps letters of every script (Chinese, Arabic, ...)."""
    if not title:
        return ""
    decomposed = unicodedata.normalize("NFKD", title.casefold())
    without_marks = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return _WS.sub(" ", _NON_WORD.sub(" ", without_marks)).strip()


_BARE_DIGITS = re.compile(r"^\d+$")
MIN_BARE_PMID_DIGITS = 6


_LABEL = re.compile(r"^(?:doi|pmid|pmcid|arxiv)\s*[:#=]?\s*", re.IGNORECASE)
_DOI_ONLY = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/)?10\.\d{4,9}/\S+$", re.IGNORECASE)
_QUOTES = "\"'" + "".join(map(chr, (0x201C, 0x201D, 0x2018, 0x2019)))  # straight and curly quotes
_WRAPS = {"(": ")", "[": "]", "<": ">", "{": "}"}


def exact_identifier(text: str) -> Identifier | None:
    """An identifier typed into a SEARCH box, to be looked up exactly rather than searched as words.

    The whole input must be the identifier (audit SF12): optionally labelled ("doi:", "PMID", "arXiv:"), written as
    its doi.org / PubMed / PMC / arXiv link, or wrapped in quotes, brackets or trailing punctuation. A question that
    merely mentions a DOI stays a keyword search. A bare number counts as a PubMed ID only with six or more digits,
    so a year ("2019") or a small number is still searched as a word. parse_identifier, which extracts identifiers
    from free text (imports, reference lists), is unchanged."""
    core = text.strip().strip(_QUOTES).rstrip(".,;").strip()
    if len(core) > 1 and _WRAPS.get(core[0]) == core[-1]:
        core = core[1:-1].strip()
    bare = _LABEL.sub("", core, count=1)
    if not bare or any(ch.isspace() for ch in bare):
        return None  # several words: a topic or a question, not an identifier
    identifier = parse_identifier(core)
    if identifier is None:
        return None
    if identifier.kind == "doi" and not _DOI_ONLY.match(unquote(bare)):
        return None  # a DOI inside a longer token is not the whole input
    if identifier.kind == "pmid" and _BARE_DIGITS.match(bare) and len(bare) < MIN_BARE_PMID_DIGITS:
        return None
    return identifier
