"""Editor writing tools: "Check against my sources" compares a passage of the draft with the document's sources
(or the library when the document has none), using the same grounded-answer validation as every AI answer."""

from app.services.ai.providers import set_llm
from tests.conftest import ALICE, BOB
from tests.test_ai import FakeLLM, answer, claim, results_evidence_key, upload_study

PASSAGE = "School-based prevention lowered malaria incidence."


async def new_document(client, headers=ALICE):
    return (await client.post("/api/v1/documents", json={}, headers=headers)).json()


async def check(client, doc, text=PASSAGE, headers=ALICE):
    return await client.post(f"/api/v1/documents/{doc['id']}/check", headers=headers, json={"text": text})


def supporting_llm():
    return FakeLLM(
        lambda p: answer(
            claim("Incidence was 31 percent lower in intervention schools.", ids=[results_evidence_key(p)])
        )
    )


async def test_check_reports_ai_not_configured(client):
    doc = await new_document(client)
    response = await check(client, doc)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_NOT_CONFIGURED"


async def test_check_uses_the_documents_sources_and_is_grounded(client):
    paper = await upload_study(client)
    doc = await new_document(client)
    cited = await client.post(f"/api/v1/documents/{doc['id']}/citations", headers=ALICE, json={"paper_id": paper["id"]})
    assert cited.status_code == 201, cited.text
    llm = supporting_llm()
    set_llm(llm)
    response = await check(client, doc)
    assert response.status_code == 200, response.text
    body = response.json()
    [citation] = body["citations"]
    assert citation["paper_id"] == paper["id"] and citation["excerpt"]
    assert PASSAGE in llm.prompts[0]  # the passage is the question the evidence is compared with
    assert len(llm.verifications) == 1  # the independent support check ran
    assert body["conversation_id"] is None  # checks are not stored as research threads


async def test_check_falls_back_to_the_library(client):
    paper = await upload_study(client)  # uploads go to the library
    doc = await new_document(client)
    set_llm(supporting_llm())
    response = await check(client, doc)
    assert response.status_code == 200, response.text
    assert response.json()["citations"][0]["paper_id"] == paper["id"]


async def test_check_without_any_sources_explains_what_to_do(client):
    doc = await new_document(client, BOB)
    set_llm(supporting_llm())
    response = await check(client, doc, headers=BOB)
    assert response.status_code == 422
    assert "Add sources" in response.json()["error"]["message"]


async def test_check_is_private_to_the_document_owner(client):
    await upload_study(client)
    doc = await new_document(client)
    set_llm(supporting_llm())
    response = await check(client, doc, headers=BOB)
    assert response.status_code == 404


async def test_check_rejects_empty_and_oversized_passages(client):
    doc = await new_document(client)
    set_llm(supporting_llm())
    assert (await check(client, doc, text="ab")).status_code == 422
    assert (await check(client, doc, text="x" * 2001)).status_code == 422
