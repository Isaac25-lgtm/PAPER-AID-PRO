"""Admin authorization + auditing, internal task endpoint protection, rate limiting, SSRF guards, embeddings."""

import hashlib

import pytest
from sqlalchemy import select

from app.db.models import AuditEvent, PaperChunk
from app.db.session import get_sessionmaker
from app.errors import RateLimited, ValidationFailed
from app.security.rate_limit import enforce_rate_limit
from app.security.url_safety import is_public_ip, resolve_public_target
from app.services.ai.providers import set_embedder
from tests.conftest import ADMIN, ALICE, STUDY_SECTIONS, make_pdf


async def test_admin_endpoints_require_admin(client):
    for url in ("/api/v1/admin/stats", "/api/v1/admin/users", "/api/v1/admin/jobs"):
        assert (await client.get(url, headers=ALICE)).status_code == 403
        assert (await client.get(url)).status_code == 401
    assert (await client.get("/api/v1/admin/stats", headers=ADMIN)).status_code == 200


async def test_role_changes_are_audited_and_self_demotion_blocked(client):
    alice = (await client.get("/api/v1/me", headers=ALICE)).json()
    admin = (await client.get("/api/v1/me", headers=ADMIN)).json()
    promoted = await client.patch(f"/api/v1/admin/users/{alice['id']}", json={"role": "admin"}, headers=ADMIN)
    assert promoted.json()["role"] == "admin"
    assert (await client.get("/api/v1/admin/stats", headers=ALICE)).status_code == 200
    self_demote = await client.patch(f"/api/v1/admin/users/{admin['id']}", json={"role": "user"}, headers=ADMIN)
    assert self_demote.status_code == 422
    async with get_sessionmaker()() as db:
        events = (await db.execute(select(AuditEvent))).scalars().all()
    assert [(e.action, e.target_id) for e in events] == [("user.role_changed", alice["id"])]


async def test_stats_and_job_retry(client):
    await client.post(
        "/api/v1/papers/upload", headers=ALICE, files={"file": ("s.pdf", make_pdf(STUDY_SECTIONS), "application/pdf")}
    )
    stats = (await client.get("/api/v1/admin/stats", headers=ADMIN)).json()
    assert stats["papers_private"] == 1 and stats["papers_with_full_text"] == 1 and stats["ai_enabled"] is False
    [job] = (await client.get("/api/v1/admin/jobs", headers=ADMIN)).json()
    assert job["status"] == "succeeded"
    retried = await client.post(f"/api/v1/admin/jobs/{job['id']}/retry", headers=ADMIN)
    assert retried.status_code == 202 and retried.json()["status"] == "succeeded"


async def test_internal_task_endpoint_rejects_unauthenticated_calls(client):
    response = await client.post("/internal/tasks/run-job", json={"job_id": "00000000-0000-0000-0000-000000000000"})
    assert response.status_code == 401
    forged = await client.post(
        "/internal/tasks/run-job", json={"job_id": "x"}, headers={"Authorization": "Bearer forged"}
    )
    assert forged.status_code == 401


async def test_rate_limit_enforced_across_requests():
    async with get_sessionmaker()() as db:
        for _ in range(3):
            await enforce_rate_limit(db, key="t:limit", limit=3, window_seconds=60)
        with pytest.raises(RateLimited) as exc:
            await enforce_rate_limit(db, key="t:limit", limit=3, window_seconds=60)
    assert 1 <= exc.value.retry_after <= 60


async def test_rate_limit_returns_429_with_retry_after(client, registries, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "rate_limit_search_per_min", 1)
    params = {"q": "malaria", "providers": ["crossref"]}
    assert (await client.get("/api/v1/discovery/search", params=params, headers=ALICE)).status_code == 200
    limited = await client.get("/api/v1/discovery/search", params=params, headers=ALICE)
    assert limited.status_code == 429 and int(limited.headers["retry-after"]) >= 1
    assert limited.json()["error"]["code"] == "RATE_LIMITED"


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.5",
        "192.168.1.1",
        "169.254.169.254",
        "::1",
        "100.64.0.1",
        "0.0.0.0",
        "::ffff:127.0.0.1",
        "fd00::1",
    ],
)
def test_private_and_metadata_addresses_are_not_public(address):
    assert is_public_ip(address) is False


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/x.pdf",
        "http://localhost/x.pdf",
        "file:///etc/passwd",
        "ftp://example.org/a.pdf",
        "http://user:pw@example.org/a.pdf",
        "http://example.org:8080/a.pdf",
        "http://169.254.169.254/latest/meta-data",
    ],
)
async def test_ssrf_targets_rejected(url):
    with pytest.raises(ValidationFailed):
        await resolve_public_target(url)


class HashEmbedder:
    """Deterministic bag-of-words embeddings so vector search is exercised without a paid provider."""

    model = "hash-embedder"

    async def embed(self, texts, *, task):
        vectors = []
        for text in texts:
            vector = [0.0] * 1536
            for word in text.lower().split():
                vector[int(hashlib.md5(word.encode()).hexdigest(), 16) % 1536] += 1.0
            norm = sum(v * v for v in vector) ** 0.5 or 1.0
            vectors.append([v / norm for v in vector])
        return vectors


async def test_embeddings_are_stored_and_used_for_retrieval(client):
    set_embedder(HashEmbedder())
    paper = (
        await client.post(
            "/api/v1/papers/upload",
            headers=ALICE,
            files={"file": ("s.pdf", make_pdf(STUDY_SECTIONS), "application/pdf")},
        )
    ).json()
    async with get_sessionmaker()() as db:
        chunks = (await db.execute(select(PaperChunk).where(PaperChunk.paper_id == paper["id"]))).scalars().all()
    assert chunks and all(c.embedding is not None and c.embedding_model == "hash-embedder" for c in chunks)
    hits = (
        await client.get(
            f"/api/v1/papers/{paper['id']}/passages", params={"q": "absenteeism pupil days"}, headers=ALICE
        )
    ).json()
    assert hits and "absenteeism" in hits[0]["text"].lower()
