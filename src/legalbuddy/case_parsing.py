"""Case-study PDF parsing: triage, clean, structure-aware chunk, payload.

Pipeline for the judgment PDFs in ``data/cases`` (~8,493 files, ~1.8 GB;
procedure and benchmarks in ``docs/case-studies-pipeline.md``). Research
backed choices:

1. **Triage per page, then route.** Digital-born pages carry full text;
   scanned pages carry ~0 chars plus embedded JPEGs; a third class renders
   text whose Bangla glyphs are fragmented (``আইেন মানা`` for ``আইন মানা`` —
   raw extraction corrupts ligatures, so the text must be re-read from
   pixels, never trusted as-is). Routes: ``digital`` (parse + clean),
   ``scanned_image`` (OCR), ``bangla_needs_ocr`` (vision OCR).
2. **Clean, don't collapse.** Unlike ``chunking.normalize_text`` (which
   flattens everything to one line for short provisions), judgments need
   paragraph structure: single newlines inside a paragraph fold to spaces,
   blank-line paragraph breaks survive, hyphenated line wraps rejoin,
   ``Page # N`` footers and lone page numbers drop. NFKC first — it
   recomposes decomposed Bangla.
3. **Sections are the chunk unit.** Judgments subdivide into head-note /
   appearances / numbered reasoning paragraphs / order. Splits happen on
   heading lines and numbered-paragraph boundaries, never mid-sentence;
   chunks stay inside their section and each carries the section title, so
   a retrieved chunk is citable without its parent judgment.
4. **Case-sized windows.** Judgment paragraphs run longer than statute
   provisions: target ~2800 chars (~700 tokens), hard max ~3600 chars,
   ~320-char (~80-token, ~10-20%) overlap seeding from the previous
   window's tail. Over-long sections greedy-merge whole paragraphs;
   hard slices are the fallback.
5. **Deterministic IDs + case payload.** Chunk IDs are UUID5 of
   ``case#source_file#section#part`` (idempotent re-ingest, separate
   namespace from statutes and user docs). Every chunk carries the
   indexed case fields (``case_type``, ``court``, ``case_number``,
   ``language``, ``source_file``) plus display provenance.
6. **Lazy OCR backends.** Surya, Muse Glimmer (transformers), and
   Tesseract are notebook/GPU-side tools, imported inside their functions
   so this module — and its tests — need nothing beyond the standard
   library plus ``legalbuddy.chunking`` / ``legalbuddy.documents``.
"""

from __future__ import annotations

import itertools
import re
import unicodedata
import uuid
from dataclasses import dataclass, field

from legalbuddy.chunking import normalize_text

CASE_CHUNKER_VERSION = "1"  # bump when chunk text/shape changes (forces re-ingest)

# Pages with less extractable text than this are textless (scans, photos).
PAGE_MIN_CHARS = 200
# Judgment windows: ~700-token target, ~900-token max, ~80-token overlap.
CASE_TARGET_CHARS = 2800
CASE_MAX_CHARS = 3600
CASE_OVERLAP_CHARS = 320

ROUTE_DIGITAL = "digital"
ROUTE_SCANNED = "scanned_image"
ROUTE_BANGLA_OCR = "bangla_needs_ocr"

_BN_START, _BN_END = "\u0980", "\u09ff"
# Dependent vowel signs / hasant: never valid as standalone tokens.
_BN_ISOLATE = re.compile(r"(?<!\S)[\u09be-\u09cd\u09d0-\u09ff](?!\S)")
# Footer forms seen in the corpus: "Page # 2", "Page 2", lone "2".
_PAGE_FOOTER = re.compile(r"(?im)^\s*page\s*#?\s*\d+\s*$")
_LONE_NUMBER = re.compile(r"(?m)^\s*\d{1,4}\s*$")
# Hyphenated wrap: "Manage-\nment" (Latin letters/digits only, never Bangla).
_HYPHEN_WRAP = re.compile(r"([A-Za-z0-9])-\n([A-Za-z0-9])")
# Judgment heading lines: "Present:", "…Versus…", "Heard and Judgment on …".
_HEADING = re.compile(
    r"^\s*(?:present\s*:|in\s+the\s+matter\s+of|versus\b|-?versus-|vs\.?|"
    r"heard(?:\s+and\s+judgment)?\s+on|judgment\s+on|judgment|order|"
    r"head-?note|held\b|background|facts|issues?|reasoning|decision|"
    r"appearances?|for\s+the\s+(?:petitioner|appellant|respondent|state))",
    re.IGNORECASE,
)
# Numbered reasoning paragraphs: "1. ...", "12. ...".
_NUMBERED_PARA = re.compile(r"^\s*\d{1,3}\.\s+\S")
# Case references: "Civil Revision No. 1359 of 2002", "Death Reference No. …".
_CASE_NO = re.compile(
    r"\b((?:Civil Revision|Criminal Revision|Criminal Appeal|Civil Appeal|"
    r"Death Reference|Writ Petition|First Appeal|Miscellaneous Case|"
    r"Jail Appeal|C\.?\s*R\.?)[\w\s./-]*?No\.?\s*[\w/\-\s]+?of\s*\d{4})",
    re.IGNORECASE,
)
_COURT_DIVISION = re.compile(
    r"(High Court Division[^\n]*|Appellate Division[^\n]*)",
    re.IGNORECASE,
)
_COURT_TOP = re.compile(r"(Supreme Court of Bangladesh[^\n]*)", re.IGNORECASE)
_DECISION_DATE = re.compile(
    r"(?:Heard and Judgment on|judgment on|Decided on|Dated)\s*[:.]?\s*"
    r"(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})",
    re.IGNORECASE,
)


@dataclass
class CaseChunk:
    """One retrievable, citable unit of a case-study judgment."""

    text: str
    chunk_id: str
    case_id: str
    source_file: str
    file_hash: str
    chunk_index: int
    chunk_count: int
    char_start: int
    char_end: int
    page_start: int | None
    page_end: int | None
    chunk_type: str  # headnote | reasoning | order | general
    section_title: str
    section_path: str
    section_index: int
    part_index: int
    part_count: int
    court: str = ""
    case_number: str = ""
    case_type: str = ""
    case_year: str = ""
    parties: str = ""
    disposition: str = ""
    acts_cited: list[str] = field(default_factory=list)
    cases_cited: list[str] = field(default_factory=list)
    language: str = "unknown"
    origin: str = "text"  # text (parser) | ocr (pixel OCR) | vision (VLM)
    chunker_version: str = CASE_CHUNKER_VERSION


def stable_case_chunk_id(source_file: str, section_index: int, part_index: int) -> str:
    """Deterministic point IDs so re-ingestion overwrites, never duplicates."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"case#{source_file}#{section_index}#{part_index}"))


def bangla_ratio(text: str) -> float:
    """Fraction of characters in the Bengali block (script detection)."""
    if not text:
        return 0.0
    bn = sum(1 for ch in text if _BN_START <= ch <= _BN_END)
    return bn / len(text)


def detect_language(text: str) -> str:
    """``bn`` / ``en`` / ``mixed`` from Bengali-script share.

    The 0.6 bar keeps English-dominant judgments with Bangla phrases
    (``Section 302 দণ্ডবিধি``) in ``mixed``; only Bangla-dominant text
    counts as ``bn``.
    """
    ratio = bangla_ratio(text or "")
    if ratio >= 0.6:
        return "bn"
    if ratio > 0.0:
        return "mixed"
    return "en"


def _short_bn_token_fraction(text: str) -> float:
    """Share of Bengali tokens that are stubs (<= 2 code points).

    Healthy Bangla words run 3+ code points (``আইন``, ``মানা``); the
    word-export corruption shatters them into 1-2 char debris (``িশ``,
    ``উ``, ``য়ন``, ``ক``). A page dominated by stubs is not indexable.
    """
    toks = re.findall(r"[\u0980-\u09ff]+", text or "")
    if len(toks) < 4:
        return 0.0
    short = sum(1 for t in toks if len(t) <= 2)
    return short / len(toks)


def is_broken_bangla(text: str) -> bool:
    """True when extracted Bangla glyphs are fragmented (needs pixel OCR).

    Word-export PDFs emit Bangla with broken ligatures that read as
    isolated vowel signs (``ি`` standing alone) or stub-debris runs
    (``িশ উ য়ন ক``). Both are reliable markers that the parser text must
    not be indexed — the page has to be re-read from rendered pixels.
    """
    if not re.search(r"[\u0980-\u09ff]", text or ""):
        return False
    if len(_BN_ISOLATE.findall(text)) >= 3:
        return True
    return _short_bn_token_fraction(text) >= 0.6


def classify_page(text: str, has_images: bool, page_min_chars: int = PAGE_MIN_CHARS) -> str:
    """Route one page: ``digital`` | ``scanned_image`` | ``bangla_needs_ocr``.

    Thin text plus embedded images means a scan; present-but-fragmented
    Bangla means a word-export with broken glyphs (re-read from pixels);
    anything else is safe for text extraction plus cleaning.
    """
    n_chars = len((text or "").strip())
    if n_chars < page_min_chars and has_images:
        return ROUTE_SCANNED
    if is_broken_bangla(text or ""):
        return ROUTE_BANGLA_OCR
    if n_chars < page_min_chars:
        return ROUTE_SCANNED
    return ROUTE_DIGITAL


def triage_segments(
    segments: list[tuple[str, int | None]], image_pages: set[int] | None = None
) -> dict:
    """Route every parsed ``(text, page)`` segment; summarize the file.

    ``image_pages`` holds 1-based page numbers known (via ``pdfimages``-style
    listing) to carry embedded images. Returns per-page routes plus the
    worst route overall (``scanned_image`` > ``bangla_needs_ocr`` >
    ``digital``), which decides the file's OCR path.
    """
    image_pages = image_pages or set()
    order = [ROUTE_SCANNED, ROUTE_BANGLA_OCR, ROUTE_DIGITAL]
    pages: list[dict] = []
    for text, page in segments:
        route = classify_page(text, page in image_pages)
        pages.append({"page": page, "route": route, "chars": len((text or "").strip())})
    worst = ROUTE_DIGITAL
    for entry in pages:
        if order.index(entry["route"]) < order.index(worst):
            worst = entry["route"]
    return {"pages": pages, "worst_route": worst}


def clean_case_text(text: str) -> str:
    """Repair noisy-but-parsable judgment text, keeping paragraph structure.

    NFKC (recomposes decomposed Bangla), hyphen-wrap joins, single
    newlines inside a paragraph fold to spaces while blank-line paragraph
    breaks survive, ``Page # N`` footers and lone page numbers drop, and
    3+ newline runs collapse. Mirrors the notebook ``clean_case_text``.
    """
    cleaned = unicodedata.normalize("NFKC", text or "")
    cleaned = _HYPHEN_WRAP.sub(r"\1\2", cleaned)
    cleaned = _PAGE_FOOTER.sub("", cleaned)
    cleaned = _LONE_NUMBER.sub("", cleaned)
    cleaned = re.sub(r"(?<!\n)\n(?!\n)", " ", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def split_case_sections(cleaned: str) -> list[tuple[str | None, str]]:
    """Split cleaned judgment text into ``(title, body)`` sections.

    A new section starts at a heading line (Present/Versus/Heard-on/…) or
    a numbered reasoning paragraph. Preamble text before the first heading
    gets title ``None``. Every returned body is non-empty.
    """
    sections: list[tuple[str | None, list[str]]] = []
    current_title: str | None = None
    current: list[str] = []
    for para in (p.strip() for p in cleaned.split("\n\n")):
        if not para:
            continue
        first_line = para.split("\n", 1)[0]
        if _HEADING.match(first_line) or _NUMBERED_PARA.match(first_line):
            if current:
                sections.append((current_title, current))
            current_title = first_line.strip()[:160]
            current = [para]
        else:
            current.append(para)
    if current:
        sections.append((current_title, current))
    return [(title, "\n\n".join(body)) for title, body in sections if "\n\n".join(body).strip()]


def _slice_case_overlap(text: str) -> list[str]:
    """Fixed-size fallback slicer with overlap for unsplittable sections."""
    out, start = [], 0
    while start < len(text):
        end = min(start + CASE_TARGET_CHARS, len(text))
        piece = text[start:end].strip()
        if piece:
            out.append(piece)
        if end >= len(text):
            break
        start = max(0, end - CASE_OVERLAP_CHARS)
    return out


def split_long_section(body: str) -> list[str]:
    """Split an over-long section, preferring paragraph boundaries.

    Greedy-merge whole paragraphs up to the target window; hard-slice
    oversized paragraphs; merge tiny dangling tails. Each continuation
    window is seeded with the previous window's tail so a holding split
    across a boundary is still retrievable whole from either side.
    """
    paras = [p.strip() for p in body.split("\n\n") if p.strip()]
    units: list[str] = []
    for para in paras:
        if len(para) > CASE_TARGET_CHARS:
            units.extend(_slice_case_overlap(para))
        elif units and len(units[-1]) + 2 + len(para) <= CASE_TARGET_CHARS:
            units[-1] = units[-1] + "\n\n" + para
        else:
            units.append(para)
    merged: list[str] = []
    for unit in units:
        if merged and len(unit) < CASE_OVERLAP_CHARS:
            merged[-1] = merged[-1] + "\n\n" + unit
        else:
            merged.append(unit)
    merged = [u for u in merged if u]
    if len(merged) <= 1:
        return merged
    out = [merged[0]]
    for prev, cur in itertools.pairwise(merged):
        tail = prev.split("\n\n")[-1].strip()
        if len(tail) > CASE_OVERLAP_CHARS:
            tail = tail[-CASE_OVERLAP_CHARS:]
        out.append(tail + "\n\n" + cur if tail not in cur else cur)
    return out


def chunk_type_for(title: str | None, index: int) -> str:
    """Classify a section: headnote (early appearances) vs order (tail)."""
    lowered = (title or "").lower()
    if index == 0 or "present" in lowered or "versus" in lowered:
        return "headnote"
    if any(k in lowered for k in ("judgment on", "decided", "order", "disposed")):
        return "order"
    if _NUMBERED_PARA.match(title or "") or "heard" in lowered:
        return "reasoning"
    return "reasoning" if index > 0 else "general"


def build_case_header(
    case_title: str,
    case_number: str,
    court: str,
    section_title: str | None,
    part_index: int,
    part_count: int,
) -> str:
    """Self-contained provenance header prepended to every chunk."""
    header = case_title or "Untitled case"
    if case_number:
        header += f", {case_number}"
    if court:
        header += f" — {court.splitlines()[0].strip()}"
    if section_title:
        header += f" [{section_title}]"
    header += f" (part {part_index + 1}/{part_count})"
    return header


def extract_case_metadata(text: str) -> dict:
    """Best-effort header structuring from judgment front matter.

    Regex only — deep structuring (facts, issues, holdings, citations)
    runs through Muse Glimmer on the GPU notebook, which reads the page
    images. Empty strings mean "not found", never a guess.
    """
    sample = (text or "")[:6000]
    number = ""
    m = _CASE_NO.search(sample)
    if m:
        number = re.sub(r"\s+", " ", m.group(1)).strip()
    court = ""
    # Prefer the deciding division ("High Court Division") over the bare
    # apex name ("Supreme Court of Bangladesh"), which heads every page.
    m = _COURT_DIVISION.search(sample) or _COURT_TOP.search(sample)
    if m:
        court = re.sub(r"\s+", " ", m.group(1)).strip()
    date = ""
    m = _DECISION_DATE.search(sample)
    if m:
        date = m.group(1)
    parties = ""
    lines = [ln.strip() for ln in sample.splitlines() if ln.strip()]
    for i, line in enumerate(lines):
        if re.fullmatch(r"—?\s*versus\s*—?", line, re.IGNORECASE):
            before = lines[i - 1] if i > 0 else ""
            after = lines[i + 1] if i + 1 < len(lines) else ""
            parties = f"{before} vs {after}".strip()
            break
    year = ""
    m = re.search(r"\bof\s*(\d{4})\s*$", number)
    if m:
        year = m.group(1)
    return {
        "case_number": number,
        "court": court,
        "decision_date": date,
        "parties": parties,
        "case_year": year,
        "case_type": number.split(" No.")[0].strip() if " No." in number else "",
    }


def chunk_case_document(
    case_id: str,
    source_file: str,
    file_hash: str,
    segments: list[tuple[str, int | None]],
    case_title: str = "",
    metadata: dict | None = None,
    origin: str = "text",
) -> list[CaseChunk]:
    """Chunk parsed ``(text, page)`` segments into citable case units.

    Segments are cleaned per page (page spans stay exact), split into
    titled sections, then windowed. ``metadata`` (from
    :func:`extract_case_metadata` or the Glimmer structuring pass) fills
    the payload fields; ``origin`` marks parser text vs pixel OCR.
    """
    metadata = metadata or {}
    cleaned_pages: list[tuple[str, int | None]] = []
    for text, page in segments:
        cleaned = clean_case_text(text)
        if cleaned:
            cleaned_pages.append((cleaned, page))
    if not cleaned_pages:
        return []
    offset = 0
    page_spans: list[tuple[int, int, int | None]] = []  # start, end, page
    joined = []
    for cleaned, page in cleaned_pages:
        joined.append(cleaned)
        page_spans.append((offset, offset + len(cleaned), page))
        offset += len(cleaned) + 2
    full = "\n\n".join(joined)

    chunks: list[CaseChunk] = []
    for sec_idx, (title, body) in enumerate(split_case_sections(full)):
        bodies = [body] if len(body) <= CASE_MAX_CHARS else split_long_section(body)
        chunk_type = chunk_type_for(title, sec_idx)
        path = title or f"Section {sec_idx + 1}"
        part_count = len(bodies)
        for part_idx, piece in enumerate(bodies):
            start = max(full.find(piece[:60]), 0)
            end = start + len(piece)
            pages = [p for s, e, p in page_spans if p is not None and s < end and e > start]
            header = build_case_header(
                case_title or source_file,
                metadata.get("case_number", ""),
                metadata.get("court", ""),
                title,
                part_idx,
                part_count,
            )
            idx = len(chunks)
            chunks.append(
                CaseChunk(
                    text=header + "\n" + piece,
                    chunk_id=stable_case_chunk_id(source_file, sec_idx, part_idx),
                    case_id=case_id,
                    source_file=source_file,
                    file_hash=file_hash,
                    chunk_index=idx,
                    chunk_count=0,  # fixed up below
                    char_start=start,
                    char_end=end,
                    page_start=min(pages) if pages else None,
                    page_end=max(pages) if pages else None,
                    chunk_type=chunk_type,
                    section_title=title or "",
                    section_path=path,
                    section_index=sec_idx,
                    part_index=part_idx,
                    part_count=part_count,
                    court=metadata.get("court", ""),
                    case_number=metadata.get("case_number", ""),
                    case_type=metadata.get("case_type", ""),
                    case_year=metadata.get("case_year", ""),
                    parties=metadata.get("parties", ""),
                    disposition=metadata.get("disposition", ""),
                    acts_cited=list(metadata.get("acts_cited", []) or []),
                    cases_cited=list(metadata.get("cases_cited", []) or []),
                    language=detect_language(piece),
                    origin=origin,
                )
            )
    for idx, chunk in enumerate(chunks):
        chunk.chunk_index = idx
        chunk.chunk_count = len(chunks)
    return chunks


# Payload fields that must carry an index on the case-studies collection.
CASE_PAYLOAD_INDEXES: dict[str, str] = {
    "case_type": "keyword",
    "court": "keyword",
    "case_number": "keyword",
    "case_year": "keyword",
    "language": "keyword",
    "source_file": "keyword",
}


def case_chunk_to_payload(chunk: CaseChunk) -> dict:
    """Payload for a case-study point: indexed filters plus provenance."""
    return {
        # Indexed (keyword) — exact-match filters incl. case-type routing.
        "case_type": chunk.case_type,
        "court": chunk.court,
        "case_number": chunk.case_number,
        "case_year": chunk.case_year,
        "language": chunk.language,
        "source_file": chunk.source_file,
        # Unindexed provenance / display fields.
        "text": chunk.text,
        "case_id": chunk.case_id,
        "file_hash": chunk.file_hash,
        "chunk_index": chunk.chunk_index,
        "chunk_count": chunk.chunk_count,
        "char_start": chunk.char_start,
        "char_end": chunk.char_end,
        "page_start": chunk.page_start,
        "page_end": chunk.page_end,
        "chunk_type": chunk.chunk_type,
        "section_title": chunk.section_title,
        "section_path": chunk.section_path,
        "parties": chunk.parties,
        "disposition": chunk.disposition,
        "acts_cited": list(chunk.acts_cited),
        "cases_cited": list(chunk.cases_cited),
        "origin": chunk.origin,
        "chunker_version": chunk.chunker_version,
    }


def ocr_pages_with_surya(images: list, backend: str | None = None) -> list[str]:
    """Page OCR via Surya 0.23 (lazy import; manager-injected backend).

    Surya 0.23 is VLM-based: ``backend`` is ``"vllm"`` (NVIDIA GPU, needs
    Docker in sandboxes) or ``"llamacpp"`` (CPU). Returns one string per
    image, in input order. Language is auto-detected per page.
    """
    from surya.recognition import RecognitionPredictor, SuryaInferenceManager

    predictor = RecognitionPredictor(SuryaInferenceManager(method=backend))
    out = []
    for page in predictor(images):
        texts = []
        for block in page.blocks or []:
            for line in block.lines or []:
                if getattr(line, "text", ""):
                    texts.append(line.text)
        out.append("\n".join(texts))
    return out


def transcribe_pngs_with_glimmer(
    images: list[bytes],
    prompt: str,
    model_id: str = "meta-models/Muse-Glimmer-30B",
    max_new_tokens: int = 1024,
) -> list[str]:
    """Transcribe/structure page PNGs with Meta's Muse Glimmer (lazy import).

    Glimmer is an image-text-to-text model, so one 30B Meta model covers
    OCR, header structuring, and judge-scoring for the hackathon story.
    Needs a ~24 GB+ GPU (bf16) or 4-bit offload; runs notebook-side.
    """
    import base64

    import torch
    from transformers import AutoModelForMultimodalLM, AutoProcessor

    processor = AutoProcessor.from_pretrained(model_id)
    model = AutoModelForMultimodalLM.from_pretrained(
        model_id, dtype=torch.bfloat16, device_map="auto"
    )
    out = []
    for img in images:
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "url": "data:image/png;base64," + base64.b64encode(img).decode(),
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ]
        inputs = processor.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
        ).to(model.device)
        generated = model.generate(**inputs, max_new_tokens=max_new_tokens)
        decoded = processor.decode(generated[0][inputs["input_ids"].shape[-1] :])
        out.append(decoded.strip())
        del inputs, generated
    return out


def ocr_pages_with_tesseract(images, lang: str = "ben+eng") -> list[str]:
    """Cheap CPU baseline via Tesseract (lazy import; needs ben data).

    Accuracy lags Surya/Glimmer on Bangla legal pages — kept for
    benchmarking and for environments without a GPU.
    """
    import pytesseract

    return [pytesseract.image_to_string(img, lang=lang) for img in images]


def normalize_case_text(text: str) -> str:
    """Alias kept for callers migrating from statute-style normalizers."""
    return normalize_text(text)
