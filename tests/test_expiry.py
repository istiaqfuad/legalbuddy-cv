"""Rules-based expiry-date suggestions: no models, no fixtures."""

from legalbuddy.expiry import extract_candidate_dates


def test_numeric_day_first_near_expiry():
    out = extract_candidate_dates(
        "Trade Licence\nValid up to 30/06/2026. Renew before expiry.")
    assert [r["date"] for r in out] == ["2026-06-30"]


def test_date_without_expiry_language_ignored():
    out = extract_candidate_dates(
        "Meeting minutes dated 01/02/2024. The agenda covered routine matters.")
    assert out == []


def test_written_and_us_order():
    a = extract_candidate_dates("Licence expires on 30 June 2026 without fail.")
    b = extract_candidate_dates("Valid through June 30, 2026 for all branches.")
    assert [r["date"] for r in a] == ["2026-06-30"]
    assert [r["date"] for r in b] == ["2026-06-30"]


def test_bangla_digits_and_month():
    out = extract_candidate_dates("মেয়াদ ৩০ জুন ২০২৬ পর্যন্ত বলবৎ থাকিবে।")
    assert [r["date"] for r in out] == ["2026-06-30"]


def test_impossible_and_out_of_range_dropped():
    assert extract_candidate_dates("Expiry 31/02/2026, please renew.") == []
    assert extract_candidate_dates("Valid till 30/06/1800, renew.") == []


def test_month_first_fallback_only_when_day_first_impossible():
    out = extract_candidate_dates("Valid until 06/30/2026, renew on time.")
    assert [r["date"] for r in out] == ["2026-06-30"]


def test_dedupe_and_sorted_with_context():
    text = ("Renew soil permit. Expiry 30/06/2026. Also fire licence "
            "expiry 01/01/2026 noted. Repeat expiry 30/06/2026 again.")
    out = extract_candidate_dates(text)
    assert [r["date"] for r in out] == ["2026-01-01", "2026-06-30"]
    assert all(r["context"] for r in out)
