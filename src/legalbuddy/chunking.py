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
3. **Split only the long tail.** 152 sections exceed 6000 chars (max ~46k).
   These split into ~1500-char windows on sentence boundaries (including the
   Bangla dari "|") with ~200 chars of overlap, each child keeping the full
   header so it still stands alone.
4. **Footnote resolution.** Amendment markers like ``1[Bangladesh]`` are
   inline in the text while their meaning lives in ``footnotes`` (e.g. the
   word "Bangladesh" was substituted for "Pakistan"). The marker number maps
   positionally to the footnotes list, so matched notes are appended to the
   chunk under "Amendment notes". Unmatched markers are left untouched.
5. **Repealed / empty acts skipped.** The 203 repealed acts carry zero
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

# Sentence boundaries: Latin + Bangla dari (U+0964) + newlines.
_SENTENCE_SPLIT = re.compile(r"(?<=[\u0964.?!;\n])\s+")
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


def split_long_text(text: str) -> list[str]:
    """Split over-long sections on sentence boundaries with overlap."""
    sentences = [s for s in _SENTENCE_SPLIT.split(text) if s.strip()]
    if not sentences:
        return []
    windows: list[str] = []
    current: list[str] = []
    current_len = 0
    for sent in sentences:
        # If a single sentence exceeds the target, hard-cut it.
        while len(sent) > TARGET_CHARS:
            if current:
                windows.append(" ".join(current))
                current, current_len = [], 0
            windows.append(sent[:TARGET_CHARS])
            sent = sent[TARGET_CHARS:]
        if current_len + len(sent) + 1 > TARGET_CHARS and current:
            windows.append(" ".join(current))
            # Overlap: carry trailing sentences totalling ~OVERLAP_CHARS.
            carried: list[str] = []
            carried_len = 0
            for prev in reversed(current):
                carried.insert(0, prev)
                carried_len += len(prev) + 1
                if carried_len >= OVERLAP_CHARS:
                    break
            current, current_len = carried, carried_len
        current.append(sent)
        current_len += len(sent) + 1
    if current:
        piece = " ".join(current)
        # Avoid a tiny dangling tail: merge it into the previous window.
        if windows and len(piece) < OVERLAP_CHARS:
            windows[-1] = windows[-1] + " " + piece
        else:
            windows.append(piece)
    return windows


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
        content = str(sec.get("section_content", "") or "").strip()
        if not content:
            continue
        section_title = str(sec.get("section_title", "") or "").strip()
        label = extract_section_label(content)
        notes = resolve_footnotes(content, footnotes)
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
