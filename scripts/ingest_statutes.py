"""Bulk-ingest Bangladesh statutes into Qdrant.

Reads gitignored ``data/acts/*.json`` (bdlaws format), chunks with
``legalbuddy.chunking``, embeds with Voyage-4 (dense) + FastEmbed BM25
(sparse), and upserts to the ``legal-statutes`` collection.

Idempotent: point IDs are deterministic, so re-running overwrites rather
than duplicating. A manifest (``data/manifests/statutes.json``) records
what was ingested and what was skipped.

Usage:
    uv run python scripts/ingest_statutes.py [--limit N] [--acts f1,f2,...]
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from tqdm import tqdm  # noqa: E402

from legalbuddy.chunking import StatuteChunk, chunk_act  # noqa: E402
from legalbuddy.embedder import VoyageDense, encode_sparse  # noqa: E402
from legalbuddy.store import hybrid_search, make_client, upsert_chunks  # noqa: E402

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "acts")
MANIFEST = os.path.join(os.path.dirname(__file__), "..", "data", "manifests", "statutes.json")

EMBED_BATCH = 64
UPSERT_BATCH = 256


def load_acts(limit: int = 0, only: list[str] | None = None) -> list[tuple[str, dict]]:
    files = sorted(glob.glob(os.path.join(DATA_DIR, "*.json")))
    if only:
        wanted = set(only)
        files = [f for f in files if os.path.basename(f) in wanted]
    if limit:
        files = files[:limit]
    acts = []
    for path in files:
        with open(path, encoding="utf-8") as fh:
            acts.append((os.path.basename(path), json.load(fh)))
    return acts


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="ingest only first N files")
    ap.add_argument("--acts", default="", help="comma-separated basenames to ingest")
    ap.add_argument("--verify-query", default="What is the punishment for murder?",
                    help="smoke-test query after ingest")
    args = ap.parse_args()

    acts = load_acts(args.limit, [a for a in args.acts.split(",") if a] or None)
    print(f"loaded {len(acts)} act files")

    all_chunks: list[StatuteChunk] = []
    skipped_repealed = 0
    for fname, act in tqdm(acts, desc="chunking"):
        if act.get("is_repealed"):
            skipped_repealed += 1
            continue
        all_chunks.extend(chunk_act(act, fname))
    print(f"chunks: {len(all_chunks)} (skipped {skipped_repealed} repealed acts)")
    if not all_chunks:
        return

    dense = VoyageDense(batch_size=EMBED_BATCH)
    texts = [c.text for c in all_chunks]
    print("encoding dense (voyage-4)...")
    dense_vecs: list[list[float]] = []
    for i in tqdm(range(0, len(texts), EMBED_BATCH * 4), desc="dense"):
        dense_vecs.extend(dense.embed(texts[i:i + EMBED_BATCH * 4], input_type="document"))
    print(f"dense tokens used: {dense.total_tokens}")
    print("encoding sparse (bm25)...")
    sparse_vecs = encode_sparse(texts)

    client = make_client()
    n = upsert_chunks(client, all_chunks, dense_vecs, sparse_vecs, UPSERT_BATCH)
    print(f"upserted {n} points")

    try:
        from legalbuddy.embedder import DENSE_MODEL
        probe_dense = dense.embed([args.verify_query], input_type="query")[0]
        probe_sparse = encode_sparse([args.verify_query])[0]
        hits = hybrid_search(client, probe_dense, probe_sparse, limit=3)
        print(f"smoke query: {args.verify_query!r}")
        for p in hits.points:
            print(f"  score={p.score:.3f} {p.payload.get('act_title')} s{p.payload.get('section_label')}")
    except Exception as exc:  # smoke test must not fail the ingest
        print(f"smoke query failed: {exc}")

    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        json.dump({
            "files_seen": len(acts),
            "chunks_upserted": n,
            "skipped_repealed": skipped_repealed,
            "dense_tokens": dense.total_tokens,
        }, fh, indent=2)
    print(f"manifest: {MANIFEST}")


if __name__ == "__main__":
    main()
