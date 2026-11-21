"""Deep Research audit fixes, through the real API: web search only when chosen (F01), AI outages never lose the
search (F06), year limits apply to web pages (F07), unusable questions are refused before any quota (F14), and the
data export holds everything the report page shows (F15)."""

import io
import json
import zipfile

import httpx

from app.config import get_settings
from app.errors import RateLimited, UpstreamError
from app.services.ai.providers import set_llm
from app.services.deep_research import in_year_range
from tests.conftest import ALICE
from tests.test_accounts import ALL_REQUIRED
from tests.test_deep_research import QUESTION, ResearchLLM, run


def connect_web(monkeypatch, registries, results):
    monkeypatch.setattr(get_settings(), "web_search_provider", "tavily")
    monkeypatch.setattr(get_settings(), "tavily_api_key", "tvly-test-key")
    return registries.post("https://api.tavily.com/search").mock(
        return_value=httpx.Response(200, json={"results": results})
    )


PAGE = "Field report on school feeding and attendance in rural districts, with enrolment figures by year."


# ------------------------------------------------------------------------------------------------------ F01
async def test_the_web_is_searched_only_when_the_person_chose_it(client, registries, monkeypatch):
    tavily = connect_web(monkeypatch, registries, [{"url": "https://a.example.org", "title": "A", "content": PAGE}])
    omitted = (await run(client)).json()  # an older client that does not send the field
    unchecked = (await run(client, include_web=False)).json()
    assert tavily.call_count == 0  # the question never left for the web service
    for body in (omitted, unchecked):
        assert body["options"]["include_web"] is False
        assert {s["name"]: s for s in body["services"]}["web"]["error"] == "not_requested"
        assert not [s for s in body["sources"] if s["kind"] == "web"]
    chosen = (await run(client, include_web=True)).json()
    assert tavily.call_count >= 1 and [s for s in chosen["sources"] if s["kind"] == "web"]


async def test_choosing_the_web_while_it_is_not_connected_calls_no_web_service(client, registries):
    body = (await run(client, include_web=True)).json()
    assert {s["name"]: s for s in body["services"]}["web"]["error"] == "not_connected"
    assert not any("tavily" in str(call.request.url) for call in registries.calls)


# ------------------------------------------------------------------------------------------------------ F06
class FailingLLM(ResearchLLM):
    """Fails the planning step and/or the report step the way real providers do."""

    def __init__(self, *, plan_error=None, report_error=None, searches=("school bed nets malaria",)):
        super().__init__(list(searches))
        self.plan_error, self.report_error = plan_error, report_error

    async def generate_json(self, *, system, prompt, schema, max_tokens):
        if schema.__name__ == "SearchPlan" and self.plan_error:
            raise self.plan_error
        if schema.__name__ == "GroundedAnswer" and self.report_error:
            raise self.report_error
        return await super().generate_json(system=system, prompt=prompt, schema=schema, max_tokens=max_tokens)


async def history(client):
    return (await client.get("/api/v1/research/deep", headers=ALICE)).json()


async def test_a_rate_limited_planner_falls_back_to_the_question_and_still_reports(client, registries):
    set_llm(FailingLLM(plan_error=RateLimited("The AI provider is rate limiting requests.", retry_after=20)))
    response = await run(client)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["queries"] == [QUESTION] and body["options"]["planned_by_ai"] is False
    assert body["report_status"] == "complete" and body["sources"]
    assert [h["id"] for h in await history(client)] == [body["id"]]


async def test_a_report_transport_failure_keeps_the_search(client, registries):
    for error in (UpstreamError("Could not reach the AI provider."), httpx.ConnectError("connection reset")):
        set_llm(FailingLLM(report_error=error))
        body = (await run(client)).json()
        assert body["report_status"] == "ai_failed" and body["report"] is None
        assert body["sources"] and body["options"]["planned_by_ai"] is True
        detail = (await client.get(f"/api/v1/research/deep/{body['id']}", headers=ALICE)).json()
        assert detail["sources"] == body["sources"] and detail["report_status"] == "ai_failed"


async def test_a_plan_that_cleans_to_nothing_is_not_called_an_ai_plan(client, registries):
    set_llm(FailingLLM(searches=("", "<b></b>", '""')))
    body = (await run(client)).json()
    assert body["queries"] == [QUESTION] and body["options"]["planned_by_ai"] is False


# ------------------------------------------------------------------------------------------------------ F07
async def test_year_limits_apply_to_web_pages(client, registries, monkeypatch):
    def page(url, date):
        return {"url": url, "title": url, "content": PAGE, **({"published_date": date} if date else {})}

    connect_web(
        monkeypatch,
        registries,
        [
            page("https://old.example.org", "1999-05-01"),
            page("https://start.example.org", "2015-01-01"),
            page("https://end.example.org", "2025-12-31"),
            page("https://undated.example.org", None),
        ],
    )
    body = (await run(client, include_web=True, year_from=2015, year_to=2025)).json()
    web = sorted(s["url"] for s in body["sources"] if s["kind"] == "web")
    assert web == ["https://end.example.org", "https://start.example.org"]  # both boundaries kept
    status = {s["name"]: s for s in body["services"]}["web"]
    assert status["excluded_by_date"] == 2  # 1999 and the undated page, shown to the reader
    assert in_year_range(None, None, None) and not in_year_range(None, 2015, None)


async def test_web_evidence_given_to_the_writer_respects_the_year_limits(client, registries, monkeypatch):
    connect_web(
        monkeypatch,
        registries,
        [{"url": "https://old.example.org", "title": "Old", "content": PAGE, "published_date": "1999-01-01"}],
    )
    llm = ResearchLLM(["school bed nets malaria"])
    set_llm(llm)
    await run(client, include_web=True, year_from=2015, year_to=2025)
    assert not any("old.example.org" in prompt for prompt in llm.prompts)


# ------------------------------------------------------------------------------------------------------ F14
async def test_unusable_questions_are_refused_before_any_quota(client, registries, monkeypatch):
    monkeypatch.setattr(get_settings(), "rate_limit_deep_research_per_hour", 1)
    for question in (" " * 12, "<b></b> 12345 67890", "\n\t  ?? !! ..  "):
        response = await client.post("/api/v1/research/deep", headers=ALICE, json={"question": question})
        assert response.status_code == 422, question
    assert await history(client) == []
    shortest = await client.post("/api/v1/research/deep", headers=ALICE, json={"question": "  bed   nets  "})
    assert shortest.status_code == 422  # 8 characters once whitespace is normalised
    ok = await client.post("/api/v1/research/deep", headers=ALICE, json={"question": "  malaria   nets  "})
    assert ok.status_code == 200 and ok.json()["question"] == "malaria nets"  # exactly 12 characters, normalised


# ------------------------------------------------------------------------------------------------------ F15
async def test_the_export_holds_every_field_the_report_page_shows(client, registries):
    await client.post("/api/v1/me/consent", headers=ALICE, json=ALL_REQUIRED)
    set_llm(ResearchLLM(["school bed nets malaria"]))
    body = (await run(client)).json()
    detail = (await client.get(f"/api/v1/research/deep/{body['id']}", headers=ALICE)).json()
    archive = zipfile.ZipFile(io.BytesIO((await client.get("/api/v1/me/export", headers=ALICE)).content))
    saved = json.loads(archive.read(f"research/deep/{body['id']}.json"))
    for key, value in detail.items():
        assert saved[key] == value, key
    assert {"services", "model", "gaps", "insufficient_evidence"} <= saved.keys()
    assert saved["searches"] == detail["queries"]  # the original alias is kept
