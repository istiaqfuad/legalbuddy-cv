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

# Pages with less extractable text than this are considered textless
# (scans, photos, figures) and routed to vision transcription.
VISION_MIN_CHARS = 50
# Cap on vision-transcribed pages per upload: bounds Spark token spend.
MAX_VISION_PAGES = 20
# Batch size for vision calls (Muse Spark Open: max 8 images/request).
VISION_BATCH = 8
VISION_DPI = 150

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
    # Where the text came from: "text" (parser), "table" (structure
    # extraction), or "vision" (VLM transcription of a textless page).
    origin: str = "text"


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


def textless_page_numbers(segments: list[tuple[str, int | None]]) -> list[int]:
    """1-based page numbers whose extracted text is too thin to index."""
    return [page for _text, page in segments
            if page is not None and len((_text or "").strip()) < VISION_MIN_CHARS]


def tables_to_markdown(table: list[list[str | None]]) -> str:
    """Render an extracted table as a Markdown table (empty cells blank)."""
    rows = [[(c or "").strip() for c in row] for row in table]
    rows = [r for r in rows if any(r)]
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    head, *body = rows
    lines = ["| " + " | ".join(head) + " |",
             "| " + " | ".join("---" for _ in head) + " |"]
    lines += ["| " + " | ".join(r) + " |" for r in body]
    return "\n".join(lines)


def extract_page_tables(pdf_data: bytes) -> dict[int, str]:
    """Extract tables per 1-based page number as Markdown (pdfplumber).

    pypdf merges table cells into running text; explicit table extraction
    preserves the structure lawyers actually read. Returns {} on any
    failure — tables are enrichment, never fatal.
    """
    import pdfplumber

    out: dict[int, str] = {}
    try:
        with pdfplumber.open(__import__("io").BytesIO(pdf_data)) as pdf:
            for i, page in enumerate(pdf.pages, start=1):
                try:
                    tables = page.extract_tables() or []
                except Exception:
                    continue
                md = "\n\n".join(t for t in
                                 (tables_to_markdown(t) for t in tables) if t)
                if md:
                    out[i] = md
    except Exception:
        return {}
    return out


def render_pages(pdf_data: bytes, pages: list[int],
                 dpi: int = VISION_DPI) -> dict[int, bytes]:
    """Render 1-based PDF pages to PNG bytes (pypdfium2, liberal license)."""
    import pypdfium2 as pdfium

    out: dict[int, bytes] = {}
    doc = pdfium.PdfDocument(__import__("io").BytesIO(pdf_data))
    try:
        for num in pages:
            if num < 1 or num > len(doc):
                continue
            bitmap = doc[num - 1].render(scale=dpi / 72)
            pil = bitmap.to_pil()
            buf = __import__("io").BytesIO()
            pil.save(buf, format="PNG")
            out[num] = buf.getvalue()
    finally:
        doc.close()
    return out


def transcribe_images(images: list[bytes]) -> list[str]:
    """Transcribe page PNGs to Markdown via Muse Spark Open vision.

    One call handles up to VISION_BATCH images; longer lists are batched.
    Raises on API failure — callers treat vision as enrichment and catch.
    """
    import base64

    from openai import OpenAI

    from legalbuddy.chat import BASE_URL, CHAT_MODEL

    client = OpenAI(base_url=BASE_URL, api_key=os.environ["BASETEN_API_KEY"])
    out: list[str] = []
    for i in range(0, len(images), VISION_BATCH):
        batch = images[i:i + VISION_BATCH]
        content: list[dict] = [{
            "type": "text",
            "text": ("Transcribe each attached page image to Markdown, in order. "
                      "Preserve headings and tables as Markdown tables. Briefly "
                      "describe charts or figures in one line each. Ignore stamps, "
                      "page numbers, and decorative borders. Separator between "
                      "pages: a line containing only ---."),
        }]
        content += [{
            "type": "image_url",
            "image_url": {"url": "data:image/png;base64," + base64.b64encode(img).decode()},
        } for img in batch]
        resp = client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[{"role": "user", "content": content}],
        )
        text = (resp.choices[0].message.content or "").strip()
        parts = [p.strip() for p in text.split("\n---\n") if p.strip()]
        out.extend(parts if len(parts) == len(batch) else [text] * len(batch))
    return out


def chunk_document(doc_id: str, user_id: str, filename: str, mime: str,
                   segments: list[tuple[str, int | None]],
                   tables: dict[int, str] | None = None,
                   vision_texts: dict[int, str] | None = None) -> list[DocChunk]:
    """Chunk parsed segments into retrievable units with provenance headers.

    ``tables`` maps 1-based page numbers to Markdown tables, merged after
    that page's text. ``vision_texts`` maps textless page numbers to VLM
    transcriptions, which replace the thin parser text and are marked
    "(visually read)" in the header.
    """
    tables = tables or {}
    vision_texts = vision_texts or {}
    # (body, page, origin) triples before the chunk cap.
    bodies: list[tuple[str, int | None, str]] = []
    for text, page in segments:
        cleaned = normalize_text(text)
        if page is not None and page in vision_texts:
            cleaned = normalize_text(vision_texts[page])
            origin = "vision"
        else:
            origin = "text"
        if not cleaned:
            continue
        if page is not None and page in tables and origin == "text":
            cleaned = cleaned + "\n\nTables on this page:\n" + tables[page]
            origin = "table"
        paragraphs = [p.strip() for p in cleaned.split("\n") if p.strip()]
        for body in _merge_paragraphs(paragraphs):
            bodies.append((body, page, origin))
    bodies = bodies[:MAX_DOC_CHUNKS]
    count = len(bodies)
    chunks = []
    for idx, (body, page, origin) in enumerate(bodies):
        header = f"Document: {filename}"
        if page is not None:
            header += f", page {page}"
        if origin == "vision":
            header += " (visually read)"
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
            origin=origin,
        ))
    return chunks
