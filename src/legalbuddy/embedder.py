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
# Max estimated tokens per API request: with the script-aware estimator this
# is close to billed tokens, so 3000 keeps 2-3 paced requests inside the
# 10K TPM rolling window instead of 429-looping forever.
MAX_TOKENS_PER_REQUEST = 3000

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
    """Batched Voyage dense encoder with retry/backoff and per-request pacing.

    ``request_gap_s`` spaces consecutive API requests (the reduced free tier
    allows ~3 RPM); it applies inside multi-batch ``embed`` calls too, so
    callers pacing per *cycle* stay compliant across internal batches.
    """

    def __init__(self, model: str = DENSE_MODEL, batch_size: int = 64,
                 max_retries: int = 4, request_gap_s: float = 25.0) -> None:
        self.client = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])
        self.model = model
        self.batch_size = batch_size
        self.max_retries = max_retries
        self.request_gap_s = request_gap_s
        self.total_tokens = 0
        self._last_req = 0.0

    def _pace(self) -> None:
        gap = self.request_gap_s - (time.monotonic() - self._last_req)
        if gap > 0:
            time.sleep(gap)
        self._last_req = time.monotonic()

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
            for attempt in range(self.max_retries):
                try:
                    self._pace()
                    res = self.client.embed(batch, model=self.model, input_type=input_type)
                    break
                except RateLimitError:
                    raise  # outer loop owns rate-limit backoff; don't hammer
                except Exception:
                    if attempt == self.max_retries - 1:
                        raise
                    time.sleep(2 ** attempt)
            out.extend(res.embeddings)
            self.total_tokens += res.total_tokens or 0
        return out
