"""Discover after Silver's test (25 November 2026): results arrive as each database answers, a failed database can be
retried without asking the others again, and identifiers typed into the box are looked up exactly."""

import json
import re

import httpx

from tests import fixtures as fx

EUROPE_PMC = re.compile(r"https://www\.ebi\.ac\.uk/europepmc/webservices/rest/search.*")


async def stream(client, **params):
    events = []
    async with client.stream("GET", "/api/v1/discovery/search/stream", params=params) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/x-ndjson")
        async for line in response.aiter_lines():
            if line.strip():
                events.append(json.loads(line))
    return events


def calls_to(registries, host: str) -> int:
    return sum(1 for call in registries.calls if call.request.url.host == host)


async def test_results_arrive_database_by_database(client, registries, monkeypatch):
    from app.api.routes import discovery

    async def no_correction(query):
        return None

    monkeypatch.setattr(discovery, "suggest_correction", no_correction)
    events = await stream(client, q="malaria", subject="health")
    kinds = [e["type"] for e in events]
    assert kinds[0] == "query" and kinds[-1] == "done"
    updates = [e for e in events if e["type"] == "results"]
    expected = len(events[0]["pending"])
    assert len(updates) == expected  # one update per database, as each answers
    assert [len(u["pending"]) for u in updates] == list(range(expected - 1, -1, -1))  # still-searching list shrinks
    assert updates[-1]["results"] and len(updates[-1]["providers"]) == expected


async def test_a_failed_database_keeps_the_others_and_retry_asks_only_it(client, registries, monkeypatch):
    from app.api.routes import discovery

    async def no_correction(query):
        return None

    monkeypatch.setattr(discovery, "suggest_correction", no_correction)
    registries.get(EUROPE_PMC).mock(return_value=httpx.Response(503))
    first = await stream(client, q="malaria", subject="health")
    final = [e for e in first if e["type"] == "results"][-1]
    status = {p["provider"]: p for p in final["providers"]}
    assert status["europe_pmc"]["ok"] is False and status["openalex"]["ok"] is True
    assert final["results"]  # the other databases' results are kept
    openalex_before = calls_to(registries, "api.openalex.org")
    europe_before = calls_to(registries, "www.ebi.ac.uk")
    registries.get(EUROPE_PMC).mock(return_value=httpx.Response(200, json=fx.EUROPE_PMC_SEARCH))
    retry = await stream(client, q="malaria", subject="health")
    assert calls_to(registries, "api.openalex.org") == openalex_before  # answered from the short cache
    assert calls_to(registries, "www.ebi.ac.uk") > europe_before  # only the failed database is asked again
    retried = {p["provider"]: p for p in [e for e in retry if e["type"] == "results"][-1]["providers"]}
    assert retried["europe_pmc"]["ok"] is True


async def test_a_correction_is_announced_before_any_results(client, registries, monkeypatch):
    from app.api.routes import discovery

    async def correct(query):
        return "malaria prevention" if query == "malria preventon" else None

    monkeypatch.setattr(discovery, "suggest_correction", correct)
    events = await stream(client, q="malria preventon")
    assert events[0] == {**events[0], "query": "malaria prevention", "corrected_from": "malria preventon"}
    assert [e for e in events if e["type"] == "results"][-1]["results"]


async def test_exact_mode_searches_as_typed_and_only_suggests(client, registries, monkeypatch):
    from app.api.routes import discovery

    async def correct(query):
        return "malaria prevention"

    monkeypatch.setattr(discovery, "suggest_correction", correct)
    events = await stream(client, q="malria preventon", exact="true")
    assert events[0]["query"] == "malria preventon" and events[0]["corrected_from"] is None
    assert {"type": "suggestion", "query": "malaria prevention"} in events  # offered, never applied


async def test_identifiers_are_looked_up_exactly(client, registries):
    for typed in (f"https://doi.org/{fx.DOI}", f"doi: {fx.DOI}", "PMID 34001234", "34001234"):
        body = (await client.get("/api/v1/discovery/search", params={"q": typed})).json()
        assert body["identifier"] in {"doi", "pmid"}, typed
        assert len(body["results"]) == 1 and body["results"][0]["doi"] == fx.DOI, typed
        assert body["corrected_from"] is None and body["providers"] == []
    events = await stream(client, q=f"https://doi.org/{fx.DOI}")
    assert events[0]["identifier"] == "doi" and [e["type"] for e in events] == ["query", "results", "done"]
    assert events[1]["results"][0]["doi"] == fx.DOI


async def test_a_year_or_a_word_is_never_treated_as_an_identifier(client, registries, monkeypatch):
    from app.api.routes import discovery

    async def no_correction(query):
        return None

    monkeypatch.setattr(discovery, "suggest_correction", no_correction)
    for typed in ("2019", "malaria 2019"):
        body = (await client.get("/api/v1/discovery/search", params={"q": typed})).json()
        assert body["identifier"] is None and body["providers"], typed
