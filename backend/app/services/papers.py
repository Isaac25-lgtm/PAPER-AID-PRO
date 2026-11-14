"""Paper persistence, access control and serialisation."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import (
    Author,
    Paper,
    PaperAuthor,
    PaperSource,
    PaperStatus,
    PaperVisibility,
    User,
)
from app.errors import NotFound
from app.services.scholarly.models import ScholarlyWork


def visible_papers_clause(user: User | None) -> Any:
    """SQL predicate: public papers, plus the user's own private uploads.

    Administrators get no exception here: private uploads are served only to their owner on every user-facing
    route (catalog, PDF, passages, citations, research). Moderation uses the audited /admin endpoints."""
    if user is None:
        return Paper.visibility == PaperVisibility.PUBLIC
    return or_(Paper.visibility == PaperVisibility.PUBLIC, Paper.owner_id == user.id)


def can_view(paper: Paper, user: User | None) -> bool:
    if paper.visibility == PaperVisibility.PUBLIC:
        return True
    return user is not None and paper.owner_id == user.id


def can_manage(paper: Paper, user: User) -> bool:
    """Owner-only. (Admins remove papers through DELETE /admin/papers/{id}, which is audited.)"""
    return paper.owner_id is not None and paper.owner_id == user.id


def with_authors(stmt: Select[Any]) -> Select[Any]:
    # populate_existing: background jobs update papers in their own session; always read fresh state.
    return stmt.options(selectinload(Paper.authors).joinedload(PaperAuthor.author)).execution_options(
        populate_existing=True
    )


async def get_paper_for_user(db: AsyncSession, paper_id: uuid.UUID, user: User | None) -> Paper:
    paper = (await db.execute(with_authors(select(Paper).where(Paper.id == paper_id)))).scalar_one_or_none()
    # Not-visible and non-existent are indistinguishable to the caller (no enumeration).
    if paper is None or not can_view(paper, user):
        raise NotFound("Paper not found.")
    return paper


async def get_papers_for_user(db: AsyncSession, ids: list[uuid.UUID], user: User | None) -> list[Paper]:
    if not ids:
        return []
    stmt = with_authors(select(Paper).where(Paper.id.in_(ids), visible_papers_clause(user)))
    papers = {p.id: p for p in (await db.execute(stmt)).scalars().unique()}
    return [papers[i] for i in ids if i in papers]


async def find_public_match(db: AsyncSession, work: ScholarlyWork) -> Paper | None:
    conditions = []
    if work.doi:
        conditions.append(Paper.doi == work.doi)
    if work.pmid:
        conditions.append(Paper.pmid == work.pmid)
    if work.arxiv_id:
        conditions.append(Paper.arxiv_id == work.arxiv_id)
    if not conditions:
        return None
    stmt = with_authors(
        select(Paper).where(and_(Paper.visibility == PaperVisibility.PUBLIC, or_(*conditions))).limit(1)
    )
    return (await db.execute(stmt)).scalars().first()


async def _author_rows(db: AsyncSession, work: ScholarlyWork) -> list[Author]:
    rows: list[Author] = []
    for wa in work.authors[:100]:
        author = None
        if wa.orcid:
            author = (await db.execute(select(Author).where(Author.orcid == wa.orcid))).scalar_one_or_none()
        if author is None:
            author = (
                (
                    await db.execute(
                        select(Author)
                        .where(func.lower(Author.name) == wa.name.lower(), Author.orcid.is_(None))
                        .limit(1)
                    )
                )
                .scalars()
                .first()
            )
            if author is not None and wa.orcid:
                author.orcid = wa.orcid
        if author is None:
            author = Author(name=wa.name[:300], family=(wa.family or None), given=(wa.given or None), orcid=wa.orcid)
            db.add(author)
            await db.flush()
        rows.append(author)
    return rows


_COPY_FIELDS = (
    "title",
    "abstract",
    "publication_date",
    "year",
    "journal",
    "publisher",
    "volume",
    "issue",
    "pages",
    "work_type",
    "url",
    "doi",
    "pmid",
    "pmcid",
    "arxiv_id",
    "s2_id",
    "openalex_id",
    "oa_pdf_url",
    "oa_license",
)


def _apply_work(paper: Paper, work: ScholarlyWork, *, overwrite: bool) -> None:
    for field in _COPY_FIELDS:
        value = getattr(work, field)
        if value in (None, ""):
            continue
        if overwrite or getattr(paper, field) in (None, ""):
            setattr(paper, field, value[:5000] if isinstance(value, str) and field != "abstract" else value)
    paper.is_open_access = paper.is_open_access or work.is_open_access or bool(work.oa_pdf_url)
    paper.citation_count = max(paper.citation_count or 0, work.citation_count)
    if work.keywords:
        paper.keywords = list(dict.fromkeys([*(paper.keywords or []), *work.keywords]))[:15]


async def upsert_public_paper(db: AsyncSession, work: ScholarlyWork, *, created_by: User | None) -> Paper:
    """Insert or enrich the canonical public record for a scholarly work (matched by DOI/PMID/arXiv)."""
    paper = await find_public_match(db, work)
    if paper is None:
        paper = Paper(
            title=work.title,
            visibility=PaperVisibility.PUBLIC,
            source=PaperSource.DISCOVERY,
            status=PaperStatus.METADATA_ONLY,
            created_by_id=created_by.id if created_by else None,
            keywords=[],
        )
        _apply_work(paper, work, overwrite=True)
        db.add(paper)
        await db.flush()
        for position, author in enumerate(await _author_rows(db, work)):
            db.add(PaperAuthor(paper_id=paper.id, author_id=author.id, position=position))
    else:
        _apply_work(paper, work, overwrite=False)
        if not paper.authors and work.authors:
            for position, author in enumerate(await _author_rows(db, work)):
                db.add(PaperAuthor(paper_id=paper.id, author_id=author.id, position=position))
    await db.commit()
    return await get_paper_for_user(db, paper.id, None)


async def create_private_paper(
    db: AsyncSession, *, owner: User, work: ScholarlyWork, source: PaperSource, commit: bool = True
) -> Paper:
    paper = Paper(
        title=work.title,
        visibility=PaperVisibility.PRIVATE,
        source=source,
        owner_id=owner.id,
        created_by_id=owner.id,
        status=PaperStatus.METADATA_ONLY,
        keywords=[],
    )
    _apply_work(paper, work, overwrite=True)
    db.add(paper)
    await db.flush()
    for position, author in enumerate(await _author_rows(db, work)):
        db.add(PaperAuthor(paper_id=paper.id, author_id=author.id, position=position))
    if not commit:
        return paper
    await db.commit()
    return await get_paper_for_user(db, paper.id, owner)


def author_names(paper: Paper) -> list[str]:
    return [pa.author.name for pa in paper.authors]


def csl_item(
    item_id: str,
    *,
    work_type: str,
    title: str,
    authors: list[tuple[str | None, str | None, str]],
    date_parts: list[int] | None,
    container: str | None = None,
    publisher: str | None = None,
    volume: str | None = None,
    issue: str | None = None,
    pages: str | None = None,
    doi: str | None = None,
    pmid: str | None = None,
    pmcid: str | None = None,
    url: str | None = None,
    arxiv_id: str | None = None,
) -> dict[str, Any]:
    """Single source of truth for CSL-JSON items (papers in the DB and registry lookups alike)."""
    item: dict[str, Any] = {"id": item_id, "type": work_type or "article-journal", "title": title}
    names = []
    for family, given, name in authors:
        names.append(
            {k: v for k, v in {"family": family, "given": given}.items() if v} if family else {"literal": name}
        )
    if names:
        item["author"] = names
    if date_parts:
        item["issued"] = {"date-parts": [date_parts]}
    is_preprint = bool(arxiv_id) and (not container or container.lower() == "arxiv")
    if is_preprint:
        # arXiv preprints: publisher arXiv + genre Preprint + the arXiv DataCite DOI (APA/Chicago preprint form).
        item.update(type="article", publisher="arXiv", genre="Preprint", number=f"arXiv:{arxiv_id}")
        doi = doi or f"10.48550/arxiv.{arxiv_id}"
        container = None
    fields = {
        "container-title": container,
        "publisher": item.get("publisher") or publisher,
        "volume": volume,
        "issue": issue,
        "page": pages,
        "DOI": doi,
        "PMID": pmid,
        "PMCID": pmcid,
        "URL": None if doi else url,
    }
    item.update({k: v for k, v in fields.items() if v})
    return item


def to_csl_json(paper: Paper) -> dict[str, Any]:
    """CSL-JSON item used for formatting citations and bibliographies."""
    if paper.publication_date:
        d = paper.publication_date
        date_parts: list[int] | None = [d.year, d.month, d.day]
    else:
        date_parts = [paper.year] if paper.year else None
    return csl_item(
        str(paper.id),
        work_type=paper.work_type,
        title=paper.title,
        authors=[(pa.author.family, pa.author.given, pa.author.name) for pa in paper.authors],
        date_parts=date_parts,
        container=paper.journal,
        publisher=paper.publisher,
        volume=paper.volume,
        issue=paper.issue,
        pages=paper.pages,
        doi=paper.doi,
        pmid=paper.pmid,
        pmcid=paper.pmcid,
        url=paper.url,
        arxiv_id=paper.arxiv_id,
    )


def work_to_csl_json(work: ScholarlyWork, item_id: str) -> dict[str, Any]:
    return csl_item(
        item_id,
        work_type=work.work_type,
        title=work.title,
        authors=[(a.family, a.given, a.name) for a in work.authors],
        date_parts=[work.year] if work.year else None,
        container=work.journal,
        publisher=work.publisher,
        volume=work.volume,
        issue=work.issue,
        pages=work.pages,
        doi=work.doi,
        pmid=work.pmid,
        pmcid=work.pmcid,
        url=work.url,
        arxiv_id=work.arxiv_id,
    )


def paper_summary_dict(paper: Paper) -> dict[str, Any]:
    return {
        "id": str(paper.id),
        "title": paper.title,
        "authors": author_names(paper),
        "year": paper.year,
        "journal": paper.journal,
        "doi": paper.doi,
        "pmid": paper.pmid,
        "arxiv_id": paper.arxiv_id,
        "is_open_access": paper.is_open_access,
        "visibility": paper.visibility.value,
        "status": paper.status.value,
        "citation_count": paper.citation_count,
        "has_full_text": paper.status == PaperStatus.READY,
    }
