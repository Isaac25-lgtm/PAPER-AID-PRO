"""Template writing guidance is a paragraph setting: kept on save, exported in italics, never inherited."""


def test_template_guidance_is_kept_and_exported_in_italics():
    import io

    from docx import Document as Docx

    from app.services.documents import normalise_document
    from app.services.export import to_docx

    content = normalise_document(
        {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "attrs": {"guidance": True},
                    "content": [{"type": "text", "text": "Summarise it."}],
                },
                {"type": "paragraph", "attrs": {"guidance": "yes"}, "content": [{"type": "text", "text": "My words."}]},
            ],
        }
    )
    assert content["content"][0]["attrs"] == {"guidance": True}
    assert "attrs" not in content["content"][1]  # only a real true is kept
    runs = {p.text: p.runs[0].italic for p in Docx(io.BytesIO(to_docx("T", content, {}))).paragraphs if p.runs}
    assert runs["Summarise it."] is True and not runs["My words."]


def test_both_exports_label_citations_on_the_tree_they_render():
    """Audit Q8: guidance italics and citation labels are prepared once, together, for Word and PDF alike, including
    a citation inside a table cell."""
    import io

    from docx import Document as Docx
    from pypdf import PdfReader

    from app.services.export import prepare_for_export, to_docx, to_pdf

    citation = {"type": "citation", "attrs": {"citationIds": ["c1"]}}
    content = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "attrs": {"guidance": True}, "content": [{"type": "text", "text": "Describe it."}]},
            {
                "type": "table",
                "content": [
                    {
                        "type": "tableRow",
                        "content": [
                            {
                                "type": "tableCell",
                                "content": [
                                    {
                                        "type": "paragraph",
                                        "content": [{"type": "text", "text": "Rates fell "}, citation],
                                    }
                                ],
                            }
                        ],
                    }
                ],
            },
        ],
    }
    rendered = {"clusters": [{"citation_ids": ["c1"], "text": "(Smith, 2020)", "missing_ids": []}], "bibliography": []}
    prepared, labels = prepare_for_export(content, rendered)
    assert list(labels.values()) == ["(Smith, 2020)"] and prepared is not content  # labels belong to the new tree

    word = Docx(io.BytesIO(to_docx("T", content, rendered)))
    assert "Rates fell (Smith, 2020)" in word.tables[0].cell(0, 0).text
    guidance = next(p for p in word.paragraphs if p.text == "Describe it.")
    assert guidance.runs[0].italic is True

    pdf_text = "".join(page.extract_text() for page in PdfReader(io.BytesIO(to_pdf("T", content, rendered))).pages)
    assert "(Smith, 2020)" in pdf_text and "Describe it." in pdf_text


def test_reference_addresses_are_links_in_word_and_pdf():
    """Silver, 25 November 2026: a DOI in the reference list opens the article from the exported file too. The
    sentence's full stop is not part of the link."""
    import io

    from docx import Document as Docx
    from pypdf import PdfReader

    from app.services.export import split_links, to_docx, to_pdf

    entry = "Suri, T., &amp; Jack, W. (2016). <i>Science</i>, 354, 1288. https://doi.org/10.1126/science.aah5309."
    url = "https://doi.org/10.1126/science.aah5309"
    rendered = {"clusters": [], "bibliography": [entry]}
    content = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Body."}]}]}
    assert split_links("See https://x.org/a(1)). Next") == [
        ("See ", False),
        ("https://x.org/a(1)", True),
        ("). Next", False),
    ]

    word = Docx(io.BytesIO(to_docx("T", content, rendered)))
    reference = word.paragraphs[-1]
    assert reference.text.endswith(url + ".")
    assert [rel.target_ref for rel in word.part.rels.values() if rel.is_external] == [url]
    assert reference._p.xpath("./w:hyperlink")  # the address is a link element, not plain text

    pdf = PdfReader(io.BytesIO(to_pdf("T", content, rendered)))
    uris = [a.get_object()["/A"]["/URI"] for page in pdf.pages for a in page.get("/Annots") or []]
    assert uris == [url]
    assert url in "".join(page.extract_text() for page in pdf.pages)
