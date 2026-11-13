"""Live checks against the real public scholarly APIs. Opt-in: `pytest -m live` (needs internet)."""

import pytest

from app.services.citations.verify import verify_reference
from app.services.scholarly.aggregator import federated_search, resolve_identifier
from app.services.scholarly.identifiers import Identifier

pytestmark = pytest.mark.live


async def test_live_federated_search_hits_every_provider():
    works, statuses = await federated_search("insecticide treated bed nets malaria children", limit=15)
    print({s.provider: (s.ok, s.count, s.error) for s in statuses})
    assert sum(s.ok for s in statuses) >= 3, statuses
    assert len(works) >= 5
    assert any(w.doi for w in works) and any(w.abstract for w in works)


@pytest.mark.parametrize(
    ("identifier", "expected_title_word"),
    [
        (Identifier("doi", "10.1038/nature14539"), "deep learning"),
        (Identifier("pmid", "31978945"), "coronavirus"),
        (Identifier("arxiv", "1706.03762"), "attention"),
    ],
)
async def test_live_identifier_resolution(identifier, expected_title_word):
    work = await resolve_identifier(identifier)
    assert work is not None
    assert expected_title_word in work.title.lower()
    assert work.authors and work.year


async def test_live_reference_verification():
    real = "LeCun Y, Bengio Y, Hinton G. Deep learning. Nature. 2015;521(7553):436-444. doi:10.1038/nature14539"
    result = await verify_reference(real)
    assert result["verdict"] == "verified", result
