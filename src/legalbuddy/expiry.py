"""Candidate expiry-date extraction from document text (rules only).

The vault suggests dates; the owner confirms them. A deterministic
regex pass finds calendar dates near expiry language, so a suggestion
is always grounded in the stored text — the language model never
invents a deadline.

Covered: numeric ``DD/MM/YYYY`` (and ``DD-MM-YYYY``, ``DD.MM.YYYY``),
``30 June 2026`` / ``June 30, 2026`` spellings, and Bangla digits.
Only dates within ``MIN_YEAR..MAX_YEAR`` are kept, nearest-expiry
first, capped at ``MAX_DATES``.
"""

from __future__ import annotations

import re
from datetime import date

MIN_YEAR = 1990
MAX_YEAR = 2100
MAX_DATES = 10
# Characters around a date that may carry expiry language.
WINDOW = 60

_BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")

_MONTHS = (
    "january february march april may june july august september "
    "october november december"
).split()
_BN_MONTHS = {
    "জানুয়ারি": 1, "জানুয়ারি": 1,
    "ফেব্রুয়ারি": 2, "ফেব্রুয়ারি": 2,
    "মার্চ": 3,
    "এপ্রিল": 4,
    "মে": 5,
    "জুন": 6,
    "জুলাই": 7,
    "আগস্ট": 8,
    "সেপ্টেম্বর": 9,
    "অক্টোবর": 10,
    "নভেম্বর": 11,
    "ডিসেম্বর": 12,
}

_KEYWORDS = re.compile(
    r"expir|valid(?:ity)?(?:\s+(?:up\s+to|till|until|through|thru|to))?"
    r"|renewal|renew|meyad|মেয়াদ|মেয়াদ|নবায়ন",
    re.IGNORECASE,
)

_NUMERIC = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b")
_WRITTEN = re.compile(
    r"\b(\d{1,2})(?:st|nd|rd|th)?\s+"
    r"(January|February|March|April|May|June|July|August|September|"
    r"October|November|December)\s*,?\s*(\d{4})\b",
    re.IGNORECASE,
)
_WRITTEN_US = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|"
    r"October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*"
    r"(\d{4})\b",
    re.IGNORECASE,
)
_BN_WRITTEN = re.compile(
    r"([০-৯0-9]{1,2})\s*(জানুয়ারি|জানুয়ারি|ফেব্রুয়ারি|ফেব্রুয়ারি|মার্চ|"
    r"এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্টেম্বর|অক্টোবর|নভেম্বর|ডিসেম্বর)"
    r"\s*,?\s*([০-৯0-9]{4})"
)


def _to_date(day: int, month: int, year: int) -> date | None:
    if year < 100:
        year += 2000
    if not (MIN_YEAR <= year <= MAX_YEAR):
        return None
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _near_keyword(text: str, start: int, end: int) -> bool:
    lo = max(0, start - WINDOW)
    hi = min(len(text), end + WINDOW)
    return _KEYWORDS.search(text[lo:hi]) is not None


def _context(text: str, start: int, end: int, width: int = 80) -> str:
    lo = max(0, start - width)
    hi = min(len(text), end + width)
    return re.sub(r"\s+", " ", text[lo:hi]).strip()


def extract_candidate_dates(text: str) -> list[dict]:
    """Dates near expiry language: ``[{"date": iso, "context": ...}]``.

    The same calendar date found twice keeps its first (usually
    earliest-page) occurrence. Expired dates are kept — an expired
    licence is exactly what the owner needs to see.
    """
    if not text:
        return []
    found: dict[str, dict] = {}

    def add(day: int, month: int, year: int, s: int, e: int) -> None:
        d = _to_date(day, month, year)
        if d is None or not _near_keyword(text, s, e):
            return
        iso = d.isoformat()
        if iso not in found:
            found[iso] = {"date": iso, "context": _context(text, s, e)}

    for m in _NUMERIC.finditer(text):
        a, b, c = int(m.group(1)), int(m.group(2)), int(m.group(3))
        # Bangladesh documents are day-first; accept a month-first
        # reading only when day-first is impossible.
        if 1 <= b <= 12 and 1 <= a <= 31:
            add(a, b, c, m.start(), m.end())
        elif 1 <= a <= 12 and 1 <= b <= 31:
            add(b, a, c, m.start(), m.end())
    for m in _WRITTEN.finditer(text):
        add(int(m.group(1)), _MONTHS.index(m.group(2).lower()) + 1,
            int(m.group(3)), m.start(), m.end())
    for m in _WRITTEN_US.finditer(text):
        add(int(m.group(2)), _MONTHS.index(m.group(1).lower()) + 1,
            int(m.group(3)), m.start(), m.end())
    for m in _BN_WRITTEN.finditer(text):
        day = int(m.group(1).translate(_BN_DIGITS))
        year = int(m.group(3).translate(_BN_DIGITS))
        add(day, _BN_MONTHS[m.group(2)], year, m.start(), m.end())

    out = sorted(found.values(), key=lambda r: r["date"])
    return out[:MAX_DATES]
