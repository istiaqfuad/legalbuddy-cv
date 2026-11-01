"""Process case-study PDFs into a clean, structured intermediate format.

Reads ``data/cases/*.pdf`` and writes one JSON record per document to
``data/processed/cases.jsonl`` — cleaned page texts, per-page routes,
header metadata, and table Markdown — plus page renders for OCR-routed
pages under ``data/processed/ocr_queue/`` (transcribed later with Muse
Glimmer on the GPU notebook, then merged back).

Pipeline per file (see ``docs/case-studies-pipeline.md``):

1. Parse with pdfplumber (cleanest English of the local extractors: no
   intra-word splits, no padding spaces) and list embedded images.
2. Triage every page with ``legalbuddy.case_parsing``: ``digital`` pages
   are cleaned in place; ``scanned_image`` / ``bangla_needs_ocr`` pages
   are rendered to PNG (150 DPI, pypdfium2) for the OCR queue. Broken
   Bangla is a property of the file (bad ToUnicode maps — identical
   across pypdf/pdfplumber/pypdfium2/pdftotext), so those pages are
   never trusted as text.
3. Clean with ``clean_case_text`` (NFKC, wrap joins, footer strips,
   paragraph breaks kept) and structure the front matter with
   ``extract_case_metadata``.

Resumability mirrors ``ingest_statutes.py``: a manifest
(``data/manifests/cases-process.json``) records per-file SHA-256 plus
``PROCESS_VERSION``; re-running skips current entries, retries failures,
and checkpoints every cycle. Chunking and embedding come later, reading
this JSONL — never the raw PDFs.

Usage:
    uv run python scripts/process_cases.py [--limit N] [--cases f1,f2,...]
                                            [--force] [--check-only]
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "env"))

from tqdm import tqdm

from legalbuddy.case_parsing import (
    CASE_CHUNKER_VERSION,
    clean_case_text,
    extract_case_metadata,
    triage_segments,
)
from legalbuddy.ingest_state import entry_is_current, file_sha256

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "cases")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "processed")
OUT_JSONL = os.path.join(OUT_DIR, "cases.jsonl")
OCR_DIR = os.path.join(OUT_DIR, "ocr_queue")
MANIFEST = os.path.join(os.path.dirname(__file__), "..", "data", "manifests", "cases-process.json")

PROCESS_VERSION = f"caseproc=1;chunker={CASE_CHUNKER_VERSION}"
OCR_DPI = 150
CHECKPOINT_EVERY = 200


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


def process_file(path: str) -> dict:
    """Parse, triage, clean, and structure one PDF. Returns the JSON record."""
    import pdfplumber

    fname = os.path.basename(path)
    digest = file_sha256(path)
    with open(path, "rb") as fh:
        raw = fh.read()
    pages: list[dict] = []
    with pdfplumber.open(__import__("io").BytesIO(raw)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
            has_images = bool(getattr(page, "images", None))
            pages.append({"page": i, "text": text, "has_images": has_images})
    triage = triage_segments(
        [(p["text"], p["page"]) for p in pages], {p["page"] for p in pages if p["has_images"]}
    )
    route_by_page = {e["page"]: e["route"] for e in triage["pages"]}
    ocr_pngs: list[str] = []
    for p in pages:
        p["route"] = route_by_page[p["page"]]
        p["chars"] = len((p["text"] or "").strip())
        p["cleaned"] = clean_case_text(p["text"]) if p["route"] == "digital" else ""
        del p["text"], p["has_images"]
    worst = triage["worst_route"]
    if worst != "digital":
        ocr_pngs = render_ocr_pages(
            raw, fname, [p["page"] for p in pages if p["route"] != "digital"]
        )
    front = "\n\n".join(p["cleaned"] for p in pages if p["cleaned"])[:6000]
    metadata = extract_case_metadata(front)
    return {
        "source_file": fname,
        "file_hash": digest,
        "n_pages": len(pages),
        "route": worst,
        "metadata": metadata,
        "pages": pages,
        "ocr_pngs": ocr_pngs,
    }


def render_ocr_pages(raw: bytes, fname: str, page_nums: list[int]) -> list[str]:
    """Render OCR-routed pages to PNG for the Glimmer queue. Returns relpaths."""
    import pypdfium2 as pdfium

    stem = os.path.splitext(fname)[0]
    out_dir = os.path.join(OCR_DIR, stem)
    os.makedirs(out_dir, exist_ok=True)
    relpaths = []
    doc = pdfium.PdfDocument(__import__("io").BytesIO(raw))
    try:
        for num in page_nums:
            if num < 1 or num > len(doc):
                continue
            out_path = os.path.join(out_dir, f"p{num}.png")
            if not os.path.exists(out_path):
                bitmap = doc[num - 1].render(scale=OCR_DPI / 72)
                bitmap.to_pil().save(out_path, format="PNG")
            relpaths.append(os.path.relpath(out_path, OUT_DIR))
    finally:
        doc.close()
    return relpaths


def run_one(item: tuple[str, str, str]) -> dict:
    """Process one file in a worker process. Top-level so it pickles."""
    path, fname, digest = item
    try:
        record = process_file(path)
        assert record["file_hash"] == digest, "hash changed mid-run"
        return {"ok": True, "fname": fname, "record": record}
    except Exception as exc:  # malformed file: record, retry next run
        return {"ok": False, "fname": fname, "error": str(exc)[:300]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--cases", default="")
    ap.add_argument("--force", action="store_true", help="reprocess every selected file")
    ap.add_argument("--check-only", action="store_true", help="plan only; write nothing")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 0))
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(DATA_DIR, "*.pdf")))
    if args.cases:
        wanted = {a for a in args.cases.split(",") if a}
        files = [f for f in files if os.path.basename(f) in wanted]
    if args.limit:
        files = files[: args.limit]
    if not files:
        print("no case files selected")
        raise SystemExit(1)

    manifest = load_manifest()
    done: dict = manifest["files_done"]
    failed: dict = manifest["files_failed"]

    todo: list[tuple[str, str, str]] = []  # path, fname, hash
    current = 0
    for path in files:
        fname = os.path.basename(path)
        try:
            digest = file_sha256(path)
        except OSError as exc:
            failed[fname] = {
                "error": f"hash: {exc}"[:200],
                "attempts": failed.get(fname, {}).get("attempts", 0) + 1,
            }
            continue
        if not args.force and entry_is_current(done.get(fname), digest, PROCESS_VERSION):
            current += 1
            continue
        todo.append((path, fname, digest))
    save_manifest(manifest)
    print(
        f"files: {len(files)} selected, {current} current, "
        f"{len(todo)} to process, {len(failed)} previously failed",
        flush=True,
    )
    if args.check_only:
        print("check-only: nothing processed or written")
        return

    os.makedirs(OUT_DIR, exist_ok=True)
    from concurrent.futures import ProcessPoolExecutor

    processed = 0
    with open(OUT_JSONL, "a", encoding="utf-8") as out_fh:
        with ProcessPoolExecutor(max_workers=args.workers) as ex:
            for res in tqdm(ex.map(run_one, todo), total=len(todo), desc="cases", unit="file"):
                if res["ok"]:
                    out_fh.write(json.dumps(res["record"], ensure_ascii=False) + "\n")
                    out_fh.flush()
                    done[res["fname"]] = {
                        "file_hash": res["record"]["file_hash"],
                        "ingest_version": PROCESS_VERSION,
                        "route": res["record"]["route"],
                        "pages": res["record"]["n_pages"],
                    }
                    failed.pop(res["fname"], None)
                else:
                    failed[res["fname"]] = {
                        "error": res["error"],
                        "attempts": failed.get(res["fname"], {}).get("attempts", 0) + 1,
                    }
                processed += 1
                if processed % CHECKPOINT_EVERY == 0:
                    save_manifest(manifest)
    save_manifest(manifest)
    routes: dict[str, int] = {}
    for v in done.values():
        routes[v.get("route", "?")] = routes.get(v.get("route", "?"), 0) + 1
    print(f"done. files_done={len(done)} routes={routes} failed={len(failed)}")
    if failed:
        print("failed files (retried on next run): " + ", ".join(sorted(failed)))
    print(f"jsonl: {OUT_JSONL}\nmanifest: {MANIFEST}")


if __name__ == "__main__":
    main()
