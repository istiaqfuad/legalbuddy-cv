"""Unit tests for ingestion bookkeeping: hashes, versions, token shares."""

import hashlib

from legalbuddy.ingest_state import (
    allocate_tokens,
    cycle_slices,
    entry_is_current,
    file_sha256,
    ingest_version,
)


def test_file_sha256(tmp_path):
    p = tmp_path / "a.json"
    p.write_bytes(b'{"a": 1}')
    assert file_sha256(str(p)) == hashlib.sha256(b'{"a": 1}').hexdigest()


def test_entry_is_current_requires_hash_and_version():
    v = ingest_version()
    good = {"file_hash": "abc", "ingest_version": v}
    assert entry_is_current(good, "abc")
    assert not entry_is_current(good, "different")
    assert not entry_is_current({"file_hash": "abc"}, "abc")  # legacy entry
    assert not entry_is_current(None, "abc")
    assert not entry_is_current({}, "abc")


def test_cycle_slices_split_huge_act_and_flag_ends():
    chunks = [f"c{i}" for i in range(10)]
    acts = [("big.json", chunks, "h1", [100] * 10, False),
            ("small.json", ["x"], "h2", [50], False)]
    cycles = list(cycle_slices(iter(acts), token_target=250, chunk_cap=384))
    flat = [c for cyc in cycles for _f, s, *_ in cyc for c in s]
    assert flat == chunks + ["x"]  # order preserved, nothing lost/duplicated
    big = [s for cyc in cycles for s in cyc if s[0] == "big.json"]
    assert len(big) > 1
    assert big[0][4] is True and all(not s[4] for s in big[1:])   # is_first
    assert big[-1][5] is True and all(not s[5] for s in big[:-1])  # is_last
    assert all(sum(s[3] for s in cyc) <= 350 for cyc in cycles)


def test_cycle_slices_respect_chunk_cap():
    acts = [("a.json", list(range(10)), "h", [1] * 10, False)]
    cycles = list(cycle_slices(iter(acts), token_target=10**9, chunk_cap=4))
    assert [sum(len(s[1]) for s in cyc) for cyc in cycles] == [4, 4, 2]


def test_allocate_tokens_proportional_and_exact():
    shares = allocate_tokens(100, [1, 1, 2])
    assert sum(shares) == 100
    assert shares[2] >= shares[0]
    assert allocate_tokens(0, [5, 5]) == [0, 0]
    assert allocate_tokens(10, [0, 0]) == [5, 5]
