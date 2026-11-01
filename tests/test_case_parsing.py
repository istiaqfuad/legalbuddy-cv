"""Unit tests for case-study parsing: triage, cleaning, sections, payload."""

from legalbuddy.case_parsing import (
    CASE_MAX_CHARS,
    ROUTE_BANGLA_OCR,
    ROUTE_DIGITAL,
    ROUTE_SCANNED,
    CaseChunk,
    build_case_header,
    case_chunk_to_payload,
    chunk_case_document,
    chunk_type_for,
    classify_page,
    clean_case_text,
    detect_language,
    extract_case_metadata,
    is_broken_bangla,
    split_case_sections,
    stable_case_chunk_id,
    triage_segments,
)

HEADNOTE = (
    "IN THE SUPREME COURT OF BANGLADESH\n"
    "HIGH COURT DIVISION\n"
    "(CIVIL REVISIONAL JURISDICTION)\n\n"
    "Present:\n"
    "Mr. Justice Md. Moinul Islam Chowdhury\n\n"
    "Civil Revision No. 1359 of 2002\n\n"
    "Hatem Khan Bara Masjid Committee\n"
    "—Versus—\n"
    "Divisional Director, Islamic Foundation\n\n"
    "Heard and Judgment on 11.01.2017\n"
)


def test_classify_page_routes_digital_scanned_and_broken_bangla():
    digital = "At the instance of the petitioner " * 20
    assert classify_page(digital, has_images=False) == ROUTE_DIGITAL
    assert classify_page("", has_images=True) == ROUTE_SCANNED
    assert classify_page("short", has_images=False) == ROUTE_SCANNED
    # Fragmented Bangla from SuoMoto 07/2019: isolated vowel-sign debris.
    broken = "detention of 121 children " + "িশ উ য়ন ক " * 4
    assert is_broken_bangla(broken)
    assert classify_page(broken * 8, has_images=False) == ROUTE_BANGLA_OCR
    assert not is_broken_bangla("আইন মানা হোক")
    assert not is_broken_bangla(digital)


def test_triage_segments_reports_worst_route():
    segments = [("At the instance " * 30, 1), ("", 2)]
    report = triage_segments(segments, image_pages={2})
    assert report["worst_route"] == ROUTE_SCANNED
    assert [p["route"] for p in report["pages"]] == [ROUTE_DIGITAL, ROUTE_SCANNED]


def test_clean_case_text_joins_wraps_and_strips_footers():
    raw = (
        "At the instance of the petitioner\n"
        "Md. Sayed Hossain Khan represented by the Managing\nCommittee\n"
        "\n"
        "                               Page # 2\n\n\n\n"
        "     The said Md. Sayed Hossain Khan died\n"
    )
    cleaned = clean_case_text(raw)
    # Single newlines fold; blank-line paragraph breaks survive.
    assert "petitioner Md. Sayed Hossain Khan" in cleaned
    assert "Managing Committee" in cleaned
    assert "Page # 2" not in cleaned
    assert "\n\n" in cleaned
    assert "died" in cleaned


def test_split_case_sections_finds_headings_and_numbered_paras():
    cleaned = clean_case_text(
        HEADNOTE + "\n1. The relevant facts are these.\n\n"
        "2. The opposite party contends otherwise.\n"
    )
    sections = split_case_sections(cleaned)
    assert len(sections) >= 3
    by_title = {t or "preamble": chunk_type_for(t, i) for i, (t, _b) in enumerate(sections)}
    assert by_title["preamble"] == "headnote"
    assert any((t or "").startswith("Present:") for _t, _b in sections for t in [_t])
    numbered = [t for t, _b in sections if (t or "").startswith("1.")]
    assert numbered
    assert chunk_type_for(numbered[0], 2) == "reasoning"


def test_extract_case_metadata_from_front_matter():
    meta = extract_case_metadata(HEADNOTE)
    assert meta["case_number"] == "Civil Revision No. 1359 of 2002"
    assert "high court division" in meta["court"].lower()
    assert meta["decision_date"] == "11.01.2017"
    assert meta["case_year"] == "2002"
    assert meta["case_type"] == "Civil Revision"
    assert "Hatem Khan" in meta["parties"]


def test_chunk_case_document_headers_ids_and_page_spans():
    segments = [(HEADNOTE, 1), ("1. The relevant facts are these. " * 40, 2)]
    meta = extract_case_metadata(HEADNOTE)
    chunks = chunk_case_document(
        "case1",
        "100174_CR_1359_2002.pdf",
        "deadbeef",
        segments,
        case_title="Hatem Khan Bara Masjid Committee",
        metadata=meta,
    )
    assert chunks
    assert all(c.chunk_count == len(chunks) for c in chunks)
    assert chunks[0].text.startswith(
        "Hatem Khan Bara Masjid Committee, Civil Revision No. 1359 of 2002"
    )
    assert chunks[0].page_start == 1
    assert chunks[0].chunk_id == stable_case_chunk_id("100174_CR_1359_2002.pdf", 0, 0)
    assert len({c.chunk_id for c in chunks}) == len(chunks)
    assert all(c.case_number == "Civil Revision No. 1359 of 2002" for c in chunks)
    assert all(c.language in ("en", "mixed", "bn") for c in chunks)
    assert all(len(c.text) <= CASE_MAX_CHARS + 600 for c in chunks)


def test_case_chunk_to_payload_carries_indexed_filters():
    chunk = CaseChunk(
        text="h",
        chunk_id="id",
        case_id="c1",
        source_file="f.pdf",
        file_hash="ab",
        chunk_index=0,
        chunk_count=1,
        char_start=0,
        char_end=1,
        page_start=1,
        page_end=1,
        chunk_type="headnote",
        section_title="Present:",
        section_path="Present:",
        section_index=0,
        part_index=0,
        part_count=1,
        case_type="Civil Revision",
        court="High Court Division",
        case_number="Civil Revision No. 1 of 2002",
        case_year="2002",
        language="en",
    )
    payload = case_chunk_to_payload(chunk)
    for key in ("case_type", "court", "case_number", "case_year", "language", "source_file"):
        assert payload[key], key
    assert payload["text"] == "h"


def test_detect_language_mixed_and_pure():
    assert detect_language("Whoever commits murder") == "en"
    assert detect_language("আইন মানা হোক দেশের জন্য") == "bn"
    assert detect_language("Section 302 দণ্ডবিধি এর অধীন") == "mixed"


def test_build_case_header_marks_parts():
    header = build_case_header(
        "Hatem Khan", "Civil Revision No. 1359 of 2002", "High Court Division", "Present:", 1, 3
    )
    assert "(part 2/3)" in header
    assert "[Present:]" in header
