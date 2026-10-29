# Ingestion pipeline: chunking, pacing, resume

## Chunking: one section, one chunk

Corpus provisions are pre-segmented, so the chunk unit is the section
(`src/legalbuddy/chunking.py::chunk_act`). Long sections split on
subsection boundaries (`(1)`, `(a)`) greedily merged to ~1500 chars with
overlap seeding; hard-slice is the fallback. Bangla-aware dari handling
(U+0964, not the lookalike U+09F7 that once broke labels), footnote
markers rewritten to live terms, amendment notes appended on part 0
only (repeating them per split would overweight boilerplate in BM25),
and repealed/omitted sections dropped via `is_void_section`.

## Text normalizer: glued words and `***` runs

Source bodies carry `or\nimprisonment` line-break joins and `***`
visual separators, which embedded and rendered as noise
(`orimprisonment`, literal `***` in excerpts), plus footnote numbers
glued to words (`94The`). `normalize_text` collapses whitespace, strips
star runs, and unglues multi-digit markers while leaving years and
Bengali numerals (`১৯৭৫ ...`) untouched. Applies to content and notes;
already-ingested points keep old text until re-ingested.

## Deterministic, resumable ingestion

Chunk IDs are UUID5 of `source_file#section#part`: re-running is
upsert-safe with no duplicates. `scripts/ingest_statutes.py` checkpoints
a manifest per cycle, skips completed acts (`--acts` also allows
targeting), and never runs two writers against one manifest.

## Voyage pacing on the free tier

`VoyageDense` paces per request (request gap + token-capped requests)
with script-aware token estimates (Bengali ~1 tok/char, Latin ~1/4),
plus cross-act batching so median acts share paced cycles. Paid tiers
collapse to `VOYAGE_REQUEST_GAP_S=0` without code change (`.env.example`).

## Qdrant Cloud client fix

Collection `legal-statutes`: dense `denso` (1024, cosine) + sparse
`sparso` (idf on), with the five configured payload indexes
(`act_title`, `act_year`, `language`, `act_no` keyword; `is_repealed`
bool). Cloud flaps (SSL/read timeouts) traced to the client defaulting
off port 443: fixed with explicit `port=443` + `timeout=120`.

## Files

`src/legalbuddy/chunking.py`, `src/legalbuddy/embedder.py`,
`src/legalbuddy/store.py`, `scripts/ingest_statutes.py`,
`scripts/eval_retrieval.py`, `tests/test_chunking.py`,
`tests/test_embedder.py`, `tests/test_ingest_state.py`,
`tests/test_store.py`, `.env.example`.
