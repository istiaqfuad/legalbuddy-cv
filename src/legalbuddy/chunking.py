"""Structure-aware chunking for Bangladesh statute JSON (bdlaws.minlaw.gov.bd format).

Research-backed choices for this corpus (see PLAN.md section 5):

1. **Section = chunk unit.** The corpus is pre-segmented into numbered legal
   provisions. ~90% of 35,633 sections are <=1500 chars, so the natural
   section boundary is already a near-ideal chunk: semantically complete,
   citable, and small enough for a high-signal evidence pack. Arbitrary
   fixed-size windows would split provisions mid-sentence and destroy the
   section-level citability the product depends on.
2. **Self-contained header on every chunk.** Retrieval returns chunks without
   their parent Act, so each chunk carries "{Act title} ({No}, {Year})" plus
   the section label. Without this, "Section 5 says X" is meaningless to the
   generator and the citation UI.
3. **Split only the long tail, on subsection boundaries.** ~150 sections
   exceed 2000 chars (max ~46k). These split first on ``(1)``/``(a)``
   subsection markers, greedy-merged to ~1500-char windows, with overlapped
   hard slices only as fallback. Each child keeps the full header.
4. **Marker cleanup + footnote resolution.** Amendment markers like
   ``1[Bangladesh]`` are rewritten to the live term (``Bangladesh``) for
   embedding, while the marker number maps positionally to ``footnotes``
   and matched notes are appended under "Amendment notes". Dead provisions
   (``[Repealed by …]``, ``[Omitted by …]``) are dropped entirely: they are
   not live law and would answer questions with dead rules.
5. **Citation-ready payload.** Every chunk carries act title/No/year,
   section label + title, amendment notes, the cleaned section text, and
   ``source_url`` so answers can cite the exact section with a link.
6. **Repealed / empty acts skipped.** The 203 repealed acts carry zero
   sections; embedding empty text would pollute the index. Their
   ``is_repealed`` status stays queryable as a payload filter instead.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field

MAX_CHARS = 2000  # sections longer than this are split
TARGET_CHARS = 1500  # target size for split windows
OVERLAP_CHARS = 200  # overlap between consecutive split windows

# Subsection starts: "(1)", "(2)", "(a)", "(b)" — the natural sub-unit split.
_SUBSECTION_SPLIT = re.compile(r"(?=(?:\(\d+\)|\([a-zA-Z]+\)))")
# Dead provisions: "[Repealed by ...]", "[Omitted by ...]" carry no live law.
_VOID_SECTION = re.compile(
    r"\[\s*(Omitted|Repealed?|Rep\.)\s+by"
    r"|\[\s*Repeal\.\-"
    r"|\[\s*Omit\.\-",
    re.IGNORECASE,
)
# Amendment markers like 1[Bangladesh], 3[Factories Act, 1965].
_MARKER = re.compile(r"(?<!\d)(\d+)\[")
# Leading provision number: "5. (1)...", "৩। ..." (dari U+0964), "12A. ..."
_LEAD_NUM = re.compile(r"^\s*([0-9\u09e6-\u09ef]+[A-Za-z]?)\s*[.\-:\u0964]")


@dataclass
class StatuteChunk:
    """One retrievable, citable unit of statute text."""

    text: str
    chunk_id: str
    act_title: str
    act_no: str
    act_year: str
    language: str
    is_repealed: bool
    section_index: int
    section_label: str
    section_title: str
    part_index: int
    part_count: int
    footnotes: list[str] = field(default_factory=list)
    source_url: str = ""
    source_file: str = ""


def stable_chunk_id(source_file: str, section_index: int, part_index: int) -> str:
    """Deterministic point IDs so ingestion is idempotent (re-upsert safe)."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{source_file}#{section_index}#{part_index}"))


def extract_section_label(content: str) -> str:
    """Pull the leading provision number ("5", "৩") used in citations."""
    m = _LEAD_NUM.match(content or "")
    return m.group(1) if m else ""


def clean_markers(content: str) -> str:
    """Rewrite amendment markers ``1[Bangladesh]`` as plain ``Bangladesh``.

    The bracketed term is the live law; the leading number is a footnote
    pointer whose meaning is preserved separately in "Amendment notes".
    Cleaned text embeds and reads far better for both dense and BM25
    retrieval, which treat ``1[Bangladesh]`` as noise.
    """
    return re.sub(r"\d+\[(.*?)\]", r"\1", content)


def is_void_section(content: str) -> bool:
    """True for dead provisions (repealed/omitted) — not live law."""
    return bool(_VOID_SECTION.search(content or ""))


def resolve_footnotes(content: str, footnotes: list[dict]) -> list[str]:
    """Return footnote texts whose marker number appears in the content."""
    if not content or not footnotes:
        return []
    texts = [str(f.get("footnote_text", "")).strip() for f in footnotes]
    matched: list[str] = []
    for num in dict.fromkeys(_MARKER.findall(content)):  # de-dupe, keep order
        idx = int(num) - 1
        if 0 <= idx < len(texts) and texts[idx] and texts[idx] not in matched:
            matched.append(texts[idx])
    return matched


def build_header(act_title: str, act_no: str, act_year: str,
                 section_label: str, section_title: str) -> str:
    """Self-contained provenance header prepended to every chunk."""
    header = f"{act_title} ({act_no} of {act_year})"
    if section_label:
        header += f", Section {section_label}"
    if section_title:
        header += f" — {section_title}"
    return header


def _slice_overlap(text: str) -> list[str]:
    """Fixed-size fallback slicer with overlap for unsplittable text."""
    out, start = [], 0
    while start < len(text):
        end = min(start + TARGET_CHARS, len(text))
        piece = text[start:end].strip()
        if piece:
            out.append(piece)
        if end >= len(text):
            break
        start = max(0, end - OVERLAP_CHARS)
    return out


def split_long_text(text: str) -> list[str]:
    """Split over-long sections, preferring subsection boundaries.

    Legal provisions subdivide into ``(1)``, ``(2)``, ``(a)`` … units, which
    are more coherent split points than sentences: each window keeps whole
    subsections. Greedy-merge subsections up to TARGET_CHARS; hard-slice
    oversized parts; merge tiny dangling tails.
    """
    parts = [p.strip() for p in _SUBSECTION_SPLIT.split(text) if p.strip()]
    units: list[str] = []
    if len(parts) > 1:
        for part in parts:
            if len(part) > TARGET_CHARS:
                units.extend(_slice_overlap(part))
            elif units and len(units[-1]) + 1 + len(part) <= TARGET_CHARS:
                units[-1] = units[-1] + " " + part
            else:
                units.append(part)
    elif len(text) <= TARGET_CHARS:
        return [text]
    else:
        return _slice_overlap(text)

    merged: list[str] = []
    for unit in units:
        if merged and len(unit) < OVERLAP_CHARS:
            merged[-1] = merged[-1] + " " + unit
        else:
            merged.append(unit)
    merged = [u for u in merged if u]
    if len(merged) <= 1:
        return merged
    # Overlap: seed each window with the previous window's trailing
    # subsection so a rule split across a boundary is still retrievable
    # whole from either side.
    out = [merged[0]]
    for prev, cur in zip(merged, merged[1:]):
        tail_parts = [p.strip() for p in _SUBSECTION_SPLIT.split(prev) if p.strip()]
        seed = tail_parts[-1] if tail_parts else prev
        if len(seed) > OVERLAP_CHARS:
            seed = seed[-OVERLAP_CHARS:]
        out.append(seed + " " + cur if seed not in cur else cur)
    return out


def chunk_act(act: dict, source_file: str) -> list[StatuteChunk]:
    """Chunk one parsed act JSON object into retrievable units."""
    if act.get("is_repealed"):
        return []
    sections = act.get("sections") or []
    footnotes = act.get("footnotes") or []
    act_title = str(act.get("act_title", "")).strip()
    act_no = str(act.get("act_no", "")).strip()
    act_year = str(act.get("act_year", "")).strip()
    language = str(act.get("language", "") or "unknown")
    source_url = str(act.get("source_url", ""))

    chunks: list[StatuteChunk] = []
    for sec_idx, sec in enumerate(sections):
        if not isinstance(sec, dict):
            continue
        raw = str(sec.get("section_content", "") or "").strip()
        if not raw or is_void_section(raw):
            continue
        section_title = str(sec.get("section_title", "") or "").strip()
        label = extract_section_label(raw)
        notes = resolve_footnotes(raw, footnotes)
        content = clean_markers(raw)
        header = build_header(act_title, act_no, act_year, label, section_title)

        bodies = [content] if len(content) <= MAX_CHARS else split_long_text(content)
        part_count = len(bodies)
        for part_idx, body in enumerate(bodies):
            text = header + "\n" + body
            if notes:
                text += "\nAmendment notes: " + " | ".join(notes)
            chunks.append(
                StatuteChunk(
                    text=text,
                    chunk_id=stable_chunk_id(source_file, sec_idx, part_idx),
                    act_title=act_title,
                    act_no=act_no,
                    act_year=act_year,
                    language=language,
                    is_repealed=False,
                    section_index=sec_idx,
                    section_label=label,
                    section_title=section_title,
                    part_index=part_idx,
                    part_count=part_count,
                    footnotes=notes,
                    source_url=source_url,
                    source_file=source_file,
                )
            )
    return chunks
