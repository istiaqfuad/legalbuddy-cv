"""OCR endpoint for Sanad scans (hermetic: vision is faked, no network)."""

from fastapi.testclient import TestClient

from legalbuddy import api as api_mod
from legalbuddy import documents as docs_mod


def test_ocr_image_ok(monkeypatch):
    monkeypatch.setattr(docs_mod, "transcribe_images", lambda imgs: ["Enrolled Advocate MD KARIM 12345"])
    client = TestClient(api_mod.app)
    resp = client.post("/api/ocr", files={"file": ("sanad.png", b"fakepng", "image/png")})
    assert resp.status_code == 200
    assert resp.json()["text"] == "Enrolled Advocate MD KARIM 12345"


def test_ocr_pdf_first_page(monkeypatch):
    seen = {}

    def fake_render(data, pages):
        seen["pages"] = pages
        return {1: b"pagepng"}

    monkeypatch.setattr(docs_mod, "render_pages", fake_render)
    monkeypatch.setattr(docs_mod, "transcribe_images", lambda imgs: ["SANAD 9876"])
    client = TestClient(api_mod.app)
    resp = client.post("/api/ocr", files={"file": ("sanad.pdf", b"%PDF-fake", "application/pdf")})
    assert resp.status_code == 200
    assert seen["pages"] == [1]
    assert resp.json()["text"] == "SANAD 9876"


def test_ocr_rejects_empty_and_oversize():
    client = TestClient(api_mod.app)
    assert client.post("/api/ocr", files={"file": ("s.png", b"", "image/png")}).status_code == 400
    big = b"x" * (10 * 1024 * 1024 + 1)
    assert client.post("/api/ocr", files={"file": ("s.png", big, "image/png")}).status_code == 400


def test_ocr_upstream_failure_is_502(monkeypatch):
    def boom(imgs):
        raise RuntimeError("baseten down")

    monkeypatch.setattr(docs_mod, "transcribe_images", boom)
    client = TestClient(api_mod.app)
    resp = client.post("/api/ocr", files={"file": ("s.png", b"png", "image/png")})
    assert resp.status_code == 502
