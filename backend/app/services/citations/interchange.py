"""BibTeX / RIS import and export (CSL-JSON in the middle)."""

from __future__ import annotations

import re
from typing import Any

import bibtexparser
from bibtexparser.bparser import BibTexParser
from bibtexparser.customization import convert_to_unicode

from app.errors import ValidationFailed
from app.services.scholarly.identifiers import normalize_arxiv, normalize_doi
from app.services.scholarly.models import ScholarlyWork, WorkAuthor, clean_text, split_name

_BIBTEX_TYPES = {
    "article-journal": "article",
    "paper-conference": "inproceedings",
    "chapter": "incollection",
    "book": "book",
    "thesis": "phdthesis",
    "report": "techreport",
    "article": "misc",
    "dataset": "misc",
}
_RIS_TYPES = {
    "article-journal": "JOUR",
    "paper-conference": "CONF",
    "chapter": "CHAP",
    "book": "BOOK",
    "thesis": "THES",
    "report": "RPRT",
    "article": "JOUR",
    "dataset": "DATA",
}
_FROM_BIBTEX = {
    "article": "article-journal",
    "inproceedings": "paper-conference",
    "conference": "paper-conference",
    "incollection": "chapter",
    "inbook": "chapter",
    "book": "book",
    "phdthesis": "thesis",
    "mastersthesis": "thesis",
    "techreport": "report",
}
_FROM_RIS = {
    "JOUR": "article-journal",
    "JFULL": "article-journal",
    "CONF": "paper-conference",
    "CPAPER": "paper-conference",
    "CHAP": "chapter",
    "BOOK": "book",
    "THES": "thesis",
    "RPRT": "report",
}

MAX_IMPORT_ENTRIES = 500


def _bibtex_escape(value: str) -> str:
    return re.sub(r"([{}%&$#_])", r"\\\1", value)


def _cite_key(item: dict[str, Any], used: set[str]) -> str:
    authors = item.get("author") or [{}]
    family = authors[0].get("family") or authors[0].get("literal") or "anon"
    year = ((item.get("issued") or {}).get("date-parts") or [[None]])[0][0] or "nd"
    word = next((w for w in re.findall(r"[A-Za-z]{4,}", item.get("title", ""))), "work")
    base = re.sub(r"[^A-Za-z0-9]", "", f"{family}{year}{word}".lower()) or "ref"
    key, n = base, 1
    while key in used:
        n += 1
        key = f"{base}{chr(96 + n)}" if n < 27 else f"{base}{n}"
    used.add(key)
    return key


def to_bibtex(items: list[dict[str, Any]]) -> str:
    used: set[str] = set()
    out = []
    for item in items:
        fields: dict[str, str] = {"title": item.get("title", "")}
        names = []
        for a in item.get("author") or []:
            names.append(
                f"{a['family']}, {a.get('given', '')}".strip(", ") if a.get("family") else a.get("literal", "")
            )
        if names:
            fields["author"] = " and ".join(names)
        parts = ((item.get("issued") or {}).get("date-parts") or [[None]])[0]
        if parts and parts[0]:
            fields["year"] = str(parts[0])
        entry_type = _BIBTEX_TYPES.get(item.get("type", ""), "misc")
        container_field = "booktitle" if entry_type in {"inproceedings", "incollection"} else "journal"
        for csl_key, bib_key in (
            ("container-title", container_field),
            ("volume", "volume"),
            ("issue", "number"),
            ("page", "pages"),
            ("publisher", "publisher"),
            ("DOI", "doi"),
            ("URL", "url"),
            ("PMID", "pmid"),
        ):
            if item.get(csl_key):
                fields[bib_key] = str(item[csl_key]).replace("-", "--") if bib_key == "pages" else str(item[csl_key])
        body = ",\n".join(
            f"  {k} = {{{_bibtex_escape(v) if k not in {'url', 'doi'} else v}}}" for k, v in fields.items() if v
        )
        out.append(f"@{entry_type}{{{_cite_key(item, used)},\n{body}\n}}")
    return "\n\n".join(out) + "\n"


def to_ris(items: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for item in items:
        lines.append(f"TY  - {_RIS_TYPES.get(item.get('type', ''), 'GEN')}")
        lines.append(f"TI  - {item.get('title', '')}")
        for a in item.get("author") or []:
            lines.append(
                f"AU  - {a['family']}, {a.get('given', '')}".rstrip(", ")
                if a.get("family")
                else f"AU  - {a.get('literal', '')}"
            )
        parts = ((item.get("issued") or {}).get("date-parts") or [[None]])[0]
        if parts and parts[0]:
            lines.append(f"PY  - {parts[0]}")
        for csl_key, tag in (
            ("container-title", "JO"),
            ("volume", "VL"),
            ("issue", "IS"),
            ("publisher", "PB"),
            ("DOI", "DO"),
            ("URL", "UR"),
        ):
            if item.get(csl_key):
                lines.append(f"{tag}  - {item[csl_key]}")
        if item.get("page"):
            start, _, end = str(item["page"]).partition("-")
            lines.append(f"SP  - {start}")
            if end:
                lines.append(f"EP  - {end}")
        lines.append("ER  - ")
        lines.append("")
    return "\n".join(lines)


def _year(value: str | None) -> int | None:
    match = re.search(r"(1[5-9]\d\d|20\d\d)", value or "")
    return int(match.group(1)) if match else None


def parse_bibtex(text: str) -> list[ScholarlyWork]:
    parser = BibTexParser(common_strings=True)
    parser.customization = convert_to_unicode
    parser.ignore_nonstandard_types = False
    try:
        database = bibtexparser.loads(text, parser=parser)
    except Exception as exc:
        raise ValidationFailed("The BibTeX file could not be parsed.") from exc
    works = []
    for entry in database.entries[:MAX_IMPORT_ENTRIES]:
        title = clean_text((entry.get("title") or "").replace("{", "").replace("}", ""))
        if not title:
            continue
        authors = [split_name(a.strip()) for a in re.split(r"\s+and\s+", entry.get("author", "")) if a.strip()]
        works.append(
            ScholarlyWork(
                title=title,
                authors=authors,
                year=_year(entry.get("year")),
                journal=entry.get("journal") or entry.get("booktitle"),
                publisher=entry.get("publisher"),
                volume=entry.get("volume"),
                issue=entry.get("number"),
                pages=(entry.get("pages") or "").replace("--", "-") or None,
                work_type=_FROM_BIBTEX.get(entry.get("ENTRYTYPE", "").lower(), "article-journal"),
                url=entry.get("url"),
                doi=normalize_doi(entry.get("doi")),
                pmid=entry.get("pmid"),
                arxiv_id=normalize_arxiv(entry.get("eprint"))
                if (entry.get("archiveprefix") or "").lower() == "arxiv"
                else None,
                abstract=clean_text(entry.get("abstract")),
            )
        )
    return works


def parse_ris(text: str) -> list[ScholarlyWork]:
    works: list[ScholarlyWork] = []
    record: dict[str, list[str]] = {}
    for line in text.splitlines():
        match = re.match(r"^([A-Z][A-Z0-9])  - ?(.*)$", line)
        if not match:
            continue
        tag, value = match.group(1), match.group(2).strip()
        if tag == "ER":
            if record:
                works.append(_ris_record(record))
            record = {}
            if len(works) >= MAX_IMPORT_ENTRIES:
                break
            continue
        record.setdefault(tag, []).append(value)
    if record:
        works.append(_ris_record(record))
    return [w for w in works if w.title]


def _ris_record(r: dict[str, list[str]]) -> ScholarlyWork:
    first = lambda *tags: next((r[t][0] for t in tags if r.get(t) and r[t][0]), None)  # noqa: E731
    authors: list[WorkAuthor] = [split_name(a) for t in ("AU", "A1") for a in r.get(t, []) if a]
    start, end = first("SP"), first("EP")
    return ScholarlyWork(
        title=clean_text(first("TI", "T1")) or "",
        authors=authors,
        year=_year(first("PY", "Y1", "DA")),
        journal=first("JO", "T2", "JF", "JA"),
        publisher=first("PB"),
        volume=first("VL"),
        issue=first("IS"),
        pages=f"{start}-{end}" if start and end else start,
        work_type=_FROM_RIS.get(first("TY") or "", "article-journal"),
        url=first("UR"),
        doi=normalize_doi(first("DO")),
        abstract=clean_text(first("AB", "N2")),
    )
