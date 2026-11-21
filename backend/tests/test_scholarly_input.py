"""Scholarly input read the way people type it: identifiers, web entities in titles, open-access PDF addresses,
and the OpenAlex key (sent only to OpenAlex, only in a header)."""

import httpx
import respx

from app.services import open_access
from tests.conftest import ALICE


async def test_open_access_pdfs_use_europe_pmcs_current_pdf_service():
    class Paper:
        oa_pdf_url = None
        arxiv_id = None
        pmcid = "PMC12496081"
        doi = None

    urls = [url async for url, _ in open_access.pdf_candidates(Paper())]  # type: ignore[arg-type]
    assert urls == ["https://europepmc.org/api/getPdf?pmcid=PMC12496081"]


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


def test_a_closing_bracket_that_belongs_to_the_doi_is_kept():
    """Audit F12: only brackets that wrap the DOI in prose are removed; import and formatting share this parser."""
    from app.services.scholarly.identifiers import normalize_doi, parse_identifier

    for typed in ("10.1234/example(2020)", "https://doi.org/10.1234/example(2020)", "(see 10.1234/example(2020))."):
        assert normalize_doi(typed) == "10.1234/example(2020)", typed
        identifier = parse_identifier(typed)
        assert identifier is not None and identifier.value == "10.1234/example(2020)"
    assert normalize_doi("doi:10.1234/abc).") == "10.1234/abc"
    assert normalize_doi("[10.1000/xyz]") == "10.1000/xyz"


async def test_semantic_scholar_is_searched_by_default_only_with_its_key(client, registries, monkeypatch):
    from app.config import get_settings
    from app.services.scholarly.aggregator import default_providers

    assert "semantic_scholar" not in default_providers("all")
    default = (await client.get("/api/v1/discovery/search", params={"q": "malaria"})).json()
    assert "semantic_scholar" not in {p["provider"] for p in default["providers"]}  # no red 'unavailable' chip
    chosen = (
        await client.get("/api/v1/discovery/search", params={"q": "malaria", "providers": ["semantic_scholar"]})
    ).json()
    assert [p["provider"] for p in chosen["providers"]] == ["semantic_scholar"]  # still available when asked for
    status = (await client.get("/api/v1/research/deep/status", headers=ALICE)).json()
    assert "semantic_scholar" not in status["databases"]
    monkeypatch.setattr(get_settings(), "semantic_scholar_api_key", "s2-test-key")
    assert "semantic_scholar" in default_providers("all")
