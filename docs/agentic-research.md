# Agentic deep research

Simple RAG answers from one retrieval pass. Deep research (the
"Deep research" toggle in chat) runs a LangGraph ReAct loop instead:
the model decides what to look up, calls tools, and iterates until
the answer is grounded.

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

`create_react_agent` with the same Muse Spark model, a system prompt
that demands tool-first grounding with exact markers, and an
`AsyncPostgresSaver`-style sync `PostgresSaver` checkpointer on Neon
keyed by `agent:{conversation_id}`. First run in a conversation seeds
the thread from the shared memory store, so agent mode continues
discussions started in simple RAG. Threads are per-request savers
(one connection each); DDL runs once per process.

Events mirror `stream_answer` plus `step` (`started`/`done` with the
tool name). Final text is buffered and replayed as tokens after `meta`
so intermediate agent chatter never leaks into the answer. The turn is
recorded to the same memory store as simple RAG.

`max_tool_calls` caps the loop (`recursion_limit = 2*steps + 4`).

## Streaming contract

`POST /api/chat/agent/stream` (FastAPI) emits `step`/`meta`/`token`/
`done`; `POST /api/agent` (Next.js) gates by plan and proxies. The
web client renders steps as a live checklist ("Searching the
statutes ✓"), then streams the answer. Case citations (`[Cn]`) link
to a "From case law" sidebar section like statutes and files.

## Access control

- Lite: no agent mode. The toggle fires the endpoint, the endpoint
  answers 403 `agent-locked`, the UI shows an upgrade nudge.
- Starter with a current subscription: 4 tool calls. Lapsed paid
  plans count as Lite (subscription must be `active`/`trialing`).
- Professional/Business with a current subscription: 8 tool calls.
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
