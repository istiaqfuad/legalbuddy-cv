"""Tests for user-document parse/chunk/store/retrieve/cite (no network)."""

from io import BytesIO
from types import SimpleNamespace

import pytest

from legalbuddy import chat as chat_mod
from legalbuddy import documents as docs_mod
from legalbuddy.chat import _doc_evidence_block
from legalbuddy.store import (
    DOCS_PAYLOAD_INDEXES,
    delete_doc_points,
    doc_chunk_to_payload,
    ensure_docs_collection,
    search_user_docs,
    upsert_doc_chunks,
)


def _mini_pdf(page_texts):
    """Build a minimal valid single-font PDF with correct xref offsets."""
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        None,  # contents stream, filled below
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    content = b"".join(
        f"BT /F1 12 Tf 72 {720 - i * 20} Td ({t}) Tj ET\n".encode("latin-1")
        for i, t in enumerate(page_texts))
    objs[3] = b"<< /Length %d >>\nstream\n" % len(content) + content + b"endstream"
    out = b"%PDF-1.4\n"
    offsets = [0]
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode()
    out += (f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_at}\n%%EOF").encode()
    return out


def _docx_bytes(paragraphs):
    import docx

    doc = docx.Document()
    for p in paragraphs:
        doc.add_paragraph(p)
    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_parse_txt_and_chunk_headers():
    text = "First paragraph about the lease.\n\nSecond paragraph about rent."
    chunks = docs_mod.chunk_document("d1", "u1", "lease.txt", "text/plain",
                                     docs_mod.parse_document("lease.txt", text.encode()))
    assert len(chunks) == 1
    c = chunks[0]
    assert c.text.startswith("Document: lease.txt (part 1/1)\n")
    assert "lease" in c.text and "rent" in c.text
    assert c.chunk_id == docs_mod.stable_doc_chunk_id("d1", 0)
    assert c.user_id == "u1" and c.doc_id == "d1"


def test_parse_md_and_docx():
    md = docs_mod.parse_document("notes.md", b"# Title\n\nBody text here.")
    assert md[0][1] is None
    segs = docs_mod.parse_document("c.docx", _docx_bytes(["Hello docx", "Second line"]))
    assert segs[0][1] is None
    chunks = docs_mod.chunk_document("d2", "u1", "c.docx", "x", segs)
    assert "Hello docx" in chunks[0].text


def test_parse_pdf_text_with_pages():
    data = _mini_pdf(["Alpha content", "Beta content"])
    from pypdf import PdfReader

    assert len(PdfReader(BytesIO(data)).pages) == 1
    segs = docs_mod.parse_document("scan.pdf", data)
    assert segs[0][1] == 1
    assert "Alpha content" in segs[0][0]


def test_parse_failures_are_user_safe():
    with pytest.raises(ValueError, match="Supported files"):
        docs_mod.parse_document("evil.exe", b"data")
    with pytest.raises(ValueError, match="under 10 MB"):
        docs_mod.parse_document("big.pdf", b"x" * (docs_mod.MAX_DOC_BYTES + 1))
    from pypdf import PdfWriter

    buf = BytesIO()
    w = PdfWriter()
    w.add_blank_page(612, 792)
    w.write(buf)
    with pytest.raises(ValueError, match="no selectable text"):
        docs_mod.parse_document("blank.pdf", buf.getvalue())
    with pytest.raises(ValueError, match="readable text"):
        docs_mod.parse_document("empty.txt", b"   \n  ")


def test_textless_page_detection():
    segs = [("plenty of text here " * 10, 1), ("  \n ", 2), ("tiny", 3)]
    assert docs_mod.textless_page_numbers(segs) == [2, 3]


def test_tables_to_markdown():
    table = [["Name", "Fee"], ["Filing", "500"], ["", None]]
    md = docs_mod.tables_to_markdown(table)
    assert md.splitlines()[0] == "| Name | Fee |"
    assert "| Filing | 500 |" in md
    assert docs_mod.tables_to_markdown([[], []]) == ""
    assert docs_mod.tables_to_markdown([["a", "b", "c"], ["1"]]).count("|") == 12


def test_tables_merge_into_page_chunks():
    segs = [("Some intro text here.", 1)]
    tables = {1: "| A | B |\n| --- | --- |\n| 1 | 2 |"}
    chunks = docs_mod.chunk_document("d", "u", "f.pdf", "application/pdf",
                                     segs, tables=tables)
    assert len(chunks) == 1
    assert "Tables on this page:" in chunks[0].text
    assert "| A | B |" in chunks[0].text
    assert chunks[0].origin == "table"


def test_vision_texts_replace_thin_pages():
    segs = [("plenty of text here " * 10, 1), ("x", 2)]
    vision = {2: "Transcribed scan content about bail."}
    chunks = docs_mod.chunk_document("d", "u", "scan.pdf", "application/pdf",
                                     segs, vision_texts=vision)
    by_page = {c.page: c for c in chunks}
    assert "bail" in by_page[2].text
    assert by_page[2].origin == "vision"
    assert "(visually read)" in by_page[2].text
    assert by_page[1].origin == "text"


def test_render_pages_produces_png():
    data = _mini_pdf(["Hello render"])
    out = docs_mod.render_pages(data, [1, 99])
    assert list(out) == [1]
    assert out[1][:8] == b"\x89PNG\r\n\x1a\n"


def test_transcribe_images_batches(monkeypatch):
    seen = {}

    class FakeMsg:
        content = "Page one text\n---\nPage two text"

    class FakeChoices:
        def __init__(self):
            self.message = FakeMsg()

    class FakeResp:
        choices = [FakeChoices()]

    class FakeCompletions:
        def create(self, model, messages):
            seen["images"] = sum(1 for p in messages[0]["content"]
                                 if p.get("type") == "image_url")
            assert messages[0]["content"][0]["text"].startswith("Transcribe")
            return FakeResp()

    class FakeClient:
        def __init__(self, base_url, api_key):
            self.chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setitem(__import__("os").environ, "BASETEN_API_KEY", "test")
    monkeypatch.setattr("openai.OpenAI", FakeClient)
    out = docs_mod.transcribe_images([b"img1", b"img2"])
    assert seen["images"] == 2
    assert out == ["Page one text", "Page two text"]


def test_chunking_splits_long_docs_and_caps():
    long_text = "\n\n".join(f"Paragraph {i} " + "word " * 300 for i in range(30))
    chunks = docs_mod.chunk_document("d3", "u9", "big.txt", "text/plain",
                                     [(long_text, None)])
    assert 1 < len(chunks) <= docs_mod.MAX_DOC_CHUNKS
    assert chunks[0].text.startswith("Document: big.txt (part 1/")
    assert all(len(c.text) <= 2200 for c in chunks)
    assert chunks[0].user_id == "u9"


def test_doc_payload_carries_isolation_fields():
    c = docs_mod.chunk_document("d4", "u7", "f.txt", "text/plain", [("hi", 3)])[0]
    pl = doc_chunk_to_payload(c)
    assert pl["user_id"] == "u7" and pl["doc_id"] == "d4"
    assert pl["filename"] == "f.txt" and pl["page"] == 3
    assert set(DOCS_PAYLOAD_INDEXES) == {"user_id", "doc_id"}


class _DocsFake:
    """Fake Qdrant client for the user-documents collection."""

    def __init__(self):
        self.created = None
        self.indexes = []
        self.upserted = []
        self.deleted = []
        self.last_filter = None

    def get_collection(self, name):
        raise RuntimeError("missing")

    def create_collection(self, collection_name, vectors_config, sparse_vectors_config):
        assert "denso" in vectors_config and "sparso" in sparse_vectors_config
        assert vectors_config["denso"].size == 1024
        self.created = collection_name

    def create_payload_index(self, collection_name, field_name, field_schema):
        self.indexes.append(field_name)

    def upsert(self, collection_name, points):
        self.upserted.extend(points)

    def delete(self, collection_name, points_selector, wait):
        self.deleted.append((collection_name, points_selector))
        return True

    def query_points(self, collection_name, prefetch, query, limit, with_payload):
        self.last_filter = [p.filter for p in prefetch]
        pts = [SimpleNamespace(id="p1", score=0.9,
                               payload={"text": "t", "filename": "f.txt",
                                        "mime": "text/plain", "page": 2,
                                        "chunk_index": 0, "chunk_count": 1,
                                        "user_id": "u1", "doc_id": "d1"})]
        return SimpleNamespace(points=pts)


def test_ensure_creates_collection_with_indexes():
    client = _DocsFake()
    ensure_docs_collection(client)
    assert client.created == "user-documents"
    assert set(client.indexes) == {"user_id", "doc_id"}


def test_upsert_and_delete_scope_user():
    from qdrant_client import models

    client = _DocsFake()
    chunks = docs_mod.chunk_document("d5", "u1", "f.txt", "text/plain", [("hello", None)])
    n = upsert_doc_chunks(client, chunks, [[0.1] * 1024], [([1], [0.5])])
    assert n == 1 and len(client.upserted) == 1
    assert client.upserted[0].payload["user_id"] == "u1"
    delete_doc_points(client, "u1", "d5")
    sel = client.deleted[0][1]
    vals = {c.key: c.match.value for c in sel.filter.must}
    assert vals == {"user_id": "u1", "doc_id": "d5"}
    assert isinstance(sel, models.FilterSelector)


def test_search_filters_user_and_docs_inside_query():
    client = _DocsFake()
    hits = search_user_docs(client, [0.1], ([1], [0.5]), "u1", ["d1", "d2"])
    assert [p.id for p in hits.points] == ["p1"]
    for f in client.last_filter:
        assert f is not None
        keys = [getattr(c, "key", None) for c in f.must]
        assert "user_id" in keys  # never a post-filter


def test_is_summary_request():
    assert chat_mod.is_summary_request("Explain this case")
    assert chat_mod.is_summary_request("summarize my agreement please")
    assert chat_mod.is_summary_request("Describe the FIR")
    assert not chat_mod.is_summary_request("What is the punishment for murder?")
    assert not chat_mod.is_summary_request("explain the law on bail")


def test_build_statute_query_expands_and_truncates():
    q = "explain this case"
    expanded = chat_mod.build_statute_query(q, ["murder facts here"])
    assert expanded.startswith(q) and "murder facts here" in expanded
    assert chat_mod.build_statute_query(q, []) == q
    assert chat_mod.build_statute_query(q, [""]) == q
    long_facts = ["x" * 5000]
    assert len(chat_mod.build_statute_query(q, long_facts)) <= len(q) + 100 + chat_mod.STATUTE_QUERY_CHARS


def _statute_hit(act="The Penal Code, 1860"):
    return SimpleNamespace(id="s1", score=0.9, payload={"act_title": act})


def test_retrieve_grounded_two_stage(monkeypatch):
    calls = {}

    def fake_docs(question, user_id, doc_ids, limit=4):
        calls["docs"] = (question, user_id, tuple(doc_ids), limit)
        return SimpleNamespace(points=[
            SimpleNamespace(id="d1", score=0.9,
                            payload={"text": "murder trial facts", "filename": "f.txt"})])

    def fake_retrieve(question, language=None, act_year=None, limit=8,
                      section_label=None, search_text=None):
        calls["statute"] = search_text
        return SimpleNamespace(points=[_statute_hit()])

    monkeypatch.setattr(chat_mod, "retrieve_docs", fake_docs)
    monkeypatch.setattr(chat_mod, "retrieve", fake_retrieve)
    hits, doc_hits, query = chat_mod.retrieve_grounded(
        "explain this case", user_id="u1", doc_ids=["d1"])
    assert calls["docs"][:3] == ("explain this case", "u1", ("d1",))
    assert calls["docs"][3] == chat_mod.SUMMARY_DOC_LIMIT  # summary pulls the file
    assert "murder trial facts" in calls["statute"]
    assert query == calls["statute"]
    assert [p.id for p in hits.points] == ["s1"]
    assert doc_hits is not None


def test_retrieve_grounded_no_docs_uses_question(monkeypatch):
    seen = {}

    def fake_retrieve(question, language=None, act_year=None, limit=8,
                      section_label=None, search_text=None):
        seen["search_text"] = search_text
        return SimpleNamespace(points=[])

    monkeypatch.setattr(chat_mod, "retrieve", fake_retrieve)
    hits, doc_hits, query = chat_mod.retrieve_grounded("bail rules?")
    assert query == "bail rules?"
    assert seen["search_text"] == "bail rules?"
    assert doc_hits is None


def test_retrieve_grounded_doc_failure_still_answers(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("qdrant down")

    def fake_retrieve(question, language=None, act_year=None, limit=8,
                      section_label=None, search_text=None):
        return SimpleNamespace(points=[_statute_hit()])

    monkeypatch.setattr(chat_mod, "retrieve_docs", boom)
    monkeypatch.setattr(chat_mod, "retrieve", fake_retrieve)
    hits, doc_hits, query = chat_mod.retrieve_grounded(
        "explain this case", user_id="u1", doc_ids=["d1"])
    assert query == "explain this case"  # falls back to the raw question
    assert doc_hits is None and [p.id for p in hits.points] == ["s1"]


def test_doc_evidence_numbering():
    hits = SimpleNamespace(points=[
        SimpleNamespace(id="a", score=0.9, payload={"text": "t1", "filename": "f.txt", "page": 1}),
        SimpleNamespace(id="b", score=0.8, payload={"text": "t2", "filename": "f.txt", "page": None}),
    ])
    evidence, cites = _doc_evidence_block(hits, start=1)
    assert "[D1] f.txt, page 1" in evidence and "[D2] f.txt\n" in evidence
    assert [c.ref for c in cites] == [1, 2]
    assert all(c.kind == "document" for c in cites)
    assert cites[0].doc_filename == "f.txt" and cites[0].doc_page == 1
