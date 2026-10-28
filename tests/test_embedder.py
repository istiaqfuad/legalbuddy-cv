"""Unit tests for the Voyage dense encoder batching (no network)."""

from legalbuddy.embedder import VoyageDense


def _encoder() -> VoyageDense:
    enc = VoyageDense.__new__(VoyageDense)  # skip client init / env
    enc.batch_size = 64
    return enc


def test_request_batches_capped_by_tokens():
    texts = ["x" * 2000] * 10  # ~1000 est tokens each
    batches = _encoder()._request_batches(texts)
    assert sum(len(b) for b in batches) == 10
    assert all(len(b) <= 4 for b in batches)  # 4500 cap -> ~4 per request


def test_request_batches_capped_by_count():
    assert len(_encoder()._request_batches(["hi"] * 100)) == 2  # 64 + 36


def test_request_batches_preserve_order_and_content():
    texts = [f"text-{i}-" + "y" * 100 for i in range(25)]
    flat = [t for b in _encoder()._request_batches(texts) for t in b]
    assert flat == texts
