"""CLI: ask a grounded legal question, print answer + section citations.

Usage:
    uv run python scripts/ask.py "What is the punishment for murder?"
    uv run python scripts/ask.py --lang bengali "খুনের শাস্তি কী?"
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from legalbuddy.chat import answer  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("question")
    ap.add_argument("--lang", default=None)
    ap.add_argument("--year", default=None)
    ap.add_argument("--limit", type=int, default=8)
    args = ap.parse_args()

    ans = answer(args.question, language=args.lang, act_year=args.year, limit=args.limit)
    print("=" * 70)
    print(ans.text)
    print("=" * 70)
    for c in ans.citations:
        print(f"[{c.ref}] {c.act_title} ({c.act_no} of {c.act_year}), "
              f"Section {c.section_label or '?'}" +
              (f" — {c.section_title}" if c.section_title else ""))
        print(f"    score={c.score:.3f} chunk={c.chunk_id}")
        print(f"    link: {c.source_url}")
        print(f"    excerpt: {c.excerpt[:220].replace(chr(10), ' ')}...")


if __name__ == "__main__":
    main()
