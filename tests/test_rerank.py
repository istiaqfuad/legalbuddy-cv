"""Cross-encoder rerank (Jina) over fused candidates."""

from types import SimpleNamespace

import pytest

import legalbuddy.rerank as rerank_mod
from legalbuddy.rerank import rerank_order, rerank_points


def _pts(n):
    return [
        SimpleNamespace(id=f"p{i}", payload={"text": f"chunk text {i}"}, score=1.0 - i * 0.1)
        for i in range(n)
    ]


def _api_response(order):
    # order: list of (index, score) in rank order
    return {
        "results": [
            {"index": i, "relevance_score": s} for i, s in order
        ]
    }


class TestRerankOrder:
    def test_reorders_by_relevance(self, monkeypatch):
        monkeypatch.setattr(
            rerank_mod, "_post",
            lambda payload: _api_response([(2, 0.9), (0, 0.5), (1, 0.1)]),
        )
        assert rerank_order("q", ["a", "b", "c"], 3) == [
            (2, 0.9), (0, 0.5), (1, 0.1)]

    def test_truncates_to_top_n(self, monkeypatch):
        seen = {}
        def fake_post(payload):
            seen.update(payload)
            return _api_response([(1, 0.8), (0, 0.2)])
        monkeypatch.setattr(rerank_mod, "_post", fake_post)
        out = rerank_order("q", ["a", "b"], 1)
        assert seen["top_n"] == 1
        assert out == [(1, 0.8)]

    def test_sends_model_and_no_documents_back(self, monkeypatch):
        seen = {}
        monkeypatch.setattr(
            rerank_mod, "_post",
            lambda payload: seen.update(payload) or _api_response([(0, 1.0)]),
        )
        rerank_order("query text", ["doc"], 1)
        assert seen["model"] == "jina-reranker-v3.5"
        assert seen["return_documents"] is False
        assert seen["query"] == "query text"
        assert seen["documents"] == ["doc"]

    def test_missing_key_keeps_fusion_order(self, monkeypatch):
        def no_key(payload):
            raise RuntimeError("JINA_API_KEY is not set")
        monkeypatch.setattr(rerank_mod, "_post", no_key)
        assert rerank_order("q", ["a", "b", "c"], 2) == [(0, 0.0), (1, 0.0)]

    def test_http_error_keeps_fusion_order(self, monkeypatch):
        def boom(payload):
            raise ConnectionError("jina unreachable")
        monkeypatch.setattr(rerank_mod, "_post", boom)
        assert rerank_order("q", ["a", "b"], 2) == [(0, 0.0), (1, 0.0)]

    def test_empty_inputs(self):
        assert rerank_order("q", [], 3) == []
        assert rerank_order("  ", ["a"], 3) == []

    def test_ignores_out_of_range_indices(self, monkeypatch):
        monkeypatch.setattr(
            rerank_mod, "_post",
            lambda payload: {"results": [
                {"index": 9, "relevance_score": 0.99},
                {"index": 0, "relevance_score": 0.1},
            ]},
        )
        assert rerank_order("q", ["a", "b"], 2) == [(0, 0.1)]


class TestRerankPoints:
    def test_reorders_and_rescores(self, monkeypatch):
        monkeypatch.setattr(
            rerank_mod, "_post",
            lambda payload: _api_response([(2, 0.9), (0, 0.7), (1, 0.2)]),
        )
        ranked = rerank_points("q", _pts(3), 3)
        assert [p.id for p in ranked] == ["p2", "p0", "p1"]
        assert [p.score for p in ranked] == [0.9, 0.7, 0.2]
        assert ranked[0].payload["text"] == "chunk text 2"

    def test_single_point_skips_api_call(self, monkeypatch):
        def boom(payload):
            raise AssertionError("must not call the API for one candidate")
        monkeypatch.setattr(rerank_mod, "_post", boom)
        ranked = rerank_points("q", _pts(1), 3)
        assert [p.id for p in ranked] == ["p0"]

    def test_empty_points_no_call(self, monkeypatch):
        def boom(payload):
            raise AssertionError("must not call the API with no candidates")
        monkeypatch.setattr(rerank_mod, "_post", boom)
        assert rerank_points("q", [], 3) == []


class TestRetrievalWiring:
    def test_retrieve_overfetches_then_reranks(self, monkeypatch):
        import legalbuddy.chat as chat_mod

        class FakeDense:
            def embed(self, texts, input_type=None):
                return [[0.1] * 4 for _ in texts]

        monkeypatch.setattr(chat_mod, "VoyageDense", FakeDense)
        monkeypatch.setattr(chat_mod, "make_client", lambda: object())
        monkeypatch.setattr(chat_mod, "encode_sparse",
                            lambda texts: [([1], [0.5])])
        seen = {}

        def fake_weighted(client, q, dq, sq, limit=None, query_filter=None):
            seen["fetch_limit"] = limit
            return SimpleNamespace(points=_pts(limit or 10))

        monkeypatch.setattr(chat_mod, "weighted_search", fake_weighted)

        def fake_rerank(query, points, top_n):
            seen["rerank_n"] = (len(points), top_n)
            return points[:top_n]

        monkeypatch.setattr(chat_mod, "rerank_points", fake_rerank)
        out = chat_mod.retrieve("punishment for murder", limit=6)
        assert seen["fetch_limit"] >= 6
        assert seen["fetch_limit"] > 6  # over-fetch for the reranker
        assert seen["rerank_n"] == (seen["fetch_limit"], 6)
        assert len(out.points) == 6

    def test_retrieve_falls_back_when_rerank_fails(self, monkeypatch):
        import legalbuddy.chat as chat_mod

        class FakeDense:
            def embed(self, texts, input_type=None):
                return [[0.1] * 4 for _ in texts]

        monkeypatch.setattr(chat_mod, "VoyageDense", FakeDense)
        monkeypatch.setattr(chat_mod, "make_client", lambda: object())
        monkeypatch.setattr(chat_mod, "encode_sparse",
                            lambda texts: [([1], [0.5])])
        monkeypatch.setattr(
            chat_mod, "weighted_search",
            lambda *a, **k: SimpleNamespace(points=_pts(8)))
        # Real rerank fn, dead API: fusion order must survive.
        def dead_api(payload):
            raise ConnectionError("jina unreachable")
        monkeypatch.setattr(rerank_mod, "_post", dead_api)
        out = chat_mod.retrieve("punishment for murder", limit=4)
        assert [p.id for p in out.points] == ["p0", "p1", "p2", "p3"]

    def test_retrieve_docs_reranks_to_limit(self, monkeypatch):
        import legalbuddy.chat as chat_mod

        class FakeDense:
            def embed(self, texts, input_type=None):
                return [[0.1] * 4 for _ in texts]

        monkeypatch.setattr(chat_mod, "VoyageDense", FakeDense)
        monkeypatch.setattr(chat_mod, "make_client", lambda: object())
        monkeypatch.setattr(chat_mod, "encode_sparse",
                            lambda texts: [([1], [0.5])])
        seen = {}

        def fake_search(client, dq, sq, user_id, doc_ids, limit=None):
            seen["fetch_limit"] = limit
            return SimpleNamespace(points=_pts(limit or 10))

        monkeypatch.setattr(chat_mod, "search_user_docs", fake_search)

        def fake_rerank(query, points, top_n):
            seen["rerank_n"] = (len(points), top_n)
            return points[:top_n]

        monkeypatch.setattr(chat_mod, "rerank_points", fake_rerank)
        out = chat_mod.retrieve_docs("q", "u1", ["d1"], limit=4)
        assert seen["fetch_limit"] > 4
        assert seen["rerank_n"] == (seen["fetch_limit"], 4)
        assert len(out.points) == 4


def test_missing_key_raises_before_network(monkeypatch):
    monkeypatch.delenv("JINA_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="JINA_API_KEY"):
        rerank_mod._post({"model": "m", "query": "q", "documents": ["d"]})
