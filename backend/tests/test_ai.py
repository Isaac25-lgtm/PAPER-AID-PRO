"""AI features: honest 503 when unconfigured, grounded answers with DB-built citations, invalid output rejected."""

import re

from app.services.ai.grounding import GroundedAnswer, GroundedClaim
from app.services.ai.providers import LLMResult, set_llm
from tests.conftest import ALICE, STUDY_SECTIONS, import_doi, make_pdf


class FakeLLM:
    """Scripted model: returns whatever structured answer the test sets; records the prompt it received."""

    model = "fake-model"

    def __init__(self, answer=None, text="Rewritten text."):
        self.answer = answer
        self.text = text
        self.prompts: list[str] = []

    async def generate_text(self, *, system, prompt, max_tokens):
        self.prompts.append(prompt)
        return LLMResult(text=self.text, model=self.model)

    async def generate_json(self, *, system, prompt, schema, max_tokens):
        self.prompts.append(prompt)
        value = self.answer(prompt) if callable(self.answer) else self.answer
        return schema.model_validate(value.model_dump() if hasattr(value, "model_dump") else value), self.model


async def upload_study(client):
    response = await client.post(
        "/api/v1/papers/upload",
        headers=ALICE,
        files={"file": ("study.pdf", make_pdf(STUDY_SECTIONS), "application/pdf")},
    )
    return response.json()


async def test_every_ai_endpoint_reports_not_configured(client, registries):
    paper = await import_doi(client)
    doc = (await client.post("/api/v1/documents", json={}, headers=ALICE)).json()
    calls = [
        ("post", f"/api/v1/papers/{paper['id']}/ask", {"question": "What was the effect?"}),
        ("post", f"/api/v1/papers/{paper['id']}/summary", None),
        ("post", "/api/v1/research/ask", {"question": "What works?", "paper_ids": [paper["id"]]}),
        ("post", "/api/v1/ai/rewrite", {"text": "some text", "mode": "academic"}),
        ("post", "/api/v1/ai/complete", {"document_id": doc["id"], "preceding_text": "Malaria remains a " * 3}),
    ]
    for method, url, body in calls:
        response = await getattr(client, method)(url, json=body, headers=ALICE)
        assert response.status_code == 503, url
        assert response.json()["error"]["code"] == "AI_NOT_CONFIGURED"


async def test_grounded_answer_cites_real_passages(client):
    paper = await upload_study(client)
    llm = FakeLLM(
        GroundedAnswer(
            answer="Malaria incidence was 31 percent lower in intervention schools [E1].",
            claims=[GroundedClaim(text="Incidence fell 31%", evidence_ids=["E1"])],
            insufficient_evidence=False,
            gaps="",
        )
    )
    set_llm(llm)
    response = await client.post(
        f"/api/v1/papers/{paper['id']}/ask", headers=ALICE, json={"question": "How much did malaria incidence fall?"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    [citation] = body["citations"]
    assert citation["paper_id"] == paper["id"] and citation["kind"] == "passage"
    assert citation["excerpt"][:200] in llm.prompts[0] and citation["page_start"] >= 1
    assert body["model"] == "fake-model"
    assert '<evidence id="E1"' in llm.prompts[0] and "<question>" in llm.prompts[0]


async def test_answers_citing_nonexistent_evidence_are_discarded(client):
    paper = await upload_study(client)
    set_llm(
        FakeLLM(
            GroundedAnswer(
                answer="Invented claim [E99].",
                claims=[GroundedClaim(text="x", evidence_ids=["E99"])],
                insufficient_evidence=False,
                gaps="",
            )
        )
    )
    response = await client.post(
        f"/api/v1/papers/{paper['id']}/ask", headers=ALICE, json={"question": "What was the effect?"}
    )
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "AI_OUTPUT_INVALID"


async def test_answers_without_inline_citations_are_discarded(client):
    paper = await upload_study(client)
    set_llm(
        FakeLLM(
            GroundedAnswer(
                answer="Bed nets work.",
                claims=[GroundedClaim(text="x", evidence_ids=["E1"])],
                insufficient_evidence=False,
                gaps="",
            )
        )
    )
    response = await client.post(
        f"/api/v1/papers/{paper['id']}/ask", headers=ALICE, json={"question": "Do bed nets work?"}
    )
    assert response.status_code == 502


async def test_insufficient_evidence_is_passed_through_honestly(client):
    paper = await upload_study(client)
    set_llm(
        FakeLLM(
            GroundedAnswer(
                answer="The paper does not report costs.", claims=[], insufficient_evidence=True, gaps="No cost data."
            )
        )
    )
    body = (
        await client.post(f"/api/v1/papers/{paper['id']}/ask", headers=ALICE, json={"question": "What did it cost?"})
    ).json()
    assert body["insufficient_evidence"] is True and body["citations"] == []


async def test_research_synthesis_persists_conversation(client, registries):
    uploaded = await upload_study(client)
    metadata_only = await import_doi(client)

    def answer(prompt):
        keys = re.findall(r'<evidence id="(E\d+)"', prompt)
        return GroundedAnswer(
            answer=" ".join(f"Finding [{k}]." for k in keys),
            claims=[GroundedClaim(text="f", evidence_ids=[k]) for k in keys],
            insufficient_evidence=False,
            gaps="",
        )

    llm = FakeLLM(answer)
    set_llm(llm)
    response = await client.post(
        "/api/v1/research/ask",
        headers=ALICE,
        json={
            "question": "Does school bed net distribution reduce malaria?",
            "paper_ids": [uploaded["id"], metadata_only["id"]],
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    kinds = {c["paper_id"]: c["kind"] for c in body["citations"]}
    assert kinds[uploaded["id"]] == "passage" and kinds[metadata_only["id"]] == "abstract"
    convo = (await client.get(f"/api/v1/research/conversations/{body['conversation_id']}", headers=ALICE)).json()
    assert [m["role"] for m in convo["messages"]] == ["user", "assistant"]
    assert convo["messages"][1]["citations"] == body["citations"]


async def test_summary_is_stored_labelled_and_validated(client):
    paper = await upload_study(client)
    point = {"text": "Bed nets cut incidence by 31%", "evidence_ids": ["E1"]}
    set_llm(
        FakeLLM(
            {
                "overview": "A trial [E1].",
                "research_question": point,
                "methods": point,
                "key_findings": [point],
                "limitations": [point],
                "insufficient_evidence": False,
            }
        )
    )
    created = await client.post(f"/api/v1/papers/{paper['id']}/summary", headers=ALICE)
    assert created.status_code == 200, created.text
    fetched = (await client.get(f"/api/v1/papers/{paper['id']}/summary", headers=ALICE)).json()
    assert fetched["content"]["based_on"] == "full_text" and fetched["label"].startswith("AI-generated")
    assert fetched["content"]["key_findings"][0]["evidence"][0]["key"] == "E1"


async def test_rewrite_returns_model_text(client):
    set_llm(FakeLLM(text="Insecticide-treated nets reduced incidence."))
    response = await client.post(
        "/api/v1/ai/rewrite", headers=ALICE, json={"text": "nets made malaria go down", "mode": "academic"}
    )
    assert response.json() == {"text": "Insecticide-treated nets reduced incidence.", "model": "fake-model"}
