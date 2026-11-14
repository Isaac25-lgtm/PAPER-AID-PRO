"""Find legitimate open-access PDF locations for a paper. Only publisher/repository OA links are used."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from app.config import get_settings
from app.db.models import Paper
from app.errors import AppError
from app.services.scholarly.http import get_json
from app.services.scholarly.providers import OpenAlex

log = logging.getLogger(__name__)


async def _unpaywall_pdf(doi: str) -> tuple[str | None, str | None]:
    contact = get_settings().contact_email
    if not contact:  # Unpaywall requires a real contact email; never send a placeholder.
        return None, None
    try:
        data = await get_json(
            f"https://api.unpaywall.org/v2/{doi}", params={"email": contact}, not_found_ok=True, retries=1
        )
    except AppError:
        return None, None
    best = (data or {}).get("best_oa_location") or {}
    return best.get("url_for_pdf"), best.get("license")


async def pdf_candidates(paper: Paper) -> AsyncIterator[tuple[str, str]]:
    """(url, origin) candidates in order, produced lazily: the locations already known are offered first, and the
    DOI lookups (Unpaywall, then OpenAlex) run only if none of those gave a PDF. Each URL is offered once."""
    seen: set[str] = set()

    def fresh(url: str | None) -> bool:
        if not url or url in seen:
            return False
        seen.add(url)
        return True

    known = [
        (paper.oa_pdf_url, "recorded"),
        (f"https://arxiv.org/pdf/{paper.arxiv_id}" if paper.arxiv_id else None, "arxiv"),
        (
            f"https://europepmc.org/backend/ptpmcrender.fcgi?accid={paper.pmcid}&blobtype=pdf" if paper.pmcid else None,
            "europepmc",
        ),
    ]
    for url, origin in known:
        if fresh(url):
            yield url, origin  # type: ignore[misc]
    if not paper.doi:
        return
    url, license_ = await _unpaywall_pdf(paper.doi)
    if fresh(url):
        paper.oa_license = paper.oa_license or license_
        yield url, "unpaywall"  # type: ignore[misc]
    try:
        work = await OpenAlex.lookup("doi", paper.doi)
    except AppError:
        work = None
    if work and fresh(work.oa_pdf_url):
        yield work.oa_pdf_url, "openalex"  # type: ignore[misc]
