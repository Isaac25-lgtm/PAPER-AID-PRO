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
