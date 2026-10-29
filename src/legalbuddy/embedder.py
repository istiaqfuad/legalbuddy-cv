"""Embedding encoders: Voyage dense + FastEmbed BM25 sparse.

- Dense: Voyage ``voyage-4``, 1024 dims, ``input_type="document"`` for
  storage and ``input_type="query"`` for search (asymmetric pairing matters
  for retrieval quality).
- Sparse: FastEmbed ``Qdrant/bm25`` client-side vectors. These are raw
  lexical weights; the collection's ``sparso`` vector is configured with the
  ``idf`` modifier, which is the sanctioned pairing per Qdrant docs.
  BM25 tokenization is language-neutral enough to cover the mixed
  English/Bangla corpus without an English-only SPLADE vocabulary.
"""

from __future__ import annotations

import os
import time

import voyageai
from fastembed import SparseTextEmbedding
from voyageai.error import RateLimitError


def estimate_tokens(text: str) -> int:
    """Script-aware token estimate calibrated on billed usage.

    Voyage bills Bengali near ~1 token/char but Latin legal text near
    ~1 token/4 chars. The old chars//2 rule underestimated dense Bengali
    2x, producing requests that blew the 10K TPM window on every retry.
    """
    bn = sum(1 for ch in text if "\u0980" <= ch <= "\u09ff")
    return bn + (len(text) - bn + 3) // 4

DENSE_MODEL = os.environ.get("EMBEDDING_MODEL", "voyage-4")
SPARSE_MODEL = "Qdrant/bm25"


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


# The single pacing control for Voyage lives in VoyageDense: a request
# gap (RPM) plus a rolling tokens-per-minute window (TPM). Defaults are
# the reduced free tier (~3 RPM / 10K TPM, kept at 8K for headroom). On a
# paid tier set VOYAGE_REQUEST_GAP_S=0 and VOYAGE_TOKENS_PER_MIN to the
# tier limit (and optionally raise VOYAGE_MAX_TOKENS_PER_REQUEST); there
# is deliberately no second pacer in the ingest script.
DEFAULT_REQUEST_GAP_S = _env_float("VOYAGE_REQUEST_GAP_S", 25.0)
DEFAULT_TOKENS_PER_MIN = _env_int("VOYAGE_TOKENS_PER_MIN", 8000)
# Max estimated tokens per API request: with the script-aware estimator this
# is close to billed tokens, so 3000 keeps paced requests inside the
# 10K TPM rolling window instead of 429-looping forever.
MAX_TOKENS_PER_REQUEST = _env_int("VOYAGE_MAX_TOKENS_PER_REQUEST", 3000)

_sparse_singleton: SparseTextEmbedding | None = None


def sparse_encoder() -> SparseTextEmbedding:
    """Process-wide singleton (model download + init happens once)."""
    global _sparse_singleton
    if _sparse_singleton is None:
        _sparse_singleton = SparseTextEmbedding(SPARSE_MODEL)
    return _sparse_singleton


def encode_sparse(texts: list[str]) -> list[tuple[list[int], list[float]]]:
    """Encode texts to (indices, values) pairs ready for Qdrant."""
    if not texts:
        return []
    out: list[tuple[list[int], list[float]]] = []
    for vec in sparse_encoder().embed(texts):
        out.append((vec.indices.tolist(), vec.values.tolist()))
    return out


class VoyageDense:
    """Batched Voyage dense encoder with retry/backoff and request pacing.

    Pacing (the pipeline's only pacer) enforces both the request gap
    (env ``VOYAGE_REQUEST_GAP_S``) and a rolling tokens-per-minute window
    (env ``VOYAGE_TOKENS_PER_MIN``) before every API request, including
    the internal batches of one ``embed`` call.
    """

    def __init__(self, model: str = DENSE_MODEL, batch_size: int = 64,
                 max_retries: int = 4,
                 request_gap_s: float | None = None,
                 tokens_per_min: int | None = None) -> None:
        self.client = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])
        self.model = model
        self.batch_size = batch_size
        self.max_retries = max_retries
        self.request_gap_s = (DEFAULT_REQUEST_GAP_S if request_gap_s is None
                              else request_gap_s)
        self.tokens_per_min = (DEFAULT_TOKENS_PER_MIN if tokens_per_min is None
                               else tokens_per_min)
        self.total_tokens = 0
        self._last_req = 0.0
        self._window_start = time.monotonic()
        self._window_tokens = 0

    def _pace(self, est_tokens: int = 0) -> None:
        now = time.monotonic()
        if now - self._window_start >= 60:
            self._window_start, self._window_tokens = now, 0
        tpm = getattr(self, "tokens_per_min", DEFAULT_TOKENS_PER_MIN)
        if tpm > 0 and self._window_tokens + est_tokens > tpm:
            sleep_for = 60 - (now - self._window_start) + 1
            if sleep_for > 0:
                time.sleep(sleep_for)
            self._window_start, self._window_tokens = time.monotonic(), 0
        gap = self.request_gap_s - (time.monotonic() - self._last_req)
        if gap > 0:
            time.sleep(gap)
        self._last_req = time.monotonic()

    def _record(self, tokens: int) -> None:
        self._window_tokens = getattr(self, "_window_tokens", 0) + tokens

    def _request_batches(self, texts: list[str]) -> list[list[str]]:
        """Split into request batches capped by count AND estimated tokens."""
        batches, cur, cur_est = [], [], 0
        for t in texts:
            est = max(estimate_tokens(t), 1)
            if cur and (len(cur) >= self.batch_size or cur_est + est > MAX_TOKENS_PER_REQUEST):
                batches.append(cur)
                cur, cur_est = [], 0
            cur.append(t)
            cur_est += est
        if cur:
            batches.append(cur)
        return batches

    def embed(self, texts: list[str], input_type: str) -> list[list[float]]:
        out: list[list[float]] = []
        for batch in self._request_batches(texts):
            est = sum(max(estimate_tokens(t), 1) for t in batch)
            for attempt in range(self.max_retries):
                try:
                    self._pace(est)
                    res = self.client.embed(batch, model=self.model, input_type=input_type)
                    break
                except RateLimitError:
                    # Reset the TPM window so the caller's backoff retry
                    # does not immediately re-trip the local pacer.
                    self._window_start, self._window_tokens = time.monotonic(), 0
                    raise  # outer loop owns rate-limit backoff; don't hammer
                except Exception:
                    if attempt == self.max_retries - 1:
                        raise
                    time.sleep(2 ** attempt)
            billed = res.total_tokens or est
            self._record(billed)
            out.extend(res.embeddings)
            self.total_tokens += billed
        return out
