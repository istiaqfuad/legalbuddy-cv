"""Unit tests for the agent retrieval tools (no network)."""

from types import SimpleNamespace

from legalbuddy.agent import _renumber
from legalbuddy.agent_tools import Collector, build_tools


def _point(payload, score=0.9, pid="p1"):
    return SimpleNamespace(payload=payload, score=score, id=pid)


def test_collector_numbers_per_kind_and_dedupes():
    c = Collector()
    assert c.add_statute({"text": "t"}, 0.9, "s1")["ref"] == 1
    assert c.add_statute({"text": "t"}, 0.9, "s1") is None  # same chunk
    assert c.add_case({"text": "t"}, 0.8, "c1")["ref"] == 1
    assert c.add_doc({"text": "t"}, 0.7, "d1")["ref"] == 1
    assert [x["kind"] for x in c.citations] == ["statute", "case", "document"]
    assert len(c.citations) == 3  # merged list holds one entry per chunk


def test_renumber_merges_kinds_without_cascade():
    citations = [
        {"kind": "statute", "ref": 1},
        {"kind": "case", "ref": 1},
        {"kind": "document", "ref": 2},
        {"kind": "news", "ref": 1},
    ]
    # Statute marker [2] must NOT be rewritten when a later mapping
    # turns another marker into [2]: single pass, no cascade.
    out = _renumber("law [1] and [2], precedent [C1], file [D2], press [N1]", citations)
    assert out == "law [1] and [2], precedent [2], file [3], press [4]"


def test_statute_tool_shapes_markers_and_artifacts(monkeypatch):
    import legalbuddy.agent_tools as tools_mod

    pts = [
        _point({"act_title": "Penal Code", "act_no": "XLV", "act_year": "1860",
                "section_label": "302", "section_title": "", "text": "Punishment.",
                "source_url": "http://x"}, 0.9, "s1"),
    ]
    monkeypatch.setattr(tools_mod.chat_mod, "retrieve",
                        lambda q, limit=6: SimpleNamespace(points=pts))
    collector = Collector()
    (search_statutes,) = [t for t in build_tools(collector) if t.name == "search_statutes"]
    text, artifacts = search_statutes.func("murder punishment")
    assert "[1]" in text and "Penal Code" in text
    assert artifacts and artifacts[0]["kind"] == "statute"


def test_case_tool_uses_hybrid_search_and_c_markers(monkeypatch):
    import legalbuddy.agent_tools as tools_mod

    pts = [_point({"case_number": "WP 1", "case_type": "WRIT PETITION",
                   "court": "HCD", "text": "Held accordingly."}, 0.8, "c1")]
    monkeypatch.setattr(tools_mod, "shared_dense",
                        lambda: SimpleNamespace(embed=lambda texts, input_type=None: [[0.1]]))
    monkeypatch.setattr(tools_mod, "encode_sparse", lambda texts: [([1], [0.5])])
    monkeypatch.setattr(tools_mod, "make_client", lambda: object())
    monkeypatch.setattr(tools_mod, "store_search_cases",
                        lambda *a, **k: SimpleNamespace(points=pts))
    monkeypatch.setattr(tools_mod, "rerank_points", lambda q, p, n: p[:n])
    collector = Collector()
    tools = {t.name: t for t in build_tools(collector)}
    text, artifacts = tools["search_cases"].func("writ petition")
    assert "[C1]" in text and "WP 1" in text
    assert artifacts and artifacts[0]["kind"] == "case"


def test_file_tool_absent_without_docs(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    assert {t.name for t in build_tools(Collector())} == {"search_statutes", "search_cases"}


def test_news_tool_gated_on_api_key(monkeypatch):
    import legalbuddy.agent_tools as tools_mod

    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    assert "search_recent_news" not in {t.name for t in build_tools(Collector())}
    monkeypatch.setenv("TAVILY_API_KEY", "test")
    assert "search_recent_news" in {t.name for t in build_tools(Collector())}


def test_news_tool_marks_publishers_and_caps_calls(monkeypatch):
    import legalbuddy.agent_tools as tools_mod

    monkeypatch.setenv("TAVILY_API_KEY", "test")
    seen = []

    def fake_search(query, api_key, max_results=5):
        seen.append(query)
        return [
            {"title": "Verdict delivered", "url": "https://www.thedailystar.net/x",
             "content": "Court ruled.", "published_date": "2026-10-01"},
            {"title": "No url here", "content": "Skipped."},
        ]

    monkeypatch.setattr(tools_mod, "tavily_search", fake_search)
    collector = Collector()
    tools = {t.name: t for t in build_tools(collector)}
    text, artifacts = tools["search_recent_news"].func("recent verdict")
    assert "[N1]" in text and "thedailystar.net" in text
    assert artifacts[0]["kind"] == "news" and artifacts[0]["publisher"] == "www.thedailystar.net"
    assert len(collector.citations) == 1  # url-less result skipped
    # Second call works, third is refused by the per-run cap.
    tools["search_recent_news"].func("again")
    assert tools["search_recent_news"].func("third") == ("Already checked the news this run.", [])
    assert len(seen) == 2


def test_news_domains_cover_both_languages_and_official():
    from legalbuddy.agent_tools import NEWS_DOMAINS

    assert "thedailystar.net" in NEWS_DOMAINS
    assert "prothomalo.com" in NEWS_DOMAINS
    assert "bdlaws.minlaw.gov.bd" in NEWS_DOMAINS
    assert "supremecourt.gov.bd" in NEWS_DOMAINS
    assert all(" " not in d and "." in d for d in NEWS_DOMAINS)


def test_file_tool_present_with_docs(monkeypatch):
    import legalbuddy.agent_tools as tools_mod

    pts = [_point({"filename": "deed.pdf", "page": 2, "text": "Plot 12."}, 0.7, "d1")]
    monkeypatch.setattr(tools_mod.chat_mod, "retrieve_docs",
                        lambda q, u, d, limit=4: SimpleNamespace(points=pts))
    collector = Collector()
    tools = {t.name: t for t in build_tools(collector, user_id="u", doc_ids=["d"])}
    assert "search_user_files" in tools
    text, artifacts = tools["search_user_files"].func("deed plot")
    assert "[D1]" in text and artifacts[0]["kind"] == "document"
