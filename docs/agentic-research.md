# Agentic deep research

Simple RAG answers from one retrieval pass. Deep research (the
"Deep research" toggle in chat) runs a LangGraph ReAct loop instead:
the model decides what to look up, calls tools, and iterates until
the answer is grounded.

## How the agent works, step by step

A run starts in the browser: the Deep research toggle adds
`agent: true` to the chat stream, and the Next.js route
(`POST /api/agent`) checks the plan first. Lite is rejected with 403
`agent-locked`; Starter gets 3 tool rounds, Professional/Business 6;
lapsed subscriptions count as Lite. The route proxies to the FastAPI
endpoint (`POST /api/chat/agent/stream`), which owns the loop.

Inside one run (`run_agent`):

1. **Setup.** A fresh `Collector` (the citation sink) is created, and
   three tools are built bound to it: `search_statutes`,
   `search_cases`, and — only when the user attached files —
   `search_user_files`, scoped to that user's documents. The agent is
   `create_react_agent` with the Meta small model (see below) and a
   Postgres checkpointer thread keyed `agent:{conversation_id}`. If
   the thread is new, past turns from the shared memory store seed it,
   so a deep-research question mid-conversation still sees what was
   already discussed.
2. **Reason and act.** The model reads the system prompt (use tools
   first, cite every claim with the exact markers, never guess) plus
   the conversation, then either calls a tool or answers. Each tool
   runs the same tested retrieval as simple RAG — Voyage dense +
   FastEmbed sparse, hybrid fusion, Jina rerank — and returns two
   things: evidence text the model reasons over, and citation records
   that bypass the model straight into the `Collector`. Statutes keep
   `[n]`, cases `[Cn]`, files `[Dn]`, numbered per kind as tools run.
3. **Bounded loop.** The loop cannot run away: `recursion_limit`
   caps graph steps, each tool returns few high-precision hits
   (4 statutes / 3 cases / 4 file chunks), and total citations are
   hard-capped at 16 by score — extra markers are stripped from the
   text so no dangling `[9]` survives. Stopping is enforced in code
   because small models ignore "stop when answered" prompts.
4. **Merge and stream.** The per-kind markers are renumbered to one
   merged `[1..n]` list in a single regex pass. Events replay in the
   same contract as simple RAG — `step` (tool started/done, rendered
   as a live checklist), `meta` (citations up front), `token`
   (the final answer replayed in chunks), `done` — so the UI, sidebar,
   and `[Cn]` jump links all work unchanged. The finished turn is
   recorded to the same memory store as simple answers, so follow-ups
   in either mode see it.
5. **Failure modes stay quiet.** No evidence yields "I could not
   verify this from the available sources." Tool errors return a
   plain sentence to the model instead of raising, so one dead source
   never kills the run. Mid-stream crashes emit the generic error
   event; details stay in server logs.

## Tools (`src/legalbuddy/agent_tools.py`)

Three tools, all wrapped around the tested retrieval in `chat.py` /
`store.py` (no new retrieval code, no new Qdrant collections):

- `search_statutes`: hybrid statute search, `[n]` markers.
- `search_cases`: hybrid RRF over the `case_studies` collection
  (court, case type, parties, disposition in the payload), `[Cn]`
  markers, optional `case_type` filter.
- `search_user_files`: only built when files are attached; scoped to
  the requesting user's documents, `[Dn]` markers.

Each tool returns `(evidence_text, citations)` via
`response_format="content_and_artifact"`. A per-run `Collector`
numbers citations globally with per-kind markers; the merged answer
renumbers them to `[1..n]` in one regex pass (sequential replaces
would cascade when a merged number collides with another marker).

`search_cases` (the tool) vs `search_cases` (the store function) is a
real shadowing hazard: the store import is aliased to
`store_search_cases` for exactly this reason.

## Agent (`src/legalbuddy/agent.py`)

`create_react_agent` with a small Meta-hosted model (`_agent_client()`:
`AGENT_MODEL`/`AGENT_BASE_URL`/`AGENT_API_KEY`, no redeploy to switch),
a system prompt that demands tool-first grounding with exact markers,
and a sync `PostgresSaver` checkpointer on Neon keyed by
`agent:{conversation_id}`. First run in a conversation seeds the thread
from the shared memory store, so agent mode continues discussions
started in simple RAG. Threads are per-request savers (one connection
each); DDL runs once per process. Free-tier chat stays on
`muse-spark-open-1026`; only the agent reads the `AGENT_*` vars.

Model note: Glimmer is the intended small model, but it 404s on the
current Meta key (absent from `/models`, all ids probed). Wonder works
but costs $4/$20 per 1M tokens, so the default is Spark 1.3 Standard
($1.25/$4.25, native tool calls verified on a research question).
Contributor pricing ($0.10/$0.20) was rejected: Meta may train on the
content, unacceptable for client legal queries. Small models
over-search and narrate: the loop is bounded in code
(`recursion_limit = 2*steps + 2`, per-tool limits 4/3/4), citations
are hard-capped at 16 by score with dangling markers stripped, and
the prompt bans narration. Residual roughness vs the flagship is the
known trade for keeping agentic traffic cheap and off the hackathon
key.

## What the Meta docs changed in this setup

Three findings from `dev.meta.ai/docs`, all applied:

- **`reasoning_effort: low`.** Reasoning models bill thinking as
  output tokens, and the agent pays that on every tool round. The
  loop's thinking is bounded work (pick a tool, read excerpts), so
  the agent client sends top-level `reasoning_effort: "low"`
  (`AGENT_REASONING_EFFORT` overrides). Verified live: the loop stays
  grounded at 1–2 rounds with cited answers. Simple chat keeps the
  default effort — only the agent is throttled.
- **Automatic prefix caching.** The API caches the stable prompt
  prefix with no flags or breakpoints, billed at cached-input rates
  ($0.15/1M vs $1.25). The loop re-sends the same system prompt and
  tool schemas every round with history appended after, which is
  exactly the cache-friendly shape — this falls out of the design,
  no code needed. Keep tool schemas and the system prompt byte-stable
  to keep hitting it.
- **Native tool calling.** The docs confirm tool calling as a
  first-class capability, and live probes confirmed it on
  `muse-spark-1.3`, `muse-spark-1.1`, and `muse-wonder-1.0` — so the
  agent uses real function calls, not ReAct prompt hacks, and model
  swaps need no prompt changes.

Events mirror `stream_answer` plus `step` (`started`/`done` with the
tool name). Final text is buffered and replayed as tokens after `meta`
so intermediate agent chatter never leaks into the answer. The turn is
recorded to the same memory store as simple RAG.

## Streaming contract

`POST /api/chat/agent/stream` (FastAPI) emits `step`/`meta`/`token`/
`done`; `POST /api/agent` (Next.js) gates by plan and proxies. The
web client renders steps as a live checklist ("Searching the
statutes ✓"), then streams the answer. Case citations (`[Cn]`) link
to a "From case law" sidebar section like statutes and files.

## Access control

- Lite: no agent mode. The toggle fires the endpoint, the endpoint
  answers 403 `agent-locked`, the UI shows an upgrade nudge.
- Starter with a current subscription: 3 tool rounds. Lapsed paid
  plans count as Lite (subscription must be `active`/`trialing`).
- Professional/Business with a current subscription: 6 tool rounds.
- Agent answers count toward the same daily quota as simple answers,
  so no new counters or tables.

## Verification

`tests/test_agent.py` (loop wiring with a scripted graph: steps,
meta/done order, no-evidence fallback) and
`tests/test_agent_tools.py` (numbering, dedupe, renumbering,
per-tool markers). Browser spec `/tmp/btest/agent-run.spec.mjs`:
a Starter user sees live tool steps, gets "Sources · 6 law" with a
working bdlaws link; a Lite user gets the lock banner; zero page
errors. The `users_plan_check` constraint now includes `starter`
(schema + live migration).
