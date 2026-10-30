"""Cross-encoder rerank of retrieved chunks via the Jina Reranker API.

Pipeline position: after hybrid fusion (Qdrant weighted/RRF/DBSF), before
evidence assembly. Fusion finds candidates; ``jina-reranker-v3.5`` (0.6B
multilingual listwise reranker, 131K context) orders them precisely,
which matters most for Bangla and mixed-language queries where the
0.57-precision dense leg can bury the right section.

Best-effort like the rest of the memory path: missing key, HTTP error, or
fewer than 2 candidates returns the fusion order unchanged, so answering
never breaks. Jina's quota (500 RPM / 1M TPM) is far roomier than the
Voyage free tier, so one rerank call per retrieval leg is affordable.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request

logger = logging.getLogger(__name__)

RERANK_URL = "https://api.jina.ai/v1/rerank"
MODEL = os.environ.get("JINA_RERANK_MODEL", "jina-reranker-v3.5")
CANDIDATES = int(os.environ.get("RERANK_CANDIDATES", "20"))
QUERY_CHARS = 4000
DOC_CHARS = 2000
TIMEOUT_S = 30


def _post(payload: dict) -> dict:
    # Get your Jina AI API key for free: https://jina.ai/?sui=apikey
    key = os.environ.get("JINA_API_KEY", "")
    if not key:
        raise RuntimeError("JINA_API_KEY is not set")
    req = urllib.request.Request(
        RERANK_URL,
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {key}",
        },
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
        return json.loads(res.read())


def rerank_order(query: str, texts: list[str], top_n: int) -> list[tuple[int, float]]:
    """Return ``(original_index, relevance_score)`` best-first.

    Falls back to the input order (scores 0.0) when reranking is
    unavailable, so callers keep fusion order instead of failing.
    """
    if not texts or not query.strip():
        return []
    try:
        data = _post(
            {
                "model": MODEL,
                "query": query[:QUERY_CHARS],
                "documents": [t[:DOC_CHARS] for t in texts],
                "top_n": max(1, min(top_n, len(texts))),
                "return_documents": False,
            }
        )
        ordered = []
        for r in data.get("results", []):
            idx = int(r["index"])
            if 0 <= idx < len(texts):
                ordered.append((idx, float(r.get("relevance_score", 0.0))))
        # Defensive: the API should honor top_n, but never return more than
        # asked even if it doesn't.
        if ordered:
            return ordered[:top_n]
        logger.warning("rerank returned no usable results, keeping fusion order")
    except Exception as exc:
        logger.warning("rerank failed, keeping fusion order: %s", exc)
    return [(i, 0.0) for i in range(min(top_n, len(texts)))]


def rerank_points(query: str, points, top_n: int):
    """Reorder retrieved points by cross-encoder relevance, truncated.

    ``points`` are Qdrant-like objects with ``.payload["text"]``; the
    returned list keeps the same objects (scores replaced by relevance
    scores) in the new order. With fewer than 2 candidates there is nothing
    to order, so no API call is made.
    """
    points = list(points or [])
    if len(points) < 2:
        return points[:top_n]
    texts = [str((p.payload or {}).get("text", "")) for p in points]
    order = rerank_order(query, texts, top_n)
    ranked = []
    for idx, score in order:
        p = points[idx]
        p.score = score
        ranked.append(p)
    return ranked
