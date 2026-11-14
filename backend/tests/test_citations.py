"""Citation styles (all 10 via citeproc-js), formatting by identifier, and Crossref reference verification."""

import httpx
import pytest

from app.services.citations.csl import STYLES, format_citations
from tests import fixtures as fx
from tests.conftest import import_doi

ITEM = {
    "id": "x",
    "type": "article-journal",
    "title": "Deep learning for lesion classification",
    "author": [
        {"family": "Smith", "given": "Jane A."},
        {"family": "Okello", "given": "Peter"},
        {"family": "Ng", "given": "Lee"},
    ],
    "issued": {"date-parts": [[2021, 5, 3]]},
    "container-title": "Journal of Imaging",
    "volume": "7",
    "issue": "5",
    "page": "80-91",
    "DOI": "10.3390/jimaging7050080",
}

EXPECTED_IN_TEXT = {
    "apa": "(Smith et al., 2021, p. 85)",
    "mla": "(Smith et al. 85)",
    "chicago-author-date": "(Smith et al. 2021, 85)",  # CMOS 18: 3+ authors -> et al.
    "harvard": "(Smith, Okello and Ng, 2021, p. 85)",
    "ieee": "[1, p. 85]",
    "vancouver": "(1)",
    "ama": "1(p85)",
}


@pytest.mark.parametrize("style", sorted(STYLES))
async def test_every_bundled_style_formats(style):
    result = await format_citations(
        [ITEM], style=style, clusters=[[{"id": "x", "locator": "85", "label": "page"}]], output="text"
    )
    assert result.citations[0].strip()
    if STYLES[style].has_bibliography:
        assert "Journal of Imaging" in result.bibliography[0]
    else:  # footnote-only style: the full reference is in the note itself
        assert result.bibliography == [] and "Journal of Imaging" in result.citations[0]
    if style in EXPECTED_IN_TEXT:
        assert result.citations[0] == EXPECTED_IN_TEXT[style]


async def test_numeric_styles_number_in_citation_order_and_author_date_sorts_alphabetically():
    items = [{**ITEM, "id": "a"}, {**ITEM, "id": "b", "title": "Another study", "author": [{"family": "Adams"}]}]
    numeric = await format_citations(items, style="vancouver", clusters=[[{"id": "b"}], [{"id": "a"}]], output="text")
    assert numeric.citations == ["(1)", "(2)"] and numeric.bibliography[0].startswith("1. Adams")
    apa = await format_citations(items, style="apa", clusters=[[{"id": "a"}], [{"id": "b"}]], output="text")
    assert apa.bibliography[0].startswith("Adams")


async def test_styles_endpoint(client):
    styles = (await client.get("/api/v1/citations/styles")).json()
    assert {s["id"] for s in styles} == set(STYLES)


async def test_format_endpoint_by_identifier_and_paper(client, registries):
    paper = await import_doi(client)
    body = (
        await client.post(
            "/api/v1/citations/format",
            json={
                "paper_ids": [paper["id"]],
                "identifiers": [fx.DOI, "10.9999/unknown"],
                "style": "apa",
                "output": "text",
            },
        )
    ).json()
    assert body["unresolved"] == ["10.9999/unknown"]
    # The paper id and its DOI name the same work: formatted once (no spurious 2021a/2021b).
    assert [e["in_text"] for e in body["entries"]] == ["(Namaganda et al., 2021)"]
    bad = await client.post("/api/v1/citations/format", json={"identifiers": [fx.DOI], "style": "nope"})
    assert bad.status_code == 422


async def test_reference_verification_verdicts(client, registries):
    good = (
        "Namaganda G, Okello P. School-based malaria prevention with insecticide-treated nets: a cluster "
        "randomised trial. Malaria Journal. 2021;20:212. doi:10.1186/s12936-021-03812-x"
    )
    wrong_doi = "Brown A. Quantum effects in superconductors. Physical Review. 2010. doi:10.1186/s12936-021-03812-x"
    registries.get("https://api.crossref.org/works").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": {
                    "items": [
                        {
                            "DOI": "10.1/zz",
                            "title": ["Completely unrelated topic about soil chemistry"],
                            "issued": {"date-parts": [[1999]]},
                        }
                    ]
                }
            },
        )
    )
    invented = "Doe J. A fabricated paper about invisible unicorns. Journal of Imaginary Results. 2022;1:1-2."
    results = (await client.post("/api/v1/citations/verify", json={"references": [good, wrong_doi, invented]})).json()
    verdicts = [r["verdict"] for r in results["results"]]
    assert verdicts == ["verified", "mismatch", "not_found"]
    assert results["results"][0]["match"]["doi"] == fx.DOI


async def test_arxiv_preprints_use_preprint_form_and_arxiv_doi():
    from app.services.papers import work_to_csl_json
    from app.services.scholarly.models import ScholarlyWork, WorkAuthor

    work = ScholarlyWork(
        title="Attention is all you need",
        authors=[WorkAuthor(name="Ashish Vaswani", family="Vaswani", given="Ashish")],
        year=2017,
        arxiv_id="1706.03762",
        work_type="article",
    )
    item = work_to_csl_json(work, "v")
    assert item["DOI"] == "10.48550/arxiv.1706.03762" and item["publisher"] == "arXiv" and "container-title" not in item
    apa = await format_citations([item], style="apa", clusters=[[{"id": "v"}]], output="text")
    assert apa.bibliography[0].startswith("Vaswani, A. (2017). Attention is all you need")
    assert "arXiv" in apa.bibliography[0] and "https://doi.org/10.48550/arxiv.1706.03762" in apa.bibliography[0]
    assert " In arXiv" not in apa.bibliography[0]
