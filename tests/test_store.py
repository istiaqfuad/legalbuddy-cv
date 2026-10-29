"""Unit tests for Qdrant store helpers (fake client, no network)."""

from types import SimpleNamespace

from legalbuddy.chunking import chunk_act
from legalbuddy.store import (
    REQUIRED_PAYLOAD_INDEXES,
    build_filter,
    chunk_to_payload,
    verify_collection,
)


def _chunk():
    act = {
        "act_title": "The Penal Code, 1860",
        "act_no": "XLV",
        "act_year": "1860",
        "language": "english",
        "is_repealed": False,
        "sections": [{"section_content": "302. Whoever commits murder shall be punished."}],
        "footnotes": [],
        "source_url": "http://example/act.html",
    }
    return chunk_act(act, "act-print-11.json")[0]


def _info(vectors=None, sparse=None, schema=None):
    if vectors is None:
        vectors = {"denso": SimpleNamespace(size=1024, distance="Cosine")}
    if sparse is None:
        sparse = {"sparso": SimpleNamespace(modifier="idf")}
    if schema is None:
        schema = {k: SimpleNamespace(data_type=v) for k, v in REQUIRED_PAYLOAD_INDEXES.items()}
    params = SimpleNamespace(vectors=vectors, sparse_vectors=sparse)
    return SimpleNamespace(config=SimpleNamespace(params=params), payload_schema=schema)


class _FakeClient:
    def __init__(self, info):
        self._info = info

    def get_collection(self, name):
        return self._info


def test_payload_carries_indexed_and_provenance_fields():
    p = chunk_to_payload(_chunk())
    assert p["section_label"] == "302"
    assert p["source_file"] == "act-print-11.json"
    assert p["is_repealed"] is False
    assert "chunker_version" in p and p["chunker_version"]
    assert "text" in p and "footnotes" in p


def test_verify_collection_ok():
    assert verify_collection(_FakeClient(_info())) == []


def test_verify_collection_flags_wrong_dense():
    bad = {"denso": SimpleNamespace(size=768, distance="Euclid")}
    problems = verify_collection(_FakeClient(_info(vectors=bad)))
    assert any("denso" in p for p in problems)


def test_verify_collection_flags_missing_index_and_sparse():
    schema = {k: v for k, v in _info().payload_schema.items() if k != "section_label"}
    problems = verify_collection(_FakeClient(_info(sparse={}, schema=schema)))
    assert any("section_label" in p for p in problems)
    assert any("sparso" in p for p in problems)


def test_build_filter_section_label():
    f = build_filter(section_label="302")
    keys = [c.key for c in f.must]
    assert "is_repealed" in keys and "section_label" in keys
