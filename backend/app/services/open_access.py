"""Find legitimate open-access PDF locations for a paper. Only publisher/repository OA links are used."""

from __future__ import annotations

import logging

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


async def pdf_candidates(paper: Paper) -> list[tuple[str, str]]:
    """Ordered (url, origin) candidates. Callers try each until one returns a real PDF."""
    candidates: list[tuple[str, str]] = []
    if paper.oa_pdf_url:
        candidates.append((paper.oa_pdf_url, "recorded"))
    if paper.arxiv_id:
        candidates.append((f"https://arxiv.org/pdf/{paper.arxiv_id}", "arxiv"))
    if paper.pmcid:
        candidates.append(
            (f"https://europepmc.org/backend/ptpmcrender.fcgi?accid={paper.pmcid}&blobtype=pdf", "europepmc")
        )
    if paper.doi:
        url, license_ = await _unpaywall_pdf(paper.doi)
        if url:
            candidates.append((url, "unpaywall"))
            paper.oa_license = paper.oa_license or license_
        try:
            work = await OpenAlex.lookup("doi", paper.doi)
        except AppError:
            work = None
        if work and work.oa_pdf_url:
            candidates.append((work.oa_pdf_url, "openalex"))
    seen: set[str] = set()
    return [(u, o) for u, o in candidates if not (u in seen or seen.add(u))]
