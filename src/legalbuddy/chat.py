"""Grounded legal Q&A over ingested statutes (Baseten Muse Spark).

Every material legal claim in the answer must cite retrieved sections.
Each citation carries the cited text excerpt, full section details, and
the source link — because bdlaws pages have no per-section anchors
(verified: ``id="sec-dec"`` repeats on every section), the link is
act-level and the section label + excerpt pinpoint the provision.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from openai import OpenAI

from legalbuddy.embedder import VoyageDense, encode_sparse
from legalbuddy.store import (
    build_filter,
    dbsf_search,
    hybrid_search,
    make_client,
    weighted_search,
)

CHAT_MODEL = "meta-models/muse-spark-open-1026"
BASE_URL = "https://inference.baseten.co/v1"
# Reasoning models spend tokens thinking: keep headroom so content survives.
MAX_TOKENS = 2048

SYSTEM_PROMPT = """You are LegalBuddy, a Bangladesh legal research assistant. \
Answer ONLY from the statute excerpts in EVIDENCE. Every material legal claim \
must end with a citation like [1], [2] referring to the numbered excerpts. \
If the evidence does not support an answer, say so plainly instead of guessing. \
Distinguish: (1) what the law states, (2) your interpretation, (3) recommended \
next steps. Reply in the same language as the question (English or Bangla). \
End with one line: 'Note: research assistance only, not a substitute for a lawyer.'"""


@dataclass
class Citation:
    ref: int
    act_title: str
    act_no: str
    act_year: str
    section_label: str
    section_title: str
    excerpt: str
    source_url: str
    chunk_id: str
    score: float


@dataclass
class Answer:
    text: str
    citations: list[Citation] = field(default_factory=list)
    model: str = CHAT_MODEL


def _client() -> OpenAI:
    return OpenAI(base_url=BASE_URL, api_key=os.environ["BASETEN_API_KEY"])


def retrieve(question: str, language: str | None = None,
             act_year: str | None = None, limit: int = 8,
             section_label: str | None = None):
    """Hybrid retrieve statute chunks for a question.

    Fusion mode comes from ``FUSION`` (``weighted`` default, ``rrf``, or
    ``dbsf``); see :mod:`legalbuddy.store` for the trade-offs.
    """
    dense = VoyageDense()
    dense_q = dense.embed([question], input_type="query")[0]
    sparse_q = encode_sparse([question])[0]
    query_filter = build_filter(language=language, act_year=act_year,
                                section_label=section_label)
    mode = os.environ.get("FUSION", "weighted").lower()
    if mode == "dbsf":
        return dbsf_search(make_client(), dense_q, sparse_q, limit=limit,
                           query_filter=query_filter)
    if mode == "weighted":
        return weighted_search(make_client(), question, dense_q, sparse_q,
                               limit=limit, query_filter=query_filter)
    return hybrid_search(
        make_client(), dense_q, sparse_q, limit=limit, query_filter=query_filter)


def _evidence_block(hits) -> tuple[str, list[Citation]]:
    lines: list[str] = []
    citations: list[Citation] = []
    for i, p in enumerate(hits.points, start=1):
        pl = p.payload or {}
        citations.append(Citation(
            ref=i,
            act_title=str(pl.get("act_title", "")),
            act_no=str(pl.get("act_no", "")),
            act_year=str(pl.get("act_year", "")),
            section_label=str(pl.get("section_label", "")),
            section_title=str(pl.get("section_title", "")),
            excerpt=str(pl.get("text", ""))[:1200],
            source_url=str(pl.get("source_url", "")),
            chunk_id=str(p.id),
            score=float(p.score),
        ))
        lines.append(
            f"[{i}] {pl.get('act_title')} ({pl.get('act_no')} of {pl.get('act_year')}), "
            f"Section {pl.get('section_label') or '?'}"
            f"{' — ' + str(pl.get('section_title')) if pl.get('section_title') else ''}\n"
            f"{pl.get('text', '')[:1500]}")
    return "\n\n".join(lines), citations


def stream_answer(question: str, language: str | None = None,
                  act_year: str | None = None, limit: int = 8):
    """Yield ``("meta", dict)``, ``("token", str)``..., then ``("done", Answer)``.

    ``meta`` carries the citations up front so the UI can show what the
    answer will stand on; tokens stream from Baseten as they arrive.
    """
    hits = retrieve(question, language=language, act_year=act_year, limit=limit)
    if not hits.points:
        yield ("done", Answer(text="I could not verify this from the available sources.",
                              citations=[]))
        return
    evidence, citations = _evidence_block(hits)
    yield ("meta", {"citations": citations, "model": CHAT_MODEL})
    stream = _client().chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",
             "content": f"QUESTION: {question}\n\nEVIDENCE:\n{evidence}"},
        ],
        max_tokens=MAX_TOKENS,
        temperature=0.1,
        stream=True,
    )
    parts: list[str] = []
    for chunk in stream:
        # Reasoning gateways interleave keepalive chunks with no choices;
        # the opening chunk may carry only a role. Neither holds text.
        if not chunk.choices:
            continue
        delta = getattr(chunk.choices[0].delta, "content", None) or ""
        if delta:
            parts.append(delta)
            yield ("token", delta)
    text = "".join(parts)
    if not text.strip():
        raise RuntimeError("Empty chat completion (reasoning exhausted token budget?)")
    yield ("done", Answer(text=text, citations=citations))


def answer(question: str, language: str | None = None,
           act_year: str | None = None, limit: int = 8) -> Answer:
    """Retrieve evidence and generate a cited answer (non-streaming)."""
    final: Answer | None = None
    for kind, val in stream_answer(question, language=language,
                                   act_year=act_year, limit=limit):
        if kind == "done":
            final = val
    assert final is not None
    return final
