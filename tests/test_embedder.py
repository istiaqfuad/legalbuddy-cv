"""Unit tests for the Voyage dense encoder batching (no network)."""

from legalbuddy.embedder import VoyageDense


def _encoder() -> VoyageDense:
    enc = VoyageDense.__new__(VoyageDense)  # skip client init / env
    enc.batch_size = 64
    return enc


def test_request_batches_capped_by_tokens():
    texts = ["x" * 2000] * 10  # ~500 est tokens each (latin ~1/4)
    batches = _encoder()._request_batches(texts)
    assert sum(len(b) for b in batches) == 10
    assert all(sum(len(t) for t in b) // 4 <= 3000 for b in batches)


def test_estimate_tokens_script_aware():
    from legalbuddy.embedder import estimate_tokens
    assert estimate_tokens("abcd" * 100) == 100  # latin ~1/4
    bn = "অ" * 100
    assert estimate_tokens(bn) == 100  # bengali ~1/1
    assert estimate_tokens(bn) > estimate_tokens("a" * 100)


def test_request_batches_capped_by_count():
    assert len(_encoder()._request_batches(["hi"] * 100)) == 2  # 64 + 36


def test_request_batches_preserve_order_and_content():
    texts = [f"text-{i}-" + "y" * 100 for i in range(25)]
    flat = [t for b in _encoder()._request_batches(texts) for t in b]
    assert flat == texts


def test_shared_dense_returns_process_wide_singleton(monkeypatch):
    import legalbuddy.embedder as emb

    monkeypatch.setenv("VOYAGE_API_KEY", "test-key")
    monkeypatch.setattr(emb, "_dense_singleton", None)
    try:
        assert emb.shared_dense() is emb.shared_dense()
    finally:
        monkeypatch.setattr(emb, "_dense_singleton", None)


def test_pace_waits_when_tpm_window_would_overflow(monkeypatch):
    import time as time_mod

    import legalbuddy.embedder as emb

    enc = _encoder()
    enc.request_gap_s = 0.0
    enc.tokens_per_min = 8000
    enc._last_req = time_mod.monotonic()
    enc._window_start = time_mod.monotonic()
    enc._window_tokens = 7900
    slept: list[float] = []
    monkeypatch.setattr(emb.time, "sleep", slept.append)
    enc._pace(200)  # 7900 + 200 > 8000 -> wait out the window
    assert slept and slept[0] > 0
    assert enc._window_tokens == 0
