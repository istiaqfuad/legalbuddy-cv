"""Conversational memory: rewrite gate, contextualize, Postgres store."""

import pytest
from langchain_core.messages import AIMessage, HumanMessage

import legalbuddy.memory as mem


@pytest.fixture()
def history():
    return [
        {"role": "user", "content": "What does section 302 of the Penal Code say?"},
        {"role": "assistant", "content": "Section 302 punishes murder with death or life imprisonment."},
    ]


class TestNeedsRewrite:
    def test_no_history_never_rewrites(self):
        assert mem.needs_rewrite("What about the punishment?", []) is False
        assert mem.needs_rewrite("What about the punishment?", None) is False

    def test_empty_question_never_rewrites(self, history):
        assert mem.needs_rewrite("", history) is False
        assert mem.needs_rewrite("   ", history) is False

    def test_pronoun_followup_rewrites(self, history):
        assert mem.needs_rewrite("What is the punishment for it under that act?", history) is True

    def test_short_followup_rewrites(self, history):
        assert mem.needs_rewrite("And the punishment?", history) is True
        assert mem.needs_rewrite("Tell me more.", history) is True

    def test_long_standalone_question_skips_rewrite(self):
        q = ("What punishment does the law prescribe for a person who commits "
             "murder under section 302 of the Penal Code of Bangladesh?")
        assert mem.needs_rewrite(q, history) is False


class FakeCompletions:
    def __init__(self, text=None, exc=None, seen=None):
        self.text = text
        self.exc = exc
        self.seen = seen if seen is not None else {}

    def create(self, **kwargs):
        self.seen.update(kwargs)
        if self.exc:
            raise self.exc
        msg = type("M", (), {"content": self.text})()
        choice = type("C", (), {"message": msg})()
        return type("R", (), {"choices": [choice]})()


class FakeClient:
    def __init__(self, text=None, exc=None, seen=None):
        self.chat = type("Chat", (), {"completions": FakeCompletions(text, exc, seen)})()


class TestContextualize:
    def test_rewrites_with_history(self, history):
        seen = {}
        out = mem.contextualize(
            "And the punishment?", history,
            FakeClient("What is the punishment under section 302?", seen=seen),
            "test-model",
        )
        assert out == "What is the punishment under section 302?"
        assert seen["model"] == "test-model"
        # Headroom for the reasoning trace (see contextualize comment).
        assert seen["max_tokens"] >= 512
        roles = [m["role"] for m in seen["messages"]]
        assert roles[0] == "system"
        assert any("302" in m["content"] for m in seen["messages"][1:])

    def test_falls_back_to_original_on_error(self, history):
        q = "And the punishment?"
        out = mem.contextualize(q, history, FakeClient(exc=RuntimeError("down")), "m")
        assert out == q

    def test_empty_rewrite_falls_back(self, history):
        q = "And the punishment?"
        out = mem.contextualize(q, history, FakeClient("  "), "m")
        assert out == q


class DummyConn:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class FakeHistory:
    instances = []

    def __init__(self, table, session_id, sync_connection=None):
        self.table = table
        self.session_id = session_id
        self.saved = []
        FakeHistory.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def add_messages(self, messages):
        self.saved.extend(messages)

    @property
    def messages(self):
        return list(FakeHistory.seed)


@pytest.fixture()
def fake_store(monkeypatch):
    FakeHistory.instances = []
    FakeHistory.seed = []
    monkeypatch.setattr(mem, "_ensured", True)  # skip DDL in unit tests
    monkeypatch.setattr(mem, "PostgresChatMessageHistory", FakeHistory)
    conns = []

    class FakePsycopg:
        @staticmethod
        def connect(*a, **k):
            conn = DummyConn()
            conns.append(conn)
            return conn

    monkeypatch.setattr(mem, "psycopg", FakePsycopg)
    return conns


class TestSessionUuid:
    def test_stable_and_distinct(self):
        assert mem.session_uuid("conv-1") == mem.session_uuid("conv-1")
        assert mem.session_uuid("conv-1") != mem.session_uuid("conv-2")

    def test_valid_uuid_for_cuid_input(self):
        import uuid as uuid_mod

        # Regression: the store rejects non-UUID session ids, and app
        # conversation ids are cuids — the mapping must always be valid.
        uuid_mod.UUID(mem.session_uuid("cmabc123xyz"))


class TestRecordTurn:
    def test_appends_human_then_ai(self, fake_store):
        conns = fake_store
        mem.record_turn("conv-1", "What is bail?", "Bail is ...")
        assert len(FakeHistory.instances) == 1
        h = FakeHistory.instances[0]
        assert h.session_id == mem.session_uuid("conv-1")
        assert isinstance(h.saved[0], HumanMessage) and h.saved[0].content == "What is bail?"
        assert isinstance(h.saved[1], AIMessage) and h.saved[1].content == "Bail is ..."
        assert len(conns) == 1 and conns[0].closed is True

    def test_empty_session_is_noop(self, fake_store):
        mem.record_turn("", "q", "a")
        mem.record_turn(None, "q", "a")
        assert FakeHistory.instances == []


class TestRecentTurns:
    def test_returns_bounded_window_oldest_first(self, fake_store):
        FakeHistory.seed = [
            HumanMessage(content=f"q{i}") if i % 2 == 0 else AIMessage(content=f"a{i}")
            for i in range(8)
        ]
        turns = mem.recent_turns("conv-1")
        assert len(turns) == 6  # last 3 pairs of 4
        assert turns[0] == {"role": "user", "content": "q2"}
        assert turns[-1] == {"role": "assistant", "content": "a7"}

    def test_trims_to_max_chars(self, fake_store):
        FakeHistory.seed = [
            HumanMessage(content="x" * 100),
            AIMessage(content="y" * 100),
            HumanMessage(content="q?"),
            AIMessage(content="a!"),
        ]
        turns = mem.recent_turns("conv-1", max_chars=10)
        assert turns == [
            {"role": "user", "content": "q?"},
            {"role": "assistant", "content": "a!"},
        ]

    def test_store_failure_returns_empty(self, monkeypatch):
        monkeypatch.setattr(mem, "_ensured", True)

        class BadPsycopg:
            @staticmethod
            def connect(*a, **k):
                raise ConnectionError("neon unreachable")

        monkeypatch.setattr(mem, "psycopg", BadPsycopg)
        assert mem.recent_turns("conv-1") == []

    def test_history_block_formats_roles(self):
        turns = [
            {"role": "user", "content": "q"},
            {"role": "assistant", "content": "a"},
        ]
        block = mem.history_block(turns)
        assert "User: q" in block and "Assistant: a" in block


class TestStreamAnswerMemory:
    def test_followup_retrieves_with_standalone_question(self, monkeypatch):
        import legalbuddy.chat as chat_mod

        past = [
            {"role": "user", "content": "What does section 302 say?"},
            {"role": "assistant", "content": "It punishes murder."},
        ]
        monkeypatch.setattr(chat_mod, "recent_turns", lambda cid: past)
        # stream_answer builds the client eagerly as an argument to the
        # (mocked) contextualize; keep client construction out of this test.
        monkeypatch.setattr(chat_mod, "_client", lambda: object())
        monkeypatch.setattr(
            chat_mod, "needs_rewrite", lambda q, h: True)
        monkeypatch.setattr(
            chat_mod, "contextualize",
            lambda q, h, c, m: "What is the punishment under section 302?")
        seen = {}

        class Hits:
            points = []

        def fake_grounded(q, **kw):
            seen["q"] = q
            return (Hits(), None, q)

        monkeypatch.setattr(chat_mod, "retrieve_grounded", fake_grounded)
        recorded = {}
        monkeypatch.setattr(
            chat_mod, "record_turn",
            lambda cid, q, a: recorded.update(cid=cid, q=q, a=a))

        events = list(chat_mod.stream_answer("And the punishment?",
                                             conversation_id="conv-9"))
        assert seen["q"] == "What is the punishment under section 302?"
        kinds = [k for k, _ in events]
        assert kinds == ["done"]
        assert recorded["cid"] == "conv-9"
        assert recorded["q"] == "And the punishment?"

    def test_echoed_rewrite_falls_back_to_prior_questions(self, monkeypatch):
        import legalbuddy.chat as chat_mod

        past = [
            {"role": "user", "content": "What does section 302 say?"},
            {"role": "assistant", "content": "It punishes murder."},
        ]
        monkeypatch.setattr(chat_mod, "recent_turns", lambda cid: past)
        monkeypatch.setattr(chat_mod, "needs_rewrite", lambda q, h: True)
        # Model echoes the input instead of resolving it.
        monkeypatch.setattr(chat_mod, "contextualize", lambda q, h, c, m: q)
        monkeypatch.setattr(chat_mod, "_client", lambda: object())
        seen = {}

        class Hits:
            points = []

        def fake_grounded(q, **kw):
            seen["q"] = q
            return (Hits(), None, q)

        monkeypatch.setattr(chat_mod, "retrieve_grounded", fake_grounded)
        monkeypatch.setattr(chat_mod, "record_turn", lambda *a: None)
        list(chat_mod.stream_answer("And the punishment?", conversation_id="c"))
        assert "EARLIER QUESTIONS IN THIS CONVERSATION" in seen["q"]
        assert "What does section 302 say?" in seen["q"]
