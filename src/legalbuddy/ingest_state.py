"""Ingestion bookkeeping: file hashes, pipeline version, token shares.

An act counts as done only when its manifest entry carries the current
source-file SHA-256 *and* the current ingest version (chunker + dense +
sparse models). Legacy entries without either are stale: the act is
re-ingested and its old points are deleted first, so amended acts and
chunker/model upgrades never leave orphaned points behind.
"""

from __future__ import annotations

import hashlib

from legalbuddy.chunking import CHUNKER_VERSION


def ingest_version() -> str:
    """Version stamp for everything that shapes a stored point."""
    # Imported lazily so this module stays cheap to import in tests.
    from legalbuddy.embedder import DENSE_MODEL, SPARSE_MODEL

    return f"chunker={CHUNKER_VERSION};dense={DENSE_MODEL};sparse={SPARSE_MODEL}"


def file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def entry_is_current(entry: dict | None, file_hash: str,
                     version: str | None = None) -> bool:
    if not entry:
        return False
    return (entry.get("file_hash") == file_hash
            and entry.get("ingest_version") == (version or ingest_version()))


def cycle_slices(acts, token_target: int, chunk_cap: int):
    """Yield embed cycles from a lazy stream of acts, splitting huge acts.

    ``acts`` yields ``(fname, chunks, file_hash, chunk_ests, replace)``.
    Each cycle is a list of slices ``(fname, chunks, file_hash, est,
    is_first, is_last)`` whose total estimated tokens stay near
    ``token_target`` and whose chunk count stays within ``chunk_cap`` —
    except a single chunk larger than the target, which forms its own
    cycle. ``is_first`` slices must delete the act's stale points before
    upsert; an act may be marked done only at its ``is_last`` slice, so a
    95K-token act checkpoints progressively instead of in one cycle.
    """
    cycle: list = []
    cycle_est = 0

    def flush():
        nonlocal cycle, cycle_est
        out, cycle, cycle_est = cycle, [], 0
        return out

    for fname, chunks, file_hash, chunk_ests, _replace in acts:
        start = 0
        while start < len(chunks):
            take = 0
            est = 0
            while start + take < len(chunks):
                nxt = chunk_ests[start + take]
                if cycle and (cycle_est + est + nxt > token_target
                              or sum(len(s[1]) for s in cycle) + take >= chunk_cap):
                    break
                if take and est + nxt > token_target:
                    break
                est += nxt
                take += 1
                if est >= token_target or take >= chunk_cap:
                    break
            if take == 0:  # cycle full: emit it, then take this chunk alone
                yield flush()
                continue
            cycle.append((fname, chunks[start:start + take], file_hash, est,
                          start == 0, start + take >= len(chunks)))
            cycle_est += est
            start += take
            if cycle_est >= token_target or sum(len(s[1]) for s in cycle) >= chunk_cap:
                yield flush()
    if cycle:
        yield flush()


def allocate_tokens(total: int, weights: list[int]) -> list[int]:
    """Split ``total`` proportionally to ``weights``; shares sum exactly."""
    if not weights:
        return []
    wsum = sum(weights)
    if total <= 0:
        return [0] * len(weights)
    if wsum <= 0:
        base, rem = divmod(total, len(weights))
        return [base + (1 if i < rem else 0) for i in range(len(weights))]
    shares = [total * w // wsum for w in weights]
    # Hand the rounding remainder to the largest weights first.
    order = sorted(range(len(weights)), key=lambda i: weights[i], reverse=True)
    for i in order[: total - sum(shares)]:
        shares[i] += 1
    return shares
