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


@dataclass
class Collector:
    """Per-run citation sink: numbering, dedupe, final list."""

    citations: list[dict] = field(default_factory=list)
    _statute_n: int = 0
    _case_n: int = 0
    _doc_n: int = 0
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

    def add_doc(self, payload: dict, score: float, chunk_id: str) -> int | None:
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
            hits = chat_mod.retrieve(query, limit=6)
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
                                      query_filter=filt, limit=20)
            hits.points = rerank_points(query, hits.points, 5)
        except Exception:
            return "Case search is unavailable right now.", []
        text = _case_lines(hits, collector)
        if not text:
            return "No case studies matched that query.", []
        return text, collector.citations[before:]

    tools = [search_statutes, search_cases]
    if user_id and doc_ids:
        @tool(response_format="content_and_artifact")
        def search_user_files(query: str) -> tuple[str, list[dict]]:
            """Search the user's own attached files for facts about their
            matter: names, dates, sections mentioned, what happened. Always
            try this when the user refers to their file or case. Returns
            [Dn] excerpts to cite."""
            before = len(collector.citations)
            try:
                hits = chat_mod.retrieve_docs(query, user_id, doc_ids, limit=6)
            except Exception:
                return "File search is unavailable right now.", []
            text = _doc_lines(hits, collector)
            if not text:
                return "Nothing in the attached files matched that query.", []
            return text, collector.citations[before:]

        tools.append(search_user_files)
    return tools
