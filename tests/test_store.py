"""Unit tests for Qdrant store helpers (fake client, no network)."""

from types import SimpleNamespace

from legalbuddy.chunking import chunk_act
from legalbuddy.store import (
    REQUIRED_PAYLOAD_INDEXES,
    build_filter,
    chunk_to_payload,
    dense_weight_for,
    is_bengali_script,
    verify_collection,
    weighted_search,
)


def _pt(pid, score, act="A"):
    return SimpleNamespace(id=pid, score=score, payload={"act_title": act})


class _HybridFake:
    """Fake client serving fixed dense/sparse candidate lists."""

    def __init__(self, dense, sparse):
        self._dense = dense
        self._sparse = sparse
        self.calls = []

    # Mirrors qdrant-client 1.20.0's real parameter names so a wrong
    # kwarg (e.g. filter= instead of query_filter=) fails here, not in prod.
    _ALLOWED = {"collection_name", "query", "using", "limit", "query_filter",
                "with_payload", "prefetch"}

    def query_points(self, **kw):
        unknown = set(kw) - self._ALLOWED
        assert not unknown, f"unknown query_points kwargs: {unknown}"
        self.calls.append(kw)
        pts = self._sparse if kw.get("using") == "sparso" else self._dense
        return SimpleNamespace(points=[p for p in pts][: kw.get("limit", 40)])


def test_is_bengali_script_detects_pure_and_mixed():
    assert is_bengali_script("খুনের শাস্তি কী?")
    assert is_bengali_script("Districts Act অনুযায়ী কী?")
    assert not is_bengali_script("What is the punishment for murder?")
    assert not is_bengali_script("Section 302")


def test_dense_weight_for_rules(monkeypatch):
    monkeypatch.delenv("DENSE_WEIGHT", raising=False)
    monkeypatch.delenv("DENSE_WEIGHT_BN", raising=False)
    assert dense_weight_for("murder?") == 0.7
    assert dense_weight_for("খুনের শাস্তি কী?") == 0.85
    monkeypatch.setenv("DENSE_WEIGHT", "0.5")
    monkeypatch.setenv("DENSE_WEIGHT_BN", "0.6")
    assert dense_weight_for("murder?") == 0.5
    assert dense_weight_for("খুন?") == 0.6
    monkeypatch.setenv("DENSE_WEIGHT", "junk")
    assert dense_weight_for("murder?") == 0.7  # invalid env falls back
    assert dense_weight_for("খুন?") == 0.85
    monkeypatch.setenv("DENSE_WEIGHT", "9")  # valid but clamped to [0, 1]
    monkeypatch.setenv("DENSE_WEIGHT_BN", "0.2")
    assert dense_weight_for("murder?") == 1.0


def test_weighted_search_dense_outvotes_sparse(monkeypatch):
    monkeypatch.delenv("DENSE_WEIGHT", raising=False)
    monkeypatch.delenv("DENSE_WEIGHT_BN", raising=False)
    # Dense ranks X first, sparse ranks Y first: weight 0.7 settles for X.
    client = _HybridFake(
        dense=[_pt("X", 0.9, "Penal"), _pt("Y", 0.1, "VAT")],
        sparse=[_pt("Y", 30.0, "VAT"), _pt("X", 1.0, "Penal")],
    )
    hits = weighted_search(client, "murder?", [0.0], ([0], [1.0]), limit=2)
    assert [p.id for p in hits.points] == ["X", "Y"]
    assert hits.points[0].score == 0.7  # 0.7*1.0 + 0.3*0.0
    assert hits.points[0].payload["act_title"] == "Penal"


def test_weighted_search_bengali_query_leans_denser(monkeypatch):
    monkeypatch.delenv("DENSE_WEIGHT", raising=False)
    monkeypatch.delenv("DENSE_WEIGHT_BN", raising=False)
    # Same lists, Bengali query (w=0.85): X must still win by more.
    client = _HybridFake(
        dense=[_pt("X", 0.9, "Penal"), _pt("Y", 0.1, "VAT")],
        sparse=[_pt("Y", 30.0, "VAT"), _pt("X", 1.0, "Penal")],
    )
    hits = weighted_search(client, "খুন?", [0.0], ([0], [1.0]), limit=1)
    assert hits.points[0].id == "X"
    assert hits.points[0].score == 0.85


def test_weighted_search_respects_limit_and_filter(monkeypatch):
    monkeypatch.delenv("DENSE_WEIGHT", raising=False)
    monkeypatch.delenv("DENSE_WEIGHT_BN", raising=False)
    from legalbuddy.store import build_filter as bf
    client = _HybridFake(
        dense=[_pt("A", 0.9), _pt("B", 0.8), _pt("C", 0.7)],
        sparse=[_pt("C", 5.0), _pt("B", 4.0), _pt("A", 3.0)],
    )
    f = bf(language="english")
    hits = weighted_search(client, "q", [0.0], ([0], [1.0]), limit=2, query_filter=f)
    assert len(hits.points) == 2
    assert all(c.get("query_filter") is f for c in client.calls)
    assert len(client.calls) == 2  # one dense + one sparse query


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
