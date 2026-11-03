"""Deep-research agent: LangGraph ReAct over the retrieval tools.

Simple RAG answers from one retrieval pass; this loop lets the model
decide what to look up: statutes first, then case studies for precedent,
then the user's own files for facts, iterating until the answer is
grounded. State (the message thread) persists in Postgres via
``PostgresSaver`` keyed by conversation, so follow-ups continue the
same thread and a later LangGraph workflow can open it directly.

Yields the same ``("meta" | "token" | "done", ...)`` events as
:func:`legalbuddy.chat.stream_answer` plus ``("step", {...})`` for tool
activity, so the existing SSE endpoint only gains one event type.
``max_tool_calls`` is the plan gate: Starter gets a short leash,
Professional/Business a longer one.
"""

from __future__ import annotations

import logging
import os
import threading
import uuid

from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.prebuilt import create_react_agent

from legalbuddy import chat as chat_mod
from legalbuddy.agent_tools import (
    NEWS_PROMPT_ADDENDUM,
    Collector,
    build_tools,
)
from legalbuddy.memory import _conninfo, recent_turns, record_turn

logger = logging.getLogger(__name__)

AGENT_SYSTEM = """You are LegalBuddy, a Bangladesh legal research assistant. \
Answer ONLY from tool results. Every material claim must end with a \
citation using the exact markers from the excerpts: [1], [2], … for \
statute provisions, [C1], [C2], … for case studies, [D1], [D2], … for \
the user's own files. If the evidence does not support an answer, say \
so plainly instead of guessing. The user's files describe THEIR \
situation; statutes describe the LAW; cases show how courts RULED. Use \
all three: provisions for what the law says, cases for precedent and \
likely outcomes, files for the facts. Distinguish (1) what the law \
states, (2) your interpretation, (3) recommended next steps. Reply in \
the same language as the question (English or Bangla). \
Work efficiently: search statutes first, then cases for precedent, then \
the user's files when they mention their matter. Never call a tool with \
an empty query, and stop searching once the evidence answers the question. \
Cite at most 8 excerpts total. Output ONLY the final structured answer: \
never narrate your searches or reasoning, never echo tool output, never \
ask the user a question."""


# Agent model: a small Meta-hosted model keeps agentic traffic off the
# hackathon-scoped Baseten key. The free-tier chat path stays on
# muse-spark-open-1026 (see chat.CHAT_MODEL); only the agent reads these.
# Glimmer is the intended small model once Meta provisions it on the
# key (currently 404). Wonder works but costs $4/$20 per 1M; Spark 1.3
# Standard ($1.25/$4.25) calls tools just as well, so it is the default.
AGENT_MODEL_DEFAULT = "muse-spark-1.3"
AGENT_BASE_URL_DEFAULT = "https://api.meta.ai/v1"


def _agent_client():
    """Chat model for the ReAct loop, env-overridable without redeploy.

    Per the Meta docs, reasoning models burn output tokens thinking
    before every tool call, controlled by top-level ``reasoning_effort``
    (none/minimal/low/medium/high/xhigh). The loop's thinking is
    bounded work (pick a tool, read excerpts), so ``low`` keeps answers
    fast and cheap; the evidence text, not deeper reasoning, is what
    grounds the answer.
    """
    return ChatOpenAI(
        model=os.environ.get("AGENT_MODEL", AGENT_MODEL_DEFAULT),
        base_url=os.environ.get("AGENT_BASE_URL", AGENT_BASE_URL_DEFAULT),
        api_key=os.environ.get("AGENT_API_KEY", os.environ.get("META_API_KEY", "")),
        max_tokens=chat_mod.MAX_TOKENS,
        temperature=0.1,
        extra_body={"reasoning_effort": os.environ.get("AGENT_REASONING_EFFORT", "low")},
    )


# Hard ceiling on merged citations (see run_agent): the sidebar stays
# readable even when a small model over-searches.
MAX_CITATIONS = 16


_setup_done = False
_setup_lock = threading.Lock()


def _checkpointer():
    """One saver (and connection) per agent run; DDL runs once per process."""
    global _setup_done
    saver_cm = PostgresSaver.from_conn_string(_conninfo(pooled=True))
    if _setup_done:
        return saver_cm
    with _setup_lock:
        if not _setup_done:
            with saver_cm as saver:
                saver.setup()
            _setup_done = True
    return PostgresSaver.from_conn_string(_conninfo(pooled=True))


def _seed_messages(conversation_id: str | None) -> list:
    """Turns from the shared memory store, so an agent thread that starts
    mid-conversation still sees what was already discussed."""
    if not conversation_id:
        return []
    msgs: list = []
    for t in recent_turns(conversation_id):
        content = str(t.get("content", ""))
        if t.get("role") == "user":
            msgs.append(HumanMessage(content=content))
        else:
            msgs.append(AIMessage(content=content))
    return msgs


def run_agent(question: str, conversation_id: str | None = None,
              user_id: str | None = None,
              doc_ids: list[str] | None = None,
              max_tool_calls: int = 4):
    """Yield ``("step" | "meta" | "token" | "done", payload)``.

    ``step`` payloads are ``{"tool": name, "status": "started" | "done"}``
    for live progress. ``meta`` carries the collected citations, ``token``
    replays the final answer in chunks, ``done`` the full
    :class:`legalbuddy.chat.Answer`.
    """
    collector = Collector()
    tools = build_tools(collector, user_id=user_id, doc_ids=doc_ids)
    prompt = AGENT_SYSTEM
    if any(getattr(t, "name", "") == "search_recent_news" for t in tools):
        prompt += NEWS_PROMPT_ADDENDUM
    model = _agent_client()
    thread_id = (f"agent:{conversation_id}" if conversation_id
                 else f"agent:once:{uuid.uuid4().hex}")
    # Approximate round budget: one agent→tools round costs two graph
    # steps, plus the final answer. Small models ignore "stop" prompts,
    # so the loop is bounded here, not by instruction.
    config = {"configurable": {"thread_id": thread_id},
              "recursion_limit": 2 * max_tool_calls + 2}
    final_text = ""
    try:
        with _checkpointer() as saver:
            agent = create_react_agent(model, tools, prompt=prompt,
                                       checkpointer=saver)
            if conversation_id:
                try:
                    prior = agent.get_state(config)
                    fresh = not (prior.values.get("messages") or [])
                except Exception:
                    fresh = True
                if fresh:
                    seed = _seed_messages(conversation_id)
                    if seed:
                        agent.update_state(config, {"messages": seed})
            buffered: list[str] = []
            for mode, chunk in agent.stream(
                    {"messages": [HumanMessage(content=question)]},
                    config=config, stream_mode=["messages", "updates"]):
                if mode == "updates":
                    for node, data in (chunk or {}).items():
                        msgs = (data or {}).get("messages", [])
                        for m in msgs:
                            calls = getattr(m, "tool_calls", None) or []
                            if node == "agent" and calls:
                                for c in calls:
                                    yield ("step", {"tool": c.get("name", "search"),
                                                    "status": "started"})
                            elif node == "tools" and getattr(m, "name", None):
                                yield ("step", {"tool": m.name, "status": "done"})
                elif mode == "messages":
                    msg, _meta = chunk
                    if isinstance(msg, AIMessage):
                        part = msg.content if isinstance(msg.content, str) else ""
                        if part:
                            buffered.append(part)
            final_text = "".join(buffered).strip()
    except Exception:
        logger.exception("agent run failed for conv=%s", conversation_id)
        final_text = ""
    if not collector.citations:
        text = "I could not verify this from the available sources."
        if conversation_id:
            record_turn(conversation_id, question, text)
        yield ("done", chat_mod.Answer(text=text, citations=[]))
        return
    # Hard ceiling: small models over-search, and a 30-card sidebar is
    # noise. Keep the best by score; unmapped markers are stripped from
    # the text so no dangling [9] survives.
    kept = sorted(collector.citations, key=lambda c: c.get("score", 0),
                  reverse=True)[:MAX_CITATIONS]
    kept_ids = {id(c) for c in kept}
    dropped = [c for c in collector.citations if id(c) not in kept_ids]
    if dropped:
        drop_markers = set()
        for c in dropped:
            kind, ref = c.get("kind", "statute"), c.get("ref", 0)
            drop_markers.add(f"[C{ref}]" if kind == "case"
                            else f"[D{ref}]" if kind == "document"
                            else f"[N{ref}]" if kind == "news"
                            else f"[{ref}]")
        for m in drop_markers:
            final_text = final_text.replace(m, "")
    collector.citations = [c for c in collector.citations if id(c) in kept_ids]
    if not final_text:
        final_text = "The evidence is above, but I could not compose an answer."
    citations = [chat_mod.Citation(
        ref=i + 1,
        act_title=c.get("act_title", ""), act_no=c.get("act_no", ""),
        act_year=c.get("act_year", ""), section_label=c.get("section_label", ""),
        section_title=c.get("section_title", ""), excerpt=c.get("excerpt", ""),
        source_url=c.get("source_url", ""), chunk_id=c.get("chunk_id", ""),
        score=c.get("score", 0.0), kind=c.get("kind", "statute"),
        doc_filename=c.get("doc_filename", ""),
        doc_page=c.get("doc_page"),
        case_number=c.get("case_number", ""), court=c.get("court", ""),
        title=c.get("title", ""), publisher=c.get("publisher", ""),
        published_date=c.get("published_date", ""),
    ) for i, c in enumerate(collector.citations)]
    # Renumber markers to match the merged list (tools number per kind).
    renumbered = _renumber(final_text, collector.citations)
    yield ("meta", {"citations": citations, "model": chat_mod.CHAT_MODEL})
    for piece in _chunks(renumbered):
        yield ("token", piece)
    if conversation_id:
        record_turn(conversation_id, question, renumbered)
    yield ("done", chat_mod.Answer(text=renumbered, citations=citations))


def _renumber(text: str, citations: list[dict]) -> str:
    """Rewrite per-kind markers ([2], [C1], [D3]) to merged [1..n] refs.

    Single regex pass: sequential replaces would cascade when a merged
    number collides with another citation's original marker.
    """
    import re

    mapping: dict[str, str] = {}
    for i, c in enumerate(citations, start=1):
        kind = c.get("kind", "statute")
        ref = c.get("ref", 0)
        if kind == "case":
            mapping[f"[C{ref}]"] = f"[{i}]"
        elif kind == "document":
            mapping[f"[D{ref}]"] = f"[{i}]"
        elif kind == "news":
            mapping[f"[N{ref}]"] = f"[{i}]"
        else:
            mapping[f"[{ref}]"] = f"[{i}]"
    return re.sub(r"\[(?:C|D|N)?\d+\]", lambda m: mapping.get(m.group(0), m.group(0)), text)


def _chunks(text: str, size: int = 24):
    for i in range(0, len(text), size):
        yield text[i:i + size]
