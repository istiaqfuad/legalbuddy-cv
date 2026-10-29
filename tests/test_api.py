"""API-layer tests (hermetic: chat + Qdrant are faked, no network)."""

from fastapi.testclient import TestClient

from legalbuddy import api as api_mod
from legalbuddy import chat as chat_mod


def _fake_answer(text="The Act says X. [1]", n_cites=1):
    return chat_mod.Answer(
        text=text,
        citations=[chat_mod.Citation(
            ref=i + 1, act_title="The Penal Code, 1860", act_no="XLV",
            act_year="1860", section_label="302", section_title="Punishment",
            excerpt="Whoever commits murder...", source_url="http://example.test/a",
            chunk_id="cid", score=0.9,
        ) for i in range(n_cites)],
        model="test-model",
    )


def test_chat_ok(monkeypatch):
    monkeypatch.setattr(chat_mod, "answer", lambda *a, **k: _fake_answer())
    resp = TestClient(api_mod.app).post("/api/chat", json={"question": "punishment?"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["answer"].endswith("[1]")
    assert body["citations"][0]["section_label"] == "302"
    assert body["citations"][0]["source_url"].startswith("http")


def test_chat_validation(monkeypatch):
    monkeypatch.setattr(chat_mod, "answer", lambda *a, **k: _fake_answer())
    client = TestClient(api_mod.app)
    assert client.post("/api/chat", json={"question": ""}).status_code == 422
    assert client.post("/api/chat", json={"question": "x", "limit": 99}).status_code == 422
    assert client.post("/api/chat",
                       json={"question": "x", "language": "french"}).status_code == 422


def test_chat_upstream_failure_is_502(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("baseten down at secret-host.internal:443")
    monkeypatch.setattr(chat_mod, "answer", boom)
    resp = TestClient(api_mod.app).post("/api/chat", json={"question": "hi"})
    assert resp.status_code == 502
    # Generic message only: no exception text, hostnames, or ports leak out.
    assert resp.json()["detail"] == "Answer generation failed. Please try again."


def _fake_citation():
    return chat_mod.Citation(
        ref=1, act_title="The Penal Code, 1860", act_no="XLV", act_year="1860",
        section_label="302", section_title="Punishment", excerpt="Whoever commits murder...",
        source_url="http://example.test/a", chunk_id="cid", score=0.9)


def test_chat_stream_events(monkeypatch):
    def fake_stream(*a, **k):
        yield ("meta", {"citations": [_fake_citation()], "model": "m"})
        yield ("token", "hello ")
        yield ("token", "world")
        yield ("done", chat_mod.Answer(text="hello world", citations=[_fake_citation()],
                                      model="m"))
    monkeypatch.setattr(chat_mod, "stream_answer", fake_stream)
    resp = TestClient(api_mod.app).post("/api/chat/stream", json={"question": "hi"})
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    body = resp.text
    assert "event: meta" in body and "event: token" in body and "event: done" in body
    assert '"t": "hello "' in body and '"answer":"hello world"' in body
    assert "Whoever commits murder" in body  # citation excerpt rides meta + done


def test_chat_stream_skips_choiceless_keepalives(monkeypatch):
    """Reasoning gateways send chunks with empty choices; they carry no
    text and must not kill the stream (real Baseten IndexError)."""
    from types import SimpleNamespace

    class FakeCompletions:
        def create(self, **kw):
            assert kw.get("stream") is True
            return iter([
                SimpleNamespace(choices=[]),
                SimpleNamespace(choices=[SimpleNamespace(
                    delta=SimpleNamespace(content=None))]),
                SimpleNamespace(choices=[SimpleNamespace(
                    delta=SimpleNamespace(content="b"))]),
            ])

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    import legalbuddy.chat as chat_mod
    monkeypatch.setattr(chat_mod, "_client", lambda: FakeClient())
    monkeypatch.setattr(chat_mod, "retrieve", lambda *a, **k: SimpleNamespace(points=[object()]))
    monkeypatch.setattr(chat_mod, "_evidence_block",
                        lambda hits: ("E", [chat_mod.Citation(
                            ref=1, act_title="A", act_no="N", act_year="2000",
                            section_label="1", section_title="T", excerpt="x",
                            source_url="u", chunk_id="c", score=0.1)]))
    out = [kind for kind, _ in chat_mod.stream_answer("q")]
    assert out == ["meta", "token", "done"]


def test_chat_stream_mid_failure_stays_generic(monkeypatch):
    def fake_stream(*a, **k):
        yield ("token", "partial ")
        raise RuntimeError("baseten blew up at secret-host.internal:443")
    monkeypatch.setattr(chat_mod, "stream_answer", fake_stream)
    resp = TestClient(api_mod.app).post("/api/chat/stream", json={"question": "hi"})
    assert resp.status_code == 200  # headers already sent; failure rides an event
    assert "event: error" in resp.text
    assert "secret-host" not in resp.text and "traceback" not in resp.text.lower()
    assert "Answer generation failed. Please try again." in resp.text


def test_health_ok(monkeypatch):
    class FakeClient:
        def get_collection(self, name):
            assert name == "legal-statutes"
            return type("Info", (), {"points_count": 1234})()
    monkeypatch.setattr(api_mod, "make_client", lambda: FakeClient())
    resp = TestClient(api_mod.app).get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "collection": "legal-statutes",
                           "points": 1234, "detail": None}


def test_health_degraded(monkeypatch):
    def boom():
        raise ConnectionError("qdrant unreachable")
    monkeypatch.setattr(api_mod, "make_client", boom)
    resp = TestClient(api_mod.app).get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "degraded"
    assert resp.json()["detail"] == "Index check failed."
