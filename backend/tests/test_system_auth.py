"""System endpoints, error contract, security headers and authentication/authorization."""

from tests.conftest import ADMIN, ALICE, UNVERIFIED


async def test_health_and_ready(client):
    assert (await client.get("/api/v1/health")).json() == {"status": "ok"}
    assert (await client.get("/api/v1/ready")).json() == {"status": "ready"}


async def test_security_headers_and_request_id(client):
    response = await client.get("/api/v1/health", headers={"X-Request-ID": "abc12345-req"})
    assert response.headers["x-request-id"] == "abc12345-req"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert "max-age" in response.headers["strict-transport-security"]
    assert response.headers["cache-control"] == "no-store"
    bogus = await client.get("/api/v1/health", headers={"X-Request-ID": "<script>"})
    assert bogus.headers["x-request-id"] != "<script>"


async def test_error_contract_for_unknown_route(client):
    response = await client.get("/api/v1/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


async def test_me_requires_authentication(client):
    response = await client.get("/api/v1/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"
    bad = await client.get("/api/v1/me", headers={"Authorization": "Bearer garbage"})
    assert bad.status_code == 401


async def test_first_sign_in_creates_user_and_profile_update(client):
    me = (await client.get("/api/v1/me", headers=ALICE)).json()
    assert me["email"] == "alice@example.edu"
    assert me["role"] == "user"
    again = (await client.get("/api/v1/me", headers=ALICE)).json()
    assert again["id"] == me["id"]
    updated = await client.patch("/api/v1/me", json={"name": "Dr Alice"}, headers=ALICE)
    assert updated.json()["name"] == "Dr Alice"
    invalid = await client.patch("/api/v1/me", json={"name": ""}, headers=ALICE)
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "VALIDATION_FAILED"


async def test_admin_bootstrap_by_verified_email(client):
    assert (await client.get("/api/v1/me", headers=ADMIN)).json()["role"] == "admin"


async def test_unverified_email_blocked_from_protected_features(client):
    assert (await client.get("/api/v1/me", headers=UNVERIFIED)).status_code == 200
    response = await client.get("/api/v1/library", headers=UNVERIFIED)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "EMAIL_NOT_VERIFIED"


async def test_deactivated_user_is_rejected(client):
    me = (await client.get("/api/v1/me", headers=ALICE)).json()
    await client.get("/api/v1/me", headers=ADMIN)
    await client.patch(f"/api/v1/admin/users/{me['id']}", json={"is_active": False}, headers=ADMIN)
    assert (await client.get("/api/v1/me", headers=ALICE)).status_code == 403


async def test_ai_status_reports_not_configured(client):
    status = (await client.get("/api/v1/ai/status")).json()
    assert status == {"enabled": False, "provider": "none", "model": None, "embeddings_enabled": False}


async def test_openapi_published(client):
    spec = (await client.get("/api/v1/openapi.json")).json()
    assert "/api/v1/papers/import" in spec["paths"]
    assert not any(path.startswith("/internal") for path in spec["paths"])
