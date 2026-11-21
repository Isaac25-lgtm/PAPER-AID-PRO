"""Real users are messy: misspelled searches, identifiers typed every which way, references Crossref lacks,
web codes in titles. Corrections are suggestions: the person can always search exactly what they typed."""

import re

import httpx
import pytest
import respx

from app.services import open_access
from app.services.scholarly import spelling
from app.services.scholarly.spelling import changed_words, suggest_correction
from tests.conftest import ALICE

# Exact-word counts in OpenAlex titles and abstracts (measured on 2026-11-21).
COUNTS = {
    "malria": 36, "malaria": 224_332, "preventon": 47, "prevention": 2_246_751, "scools": 105,
    "schools": 1_528_459, "postcolonial": 99_204, "opostcolonial": 0, "litrature": 900, "literature": 4_000_000,
    "filles": 22_040, "files": 510_326, "feding": 146, "feeding": 900_930,
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
        word = request.url.params["filter"].removeprefix("title_and_abstract.search.exact:")
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


def test_template_guidance_is_kept_and_exported_in_italics():
    import io

    from docx import Document as Docx

    from app.services.documents import normalise_document
    from app.services.export import to_docx

    content = normalise_document(
        {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "attrs": {"guidance": True},
                    "content": [{"type": "text", "text": "Summarise it."}],
                },
                {"type": "paragraph", "attrs": {"guidance": "yes"}, "content": [{"type": "text", "text": "My words."}]},
            ],
        }
    )
    assert content["content"][0]["attrs"] == {"guidance": True}
    assert "attrs" not in content["content"][1]  # only a real true is kept
    runs = {p.text: p.runs[0].italic for p in Docx(io.BytesIO(to_docx("T", content, {}))).paragraphs if p.runs}
    assert runs["Summarise it."] is True and not runs["My words."]


def test_identifiers_are_read_the_way_people_type_them():
    from app.services.scholarly.identifiers import parse_identifier

    for typed, kind, value in [
        ("PMID 27940873", "pmid", "27940873"),
        ("pmid#27940873", "pmid", "27940873"),
        ("PMC 12496081", "pmcid", "PMC12496081"),
        ("https://pmc.ncbi.nlm.nih.gov/articles/PMC12496081/", "pmcid", "PMC12496081"),
        ("https://europepmc.org/article/MED/27940873", "pmid", "27940873"),
        ("arXiv 1706.03762", "arxiv", "1706.03762"),
        (" doi: 10.1126/science.aah5309 ", "doi", "10.1126/science.aah5309"),
    ]:
        found = parse_identifier(typed)
        assert found is not None and (found.kind, found.value) == (kind, value), typed
    assert parse_identifier("hello this is not an id") is None


def test_web_entities_in_titles_and_journals_are_decoded():
    from app.services.scholarly.models import clean_text

    assert clean_text("Information Technology &amp; People") == "Information Technology & People"
    assert clean_text("<jats:p>p &lt; 0.05</jats:p>") == "p < 0.05"


async def test_a_typo_that_shares_a_stem_with_common_words_is_still_corrected():
    # Stemmed search counted "feding" as 4 million papers ("fed..."); exact counts give 146 against 900,930.
    with respx.mock() as router:
        mock_services(router, "school feeding")
        assert await suggest_correction("school feding") == "school feeding"


async def test_the_openalex_key_is_sent_in_a_header_and_never_in_the_address(monkeypatch):
    from app.config import get_settings
    from app.services.scholarly.http import get_json

    monkeypatch.setattr(get_settings(), "openalex_api_key", "oa-test-key")
    with respx.mock() as router:
        openalex = router.get("https://api.openalex.org/works").mock(return_value=httpx.Response(200, json={}))
        crossref = router.get("https://api.crossref.org/works").mock(return_value=httpx.Response(200, json={}))
        await get_json("https://api.openalex.org/works", params={"search": "x"})
        await get_json("https://api.crossref.org/works", params={"query": "x"})
    sent = openalex.calls.last.request
    assert sent.headers["authorization"] == "Bearer oa-test-key" and "oa-test-key" not in str(sent.url)
    assert "authorization" not in crossref.calls.last.request.headers  # never sent to anyone else
