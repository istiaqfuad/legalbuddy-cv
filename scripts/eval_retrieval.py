"""Retrieval quality probe: hand-written EN/BN questions, recall@k vs expected acts.

Usage:
    uv run python scripts/eval_retrieval.py [--limit 5]

Not a benchmark suite — a smoke signal for ingestion/retrieval regressions.
"""

from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from legalbuddy.chat import retrieve  # noqa: E402

GOLDEN: list[tuple[str, str]] = [
    ("What is the punishment for murder?", "Penal Code, 1860"),
    ("Which law lets the government create new districts?", "Districts Act, 1836"),
    ("Punishment for using white phosphorus in match manufacture?", "White Phosphorus"),
    ("How may members dissolve a registered society?", "Societies Registration Act, 1860"),
    ("খুনের শাস্তি কী?", "Penal Code, 1860"),
    ("নতুন জেলা গঠন সংক্রান্ত বিধান কী?", "Districts Act, 1836"),
    ("সাদা ফসফরাস দিয়ে দেশলাই বানানোর শাস্তি কী?", "White Phosphorus"),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=5)
    args = ap.parse_args()

    hits = 0
    for n, (question, expected) in enumerate(GOLDEN):
        if n:
            time.sleep(25)  # respect Voyage 3 RPM free-tier limit
        try:
            res = retrieve(question, limit=args.limit)
        except Exception as exc:  # noqa: BLE001
            print(f"SKIP {question!r}: {exc}")
            continue
        titles = [str((p.payload or {}).get("act_title", "")) for p in res.points]
        ok = any(expected in t for t in titles)
        hits += ok
        mark = "OK " if ok else "MISS"
        print(f"[{mark}] {question!r}\n     -> {titles[0] if titles else 'no hits'}")
    print(f"\nrecall@{args.limit}: {hits}/{len(GOLDEN)}")


if __name__ == "__main__":
    main()
