"""Spelling correction for scholarly searches: corrected only when the literature confirms it, never a correct
word, an acronym or another language; the person can always search exactly what they typed."""

import re

import httpx
import pytest
import respx

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


async def test_a_typo_that_shares_a_stem_with_common_words_is_still_corrected():
    # Stemmed search counted "feding" as 4 million papers ("fed..."); exact counts give 146 against 900,930.
    with respx.mock() as router:
        mock_services(router, "school feeding")
        assert await suggest_correction("school feding") == "school feeding"


async def test_capitals_are_respected_whichever_query_arrives_first():
    """'MALRIA' (all capitals, treated like an acronym) is never corrected, even after 'malria' was (audit F08)."""
    for order in (("malria study", "MALRIA study"), ("MALRIA study", "malria study")):
        spelling._cache.clear()
        with respx.mock(assert_all_called=False) as router:
            mock_services(router, "malaria study")
            first, second = [await suggest_correction(q) for q in order]
        results = dict(zip(order, (first, second), strict=True))
        assert results["malria study"] == "malaria study"
        assert results["MALRIA study"] is None


async def test_a_rare_correct_term_is_left_alone():
    with respx.mock(assert_all_called=False) as router:
        mock_services(router, "praziquantel trials", counts={"prazikwantel": 0, "praziquantel": 9_000})
        assert await suggest_correction("praziquantel trials") is None  # already spelled right: nothing to change


async def test_a_refused_spelling_request_is_not_remembered_as_no_correction():
    """A 503 from ESpell must not hide corrections after the service recovers (audit F13)."""
    with respx.mock() as router:
        espell = router.get(re.compile(r"https://eutils\.ncbi\.nlm\.nih\.gov/.*/espell\.fcgi.*"))
        espell.side_effect = [
            httpx.Response(503),
            httpx.Response(
                200, text="<eSpellResult><CorrectedQuery>malaria prevention</CorrectedQuery></eSpellResult>"
            ),
        ]

        def count(request):
            word = request.url.params["filter"].removeprefix("title_and_abstract.search.exact:")
            return httpx.Response(200, json={"meta": {"count": COUNTS.get(word, 0)}, "results": []})

        router.get("https://api.openalex.org/works").mock(side_effect=count)
        assert await suggest_correction("malria preventon") is None  # unavailable: searched as typed
        assert await suggest_correction("malria preventon") == "malaria prevention"  # recovered
        assert espell.call_count == 2


async def test_healthy_answers_are_cached_and_expire(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(spelling.time, "monotonic", lambda: clock[0])
    with respx.mock() as router:
        espell = router.get(re.compile(r"https://eutils\.ncbi\.nlm\.nih\.gov/.*/espell\.fcgi.*")).mock(
            return_value=httpx.Response(200, text="<eSpellResult><CorrectedQuery></CorrectedQuery></eSpellResult>")
        )
        assert await suggest_correction("malaria prevention") is None
        assert await suggest_correction("malaria prevention") is None
        assert espell.call_count == 1  # a healthy "nothing to correct" is remembered...
        clock[0] += spelling._NO_CHANGE_TTL + 1
        assert await suggest_correction("malaria prevention") is None
        assert espell.call_count == 2  # ...for a bounded time


async def test_a_slow_spelling_check_never_holds_up_the_results(client, registries, monkeypatch):
    import asyncio
    import time as clock

    from app.api.routes import discovery

    async def slow(query: str) -> str:
        await asyncio.sleep(30)
        return "never used"

    monkeypatch.setattr(discovery, "suggest_correction", slow)
    monkeypatch.setattr(discovery, "SPELLING_GRACE_SECONDS", 0.05)
    started = clock.monotonic()
    body = (await client.get("/api/v1/discovery/search", params={"q": "malaria"})).json()
    assert clock.monotonic() - started < 10 and body["corrected_from"] is None and body["results"]


async def test_a_correction_that_finds_nothing_keeps_the_typed_results(client, registries, monkeypatch):
    from app.api.routes import discovery

    async def useless(query: str) -> str:
        return "zzqx wqvv"

    async def fake_search(query, **_):
        from app.services.scholarly.models import ProviderStatus, ScholarlyWork

        works = [] if query == "zzqx wqvv" else [ScholarlyWork(title="Malaria in schools", doi="10.1/x")]
        return works, [ProviderStatus(provider="openalex", ok=True, count=len(works))]

    monkeypatch.setattr(discovery, "suggest_correction", useless)
    monkeypatch.setattr(discovery, "federated_search", fake_search)
    body = (await client.get("/api/v1/discovery/search", params={"q": "malaria"})).json()
    assert body["query"] == "malaria" and body["corrected_from"] is None
    assert [r["title"] for r in body["results"]] == ["Malaria in schools"]


async def test_words_espell_merges_or_splits_are_checked_one_at_a_time():
    """Production run, 25 November 2026: ESpell turned "malria vacine in children" into "malaria vac n in children".
    The split word made the whole suggestion unusable, so nothing was corrected. Each such word is now asked about
    alone, and still confirmed against the literature."""
    answers = {
        "malria vacine in children": "malaria vac n in children",
        "malria": "malaria",
        "vacine": "vaccine",
    }
    counts = {**COUNTS, "vacine": 120, "vaccine": 1_500_000}

    def espell(request: httpx.Request) -> httpx.Response:
        corrected = answers.get(request.url.params["term"], "")
        return httpx.Response(200, text=f"<eSpellResult><CorrectedQuery>{corrected}</CorrectedQuery></eSpellResult>")

    def count(request: httpx.Request) -> httpx.Response:
        word = request.url.params["filter"].removeprefix("title_and_abstract.search.exact:")
        return httpx.Response(200, json={"meta": {"count": counts.get(word, 0)}, "results": []})

    with respx.mock() as router:
        router.get(re.compile(r"https://eutils\.ncbi\.nlm\.nih\.gov/.*/espell\.fcgi.*")).mock(side_effect=espell)
        router.get("https://api.openalex.org/works").mock(side_effect=count)
        assert await suggest_correction("malria vacine in children") == "malaria vaccine in children"
    assert spelling.unaligned_words("malria vacine in children", "malaria vac n in children") == [0, 1]
    assert spelling.unaligned_words("malaria vaccine", "malaria vaccine") == []  # nothing extra for a clean query
