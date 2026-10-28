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

DENSE_MODEL = os.environ.get("EMBEDDING_MODEL", "voyage-4")
SPARSE_MODEL = "Qdrant/bm25"

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
    """Batched Voyage dense encoder with simple retry/backoff."""

    def __init__(self, model: str = DENSE_MODEL, batch_size: int = 64,
                 max_retries: int = 4) -> None:
        self.client = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])
        self.model = model
        self.batch_size = batch_size
        self.max_retries = max_retries
        self.total_tokens = 0

    def embed(self, texts: list[str], input_type: str) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), self.batch_size):
            batch = texts[i:i + self.batch_size]
            for attempt in range(self.max_retries):
                try:
                    res = self.client.embed(batch, model=self.model, input_type=input_type)
                    break
                except Exception:
                    if attempt == self.max_retries - 1:
                        raise
                    time.sleep(2 ** attempt)
            out.extend(res.embeddings)
            self.total_tokens += res.total_tokens or 0
        return out
