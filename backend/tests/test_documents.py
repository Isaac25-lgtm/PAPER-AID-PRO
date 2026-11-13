"""Documents: CRUD, sanitisation, optimistic concurrency, citations + bibliography, revisions, export."""

import io

from docx import Document as DocxDocument

from tests.conftest import ALICE, BOB, import_doi


def doc_with_citation(citation_id: str | None = None) -> dict:
    paragraph = [{"type": "text", "text": "School bed nets reduced malaria incidence "}]
    if citation_id:
        paragraph.append({"type": "citation", "attrs": {"citationIds": [citation_id]}})
    paragraph.append({"type": "text", "text": "."})
    return {
        "type": "doc",
        "content": [
            {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Background"}]},
            {"type": "paragraph", "content": paragraph},
        ],
    }


async def create_doc(client, headers=ALICE, **body):
    response = await client.post("/api/v1/documents", json={"title": "Chapter 2", **body}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def test_create_list_get_and_isolation(client):
    doc = await create_doc(client)
    assert doc["version"] == 1 and doc["csl_style"] == "apa" and doc["content"]["type"] == "doc"
    assert [d["id"] for d in (await client.get("/api/v1/documents", headers=ALICE)).json()] == [doc["id"]]
    assert (await client.get(f"/api/v1/documents/{doc['id']}", headers=BOB)).status_code == 404
    assert (
        await client.patch(f"/api/v1/documents/{doc['id']}", json={"base_version": 1, "title": "x"}, headers=BOB)
    ).status_code == 404
    assert (await client.post("/api/v1/documents", json={"csl_style": "nope"}, headers=ALICE)).status_code == 422


async def test_content_is_sanitised(client):
    dirty = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {
                        "type": "text",
                        "text": "click",
                        "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}],
                    },
                    {
                        "type": "text",
                        "text": " safe",
                        "marks": [{"type": "link", "attrs": {"href": "https://doi.org/10.1/x"}}, {"type": "evil"}],
                    },
                ],
            },
            {"type": "iframe", "attrs": {"src": "https://evil"}, "content": [{"type": "text", "text": "kept text"}]},
            {"type": "heading", "attrs": {"level": 9, "onclick": "x"}, "content": [{"type": "text", "text": "H"}]},
        ],
    }
    doc = await create_doc(client, content=dirty)
    paragraph, unknown, heading = doc["content"]["content"]
    assert "marks" not in paragraph["content"][0]
    assert paragraph["content"][1]["marks"] == [{"type": "link", "attrs": {"href": "https://doi.org/10.1/x"}}]
    assert unknown == {"type": "paragraph", "content": [{"type": "text", "text": "kept text"}]}
    assert heading["attrs"] == {"level": 4}


async def test_autosave_versions_and_conflicts(client):
    doc = await create_doc(client)
    saved = (
        await client.patch(
            f"/api/v1/documents/{doc['id']}", headers=ALICE, json={"base_version": 1, "content": doc_with_citation()}
        )
    ).json()
    assert saved["version"] == 2 and saved["word_count"] == 7
    stale = await client.patch(
        f"/api/v1/documents/{doc['id']}", headers=ALICE, json={"base_version": 1, "title": "Other tab"}
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["details"] == {"server_version": 2}


async def test_citations_bibliography_and_style_switch(client, registries):
    paper = await import_doi(client)
    doc = await create_doc(client)
    citation = (
        await client.post(
            f"/api/v1/documents/{doc['id']}/citations", headers=ALICE, json={"paper_id": paper["id"], "locator": "4"}
        )
    ).json()
    await client.patch(
        f"/api/v1/documents/{doc['id']}",
        headers=ALICE,
        json={"base_version": 1, "content": doc_with_citation(citation["id"])},
    )
    rendered = (await client.get(f"/api/v1/documents/{doc['id']}/rendered-citations", headers=ALICE)).json()
    assert rendered["clusters"] == [{"citation_ids": [citation["id"]], "text": "(Namaganda et al., 2021, p. 4)"}]
    assert len(rendered["bibliography"]) == 1 and "Malaria Journal" in rendered["bibliography"][0]
    ieee = (
        await client.get(f"/api/v1/documents/{doc['id']}/rendered-citations", params={"style": "ieee"}, headers=ALICE)
    ).json()
    assert ieee["clusters"][0]["text"] == "[1, p. 4]"
    sources = (await client.get(f"/api/v1/documents/{doc['id']}/sources", headers=ALICE)).json()
    assert [s["id"] for s in sources] == [paper["id"]]


async def test_citing_another_users_private_paper_is_impossible(client):
    from tests.conftest import STUDY_SECTIONS, make_pdf

    private = (
        await client.post(
            "/api/v1/papers/upload", headers=BOB, files={"file": ("b.pdf", make_pdf(STUDY_SECTIONS), "application/pdf")}
        )
    ).json()
    doc = await create_doc(client)
    response = await client.post(
        f"/api/v1/documents/{doc['id']}/citations", headers=ALICE, json={"paper_id": private["id"]}
    )
    assert response.status_code == 404


async def test_revisions_and_restore(client):
    doc = await create_doc(client)
    await client.patch(
        f"/api/v1/documents/{doc['id']}",
        headers=ALICE,
        json={"base_version": 1, "title": "Draft B", "checkpoint": True},
    )
    # An autosave within the revision interval is not snapshotted...
    await client.patch(f"/api/v1/documents/{doc['id']}", headers=ALICE, json={"base_version": 2, "title": "Draft C"})
    revisions = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=ALICE)).json()
    assert [r["reason"] for r in revisions] == ["checkpoint", "created"]
    original = next(r for r in revisions if r["reason"] == "created")
    restored = (
        await client.post(f"/api/v1/documents/{doc['id']}/revisions/{original['id']}/restore", headers=ALICE)
    ).json()
    assert restored["title"] == "Chapter 2" and restored["version"] == 4
    after = (await client.get(f"/api/v1/documents/{doc['id']}/revisions", headers=ALICE)).json()
    # ...so restoring first preserves the unsaved "Draft C" state, then records the restore.
    by_reason = {r["reason"]: r for r in after}
    assert by_reason["before_restore"]["title"] == "Draft C" and by_reason["before_restore"]["version"] == 3
    assert by_reason["restored"]["version"] == 4
    assert len({r["version"] for r in after}) == len(after), "one revision per version"


async def test_export_docx_and_pdf_include_formatted_citations(client, registries):
    paper = await import_doi(client)
    doc = await create_doc(client)
    citation = (
        await client.post(f"/api/v1/documents/{doc['id']}/citations", headers=ALICE, json={"paper_id": paper["id"]})
    ).json()
    await client.patch(
        f"/api/v1/documents/{doc['id']}",
        headers=ALICE,
        json={"base_version": 1, "content": doc_with_citation(citation["id"])},
    )
    docx_response = await client.get(f"/api/v1/documents/{doc['id']}/export", params={"format": "docx"}, headers=ALICE)
    assert docx_response.status_code == 200
    text = "\n".join(p.text for p in DocxDocument(io.BytesIO(docx_response.content)).paragraphs)
    assert "(Namaganda et al., 2021)" in text and "References" in text and "Malaria Journal" in text
    pdf_response = await client.get(f"/api/v1/documents/{doc['id']}/export", params={"format": "pdf"}, headers=ALICE)
    assert pdf_response.status_code == 200 and pdf_response.content.startswith(b"%PDF-")
    assert len(pdf_response.content) > 2000
