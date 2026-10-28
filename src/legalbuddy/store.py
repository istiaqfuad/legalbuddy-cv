"""Qdrant access for the legal-statutes collection.

Collection contract (pre-provisioned, must not be changed by code):

- name: ``legal-statutes`` (env ``COLLECTION_NAME``)
- dense vector ``denso``: 1024 dims, cosine
- sparse vector ``sparso``: ``idf`` modifier
- payload keyword/bool indexes: ``act_title``, ``act_no``, ``act_year``,
  ``language``, ``is_repealed``

Retrieval is dense + sparse hybrid in one Query API call: two prefetches
fused with RRF, per Qdrant's hybrid-search guidance.
"""

from __future__ import annotations

import os

from qdrant_client import QdrantClient, models

COLLECTION = os.environ.get("COLLECTION_NAME", "legal-statutes")
DENSE_NAME = "denso"
SPARSE_NAME = "sparso"


def make_client() -> QdrantClient:
    """Client tuned for Qdrant Cloud behind a reverse proxy.

    qdrant-client defaults to port 6333 when the URL omits a port, but an
    https Cloud endpoint is served on 443 — without the explicit port the
    connection intermittently fails (SSL/write/read timeouts). A generous
    REST timeout absorbs slow cross-region links.
    """
    from urllib.parse import urlparse

    url = os.environ["QDRANT_URL"]
    kwargs: dict = {"url": url, "api_key": os.environ["QDRANT_API_KEY"], "timeout": 120}
    parsed = urlparse(url)
    if parsed.scheme == "https" and parsed.port is None:
        kwargs["port"] = 443
    return QdrantClient(**kwargs)


def chunk_to_payload(chunk) -> dict:
    """Payload keeps the five indexed fields plus unindexed provenance."""
    return {
        # Indexed (keyword/bool) — exact-match filters.
        "act_title": chunk.act_title,
        "act_no": chunk.act_no,
        "act_year": chunk.act_year,
        "language": chunk.language,
        "is_repealed": chunk.is_repealed,
        # Unindexed provenance / display fields.
        "text": chunk.text,
        "section_index": chunk.section_index,
        "section_label": chunk.section_label,
        "section_title": chunk.section_title,
        "part_index": chunk.part_index,
        "part_count": chunk.part_count,
        "source_url": chunk.source_url,
        "source_file": chunk.source_file,
    }


def upsert_chunks(client: QdrantClient, chunks, dense_vecs, sparse_vecs,
                  batch_size: int = 256) -> int:
    """Upsert chunk points with named dense + sparse vectors. Returns count."""
    points = [
        models.PointStruct(
            id=chunk.chunk_id,
            vector={
                DENSE_NAME: dense,
                SPARSE_NAME: models.SparseVector(indices=idx, values=val),
            },
            payload=chunk_to_payload(chunk),
        )
        for chunk, dense, (idx, val) in zip(chunks, dense_vecs, sparse_vecs)
    ]
    for i in range(0, len(points), batch_size):
        client.upsert(collection_name=COLLECTION, points=points[i:i + batch_size])
    return len(points)


def build_filter(language: str | None = None, act_year: str | None = None,
                 act_title: str | None = None) -> models.Filter | None:
    """Metadata filter over the indexed payload fields only."""
    must: list[models.FieldCondition] = [
        models.FieldCondition(key="is_repealed", match=models.MatchValue(value=False))
    ]
    if language:
        must.append(models.FieldCondition(key="language", match=models.MatchValue(value=language)))
    if act_year:
        must.append(models.FieldCondition(key="act_year", match=models.MatchValue(value=act_year)))
    if act_title:
        must.append(models.FieldCondition(key="act_title", match=models.MatchValue(value=act_title)))
    return models.Filter(must=must)


def hybrid_search(client: QdrantClient, dense_query: list[float],
                  sparse_query: tuple[list[int], list[float]],
                  limit: int = 8, prefetch_limit: int = 40,
                  query_filter: models.Filter | None = None):
    """One-call hybrid search: dense + sparse prefetches fused with RRF."""
    s_idx, s_val = sparse_query
    return client.query_points(
        collection_name=COLLECTION,
        prefetch=[
            models.Prefetch(query=dense_query, using=DENSE_NAME, limit=prefetch_limit,
                            filter=query_filter),
            models.Prefetch(
                query=models.SparseVector(indices=s_idx, values=s_val),
                using=SPARSE_NAME, limit=prefetch_limit, filter=query_filter),
        ],
        query=models.FusionQuery(fusion=models.Fusion.RRF),
        limit=limit,
        with_payload=True,
    )

