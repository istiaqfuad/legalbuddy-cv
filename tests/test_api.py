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
