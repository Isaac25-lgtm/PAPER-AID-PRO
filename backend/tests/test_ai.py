"""AI features: honest 503 when unconfigured; answers are built only from verified claims (cited ids exist,
quotes appear verbatim in the cited evidence, numbers match, an independent support check passes)."""

import re

from app.services.ai.grounding import INSUFFICIENT_MESSAGE, PARTIAL_COVERAGE, GroundedAnswer, GroundedClaim
from app.services.ai.providers import LLMResult, set_llm
from tests.conftest import ALICE, STUDY_SECTIONS, import_doi, make_pdf

RESULT_QUOTE = "Confirmed malaria incidence was 31 percent lower in intervention schools"


class FakeLLM:
    """Scripted model. `answer` is returned for the answer/summary schema; `support(claims_prompt)` decides the
    fact-check verdicts (default: every claim supported). Records every prompt it received."""

    model = "fake-model"

    def __init__(self, answer=None, text="Rewritten text.", support=None):
        self.answer = answer
        self.text = text
        self.support = support
        self.prompts: list[str] = []
        self.verifications: list[str] = []

    async def generate_text(self, *, system, prompt, max_tokens):
        self.prompts.append(prompt)
        return LLMResult(text=self.text, model=self.model)

    async def generate_json(self, *, system, prompt, schema, max_tokens):
        if schema.__name__ == "ClaimVerdicts":
            self.verifications.append(prompt)
            count = len(re.findall(r'<claim number="\d+">', prompt))
            statements = re.findall(r"<statement>(.*?)</statement>", prompt, re.S)
            verdicts = [
                {"index": i + 1, "supported": self.support(statements[i]) if self.support else True}
                for i in range(count)
            ]
            return schema.model_validate({"verdicts": verdicts}), self.model
        self.prompts.append(prompt)
        value = self.answer(prompt) if callable(self.answer) else self.answer
        return schema.model_validate(value.model_dump() if hasattr(value, "model_dump") else value), self.model


def claim(text, ids=("E1",), quotes=(RESULT_QUOTE,), starts_paragraph=False):
    return GroundedClaim(text=text, evidence_ids=list(ids), quotes=list(quotes), starts_paragraph=starts_paragraph)


def answer(*claims, insufficient=False, gaps=""):
    """`gaps` imitates a model that adds free-text commentary anyway; it must never reach the user."""
    payload = GroundedAnswer(claims=list(claims), insufficient_evidence=insufficient).model_dump()
    return {**payload, "gaps": gaps}


def results_evidence_key(prompt: str) -> str:
    """Id of the evidence block containing the Results sentence (block order depends on retrieval)."""
    for key, body in re.findall(r'<evidence id="(E\d+)"[^>]*>\n(.*?)\n</evidence>', prompt, re.S):
        if "31 percent lower" in body:
            return key
    raise AssertionError("results passage not in evidence")


async def upload_study(client):
    response = await client.post(
        "/api/v1/papers/upload",
        headers=ALICE,
        files={"file": ("study.pdf", make_pdf(STUDY_SECTIONS), "application/pdf")},
    )
    return response.json()


async def ask(client, paper, question="How much did malaria incidence fall?"):
    return await client.post(f"/api/v1/papers/{paper['id']}/ask", headers=ALICE, json={"question": question})


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


async def test_grounded_answer_is_built_from_verified_claims(client):
    paper = await upload_study(client)
    llm = FakeLLM(
        lambda p: answer(
            claim("Malaria incidence fell by 31 percent in intervention schools.", ids=[results_evidence_key(p)])
        )
    )
    set_llm(llm)
    response = await ask(client, paper)
    assert response.status_code == 200, response.text
    body = response.json()
    key = results_evidence_key(llm.prompts[0])
    assert body["answer"] == f"Malaria incidence fell by 31 percent in intervention schools [{key}]."
    [citation] = body["citations"]
    assert citation["paper_id"] == paper["id"] and citation["kind"] == "passage" and citation["key"] == key
    assert citation["excerpt"][:200] in llm.prompts[0] and citation["page_start"] >= 1
    assert body["model"] == "fake-model" and body["gaps"] == ""
    assert '<evidence id="E1"' in llm.prompts[0] and "<question>" in llm.prompts[0]
    assert len(llm.verifications) == 1  # the independent support check ran


async def test_answers_citing_nonexistent_evidence_are_discarded(client):
    paper = await upload_study(client)
    set_llm(FakeLLM(answer(claim("Invented claim.", ids=["E99"]))))
    response = await ask(client, paper)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "AI_OUTPUT_INVALID"


async def test_quote_that_is_not_in_the_cited_evidence_removes_the_claim(client):
    """Valid ids are not enough: the supporting words must actually be in the cited passage."""
    paper = await upload_study(client)
    set_llm(FakeLLM(answer(claim("Bed nets doubled school attendance.", quotes=["school attendance doubled after"]))))
    response = await ask(client, paper)
    assert response.status_code == 502 and response.json()["error"]["code"] == "AI_OUTPUT_INVALID"


async def test_invented_quantity_is_removed_even_with_a_real_quote(client):
    paper = await upload_study(client)
    set_llm(
        FakeLLM(
            lambda p: answer(
                claim("Malaria incidence fell by 31 percent.", ids=[results_evidence_key(p)]),
                claim("Malaria incidence fell by 50 percent.", ids=[results_evidence_key(p)]),
            )
        )
    )
    body = (await ask(client, paper)).json()
    assert "31 percent" in body["answer"] and "50 percent" not in body["answer"]
    assert body["gaps"] == "1 statement was removed because the cited sources did not support it."


async def test_meaning_changing_claim_is_removed_by_the_support_check(client):
    """Quote and ids are genuine but the sentence says something else: the fact-check removes it."""
    paper = await upload_study(client)
    set_llm(
        FakeLLM(
            lambda p: answer(
                claim("Malaria incidence was not lower in intervention schools.", ids=[results_evidence_key(p)])
            ),
            support=lambda statement: "not lower" not in statement,
        )
    )
    response = await ask(client, paper)
    assert response.status_code == 502  # nothing verifiable remained, so nothing is shown


async def test_markers_in_model_text_cannot_smuggle_extra_citations(client):
    paper = await upload_study(client)
    set_llm(FakeLLM(lambda p: answer(claim("Incidence fell by 31 percent [E2][E3].", ids=[results_evidence_key(p)]))))
    body = (await ask(client, paper)).json()
    assert [c["key"] for c in body["citations"]] == [re.search(r"\[(E\d+)\]", body["answer"]).group(1)]
    assert body["answer"].count("[E") == 1


async def test_insufficient_evidence_uses_a_fixed_message(client):
    paper = await upload_study(client)
    set_llm(FakeLLM(answer(insufficient=True, gaps="The only trial was retracted in 2024.")))
    body = (await ask(client, paper, "What did it cost?")).json()
    assert body["insufficient_evidence"] is True and body["citations"] == []
    assert body["answer"] == INSUFFICIENT_MESSAGE
    # Model-written commentary is never shown (an unsupported allegation like "retracted" cannot leak through).
    assert body["gaps"] == PARTIAL_COVERAGE and "retracted" not in body["gaps"]


async def test_insufficient_evidence_with_partial_claims_still_verifies_them(client):
    paper = await upload_study(client)
    set_llm(
        FakeLLM(
            lambda p: answer(
                claim("Incidence fell by 31 percent.", ids=[results_evidence_key(p)]),
                claim("Costs were 12 dollars per pupil.", ids=[results_evidence_key(p)]),
                insufficient=True,
                gaps="Costs of 99 dollars are not reported.",  # invented number in free text: dropped
            )
        )
    )
    body = (await ask(client, paper, "What did it cost, and how much lower was malaria incidence?")).json()
    assert body["answer"].startswith(INSUFFICIENT_MESSAGE)
    assert "31 percent" in body["answer"] and "12 dollars" not in body["answer"]
    assert "99" not in body["gaps"] and "1 statement was removed" in body["gaps"]


async def test_research_synthesis_persists_conversation_and_evidence_status(client, registries):
    uploaded = await upload_study(client)
    metadata_only = await import_doi(client)

    def respond(prompt):
        blocks = re.findall(r'<evidence id="(E\d+)"[^>]*>\n(.*?)\n</evidence>', prompt, re.S)
        claims = []
        for key, body in blocks:
            words = " ".join(body.split()[:6])
            claims.append(claim(f"Finding {key.lower()}.", ids=[key], quotes=[words]))
        return answer(*claims, gaps="Costs are not reported.")

    llm = FakeLLM(respond)
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
    assert convo["messages"][1]["gaps"] == ""
    assert convo["messages"][1]["insufficient_evidence"] is False

    # A follow-up carries bounded context from the earlier turn (marked as not-evidence).
    follow = await client.post(
        "/api/v1/research/ask",
        headers=ALICE,
        json={
            "question": "What about absenteeism in those trials?",
            "paper_ids": [uploaded["id"]],
            "conversation_id": body["conversation_id"],
        },
    )
    assert follow.status_code == 200, follow.text
    assert "<conversation_so_far>" in llm.prompts[-1]
    assert "Does school bed net distribution reduce malaria?" in llm.prompts[-1]
    assert "never cite them" in llm.prompts[-1]


async def test_summary_points_and_overview_are_verified(client):
    paper = await upload_study(client)

    def respond(prompt):
        key = results_evidence_key(prompt)
        good = {"text": "Incidence fell by 31 percent.", "evidence_ids": [key], "quotes": [RESULT_QUOTE]}
        invented = {"text": "Incidence fell by 75 percent.", "evidence_ids": [key], "quotes": [RESULT_QUOTE]}
        return {
            "overview": [good, invented],
            "research_question": good,
            "methods": {"text": "A trial.", "evidence_ids": [key], "quotes": ["not in the paper at all, at all"]},
            "key_findings": [good],
            "limitations": [good],
            "insufficient_evidence": False,
        }

    set_llm(FakeLLM(respond))
    created = await client.post(f"/api/v1/papers/{paper['id']}/summary", headers=ALICE)
    assert created.status_code == 200, created.text
    fetched = (await client.get(f"/api/v1/papers/{paper['id']}/summary", headers=ALICE)).json()
    content = fetched["content"]
    assert content["based_on"] == "full_text" and fetched["label"].startswith("AI-generated")
    assert [p["text"] for p in content["overview"]] == ["Incidence fell by 31 percent."]
    assert content["methods"] is None  # its quote was not in the paper
    assert content["key_findings"][0]["evidence"][0]["excerpt"]
    assert content["removed_note"] == "2 statements were removed because the cited sources did not support them."


async def test_rewrite_returns_model_text(client):
    set_llm(FakeLLM(text="Insecticide-treated nets reduced incidence."))
    response = await client.post(
        "/api/v1/ai/rewrite", headers=ALICE, json={"text": "nets made malaria go down", "mode": "academic"}
    )
    assert response.json() == {"text": "Insecticide-treated nets reduced incidence.", "model": "fake-model"}
