"""Bulk-ingest case studies into Qdrant (resumable, rate-paced).

Reads ``data/processed/cases.jsonl`` (one record per judgment: cleaned
page texts + metadata), chunks with ``legalbuddy.case_parsing``,
embeds with Voyage-4 (dense) + FastEmbed BM25 (sparse), and upserts to
the ``case_studies`` collection (named vectors ``denso``/``sparso``,
keyword payload indexes per ``CASE_PAYLOAD_INDEXES``).

Resumability contract (manifest ``data/manifests/cases-ingest.json``):

- A case file is done only when its entry carries the current record
  SHA-256 and ingest version (chunker + embedding models). Changed or
  legacy entries are re-ingested; the file's old points are deleted by
  ``source_file`` first, so metadata refreshes never leave stale chunks.
- Chunk/parse failures go to ``files_failed`` (never ``files_done``) and
  are retried on the next run.
- Chunk IDs are deterministic UUID5, so a resumed upsert overwrites,
  never duplicates. The manifest is checkpointed after every cycle.

Pacing lives in ``legalbuddy.embedder`` (shared ``VoyageDense``): env
``VOYAGE_REQUEST_GAP_S`` and ``VOYAGE_TOKENS_PER_MIN``. The case API key
is ``VOYAGE_CASE_API_KEY`` (mapped to ``VOYAGE_API_KEY`` here); on a paid
tier lower the gap in the environment — do not edit this script.

Usage:
    uv run python scripts/ingest_cases.py [--limit N] [--files f1,f2,...]
                                          [--force] [--check-only]
                                          [--skip-preflight]
                                          [--recreate-collection]

Deepnote / overnight: set QDRANT_URL, QDRANT_API_KEY, CASE_COLLECTION_NAME,
VOYAGE_API_KEY (= the case key) as environment variables, run
``--check-only`` first, then the full command. Re-running the same
command resumes from the manifest.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
if not os.environ.get("VOYAGE_API_KEY") and os.environ.get("VOYAGE_CASE_API_KEY"):
    os.environ["VOYAGE_API_KEY"] = os.environ["VOYAGE_CASE_API_KEY"]

from tqdm import tqdm  # noqa: E402

from voyageai.error import RateLimitError  # noqa: E402
from qdrant_client import models  # noqa: E402

from legalbuddy.case_parsing import (  # noqa: E402
    CASE_CHUNKER_VERSION,
    case_chunk_to_payload,
    chunk_case_document,
)
from legalbuddy.embedder import (  # noqa: E402
    DENSE_MODEL,
    SPARSE_MODEL,
    VoyageDense,
    encode_sparse,
    estimate_tokens,
)
from legalbuddy.ingest_state import (  # noqa: E402
    allocate_tokens,
    cycle_slices,
    entry_is_current,
)
from legalbuddy.store import (  # noqa: E402
    CASE_COLLECTION,
    DENSE_NAME,
    DENSE_SIZE,
    SPARSE_NAME,
    delete_case_points,
    ensure_case_collection,
    make_client,
    verify_case_collection,
)

DATA_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "processed", "cases.jsonl")
MANIFEST = os.path.join(os.path.dirname(__file__), "..", "data", "manifests", "cases-ingest.json")

EMBED_BATCH = 64
RATE_LIMIT_SLEEP_S = 70.0
CYCLE_TOKEN_TARGET = 6000
CYCLE_CHUNK_CAP = 384
UPSERT_RETRIES = 5
VERSION = f"casechunker={CASE_CHUNKER_VERSION};dense={DENSE_MODEL};sparse={SPARSE_MODEL}"


def record_hash(record: dict) -> str:
    return hashlib.sha256(
        json.dumps(record, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()


def load_manifest() -> dict:
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as fh:
            manifest = json.load(fh)
    else:
        manifest = {}
    manifest.setdefault("files_done", {})
    manifest.setdefault("files_failed", {})
    return manifest


def save_manifest(manifest: dict) -> None:
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    tmp = MANIFEST + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    os.replace(tmp, MANIFEST)


def record_origin(record: dict) -> str:
    if any(p.get("origin") == "glimmer_ocr" for p in record.get("pages", [])):
        return "glimmer_ocr"
    return "text"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--files", default="")
    ap.add_argument("--force", action="store_true",
                    help="re-ingest every selected case (points deleted first)")
    ap.add_argument("--check-only", action="store_true",
                    help="preflight + plan only; embed and upsert nothing")
    ap.add_argument("--skip-preflight", action="store_true",
                    help="skip the collection contract check (not recommended)")
    ap.add_argument("--recreate-collection", action="store_true",
                    help="DELETE the case_studies collection and recreate it "
                    "to the hybrid contract (loses all case points)")
    args = ap.parse_args()

    with open(DATA_FILE, encoding="utf-8") as fh:
        records = [json.loads(line) for line in fh if line.strip()]
    if args.files:
        wanted = {f for f in args.files.split(",") if f}
        records = [r for r in records if r.get("source_file") in wanted]
    if args.limit:
        records = records[: args.limit]
    if not records:
        print("no case records selected")
        raise SystemExit(1)

    client = make_client()
    if args.recreate_collection:
        print(f"WARNING: deleting collection {CASE_COLLECTION!r}", flush=True)
        try:
            client.delete_collection(CASE_COLLECTION)
        except Exception as exc:
            print(f"delete skipped ({exc!r}); recreating anyway", flush=True)
    ensure_case_collection(client)
    if args.skip_preflight:
        print("WARNING: collection preflight skipped", flush=True)
    else:
        problems = verify_case_collection(client)
        if problems:
            raise SystemExit(
                "case_studies collection does not match the hybrid contract:\n"
                + "\n".join(f"  - {p}" for p in problems)
                + "\nRe-run with --recreate-collection to rebuild it "
                  "(deletes all case points).")
        print("collection preflight: OK", flush=True)

    manifest = load_manifest()
    done: dict = manifest["files_done"]
    failed: dict = manifest["files_failed"]

    todo: list[tuple] = []  # (record, fname, digest, replace)
    current = 0
    for record in records:
        fname = record.get("source_file", "")
        digest = record_hash(record)
        entry = done.get(fname)
        if not args.force and entry_is_current(entry, digest, VERSION):
            current += 1
            continue
        todo.append((record, fname, digest, args.force or entry is not None))
    save_manifest(manifest)
    print(f"files: {len(records)} selected, {current} current, "
          f"{len(todo)} to ingest, {len(failed)} previously failed", flush=True)
    if args.check_only:
        print("check-only: nothing embedded or upserted")
        return

    dense = VoyageDense(batch_size=EMBED_BATCH)
    sparse_ready = False
    started = time.monotonic()

    def est_tokens(texts: list[str]) -> int:
        return sum(estimate_tokens(t) for t in texts)

    partial_chunks: dict[str, int] = {}
    partial_tokens: dict[str, int] = {}

    def process_cycle(batch: list[tuple]) -> None:
        """Embed + upsert one cycle of case slices, checkpoint finished files."""
        nonlocal sparse_ready
        texts = [c.text for _f, chunks, *_ in batch for c in chunks]
        before = dense.total_tokens
        attempt = 0
        while True:
            try:
                dense_vecs = dense.embed(texts, input_type="document")
                break
            except RateLimitError:
                # Free-tier storms can last a while: back off progressively
                # (cap 10 min) and keep the run alive instead of exiting.
                # Only Ctrl-C stops it; the manifest is already checkpointed.
                attempt += 1
                wait = min(RATE_LIMIT_SLEEP_S * attempt, 600.0)
                fnames = ",".join(f[0] for f in batch[:3])
                print(f"\nrate-limited at [{fnames}...] (try {attempt}), "
                      f"sleeping {wait:.0f}s", flush=True)
                save_manifest(manifest)
                time.sleep(wait)
        if any(len(v) != DENSE_SIZE for v in dense_vecs):
            save_manifest(manifest)
            raise SystemExit(
                f"STOP: embedding model returned non-{DENSE_SIZE}-dim vectors; "
                "check EMBEDDING_MODEL against the collection contract")
        if not sparse_ready:
            encode_sparse(["warmup"])  # download/init model once
            sparse_ready = True
        sparse_vecs = encode_sparse(texts)
        flat = [c for f in batch for c in f[1]]
        points = [
            models.PointStruct(
                id=c.chunk_id,
                vector={DENSE_NAME: d,
                         SPARSE_NAME: models.SparseVector(indices=i, values=v)},
                payload=case_chunk_to_payload(c),
            )
            for c, d, (i, v) in zip(flat, dense_vecs, sparse_vecs)
        ]
        for attempt in range(UPSERT_RETRIES):
            try:
                for fname, _chunks, _digest, _est, is_first, _last in batch:
                    if is_first:
                        delete_case_points(client, fname)  # drop stale chunks first
                for i in range(0, len(points), 256):
                    last = (i + 256) >= len(points)
                    client.upsert(collection_name=CASE_COLLECTION,
                                  points=points[i:i + 256], wait=last)
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
        for (fname, chunks, digest, _est, _first, _last), share in zip(batch, shares):
            partial_chunks[fname] = partial_chunks.get(fname, 0) + len(chunks)
            partial_tokens[fname] = partial_tokens.get(fname, 0) + share
            if _last:
                done[fname] = {"chunks": partial_chunks.pop(fname),
                               "tokens": partial_tokens.pop(fname),
                               "file_hash": digest, "ingest_version": VERSION}
                failed.pop(fname, None)
                finished += 1
        save_manifest(manifest)
        n_chunks = sum(len(c) for _f, c, *_ in batch)
        print(f"cycle: {len(batch)} slices, {n_chunks} chunks, {spent} tokens, "
              f"{finished} files done, elapsed {time.monotonic() - started:.0f}s",
              flush=True)

    def case_stream():
        """Yield (fname, chunks, hash, chunk_ests, replace) case by case."""
        for record, fname, digest, replace in tqdm(todo, desc="cases"):
            try:
                segments = [(p.get("cleaned", ""), p.get("page"))
                            for p in record.get("pages", []) if p.get("cleaned")]
                chunks = chunk_case_document(
                    case_id=fname,
                    source_file=fname,
                    file_hash=digest,
                    segments=segments,
                    case_title="",
                    metadata=record.get("metadata", {}) or {},
                    origin=record_origin(record),
                )
            except Exception as exc:  # malformed record: record, retry next run
                print(f"\nfailed {fname}: {exc!r}", flush=True)
                failed[fname] = {"error": str(exc)[:200],
                                 "attempts": failed.get(fname, {}).get("attempts", 0) + 1}
                save_manifest(manifest)
                continue
            if not chunks:  # textless (scan awaiting OCR): mark done-empty
                if replace:
                    delete_case_points(client, fname)
                done[fname] = {"chunks": 0, "file_hash": digest,
                               "ingest_version": VERSION, "empty": True}
                failed.pop(fname, None)
                save_manifest(manifest)
                continue
            yield fname, chunks, digest, [estimate_tokens(c.text) for c in chunks], replace

    try:
        for cycle in cycle_slices(case_stream(), CYCLE_TOKEN_TARGET, CYCLE_CHUNK_CAP):
            process_cycle(cycle)
    except KeyboardInterrupt:
        save_manifest(manifest)
        print("\ninterrupted: manifest checkpointed; re-run to resume", flush=True)
        raise SystemExit(130)

    total_chunks = sum(v.get("chunks", 0) for v in done.values())
    print(f"done. files_done={len(done)} chunks={total_chunks} "
          f"failed={len(failed)}")
    if failed:
        print("failed files (retried on next run): " + ", ".join(sorted(failed)))
    print(f"manifest: {MANIFEST}")


if __name__ == "__main__":
    main()
