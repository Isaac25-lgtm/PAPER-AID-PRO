"""Smoke test that runs INSIDE the production image (CI and before releases).

Unit tests run on developer machines and CI runners, whose fonts, Node and system packages differ from the image.
This script proves the built container itself can: migrate a database, start the app and report ready, export
DOCX and PDF (regular, bold, italic, bold-italic, nested table citations), and format every bundled CSL style.

    docker run --rm --network host -e DATABASE_URL=postgresql://... <image> python scripts/smoke_container.py
"""

from __future__ import annotations

import asyncio
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"SMOKE FAILED: {message}")
    print(f"ok  {message}")


def fonts_and_export() -> None:
    from docx import Document as DocxDocument

    from app.services import export

    styles, _fallbacks, covered = export._font_plan()
    check("Italic" in styles["I"] and "BoldItalic" in styles["BI"], f"real italic faces installed ({styles['I']})")
    check(ord("é") in covered and ord("ж") in covered and ord("ع") in covered, "Latin, Cyrillic and Arabic glyphs")
    a = {"type": "citation", "attrs": {"citationIds": ["a"]}}
    b = {"type": "citation", "attrs": {"citationIds": ["b"]}}
    content = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": "Plain "},
                    {"type": "text", "text": "bold ", "marks": [{"type": "bold"}]},
                    {"type": "text", "text": "italic ", "marks": [{"type": "italic"}]},
                    {"type": "text", "text": "both", "marks": [{"type": "bold"}, {"type": "italic"}]},
                ],
            },
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
                                        "type": "blockquote",
                                        "content": [
                                            {"type": "paragraph", "content": [{"type": "text", "text": "Quoted "}, a]}
                                        ],
                                    }
                                ],
                            }
                        ],
                    }
                ],
            },
            {"type": "paragraph", "content": [{"type": "text", "text": "After the table "}, b]},
        ],
    }
    rendered = {
        "clusters": [{"text": "(Alpha, 2020)", "missing_ids": []}, {"text": "(Beta, 2021)", "missing_ids": []}],
        "bibliography": ["Alpha. 2020.", "Beta. 2021."],
    }
    pdf = export.to_pdf("Smoke test — Ünïcode", content, rendered)
    check(pdf.startswith(b"%PDF") and len(pdf) > 1000, "PDF export with bold/italic and nested citations")
    docx = DocxDocument(io.BytesIO(export.to_docx("Smoke", content, rendered)))
    after = next(p.text for p in docx.paragraphs if p.text.startswith("After the table"))
    check("Beta" in after and "Alpha" in docx.tables[0].cell(0, 0).text, "DOCX keeps each citation with its claim")


async def citation_styles() -> None:
    from app.services.citations.csl import STYLES, format_citations

    item = {
        "id": "x",
        "type": "article-journal",
        "title": "Smoke",
        "author": [{"family": "Okello", "given": "P"}],
        "issued": {"date-parts": [[2021]]},
        "container-title": "Journal",
    }
    for style in STYLES:
        result = await format_citations([item], style=style, clusters=[[{"id": "x"}]], output="text")
        assert result.citations and result.citations[0].strip(), style
    check(True, f"all {len(STYLES)} citation styles format (Node + citeproc in the image)")


async def app_ready() -> None:
    from alembic import command
    from alembic.config import Config
    from httpx import ASGITransport, AsyncClient

    root = ROOT
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    await asyncio.to_thread(command.upgrade, config, "head")
    check(True, "migrations apply to an empty database")
    from app.main import create_app

    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://smoke") as client:
        ready = await client.get("/api/v1/ready")
        check(ready.status_code == 200 and ready.json().get("status") == "ready", f"/ready -> {ready.json()}")
        styles = await client.get("/api/v1/citations/styles")
        check(styles.status_code == 200 and len(styles.json()) >= 18, "API serves the style catalogue")
    from app.db.session import dispose_engine

    await dispose_engine()


def main() -> None:
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    fonts_and_export()
    asyncio.run(citation_styles())
    asyncio.run(app_ready())
    print("SMOKE PASSED")


if __name__ == "__main__":
    main()
