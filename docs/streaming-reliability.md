# Streaming reliability: crashes, stalls, and leaks

## 1. Choiceless keepalive chunks crashed the stream

**Symptom.** Every streamed answer died immediately; the API log showed
`IndexError: list index out of range` at `chunk.choices[0].delta.content.

**Root cause.** The reasoning gateway interleaves heartbeat chunks with an
empty `choices` list, and the opening chunk can carry only a role. The
code assumed every chunk holds a choice.

**Fix.** Skip choiceless chunks; read text defensively
(`src/legalbuddy/chat.py::stream_answer`). Regression test streams an
empty-choices chunk plus a role-only chunk through the real generator
(`tests/test_api.py::test_chat_stream_skips_choiceless_keepalives`).

## 2. Silent stalls hung the UI forever

**Symptom.** After meta arrived, some runs produced zero tokens for
200s+: no error, no completion, Ask disabled. Server logs showed those
requests completing (or still reasoning); the browser never recovered.

**Root cause.** No layer bounded mid-stream silence, so a hung gateway
connection or lost tail left the reader awaiting forever.

**Fix.** Client-side silence watchdog in `web/lib/chat-api.ts`
(`streamChat`): generous grace before the first token (reasoning happens
there, default 150s), then a rolling idle budget once tokens flow
(default 45s). Expiry throws `ChatStreamError`, which the store turns
into the friendly error plus a working retry. Verified with a
held-open stub stream: friendly error appears and typing re-enables Ask.

## 3. Error contract: nothing internal reaches the browser

Upstream status codes, exception text, hostnames, and tracebacks stay in
server logs. The Next route maps every upstream failure to one generic
line; the Python API does the same for direct callers. Locked by tests
asserting exact generic messages and the absence of leaked internals.

## SSE contract

`POST /api/chat/stream` emits `meta` (citations up front) → `token`
(JSON-escaped chunks) → `done` (full answer + citations), or `error`
(generic). The browser renders incrementally from `token` events; only
`done` finalizes the answer, so a truncated stream can never present a
partial answer as complete.

## Files

`src/legalbuddy/chat.py`, `src/legalbuddy/api.py`, `web/app/api/chat/route.ts`,
`web/lib/chat-api.ts`, `web/stores/chat-store.ts`, `tests/test_api.py`.
