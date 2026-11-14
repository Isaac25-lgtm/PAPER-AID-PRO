"""Every discipline: subject-aware sources, open-access sources beyond health, manual (user-supplied) records for
books/law/reports, ISBN pre-fill, and the discipline style catalogue."""

from __future__ import annotations

import re

import httpx

from app.config import get_settings
from app.services.citations.csl import STYLES
from app.services.scholarly.aggregator import default_providers
from app.services.scholarly.providers import DOAJ, EuropePMC
from tests import fixtures as fx
from tests.conftest import ALICE, BOB


def test_default_sources_depend_on_the_subject():
    assert "pubmed" in default_providers("health") and "europe_pmc" in default_providers("life")
    for subject in ("humanities", "social", "physical"):
        chosen = default_providers(subject)
        assert "pubmed" not in chosen and "europe_pmc" not in chosen and "doaj" in chosen
    assert all("arxiv" not in default_providers(s) for s in ("all", "health", "physical"))  # never by default


def test_core_is_used_only_when_its_key_is_configured(monkeypatch):
    assert "core" not in default_providers("all")
    monkeypatch.setattr(get_settings(), "core_api_key", "key")
    assert "core" in default_providers("humanities")


def test_doaj_and_europe_pmc_records_are_mapped():
    doaj = DOAJ.to_work(fx.DOAJ_SEARCH["results"][0])
    assert doaj.doi == "10.5555/archives.2022.12" and doaj.is_open_access and doaj.pages == "10-24"
    assert doaj.oa_pdf_url == "https://example.org/a.pdf" and doaj.authors[0].family == "Achieng"
    preprint = EuropePMC.to_work(fx.EUROPE_PMC_SEARCH["resultList"]["result"][0])
    assert preprint.work_type == "article" and preprint.journal is None  # a preprint, not a journal article
    assert preprint.oa_pdf_url == "https://europepmc.org/x.pdf" and preprint.authors[0].family == "Namaganda"


async def test_subject_filter_reaches_openalex_and_skips_health_sources(client, registries):
    response = await client.get("/api/v1/discovery/search", params={"q": "oral history", "subject": "humanities"})
    assert response.status_code == 200
    providers = [p["provider"] for p in response.json()["providers"]]
    assert providers == ["openalex", "crossref", "semantic_scholar", "doaj"]
    openalex_calls = [c for c in registries.calls if c.request.url.host == "api.openalex.org"]
    assert any("primary_topic.field.id:12" in str(c.request.url.params.get("filter")) for c in openalex_calls)
    s2_calls = [c for c in registries.calls if c.request.url.host == "api.semanticscholar.org"]
    assert any(c.request.url.params.get("fieldsOfStudy") == "History,Art,Philosophy,Linguistics" for c in s2_calls)
    titles = [r["title"] for r in response.json()["results"]]
    assert "Oral history archives in East African universities" in titles


# -------------------------------------------------------------------------------------- manual sources
BOOK = {
    "type": "book",
    "title": "Land, Law and Custom in East Africa",
    "authors": [{"family": "Okoth", "given": "Mary"}],
    "year": 2019,
    "publisher": "Fountain Publishers",
    "place": "Kampala",
    "edition": "2",
    "isbn": "978-9970-02-000-1".replace("-", "")[:13],
}
CASE = {
    "type": "legal_case",
    "title": "Mifumi (U) Ltd v Attorney General",
    "authority": "Supreme Court of Uganda",
    "number": "Constitutional Appeal No. 2 of 2014",
    "year": 2015,
}


async def test_manual_sources_are_private_labelled_and_cite_correctly(client):
    book = await client.post("/api/v1/papers/manual", headers=ALICE, json=BOOK)
    assert book.status_code == 201, book.text
    body = book.json()
    assert body["visibility"] == "private" and body["metadata_source"] == "user" and body["source"] == "manual"
    assert body["csl_extra"]["publisher-place"] == "Kampala" and body["csl_extra"]["edition"] == "2"
    assert (await client.get(f"/api/v1/papers/{body['id']}", headers=BOB)).status_code == 404
    cited = (await client.get(f"/api/v1/papers/{body['id']}/cite", params={"style": "apa"}, headers=ALICE)).json()
    assert (
        "Okoth" in cited["bibliography"]
        and "Fountain Publishers" in cited["bibliography"]
        and "2nd" in cited["bibliography"]
    )
    library = (await client.get("/api/v1/library", headers=ALICE)).json()
    assert library[0]["paper"]["id"] == body["id"]


async def test_court_cases_format_in_a_law_style(client):
    case = (await client.post("/api/v1/papers/manual", headers=ALICE, json=CASE)).json()
    cited = (await client.get(f"/api/v1/papers/{case['id']}/cite", params={"style": "oscola"}, headers=ALICE)).json()
    assert "Mifumi" in cited["in_text"]


async def test_only_your_own_manual_records_can_be_edited(client, registries):
    book = (await client.post("/api/v1/papers/manual", headers=ALICE, json=BOOK)).json()
    edited = await client.put(
        f"/api/v1/papers/{book['id']}/manual", headers=ALICE, json={**BOOK, "title": "Corrected title"}
    )
    assert edited.status_code == 200 and edited.json()["title"] == "Corrected title"
    from tests.conftest import import_doi

    registry_paper = await import_doi(client)
    refused = await client.put(f"/api/v1/papers/{registry_paper['id']}/manual", headers=ALICE, json=BOOK)
    assert refused.status_code == 403


async def test_manual_input_is_validated(client):
    bad = await client.post("/api/v1/papers/manual", headers=ALICE, json={**BOOK, "isbn": "12345"})
    assert bad.status_code == 422
    bad_url = await client.post("/api/v1/papers/manual", headers=ALICE, json={**BOOK, "url": "javascript:alert(1)"})
    assert bad_url.status_code == 422


async def test_isbn_prefills_a_book_from_open_library(client, registries):
    registries.get(re.compile(r"https://openlibrary\.org/api/books.*")).mock(
        return_value=httpx.Response(
            200,
            json={
                "ISBN:9780199535569": {
                    "title": "Pride and Prejudice",
                    "authors": [{"name": "Jane Austen"}],
                    "publishers": [{"name": "Oxford University Press"}],
                    "publish_date": "2008",
                }
            },
        )
    )
    found = (await client.get("/api/v1/papers/lookup/isbn/978-0-19-953556-9", headers=ALICE)).json()
    assert found["title"] == "Pride and Prejudice" and found["year"] == 2008
    assert (
        found["authors"] == [{"family": "Austen", "given": "Jane"}] and found["publisher"] == "Oxford University Press"
    )
    assert (await client.get("/api/v1/papers/lookup/isbn/123", headers=ALICE)).status_code == 422


async def test_style_catalogue_covers_disciplines(client):
    styles = (await client.get("/api/v1/citations/styles")).json()
    groups = {s["group"] for s in styles}
    assert {"Law", "Social sciences", "Humanities", "Health & life sciences", "Engineering & computing"} <= groups
    assert next(s for s in styles if s["id"] == "bluebook")["has_bibliography"] is False
    assert len(styles) == len(STYLES) == 18
