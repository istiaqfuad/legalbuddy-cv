"""Contract review: rules-only parts are hermetic, no models."""

from types import SimpleNamespace

from legalbuddy.contract_review import (
    build_review_prompt,
    extract_clauses,
    parse_review_flags,
    review_contract,
)


def test_extract_clauses_groups_and_caps():
    text = ("The supplier shall pay liquidated damages of Tk 1000 per day of delay. "
            "Either party may terminate with 30 days notice. "
            "The weather in Dhaka is pleasant today and the office opens at nine.")
    clauses = extract_clauses(text)
    groups = {c["group"] for c in clauses}
    assert groups == {"penalty", "termination"}
    assert all(len(c["text"]) <= 500 for c in clauses)


def test_extract_clauses_empty():
    assert extract_clauses("Nothing to see here, just a lunch menu.") == []


def test_parse_keeps_only_retrieved_citations():
    valid = {("The Contract Act, 1872", "74")}
    raw = ('{"flags": ['
           '{"title": "Penalty cap", "clause": "pay Tk 1000 per day", "risk": "high",'
           ' "explanation": "Compensation is capped at the stated sum.",'
           ' "citation": {"act": "The Contract Act, 1872", "section": "74"}},'
           '{"title": "Invented", "clause": "something", "risk": "high",'
           ' "explanation": "Made up.",'
           ' "citation": {"act": "The Imaginary Act, 1900", "section": "1"}}]}')
    out = parse_review_flags(raw, valid)
    assert len(out) == 1
    assert out[0]["citation"] == {"act": "The Contract Act, 1872", "section": "74"}


def test_parse_garbage_returns_empty():
    assert parse_review_flags("not json at all", {("A", "1")}) == []
    assert parse_review_flags('{"flags": "nope"}', {("A", "1")}) == []


def _hits(*pairs):
    pts = [SimpleNamespace(payload={"act_title": a, "section_label": s, "text": "excerpt " + a})
           for a, s in pairs]
    return SimpleNamespace(points=pts)


def test_review_contract_happy_path():
    retriever = lambda q, limit=6: _hits(("The Contract Act, 1872", "74"))
    completer = lambda prompt: ('{"flags": [{"title": "Penalty cap", '
                                '"clause": "pay Tk 1000 per day of delay", "risk": "high", '
                                '"explanation": "Reasonable compensation capped at the named sum.", '
                                '"citation": {"act": "The Contract Act, 1872", "section": "74"}}]}')
    text = "Supplier shall pay liquidated damages of Tk 1000 per day of delay under this agreement."
    out = review_contract([text], retriever=retriever, completer=completer)
    assert len(out["flags"]) == 1 and out["note"] == ""


def test_review_contract_no_clauses():
    out = review_contract(["Lunch menu: rice, dal, vegetables."],
                          retriever=lambda q, limit=6: _hits(),
                          completer=lambda p: '{"flags": []}')
    assert out == {"flags": [], "note": "No penalty, termination, payment, or standard clauses found to check."}


def test_review_contract_no_passages():
    out = review_contract(["Termination needs 30 days notice, signed today."],
                          retriever=lambda q, limit=6: _hits(),
                          completer=lambda p: '{"flags": []}')
    assert out["flags"] == [] and "advocate" in out["note"]


def test_review_contract_drops_invented_citations():
    retriever = lambda q, limit=6: _hits(("The Contract Act, 1872", "74"))
    completer = lambda p: ('{"flags": [{"title": "X", "clause": "y", "risk": "low", '
                           '"explanation": "z", '
                           '"citation": {"act": "Made Up Act", "section": "99"}}]}')
    out = review_contract(["Pay liquidated damages of Tk 500 per day of delay."],
                          retriever=retriever, completer=completer)
    assert out["flags"] == [] and out["note"] != ""


def test_prompt_lists_only_given_statutes():
    prompt = build_review_prompt(
        [{"group": "penalty", "text": "pay Tk 1000 per day"}],
        [{"ref": 1, "act_title": "The Contract Act, 1872",
          "section_label": "74", "excerpt": "compensation text"}])
    assert "The Contract Act, 1872" in prompt and "ONLY citable sources" in prompt


def test_parse_accepts_formatting_variants_of_retrieved_cites():
    """The model writes formal titles and "Section N"; both resolve to
    the stored originals, while invented acts still drop."""
    from legalbuddy.contract_review import parse_review_flags
    valid = {("The Contract Act, 1872", "74")}
    raw = ('{"flags": [{"title": "Penalty cap", "clause": "pay Tk 1000 per day", '
           '"risk": "high", "explanation": "Capped.", '
           '"citation": {"act": "The Contract Act, 1872 (IX of 1872)", "section": "Section 74"}}]}')
    out = parse_review_flags(raw, valid)
    assert out[0]["citation"] == {"act": "The Contract Act, 1872", "section": "74"}
    bad = raw.replace("The Contract Act, 1872 (IX of 1872)", "The Made-Up Act, 1900 (I of 1900)")
    assert parse_review_flags(bad, valid) == []
