# Case studies: parsing 8,493 judgment PDFs without losing case info

`data/cases` holds ~8,493 Bangladesh judgment PDFs (~1.8 GB, mostly 60 KB–
3 MB). They are hostile to naive ingestion in four distinct ways, profiled
with `pdftotext`/`pdfimages` before any code was written.

## Diagnosis: three archetypes, not one corpus

Sampling 200 random files plus targeted probes split the corpus:

- **Digital-noisy (majority).** Word exports with clean English but
  sentences shattered across lines (`At the instance of the petitioner`
  over six lines with blank lines) plus `Page # N` footers. Example:
  `100174_CR_1359_2002.pdf` (9 pages, zero embedded images).
- **Broken Bangla glyphs.** Mixed English/Bangla where extraction
  corrupts ligatures: `1636195_SuoMoto_No_07_of_2019.pdf` reads `আইেন
  মানা, ত ১২১ দ` for `আইন মানা…` and `িশ উ য়ন ক` debris. Indexing this
  text would poison both dense and BM25 retrieval.
- **Scanned images.** `1720489_…Annex-35…pdf`: 1 page, 315 KB JPEG,
  zero extractable chars. A second probe found only 2 of 200 sampled
  files fully textless, so scans are rare but real.

Local Tesseract ships English only, so Bangla OCR must happen GPU-side.

## Fix 1: triage per page, then route

`src/legalbuddy/case_parsing.py::triage_segments` routes every page to
`digital` (parse + clean), `scanned_image` (OCR from pixels), or
`bangla_needs_ocr` (glyphs present but fragmented — re-read from pixels,
never trust the extracted text). Page rule: < 200 chars + embedded
images = scan; Bangla present with ≥ 3 isolated vowel signs or ≥ 60%
stub tokens (≤ 2 code points, e.g. `িশ উ য়ন ক`) = broken glyphs. The
file takes its worst page's route. Same logic runs notebook-side as
`triage_pdf`, so local and GPU decisions stay in sync.

## Fix 2: clean without collapsing

`clean_case_text` NFKC-normalizes (recomposes decomposed Bangla), joins
hyphen wraps, folds single newlines to spaces while keeping blank-line
paragraph breaks, strips `Page # N` footers and lone page numbers, and
collapses 3+ newline runs. Unlike the statute normalizer (which flattens
to one line), judgment chunks need paragraph structure — short
paragraphs rejoin later at chunk-merge time.

## Fix 3: OCR with Muse Glimmer (Meta model)

Glimmer 30B (`meta-models/Muse-Glimmer-30B`, Apache-2.0) is
image-text-to-text, so one Meta model covers transcription *and*
header structuring (facts, issues, holdings, citations) — the hackathon
story. Verified on the 102 GB notebook GPU: HF reachable, weights
download, `transformers` 5.22 ships `muse_glimmer` modeling, bf16 fits
in VRAM. Research order was Surya / Docling+EasyOCR(en,bn) primary,
PaddleOCR-VL-1.5 for broken glyphs, vision-LLM fallback; Glimmer
supersedes the fallback tier and doubles as structurer. Benchmark
protocol (pending full run): same hardest pages through Surya vs
Glimmer, scored on Bengali glyph error + statute-number recall
(`Section N`) + page order + pages/s.

Environment scar worth knowing: mid-session `pip install surya-ocr`
downgraded `transformers`/`huggingface_hub`/`torch` under a running
kernel, and reimporting torch's C extension in-process hard-crashes it
(`SystemError: bad call flags`). Recovery is a kernel restart from a
fresh boot (venv-first `sys.path` then resolves cleanly), never a
`sys.modules` purge of torch. Purging only the pure-Python hub shim is
safe and lives in the notebook's `env_bootstrap` cell.

## Fix 4: section-aware chunks with case payload

`chunk_case_document` splits on heading lines (Present/Versus/Heard-on)
and numbered reasoning paragraphs — never mid-sentence — and windows to
~2,800 chars (~700 tokens), 3,600 max, ~320-char overlap seeded from the
previous window's tail. Every chunk carries the section title plus a
provenance header (`title, Case No, court [section] (part i/n)`), page
span, char offsets, and deterministic UUID5 ids
(`case#file#section#part`) so re-ingestion overwrites. Metadata is
regex best-effort locally (`extract_case_metadata`: case number, court
— division preferred over the bare apex name — date, parties, year);
deep fields ride the Glimmer structuring pass.

## Fix 5: two Qdrant collections, same contract as statutes

`laws` + `case_studies`, each dense `denso` (Voyage-4 1024, cosine) +
sparse `sparso` (idf) with keyword indexes (`case_type`, `court`,
`case_number`, `case_year`, `language`, `source_file` for cases —
`CASE_PAYLOAD_INDEXES`). Retrieval: dense + BM25 prefetches fused with
RRF in one Query API call, filtered by `case_type` so case studies only
surface for matching types. Same embedder for index and query.

## Procedure (reproduce / extend)

1. Profile new dumps first: `pdfinfo`, `pdftotext -raw` char counts,
   `pdfimages -list` — confirm the three archetypes still cover it.
2. `uv run --group dev python -m pytest tests/test_case_parsing.py`
   — triage/clean/chunk/metadata contract (9 tests, stdlib only).
3. `uv run python scripts/process_cases.py` — full corpus to
   `data/processed/cases.jsonl` (resumable via
   `data/manifests/cases-process.json`; `--limit`/`--cases`/`--force`/
   `--check-only` mirror `ingest_statutes.py`). OCR-routed pages land
   as PNGs in `data/processed/ocr_queue/<stem>/pN.png`.
4. On the GPU notebook: transcribe the OCR queue with Glimmer, merge
   transcripts back into the JSONL (match on `source_file` + `page`),
   then chunk + embed + ingest both collections.
5. Record benchmark numbers in the table below on the next full run.

## Benchmark (hardest pages)

| Engine | Bengali glyph err | Section-N recall | pages/s | Note |
|---|---|---|---|---|
| Surya 0.23 | blocked | blocked | blocked | VLM service now: vLLM backend needs Docker, llamacpp needs `llama-server` binary — neither in sandbox |
| Muse Glimmer 30B bf16 | correct: `আইনে মানা, তবু ১২১ দণ্ড`, `শিশু উন্নয়ন কেন্দ্র` where extraction gave debris | exact: `V.C. Civil Revision No. 15(Annex-35) of 2020` from a 0-char scan | ~0.03 (32 s/page, ~14 tok/s) | OCR + structuring; ≤ 512 tokens/call (server stream cap); strip echo preamble in post |
| Tesseract ben+eng | — | — | — | CPU baseline only (not run: no `ben` data in sandbox) |

## Retrieval proof (notebook, 2026-10-31)

11 real chunks from 3 sample PDFs + 2 statute texts, e5-large (1024-dim)
+ BM25, in-memory Qdrant `laws` + `case_studies` via
`ensure_hybrid_collection`: unfiltered *"detention of children…"* ranks
the SuoMoto child-detention chunks first; `case_type = "Writ Petition"`
returns only Writ Petition chunks; *"punishment for murder"* on `laws`
returns Penal Code s.302 at 1.0. Demo metadata hand-rolled; production
uses `extract_case_metadata` + Glimmer structuring with Voyage-4 dense.

## Suitable format: `data/processed/cases.jsonl`

One JSON object per line per document (streaming-friendly for 8,493
docs; chunking/embedding later read this, never raw PDFs):

- `source_file`, `file_hash` (SHA-256), `n_pages`, `route` (worst page),
  `metadata` (`extract_case_metadata`: case_number, court, date,
  parties, year, case_type — regex best-effort, empty means unknown),
  `pages[]` (`page`, `route`, `chars`, `cleaned` — empty for OCR pages),
  `ocr_pngs[]` (paths relative to `data/processed/`).
- Digital pages carry cleaned text; OCR pages carry `""` plus a PNG.
  Nothing is trusted twice: the same triage code runs locally
  (`triage_segments`) and notebook-side (`triage_pdf`).

## Extractor analysis: newlines, alignment, broken Bangla

- **Newlines.** A PDF stores positioned glyphs, not paragraphs — every
  extractor invents line structure. `pdftotext -layout` preserves visual
  columns but emits blank lines for every visual gap (the `\n\n` noise:
  15 double-breaks on page 1 of the samples); `-raw` and all three
  Python extractors emit one `\n` per visual line with zero `\n\n`.
  `clean_case_text` therefore folds single newlines and only honors
  blank lines — correct under every extractor.
- **Alignment / reading order.** Centered cause-titles and two-column
  appearances read across instead of down under naive extraction.
  pdfplumber wins locally: no intra-word splits (`Abdur Rashid`, not
  pypdf's `Abd ur Rashid` / `Fo undation`), no padding spaces, so it is
  the process script's parser. pypdfium2 emits `\r\n` (normalized
  downstream); tables still need explicit extraction (pdfplumber
  `extract_tables`, as in `documents.py`).
- **Broken Bangla is in the file, not the extractor.** Page 1 of the
  SuoMoto judgment reads `আইেন মানা ত ১২১ দ িশ উ য়ন ক` byte-identically
  under pypdf, pdfplumber, pypdfium2, and pdftotext (short-token
  fraction 0.67 in all four). The fonts carry bad ToUnicode maps, so no
  extractor setting recovers the ligatures — pixel re-read (Glimmer) is
  the only fix, and the stub-token heuristic routes those pages there.

## Durability (Nov 2026)

Parsed outputs are pushed to the dataset repo, not kept locally:
`processed/cases.jsonl` (8,052 clean records), `processed/manifest.json`,
`processed/ocr_queue/` PNGs alongside the 8,493 raw PDFs at
`istiaqfuad/bd-case-studies`. Local runs died twice to laptop OOM
(6 parallel pdfplumber workers + a 58 MB Death Reference file spiking
worker RSS) — resume with `--workers 2` (or on the 32 GB Molab box),
and always push `processed/` to HF before shutting down: Molab keeps
only code + file-browser uploads, everything kernel-made is scratch.

## Files

`src/legalbuddy/case_parsing.py`, `tests/test_case_parsing.py`,
`scripts/ingest_statutes.py` (resumable pattern to mirror for
`ingest_cases.py`), `src/legalbuddy/store.py` (collection contract),
`src/legalbuddy/documents.py` (`render_pages` reuse, vision pattern).
