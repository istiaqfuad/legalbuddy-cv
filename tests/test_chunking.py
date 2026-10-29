"""Unit tests for statute chunking: boundaries, headers, footnotes, edge cases."""

from legalbuddy.chunking import (
    build_header,
    chunk_act,
    extract_section_label,
    resolve_footnotes,
    split_long_text,
    stable_chunk_id,
)


def _act(**over):
    base = {
        "act_title": "The Penal Code, 1860",
        "act_no": "XLV",
        "act_year": "1860",
        "language": "english",
        "is_repealed": False,
        "sections": [],
        "footnotes": [],
        "source_url": "http://example/act-print-11.html",
    }
    base.update(over)
    return base


def test_short_section_is_single_self_contained_chunk():
    act = _act(sections=[{"section_content": "302. Whoever commits murder shall be punished with death."}])
    chunks = chunk_act(act, "act-print-11.json")
    assert len(chunks) == 1
    c = chunks[0]
    assert c.text.startswith("The Penal Code, 1860 (XLV of 1860), Section 302")
    assert "murder" in c.text
    assert c.section_label == "302"
    assert (c.part_index, c.part_count) == (0, 1)


def test_section_title_included_in_header():
    act = _act(sections=[{"section_title": "প্রারম্ভিক", "section_content": "১। এই আইন ..."}])
    (c,) = chunk_act(act, "x.json")
    assert "প্রারম্ভিক" in c.text.split("\n")[0]
    assert c.section_label == "১"


def test_long_section_splits_with_overlap_and_header():
    parts = " ".join(
        f"({i}) Subsection {i} states a distinct rule of law for this purpose." for i in range(1, 60)
    )
    body = "10. " + parts
    assert len(body) > 2000
    act = _act(sections=[{"section_content": body}])
    chunks = chunk_act(act, "x.json")
    assert len(chunks) > 1
    assert all(ch.text.startswith("The Penal Code, 1860") for ch in chunks)
    assert all(ch.part_count == len(chunks) for ch in chunks)
    assert "(1) Subsection 1" in chunks[0].text
    # Overlap guarantee: each split window (after the first) opens with the
    # previous window's trailing subsection, so the boundary rule is whole
    # on both sides.
    windows = split_long_text(body)
    assert len(windows) == len(chunks)
    boundary_rule = "(22) Subsection 22 states a distinct rule"
    assert boundary_rule in windows[0] and windows[1].startswith(boundary_rule)


def test_bangla_long_section_splits():
    body = " ".join(f"({i}) এটি {i} নম্বর উপধারা।" for i in range(1, 120))
    act = _act(sections=[{"section_content": body}])
    chunks = chunk_act(act, "x.json")
    assert len(chunks) > 1
    assert all(len(ch.text) <= 2200 for ch in chunks)


def test_void_sections_skipped():
    act = _act(sections=[
        {"section_content": "3. [Repealed by section 2 and Schedule of the Repealing Act, 1938]."},
        {"section_content": "4. (1) No person shall use white phosphorus."},
    ])
    chunks = chunk_act(act, "x.json")
    assert len(chunks) == 1
    assert "white phosphorus" in chunks[0].text


def test_markers_cleaned_but_notes_kept():
    act = _act(
        sections=[{"section_content": "1. It extends to the whole of1[Bangladesh]."}],
        footnotes=[{"footnote_text": "Bangladesh substituted for Pakistan."}],
    )
    (c,) = chunk_act(act, "x.json")
    body_line = [ln for ln in c.text.split("\n") if ln.startswith("1.")][0]
    assert "1[Bangladesh]" not in body_line
    assert "whole ofBangladesh" in body_line.replace(" ", "") or "Bangladesh" in body_line
    assert "Amendment notes: Bangladesh substituted for Pakistan." in c.text


def test_footnote_markers_resolved_and_appended():
    act = _act(
        sections=[{"section_content": "1. It extends to the whole of1[Bangladesh]. Under3[the schedule]."}],
        footnotes=[
            {"footnote_text": "Bangladesh substituted for Pakistan."},
            {"footnote_text": "Unused note."},
            {"footnote_text": "Schedule inserted in 1973."},
        ],
    )
    (c,) = chunk_act(act, "x.json")
    assert "Amendment notes:" in c.text
    assert "Bangladesh substituted for Pakistan." in c.text
    assert "Schedule inserted in 1973." in c.text
    assert "Unused note." not in c.text


def test_repealed_and_empty_sections_skipped():
    assert chunk_act(_act(is_repealed=True, sections=[{"section_content": "1. Text."}]), "x") == []
    act = _act(sections=[{"section_content": "   "}, {"section_content": "2. Real."}])
    chunks = chunk_act(act, "x.json")
    assert len(chunks) == 1


def test_ids_stable_and_unique():
    act = _act(sections=[{"section_content": "1. A."}, {"section_content": "2. B."}])
    first = [c.chunk_id for c in chunk_act(act, "f.json")]
    second = [c.chunk_id for c in chunk_act(act, "f.json")]
    assert first == second and len(set(first)) == 2
    assert stable_chunk_id("f.json", 0, 0) != stable_chunk_id("f.json", 1, 0)


def test_extract_section_label():
    assert extract_section_label("5. (1) No person shall") == "5"
    assert extract_section_label("৩। এই আইন") == "৩"
    assert extract_section_label("Preamble text without number") == ""


def test_resolve_footnotes_out_of_range_safe():
    assert resolve_footnotes("See 9[B].", [{"footnote_text": "Only one."}]) == []
    assert resolve_footnotes("No markers.", [{"footnote_text": "Note."}]) == []


def test_header_without_label_or_title():
    assert build_header("Some Act", "I", "1900", "", "") == "Some Act (I of 1900)"


def test_split_long_text_tiny_tail_merged():
    assert len(split_long_text("A. " + "x " * 800 + "tail.")) >= 1


def test_act_title_marker_artifacts_cleaned():
    act = _act(act_title="1The Penal Code, 1860",
               sections=[{"section_content": "302. Whoever commits murder shall be punished."}])
    (c,) = chunk_act(act, "x.json")
    assert c.act_title == "The Penal Code, 1860"
    assert c.text.startswith("The Penal Code, 1860 (XLV of 1860)")

    act2 = _act(act_title="1[বাংলাদেশ পেটেন্ট আইন, ২০২২",
                sections=[{"section_content": "১। এই আইন।"}])
    (c2,) = chunk_act(act2, "y.json")
    assert c2.act_title.startswith("বাংলাদেশ পেটেন্ট আইন")

    act3 = _act(act_title="১৯৭৫ সালের বিশেষ আইন",
                sections=[{"section_content": "১। এই আইন।"}])
    (c3,) = chunk_act(act3, "z.json")
    assert c3.act_title == "১৯৭৫ সালের বিশেষ আইন"  # legitimate year kept


def test_repealed_via_csv_metadata_skipped():
    # Real bdlaws files carry the flag in csv_metadata, not top level.
    act = _act(csv_metadata={"is_repealed": True},
               sections=[{"section_content": "1. Text."}])
    del act["is_repealed"]
    assert chunk_act(act, "x.json") == []


def test_amendment_notes_only_on_first_part():
    parts = " ".join(
        f"({i}) Subsection {i} states a distinct rule of law for this purpose."
        for i in range(1, 60))
    act = _act(
        sections=[{"section_content": "10. " + parts + " See1[note]."}],
        footnotes=[{"footnote_text": "Inserted in 1973."}],
    )
    chunks = chunk_act(act, "x.json")
    assert len(chunks) > 1
    assert "Amendment notes: Inserted in 1973." in chunks[0].text
    assert all("Amendment notes" not in c.text for c in chunks[1:])



