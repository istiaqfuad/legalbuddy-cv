"""User-uploaded documents: parse, chunk, and shape for embedding.

Pipeline mirrors statute ingestion on purpose (same ~1500-char windows with
200-char overlap, same Voyage-4 dense + BM25 sparse encoders, same hybrid
queries) so one retrieval shape serves both corpora. The differences are
deliberate:

1. **Parsing is format-specific.** pypdf for PDFs (fast, BSD-licensed, good
   on text PDFs), python-docx for Word, plain decode for txt/md. Heavy
   layout parsers (Docling/Marker, 50-100x slower) and AGPL PyMuPDF are
   out of scope: uploads here are contracts, FIRs, and letters, not
   scanned books. Image-only PDFs fail loudly instead of indexing nothing.
2. **No legal sections.** User docs have no provision structure, so chunks
   split on paragraph boundaries first, greedy-merged to statute-sized
   windows, with the same overlap fallback for unsplittable text.
3. **Self-contained provenance headers.** Like statute chunks, every chunk
   carries filename + page + part number, because retrieval returns chunks
   without their document and the generator must cite them precisely.
4. **Hard isolation fields.** Every chunk carries ``user_id`` and ``doc_id``;
   retrieval filters both server-side, so one user's uploads can never leak
   into another user's answer.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass

from legalbuddy.chunking import (
    OVERLAP_CHARS,
    TARGET_CHARS,
    _slice_overlap,
    normalize_text,
)

MAX_DOC_BYTES = 10 * 1024 * 1024  # uploads larger than this are rejected
MAX_DOC_CHUNKS = 200  # per-document cap: bounds Voyage spend on huge files

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md"}
EXTENSION_MIME = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
}


@dataclass
class DocChunk:
    """One retrievable, citable unit of a user-uploaded document."""

    text: str
    chunk_id: str
    doc_id: str
    user_id: str
    filename: str
    mime: str
    page: int | None
    chunk_index: int
    chunk_count: int


def new_doc_id() -> str:
    """Random document id (uploads are content-addressed nowhere)."""
    return uuid.uuid4().hex


def stable_doc_chunk_id(doc_id: str, index: int) -> str:
    """Deterministic point ids so re-uploads of one doc are idempotent."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"userdoc#{doc_id}#{index}"))


def _parse_pdf(data: bytes) -> list[tuple[str, int | None]]:
    from pypdf import PdfReader

    reader = PdfReader(__import__("io").BytesIO(data))
    segments = []
    for i, pdf_page in enumerate(reader.pages, start=1):
        try:
            text = pdf_page.extract_text() or ""
        except Exception:
            text = ""
        if text.strip():
            segments.append((text, i))
    if not segments:
        raise ValueError(
            "This PDF has no selectable text (it may be scanned images). "
            "Export or scan it to a text-based PDF first.")
    return segments


def _parse_docx(data: bytes) -> list[tuple[str, int | None]]:
    import docx

    doc = docx.Document(__import__("io").BytesIO(data))
    text = "\n\n".join(p.text for p in doc.paragraphs if p.text and p.text.strip())
    tables = []
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text and c.text.strip()]
            if cells:
                tables.append(" | ".join(cells))
    if tables:
        text += "\n\n" + "\n".join(tables)
    if not text.strip():
        raise ValueError("This Word file has no readable text.")
    return [(text, None)]


def _parse_text(data: bytes) -> list[tuple[str, int | None]]:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    if not text.strip():
        raise ValueError("This file has no readable text.")
    return [(text, None)]


def parse_document(filename: str, data: bytes) -> list[tuple[str, int | None]]:
    """Extract ``(text, page)`` segments. ``page`` is None when N/A.

    Raises ``ValueError`` with a user-safe message for unsupported types,
    oversize files, and textless documents.
    """
    if len(data) > MAX_DOC_BYTES:
        raise ValueError(
            f"Files must be under {MAX_DOC_BYTES // (1024 * 1024)} MB.")
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError("Supported files: PDF, Word (.docx), text, and Markdown.")
    if ext == ".pdf":
        return _parse_pdf(data)
    if ext == ".docx":
        return _parse_docx(data)
    return _parse_text(data)


def _merge_paragraphs(paragraphs: list[str]) -> list[str]:
    """Greedy-merge paragraphs to TARGET_CHARS; hard-slice the rest."""
    units: list[str] = []
    for para in paragraphs:
        if len(para) > TARGET_CHARS:
            units.extend(_slice_overlap(para))
        elif units and len(units[-1]) + 1 + len(para) <= TARGET_CHARS:
            units[-1] = units[-1] + "\n" + para
        else:
            units.append(para)
    merged: list[str] = []
    for unit in units:
        if merged and len(unit) < OVERLAP_CHARS:
            merged[-1] = merged[-1] + "\n" + unit
        else:
            merged.append(unit)
    return [u for u in merged if u]


def chunk_document(doc_id: str, user_id: str, filename: str, mime: str,
                   segments: list[tuple[str, int | None]]) -> list[DocChunk]:
    """Chunk parsed segments into retrievable units with provenance headers."""
    bodies: list[tuple[str, int | None]] = []
    for text, page in segments:
        cleaned = normalize_text(text)
        if not cleaned:
            continue
        paragraphs = [p.strip() for p in cleaned.split("\n") if p.strip()]
        for body in _merge_paragraphs(paragraphs):
            bodies.append((body, page))
    bodies = bodies[:MAX_DOC_CHUNKS]
    count = len(bodies)
    chunks = []
    for idx, (body, page) in enumerate(bodies):
        header = f"Document: {filename}"
        if page is not None:
            header += f", page {page}"
        header += f" (part {idx + 1}/{count})"
        chunks.append(DocChunk(
            text=header + "\n" + body,
            chunk_id=stable_doc_chunk_id(doc_id, idx),
            doc_id=doc_id,
            user_id=user_id,
            filename=filename,
            mime=mime,
            page=page,
            chunk_index=idx,
            chunk_count=count,
        ))
    return chunks
