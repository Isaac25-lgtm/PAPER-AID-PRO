"""Paper import, catalog, visibility, uploads, PDF processing, passages, citing and deletion."""

import re

import httpx

from app.security import url_safety
from app.security.url_safety import ResolvedTarget
from tests import fixtures as fx
from tests.conftest import ALICE, BOB, STUDY_SECTIONS, import_doi, make_pdf


async def test_import_by_doi_uses_registry_metadata(client, registries):
    paper = await import_doi(client)
    assert paper["doi"] == fx.DOI
    assert paper["authors"][0] == "Grace Namaganda"
    assert paper["journal"] == "Malaria Journal" and paper["year"] == 2021
    assert paper["pmid"] == "34001234" and paper["is_open_access"] is True
    assert paper["in_library"] is True and paper["status"] == "metadata_only"


async def test_import_is_idempotent_and_shared(client, registries):
    first = await import_doi(client, ALICE)
    second = await import_doi(client, BOB)
    assert first["id"] == second["id"], "public records are shared, not duplicated"


async def test_import_rejects_bad_and_unknown_identifiers(client, registries):
    bad = await client.post("/api/v1/papers/import", json={"identifier": "hello world"}, headers=ALICE)
    assert bad.status_code == 422
    missing = await client.post("/api/v1/papers/import", json={"identifier": "10.9999/does-not-exist"}, headers=ALICE)
    assert missing.status_code == 404


async def test_catalog_search_and_pagination(client, registries):
    paper = await import_doi(client)
    page = (await client.get("/api/v1/papers", params={"q": "malaria nets"})).json()
    assert page["total"] == 1 and page["items"][0]["id"] == paper["id"]
    empty = (await client.get("/api/v1/papers", params={"q": "quantum chromodynamics"})).json()
    assert empty["total"] == 0
    assert (await client.get("/api/v1/papers", params={"page_size": 500})).status_code == 422


async def test_upload_pipeline_extracts_sections_and_pages(client):
    pdf = make_pdf(STUDY_SECTIONS)
    response = await client.post(
        "/api/v1/papers/upload", headers=ALICE, files={"file": ("malaria-study.pdf", pdf, "application/pdf")}
    )
    assert response.status_code == 201, response.text
    paper = response.json()
    assert paper["title"] == "malaria-study" and paper["visibility"] == "private"
    assert paper["status"] == "ready" and paper["has_full_text"] and paper["has_pdf"]
    assert "passages extracted" in paper["status_detail"]

    hits = (
        await client.get(
            f"/api/v1/papers/{paper['id']}/passages", params={"q": "malaria incidence lower"}, headers=ALICE
        )
    ).json()
    assert hits and any(h["section"] == "Results" for h in hits)
    assert all(h["section"] != "References" for h in hits), "reference lists are never evidence"
    assert all(h["page_start"] >= 1 for h in hits)

    pdf_response = await client.get(f"/api/v1/papers/{paper['id']}/pdf", headers=ALICE)
    assert pdf_response.status_code == 200 and pdf_response.content.startswith(b"%PDF-")


async def test_private_uploads_are_invisible_to_others(client):
    pdf = make_pdf(STUDY_SECTIONS)
    paper = (
        await client.post("/api/v1/papers/upload", headers=ALICE, files={"file": ("x.pdf", pdf, "application/pdf")})
    ).json()
    for path in ("", "/pdf", "/passages", "/cite"):
        assert (await client.get(f"/api/v1/papers/{paper['id']}{path}", headers=BOB)).status_code == 404
    assert (await client.get(f"/api/v1/papers/{paper['id']}")).status_code == 404
    assert (await client.get("/api/v1/papers", headers=BOB)).json()["total"] == 0
    assert (await client.get("/api/v1/papers", headers=ALICE)).json()["total"] == 1
    assert (await client.delete(f"/api/v1/papers/{paper['id']}", headers=BOB)).status_code == 404


async def test_upload_rejects_non_pdf_and_scanned_documents(client):
    fake = await client.post(
        "/api/v1/papers/upload", headers=ALICE, files={"file": ("x.pdf", b"<html>not a pdf</html>", "application/pdf")}
    )
    assert fake.status_code == 422
    from fpdf import FPDF

    blank = FPDF()
    blank.add_page()
    response = await client.post(
        "/api/v1/papers/upload", headers=ALICE, files={"file": ("scan.pdf", bytes(blank.output()), "application/pdf")}
    )
    assert response.status_code == 201
    paper = response.json()
    assert paper["status"] == "failed" and "scanned" in paper["status_detail"]


async def test_delete_rules(client, registries):
    public = await import_doi(client)
    assert (await client.delete(f"/api/v1/papers/{public['id']}", headers=ALICE)).status_code == 403
    own = (
        await client.post(
            "/api/v1/papers/upload",
            headers=ALICE,
            files={"file": ("x.pdf", make_pdf(STUDY_SECTIONS), "application/pdf")},
        )
    ).json()
    assert (await client.delete(f"/api/v1/papers/{own['id']}", headers=ALICE)).status_code == 204
    assert (await client.get(f"/api/v1/papers/{own['id']}", headers=ALICE)).status_code == 404


async def test_cite_paper_in_style(client, registries):
    paper = await import_doi(client)
    apa = (await client.get(f"/api/v1/papers/{paper['id']}/cite", params={"style": "apa"})).json()
    assert apa["in_text"] == "(Namaganda et al., 2021)"
    assert "Malaria Journal" in apa["bibliography"]
    assert "https://doi.org/10.1186/s12936-021-03812-x" in apa["bibliography"]
    vancouver = (await client.get(f"/api/v1/papers/{paper['id']}/cite", params={"style": "vancouver"})).json()
    assert vancouver["in_text"] == "(1)"
    assert (await client.get(f"/api/v1/papers/{paper['id']}/cite", params={"style": "made-up"})).status_code == 422


async def test_full_text_retrieval_from_open_access_pdf(client, registries, monkeypatch):
    paper = await import_doi(client)
    pdf_bytes = make_pdf(STUDY_SECTIONS)

    async def fake_resolve(url):
        host = re.match(r"https?://([^/]+)", url).group(1)
        return ResolvedTarget(url=url, host=host, ip="93.184.216.34")

    monkeypatch.setattr(url_safety, "resolve_public_target", fake_resolve)
    registries.get(re.compile(r"https://93\.184\.216\.34/.*")).mock(
        return_value=httpx.Response(200, content=pdf_bytes, headers={"content-type": "application/pdf"})
    )
    job = await client.post(f"/api/v1/papers/{paper['id']}/full-text", headers=ALICE)
    assert job.status_code == 202, job.text
    assert job.json()["status"] == "succeeded"
    refreshed = (await client.get(f"/api/v1/papers/{paper['id']}", headers=ALICE)).json()
    assert refreshed["status"] == "ready" and refreshed["has_pdf"] and refreshed["page_count"] >= 1


async def test_full_text_failure_is_reported_not_faked(client, registries, monkeypatch):
    paper = await import_doi(client)

    async def fake_resolve(url):
        host = re.match(r"https?://([^/]+)", url).group(1)
        return ResolvedTarget(url=url, host=host, ip="93.184.216.34")

    monkeypatch.setattr(url_safety, "resolve_public_target", fake_resolve)
    registries.get(re.compile(r"https://93\.184\.216\.34/.*")).mock(
        return_value=httpx.Response(200, text="<html>Publisher login page</html>")
    )
    job = (await client.post(f"/api/v1/papers/{paper['id']}/full-text", headers=ALICE)).json()
    assert job["status"] == "failed" and "did not return a PDF" in job["error"]
    refreshed = (await client.get(f"/api/v1/papers/{paper['id']}")).json()
    assert refreshed["status"] == "failed" and "upload the PDF yourself" in refreshed["status_detail"]
