"""Identifier parsing, provider mapping, federated search (merge, dedupe, rank, partial failure)."""

import httpx
import pytest

from app.services.scholarly.aggregator import federated_search, merge_works, resolve_identifier
from app.services.scholarly.identifiers import Identifier, normalize_doi, parse_identifier
from app.services.scholarly.models import ScholarlyWork
from app.services.scholarly.providers import ArXiv, Crossref, OpenAlex, PubMed
from tests import fixtures as fx
from tests.conftest import ALICE


@pytest.mark.parametrize(
    ("raw", "kind", "value"),
    [
        ("10.1186/S12936-021-03812-X", "doi", "10.1186/s12936-021-03812-x"),
        ("https://doi.org/10.1038/nature12373.", "doi", "10.1038/nature12373"),
        ("doi:10.1000/xyz123", "doi", "10.1000/xyz123"),
        ("PMID: 34001234", "pmid", "34001234"),
        ("34001234", "pmid", "34001234"),
        ("https://pubmed.ncbi.nlm.nih.gov/34001234/", "pmid", "34001234"),
        ("PMC8123456", "pmcid", "PMC8123456"),
        ("https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8123456/", "pmcid", "PMC8123456"),
        ("2101.00001v2", "arxiv", "2101.00001"),
        ("arXiv:2101.00001", "arxiv", "2101.00001"),
        ("https://arxiv.org/abs/2101.00001v3", "arxiv", "2101.00001"),
        ("hep-th/9901001", "arxiv", "hep-th/9901001"),
    ],
)
def test_parse_identifier(raw, kind, value):
    assert parse_identifier(raw) == Identifier(kind, value)


@pytest.mark.parametrize("raw", ["", "hello world", "not-a-doi", "PMC"])
def test_parse_identifier_rejects_garbage(raw):
    assert parse_identifier(raw) is None
    assert normalize_doi(raw) is None


def test_provider_mappers_produce_normalised_works():
    crossref = Crossref.to_work(fx.CROSSREF_WORK)
    assert crossref.doi == fx.DOI
    assert crossref.authors[0].family == "Namaganda" and crossref.authors[0].orcid == "0000-0002-1825-0097"
    assert crossref.abstract.startswith("Bed net distribution")  # JATS stripped
    assert crossref.year == 2021 and crossref.work_type == "article-journal"

    openalex = OpenAlex.to_work(fx.OPENALEX_WORK)
    assert openalex.abstract == "Bed nets reduced malaria incidence."  # inverted index rebuilt in order
    assert openalex.pmid == "34001234" and openalex.pmcid == "PMC8123456"
    assert openalex.is_open_access and openalex.oa_pdf_url

    [pubmed] = PubMed.parse_articles(fx.PUBMED_EFETCH)
    assert pubmed.pmid == "34001234" and pubmed.doi == fx.DOI
    assert "BACKGROUND: Malaria causes" in pubmed.abstract
    assert pubmed.publication_date.month == 6
    assert not pubmed.title.endswith(".")

    [arxiv] = ArXiv.parse_feed(fx.ARXIV_FEED)
    assert arxiv.arxiv_id == "2101.00001" and arxiv.oa_pdf_url == "https://arxiv.org/pdf/2101.00001"


def test_merge_fills_gaps_without_overwriting():
    a = ScholarlyWork(title="T", doi="10.1/x", sources=["crossref"], citation_count=3)
    b = ScholarlyWork(
        title="Other title", doi="10.1/x", abstract="An abstract", pmid="1", sources=["pubmed"], citation_count=9
    )
    merged = merge_works(a, b)
    assert merged.title == "T" and merged.abstract == "An abstract" and merged.pmid == "1"
    assert merged.citation_count == 9 and merged.sources == ["crossref", "pubmed"]


async def test_federated_search_dedupes_across_providers(registries):
    works, statuses = await federated_search("malaria bed nets schools")
    assert all(s.ok for s in statuses)
    matching = [w for w in works if w.doi == fx.DOI]
    assert len(matching) == 1, "the same DOI from 4 providers must merge into one result"
    merged = matching[0]
    assert set(merged.sources) >= {"crossref", "openalex", "pubmed", "semantic_scholar"}
    assert merged.pmid == "34001234" and merged.is_open_access
    assert works[0].doi == fx.DOI, "a hit returned by every provider ranks first"


async def test_federated_search_survives_provider_failure(registries):
    registries.get("https://api.openalex.org/works").mock(return_value=httpx.Response(503))
    works, statuses = await federated_search("malaria", providers=["openalex", "crossref"])
    by_name = {s.provider: s for s in statuses}
    assert by_name["openalex"].ok is False and "503" in by_name["openalex"].error
    assert by_name["crossref"].ok is True and works


async def test_resolve_identifier_enriches_from_secondary_sources(registries):
    work = await resolve_identifier(Identifier("doi", fx.DOI))
    assert work.title.startswith("School-based malaria prevention")
    assert work.openalex_id == "W3171234567" and work.oa_pdf_url


async def test_search_endpoint_validation_and_shape(client, registries):
    response = await client.get("/api/v1/discovery/search", params={"q": "malaria", "providers": ["crossref"]})
    assert response.status_code == 200
    body = response.json()
    assert body["providers"] == [{"provider": "crossref", "ok": True, "count": 1, "error": None}]
    assert body["results"][0]["identifier"] == fx.DOI
    assert (await client.get("/api/v1/discovery/search", params={"q": "m"})).status_code == 422
    bad_years = await client.get(
        "/api/v1/discovery/search", params={"q": "malaria", "year_from": 2020, "year_to": 2010}
    )
    assert bad_years.status_code == 422


async def test_search_marks_results_already_in_catalog(client, registries):
    await client.post("/api/v1/papers/import", json={"identifier": fx.DOI}, headers=ALICE)
    body = (
        await client.get("/api/v1/discovery/search", params={"q": "malaria", "providers": ["crossref"]}, headers=ALICE)
    ).json()
    assert body["results"][0]["library_paper_id"] is not None
