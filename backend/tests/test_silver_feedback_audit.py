"""Regressions for the Silver-feedback audit (docs/PAPERAID_V2_SILVER_FEEDBACK_AUDIT.md), one or more per finding,
each through the real entry point (HTTP route or the service a route calls)."""

from __future__ import annotations

from sqlalchemy import select

from app.config import get_settings
from app.db.models import PaperChunk
from app.db.session import get_sessionmaker
from app.services.ai.providers import set_embedder
from tests.conftest import ALICE, BOB, make_pdf

STUDY = {
    "Abstract": "School feeding reduced pupil absenteeism in rural districts.",
    "Methods": "We followed 1,200 pupils for two terms and recorded absenteeism and attendance days.",
    "Results": "Absenteeism fell by 12 pupil days per term in schools with daily meals.",
}


class RecordingEmbedder:
    """Records every text sent for embedding, so a test can prove what left (or never left) PaperAid."""

    model = "recording-embedder"

    def __init__(self) -> None:
        self.calls: list[tuple[str, list[str]]] = []

    async def embed(self, texts: list[str], *, task: str) -> list[list[float]]:
        self.calls.append((task, list(texts)))
        return [[1.0] + [0.0] * 1535 for _ in texts]


# ---------------------------------------------------------------------------------------------------- SF01
async def _upload(client, headers) -> str:  # type: ignore[no-untyped-def]
    response = await client.post(
        "/api/v1/papers/upload", headers=headers, files={"file": ("s.pdf", make_pdf(STUDY), "application/pdf")}
    )
    assert response.status_code in (200, 201), response.text
    return response.json()["id"]


async def test_sf01_non_pilot_private_text_and_queries_never_reach_the_embedder(client, monkeypatch):
    """A researcher outside the AI cohort uploads a private PDF and searches it: nothing is sent to the
    embedding provider, keyword search still works, and no chunk gets a vector."""
    monkeypatch.setattr(get_settings(), "ai_access", "pilot")
    monkeypatch.setattr(get_settings(), "ai_pilot_emails", "bob@example.edu")
    embedder = RecordingEmbedder()
    set_embedder(embedder)

    paper_id = await _upload(client, ALICE)
    hits = (await client.get(f"/api/v1/papers/{paper_id}/passages", params={"q": "absenteeism"}, headers=ALICE)).json()

    assert hits and "absenteeism" in hits[0]["text"].lower()  # keyword search is unaffected
    assert embedder.calls == []  # neither the PDF's text nor the query left PaperAid
    async with get_sessionmaker()() as db:
        chunks = (await db.execute(select(PaperChunk).where(PaperChunk.paper_id == paper_id))).scalars().all()
    assert chunks and all(c.embedding is None for c in chunks)


async def test_sf01_a_pilot_researcher_still_gets_embeddings(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_access", "pilot")
    monkeypatch.setattr(get_settings(), "ai_pilot_emails", "bob@example.edu")
    embedder = RecordingEmbedder()
    set_embedder(embedder)

    paper_id = await _upload(client, BOB)
    await client.get(f"/api/v1/papers/{paper_id}/passages", params={"q": "absenteeism"}, headers=BOB)

    tasks = [task for task, _ in embedder.calls]
    assert "document" in tasks and "query" in tasks
    async with get_sessionmaker()() as db:
        chunks = (await db.execute(select(PaperChunk).where(PaperChunk.paper_id == paper_id))).scalars().all()
    assert chunks and all(c.embedding is not None for c in chunks)


# ---------------------------------------------------------------------------------------------------- SF03
SF03_ENTRIES = [
    "World Bank. (2020). Appendix [A](12): survey instruments. Washington, DC.",  # bracket then parenthesis
    "Smith, J. (2019). ~~Draft~~ notes on 1990--2000 trends **as typed**. https://example.org/a?x=1&y=2.",
    "Ng, A. (2021). A DOI with brackets. https://doi.org/10.1002/(SICI)1097-0258(19980815)17:15&lt;1661::AID-SIM968&gt;3.0.CO;2-2",
    "Müller, Ł. (2022). Résumé of Ελληνικά sources. https://doi.org/10.1126/science.aah5309.",
]


def _pdf_links_and_text(data: bytes) -> tuple[list[str], str]:
    import io

    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    uris = [
        a.get_object()["/A"]["/URI"]
        for page in reader.pages
        for a in page.get("/Annots") or []
        if a.get_object().get("/A", {}).get("/URI")
    ]
    # A long address wrapped over two lines has one clickable area per line: keep each destination once, in order.
    distinct = [uri for i, uri in enumerate(uris) if i == 0 or uris[i - 1] != uri]
    return distinct, " ".join(page.extract_text() for page in reader.pages)


def test_sf03_literal_reference_text_survives_pdf_and_word_with_correct_links():
    """Ordinary bracketed notation, tildes, double hyphens and asterisks are text, not markup; the PDF is written
    without error and every address links to exactly the right destination (query string, brackets, Unicode)."""
    import io

    from docx import Document as Docx

    from app.services.export import to_docx, to_pdf

    content = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Body [1](2) -- ~~kept~~ **as typed**."}]}
        ],
    }
    rendered = {"clusters": [], "bibliography": SF03_ENTRIES}

    uris, text = _pdf_links_and_text(to_pdf("T", content, rendered))  # used to raise on the first entry
    assert uris == [
        "https://example.org/a?x=1&y=2",
        "https://doi.org/10.1002/(SICI)1097-0258(19980815)17:15<1661::AID-SIM968>3.0.CO;2-2",
        "https://doi.org/10.1126/science.aah5309",
    ]
    flat = " ".join(text.split())
    for literal in [
        "Appendix [A](12)",
        "~~Draft~~",
        "1990--2000",
        "**as typed**",
        "Body [1](2) -- ~~kept~~",
        "Müller, Ł.",
    ]:
        assert literal in flat, literal

    word = Docx(io.BytesIO(to_docx("T", content, rendered)))
    targets = [rel.target_ref for rel in word.part.rels.values() if rel.is_external]
    assert targets == uris  # Word and PDF agree on every destination
    assert "Appendix [A](12): survey instruments" in "\n".join(p.text for p in word.paragraphs)


def test_sf03_shared_link_fixtures():
    """The same cases as frontend citationLinks.test.tsx (trimUrl): the two detectors must agree."""
    from app.services.export import split_links

    cases = {
        "See <https://example.org/a>.": "https://example.org/a",
        "(https://doi.org/10.1/x)": "https://doi.org/10.1/x",
        "https://doi.org/10.1002/(SICI)1097-0258(19980815)17:15<1661::AID-SIM968>3.0.CO;2-2.": (
            "https://doi.org/10.1002/(SICI)1097-0258(19980815)17:15<1661::AID-SIM968>3.0.CO;2-2"
        ),
        "https://example.org/a?x=1&y=2,": "https://example.org/a?x=1&y=2",
        "[https://example.org/b]": "https://example.org/b",
    }
    for text, url in cases.items():
        assert [part for part, is_link in split_links(text) if is_link] == [url], text


# ---------------------------------------------------------------------------------------------------- SF04
class OpenOnlyWhenAsked:
    """A database whose unrestricted first page holds only a closed paper; asked for open access, it returns an
    open one (as OpenAlex does with its is_oa filter)."""

    def __init__(self) -> None:
        self.flags: list[bool] = []

    async def search(self, query, limit, year_from, year_to, open_access_only, subject=None):  # type: ignore[no-untyped-def]
        from app.services.scholarly.models import ScholarlyWork

        self.flags.append(open_access_only)
        if open_access_only:
            return [ScholarlyWork(title="Open paper on school meals", is_open_access=True, sources=["openalex"])]
        return [ScholarlyWork(title="Closed paper on school meals", is_open_access=False, sources=["openalex"])]


async def _no_correction(query):  # type: ignore[no-untyped-def]
    return None


async def _stream(client, **params):  # type: ignore[no-untyped-def]
    import json

    events = []
    async with client.stream("GET", "/api/v1/discovery/search/stream", params=params) as response:
        assert response.status_code == 200
        async for line in response.aiter_lines():
            if line.strip():
                events.append(json.loads(line))
    return events


async def test_sf04_streamed_and_one_shot_open_access_search_agree(client, monkeypatch):
    from app.api.routes import discovery
    from app.services.scholarly import aggregator

    fake = OpenOnlyWhenAsked()
    monkeypatch.setitem(aggregator.PROVIDERS, "openalex", fake)
    monkeypatch.setattr(discovery, "suggest_correction", _no_correction)
    params = {"q": "school meals", "providers": "openalex", "open_access_only": "true"}

    for _ in range(2):  # cold, then warm cache
        one_shot = (await client.get("/api/v1/discovery/search", params=params)).json()["results"]
        streamed = [e for e in await _stream(client, **params) if e["type"] == "results"][-1]["results"]
        assert [r["title"] for r in streamed] == [r["title"] for r in one_shot] == ["Open paper on school meals"]
    assert fake.flags and all(fake.flags)  # every request asked the database for open access


# ---------------------------------------------------------------------------------------------------- SF07
class LookupOnly:
    """A registry for identifier lookups: finds the paper, has no record, or is down."""

    def __init__(self, outcome: str) -> None:
        self.outcome = outcome

    async def lookup(self, kind, value):  # type: ignore[no-untyped-def]
        from app.errors import UpstreamError
        from app.services.scholarly.models import ScholarlyWork

        if self.outcome == "down":
            raise UpstreamError("The registry is unavailable.")
        if self.outcome == "found":
            return ScholarlyWork(title="The long-run poverty and gender impacts of mobile money", doi=value)
        return None


async def test_sf07_identifier_outcomes_distinguish_outage_from_absence(client, monkeypatch):
    from app.services.scholarly import aggregator

    doi = "10.1126/science.aah5309"
    scenarios = {
        "all down": {"crossref": "down", "openalex": "down", "pubmed": "down", "semantic_scholar": "down"},
        "partial": {"crossref": "miss", "openalex": "down", "pubmed": "miss", "semantic_scholar": "miss"},
        "all miss": {"crossref": "miss", "openalex": "miss", "pubmed": "miss", "semantic_scholar": "miss"},
        "found": {"crossref": "found", "openalex": "down", "pubmed": "miss", "semantic_scholar": "miss"},
    }
    for name, outcomes in scenarios.items():
        for provider, outcome in outcomes.items():
            monkeypatch.setitem(aggregator.PROVIDERS, provider, LookupOnly(outcome))
        one_shot = (await client.get("/api/v1/discovery/search", params={"q": doi})).json()
        events = await _stream(client, q=doi)
        streamed = [e for e in events if e["type"] == "results"][-1]
        assert events[-1]["type"] == "done"
        for body in (one_shot, streamed):
            ok = {p["provider"]: p["ok"] for p in body["providers"]}
            assert ok == {p: o != "down" for p, o in outcomes.items()}, name  # every registry's outcome is reported
            assert len(body["results"]) == (1 if name == "found" else 0), name


# ---------------------------------------------------------------------------------------------------- SF14
async def test_sf14_a_requested_unconfigured_database_is_closed_not_left_searching(client, monkeypatch):
    """CORE needs a key. Asked for explicitly (alone, or with others), it is reported 'not configured' and is never
    among the databases still searching when the stream is done."""
    from app.api.routes import discovery
    from app.services.scholarly import aggregator

    monkeypatch.setattr(discovery, "suggest_correction", _no_correction)
    monkeypatch.setitem(aggregator.PROVIDERS, "openalex", OpenOnlyWhenAsked())
    for providers in (["core"], ["core", "openalex"]):
        events = await _stream(client, q="school meals", providers=providers)
        assert "core" not in events[0]["pending"]  # only what will run is announced
        last = [e for e in events if e["type"] == "results"][-1]
        status = {p["provider"]: p for p in last["providers"]}
        assert status["core"] == {"provider": "core", "ok": False, "count": 0, "error": "not configured"}
        assert last["pending"] == [] and events[-1]["type"] == "done"
        one_shot = (
            await client.get("/api/v1/discovery/search", params={"q": "school meals", "providers": providers})
        ).json()
        assert {"provider": "core", "ok": False, "count": 0, "error": "not configured"} in one_shot["providers"]


# ---------------------------------------------------------------------------------------------------- SF06
class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


async def test_sf06_shared_pace_makes_searches_wait_briefly_and_spelling_yield():
    import pytest

    from app.services.scholarly.pacing import Pacer, ServiceBusy

    clock = FakeClock()
    waits: list[float] = []

    async def queued(seconds: float) -> None:  # the callers are concurrent: time does not move while they queue
        waits.append(seconds)

    pacer = Pacer(name="ncbi", rate=2.0, burst=2, max_wait=1.0, clock=clock, sleep=queued)
    assert await pacer.acquire() and await pacer.acquire()  # the burst
    assert await pacer.acquire(optional=True) is False  # spelling never waits: the searches go first
    assert await pacer.acquire() and await pacer.acquire()  # the next two searches queue behind the burst
    assert waits == [0.5, 1.0]
    with pytest.raises(ServiceBusy):  # a third would wait 1.5 s > max_wait: refused rather than queued forever
        await pacer.acquire()
    clock.now += 10  # the queue has drained
    assert await pacer.acquire()
    pacer.back_off(30)  # the service said Retry-After: 30
    assert await pacer.acquire(optional=True) is False
    with pytest.raises(ServiceBusy):
        await pacer.acquire()
    clock.now += 31
    assert await pacer.acquire()


async def test_sf06_identical_cold_searches_share_one_request():
    import asyncio

    from app.services.scholarly import aggregator

    class Slow:
        calls = 0

        async def search(self, query, limit, year_from, year_to, oa, subject=None):  # type: ignore[no-untyped-def]
            Slow.calls += 1
            await asyncio.sleep(0.05)
            return []

    original = aggregator.PROVIDERS["openalex"]
    aggregator.PROVIDERS["openalex"] = Slow()  # type: ignore[assignment]
    try:
        await asyncio.gather(
            *(aggregator._run_provider("openalex", "school meals", 20, None, None, False) for _ in range(5))
        )
    finally:
        aggregator.PROVIDERS["openalex"] = original
    assert Slow.calls == 1  # five simultaneous people, one upstream request


async def test_sf06_spelling_cost_per_search_is_bounded_and_repeats_are_checked_once():
    import re

    import httpx
    import respx

    from app.services.scholarly import spelling

    typos = "malria malria malria preventon scools feding litrature colera"
    fixed = "malaria malaria malaria prevention schools feeding literature cholera"
    with respx.mock() as router:
        router.get(re.compile(r"https://eutils\.ncbi\.nlm\.nih\.gov/.*/espell\.fcgi.*")).mock(
            return_value=httpx.Response(
                200, text=f"<eSpellResult><CorrectedQuery>{fixed}</CorrectedQuery></eSpellResult>"
            )
        )
        counts = router.get("https://api.openalex.org/works").mock(
            return_value=httpx.Response(200, json={"meta": {"count": 10}, "results": []})
        )
        await spelling.suggest_correction(typos)
    assert counts.call_count <= 2 * spelling.MAX_CONFIRMATIONS  # never one count per word of a long question
    counted = [c.request.url.params["filter"].rsplit(":", 1)[1] for c in counts.calls]
    assert counted.count("malria") == 1  # a repeated typo is confirmed once


async def test_sf06_spelling_yields_when_the_shared_allowance_is_spent():
    import re

    import httpx
    import respx

    from app.services.scholarly import spelling
    from app.services.scholarly.pacing import pacer_for

    pacer = pacer_for(spelling.ESPELL_URL)
    assert pacer is not None
    pacer.back_off(60)  # NCBI asked everyone to wait (or the searches are using the allowance)
    with respx.mock(assert_all_called=False) as router:
        espell = router.get(re.compile(r"https://eutils\.ncbi\.nlm\.nih\.gov/.*")).mock(
            return_value=httpx.Response(
                200, text="<eSpellResult><CorrectedQuery>malaria</CorrectedQuery></eSpellResult>"
            )
        )
        assert await spelling.suggest_correction("malria") is None
    assert espell.call_count == 0 and spelling._cache == {}  # skipped, and not remembered as "nothing to correct"


async def test_sf06_a_long_retry_after_is_not_slept_inside_a_request():
    import time

    import httpx
    import pytest
    import respx

    from app.errors import UpstreamError
    from app.services.scholarly.http import get_json
    from app.services.scholarly.pacing import ServiceBusy

    with respx.mock() as router:
        route = router.get("https://api.openalex.org/works").mock(
            return_value=httpx.Response(429, headers={"Retry-After": "120"})
        )
        started = time.monotonic()
        with pytest.raises(UpstreamError):
            await get_json("https://api.openalex.org/works", params={"search": "x"})
        assert time.monotonic() - started < 1.0 and route.call_count == 1
        with pytest.raises(ServiceBusy):  # and nobody else calls OpenAlex until the 120 s have passed
            await get_json("https://api.openalex.org/works", params={"search": "y"})
        assert route.call_count == 1


# ---------------------------------------------------------------------------------------------------- SF12
async def test_sf12_a_question_mentioning_a_doi_is_a_keyword_search_and_identifiers_stay_exact(client, monkeypatch):
    from app.api.routes import discovery
    from app.services.scholarly import aggregator
    from app.services.scholarly.identifiers import exact_identifier

    monkeypatch.setattr(discovery, "suggest_correction", _no_correction)
    monkeypatch.setitem(aggregator.PROVIDERS, "openalex", OpenOnlyWhenAsked())
    sentence = "studies that disagree with 10.1126/science.aah5309 on savings"
    for body in (
        (await client.get("/api/v1/discovery/search", params={"q": sentence, "providers": "openalex"})).json(),
        next(e for e in await _stream(client, q=sentence, providers="openalex") if e["type"] == "query"),
    ):
        assert body["identifier"] is None  # searched as words, not reduced to the DOI
        assert body["query"] == sentence
    for typed in (
        "10.1126/science.aah5309",
        "https://doi.org/10.1126/science.aah5309",
        "doi: 10.1126/science.aah5309",
        "(10.1126/science.aah5309).",
        "PMID: 27940873",
        "27940873",
        "https://arxiv.org/abs/1706.03762",
    ):
        assert exact_identifier(typed) is not None, typed
    for typed in ("2019", "1998 2003", "see10.1126/science.aah5309", "mobile money 10.1/x"):
        assert exact_identifier(typed) is None, typed
