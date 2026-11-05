# LegalBuddy — Grounded Bangladesh Legal Research Copilot

[![ci](https://github.com/istiaqfuad/legalbuddy-cv/actions/workflows/ci.yml/badge.svg)](https://github.com/istiaqfuad/legalbuddy-cv/actions/workflows/ci.yml)
[![release](https://github.com/istiaqfuad/legalbuddy-cv/actions/workflows/release.yml/badge.svg)](https://github.com/istiaqfuad/legalbuddy-cv/actions/workflows/release.yml)

LegalBuddy answers questions about Bangladeshi law in plain Bangla, English,
or a mix, and every claim points to the exact section behind it: the act, the
section text, and a link to the source. It also reads your own documents,
tracks compliance deadlines for businesses, and connects owners with verified
lawyers.

**LegalBuddy is an information tool, not a lawyer.** It cites sources so you
can verify everything, and it hands off to human advocates where judgment
matters.

## What it does

- **Cited chat.** Ask in your own words; get plain answers grounded in
  Bangladeshi statutes with a collapsible Sources panel. Streams token by
  token with a stall watchdog and background generation per conversation.
- **Deep research agent.** A ReAct loop over statutes, case studies, your
  files, and recent news, with a step progress bar (Starter: 3 steps,
  Professional: 6). Citations are numbered after a Jina rerank.
- **Document vault.** Upload licences, contracts, and case files. Text is
  extracted (including vision transcription for scans), chunked per file, and
  used to ground answers. Expiry dates are suggested from the file text;
  tracking them is always your tap.
- **Contract review.** Flags penalty, termination, payment, and similar
  clauses against retrieved statutes only. Ungrounded flags are dropped, never
  shown. Flags prefill an advocate handoff in one tap.
- **Business dashboard** (`/business`, Business plan). Deadline tracker with
  recurrence roll-forward, a monthly snapshot (done, due, gaps, upcoming),
  the vault, a short business profile that seeds starter renewals, and
  advocate handoff with an optional preferred visit date.
- **Lawyer directory and matching** (`/lawyers`). Verified lawyers on a
  current Professional plan are listed with ratings and their public
  first-visit fee (set by the lawyer; paid in person, never through the app).
  Recommendations combine practice-area fit, semantic match, and Bayesian
  rating weight, each with a templated reason.
- **Accounts and billing.** Neon Auth (email plus Google), Stripe test-mode
  subscriptions with webhook as source of truth, quotas (Lite 20/day,
  Starter 100/day, Professional unlimited), and a lawyer verification flow
  with admin review.

Plan details live on the [pricing page](https://legalbuddy.irflab.tech/pricing).

## Who pays, and why

LegalBuddy is free to try and paid to work with. The model is a funnel, not
a paywall:

- **Lite (free).** 20 cited answers a day, the full vault, no agent. Enough
  to trust the answers; tight enough that a real matter hits the wall.
- **Starter (~$5/mo).** One matter, start to finish: 100 answers a day and
  short deep-research runs. The first paid step for individuals.
- **Professional (~$12.99/mo).** Unlimited research, extended agent runs, and
  the lawyer payoff: a directory profile plus client recommendations. Lawyers
  pay for visibility and leads, not software.
- **Business (~$19.99/mo).** The compliance dashboard: deadline tracking with
  roll-forward, a monthly snapshot, the private vault with expiry suggestions
  and contract review, and advocate handoff with a preferred visit date.

Two rules hold across every tier. First, dates and citations are records the
owner can verify; the app never invents a statute, a section, or a deadline,
and anything ambiguous says so instead of guessing. Second, the platform never
touches legal fees: lawyers set a public first-visit fee on their profile,
and clients pay the lawyer in person. Handoff requests carry facts and files
only; the advice happens between owner and advocate.

## Quickstart

Requires `uv` (Python 3.14, see `.python-version`) and Docker.

```bash
cp .env.example .env   # fill in keys; never commit .env
docker compose up -d --build api web
```

Then open [http://localhost:3001](http://localhost:3001) in a browser.
Host ports are 3001 (web) / 8001 (api); the containers talk to each other
as `web` → `http://api:8000`. Both services read the repo `.env`.

```bash
uv sync            # create .venv and install locked deps
uv run pytest      # backend unit tests (172 passing)
cd web && npm run lint && npx tsc --noEmit
node web/scripts/db-migrate.mjs            # Neon schema (statement-split, idempotent)
node web/scripts/stripe-setup.mjs          # create Stripe test-mode prices
stripe listen --forward-to localhost:3001/api/billing/webhook
```

Key names live in [.env.example](.env.example): Qdrant Cloud, Voyage AI,
Baseten and Meta inference, Jina rerank, Tavily news, Neon Postgres and
object storage, Stripe test keys, Google OAuth.

## How it is built

```
src/legalbuddy/        FastAPI answer backend
  api.py               routes: chat + streams, documents, contract review,
                       match-lawyers, internal token gate
  chat.py              hybrid retrieval (dense + sparse, RRF, rerank) and
                       cited answers via Baseten Muse Spark
  agent.py             ReAct deep-research loop (Meta small model) with a
                       Postgres checkpointer for resume-safe runs
  documents.py         upload pipeline: extract, chunk per file, embed,
                       store in Qdrant + Neon S3
  expiry.py            rules-only expiry-date suggestions from stored text
  contract_review.py   clause spotting + grounded flags, citations validated
  matcher.py           lawyer recommendations with rating weight
  memory.py            Postgres chat history (LangGraph-ready)
web/                   Next.js 16 + Tailwind + zustand
  app/                 routes: chat, business dashboard, lawyers, lawyer
                       inbox, billing, pricing, auth
  lib/chat-api.ts      the only seam to the answer backend (SSE parsing)
  stores/chat-store.ts conversation state, background streams, agent budget
  components/          feature folders per area
scripts/               ingest_statutes.py, ingest_cases.py, ask.py, eval tools
tests/                 backend unit tests (hermetic where external)
docs/                  runbooks: ingestion, retrieval, billing, research agent
```

Notable engineering decisions are written up in [docs/](docs/README.md):
retrieval fusion, reranking, streaming reliability, memory, billing and
verification, the recommender, and the research agent.

## Data and ingestion

`data/` is gitignored. Statutes (`data/acts/*.json`, bdlaws format) ingest
resumably with a manifest; case studies ingest from the case pipeline.
See [docs/case-studies-pipeline.md](docs/case-studies-pipeline.md) and the
ingestion section of the runbook.

```bash
uv run python scripts/ingest_statutes.py --check-only   # preflight + plan
uv run python scripts/ingest_statutes.py                # full / resume
uv run python scripts/ingest_cases.py                   # case studies
```

Collection settings the code expects (verified at startup): `legal-statutes`
with named dense vector `denso` (1024, cosine) and sparse `sparso` (idf),
plus keyword payload indexes on act, section, and source fields.

## Deployment

Plain pushes deploy nothing. Pushing a `v*` tag runs the `release`
workflow: backend tests, frontend typecheck and lint, container build and
push, Heroku release, and a smoke test (homepage serves, unsigned webhook
rejected). The image pins `linux/amd64` without attestations because
Heroku's registry rejects manifest lists.

```bash
git tag -a v1.0.3 -m "..." && git push origin main v1.0.3
```

## Contributing

Micro-tasks with a commit each; `uv run pytest`, `tsc --noEmit`, and
`npm run lint` must all pass before pushing (lint's exit code counts, not
its tail). Browser specs live in `/tmp/btest` as throwaway probes; repo
tests stay hermetic. Never commit `.env`; never add co-author trailers.
