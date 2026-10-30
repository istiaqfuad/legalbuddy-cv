# Conversational memory (Postgres, LangGraph-ready)

Follow-up questions ("And the punishment?", "What about attempt?") carry no
searchable terms on their own. The chat path resolves them against recent
turns stored in Postgres (Neon) before retrieval, so the second question in
a conversation retrieves as well as the first.

## How a follow-up flows

1. The browser sends `conversationId` (the Neon `conversations.id`) with
   every `/api/chat` request; the Next route forwards it as
   `conversation_id` (`src/legalbuddy/api.py`, `web/app/api/chat/route.ts`).
2. `stream_answer` loads the last 3 turns via `recent_turns`
   (`src/legalbuddy/memory.py`), oldest first, capped at ~3000 chars.
3. `needs_rewrite` decides whether the question leans on history: any
   question of 12 words or fewer, or one containing a pronoun, demonstrative
   ("this", "that"), or phrases like "tell me more". First questions and long
   self-contained questions skip the rewrite, so they cost nothing extra.
4. On a rewrite, `contextualize` asks Muse Spark for a standalone question
   (max 1024 tokens, temperature 0). The standalone question drives the
   existing two-stage grounded retrieval; a short verbatim window joins the
   generation prompt as context only (the system prompt still requires every
   legal claim to cite EVIDENCE, never earlier answers).
5. The finished turn is appended to the store via `record_turn`. Storage is
   best-effort: any failure logs a warning and answering continues without
   history.

If the model echoes the question instead of resolving it, retrieval expands
deterministically with the last three user questions ("EARLIER QUESTIONS IN
THIS CONVERSATION") rather than issuing another LLM call.

## Store: opensource `langchain-postgres`

History lives in the `chat_message_history` table managed by
`PostgresChatMessageHistory` (`langchain-postgres`, MIT), not in a bespoke
schema. The table is created on first use (`ensure_table`, DDL over the
direct Neon URL; app traffic uses the pooled URL, both with
`channel_binding` stripped for psycopg). `history_session` is a context
manager that owns its short-lived connection; `record_turn`/`recent_turns`
are thin wrappers over it. This is separate from the Neon `messages` table,
which keeps UI history with citation payloads for rendering.

Moving to a LangGraph agentic workflow later means opening the same store
per node (`with history_session(conversation_id) as history: ...`) or
pointing a LangGraph checkpointer at the same Postgres — no migration, no
second memory system.

## Gotchas solved

- The store requires a UUID session id, but conversation ids are not UUIDs.
  `session_uuid` maps each conversation id through UUID5 (deterministic, so
  the same conversation always hits the same session).
- Muse Spark always reasons before answering, and the reasoning trace eats
  output tokens first. A 150-token rewrite budget returned empty or echoed
  content (`finish: length`, ~397 reasoning tokens); 1024 tokens leaves room
  for the rewritten question. Empty content falls back to the original
  question, never an error.
- Every rewrite logs one `[MEM-rewrite]` line with conversation id, turn
  count, and before/after text, so a bad follow-up can be traced to its
  resolution. App logging defaults to INFO (`LOG_LEVEL` overrides).
- Voyage free-tier 429s (3 RPM) surface as generic 502s mid-stream; the
  probe scripts back off and retry. A paid Voyage key removes this.
