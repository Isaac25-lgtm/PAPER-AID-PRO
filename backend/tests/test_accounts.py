"""Consent gating and records, per-account preferences, progress, data export and self-service account closure."""

from __future__ import annotations

import io
import json
import zipfile

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.db.models import ConsentRecord, User
from app.db.session import get_sessionmaker
from app.policy import POLICY_VERSION
from tests.conftest import ALICE, STUDY_SECTIONS, make_pdf

ALL_REQUIRED = {"terms": True, "privacy": True, "ai_processing": True, "age_18": True, "policy_version": POLICY_VERSION}


@pytest.fixture
def consent_required(monkeypatch):
    monkeypatch.setattr(get_settings(), "require_policy_acceptance", True)


async def test_features_are_locked_until_the_current_policy_is_accepted(client, consent_required):
    me = (await client.get("/api/v1/me", headers=ALICE)).json()
    assert me["needs_consent"] is True and me["policy_version"] == POLICY_VERSION
    blocked = await client.get("/api/v1/library", headers=ALICE)
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "CONSENT_REQUIRED"
    missing = await client.post("/api/v1/me/consent", headers=ALICE, json={**ALL_REQUIRED, "age_18": False})
    assert missing.status_code == 422 and missing.json()["error"]["details"]["missing"] == ["age_18"]
    accepted = await client.post("/api/v1/me/consent", headers=ALICE, json={**ALL_REQUIRED, "analytics": True})
    assert accepted.status_code == 200 and accepted.json()["needs_consent"] is False
    assert (await client.get("/api/v1/library", headers=ALICE)).status_code == 200
    async with get_sessionmaker()() as db:
        records = {r.document: r for r in (await db.execute(select(ConsentRecord))).scalars()}
    assert set(records) == {"terms", "privacy", "ai_processing", "age_18", "product_emails", "analytics"}
    assert records["terms"].granted and records["terms"].version == POLICY_VERSION
    assert records["product_emails"].granted is False and records["analytics"].granted is True


async def test_a_new_policy_version_requires_acceptance_again(client, consent_required, monkeypatch):
    await client.post("/api/v1/me/consent", headers=ALICE, json=ALL_REQUIRED)
    from app.api.routes import system
    from app.security import auth

    monkeypatch.setattr(auth, "POLICY_VERSION", "2099-01-01")
    monkeypatch.setattr(system, "POLICY_VERSION", "2099-01-01")
    assert (await client.get("/api/v1/me", headers=ALICE)).json()["needs_consent"] is True
    assert (await client.get("/api/v1/library", headers=ALICE)).status_code == 403


async def test_optional_consents_can_be_withdrawn_and_are_recorded(client):
    await client.post("/api/v1/me/consent", headers=ALICE, json={**ALL_REQUIRED, "product_emails": True})
    me = (await client.post("/api/v1/me/optional-consents", headers=ALICE, json={"product_emails": False})).json()
    assert me["preferences"]["consent_product_emails"] is False
    bad = await client.post("/api/v1/me/optional-consents", headers=ALICE, json={"terms": False})
    assert bad.status_code == 422  # required consents cannot be "withdrawn" this way
    async with get_sessionmaker()() as db:
        history = [
            r.granted
            for r in (
                await db.execute(
                    select(ConsentRecord)
                    .where(ConsentRecord.document == "product_emails")
                    .order_by(ConsentRecord.created_at)
                )
            ).scalars()
        ]
    assert history == [True, False]


async def test_preferences_merge_and_follow_the_account(client):
    await client.patch(
        "/api/v1/me/preferences", headers=ALICE, json={"values": {"guide_library_open": True, "tour_seen": True}}
    )
    me = (await client.patch("/api/v1/me/preferences", headers=ALICE, json={"values": {"tour_seen": None}})).json()
    assert me["preferences"] == {"guide_library_open": True}


async def test_progress_counts(client):
    await client.post(
        "/api/v1/papers/upload",
        headers=ALICE,
        data={"title": "Progress"},
        files={"file": ("p.pdf", make_pdf(STUDY_SECTIONS), "application/pdf")},
    )
    await client.post("/api/v1/documents", json={"title": "D"}, headers=ALICE)
    progress = (await client.get("/api/v1/me/progress", headers=ALICE)).json()
    assert progress == {"library": 1, "full_text": 1, "collections": 0, "documents": 1, "conversations": 0}


async def test_data_export_contains_everything_the_person_created(client):
    upload = (
        await client.post(
            "/api/v1/papers/upload",
            headers=ALICE,
            data={"title": "Exported study"},
            files={"file": ("p.pdf", make_pdf(STUDY_SECTIONS), "application/pdf")},
        )
    ).json()
    await client.post("/api/v1/documents", json={"title": "My chapter"}, headers=ALICE)
    await client.post("/api/v1/me/consent", headers=ALICE, json=ALL_REQUIRED)
    response = await client.get("/api/v1/me/export", headers=ALICE)
    assert response.status_code == 200 and "paperaid-my-data.zip" in response.headers["content-disposition"]
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = archive.namelist()
    assert "profile.json" in names and "library/library.bib" in names and f"uploads/{upload['id']}.pdf" in names
    assert any(n.endswith(".docx") for n in names) and "README.txt" in names
    assert json.loads(archive.read("profile.json"))["email"] == "alice@example.edu"
    assert {c["document"] for c in json.loads(archive.read("consents.json"))} >= {"terms", "privacy"}
    assert archive.read(f"uploads/{upload['id']}.pdf").startswith(b"%PDF")


async def test_self_service_deletion_requires_the_email_and_closes_everything(client, identity_admin):
    await client.post(
        "/api/v1/papers/upload",
        headers=ALICE,
        data={"title": "Bye"},
        files={"file": ("p.pdf", make_pdf(STUDY_SECTIONS), "application/pdf")},
    )
    await client.post("/api/v1/me/consent", headers=ALICE, json=ALL_REQUIRED)
    wrong = await client.request("DELETE", "/api/v1/me", headers=ALICE, json={"confirm_email": "someone@else.edu"})
    assert wrong.status_code == 422
    done = await client.request("DELETE", "/api/v1/me", headers=ALICE, json={"confirm_email": "Alice@Example.edu"})
    assert done.status_code == 204 and identity_admin.deleted == ["alice"]
    assert (await client.get("/api/v1/me", headers=ALICE)).status_code == 401
    async with get_sessionmaker()() as db:
        assert (await db.execute(select(User))).first() is None
        consents = list((await db.execute(select(ConsentRecord))).scalars())
        assert consents and all(c.user_id is None for c in consents)  # kept as evidence, unlinked from the person


async def test_paging_headers_are_readable_cross_origin(client, monkeypatch):
    from app.main import create_app

    monkeypatch.setattr(get_settings(), "cors_origins", "https://paperaid.web.app")
    from httpx import ASGITransport, AsyncClient

    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as http:
        response = await http.get("/api/v1/library", headers={**ALICE, "Origin": "https://paperaid.web.app"})
    assert "x-total-count" in response.headers.get("access-control-expose-headers", "").lower()
