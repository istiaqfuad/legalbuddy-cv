"""Unit tests for the agent loop wiring (no network, faked graph)."""

from contextlib import contextmanager
from types import SimpleNamespace

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

import legalbuddy.agent as agent_mod


@contextmanager
def _fake_saver(*a, **k):
    yield SimpleNamespace(setup=lambda: None)


class _FakeAgent:
    """Scripted create_react_agent: yields updates + message chunks."""

    def __init__(self, script):
        self.script = script

    def get_state(self, config):
        return SimpleNamespace(values={"messages": [HumanMessage(content="old")]})

    def update_state(self, config, values):
        raise AssertionError("fresh thread expected; history must not reseed")

    def stream(self, *a, **k):
        yield from self.script


def _run(monkeypatch, script, **kw):
    monkeypatch.setenv("META_API_KEY", "test")
    monkeypatch.setattr(agent_mod, "_checkpointer", _fake_saver)
    monkeypatch.setattr(agent_mod, "create_react_agent", lambda *a, **k: _FakeAgent(script))
    monkeypatch.setattr(agent_mod, "build_tools", lambda *a, **k: [])
    monkeypatch.setattr(agent_mod, "record_turn", lambda *a: None)
    return list(
        agent_mod.run_agent("What is the punishment?", conversation_id="c1", **kw)
    )


def _ai(text, calls=()):
    m = AIMessage(content=text)
    m.tool_calls = list(calls)  # AIMessage carries tool_calls as attribute
    return m


def test_step_events_and_final_answer(monkeypatch):
    script = [
        ("updates", {"agent": {"messages": [
            _ai("", [{"name": "search_statutes", "args": {}, "id": "1", "type": "tool_call"}])]}}),
        ("updates", {"tools": {"messages": [ToolMessage(content="e", name="search_statutes", tool_call_id="1")]}}),
        ("messages", (_ai("Answer [1]."), {})),
        ("updates", {"agent": {"messages": [_ai("Answer [1].")]}}),
    ]
    monkeypatch.setattr(
        agent_mod, "Collector",
        lambda: SimpleNamespace(citations=[{
            "kind": "statute", "ref": 1, "act_title": "Penal Code", "act_no": "XLV",
            "act_year": "1860", "section_label": "302", "section_title": "",
            "excerpt": "Punishment.", "source_url": "http://x", "chunk_id": "s1",
            "score": 0.9, "doc_filename": "", "doc_page": None,
            "case_number": "", "court": ""}]),
    )
    events = _run(monkeypatch, script)
    kinds = [k for k, _ in events]
    assert kinds[0] == "step" and events[0][1] == {"tool": "search_statutes", "status": "started"}
    assert ("step", {"tool": "search_statutes", "status": "done"}) in [(k, v) for k, v in events]
    assert "meta" in kinds and kinds[-1] == "done"
    done = events[-1][1]
    assert done.text == "Answer [1]." and len(done.citations) == 1


def test_empty_evidence_yields_no_verify_answer(monkeypatch):
    script = [
        ("messages", (_ai("I cannot help."), {})),
        ("updates", {"agent": {"messages": [_ai("I cannot help.")]}}),
    ]
    events = _run(monkeypatch, script)
    assert [k for k, _ in events] == ["done"]
    done = events[-1][1]
    assert done.text.startswith("I could not verify") and done.citations == []


def test_chunks_split_evenly():
    assert list(agent_mod._chunks("abcdef", 2)) == ["ab", "cd", "ef"]


def test_agent_stream_leads_with_budget(monkeypatch):
    """The stream opens with the plan-sized step budget for the progress bar."""
    import json
    from types import SimpleNamespace

    import legalbuddy.agent as agent_mod
    import legalbuddy.api as api_mod
    from fastapi.testclient import TestClient

    events = [("done", SimpleNamespace(text="ok", model="m", citations=[]))]

    def fake_run_agent(*a, **k):
        yield from events

    monkeypatch.setattr(agent_mod, "run_agent", fake_run_agent)
    resp = TestClient(api_mod.app).post(
        "/api/chat/agent/stream",
        json={"question": "q", "user_id": "u", "max_tool_calls": 3},
    )
    assert resp.status_code == 200
    first = resp.text.split("\n\n")[0]
    assert first.startswith("event: budget")
    assert json.loads(first.split("data: ", 1)[1]) == {"total": 3}
