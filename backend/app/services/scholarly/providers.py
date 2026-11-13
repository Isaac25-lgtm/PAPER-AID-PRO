"""Clients for public scholarly APIs. Each provider exposes `search()` and identifier lookups that return
`ScholarlyWork` objects. No provider ever invents data: missing fields stay empty."""

from __future__ import annotations

import contextlib
from datetime import date
from typing import Any

from lxml import etree

from app.config import get_settings
from app.services.scholarly.http import get_json, get_text
from app.services.scholarly.identifiers import normalize_arxiv, normalize_doi, normalize_pmcid
from app.services.scholarly.models import ScholarlyWork, WorkAuthor, clean_text, split_name

_XML_PARSER = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False)


def _safe_date(year: int | None, month: int | None = None, day: int | None = None) -> date | None:
    if not year:
        return None
    try:
        return date(int(year), int(month or 1), int(day or 1))
    except (TypeError, ValueError):
        return None


def _pages(first: str | None, last: str | None) -> str | None:
    if first and last and first != last:
        return f"{first}-{last}"
    return first or None


_CROSSREF_TYPES = {
    "journal-article": "article-journal",
    "proceedings-article": "paper-conference",
    "book-chapter": "chapter",
    "book": "book",
    "monograph": "book",
    "edited-book": "book",
    "posted-content": "article",
    "dissertation": "thesis",
    "report": "report",
    "dataset": "dataset",
}


# ------------------------------------------------------------------------------------------------- OpenAlex
class OpenAlex:
    base = "https://api.openalex.org"

    @staticmethod
    def _params(extra: dict[str, Any]) -> dict[str, Any]:
        contact = get_settings().contact_email
        return {**extra, **({"mailto": contact} if contact else {})}

    @staticmethod
    def _abstract(inverted: dict[str, list[int]] | None) -> str | None:
        if not inverted:
            return None
        positions: list[tuple[int, str]] = [(i, word) for word, idx in inverted.items() for i in idx]
        return " ".join(word for _, word in sorted(positions)) or None

    @classmethod
    def to_work(cls, item: dict[str, Any]) -> ScholarlyWork | None:
        title = clean_text(item.get("title") or item.get("display_name"))
        if not title:
            return None
        ids = item.get("ids") or {}
        primary = item.get("primary_location") or {}
        source = primary.get("source") or {}
        biblio = item.get("biblio") or {}
        best_oa = item.get("best_oa_location") or {}
        pub_date = None
        if item.get("publication_date"):
            with contextlib.suppress(ValueError):
                pub_date = date.fromisoformat(item["publication_date"])
        authors = []
        for authorship in item.get("authorships") or []:
            author = authorship.get("author") or {}
            if author.get("display_name"):
                parsed = split_name(author["display_name"])
                orcid = (author.get("orcid") or "").rsplit("/", 1)[-1] or None
                authors.append(parsed.model_copy(update={"orcid": orcid}))
        work_type = {"article": "article-journal", "book-chapter": "chapter", "dissertation": "thesis"}.get(
            item.get("type") or "", "article-journal"
        )
        return ScholarlyWork(
            title=title,
            abstract=cls._abstract(item.get("abstract_inverted_index")),
            authors=authors,
            year=item.get("publication_year"),
            publication_date=pub_date,
            journal=source.get("display_name"),
            publisher=source.get("host_organization_name"),
            volume=biblio.get("volume"),
            issue=biblio.get("issue"),
            pages=_pages(biblio.get("first_page"), biblio.get("last_page")),
            work_type=work_type,
            url=primary.get("landing_page_url"),
            doi=normalize_doi(item.get("doi")),
            pmid=(ids.get("pmid") or "").rstrip("/").rsplit("/", 1)[-1] or None,
            pmcid=normalize_pmcid((ids.get("pmcid") or "").rstrip("/").rsplit("/", 1)[-1]),
            openalex_id=(item.get("id") or "").rsplit("/", 1)[-1] or None,
            is_open_access=bool((item.get("open_access") or {}).get("is_oa")),
            oa_pdf_url=best_oa.get("pdf_url"),
            oa_license=best_oa.get("license"),
            citation_count=int(item.get("cited_by_count") or 0),
            keywords=[k["display_name"] for k in item.get("keywords") or [] if k.get("display_name")][:10],
            sources=["openalex"],
        )

    @classmethod
    async def search(
        cls, query: str, limit: int, year_from: int | None, year_to: int | None, open_access_only: bool
    ) -> list[ScholarlyWork]:
        filters = []
        if year_from:
            filters.append(f"from_publication_date:{year_from}-01-01")
        if year_to:
            filters.append(f"to_publication_date:{year_to}-12-31")
        if open_access_only:
            filters.append("is_oa:true")
        params: dict[str, Any] = {"search": query, "per-page": min(limit, 50)}
        if filters:
            params["filter"] = ",".join(filters)
        data = await get_json(f"{cls.base}/works", params=cls._params(params))
        return [w for item in data.get("results", []) if (w := cls.to_work(item))]

    @classmethod
    async def lookup(cls, kind: str, value: str) -> ScholarlyWork | None:
        key = {"doi": f"doi:{value}", "pmid": f"pmid:{value}", "pmcid": f"pmcid:{value}"}.get(kind)
        if key is None:
            return None
        data = await get_json(f"{cls.base}/works/{key}", params=cls._params({}), not_found_ok=True)
        return cls.to_work(data) if data else None


# ------------------------------------------------------------------------------------------------- Crossref
class Crossref:
    base = "https://api.crossref.org"
    _select = (
        "DOI,title,author,container-title,issued,published,abstract,volume,issue,page,type,"
        "publisher,is-referenced-by-count,URL,license,subject"
    )

    @staticmethod
    def _params(extra: dict[str, Any]) -> dict[str, Any]:
        contact = get_settings().contact_email
        return {**extra, **({"mailto": contact} if contact else {})}

    @staticmethod
    def to_work(item: dict[str, Any]) -> ScholarlyWork | None:
        titles = item.get("title") or []
        title = clean_text(titles[0]) if titles else None
        if not title:
            return None
        parts = ((item.get("issued") or item.get("published") or {}).get("date-parts") or [[None]])[0]
        year = parts[0] if parts else None
        authors = []
        for a in item.get("author") or []:
            family, given = a.get("family"), a.get("given")
            name = " ".join(p for p in (given, family) if p) or a.get("name")
            if name:
                orcid = (a.get("ORCID") or "").rsplit("/", 1)[-1] or None
                authors.append(WorkAuthor(name=name, family=family or name, given=given, orcid=orcid))
        containers = item.get("container-title") or []
        licenses = item.get("license") or []
        return ScholarlyWork(
            title=title,
            abstract=clean_text(item.get("abstract")),
            authors=authors,
            year=year,
            publication_date=_safe_date(*[*list(parts), None, None][:3]) if year else None,
            journal=containers[0] if containers else None,
            publisher=item.get("publisher"),
            volume=item.get("volume"),
            issue=item.get("issue"),
            pages=item.get("page"),
            work_type=_CROSSREF_TYPES.get(item.get("type") or "", "article-journal"),
            url=item.get("URL"),
            doi=normalize_doi(item.get("DOI")),
            citation_count=int(item.get("is-referenced-by-count") or 0),
            oa_license=licenses[0].get("URL") if licenses else None,
            keywords=(item.get("subject") or [])[:10],
            sources=["crossref"],
        )

    @classmethod
    async def search(
        cls, query: str, limit: int, year_from: int | None, year_to: int | None, open_access_only: bool
    ) -> list[ScholarlyWork]:
        filters = []
        if year_from:
            filters.append(f"from-pub-date:{year_from}")
        if year_to:
            filters.append(f"until-pub-date:{year_to}")
        params: dict[str, Any] = {"query.bibliographic": query, "rows": min(limit, 50), "select": cls._select}
        if filters:
            params["filter"] = ",".join(filters)
        data = await get_json(f"{cls.base}/works", params=cls._params(params))
        works = [w for item in (data.get("message") or {}).get("items", []) if (w := cls.to_work(item))]
        return works  # Crossref has no reliable OA flag; OA filtering is applied after merging.

    @classmethod
    async def lookup(cls, kind: str, value: str) -> ScholarlyWork | None:
        if kind != "doi":
            return None
        data = await get_json(f"{cls.base}/works/{value}", params=cls._params({}), not_found_ok=True)
        return cls.to_work(data["message"]) if data and data.get("message") else None


# --------------------------------------------------------------------------------------------------- PubMed
class PubMed:
    base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

    @staticmethod
    def _params(extra: dict[str, Any]) -> dict[str, Any]:
        settings = get_settings()
        params = {**extra, "tool": "paperaid-pro"}
        if settings.contact_email:
            params["email"] = settings.contact_email
        if settings.ncbi_api_key:
            params["api_key"] = settings.ncbi_api_key
        return params

    @staticmethod
    def _text(node: Any, path: str) -> str | None:
        found = node.find(path)
        if found is None:
            return None
        return clean_text("".join(found.itertext()))

    @classmethod
    def parse_articles(cls, xml: str) -> list[ScholarlyWork]:
        root = etree.fromstring(xml.encode(), parser=_XML_PARSER)
        works: list[ScholarlyWork] = []
        for article in root.iter("PubmedArticle"):
            citation = article.find("MedlineCitation")
            art = citation.find("Article") if citation is not None else None
            if art is None:
                continue
            title = cls._text(art, "ArticleTitle")
            if not title:
                continue
            abstract_parts = []
            for node in art.findall("Abstract/AbstractText"):
                label = node.get("Label")
                text = clean_text("".join(node.itertext()))
                if text:
                    abstract_parts.append(f"{label}: {text}" if label else text)
            authors = []
            for a in art.findall("AuthorList/Author"):
                family, given = cls._text(a, "LastName"), cls._text(a, "ForeName")
                collective = cls._text(a, "CollectiveName")
                if family or collective:
                    name = " ".join(p for p in (given, family) if p) if family else collective
                    authors.append(WorkAuthor(name=name or "", family=family or collective, given=given))
            journal = art.find("Journal")
            year = None
            month = None
            if journal is not None:
                year_text = cls._text(journal, "JournalIssue/PubDate/Year")
                medline = cls._text(journal, "JournalIssue/PubDate/MedlineDate")
                if year_text and year_text.isdigit():
                    year = int(year_text)
                elif medline and medline[:4].isdigit():
                    year = int(medline[:4])
                month_text = cls._text(journal, "JournalIssue/PubDate/Month")
                months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
                if month_text:
                    lowered = month_text[:3].lower()
                    month = (
                        months.index(lowered) + 1
                        if lowered in months
                        else (int(month_text) if month_text.isdigit() else None)
                    )
            ids = {
                node.get("IdType"): (node.text or "").strip()
                for node in article.findall("PubmedData/ArticleIdList/ArticleId")
            }
            doi = normalize_doi(ids.get("doi"))
            if not doi:
                for loc in art.findall("ELocationID"):
                    if loc.get("EIdType") == "doi":
                        doi = normalize_doi(loc.text)
            pmid = cls._text(citation, "PMID") if citation is not None else None
            keywords = [clean_text("".join(k.itertext())) or "" for k in citation.findall("KeywordList/Keyword")]
            pmcid = normalize_pmcid(ids.get("pmc"))
            works.append(
                ScholarlyWork(
                    title=title.rstrip("."),
                    abstract=" ".join(abstract_parts) or None,
                    authors=authors,
                    year=year,
                    publication_date=_safe_date(year, month),
                    journal=cls._text(art, "Journal/Title"),
                    volume=cls._text(art, "Journal/JournalIssue/Volume"),
                    issue=cls._text(art, "Journal/JournalIssue/Issue"),
                    pages=cls._text(art, "Pagination/MedlinePgn"),
                    url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else None,
                    doi=doi,
                    pmid=pmid,
                    pmcid=pmcid,
                    is_open_access=bool(pmcid),
                    keywords=[k for k in keywords if k][:10],
                    sources=["pubmed"],
                )
            )
        return works

    @classmethod
    async def fetch(cls, pmids: list[str]) -> list[ScholarlyWork]:
        if not pmids:
            return []
        xml = await get_text(
            f"{cls.base}/efetch.fcgi", params=cls._params({"db": "pubmed", "id": ",".join(pmids), "retmode": "xml"})
        )
        works = cls.parse_articles(xml)
        order = {pmid: i for i, pmid in enumerate(pmids)}
        return sorted(works, key=lambda w: order.get(w.pmid or "", len(order)))

    @classmethod
    async def search(
        cls, query: str, limit: int, year_from: int | None, year_to: int | None, open_access_only: bool
    ) -> list[ScholarlyWork]:
        term = f"({query}) AND free full text[sb]" if open_access_only else query
        params: dict[str, Any] = {
            "db": "pubmed",
            "term": term,
            "retmax": min(limit, 50),
            "retmode": "json",
            "sort": "relevance",
        }
        if year_from or year_to:
            params.update({"datetype": "pdat", "mindate": str(year_from or 1800), "maxdate": str(year_to or 3000)})
        data = await get_json(f"{cls.base}/esearch.fcgi", params=cls._params(params))
        ids = (data.get("esearchresult") or {}).get("idlist") or []
        return await cls.fetch(ids)

    @classmethod
    async def lookup(cls, kind: str, value: str) -> ScholarlyWork | None:
        if kind == "pmid":
            works = await cls.fetch([value])
            return works[0] if works else None
        if kind in {"doi", "pmcid"}:
            term = f"{value}[doi]" if kind == "doi" else f"{value}[pmcid]"
            data = await get_json(
                f"{cls.base}/esearch.fcgi", params=cls._params({"db": "pubmed", "term": term, "retmode": "json"})
            )
            ids = (data.get("esearchresult") or {}).get("idlist") or []
            works = await cls.fetch(ids[:1])
            return works[0] if works else None
        return None


# ----------------------------------------------------------------------------------------- Semantic Scholar
class SemanticScholar:
    base = "https://api.semanticscholar.org/graph/v1"
    fields = (
        "title,abstract,authors,year,venue,externalIds,citationCount,isOpenAccess,openAccessPdf,"
        "publicationDate,journal,url"
    )

    @staticmethod
    def _headers() -> dict[str, str]:
        key = get_settings().semantic_scholar_api_key
        return {"x-api-key": key} if key else {}

    @staticmethod
    def to_work(item: dict[str, Any]) -> ScholarlyWork | None:
        title = clean_text(item.get("title"))
        if not title:
            return None
        ext = item.get("externalIds") or {}
        journal = item.get("journal") or {}
        pub_date = None
        if item.get("publicationDate"):
            with contextlib.suppress(ValueError):
                pub_date = date.fromisoformat(item["publicationDate"])
        oa_pdf = (item.get("openAccessPdf") or {}).get("url") or None
        return ScholarlyWork(
            title=title,
            abstract=clean_text(item.get("abstract")),
            authors=[split_name(a["name"]) for a in item.get("authors") or [] if a.get("name")],
            year=item.get("year"),
            publication_date=pub_date,
            journal=journal.get("name") or item.get("venue") or None,
            volume=journal.get("volume"),
            pages=(journal.get("pages") or "").strip() or None,
            url=item.get("url"),
            doi=normalize_doi(ext.get("DOI")),
            pmid=str(ext["PubMed"]) if ext.get("PubMed") else None,
            pmcid=normalize_pmcid(f"PMC{ext['PubMedCentral']}") if ext.get("PubMedCentral") else None,
            arxiv_id=normalize_arxiv(ext.get("ArXiv")),
            s2_id=item.get("paperId"),
            is_open_access=bool(item.get("isOpenAccess")),
            oa_pdf_url=oa_pdf,
            citation_count=int(item.get("citationCount") or 0),
            sources=["semantic_scholar"],
        )

    @classmethod
    async def search(
        cls, query: str, limit: int, year_from: int | None, year_to: int | None, open_access_only: bool
    ) -> list[ScholarlyWork]:
        params: dict[str, Any] = {"query": query, "limit": min(limit, 50), "fields": cls.fields}
        if year_from or year_to:
            params["year"] = f"{year_from or ''}-{year_to or ''}"
        if open_access_only:
            params["openAccessPdf"] = ""
        data = await get_json(f"{cls.base}/paper/search", params=params, headers=cls._headers(), retries=1)
        return [w for item in data.get("data") or [] if (w := cls.to_work(item))]

    @classmethod
    async def lookup(cls, kind: str, value: str) -> ScholarlyWork | None:
        prefix = {"doi": "DOI:", "pmid": "PMID:", "arxiv": "ARXIV:", "pmcid": "PMCID:"}.get(kind)
        if prefix is None:
            return None
        data = await get_json(
            f"{cls.base}/paper/{prefix}{value}",
            params={"fields": cls.fields},
            headers=cls._headers(),
            retries=1,
            not_found_ok=True,
        )
        return cls.to_work(data) if data else None


# ---------------------------------------------------------------------------------------------------- arXiv
class ArXiv:
    base = "https://export.arxiv.org/api/query"
    ns = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}

    @classmethod
    def parse_feed(cls, xml: str) -> list[ScholarlyWork]:
        root = etree.fromstring(xml.encode(), parser=_XML_PARSER)
        works = []
        for entry in root.findall("a:entry", cls.ns):
            title = clean_text(entry.findtext("a:title", namespaces=cls.ns))
            raw_id = entry.findtext("a:id", namespaces=cls.ns) or ""
            arxiv_id = normalize_arxiv(raw_id)
            if not title or not arxiv_id:
                continue
            published = entry.findtext("a:published", namespaces=cls.ns) or ""
            pub_date = None
            with contextlib.suppress(ValueError):
                pub_date = date.fromisoformat(published[:10])
            authors = [
                split_name(n)
                for a in entry.findall("a:author", cls.ns)
                if (n := (a.findtext("a:name", namespaces=cls.ns) or "").strip())
            ]
            works.append(
                ScholarlyWork(
                    title=title,
                    abstract=clean_text(entry.findtext("a:summary", namespaces=cls.ns)),
                    authors=authors,
                    year=pub_date.year if pub_date else None,
                    publication_date=pub_date,
                    journal=clean_text(entry.findtext("arxiv:journal_ref", namespaces=cls.ns)),
                    work_type="article",
                    url=f"https://arxiv.org/abs/{arxiv_id}",
                    doi=normalize_doi(entry.findtext("arxiv:doi", namespaces=cls.ns)),
                    arxiv_id=arxiv_id,
                    is_open_access=True,
                    oa_pdf_url=f"https://arxiv.org/pdf/{arxiv_id}",
                    sources=["arxiv"],
                )
            )
        return works

    @classmethod
    async def search(
        cls, query: str, limit: int, year_from: int | None, year_to: int | None, open_access_only: bool
    ) -> list[ScholarlyWork]:
        terms = " AND ".join(f"all:{t}" for t in query.split() if t.isalnum()) or f'all:"{query}"'
        xml = await get_text(
            cls.base, params={"search_query": terms, "start": 0, "max_results": min(limit, 50), "sortBy": "relevance"}
        )
        works = cls.parse_feed(xml)
        return [
            w
            for w in works
            if (not year_from or (w.year or 0) >= year_from) and (not year_to or (w.year or 9999) <= year_to)
        ]

    @classmethod
    async def lookup(cls, kind: str, value: str) -> ScholarlyWork | None:
        if kind != "arxiv":
            return None
        works = cls.parse_feed(await get_text(cls.base, params={"id_list": value}))
        return works[0] if works else None


PROVIDERS = {
    "openalex": OpenAlex,
    "crossref": Crossref,
    "pubmed": PubMed,
    "semantic_scholar": SemanticScholar,
    "arxiv": ArXiv,
}
