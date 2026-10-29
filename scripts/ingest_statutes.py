"""Bulk-ingest Bangladesh statutes into Qdrant (resumable, rate-paced).

Reads ``data/acts/*.json`` (bdlaws format), chunks with
``legalbuddy.chunking``, embeds with Voyage-4 (dense) + FastEmbed BM25
(sparse), and upserts to the ``legal-statutes`` collection.

Resumability contract (manifest ``data/manifests/statutes.json``):

- An act is done only when its entry carries the current file SHA-256 and
  ingest version (chunker + embedding models). Changed or legacy entries
  are re-ingested; the act's old points are deleted by ``source_file``
  first, so amendments never leave orphaned chunks.
- Chunk/parse failures go to ``files_failed`` (never ``files_done``) and
  are retried on the next run.
- Point IDs are deterministic, so a resumed upsert overwrites, never
  duplicates. The manifest is checkpointed after every cycle.

Pacing is a single knob in ``legalbuddy.embedder``: env
``VOYAGE_REQUEST_GAP_S`` (default 25s, reduced free tier). On a paid tier
set it to 0 in the environment — do not edit this script.

Usage:
    uv run python scripts/ingest_statutes.py [--limit N] [--acts f1,f2,...]
                                             [--force] [--check-only]
                                             [--skip-preflight]

Deepnote / overnight: set QDRANT_URL, QDRANT_API_KEY, COLLECTION_NAME,
VOYAGE_API_KEY (and optionally VOYAGE_REQUEST_GAP_S) as environment
variables, run ``--check-only`` first, then the full command. Re-running
the same command resumes from the manifest.
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

from voyageai.error import RateLimitError  # noqa: E402

from legalbuddy.chunking import chunk_act, is_act_repealed  # noqa: E402
from legalbuddy.embedder import VoyageDense, encode_sparse, estimate_tokens  # noqa: E402
from legalbuddy.ingest_state import (  # noqa: E402
    allocate_tokens,
    cycle_slices,
    entry_is_current,
    file_sha256,
    ingest_version,
)
from legalbuddy.store import (  # noqa: E402
    DENSE_SIZE,
    delete_act_points,
    make_client,
    require_collection,
    upsert_chunks,
)

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "acts")
MANIFEST = os.path.join(os.path.dirname(__file__), "..", "data", "manifests", "statutes.json")

EMBED_BATCH = 64
RATE_LIMIT_RETRIES = 8
RATE_LIMIT_SLEEP_S = 70.0
# Cross-act batching: fill each embed cycle with chunks from several acts
# instead of one request per act (median act is only ~11 sections).
CYCLE_TOKEN_TARGET = 6000
CYCLE_CHUNK_CAP = 384
UPSERT_RETRIES = 5
VERSION = ingest_version()


def load_manifest() -> dict:
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as fh:
            manifest = json.load(fh)
    else:
        manifest = {}
    manifest.setdefault("files_done", {})
    manifest.setdefault("files_failed", {})
    manifest.setdefault("skipped_repealed", 0)
    return manifest


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
    ap.add_argument("--force", action="store_true",
                    help="re-ingest every selected act (points deleted first)")
    ap.add_argument("--check-only", action="store_true",
                    help="preflight + plan only; embed and upsert nothing")
    ap.add_argument("--skip-preflight", action="store_true",
                    help="skip the collection contract check (not recommended)")
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(DATA_DIR, "*.json")))
    if args.acts:
        wanted = {a for a in args.acts.split(",") if a}
        files = [f for f in files if os.path.basename(f) in wanted]
    if args.limit:
        files = files[:args.limit]
    if not files:
        print("no act files selected")
        raise SystemExit(1)

    client = make_client()
    if args.skip_preflight:
        print("WARNING: collection preflight skipped", flush=True)
    else:
        require_collection(client)  # raises with an actionable list
        print("collection preflight: OK", flush=True)

    manifest = load_manifest()
    done: dict = manifest["files_done"]
    failed: dict = manifest["files_failed"]

    # Plan: hash every selected file; only hash+version-current acts skip.
    todo: list[tuple[str, str, str, bool]] = []  # path, fname, hash, replace
    current = 0
    for path in files:
        fname = os.path.basename(path)
        try:
            digest = file_sha256(path)
        except OSError as exc:
            failed[fname] = {"error": f"hash: {exc}"[:200],
                             "attempts": failed.get(fname, {}).get("attempts", 0) + 1}
            continue
        entry = done.get(fname)
        if not args.force and entry_is_current(entry, digest, VERSION):
            current += 1
            continue
        todo.append((path, fname, digest, args.force or entry is not None))
    save_manifest(manifest)
    print(f"files: {len(files)} selected, {current} current, "
          f"{len(todo)} to ingest, {len(failed)} previously failed", flush=True)
    if args.check_only:
        print("check-only: nothing embedded or upserted")
        return

    dense = VoyageDense(batch_size=EMBED_BATCH)
    sparse_ready = False
    started = time.monotonic()

    def est_tokens(texts: list[str]) -> int:
        return sum(estimate_tokens(t) for t in texts)

    # Per-act accumulators for acts split across cycles: an act is marked
    # done only when its final slice has been upserted.
    partial_chunks: dict[str, int] = {}
    partial_tokens: dict[str, int] = {}

    def process_cycle(batch: list[tuple]) -> None:
        """Embed + upsert one cycle of act slices, checkpoint finished acts."""
        nonlocal sparse_ready
        texts = [c.text for _, chunks, *_ in batch for c in chunks]
        before = dense.total_tokens
        for attempt in range(RATE_LIMIT_RETRIES):
            try:
                dense_vecs = dense.embed(texts, input_type="document")
                break
            except RateLimitError:
                fnames = ",".join(f for f, *_ in batch[:3])
                print(f"\nrate-limited at [{fnames}...] (try {attempt + 1}), "
                      f"sleeping {RATE_LIMIT_SLEEP_S:.0f}s", flush=True)
                time.sleep(RATE_LIMIT_SLEEP_S)
        else:
            save_manifest(manifest)
            print("\nSTOP: persistent rate limits, manifest checkpointed", flush=True)
            raise SystemExit(1)
        if any(len(v) != DENSE_SIZE for v in dense_vecs):
            save_manifest(manifest)
            raise SystemExit(
                f"STOP: embedding model returned non-{DENSE_SIZE}-dim vectors; "
                "check EMBEDDING_MODEL against the collection contract")
        if not sparse_ready:
            encode_sparse(["warmup"])  # download/init model once
            sparse_ready = True
        sparse_vecs = encode_sparse(texts)
        flat_chunks = [c for _, chunks, *_ in batch for c in chunks]
        for attempt in range(UPSERT_RETRIES):
            try:
                # First slice of an act: delete its stale points (if any)
                # before replacing them. Always safe — no-op for new acts.
                for fname, _ch, _h, _e, is_first, _last in batch:
                    if is_first:
                        delete_act_points(client, fname)
                upsert_chunks(client, flat_chunks, dense_vecs, sparse_vecs, wait=True)
                break
            except Exception as exc:  # transient Cloud/link hiccup
                print(f"\nupsert retry {attempt + 1}: {exc!r}", flush=True)
                time.sleep(10 * (attempt + 1))
        else:
            save_manifest(manifest)
            print("\nSTOP: persistent upsert failures, manifest checkpointed", flush=True)
            raise SystemExit(1)
        spent = dense.total_tokens - before
        if spent <= 0:
            spent = est_tokens(texts)
        shares = allocate_tokens(spent, [item[3] for item in batch])
        finished = 0
        for (fname, chunks, digest, _est, _first, is_last), share in zip(batch, shares):
            partial_chunks[fname] = partial_chunks.get(fname, 0) + len(chunks)
            partial_tokens[fname] = partial_tokens.get(fname, 0) + share
            if is_last:
                done[fname] = {"chunks": partial_chunks.pop(fname),
                               "tokens": partial_tokens.pop(fname),
                               "file_hash": digest, "ingest_version": VERSION}
                failed.pop(fname, None)
                finished += 1
        save_manifest(manifest)
        n_chunks = sum(len(c) for _, c, *_ in batch)
        print(f"cycle: {len(batch)} slices, {n_chunks} chunks, {spent} tokens, "
              f"{finished} acts done, elapsed {time.monotonic() - started:.0f}s",
              flush=True)

    def act_stream():
        """Yield (fname, chunks, hash, chunk_ests, replace) act by act."""
        for path, fname, digest, replace in tqdm(todo, desc="acts"):
            try:
                with open(path, encoding="utf-8") as fh:
                    act = json.load(fh)
                repealed = is_act_repealed(act)
                chunks = [] if repealed else chunk_act(act, fname)
            except Exception as exc:  # malformed file: record, retry next run
                print(f"\nfailed {fname}: {exc!r}", flush=True)
                failed[fname] = {"error": str(exc)[:200],
                                 "attempts": failed.get(fname, {}).get("attempts", 0) + 1}
                save_manifest(manifest)
                continue
            if repealed or not chunks:
                if replace:
                    delete_act_points(client, fname)  # drop any live points
                if repealed:
                    manifest["skipped_repealed"] = manifest.get("skipped_repealed", 0) + 1
                done[fname] = {"chunks": 0, "file_hash": digest,
                               "ingest_version": VERSION,
                               **({"repealed": True} if repealed else {"empty": True})}
                failed.pop(fname, None)
                save_manifest(manifest)
                continue
            yield fname, chunks, digest, [estimate_tokens(c.text) for c in chunks], replace

    try:
        for cycle in cycle_slices(act_stream(), CYCLE_TOKEN_TARGET, CYCLE_CHUNK_CAP):
            process_cycle(cycle)
    except KeyboardInterrupt:
        save_manifest(manifest)
        print("\ninterrupted: manifest checkpointed; re-run to resume", flush=True)
        raise SystemExit(130)

    total_chunks = sum(v.get("chunks", 0) for v in done.values())
    print(f"done. files_done={len(done)} chunks={total_chunks} "
          f"failed={len(failed)} skipped_repealed={manifest.get('skipped_repealed', 0)}")
    if failed:
        print("failed files (retried on next run): " + ", ".join(sorted(failed)))
    print(f"manifest: {MANIFEST}")


if __name__ == "__main__":
    main()
