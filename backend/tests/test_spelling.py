"""Messy input: a misspelled search is corrected when the literature confirms it, and only then; the person can
always search exactly what they typed. Also: open-access PDFs come from Europe PMC's current PDF service."""

import re

import httpx
import pytest
import respx

from app.services import open_access
from app.services.scholarly import spelling
from app.services.scholarly.spelling import changed_words, suggest_correction
from tests.conftest import ALICE

# How common each word is in the literature (OpenAlex counts measured on 2026-11-21, rounded).
COUNTS = {
    "malria": 6_400, "malaria": 720_000, "preventon": 490, "prevention": 8_100_000, "scools": 6_700,
    "schools": 14_000_000, "postcolonial": 336_000, "opostcolonial": 5, "litrature": 9_000, "literature": 9_000_000,
    "filles": 7_900_000, "files": 8_500_000,
}  # fmt: skip


@pytest.fixture(autouse=True)
def _fresh_cache():
    spelling._cache.clear()
    yield
    spelling._cache.clear()


def mock_services(router: respx.MockRouter, corrected: str | None, counts=COUNTS):
    body = f"<eSpellResult><CorrectedQuery>{corrected or ''}</CorrectedQuery></eSpellResult>"
    router.get(re.compile(r"https://eutils\.ncbi\.nlm\.nih\.gov/.*/espell\.fcgi.*")).mock(
        return_value=httpx.Response(200, text=body)
    )

    def count(request: httpx.Request) -> httpx.Response:
        word = request.url.params["search"]
        return httpx.Response(200, json={"meta": {"count": counts.get(word, 0)}, "results": []})

    router.get("https://api.openalex.org/works").mock(side_effect=count)


async def test_typos_are_corrected_when_the_literature_confirms_them():
    with respx.mock() as router:
        mock_services(router, "malaria prevention in schools")
        assert await suggest_correction("Malria preventon in scools") == "Malaria prevention in schools"


async def test_real_words_are_never_changed_into_rarer_ones():
    with respx.mock() as router:
        mock_services(router, "opostcolonial literature")  # ESpell's actual (wrong) suggestion for the first word
        assert await suggest_correction("postcolonial litrature") == "postcolonial literature"
    spelling._cache.clear()
    with respx.mock() as router:
        mock_services(router, "education des files")  # a French word that is common in its own right
        assert await suggest_correction("education des filles") is None


async def test_identifiers_acronyms_and_numbers_are_left_alone():
    with respx.mock(assert_all_called=False) as router:
        mock_services(router, "hiv prep")
        assert await suggest_correction("HIV PrEP") is None  # acronyms and mixed-case terms are not checked
        assert await suggest_correction("10.1136/bmjopen-2024-093244") is None
        assert await suggest_correction("2019 2020") is None
    assert changed_words("mRNA vacine 2021", "mrna vaccine 2021") == [(1, "vaccine")]


async def test_when_the_services_fail_the_search_goes_ahead_as_typed():
    with respx.mock() as router:
        router.get(re.compile(r"https://eutils\.ncbi\.nlm\.nih\.gov/.*")).mock(side_effect=httpx.ConnectTimeout("x"))
        assert await suggest_correction("malria preventon") is None


async def test_discover_shows_the_corrected_search_and_can_search_exactly_as_typed(client, registries, monkeypatch):
    from app.api.routes import discovery

    async def correct(query: str) -> str | None:
        return "malaria prevention" if query == "malria preventon" else None

    monkeypatch.setattr(discovery, "suggest_correction", correct)
    body = (await client.get("/api/v1/discovery/search", params={"q": "malria  preventon"}, headers=ALICE)).json()
    assert body["query"] == "malaria prevention" and body["corrected_from"] == "malria preventon"
    assert body["results"]  # the corrected search found the malaria study
    exact = (await client.get("/api/v1/discovery/search", params={"q": "malria preventon", "exact": "true"})).json()
    assert exact["query"] == "malria preventon" and exact["corrected_from"] is None


async def test_open_access_pdfs_use_europe_pmcs_current_pdf_service():
    class Paper:
        oa_pdf_url = None
        arxiv_id = None
        pmcid = "PMC12496081"
        doi = None

    urls = [url async for url, _ in open_access.pdf_candidates(Paper())]  # type: ignore[arg-type]
    assert urls == ["https://europepmc.org/api/getPdf?pmcid=PMC12496081"]
