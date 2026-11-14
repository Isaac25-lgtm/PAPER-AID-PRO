"""Test harness: a real PostgreSQL 16 + pgvector (via pgserver, no Docker needed), migrated with Alembic.

Only true externals are faked: Firebase token verification, scholarly HTTP APIs (respx) and the LLM.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import sys
import tempfile
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import psycopg
import pytest

if sys.platform == "win32":  # psycopg async requires a selector event loop on Windows
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# CI provides a PostgreSQL+pgvector service via TEST_PG_URL (e.g. postgresql://postgres:postgres@localhost:5432);
# locally we start an embedded server with pgserver (no Docker required).
if os.environ.get("TEST_PG_URL"):
    _base_uri = os.environ["TEST_PG_URL"].rstrip("/")
else:
    import pgserver

    _PGDATA = Path(__file__).resolve().parent.parent / ".pgdata"
    _server = pgserver.get_server(str(_PGDATA), cleanup_mode=None)
    _base_uri = _server.get_uri().rsplit("/", 1)[0]
TEST_DB = "paperaid_test"
_storage_dir = tempfile.mkdtemp(prefix="paperaid-test-storage-")

os.environ.update(
    {
        "ENV": "test",
        "DATABASE_URL": f"{_base_uri}/{TEST_DB}",
        "STORAGE_BACKEND": "local",
        "LOCAL_STORAGE_DIR": _storage_dir,
        "TASKS_BACKEND": "inline",
        "REQUIRE_EMAIL_VERIFIED": "true",
        "ADMIN_EMAILS": "admin@example.edu",
        "CONTACT_EMAIL": "",
        "AI_PROVIDER": "none",
        "EMBEDDING_PROVIDER": "none",
        # Never a real project: nothing in the test suite may reach production Firebase/Google APIs.
        "FIREBASE_PROJECT_ID": "paperaid-test-local",
        "MAINTENANCE_ON_STARTUP": "false",
        # Consent gating has its own tests (test_accounts.py); elsewhere accounts count as having accepted.
        "REQUIRE_POLICY_ACCEPTANCE": "false",
    }
)

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.config import get_settings  # noqa: E402

get_settings.cache_clear()

from app.main import create_app  # noqa: E402
from app.security.auth import TokenClaims, set_token_verifier  # noqa: E402
from app.services import processing  # noqa: E402, F401  registers the inline runner
from app.services.ai.providers import set_embedder, set_llm  # noqa: E402

TABLES = [
    "audit_events",
    "storage_deletions",
    "closed_accounts",
    "consent_records",
    "rate_limit_buckets",
    "messages",
    "conversations",
    "document_revisions",
    "document_citations",
    "document_sources",
    "documents",
    "collection_papers",
    "collections",
    "library_items",
    "processing_jobs",
    "paper_summaries",
    "paper_chunks",
    "paper_authors",
    "authors",
    "papers",
    "users",
]


def _admin_conn() -> psycopg.Connection:
    return psycopg.connect(f"{_base_uri}/postgres", autocommit=True)


@pytest.fixture(scope="session", autouse=True)
def database() -> Iterator[None]:
    with _admin_conn() as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{TEST_DB}"')
    cfg = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    command.upgrade(cfg, "head")
    yield
    shutil.rmtree(_storage_dir, ignore_errors=True)


def fake_verifier(token: str) -> TokenClaims:
    """Tokens look like 'uid|email|verified'."""
    from app.errors import Unauthenticated

    try:
        uid, email, verified = token.split("|")
    except ValueError as exc:
        raise Unauthenticated("bad token") from exc
    return TokenClaims(uid=uid, email=email, email_verified=verified == "1", name=email.split("@")[0])


class FakeIdentityAdmin:
    """Stands in for the Firebase Identity Toolkit (account deletion) in every test."""

    def __init__(self) -> None:
        self.deleted: list[str] = []

    async def delete(self, uid: str) -> bool:
        self.deleted.append(uid)
        return True


@pytest.fixture(autouse=True)
def identity_admin(monkeypatch: pytest.MonkeyPatch) -> FakeIdentityAdmin:
    from app.services import identity

    fake = FakeIdentityAdmin()
    monkeypatch.setattr(identity, "delete_firebase_account", fake.delete)
    return fake


@pytest.fixture(autouse=True)
def _clean_state() -> Iterator[None]:
    with psycopg.connect(f"{_base_uri}/{TEST_DB}", autocommit=True) as conn:
        conn.execute("TRUNCATE " + ", ".join(TABLES) + " RESTART IDENTITY CASCADE")
    set_token_verifier(fake_verifier)
    set_llm(None)
    set_embedder(None)
    yield
    set_llm(None)
    set_embedder(None)


@pytest.fixture(scope="session")
def app():  # type: ignore[no-untyped-def]
    return create_app()


@pytest.fixture
async def client(app) -> AsyncIterator[AsyncClient]:  # type: ignore[no-untyped-def]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        yield http


def auth(uid: str = "u1", email: str = "researcher@example.edu", verified: bool = True) -> dict[str, str]:
    return {"Authorization": f"Bearer {uid}|{email}|{'1' if verified else '0'}"}


ALICE = auth("alice", "alice@example.edu")
BOB = auth("bob", "bob@example.edu")
ADMIN = auth("root", "admin@example.edu")
UNVERIFIED = auth("eve", "eve@example.edu", verified=False)


def make_pdf(sections: dict[str, str], title: str = "A Study of Malaria Prevention in Schools") -> bytes:
    """A real, text-bearing PDF with headed sections (generated with fpdf2)."""
    from fpdf import FPDF

    pdf = FPDF()
    pdf.set_auto_page_break(True, 15)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.multi_cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
    for heading, body in sections.items():
        pdf.set_font("Helvetica", "B", 12)
        pdf.multi_cell(0, 7, heading, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 11)
        pdf.multi_cell(0, 6, body, new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


STUDY_SECTIONS = {
    "Abstract": "We evaluated insecticide-treated bed net distribution in 40 primary schools in Uganda. "
    "Malaria incidence fell by 31 percent (95% CI 22-39) in intervention schools compared with controls.",
    "Introduction": "Malaria remains a leading cause of school absenteeism in sub-Saharan Africa. " * 6,
    "Methods": "We conducted a cluster randomised trial between 2019 and 2021. Schools were randomised to "
    "receive bed nets and education sessions or usual care. The primary outcome was confirmed malaria incidence. " * 4,
    "Results": "Confirmed malaria incidence was 31 percent lower in intervention schools. Absenteeism decreased "
    "by 12 days per pupil per year. Adverse events were rare and mild. " * 4,
    "Limitations": "Follow-up lasted only two years and adherence to bed net use was self-reported. " * 3,
    "Conclusion": "School-based bed net distribution reduced malaria incidence and absenteeism. " * 3,
    "References": "1. Smith J. Malaria in schools. Lancet. 2018. 2. Okello P. Bed nets. BMJ. 2020.",
}


# ------------------------------------------------------------------------------------- upstream API mocks
import re as _re  # noqa: E402

import httpx as _httpx  # noqa: E402
import respx as _respx  # noqa: E402

from tests import fixtures as fx  # noqa: E402


@pytest.fixture
def registries() -> Iterator[_respx.MockRouter]:
    """Mock every scholarly API with realistic payloads. Tests can override individual routes."""
    with _respx.mock(assert_all_called=False) as router:
        router.get(_re.compile(r"https://api\.crossref\.org/works/10\.1186/.*")).mock(
            return_value=_httpx.Response(200, json={"message": fx.CROSSREF_WORK})
        )
        router.get(_re.compile(r"https://api\.crossref\.org/works/10\..*")).mock(return_value=_httpx.Response(404))
        router.get("https://api.crossref.org/works").mock(
            return_value=_httpx.Response(200, json={"message": {"items": [fx.CROSSREF_WORK]}})
        )
        router.get(_re.compile(r"https://api\.openalex\.org/works/doi:10\.1186.*")).mock(
            return_value=_httpx.Response(200, json=fx.OPENALEX_WORK)
        )
        router.get(_re.compile(r"https://api\.openalex\.org/works/.*")).mock(return_value=_httpx.Response(404))
        router.get("https://api.openalex.org/works").mock(
            return_value=_httpx.Response(200, json={"results": [fx.OPENALEX_WORK, fx.OPENALEX_OTHER]})
        )

        def _esearch(request: _httpx.Request) -> _httpx.Response:
            term = request.url.params.get("term", "").lower()
            known = "malaria" in term or fx.DOI in term or "34001234" in term or "pmc8123456" in term
            return _httpx.Response(200, json=fx.PUBMED_ESEARCH if known else {"esearchresult": {"idlist": []}})

        router.get(_re.compile(r"https://eutils\.ncbi\.nlm\.nih\.gov/.*/esearch\.fcgi.*")).mock(side_effect=_esearch)
        router.get(_re.compile(r"https://eutils\.ncbi\.nlm\.nih\.gov/.*/efetch\.fcgi.*")).mock(
            return_value=_httpx.Response(200, text=fx.PUBMED_EFETCH)
        )
        router.get(_re.compile(r"https://api\.semanticscholar\.org/graph/v1/paper/search.*")).mock(
            return_value=_httpx.Response(200, json=fx.S2_SEARCH)
        )
        router.get(_re.compile(r"https://api\.semanticscholar\.org/graph/v1/paper/.*")).mock(
            return_value=_httpx.Response(404)
        )
        router.get(_re.compile(r"https://export\.arxiv\.org/api/query.*")).mock(
            return_value=_httpx.Response(200, text=fx.ARXIV_FEED)
        )
        router.get(_re.compile(r"https://doaj\.org/api/search/articles/.*")).mock(
            return_value=_httpx.Response(200, json=fx.DOAJ_SEARCH)
        )
        router.get(_re.compile(r"https://www\.ebi\.ac\.uk/europepmc/webservices/rest/search.*")).mock(
            return_value=_httpx.Response(200, json=fx.EUROPE_PMC_SEARCH)
        )
        yield router


async def import_doi(client: AsyncClient, headers: dict[str, str] = ALICE, **extra: object) -> dict:  # type: ignore[type-arg]
    response = await client.post("/api/v1/papers/import", json={"identifier": fx.DOI, **extra}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()
