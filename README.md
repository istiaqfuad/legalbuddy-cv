# LegalBuddy — Grounded Bangladesh Legal Research Copilot

Built for the Meta AI Developer Hackathon. See [PLAN.md](PLAN.md) for the full plan.

## Setup

Requires `uv` (Python 3.14, see `.python-version`).

```bash
cp .env.example .env   # fill in keys; never commit .env
uv sync                # create .venv and install locked deps
uv run pytest          # unit tests
```

Key names live in [.env.example](.env.example): Qdrant Cloud (`QDRANT_URL`,
`QDRANT_API_KEY`, `COLLECTION_NAME`), Voyage AI (`VOYAGE_API_KEY`,
`EMBEDDING_MODEL=voyage-4`), Baseten (`BASETEN_API_KEY`).

## Chatbot (single command)

```bash
docker compose up --build
```

Then open [http://localhost:3001](http://localhost:3001) in a browser.
Host ports are 3001 (web) / 8001 (api) to avoid clashing with other local
stacks; the containers talk to each other as `web` → `http://api:8000`.
Uses the same repo `.env` as ingestion — no extra config.

- `src/legalbuddy/api.py` — FastAPI: `POST /api/chat` (cited answers),
  `GET /health` (index status)
- `web/` — Next.js + Tailwind chat UI; `/api/chat` route proxies to the
  API server-side so keys never reach the browser

## Layout

- `src/legalbuddy/chunking.py` — structure-aware statute chunker (section =
  chunk, Bangla/English aware, footnote resolution)
- `src/legalbuddy/embedder.py` — Voyage `voyage-4` dense + FastEmbed
  `Qdrant/bm25` sparse encoders
- `src/legalbuddy/store.py` — Qdrant hybrid (dense `denso` + sparse `sparso`)
  upsert and RRF search
- `src/legalbuddy/chat.py` — Baseten `meta-models/muse-spark-open-1026`
  chat with statute citations
- `scripts/ingest_statutes.py` — bulk ingestion of `data/acts/*.json`
- `scripts/ask.py` — CLI: ask a question, get a cited answer
- `tests/` — unit tests

## Pipeline

`data/acts/*.json` (bdlaws format, gitignored) → `chunk_act` → Voyage-4
dense (1024-dim, `input_type="document"`) + BM25 sparse → Qdrant
`legal-statutes` → hybrid retrieval → Muse Spark answer with citations.

## Ingestion runbook

Ingestion is resumable: an act counts as done only when the manifest
(`data/manifests/statutes.json`) carries its current file SHA-256 and the
current ingest version. Changed acts are deleted by `source_file` and
re-ingested; failures land in `files_failed` and retry on the next run.

```bash
uv run python scripts/ingest_statutes.py --check-only   # preflight + plan
uv run python scripts/ingest_statutes.py                # full / resume
uv run python scripts/ingest_statutes.py --force        # redo everything
```

Pacing lives in `VoyageDense` (request gap + rolling TPM window).
Defaults are the free tier: `VOYAGE_REQUEST_GAP_S=25`,
`VOYAGE_TOKENS_PER_MIN=8000`. On a paid Voyage tier set the gap to `0`
and the TPM to the tier limit — no code change needed.

**Collection settings the code expects but never creates** (collection
`legal-statutes`, verified at startup; ingestion refuses to run otherwise):

- Named dense vector `denso`: size `1024`, distance `Cosine`
- Named sparse vector `sparso`: modifier `idf`
- Payload indexes: `act_title`, `act_no`, `act_year`, `language`,
  `section_label`, `source_file` as `keyword`; `is_repealed` as `bool`

If `section_label` / `source_file` indexes are missing, add them before
the bulk run (payload indexes are cheap on an existing collection and
Qdrant builds filtered-HNSW links for them):

```python
from qdrant_client import QdrantClient, models
c = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, port=443, timeout=120)
for f in ("section_label", "source_file"):
    c.create_payload_index("legal-statutes", field_name=f,
                           field_schema=models.PayloadSchemaType.KEYWORD)
```

Changing the dense size/distance or sparse modifier requires recreating
the collection and a `--force` re-ingest.
