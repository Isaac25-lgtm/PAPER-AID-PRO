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
