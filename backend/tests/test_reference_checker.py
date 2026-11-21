"""Reference checker: honest verdicts for ordinary citation checking (Deep Research audit F02-F04, F10).

A resolved DOI is never called a mismatch just because the reference gives nothing to compare; a bibliography
number never counts as the first author; a registry outage never discards another registry's match and never
turns into "not found"; oversized input is refused before any registry is asked."""

import re

import httpx
import respx

from app.errors import UpstreamError
from tests.conftest import ALICE

DOI = "10.1234/school.2017.1"
SCHOOL_CROSSREF = {
    "DOI": DOI,
    "title": ["School attendance and household income"],
    "author": [{"given": "Alice", "family": "Smith"}],
    "issued": {"date-parts": [[2017]]},
    "container-title": ["Journal of Education"],
}
SCHOOL_OPENALEX = {
    "id": "https://openalex.org/W1",
    "doi": f"https://doi.org/{DOI}",
    "title": "School attendance and household income",
    "publication_year": 2017,
    "authorships": [{"author": {"display_name": "Alice Smith"}}],
    "ids": {},
}
ATTENTION_OA = {
    "id": "https://openalex.org/W2963403868",
    "doi": "https://doi.org/10.48550/arxiv.1706.03762",
    "title": "Attention Is All You Need",
    "publication_year": 2017,
    "authorships": [{"author": {"display_name": "Ashish Vaswani"}}, {"author": {"display_name": "Noam Shazeer"}}],
    "primary_location": {"source": {"display_name": "arXiv (Cornell University)"}},
    "ids": {},
}


def crossref_doi(router, status=200, item=SCHOOL_CROSSREF):
    route = router.get(re.compile(r"https://api\.crossref\.org/works/10\..*"))
    body = {"message": item} if status == 200 else {}
    return route.mock(return_value=httpx.Response(status, json=body))


def openalex_doi(router, status=200, item=SCHOOL_OPENALEX):
    route = router.get(re.compile(r"https://api\.openalex\.org/works/doi:.*"))
    return route.mock(return_value=httpx.Response(status, json=item if status == 200 else {}))


def search_results(router, crossref_items, openalex_results=None, openalex_status=200):
    router.get("https://api.crossref.org/works").mock(
        return_value=httpx.Response(200, json={"message": {"items": crossref_items}})
    )
    router.get("https://api.openalex.org/works").mock(
        return_value=httpx.Response(openalex_status, json={"results": openalex_results or []})
    )


async def check(client, *references):
    response = await client.post("/api/v1/citations/verify", json={"references": list(references)}, headers=ALICE)
    assert response.status_code == 200, response.text
    return response.json()["results"]


# --------------------------------------------------------------------------------------------- F02: bare DOI
async def test_a_bare_doi_or_its_link_is_registered_not_a_different_publication(client):
    with respx.mock() as router:
        crossref_doi(router)
        bare, link = await check(client, f"doi:{DOI}", f"https://doi.org/{DOI}")
    unchecked = {"title": "not checked", "year": "not checked", "first_author": "not checked"}
    for result in (bare, link):
        assert result["verdict"] == "registered", result
        assert result["checks"]["fields"] == unchecked
        assert "different publication" not in result["explanation"]
        assert result["match"]["title"] == "School attendance and household income"


async def test_a_doi_beside_a_conflicting_title_is_still_a_different_publication(client):
    with respx.mock() as router:
        crossref_doi(router)
        [result] = await check(client, f"Brown A. Quantum effects in superconductors. Physical Review. 2010. doi:{DOI}")
    assert result["verdict"] == "mismatch" and result["via_doi"] is True
    assert result["checks"]["fields"]["title"] == "does not match"
    assert "different publication" in result["explanation"]


async def test_a_doi_with_author_and_year_but_no_title_is_not_a_conflict(client):
    with respx.mock() as router:
        crossref_doi(router)
        [result] = await check(client, f"Smith A (2017) doi:{DOI}")
    assert result["verdict"] == "likely_match"
    assert result["checks"]["fields"]["title"] == "not checked"


# ------------------------------------------------------------------------------------ F03: list numbering
async def test_the_list_number_never_counts_as_the_first_author(client):
    body = "Smith A. School attendance and household income. Journal of Education. 2017."
    with respx.mock(assert_all_called=False) as router:
        search_results(router, [SCHOOL_CROSSREF])
        results = await check(client, f"1. {body}", f"10. {body}", f"[12] {body}", f"(3) {body}")
    assert [r["verdict"] for r in results] == ["verified"] * 4
    assert len({str(r["checks"]["fields"]) for r in results}) == 1  # identical field results whatever the number


async def test_a_wrong_year_without_a_doi_is_reported_as_a_wrong_year(client):
    with respx.mock(assert_all_called=False) as router:
        search_results(router, [SCHOOL_CROSSREF])
        [result] = await check(client, "12. Smith A. School attendance and household income. 2019.")
    assert result["verdict"] == "mismatch" and result["via_doi"] is False
    assert result["checks"]["fields"] == {"title": "matched", "year": "does not match", "first_author": "matched"}
    assert "year wrong" in result["explanation"]


# ---------------------------------------------------------------------------------- F04: registry outages
async def test_an_openalex_refusal_keeps_the_crossref_match(client):
    reference = "Smith A. School attendance and household income. 2017."
    no_authors = {**SCHOOL_CROSSREF, "author": []}  # Crossref alone cannot verify: OpenAlex is asked too
    with respx.mock() as router:
        search_results(router, [no_authors], openalex_status=429)
        [result] = await check(client, reference)
    assert result["verdict"] == "likely_match" and result["match"]["doi"] == DOI
    assert result["unavailable"] == ["OpenAlex"] and "could not be reached" in result["explanation"]


async def test_one_failing_title_search_keeps_the_other(monkeypatch):
    from app.services.citations import verify

    reference = "Smith A. School attendance and household income. Proceedings of the annual meeting on schooling. 2017."
    calls = []

    async def fake_get_json(url, params=None, **_):
        calls.append(url)
        if "crossref" in url:
            return {"message": {"items": []}}
        if "annual meeting" in params["filter"]:
            raise UpstreamError("api.openalex.org returned HTTP 429.")
        return {"results": [SCHOOL_OPENALEX]}

    monkeypatch.setattr(verify, "get_json", fake_get_json)
    result = await verify.verify_reference(reference)
    assert len(calls) == 3  # Crossref, then both title segments
    assert result["verdict"] == "verified" and result["unavailable"] == ["OpenAlex"]


async def test_a_doi_registry_outage_still_tries_the_other_registry(client):
    with respx.mock() as router:
        crossref_doi(router, status=503)
        openalex_doi(router)
        [result] = await check(client, f"Smith A. School attendance and household income. 2017. doi:{DOI}")
    assert result["verdict"] == "verified" and result["unavailable"] == ["Crossref"]


async def test_when_no_registry_can_be_reached_it_says_so_instead_of_not_found(client):
    with respx.mock() as router:
        crossref_doi(router, status=503)
        openalex_doi(router, status=429)
        router.get("https://api.crossref.org/works").mock(return_value=httpx.Response(503))
        router.get("https://api.openalex.org/works").mock(return_value=httpx.Response(429))
        doi_result, search_result = await check(
            client, f"doi:{DOI}", "Doe J. A paper about invisible unicorns and their habits. 2022."
        )
    for result in (doi_result, search_result):
        assert result["verdict"] == "error" and result["match"] is None
        assert "could not be reached" in result["explanation"]


# ------------------------------------------------------------------------------------ F10: bounded input
async def test_oversized_references_are_refused_before_any_registry_is_asked(client):
    with respx.mock() as router:  # nothing is mocked: any registry call would fail the test
        long_one = await client.post(
            "/api/v1/citations/verify", json={"references": ["Smith A. " + "word " * 400]}, headers=ALICE
        )
        too_much = await client.post(
            "/api/v1/citations/verify", json={"references": ["Smith A. " + "x" * 1400] * 30}, headers=ALICE
        )
        assert not router.calls
    assert long_one.status_code == 422 and "Reference 1 is longer than 1,500" in long_one.text
    assert too_much.status_code == 422 and "Check it in parts" in too_much.text
    at_limit = "Smith A. " + "x" * (1500 - 9)
    with respx.mock(assert_all_called=False) as router:
        search_results(router, [])
        ok = await client.post("/api/v1/citations/verify", json={"references": [at_limit]}, headers=ALICE)
    assert ok.status_code == 200


# ---------------------------------------------------------- real papers Crossref lacks (from the browser test)
async def test_reference_checker_finds_real_papers_crossref_lacks_and_ignores_years_inside_links():
    from app.services.citations.verify import title_segments, verify_reference

    reference = (
        "Vaswani, A., Shazeer, N., et al. (2017). Attention is all you need. "
        "Advances in Neural Information Processing Systems."
    )
    assert "Attention is all you need" in title_segments(reference)
    assert not any("Shazeer" in s for s in title_segments(reference))  # the author list is not a title
    unrelated = {
        "DOI": "10.9/other",
        "title": ["Tensor Product Attention Is All You Need"],
        "author": [{"family": "Zhang"}],
        "issued": {"date-parts": [[2025]]},
    }
    with respx.mock() as router:
        search_results(router, [unrelated], [ATTENTION_OA])
        result = await verify_reference(reference)
    assert result["verdict"] == "verified" and result["match"]["year"] == 2017  # not "not found"
    with respx.mock() as router:
        router.get(re.compile(r"https://api\.crossref\.org/works/.*")).mock(return_value=httpx.Response(404))
        openalex_doi(router, item=ATTENTION_OA)
        linked = await verify_reference(
            "Vaswani A. Attention is all you need. https://doi.org/10.48550/arXiv.1706.03762"
        )
    assert linked["verdict"] == "likely_match"  # found via OpenAlex; "1706" in the link is not a year
    assert linked["checks"]["fields"]["year"] == "not checked"
