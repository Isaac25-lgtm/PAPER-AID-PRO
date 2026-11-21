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
