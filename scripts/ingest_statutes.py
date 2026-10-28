"""Bulk-ingest Bangladesh statutes into Qdrant (resumable, rate-paced).

Reads gitignored ``data/acts/*.json`` (bdlaws format), chunks with
``legalbuddy.chunking``, embeds with Voyage-4 (dense) + FastEmbed BM25
(sparse), and upserts to the ``legal-statutes`` collection.

Designed for Voyage's reduced free-tier limits (3 RPM / 10K TPM until a
payment method is added — free tokens still apply): requests are paced,
progress checkpoints per act to ``data/manifests/statutes.json``, and a
re-run resumes where it left off. Point IDs are deterministic, so resumed
upserts overwrite rather than duplicate.

Usage:
    uv run python scripts/ingest_statutes.py [--limit N] [--acts f1,f2,...]
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from tqdm import tqdm  # noqa: E402

from legalbuddy.chunking import chunk_act  # noqa: E402
from legalbuddy.embedder import VoyageDense, encode_sparse  # noqa: E402
from legalbuddy.store import make_client, upsert_chunks  # noqa: E402

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "acts")
MANIFEST = os.path.join(os.path.dirname(__file__), "..", "data", "manifests", "statutes.json")

EMBED_BATCH = 64
# Voyage reduced free tier: <=3 requests/min and <=10K tokens/min.
MIN_REQ_GAP_S = 21.0
TOKENS_PER_MIN = 9500


class PaceController:
    """Keep Voyage calls inside RPM + TPM limits."""

    def __init__(self) -> None:
        self.window_start = time.monotonic()
        self.window_tokens = 0
        self.last_req = 0.0

    def wait(self, est_tokens: int) -> None:
        now = time.monotonic()
        if now - self.window_start >= 60:
            self.window_start, self.window_tokens = now, 0
        if self.window_tokens + est_tokens > TOKENS_PER_MIN:
            sleep_for = 60 - (now - self.window_start) + 1
            if sleep_for > 0:
                time.sleep(sleep_for)
            self.window_start, self.window_tokens = time.monotonic(), 0
        gap = MIN_REQ_GAP_S - (time.monotonic() - self.last_req)
        if gap > 0:
            time.sleep(gap)
        self.last_req = time.monotonic()

    def record(self, tokens: int) -> None:
        self.window_tokens += tokens


def load_manifest() -> dict:
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as fh:
            return json.load(fh)
    return {"files_done": {}, "skipped_repealed": 0}


def save_manifest(manifest: dict) -> None:
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    tmp = MANIFEST + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    os.replace(tmp, MANIFEST)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--acts", default="")
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(DATA_DIR, "*.json")))
    if args.acts:
        wanted = {a for a in args.acts.split(",") if a}
        files = [f for f in files if os.path.basename(f) in wanted]
    if args.limit:
        files = files[:args.limit]

    manifest = load_manifest()
    done: dict = manifest.setdefault("files_done", {})
    todo = [f for f in files if os.path.basename(f) not in done]
    print(f"files: {len(files)} total, {len(done)} done, {len(todo)} to ingest")

    dense = VoyageDense(batch_size=EMBED_BATCH)
    sparse_ready = False
    client = make_client()
    pace = PaceController()

    for path in tqdm(todo, desc="acts"):
        with open(path, encoding="utf-8") as fh:
            act = json.load(fh)
        fname = os.path.basename(path)
        if act.get("is_repealed"):
            manifest["skipped_repealed"] = manifest.get("skipped_repealed", 0) + 1
            done[fname] = {"chunks": 0, "repealed": True}
            save_manifest(manifest)
            continue
        chunks = chunk_act(act, fname)
        if not chunks:
            done[fname] = {"chunks": 0, "empty": True}
            save_manifest(manifest)
            continue
        texts = [c.text for c in chunks]
        pace.wait(sum(len(t) for t in texts) // 4)
        before = dense.total_tokens
        try:
            dense_vecs = dense.embed(texts, input_type="document")
        except Exception as exc:
            print(f"\nSTOP at {fname}: {exc}")
            save_manifest(manifest)
            raise SystemExit(1) from exc
        pace.record(dense.total_tokens - before)
        if not sparse_ready:
            encode_sparse(["warmup"])  # download/init model once
            sparse_ready = True
        sparse_vecs = encode_sparse(texts)
        upsert_chunks(client, chunks, dense_vecs, sparse_vecs)
        done[fname] = {"chunks": len(chunks), "tokens": dense.total_tokens - before}
        save_manifest(manifest)

    total_chunks = sum(v.get("chunks", 0) for v in done.values())
    print(f"done. files={len(done)} chunks={total_chunks}")
    print(f"manifest: {MANIFEST}")


if __name__ == "__main__":
    main()
