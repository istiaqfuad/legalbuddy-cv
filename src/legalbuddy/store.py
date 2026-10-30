"""Qdrant access for the legal-statutes collection.

Collection contract (pre-provisioned; code verifies but never creates or
mutates it — see the runbook printed by ``scripts/ingest_statutes.py``):

- name: ``legal-statutes`` (env ``COLLECTION_NAME``)
- dense vector ``denso``: 1024 dims, cosine
- sparse vector ``sparso``: ``idf`` modifier
- payload indexes: ``act_title``, ``act_no``, ``act_year``, ``language``,
  ``section_label``, ``source_file`` (keyword) and ``is_repealed`` (bool)

``section_label`` enables exact provision lookup ("Section 302");
``source_file`` enables deleting one act's points before re-ingesting a
changed version. ``verify_collection`` fails ingestion fast when the
live collection drifts from this contract.

Retrieval is dense + sparse hybrid in one Query API call: two prefetches
fused with RRF, per Qdrant's hybrid-search guidance.
"""

from __future__ import annotations

import os

from qdrant_client import QdrantClient, models

COLLECTION = os.environ.get("COLLECTION_NAME", "legal-statutes")
DOCS_COLLECTION = os.environ.get("DOCS_COLLECTION_NAME", "user-documents")
DENSE_NAME = "denso"
SPARSE_NAME = "sparso"
DENSE_SIZE = 1024  # voyage-4 output dimension

# Payload fields indexed on the user-documents collection. Both are part
# of EVERY user-doc query filter (server-side, from the session — never
# from client input), so keyword indexes keep filtered HNSW fast.
DOCS_PAYLOAD_INDEXES: dict[str, str] = {
    "user_id": "keyword",
    "doc_id": "keyword",
}

# Payload fields that must carry an index on the collection.
REQUIRED_PAYLOAD_INDEXES: dict[str, str] = {
    "act_title": "keyword",
    "act_no": "keyword",
    "act_year": "keyword",
    "language": "keyword",
    "section_label": "keyword",
    "source_file": "keyword",
    "is_repealed": "bool",
}


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


def _val(obj, key, default=None):
    """Read ``key`` from a pydantic model, namespace, or dict."""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    value = getattr(obj, key, default)
    return getattr(value, "value", value)  # unwrap enums (Distance, ...)


def verify_collection(client: QdrantClient, collection: str = COLLECTION) -> list[str]:
    """Return contract violations for the live collection ([] = healthy)."""
    try:
        info = client.get_collection(collection)
    except Exception as exc:  # missing collection, auth, network
        return [f"cannot read collection {collection!r}: {exc!r}"]
    problems: list[str] = []
    params = _val(_val(info, "config"), "params")
    vectors = _val(params, "vectors") or {}
    dense = vectors.get(DENSE_NAME) if isinstance(vectors, dict) else None
    if dense is None:
        problems.append(f"dense vector {DENSE_NAME!r} missing (named vectors required)")
    else:
        if _val(dense, "size") != DENSE_SIZE:
            problems.append(
                f"dense vector {DENSE_NAME!r} size is {_val(dense, 'size')}, "
                f"expected {DENSE_SIZE} (voyage-4)")
        if str(_val(dense, "distance")) != "Cosine":
            problems.append(
                f"dense vector {DENSE_NAME!r} distance is "
                f"{_val(dense, 'distance')}, expected Cosine")
    sparse = _val(params, "sparse_vectors") or {}
    sparso = sparse.get(SPARSE_NAME) if isinstance(sparse, dict) else None
    if sparso is None:
        problems.append(f"sparse vector {SPARSE_NAME!r} missing")
    elif str(_val(sparso, "modifier")) != "idf":
        problems.append(
            f"sparse vector {SPARSE_NAME!r} modifier is "
            f"{_val(sparso, 'modifier')}, expected idf (Qdrant/bm25 pairing)")
    schema = _val(info, "payload_schema") or {}
    for field_name, want in REQUIRED_PAYLOAD_INDEXES.items():
        entry = schema.get(field_name) if isinstance(schema, dict) else None
        got = _val(entry, "data_type") if entry is not None else None
        if got is None:
            problems.append(f"payload index missing: {field_name} ({want})")
        elif str(got) != want:
            problems.append(f"payload index {field_name} is {got}, expected {want}")
    return problems


def require_collection(client: QdrantClient, collection: str = COLLECTION) -> None:
    """Fail fast with an actionable message when the contract is violated."""
    problems = verify_collection(client, collection)
    if problems:
        raise RuntimeError(
            f"collection {collection!r} does not match the ingestion contract:\n"
            + "\n".join(f"  - {p}" for p in problems)
            + "\nFix the collection settings (see README / ingest runbook); "
              "code never creates or mutates the collection.")


def ensure_docs_collection(client: QdrantClient,
                           collection: str = DOCS_COLLECTION) -> None:
    """Create the user-documents collection on first upload if missing.

    Unlike the curated legal-statutes collection (pre-provisioned, code
    never mutates it), this one is app-managed: same vector contract
    (``denso`` 1024 cosine + ``sparso`` idf) plus keyword indexes on
    ``user_id``/``doc_id`` created up front so filtered search uses
    indexed HNSW from the first point. Never merged with statute data.
    """
    try:
        client.get_collection(collection)
        return
    except Exception:
        pass  # missing (or unreachable here) — try to create below
    client.create_collection(
        collection_name=collection,
        vectors_config={DENSE_NAME: models.VectorParams(size=DENSE_SIZE,
                                                        distance=models.Distance.COSINE)},
        sparse_vectors_config={SPARSE_NAME: models.SparseVectorParams(
            modifier=models.Modifier.IDF)},
    )
    for field_name in DOCS_PAYLOAD_INDEXES:
        client.create_payload_index(
            collection_name=collection, field_name=field_name,
            field_schema=models.PayloadSchemaType.KEYWORD)


def doc_chunk_to_payload(chunk) -> dict:
    """Payload for a user-doc point: isolation fields plus provenance."""
    return {
        # Indexed — every query filters user_id, and doc scoping adds doc_id.
        "user_id": chunk.user_id,
        "doc_id": chunk.doc_id,
        # Unindexed display / provenance fields.
        "text": chunk.text,
        "filename": chunk.filename,
        "mime": chunk.mime,
        "page": chunk.page,
        "chunk_index": chunk.chunk_index,
        "chunk_count": chunk.chunk_count,
    }


def upsert_doc_chunks(client: QdrantClient, chunks, dense_vecs, sparse_vecs,
                      collection: str = DOCS_COLLECTION,
                      batch_size: int = 256) -> int:
    """Upsert user-doc points (named vectors mirror the statute contract)."""
    points = [
        models.PointStruct(
            id=chunk.chunk_id,
            vector={
                DENSE_NAME: dense,
                SPARSE_NAME: models.SparseVector(indices=idx, values=val),
            },
            payload=doc_chunk_to_payload(chunk),
        )
        for chunk, dense, (idx, val) in zip(chunks, dense_vecs, sparse_vecs)
    ]
    for i in range(0, len(points), batch_size):
        client.upsert(collection_name=collection, points=points[i:i + batch_size])
    return len(points)


def delete_doc_points(client: QdrantClient, user_id: str, doc_id: str,
                      collection: str = DOCS_COLLECTION) -> None:
    """Delete one document's points. user_id is always part of the filter."""
    client.delete(
        collection_name=collection,
        points_selector=models.FilterSelector(filter=models.Filter(must=[
            models.FieldCondition(key="user_id",
                                  match=models.MatchValue(value=user_id)),
            models.FieldCondition(key="doc_id",
                                  match=models.MatchValue(value=doc_id)),
        ])),
        wait=True,
    )


def search_user_docs(client: QdrantClient, dense_query: list[float],
                     sparse_query: tuple[list[int], list[float]],
                     user_id: str, doc_ids: list[str], limit: int = 4,
                     prefetch_limit: int = 20,
                     collection: str = DOCS_COLLECTION):
    """Hybrid search over a user's attached documents only.

    The ``user_id`` + ``doc_ids`` filter is built here from server-side
    values and applied inside the query (both prefetches), never as a
    post-filter: other users' chunks cannot consume result slots, and a
    missing filter returns nothing instead of everything.
    """
    s_idx, s_val = sparse_query
    query_filter = models.Filter(must=[
        models.FieldCondition(key="user_id", match=models.MatchValue(value=user_id)),
        # Nested should-group: OR over the attached docs (a bare
        # `should` list means at least one must match).
        models.Filter(
            should=[models.FieldCondition(key="doc_id",
                                          match=models.MatchValue(value=d))
                    for d in doc_ids]
        ) if len(doc_ids) > 1 else
        models.FieldCondition(key="doc_id", match=models.MatchValue(value=doc_ids[0])),
    ])
    return client.query_points(
        collection_name=collection,
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


def chunk_to_payload(chunk) -> dict:
    """Payload keeps the indexed fields plus unindexed provenance."""
    return {
        # Indexed (keyword/bool) — exact-match filters.
        "act_title": chunk.act_title,
        "act_no": chunk.act_no,
        "act_year": chunk.act_year,
        "language": chunk.language,
        "is_repealed": chunk.is_repealed,
        "section_label": chunk.section_label,
        "source_file": chunk.source_file,
        # Unindexed provenance / display fields.
        "text": chunk.text,
        "section_index": chunk.section_index,
        "section_title": chunk.section_title,
        "part_index": chunk.part_index,
        "part_count": chunk.part_count,
        "footnotes": list(getattr(chunk, "footnotes", []) or []),
        "chunker_version": str(getattr(chunk, "chunker_version", "")),
        "source_url": chunk.source_url,
    }


def upsert_chunks(client: QdrantClient, chunks, dense_vecs, sparse_vecs,
                  batch_size: int = 256, wait: bool = False) -> int:
    """Upsert chunk points with named dense + sparse vectors. Returns count.

    ``wait=True`` makes the final batch visible before returning, so a
    manifest checkpoint written right after never claims invisible data.
    """
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
        last = i + batch_size >= len(points)
        client.upsert(collection_name=COLLECTION, points=points[i:i + batch_size],
                      wait=wait and last)
    return len(points)


def delete_act_points(client: QdrantClient, source_file: str,
                      collection: str = COLLECTION) -> None:
    """Delete every point of one act (before re-ingesting a changed act)."""
    client.delete(
        collection_name=collection,
        points_selector=models.FilterSelector(filter=models.Filter(must=[
            models.FieldCondition(key="source_file",
                                  match=models.MatchValue(value=source_file)),
        ])),
        wait=True,
    )


def build_filter(language: str | None = None, act_year: str | None = None,
                 act_title: str | None = None,
                 section_label: str | None = None) -> models.Filter | None:
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
    if section_label:
        must.append(models.FieldCondition(
            key="section_label", match=models.MatchValue(value=section_label)))
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


def dbsf_search(client: QdrantClient, dense_query: list[float],
                sparse_query: tuple[list[int], list[float]],
                limit: int = 8, prefetch_limit: int = 40,
                query_filter: models.Filter | None = None):
    """One-call hybrid search fused with DBSF (score-distribution fusion).

    Same shape as :func:`hybrid_search`, no parameters to tune: per-prefetch
    scores are normalized by mean +/- 3 deviations before summing.
    """
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
        query=models.FusionQuery(fusion=models.Fusion.DBSF),
        limit=limit,
        with_payload=True,
    )


_BN_RANGE = ("\u0980", "\u09ff")  # Bengali block: script detection, no deps.


def is_bengali_script(text: str) -> bool:
    """True when the query carries Bengali-script tokens (pure or mixed)."""
    return any(_BN_RANGE[0] <= ch <= _BN_RANGE[1] for ch in text)


def dense_weight_for(query: str) -> float:
    """Dense weight for weighted fusion, from env with a Bengali-script rule.

    ``DENSE_WEIGHT`` (default 0.7) normally; ``DENSE_WEIGHT_BN`` (default
    0.85) when the query has Bengali-script tokens, where same-script BM25
    floods the ranking with surface matches. Env-tunable without code change.
    """
    try:
        base = float(os.environ.get("DENSE_WEIGHT", "0.7"))
        bn = float(os.environ.get("DENSE_WEIGHT_BN", "0.85"))
    except ValueError:
        base, bn = 0.7, 0.85
    base = min(max(base, 0.0), 1.0)
    bn = min(max(bn, 0.0), 1.0)
    return bn if is_bengali_script(query) else base


def _min_max(scores: list[float]) -> list[float]:
    """Min-max normalize one candidate list; all-equal maps to 1.0s."""
    if not scores:
        return []
    lo, hi = min(scores), max(scores)
    if hi == lo:
        return [1.0] * len(scores)
    return [(s - lo) / (hi - lo) for s in scores]


def weighted_search(client: QdrantClient, query: str, dense_query: list[float],
                    sparse_query: tuple[list[int], list[float]],
                    limit: int = 8, prefetch_limit: int = 40,
                    query_filter: models.Filter | None = None):
    """Weighted score fusion: dense meaning outvotes sparse surface matches.

    Two single-vector queries (same filter), min-max normalized per list,
    combined as ``w*dense + (1-w)*sparse`` with :func:`dense_weight_for`.
    Returns the same ``.points`` shape (id/payload/score) as the fused
    searches so callers are unchanged; scores are fused weights in [0, 1].
    """
    from types import SimpleNamespace

    s_idx, s_val = sparse_query
    dense_hits = client.query_points(
        collection_name=COLLECTION, query=dense_query, using=DENSE_NAME,
        limit=prefetch_limit, query_filter=query_filter,
        with_payload=True).points
    sparse_hits = client.query_points(
        collection_name=COLLECTION,
        query=models.SparseVector(indices=s_idx, values=s_val),
        using=SPARSE_NAME, limit=prefetch_limit, query_filter=query_filter,
        with_payload=True).points
    w_dense = dense_weight_for(query)
    w_sparse = 1.0 - w_dense
    dense_norm = _min_max([float(p.score) for p in dense_hits])
    sparse_norm = _min_max([float(p.score) for p in sparse_hits])
    fused: dict = {}
    for p, n in zip(dense_hits, dense_norm):
        entry = fused.setdefault(p.id, {"payload": p.payload, "score": 0.0})
        entry["score"] += w_dense * n
    for p, n in zip(sparse_hits, sparse_norm):
        entry = fused.setdefault(p.id, {"payload": p.payload, "score": 0.0})
        entry["score"] += w_sparse * n
    ranked = sorted(fused.items(), key=lambda kv: kv[1]["score"], reverse=True)[:limit]
    points = [SimpleNamespace(id=pid, payload=e["payload"], score=e["score"])
              for pid, e in ranked]
    return SimpleNamespace(points=points)

