"""Library items, collections, isolation between users, BibTeX/RIS import and export."""

import json

from tests import fixtures as fx
from tests.conftest import ALICE, BOB, import_doi

BIBTEX = r"""
@article{namaganda2021,
  title = {School-based malaria prevention with insecticide-treated nets},
  author = {Namaganda, Grace and Okello, Peter},
  journal = {Malaria Journal},
  year = {2021},
  doi = {10.1186/s12936-021-03812-x}
}
@book{local2019,
  title = {Field Methods in Epidemiology},
  author = {Kato, Ruth},
  publisher = {Makerere University Press},
  year = {2019}
}
"""

RIS = """TY  - JOUR
TI  - Community health workers and malaria case management
AU  - Achieng, Mary
PY  - 2018
JO  - East African Medical Journal
SP  - 10
EP  - 18
ER  -
"""


async def test_library_add_update_remove(client, registries):
    paper = await import_doi(client, ALICE, add_to_library=False)
    added = await client.post("/api/v1/library", json={"paper_id": paper["id"]}, headers=ALICE)
    assert added.status_code == 201
    duplicate = await client.post("/api/v1/library", json={"paper_id": paper["id"]}, headers=ALICE)
    assert duplicate.status_code == 409
    updated = await client.patch(
        f"/api/v1/library/{paper['id']}",
        headers=ALICE,
        json={"notes": "Key RCT for chapter 2", "tags": ["rct", "rct", " malaria "]},
    )
    assert updated.json()["tags"] == ["rct", "malaria"]
    items = (await client.get("/api/v1/library", params={"tag": "rct"}, headers=ALICE)).json()
    assert len(items) == 1 and items[0]["notes"] == "Key RCT for chapter 2"
    assert (await client.get("/api/v1/library", headers=BOB)).json() == []
    assert (await client.delete(f"/api/v1/library/{paper['id']}", headers=ALICE)).status_code == 204
    assert (await client.get("/api/v1/library", headers=ALICE)).json() == []


async def test_collections_are_private_and_scoped_to_library(client, registries):
    paper = await import_doi(client, ALICE)
    collection = (
        await client.post("/api/v1/collections", json={"name": "Thesis ch.2", "color": "#336699"}, headers=ALICE)
    ).json()
    assert (await client.post("/api/v1/collections", json={"name": "Thesis ch.2"}, headers=ALICE)).status_code == 409
    assert (
        await client.post("/api/v1/collections", json={"name": "x", "color": "red"}, headers=ALICE)
    ).status_code == 422
    put = await client.put(f"/api/v1/collections/{collection['id']}/papers/{paper['id']}", headers=ALICE)
    assert put.status_code == 204
    listed = (await client.get("/api/v1/collections", headers=ALICE)).json()
    assert listed[0]["paper_count"] == 1
    in_collection = (
        await client.get("/api/v1/library", params={"collection_id": collection["id"]}, headers=ALICE)
    ).json()
    assert [i["paper"]["id"] for i in in_collection] == [paper["id"]]
    assert in_collection[0]["collection_ids"] == [collection["id"]]
    # Bob cannot see or modify Alice's collection.
    assert (await client.get("/api/v1/collections", headers=BOB)).json() == []
    assert (await client.delete(f"/api/v1/collections/{collection['id']}", headers=BOB)).status_code == 404
    assert (
        await client.put(f"/api/v1/collections/{collection['id']}/papers/{paper['id']}", headers=BOB)
    ).status_code == 404
    # Removing from the library also removes collection membership.
    await client.delete(f"/api/v1/library/{paper['id']}", headers=ALICE)
    assert (await client.get("/api/v1/collections", headers=ALICE)).json()[0]["paper_count"] == 0


async def test_bibtex_import_resolves_dois_and_keeps_private_entries(client, registries):
    response = await client.post(
        "/api/v1/library/import", headers=ALICE, files={"file": ("refs.bib", BIBTEX.encode(), "application/x-bibtex")}
    )
    assert response.json() == {"imported": 2, "skipped": 0, "errors": []}
    items = (await client.get("/api/v1/library", headers=ALICE)).json()
    by_title = {i["paper"]["title"]: i["paper"] for i in items}
    book = by_title["Field Methods in Epidemiology"]
    assert book["visibility"] == "private" and book["authors"] == ["Ruth Kato"] and book["work_type"] == "book"
    article = next(p for p in by_title.values() if p["doi"] == fx.DOI)
    assert article["visibility"] == "public"
    again = (
        await client.post(
            "/api/v1/library/import", headers=ALICE, files={"file": ("refs.bib", BIBTEX.encode(), "text/plain")}
        )
    ).json()
    assert again["skipped"] >= 1
    assert (await client.get(f"/api/v1/papers/{book['id']}", headers=BOB)).status_code == 404


async def test_ris_import_and_round_trip_exports(client, registries):
    await client.post(
        "/api/v1/library/import",
        headers=ALICE,
        files={"file": ("refs.ris", RIS.encode(), "application/x-research-info-systems")},
    )
    await import_doi(client, ALICE)
    bib = await client.get("/api/v1/library/export", params={"format": "bibtex"}, headers=ALICE)
    assert bib.status_code == 200 and "attachment" in bib.headers["content-disposition"]
    assert "@article{" in bib.text and "Achieng, Mary" in bib.text and "pages = {10--18}" in bib.text
    ris = (await client.get("/api/v1/library/export", params={"format": "ris"}, headers=ALICE)).text
    assert "TY  - JOUR" in ris and f"DO  - {fx.DOI}" in ris and "SP  - 10" in ris
    csl = json.loads((await client.get("/api/v1/library/export", params={"format": "csl-json"}, headers=ALICE)).text)
    assert {item["title"] for item in csl} >= {"Community health workers and malaria case management"}


async def test_import_rejects_unknown_formats(client):
    response = await client.post(
        "/api/v1/library/import", headers=ALICE, files={"file": ("notes.txt", b"just some notes", "text/plain")}
    )
    assert response.status_code == 422
