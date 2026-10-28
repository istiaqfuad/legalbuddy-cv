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
