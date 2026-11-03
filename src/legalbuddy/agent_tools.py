"""Agent tools: retrieval wrapped as LangChain tools with citation artifacts.

Each tool returns ``(evidence_text, citations)`` via
``response_format="content_and_artifact"``: the text is what the model
reasons over, the artifact is a JSON-safe list of citation dicts that
bypass the model and flow straight into the final answer.

Citation numbering is global per agent run through :class:`Collector`:
statutes take ``[1]``…, case studies ``[C1]``…, user files ``[D1]``…,
mirroring the simple-RAG markers so answers read the same in both
modes. Tools are built fresh per request, bound to that run's
collector, so concurrent conversations can never share numbering.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.request
from dataclasses import dataclass, field

from langchain_core.tools import tool

from legalbuddy import chat as chat_mod
from legalbuddy.embedder import encode_sparse, shared_dense
from legalbuddy.rerank import rerank_points
from legalbuddy.store import (
    build_case_filter,
    make_client,
    search_cases as store_search_cases,
    search_user_docs,
)


# Bangladesh sources for recent scenarios: national dailies in both
# languages, wires with Dhaka coverage, and the official publishers of
# new law (bdlaws), verdicts (Supreme Court), and gazette notifications
# (BG Press). Anything outside this list cannot ground an answer.
NEWS_DOMAINS = [
    # English newspapers
    "thedailystar.net", "dhakatribune.com", "newagebd.net",
    "thefinancialexpress.com.bd", "daily-sun.com", "bdnews24.com",
    "bssnews.net",
    # Bangla newspapers
    "prothomalo.com", "jugantor.com", "kalerkantho.com",
    "ittefaq.com.bd", "samakal.com",
    # Wires with Dhaka bureaus (major events only)
    "aljazeera.com", "bbc.com", "reuters.com",
    # Official publishers: new acts, verdicts, gazette notifications
    "bdlaws.minlaw.gov.bd", "supremecourt.gov.bd", "bgpress.gov.bd",
    "lawmin.gov.bd",
]

# At most this many news searches per run: each one bills and adds a
# network round-trip, and one recent-events check is usually enough.
MAX_NEWS_CALLS = 2


@dataclass
class Collector:
    """Per-run citation sink: numbering, dedupe, final list."""

    citations: list[dict] = field(default_factory=list)
    _statute_n: int = 0
    _case_n: int = 0
    _doc_n: int = 0
    _news_n: int = 0
    news_calls: int = 0
    _seen: set = field(default_factory=set)

    def _add(self, citation: dict, key: tuple) -> dict | None:
        if key in self._seen:
            return None
        self._seen.add(key)
        self.citations.append(citation)
        return citation

    def add_statute(self, payload: dict, score: float, chunk_id: str) -> int | None:
        self._statute_n += 1
        return self._add(
            {
                "kind": "statute",
                "ref": self._statute_n,
                "act_title": str(payload.get("act_title", "")),
                "act_no": str(payload.get("act_no", "")),
                "act_year": str(payload.get("act_year", "")),
                "section_label": str(payload.get("section_label", "")),
                "section_title": str(payload.get("section_title", "")),
                "excerpt": str(payload.get("text", ""))[:1200],
                "source_url": str(payload.get("source_url", "")),
                "chunk_id": chunk_id,
                "score": float(score),
            },
            ("statute", chunk_id),
        )

    def add_case(self, payload: dict, score: float, chunk_id: str) -> int | None:
        self._case_n += 1
        return self._add(
            {
                "kind": "case",
                "ref": self._case_n,
                "case_number": str(payload.get("case_number", "")),
                "case_type": str(payload.get("case_type", "")),
                "court": str(payload.get("court", "")),
                "case_year": str(payload.get("case_year", "")),
                "parties": str(payload.get("parties", "")),
                "disposition": str(payload.get("disposition", "")),
                "excerpt": str(payload.get("text", ""))[:1200],
                "chunk_id": chunk_id,
                "score": float(score),
            },
            ("case", chunk_id),
        )

    def add_doc(self, payload: dict, score: float, chunk_id: str) -> dict | None:
        self._doc_n += 1
        return self._add(
            {
                "kind": "document",
                "ref": self._doc_n,
                "doc_filename": str(payload.get("filename", "")),
                "doc_page": payload.get("page"),
                "excerpt": str(payload.get("text", ""))[:1200],
                "chunk_id": chunk_id,
                "score": float(score),
            },
            ("doc", chunk_id),
        )

    def add_news(self, title: str, publisher: str, published_date: str,
                 url: str, excerpt: str) -> dict | None:
        self._news_n += 1
        return self._add(
            {
                "kind": "news",
                "ref": self._news_n,
                "title": title,
                "publisher": publisher,
                "published_date": published_date,
                "source_url": url,
                "excerpt": excerpt[:1200],
                "chunk_id": url,
                "score": 0.5,
            },
            ("news", url),
        )


def _statute_lines(hits, collector: Collector) -> str:
    lines: list[str] = []
    for p in hits.points:
        pl = p.payload or {}
        cited = collector.add_statute(pl, float(p.score), str(p.id))
        if cited is None:
            continue
        lines.append(
            f"[{cited['ref']}] {pl.get('act_title')} ({pl.get('act_no')} of {pl.get('act_year')}), "
            f"Section {pl.get('section_label') or '?'}"
            f"{' — ' + str(pl.get('section_title')) if pl.get('section_title') else ''}\n"
            f"{pl.get('text', '')[:1500]}"
        )
    return "\n\n".join(lines)


def _case_lines(hits, collector: Collector) -> str:
    lines: list[str] = []
    for p in hits.points:
        pl = p.payload or {}
        cited = collector.add_case(pl, float(p.score), str(p.id))
        if cited is None:
            continue
        head = str(pl.get("case_number", "") or pl.get("case_id", ""))
        court = str(pl.get("case_type", "") or pl.get("court", ""))
        lines.append(
            f"[C{cited['ref']}] {head} — {court}\n{pl.get('text', '')[:1500]}"
        )
    return "\n\n".join(lines)


def _doc_lines(hits, collector: Collector, start: int = 1) -> str:
    lines: list[str] = []
    for p in hits.points:
        pl = p.payload or {}
        cited = collector.add_doc(pl, float(p.score), str(p.id))
        if cited is None:
            continue
        page = f", page {pl.get('page')}" if pl.get("page") else ""
        lines.append(f"[D{cited['ref']}] {pl.get('filename')}{page}\n{pl.get('text', '')[:1500]}")
    return "\n\n".join(lines)


logger = logging.getLogger(__name__)


def tavily_search(query: str, api_key: str, max_results: int = 5) -> list[dict]:
    """Recent-news search, restricted to the curated domain allowlist.

    ``topic="news"`` + ``time_range="month"`` keeps results to this
    month's reporting; ``include_domains`` rejects everything outside
    NEWS_DOMAINS server-side (the model never chooses sources).
    Raises on transport/API errors; callers degrade to plain text.
    """
    body = json.dumps({
        "api_key": api_key,
        "query": query,
        "topic": "news",
        "time_range": "month",
        "max_results": max_results,
        "include_domains": NEWS_DOMAINS,
        "include_answer": False,
        "include_raw_content": False,
    }).encode()
    req = urllib.request.Request(
        "https://api.tavily.com/search", data=body,
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=25) as res:
        payload = json.loads(res.read().decode("utf-8", "replace"))
    return payload.get("results", []) or []


def _news_lines(results: list[dict], collector: Collector) -> str:
    lines: list[str] = []
    for r in results:
        url = str(r.get("url", ""))
        if not url:
            continue
        title = str(r.get("title", "") or url)
        publisher = url.split("/")[2] if "/" in url else url
        cited = collector.add_news(
            title, publisher, str(r.get("published_date", "") or ""),
            url, str(r.get("content", "") or r.get("snippet", "")))
        if cited is None:
            continue
        date = f" ({cited['published_date']})" if cited["published_date"] else ""
        lines.append(f"[N{cited['ref']}] {title} — {publisher}{date}\n"
                     f"{str(r.get('content', '') or r.get('snippet', ''))[:1200]}")
    return "\n\n".join(lines)


NEWS_PROMPT_ADDENDUM = """ A search_recent_news tool is also \
available: use it ONLY for events after 2025, something happening \
right now, or when statutes and cases found nothing. Its excerpts \
cite as [N1], [N2], … — always name the publisher and date, and news \
never overrides what the statutes say."""


def build_tools(collector: Collector, user_id: str | None = None,
                doc_ids: list[str] | None = None):
    """Create the agent's tools bound to one run's collector (and, for
    files, to the requesting user's isolated documents)."""

    @tool(response_format="content_and_artifact")
    def search_statutes(query: str) -> tuple[str, list[dict]]:
        """Search Bangladesh statutes and acts for the legal provisions
        behind a question. Use for offences, punishments, procedures,
        rights, and duties. Returns numbered [n] excerpts to cite."""
        before = len(collector.citations)
        try:
            # Small per-tool budget: the loop may call several tools and
            # citations merge, so each call returns few, high-precision hits.
            hits = chat_mod.retrieve(query, limit=4)
        except Exception:
            return "Statute search is unavailable right now.", []
        text = _statute_lines(hits, collector)
        if not text:
            return "No statute provisions matched that query.", []
        return text, collector.citations[before:]

    @tool(response_format="content_and_artifact")
    def search_cases(query: str, case_type: str = "") -> tuple[str, list[dict]]:
        """Search decided case studies: judgments, writ petitions, appeals.
        Use for how courts actually ruled, precedents, and what outcomes
        similar facts produced. Optionally narrow with a case type such as
        WRIT PETITION or CRIMINAL APPEAL. Returns [Cn] excerpts to cite."""
        before = len(collector.citations)
        try:
            dense_q = shared_dense().embed([query], input_type="query")[0]
            sparse_q = encode_sparse([query])[0]
            filt = build_case_filter(case_type=case_type or None)
            # NB: called store_search_cases because this tool's own name
            # (search_cases) shadows the store import inside build_tools.
            hits = store_search_cases(make_client(), dense_q, sparse_q,
                                      query_filter=filt, limit=12)
            hits.points = rerank_points(query, hits.points, 3)
        except Exception:
            return "Case search is unavailable right now.", []
        text = _case_lines(hits, collector)
        if not text:
            return "No case studies matched that query.", []
        return text, collector.citations[before:]

    tools = [search_statutes, search_cases]
    if os.environ.get("TAVILY_API_KEY", ""):
        @tool(response_format="content_and_artifact")
        def search_recent_news(query: str) -> tuple[str, list[dict]]:
            """Check this month's reporting for recent developments: new
            amendments, just-delivered verdicts, ongoing cases in the
            news. Use ONLY when the question is about events after 2025,
            something happening right now, or the statutes and cases
            found nothing. Sources are limited to major Bangladesh
            newspapers and official publishers; returns [Nn] excerpts.
            News never overrides the statutes."""
            before = len(collector.citations)
            if collector.news_calls >= MAX_NEWS_CALLS:
                return "Already checked the news this run.", []
            collector.news_calls += 1
            try:
                results = tavily_search(query, os.environ["TAVILY_API_KEY"])
            except Exception as exc:
                logger.warning("news search failed: %s", exc)
                return "News search is unavailable right now.", []
            text = _news_lines(results, collector)
            if not text:
                return "No recent reporting matched that query.", []
            return text, collector.citations[before:]

        tools.append(search_recent_news)
    if user_id and doc_ids:
        @tool(response_format="content_and_artifact")
        def search_user_files(query: str) -> tuple[str, list[dict]]:
            """Search the user's own attached files for facts about their
            matter: names, dates, sections mentioned, what happened. Always
            try this when the user refers to their file or case. Returns
            [Dn] excerpts to cite."""
            before = len(collector.citations)
            try:
                hits = chat_mod.retrieve_docs(query, user_id, doc_ids, limit=4)
            except Exception:
                return "File search is unavailable right now.", []
            text = _doc_lines(hits, collector)
            if not text:
                return "Nothing in the attached files matched that query.", []
            return text, collector.citations[before:]

        tools.append(search_user_files)
    return tools
