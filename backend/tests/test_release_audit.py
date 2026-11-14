"""Regression tests for docs/PAPERAID_V2_RELEASE_AUDIT.md (account export, data rights, consent binding, optional
consent integrity, public routes before re-consent, PDF object ownership, account-closure recovery, uploads,
release script, highlight alignment)."""

from __future__ import annotations

import asyncio
import io
import json
import os
import shutil
import subprocess
import sys
import uuid
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.db.models import (
    ClosedAccount,
    ConsentRecord,
    DocumentCitation,
    JobKind,
    JobStatus,
    LibraryItem,
    Paper,
    ProcessingJob,
    StorageDeletion,
    User,
)
from app.db.session import get_sessionmaker
from app.errors import UpstreamError
from app.policy import POLICY_VERSION
from app.services import accounts, maintenance, processing
from app.services.storage import get_storage
from tests.conftest import ADMIN, ALICE, STUDY_SECTIONS, make_pdf

CONSENT = {"terms": True, "privacy": True, "ai_processing": True, "age_18": True, "policy_version": POLICY_VERSION}


async def upload(client, title, headers=ALICE):
    response = await client.post(
        "/api/v1/papers/upload",
        headers=headers,
        data={"title": title},
        files={"file": (f"{title}.pdf", make_pdf(STUDY_SECTIONS, title=title), "application/pdf")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def unzip(response):
    assert response.status_code == 200, response.text
    return zipfile.ZipFile(io.BytesIO(response.content))


@pytest.fixture
def consent_required(monkeypatch):
    monkeypatch.setattr(get_settings(), "require_policy_acceptance", True)


# ------------------------------------------------------------------------ 1. Account ZIP respects visibility
async def test_account_zip_never_includes_another_persons_private_paper(client):
    private = await upload(client, "Alice confidential")
    await client.get("/api/v1/me", headers=ADMIN)
    doc = (await client.post("/api/v1/documents", json={"title": "Admin draft"}, headers=ADMIN)).json()
    async with get_sessionmaker()() as db:
        admin = (await db.execute(select(User).where(User.firebase_uid == "root"))).scalar_one()
        paper_id = uuid.UUID(private["id"])
        # Rows created under an old policy or by an inconsistent write: none may leak through the ZIP.
        db.add(LibraryItem(user_id=admin.id, paper_id=paper_id, tags=["x"], notes="stale"))
        db.add(DocumentCitation(document_id=uuid.UUID(doc["id"]), paper_id=paper_id))
        await db.commit()
    archive = unzip(await client.get("/api/v1/me/export", headers=ADMIN))
    for name in archive.namelist():
        assert b"confidential" not in archive.read(name), name
        assert private["id"] not in name
    assert json.loads(archive.read("library/library.csl.json")) == []
    assert json.loads(archive.read(f"documents/{doc['id']}.json"))["citations"] == []


# ------------------------------------------------------------------------ 5. Account ZIP is complete
async def test_account_zip_contains_collections_history_citations_and_every_upload(client):
    kept = await upload(client, "Kept study")
    removed = await upload(client, "Removed study")
    assert (await client.delete(f"/api/v1/library/{removed['id']}", headers=ALICE)).status_code == 204
    collection = (await client.post("/api/v1/collections", json={"name": "Chapter 2"}, headers=ALICE)).json()
    await client.put(f"/api/v1/collections/{collection['id']}/papers/{kept['id']}", headers=ALICE)
    doc = (await client.post("/api/v1/documents", json={"title": "Draft"}, headers=ALICE)).json()
    cited = (
        await client.post(
            f"/api/v1/documents/{doc['id']}/citations", headers=ALICE, json={"paper_id": kept["id"], "locator": "4"}
        )
    ).json()
    archive = unzip(await client.get("/api/v1/me/export", headers=ALICE))
    names = set(archive.namelist())
    assert {f"uploads/{kept['id']}.pdf", f"uploads/{removed['id']}.pdf"} <= names  # removed from library, still theirs
    [exported_collection] = json.loads(archive.read("library/collections.json"))
    assert exported_collection["name"] == "Chapter 2" and exported_collection["paper_ids"] == [kept["id"]]
    document = json.loads(archive.read(f"documents/{doc['id']}.json"))
    assert document["citations"] == [
        {
            "id": cited["id"],
            "paper_id": kept["id"],
            "paper_title": "Kept study",
            "locator": "4",
            "label": "page",
            "prefix": None,
            "suffix": None,
        }
    ]
    history = json.loads(archive.read(f"documents/{doc['id']}.history.json"))
    assert history and history[0]["version"] == 1
    manifest = json.loads(archive.read("manifest.json"))
    assert set(manifest["files"]) == names and manifest["missing"] == []


# ------------------------------------------------------------------------ 5. data rights stay available
async def test_data_rights_work_before_reconsent(client, consent_required, identity_admin):
    assert (await client.get("/api/v1/library", headers=ALICE)).status_code == 403
    assert (await client.get("/api/v1/me/export", headers=ALICE)).status_code == 200
    done = await client.request("DELETE", "/api/v1/me", headers=ALICE, json={"confirm_email": "alice@example.edu"})
    assert done.status_code == 204


async def test_data_rights_work_for_a_former_tester(client, monkeypatch):
    await upload(client, "Before removal")
    monkeypatch.setattr(get_settings(), "allowed_emails", "someone-else@example.edu")
    assert (await client.get("/api/v1/library", headers=ALICE)).json()["error"]["code"] == "NOT_INVITED"
    archive = unzip(await client.get("/api/v1/me/export", headers=ALICE))
    assert any(n.startswith("uploads/") for n in archive.namelist())


# ------------------------------------------------------------------------ 6. consent bound to displayed version
async def test_consent_is_recorded_only_for_the_version_that_was_shown(client, consent_required):
    for payload in (
        {**CONSENT, "policy_version": "2020-01-01"},
        {k: v for k, v in CONSENT.items() if k != "policy_version"},
    ):
        response = await client.post("/api/v1/me/consent", headers=ALICE, json=payload)
        assert response.status_code == 409 and response.json()["error"]["code"] == "POLICY_OUTDATED"
        assert response.json()["error"]["details"]["current_version"] == POLICY_VERSION
    async with get_sessionmaker()() as db:
        assert (await db.execute(select(ConsentRecord))).first() is None
    accepted = await client.post("/api/v1/me/consent", headers=ALICE, json=CONSENT)
    assert accepted.status_code == 200 and accepted.json()["needs_consent"] is False


# ------------------------------------------------------------------------ 7. optional consent integrity
async def test_generic_preferences_cannot_change_an_optional_consent(client):
    await client.post("/api/v1/me/consent", headers=ALICE, json={**CONSENT, "analytics": False})
    response = await client.patch("/api/v1/me/preferences", headers=ALICE, json={"values": {"consent_analytics": True}})
    assert response.status_code == 422
    removed = await client.patch("/api/v1/me/preferences", headers=ALICE, json={"values": {"consent_analytics": None}})
    assert removed.status_code == 422
    me = (await client.get("/api/v1/me", headers=ALICE)).json()
    assert me["preferences"]["consent_analytics"] is False


async def test_concurrent_preference_and_consent_saves_keep_both_changes(client):
    await client.post("/api/v1/me/consent", headers=ALICE, json={**CONSENT, "product_emails": True})
    for i in range(5):
        await asyncio.gather(
            client.patch("/api/v1/me/preferences", headers=ALICE, json={"values": {f"guide_{i}_open": True}}),
            client.post("/api/v1/me/optional-consents", headers=ALICE, json={"product_emails": i % 2 == 1}),
        )
    prefs = (await client.get("/api/v1/me", headers=ALICE)).json()["preferences"]
    assert all(prefs[f"guide_{i}_open"] is True for i in range(5))
    async with get_sessionmaker()() as db:
        last = (
            await db.execute(
                select(ConsentRecord)
                .where(ConsentRecord.document == "product_emails")
                .order_by(ConsentRecord.created_at.desc(), ConsentRecord.id.desc())
                .limit(1)
            )
        ).scalar_one()
    assert prefs["consent_product_emails"] is last.granted is False  # current state matches the audit trail


# ------------------------------------------------------------------------ 8. public routes before re-consent
async def test_public_routes_do_not_open_private_work_before_reconsent(client, monkeypatch):
    private = await upload(client, "Private before consent")
    assert (await client.get(f"/api/v1/papers/{private['id']}", headers=ALICE)).status_code == 200
    monkeypatch.setattr(get_settings(), "require_policy_acceptance", True)  # Alice has not accepted these notices
    assert (await client.get(f"/api/v1/papers/{private['id']}", headers=ALICE)).status_code == 404
    assert (await client.get(f"/api/v1/papers/{private['id']}/passages", headers=ALICE)).status_code == 404
    catalog = (await client.get("/api/v1/papers", headers=ALICE)).json()
    assert all(p["id"] != private["id"] for p in catalog["items"])


# ------------------------------------------------------------------------ 2. PDF object ownership
async def test_identical_bytes_from_two_attempts_never_share_an_object():
    first, digest = await processing.put_pdf(uuid.uuid4(), b"%PDF-1.4 same bytes")
    second, digest2 = await processing.put_pdf(uuid.uuid4(), b"%PDF-1.4 same bytes")
    assert digest == digest2 and first != second


async def test_a_stale_worker_cannot_get_the_published_pdf_deleted(client, monkeypatch):
    paper = await upload(client, "Ownership study")
    pid = uuid.UUID(paper["id"])
    data = make_pdf(STUDY_SECTIONS, title="Ownership study")
    async with get_sessionmaker()() as db:
        row = await db.get(Paper, pid)
        row.storage_path = None  # as if the paper had no PDF yet when both attempts started
        job = ProcessingJob(
            paper_id=pid,
            kind=JobKind.INGEST_PDF,
            status=JobStatus.RUNNING,
            lease_expires_at=datetime.now(UTC) + timedelta(minutes=5),
            attempt_token=uuid.uuid4(),
        )
        db.add(job)
        await db.commit()
        job_id = job.id
    stale = processing.Attempt(job_id=job_id, paper_id=pid, token=uuid.uuid4(), number=1)  # superseded attempt A
    async with get_sessionmaker()() as db_a:
        paper_a = await db_a.get(Paper, pid)  # A read the paper before B published
        await db_a.commit()
        # B retrieves the same bytes and publishes them.
        async with get_sessionmaker()() as db_b:
            published = await processing.store_pdf(db_b, await db_b.get(Paper, pid), data)
            await db_b.commit()

        async def same_bytes(url):
            return data

        async def candidates(p):
            return [("https://example.org/paper.pdf", "test")]

        monkeypatch.setattr(processing, "pdf_candidates", candidates)
        monkeypatch.setattr(processing, "fetch_pdf", same_bytes)
        with pytest.raises(processing.LeaseLost):  # A resumes, writes, then loses the lease check
            await processing._obtain_pdf(db_a, paper_a, stale)
        await db_a.rollback()
    async with get_sessionmaker()() as db:
        pending = [d.key for d in (await db.execute(select(StorageDeletion))).scalars()]
        assert pending and published not in pending  # only A's own object is abandoned
        await db.execute(StorageDeletion.__table__.update().values(not_before=datetime.now(UTC) - timedelta(1)))
        await db.commit()
        assert await maintenance.process_deletions(db) == len(pending)
        assert (await db.get(Paper, pid)).storage_path == published
    assert await get_storage().get(published) == data


async def test_maintenance_never_deletes_an_object_a_paper_points_to(client):
    paper = await upload(client, "Live object study")
    async with get_sessionmaker()() as db:
        key = (await db.get(Paper, uuid.UUID(paper["id"]))).storage_path
        await maintenance.schedule_deletion(db, key)  # e.g. an intent left by an older code path
        await db.commit()
        assert await maintenance.process_deletions(db) == 0
        assert (await db.execute(select(StorageDeletion))).first() is None
    assert (await get_storage().get(key)).startswith(b"%PDF")


# ------------------------------------------------------------------------ 4. closure recovers automatically
async def test_a_closure_interrupted_by_the_identity_provider_finishes_automatically(client, identity_admin):
    await upload(client, "Closure study")
    calls = {"n": 0}
    real_delete = identity_admin.delete

    async def flaky(uid):
        calls["n"] += 1
        if calls["n"] == 1:
            raise UpstreamError("Could not delete the Firebase account (HTTP 503).")
        return await real_delete(uid)

    from app.services import identity

    identity.delete_firebase_account = flaky  # restored by the identity_admin fixture's monkeypatch
    response = await client.request("DELETE", "/api/v1/me", headers=ALICE, json={"confirm_email": "alice@example.edu"})
    assert response.status_code == 202 and response.json()["status"] == "pending"
    assert (await client.get("/api/v1/me", headers=ALICE)).status_code in {401, 403}  # locked immediately
    async with get_sessionmaker()() as db:
        request = await db.get(ClosedAccount, "alice")
        assert request.completed_at is None and request.attempts == 1 and "503" in request.last_error
        request.not_before = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
    report = await maintenance.run_maintenance()
    assert report.closures_completed == 1
    async with get_sessionmaker()() as db:
        assert (await db.execute(select(User).where(User.firebase_uid == "alice"))).first() is None
        assert (await db.execute(select(Paper).where(Paper.title == "Closure study"))).first() is None
        request = await db.get(ClosedAccount, "alice")
        assert request.completed_at is not None and request.last_error is None
    assert identity_admin.deleted == ["alice"]


async def test_a_closure_that_failed_after_identity_deletion_is_resumed(client, identity_admin, monkeypatch):
    await upload(client, "Second closure study")
    real = accounts.schedule_deletion
    calls = {"n": 0}

    async def fails_once(db, *keys):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("database connection lost")
        return await real(db, *keys)

    monkeypatch.setattr(accounts, "schedule_deletion", fails_once)
    response = await client.request("DELETE", "/api/v1/me", headers=ALICE, json={"confirm_email": "alice@example.edu"})
    assert response.status_code == 202
    async with get_sessionmaker()() as db:
        assert (await db.execute(select(User).where(User.firebase_uid == "alice"))).scalar_one().is_active is False
        await db.execute(ClosedAccount.__table__.update().values(not_before=datetime.now(UTC) - timedelta(1)))
        await db.commit()
        assert await accounts.resume_closures(db) == 1
        assert (await db.execute(select(User).where(User.firebase_uid == "alice"))).first() is None
    assert identity_admin.deleted == ["alice", "alice"]  # idempotent: a repeated identity deletion is harmless


async def test_a_resume_that_fails_again_backs_off(client, identity_admin):
    from app.services import identity

    async def down(uid):
        raise UpstreamError("still down")

    identity.delete_firebase_account = down
    await client.request("DELETE", "/api/v1/me", headers=ALICE, json={"confirm_email": "alice@example.edu"})
    async with get_sessionmaker()() as db:
        await db.execute(ClosedAccount.__table__.update().values(not_before=datetime.now(UTC) - timedelta(1)))
        await db.commit()
        assert await accounts.resume_closures(db) == 0
        request = await db.get(ClosedAccount, "alice")
        await db.refresh(request)
        assert request.attempts == 2 and request.not_before > datetime.now(UTC) + timedelta(minutes=3)
        assert await accounts.resume_closures(db) == 0  # not due yet


# ------------------------------------------------------------------------ 3. release promotes what it checked
FAKE_GCLOUD = r"""#!/usr/bin/env bash
echo "gcloud $*" >> "$CALLS"
case "$*" in
  *"storage cp"*) [[ -n "${LOCK_HELD:-}" ]] && exit 1; exit 0 ;;
  *"artifacts docker images describe"*) echo "sha256:0123abcd" ;;
  *"services describe"*)
    tag=$(grep -o -- '--tag [^ ]*' "$CALLS" | tail -1 | cut -d' ' -f2)
    # Another release created rev-B after ours: latestCreatedRevisionName is NOT our revision.
    printf '{"status": {"latestCreatedRevisionName": "rev-B", "traffic": ['
    printf '{"revisionName": "rev-live", "percent": 100},'
    printf '{"revisionName": "rev-A", "tag": "%s", "url": "https://%s.example"},' "$tag" "$tag"
    printf '{"revisionName": "rev-B", "tag": "rc-other", "url": "https://other.example"}]}}' ;;
  *) exit 0 ;;
esac
"""
FAKE_CURL = r"""#!/usr/bin/env bash
echo "curl $*" >> "$CALLS"
for arg in "$@"; do
  case "$arg" in
    */api/v1/ready) printf '%s' "$READY_BODY" ;;
  esac
done
"""
FAKE_GIT = r"""#!/usr/bin/env bash
case "$*" in
  *rev-parse*) echo "abc1234" ;;
  *) exit 0 ;;
esac
"""


def _bash() -> str | None:
    for candidate in ("C:/Program Files/Git/bin/bash.exe", shutil.which("bash")):
        if candidate and Path(candidate).exists() and "System32" not in candidate:
            return candidate
    return None


def run_release(tmp_path, ready_revision="rev-A", lock_held=False):
    bash = _bash()
    if bash is None:
        pytest.skip("bash is not available")
    from app.api.routes.system import expected_schema_revision

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in {"gcloud": FAKE_GCLOUD, "curl": FAKE_CURL, "git": FAKE_GIT}.items():
        path = bin_dir / name
        path.write_text(body, encoding="utf-8", newline="\n")
        path.chmod(0o755)
    calls = tmp_path / "calls.log"
    calls.write_text("", encoding="utf-8")
    env = {
        **os.environ,
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "CALLS": str(calls),
        "GCLOUD": (bin_dir / "gcloud").as_posix(),
        "CURL": (bin_dir / "curl").as_posix(),
        "GIT": (bin_dir / "git").as_posix(),
        "PYTHON": sys.executable,
        "READY_BODY": json.dumps({"status": "ready", "schema": expected_schema_revision(), "revision": ready_revision}),
    }
    if lock_held:
        env["LOCK_HELD"] = "1"
    script = Path(__file__).parents[2] / "deploy" / "release.sh"
    result = subprocess.run([bash, str(script)], env=env, capture_output=True, text=True, timeout=120, check=False)
    return result, calls.read_text(encoding="utf-8")


def test_release_promotes_the_revision_it_probed_even_when_another_release_interleaves(tmp_path):
    result, calls = run_release(tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "--to-revisions rev-A=100" in calls and "rev-B=100" not in calls
    deploy = next(line for line in calls.splitlines() if "run deploy" in line)
    assert "@sha256:0123abcd" in deploy  # deployed by immutable digest
    tag = deploy.split("--tag ")[1].split()[0]
    assert tag.startswith("rc-abc1234-") and f"https://{tag}.example/api/v1/ready" in calls
    assert "storage rm" in calls  # the lock is released


def test_release_stops_if_the_probe_reached_a_different_revision(tmp_path):
    result, calls = run_release(tmp_path, ready_revision="rev-B")
    assert result.returncode != 0 and "not 'rev-A'" in result.stderr
    assert "update-traffic" not in calls


def test_releases_of_the_same_service_are_serialized(tmp_path):
    result, calls = run_release(tmp_path, lock_held=True)
    assert result.returncode != 0 and "another release" in result.stderr
    assert "builds submit" not in calls and "update-traffic" not in calls


# ------------------------------------------------------------------------ 9. highlights match each claim
def _item(key, text):
    from app.services.ai.grounding import EvidenceItem

    return EvidenceItem(key=key, paper=None, text=text, kind="passage")  # type: ignore[arg-type]


def _js_slice(text: str, start: int, end: int) -> str:
    """What a browser's String.slice returns for UTF-16 offsets."""
    return text.encode("utf-16-le")[start * 2 : end * 2].decode("utf-16-le")


def test_every_supporting_quote_is_highlighted_not_just_three():
    from app.services.ai.grounding import check_claims, evidence_excerpt

    text = " ".join(f"Finding number {i} was observed in the trial cohort." for i in range(1, 6))
    claims = [(f"Finding {i} was observed.", ["E1"], [f"Finding number {i} was observed"], False) for i in range(1, 5)]
    kept, removed = check_claims(claims, [_item("E1", text)])
    assert removed == 0 and len(kept) == 4
    excerpt = evidence_excerpt(text, [span for claim in kept for span in claim.quotes])
    assert [q["text"] for q in excerpt["quotes"]] == [f"Finding number {i} was observed" for i in range(1, 5)]


def test_highlight_offsets_are_exact_after_emoji_and_other_supplementary_characters():
    from app.services.ai.grounding import check_claims, evidence_excerpt

    text = "Participants rated it \U0001f600\U0001f600 highly. Incidence fell by 31 percent in treated schools."
    kept, _ = check_claims(
        [("Incidence fell by 31 percent.", ["E1"], ["Incidence fell by 31 percent in treated schools"], False)],
        [_item("E1", text)],
    )
    excerpt = evidence_excerpt(text, kept[0].quotes)
    [quote] = excerpt["quotes"]
    assert excerpt["offset_unit"] == "utf16"
    assert (
        _js_slice(excerpt["excerpt"], quote["start"], quote["end"]) == "Incidence fell by 31 percent in treated schools"
    )


def test_a_cited_source_without_the_claims_own_quote_is_dropped():
    from app.services.ai.grounding import check_claims

    items = [_item("E1", "Malaria incidence fell by 31 percent in treated schools."), _item("E2", "Unrelated text.")]
    [claim], removed = check_claims(
        [("Incidence fell by 31 percent.", ["E1", "E2"], ["Malaria incidence fell by 31 percent"], False)], items
    )
    assert removed == 0 and claim.evidence_ids == ["E1"]


async def test_the_support_check_sees_the_same_excerpt_the_reader_sees(monkeypatch):
    from app.services.ai.grounding import check_claims, verify_support
    from tests.test_ai import FakeLLM

    monkeypatch.setattr(get_settings(), "ai_verify_claims", True)
    far_away = "UNSEEN-BY-READER " * 60
    text = far_away + "Malaria incidence fell by 31 percent in treated schools."
    kept, _ = check_claims(
        [("Incidence fell by 31 percent.", ["E1"], ["Malaria incidence fell by 31 percent"], False)],
        [_item("E1", text)],
    )
    llm = FakeLLM()
    assert await verify_support(kept, [_item("E1", text)], llm) == [True]
    assert "Malaria incidence fell by 31 percent" in llm.verifications[0]
    assert llm.verifications[0].count("UNSEEN-BY-READER") < 20  # context only, not the whole passage


# ------------------------------------------------------------------------ 10. uploads: duplicates and recovery
async def test_concurrent_uploads_of_the_same_file_create_one_paper(client):
    data = make_pdf(STUDY_SECTIONS, title="Concurrent study")

    async def send():
        return await client.post(
            "/api/v1/papers/upload", headers=ALICE, files={"file": ("Concurrent study.pdf", data, "application/pdf")}
        )

    responses = await asyncio.gather(*(send() for _ in range(3)))
    assert all(r.status_code == 201 for r in responses), [r.text for r in responses]
    assert len({r.json()["id"] for r in responses}) == 1
    async with get_sessionmaker()() as db:
        papers = list((await db.execute(select(Paper).where(Paper.title == "Concurrent study"))).scalars())
        assert len(papers) == 1
        live = papers[0].storage_path
        orphans = [d.key for d in (await db.execute(select(StorageDeletion))).scalars()]
        assert live not in orphans  # the losers' objects are queued for deletion, never the published one


async def test_a_transport_failure_while_queueing_keeps_the_upload_and_offers_a_retry(client, monkeypatch):
    import httpx

    async def unreachable(job_id):
        raise httpx.ConnectError("queue unreachable")

    monkeypatch.setattr(processing, "enqueue_job", unreachable)
    data = make_pdf(STUDY_SECTIONS, title="Queue outage study")
    first = await client.post(
        "/api/v1/papers/upload", headers=ALICE, files={"file": ("q.pdf", data, "application/pdf")}
    )
    assert first.status_code == 201, first.text
    paper = first.json()
    assert paper["has_pdf"] is True and "Retry text extraction" in paper["status_detail"]
    jobs = (await client.get(f"/api/v1/papers/{paper['id']}/jobs", headers=ALICE)).json()
    assert jobs[0]["status"] == "failed"
    monkeypatch.undo()  # the queue is back; uploading the same file again recovers instead of duplicating
    again = await client.post(
        "/api/v1/papers/upload", headers=ALICE, files={"file": ("q.pdf", data, "application/pdf")}
    )
    assert again.json()["id"] == paper["id"] and again.json()["status"] == "ready"


async def test_the_owner_can_retry_extraction_of_a_private_upload(client, monkeypatch):
    async def refused(job_id):
        raise UpstreamError("Could not queue the processing job. Please retry.")

    monkeypatch.setattr(processing, "enqueue_job", refused)
    paper = await upload(client, "Private retry study")
    monkeypatch.undo()
    retry = await client.post(f"/api/v1/papers/{paper['id']}/full-text", headers=ALICE)
    assert retry.status_code == 202
    assert (await client.get(f"/api/v1/papers/{paper['id']}", headers=ALICE)).json()["status"] == "ready"
