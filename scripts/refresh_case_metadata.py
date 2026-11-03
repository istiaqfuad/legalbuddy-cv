"""Refresh per-record metadata in data/processed/cases.jsonl without PDFs.

Re-runs :func:`extract_case_metadata` over each record's stored cleaned
page text (front matter lives on the first pages) and writes the improved
fields back in place. A timestamped backup is kept next to the JSONL.
Run after changing the extractor, before (re-)ingesting case_studies.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from legalbuddy.case_parsing import extract_case_metadata  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
JSONL = REPO / "data" / "processed" / "cases.jsonl"

FIELDS = ("case_number", "court", "decision_date", "parties", "case_year", "case_type")


def front_matter(record: dict, chars: int = 6000) -> str:
    parts: list[str] = []
    total = 0
    for page in record.get("pages", []):
        text = page.get("cleaned") or ""
        if not text:
            continue
        parts.append(text)
        total += len(text)
        if total >= chars:
            break
    return "\n\n".join(parts)[:chars]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check-only", action="store_true",
                    help="report coverage deltas without writing")
    args = ap.parse_args()

    records = [json.loads(line) for line in JSONL.open(encoding="utf-8") if line.strip()]
    before = {f: 0 for f in FIELDS}
    after = {f: 0 for f in FIELDS}
    changed = 0
    for record in records:
        meta = record.get("metadata", {}) or {}
        for field in FIELDS:
            before[field] += bool(meta.get(field))
        fresh = extract_case_metadata(front_matter(record))
        if any(meta.get(f) != fresh.get(f, "") for f in FIELDS):
            changed += 1
            if not args.check_only:
                meta.update({f: fresh.get(f, "") for f in FIELDS})
                record["metadata"] = meta
        effective = record.get("metadata", {}) if not args.check_only else fresh
        for field in FIELDS:
            after[field] += bool((effective or {}).get(field))

    print(f"records: {len(records)} changed: {changed}")
    for field in FIELDS:
        print(f"  {field}: {before[field]} -> {after[field]}")
    if args.check_only or not changed:
        return
    backup = JSONL.with_suffix(f".bak-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.jsonl")
    shutil.copy2(JSONL, backup)
    print(f"backup: {backup}")
    with JSONL.open("w", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    print("metadata refreshed in place")


if __name__ == "__main__":
    main()
