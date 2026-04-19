"""Date extraction — pulls effective/update dates from raw policy Markdown.

Must be called on raw_markdown BEFORE cleaning, since cleaning
may strip date text along with surrounding noise.
"""

import re
from datetime import date

from dateutil import parser as dateutil_parser

# Keywords that precede a date on policy pages
_DATE_KEYWORDS = [
    "last updated",
    "last modified",
    "effective date",
    "effective as of",
    "updated on",
    "date of last revision",
    "last revised",
    "revised on",
    "posted on",
    "published on",
]

# Build a single regex: keyword followed by optional colon/dash,
# then capture the date string (greedy up to newline or period).
_KEYWORD_PATTERN = re.compile(
    r"(?:"
    + "|".join(re.escape(kw) for kw in _DATE_KEYWORDS)
    + r")\s*[:\-–—]?\s*(.+?)(?:\n|\.(?:\s|$)|$)",
    re.IGNORECASE,
)


def extract_effective_date(raw_markdown: str) -> date | None:
    """Extract the effective/update date from raw Markdown.

    Strategy: scan for keyword patterns, then parse the captured
    date string with dateutil for broad format support.
    """
    match = _find_date_match(raw_markdown)
    if match is None:
        return None
    return _parse_date_string(match)


def _find_date_match(text: str) -> str | None:
    """Find the first keyword-adjacent date string in the text."""
    match = _KEYWORD_PATTERN.search(text)
    if match is None:
        return None
    return match.group(1).strip()


def _parse_date_string(date_string: str) -> date | None:
    """Parse a date string into a date object.

    Handles ISO, US, written, abbreviated, and month-year formats
    via dateutil's fuzzy parser.
    """
    try:
        parsed = dateutil_parser.parse(date_string, fuzzy=True)
        return parsed.date()
    except (ValueError, OverflowError):
        return None
