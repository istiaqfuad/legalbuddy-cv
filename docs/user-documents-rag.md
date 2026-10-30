# User-document upload + grounded answers

How attaching a file to the chat works end to end: upload, parse, chunk,
embed, store, retrieve alongside the statutes, and cite both. For the
statute-only pipeline, see `retrieval-fusion.md` and `ingestion-pipeline.md`.

## The workflow (what the industry does)

A file attached to a chat question goes through the standard RAG pipeline,
adapted for private per-user data:

1. **Load** — extract plain text from the upload (format-specific parsers).
2. **Split** — break text into retrievable chunks with provenance headers.
3. **Embed** — one dense + one sparse vector per chunk, same models as the
   main index (mixing embedding models between index and query breaks
   retrieval, so the statute encoders are reused verbatim).
4. **Store** — upsert into a vector store with `user_id` (+ `doc_id`)
   metadata, indexed for filtering.
5. **Retrieve** — embed the question, hybrid-search the user's docs with a
   mandatory in-query `user_id + doc_ids` filter, merge the hits with the
   statute evidence, and generate one answer citing both (`[n]` law,
   `[Dn]` files).

Isolation consensus from current practice: the tenant filter belongs
**inside** the vector query (both prefetches), never as a post-filter —
post-filtering lets other tenants' chunks consume result slots, and one
forgotten line can leak a stranger's document into an answer. Uploads also
live in a **separate collection** that is never merged with the curated
statute index, and every filter value is built server-side from the
session — the browser never supplies a user id.

## Tiered enrichment: tables and scanned pages

Plain extraction under-indexes exactly the documents lawyers care about:
pypdf merges table cells into running text, and scanned/image pages carry
no text at all. Uploads therefore go through tiers, cheapest first:

1. **Text layer (free).** pypdf per page, as before.
2. **Tables (free).** pdfplumber (MIT) extracts tables per page, rendered
   as Markdown and appended after that page's text ("Tables on this
   page:"). Chunks carrying tables are marked `origin: table`.
3. **Vision (bounded tokens).** Pages with under 50 extractable characters
   are rendered to PNG with pypdfium2 (Apache-2.0 binding to BSD-licensed
   PDFium — no AGPL/GPL exposure, unlike PyMuPDF/poppler) and transcribed
   by Muse Spark Open itself (`image_url` data URLs, up to 8 pages per
   call — the Baseten vision cap; Spark accepts no PDF input directly).
   Transcriptions replace the thin text, and headers say "(visually
   read)" so citations stay honest. Capped at 20 vision pages per upload
   to bound token spend; everything else about retrieval is unchanged.
   Both tiers are best-effort: failures log server-side and the text
   layer still indexes.

Verified: 69 pytest pass (table rendering, page merge, vision marking,
PNG rendering, batched transcription with a mocked client); live Spark
transcription of a generated image returned the exact wording first try.

## Parsing choices (researched)

- **PDF → pypdf.** Fast, BSD-licensed, good on text PDFs (leases, FIRs,
  contracts). Heavy layout parsers (Docling/Marker, 50–100x slower, huge
  dependency trees) are overkill here; PyMuPDF is AGPL and a licensing
  risk. Image-only PDFs (scans) carry no extractable text and are rejected
  with a plain message instead of indexing nothing.
- **Word → python-docx** (paragraphs plus tables, page unknown).
- **Text/Markdown → direct decode** (UTF-8-SIG, Latin-1 fallback).
- Rejected: anything else, empty files, files over 10 MB, documents that
  would exceed 200 chunks (bounds Voyage spend per upload).

## Chunking

User docs have no legal sections, so chunks split on paragraph boundaries
first, greedy-merged to the same ~1500-char windows (200-char overlap
fallback) the statute chunker uses. Every chunk carries a self-contained
header — `Document: <filename>[, page N] (part i/N)` — mirroring the
statute header rule, because retrieval returns chunks without their
document and the generator must cite them precisely. Point ids are
deterministic (`uuid5(doc_id#index)`), so re-uploads are idempotent.

## Storage

- **Qdrant `user-documents`** (app-managed: created on first upload with
  `ensure_docs_collection`, unlike the pre-provisioned `legal-statutes`
  which code never mutates). Same vector contract — `denso` 1024-dim
  cosine + `sparso` idf — plus keyword payload indexes on `user_id` and
  `doc_id`, created up front so filtered search uses indexed HNSW from
  the first point. Per Qdrant guidance, the indexes are created
  immediately after collection creation, before bulk data lands.
- **Neon `documents`** is the metadata of record (id, owner, filename,
  mime, size, chunk count); listings and deletes never depend on vector
  scrolls. **`conversation_documents`** links files to chats
  (`ON DELETE CASCADE` both ways). Vectors without metadata rows are
  unreachable because every query filters on ids read from these tables.

## Retrieval + generation

`chat.stream_answer(..., user_id, doc_ids)` retrieves in two stages
(`chat.retrieve_grounded`). Vague questions ("explain this case") carry
no searchable terms, so statute retrieval keyed on the question alone
returns generic sections while the file's facts sit unused:

1. **User file first.** Hybrid search over `user-documents`, filtered to
   `user_id` + `doc_ids` as before.
2. **Statutes keyed on question + file facts.** The top doc excerpts
   (truncated to 3000 chars) are appended to the question
   (`build_statute_query`) and the *expanded* text is what gets embedded
   for the statute search — plain concatenation, no extra LLM call. This
   is the standard iterative-retrieval pattern: the file's offences,
   parties, and mentioned sections become the search terms, so the Penal
   Code / Evidence Act sections matching the case come back.
3. **Summary intent.** `is_summary_request` detects explain-the-whole-file
   questions and raises doc recall to 12 chunks (evidence capped at
   12000 chars), since top-k ranking is meaningless for "explain
   everything." Statute refs stay `[1..n]`, doc refs `[D1..m]`.

If the file yields nothing (or doc retrieval fails), the statute search
falls back to the raw question, so the answer degrades to the old
behavior instead of failing. Verified live: "explain this case" plus
murder-trial facts returns Penal Code ss. 302/303/307; the bare question
alone does not. Evidence blocks are labeled separately and the
system prompt is extended: documents describe the user's *situation*,
statutes describe the *law*; cite files as `[D1]`, law as `[n]`, and say
which source says what when they conflict. Document retrieval failure
never breaks the statute answer (caught, statute-only reply).

Trust boundary: Next.js reads the session and injects `user_id`
server-side into the Python call (`/api/chat` route). The Python API
itself accepts `user_id` as a parameter because it only listens on the
internal compose network — it must never be exposed publicly without an
auth check in front.

## Upload path

Browser → `POST /api/documents` (multipart, session-checked, 10 MB cap)
→ forwards to Python `POST /api/documents?user_id=…` → parse/chunk/
embed/upsert → Neon row. Uploads auto-attach to the active chat and link
to the conversation row on first send (`conversation_documents`), so
reopening a chat restores its files. The library picker attaches older
files; detach removes the link (vectors stay for other chats); Delete
removes metadata everywhere and the vectors too (with a best-effort
cleanup — metadata deletion is authoritative).

## Verification (2026-10-30)

- `uv run pytest tests/` — 58 passed, incl. `test_documents.py` (parse
  all four formats incl. a hand-built PDF with xref, caps, payload
  shape, collection/index creation, delete scoping, in-query filter
  shape, `[D1]` evidence numbering).
- Live Qdrant probe: real Voyage embed + upsert → own query returns the
  chunk (filename matches); cross-user query returns 0; wrong `doc_id`
  returns 0; post-delete query returns 0.
- Browser `docs.spec.mjs` PASS: real upload through the UI shows the
  chip, mocked `[D1]` answer opens the "From your files" card, reload +
  reopen restores the chip, detach/delete work, `.exe` shows the friendly
  error, zero JS errors.
- Full regression (rail, sidebar, canned, hung, auth, persist, header,
  theme) still PASS after the citation-key change (`s1`/`d1`).

## Limits and follow-ups

- Voyage free tier (3 RPM) is shared with the statute ingestion run:
  uploads under contention can 429 and surface the generic error; retry
  the upload a minute later. A paid tier or a separate key removes this.
- No OCR: scanned PDFs are rejected. Docling/a VLM pass would unlock
  them at much higher ingest cost.
- Doc chunks are not re-ranked against statute chunks; the prompt
  separates the two evidence kinds instead. A cross-encoder re-rank is
  the natural next quality step.
- `user-documents` lives on Qdrant Cloud free tier; watch collection
  count/size if uploads grow.
- History sidebar has a title search box (client-side over the loaded
  50) and the chat top bar downloads the active conversation as Markdown
  (`## You` / `## LegalBuddy` turns plus a Sources section resolving
  `[n]`/`[Dn]` the way the sidebar does).
