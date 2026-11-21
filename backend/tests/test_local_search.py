"""Searching the app's own records (catalogue, library, a paper's passages) forgives typos from the records' own
words, says when it did, and offers the exact words (Deep Research audit F05, F09; Q1, Q2)."""

from urllib.parse import unquote

from tests.conftest import ALICE, BOB, STUDY_SECTIONS, import_doi, make_pdf


async def upload(client, title: str, headers=ALICE) -> dict:
    response = await client.post(
        "/api/v1/papers/upload",
        headers=headers,
        data={"title": title},
        files={"file": ("p.pdf", make_pdf(STUDY_SECTIONS, title=title), "application/pdf")},
    )
    assert response.status_code == 201, response.text
    return response.json()


# ------------------------------------------------------------------------------------------- catalogue (F05)
async def test_catalog_corrects_typos_from_its_own_titles_without_calling_outside_services(client, registries):
    await import_doi(client)  # "School-based malaria prevention with insecticide-treated nets: ..."
    calls_before = len(registries.calls)
    exact = (await client.get("/api/v1/papers", params={"q": "malaria prevention"})).json()
    typo = (await client.get("/api/v1/papers", params={"q": "malria preventon"})).json()  # signed out
    literal = (await client.get("/api/v1/papers", params={"q": "malria preventon", "exact": "true"})).json()
    nothing = (await client.get("/api/v1/papers", params={"q": "zzqx"})).json()
    assert len(registries.calls) == calls_before  # no spelling service, no OpenAlex quota spent on a catalogue miss
    assert exact["total"] == 1 and exact["matched_query"] is None
    assert typo["total"] == 1 and typo["matched_query"] == "malaria prevention"
    assert literal["total"] == 0 and literal["matched_query"] is None
    assert nothing["total"] == 0 and nothing["matched_query"] is None


async def test_catalog_corrections_never_learn_from_other_peoples_private_titles(client, registries):
    await upload(client, "Fetal exposure cohort", headers=BOB)  # private to Bob
    anonymous = (await client.get("/api/v1/papers", params={"q": "fetel exposure"})).json()
    alice = (await client.get("/api/v1/papers", params={"q": "fetel exposure"}, headers=ALICE)).json()
    bob = (await client.get("/api/v1/papers", params={"q": "fetel exposure"}, headers=BOB)).json()
    assert anonymous["total"] == 0 and anonymous["matched_query"] is None
    assert alice["total"] == 0 and alice["matched_query"] is None  # Bob's title is not even a spelling hint
    assert bob["total"] == 1 and bob["matched_query"] == "fetal exposure"


# --------------------------------------------------------------------------------------------- library (F09)
async def library(client, q: str, **params):
    response = await client.get("/api/v1/library", params={"q": q, **params}, headers=ALICE)
    assert response.status_code == 200, response.text
    matched = response.headers.get("x-matched-query")
    return [i["paper"]["title"] for i in response.json()], (unquote(matched) if matched else None)


async def test_library_filter_matches_words_in_any_order_and_says_when_it_corrected(client, registries):
    await import_doi(client)  # "School-based malaria prevention with insecticide-treated nets: ..."
    assert (len((await library(client, "malaria trial"))[0]), (await library(client, "malaria trial"))[1]) == (1, None)
    titles, matched = await library(client, "malria randomsed")
    assert len(titles) == 1 and matched == "malaria randomised"  # visible, not silent
    assert await library(client, "malria randomsed", exact="true") == ([], None)  # the exact words, as asked
    assert await library(client, "zzqx") == ([], None)  # nothing close: nothing invented
    assert await library(client, "100%_") == ([], None)  # wildcards typed by the person are plain text


async def test_a_different_research_term_is_shown_as_a_substitution_and_can_be_refused(client):
    await upload(client, "Metal exposure in miners")
    titles, matched = await library(client, "fetal exposure")
    assert titles == ["Metal exposure in miners"] and matched == "metal exposure"  # the screen must say so
    assert await library(client, "fetal exposure", exact="true") == ([], None)


async def test_corrected_library_searches_still_page(client):
    for n in range(3):
        await upload(client, f"Household savings study {n}")
    response = await client.get("/api/v1/library", params={"q": "houshold savings", "limit": 2}, headers=ALICE)
    assert response.headers["x-total-count"] == "3" and len(response.json()) == 2
    second = await client.get(
        "/api/v1/library", params={"q": "houshold savings", "limit": 2, "offset": 2}, headers=ALICE
    )
    assert len(second.json()) == 1 and unquote(second.headers["x-matched-query"]) == "household savings"


# ------------------------------------------------------------------------------------------------ passages (Q1)
async def test_searching_inside_a_paper_forgives_typos_using_the_papers_own_words(client):
    paper = await upload(client, "Study")
    url = f"/api/v1/papers/{paper['id']}/passages"
    exact = (await client.get(url, params={"q": "absenteeism"}, headers=ALICE)).json()
    assert exact and all(h["matched_query"] is None for h in exact)
    typo = (await client.get(url, params={"q": "absenteism malria"}, headers=ALICE)).json()
    assert typo and {h["matched_query"] for h in typo} == {"absenteeism malaria"}
    assert (await client.get(url, params={"q": "zzqx wqvv"}, headers=ALICE)).json() == []
