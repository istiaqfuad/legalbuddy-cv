"""Conversational memory on Postgres (Neon), LangGraph-ready.

Uses the opensource ``langchain-postgres`` package (``PostgresChatMessageHistory``)
so a later move to a LangGraph agentic workflow is trivial: a LangGraph graph
(or any LangChain chain) can open :func:`history_session` with the same
conversation id and immediately read/write the same turns this module stores.

Two history stores exist on purpose, with different jobs:

* Neon ``messages`` table (via the Next.js API): UI history with citation
  payloads for rendering, rename/delete per conversation.
* This ``chat_message_history`` table: plain ``HumanMessage`` / ``AIMessage``
  turns in the LangChain-idiomatic shape that LangGraph checkpointers and
  LangChain runnables consume natively.

Writes here are best-effort: memory must never break answering, so every
public helper swallows its own errors and degrades to "no history".
"""

from __future__ import annotations

import logging
import os
import re
import threading
import uuid
from contextlib import contextmanager

import psycopg
from langchain_core.messages import AIMessage, HumanMessage
from langchain_postgres import PostgresChatMessageHistory

logger = logging.getLogger(__name__)

TABLE = "chat_message_history"
MAX_TURNS = 3
MAX_CHARS = 3000

_ensured = False
_ensured_lock = threading.Lock()


def _conninfo(*, pooled: bool) -> str:
    """Neon connection string without the ``channel_binding`` param.

    ``channel_binding=require`` is needed by some drivers but rejected by
    others; ``psycopg`` (v3) does not accept it, so strip it like the
    db-migrate script does.
    """
    key = "DATABASE_URL_POOLED" if pooled else "DATABASE_URL"
    url = os.environ.get(key) or os.environ.get("DATABASE_URL", "")
    return re.sub(r"[?&]channel_binding=[^&]*", "", url)


def ensure_table() -> None:
    """Create the history table once (DDL goes over the direct URL)."""
    global _ensured
    with _ensured_lock:
        if _ensured:
            return
        conn = psycopg.connect(_conninfo(pooled=False), autocommit=True)
        try:
            PostgresChatMessageHistory.create_tables(conn, TABLE)
        finally:
            conn.close()
        _ensured = True


def session_uuid(conversation_id: str) -> str:
    """Derive the store's session id from a conversation id.

    ``PostgresChatMessageHistory`` requires a UUID session id, while our
    conversations use cuid strings. UUID5 is deterministic: the same
    conversation always maps to the same store session (and LangGraph nodes
    can recompute it with this one function).
    """
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"legalbuddy-conv:{conversation_id}"))


@contextmanager
def history_session(session_id: str):
    """Yield a LangChain history bound to this conversation.

    ``session_id`` is the app conversation id; it is mapped through
    :func:`session_uuid` for the store. The connection is owned by the
    context manager (short-lived, pooled). This is the seam LangGraph code
    reuses later, e.g. per-node ``with history_session(sid) as history:``.
    """
    ensure_table()
    conn = psycopg.connect(_conninfo(pooled=True), autocommit=True)
    try:
        yield PostgresChatMessageHistory(
            TABLE, session_uuid(session_id), sync_connection=conn
        )
    finally:
        conn.close()


def record_turn(session_id: str, user_text: str, assistant_text: str) -> None:
    """Append one user/assistant pair. Never raises."""
    if not session_id or (not user_text and not assistant_text):
        return
    try:
        with history_session(session_id) as history:
            history.add_messages(
                [
                    HumanMessage(content=user_text),
                    AIMessage(content=assistant_text),
                ]
            )
    except Exception as exc:  # memory must never break answering
        logger.warning("memory record failed for %s: %s", session_id, exc)


def recent_turns(
    session_id: str | None,
    max_turns: int = MAX_TURNS,
    max_chars: int = MAX_CHARS,
) -> list[dict]:
    """Return the latest turns oldest-first as ``{"role", "content"}`` dicts.

    Bounded for prompts: at most ``max_turns`` pairs, newest kept, total
    content trimmed to ``max_chars`` by dropping oldest messages first.
    Returns ``[]`` when there is no usable history.
    """
    if not session_id:
        return []
    try:
        with history_session(session_id) as history:
            messages = history.messages
    except Exception as exc:
        logger.warning("memory read failed for %s: %s", session_id, exc)
        return []

    window = messages[-(max_turns * 2):]
    turns: list[dict] = []
    for msg in window:
        if isinstance(msg, HumanMessage):
            turns.append({"role": "user", "content": str(msg.content)})
        elif isinstance(msg, AIMessage):
            turns.append({"role": "assistant", "content": str(msg.content)})
    total = sum(len(t["content"]) for t in turns)
    while len(turns) > 2 and total > max_chars:
        total -= len(turns.pop(0)["content"])
    return turns


# Rewrite gate: only follow-ups pay for a rewrite call. First questions and
# self-contained questions skip it (zero extra LLM cost).
FOLLOWUP_PATTERN = re.compile(
    r"\b(it|its|this|that|these|those|they|them|their|he|she|his|her|"
    r"above|same|previous|earlier|more|else)\b"
    r"|\b(what|how) about\b|\btell me more\b",
    re.IGNORECASE,
)
SHORT_QUESTION_WORDS = 12

REWRITE_SYSTEM = (
    "Rewrite the user's last question as a complete standalone legal "
    "question a search engine can answer with no conversation history. "
    "Resolve every reference from the conversation above: 'it', 'this "
    "case', 'the punishment', 'that section' must become the actual "
    "offence, section number, act name, or party. If the last question is "
    "vague on its own, you MUST expand it with those specifics — never "
    "echo the last question unchanged. Output ONLY the rewritten question, "
    "no preamble."
)


def needs_rewrite(question: str, history: list[dict]) -> bool:
    """True when the question likely refers back to earlier turns."""
    if not history or not (question or "").strip():
        return False
    if len(question.strip().split()) <= SHORT_QUESTION_WORDS:
        return True
    return bool(FOLLOWUP_PATTERN.search(question))


def contextualize(question: str, history: list[dict], client, model: str) -> str:
    """Rewrite a follow-up into a standalone question via the chat model.

    ``client`` is an OpenAI-compatible client and ``model`` its model name
    (both dependency-injected so LangGraph nodes and tests can pass their
    own; the app passes its ``CHAT_MODEL``). Falls back to the original
    question on any error.
    """
    try:
        messages = [{"role": "system", "content": REWRITE_SYSTEM}]
        for turn in history[-6:]:
            role = turn.get("role", "user")
            messages.append(
                {
                    "role": role if role in ("user", "assistant") else "user",
                    "content": str(turn.get("content", ""))[:1500],
                }
            )
        messages.append({"role": "user", "content": f"Last question: {question}"})
        # Muse Spark always reasons first: the reasoning trace consumes
        # output tokens before the rewritten question appears. A small
        # budget (finish=length) yields empty or echoed content, so allow
        # headroom; fall back to the original question when content is empty.
        out = client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=1024,
            temperature=0.0,
        )
        text = (out.choices[0].message.content or "").strip()
        return text or question
    except Exception as exc:
        logger.warning("question contextualize failed, using original: %s", exc)
        return question


def history_block(history: list[dict], max_chars: int = 2000) -> str:
    """Format recent turns for the generation prompt (context, not evidence)."""
    lines = []
    for turn in history[-6:]:
        who = "User" if turn.get("role") == "user" else "Assistant"
        lines.append(f"{who}: {str(turn.get('content', ''))[:800]}")
    block = "\n".join(lines)
    return block[-max_chars:] if len(block) > max_chars else block
